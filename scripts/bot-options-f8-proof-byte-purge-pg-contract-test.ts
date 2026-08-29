import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 purge contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, { purgeDueDepositProofBytes, purgeDueDepositProofBytesInTransaction }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/deposit-proof-byte-purge.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `f8purge_business_${suffix}`, customer: `f8purge_customer_${suffix}`, professional: `f8purge_professional_${suffix}`, service: `f8purge_service_${suffix}` }

try {
  await seedRoot()
  const due = await seedProof('due', true)
  const notDue = await seedProof('not_due', false)
  const rollback = await seedProof('rollback', true)
  const raceA = await seedProof('race_a', true)
  const raceB = await seedProof('race_b', true)

  const dryRun = await purgeDueDepositProofBytes(prisma, { mode: 'DRY_RUN', batchSize: 1, businessId: ids.business })
  assert.equal(dryRun.candidateCount, 1, 'dry run is bounded and sees DB-clock-due evidence')
  await assert.rejects(prisma.$executeRaw(Prisma.sql`
    UPDATE "BookingDepositProof" SET "sourceData" = NULL, "derivedData" = NULL, "purgeReason" = 'RETENTION_12_MONTHS'
    WHERE "id" = ${notDue.proofId}
  `), /one-way due byte purge/i, 'not-due bytes cannot be purged')

  const first = await purgeDueDepositProofBytes(prisma, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:due` })
  assert.equal(first.purgedCount, 1)
  const metadata = await prisma.$queryRaw<Array<{ sourceData: Buffer | null; derivedData: Buffer | null; sourceSha256: string; sourceFilename: string; sourceByteSize: number; sequence: number; validationStatus: string; purgedAt: Date | null; purgeReason: string | null }>>(Prisma.sql`
    SELECT "sourceData", "derivedData", "sourceSha256", "sourceFilename", "sourceByteSize", "sequence", "validationStatus", "purgedAt", "purgeReason"
    FROM "BookingDepositProof" WHERE "id" = ${due.proofId}
  `)
  assert.deepEqual(metadata[0], { sourceData: null, derivedData: null, sourceSha256: due.hash, sourceFilename: 'proof.png', sourceByteSize: due.bytes.length, sequence: 1, validationStatus: 'VALID', purgedAt: metadata[0]!.purgedAt, purgeReason: 'RETENTION_12_MONTHS' })
  assert.ok(metadata[0]!.purgedAt, 'DB owns purgedAt')
  await assert.rejects(prisma.$executeRaw(Prisma.sql`UPDATE "BookingDepositProof" SET "sourceData" = ${due.bytes} WHERE "id" = ${due.proofId}`), /one-way due byte purge/i, 'bytes cannot be restored')
  await assert.rejects(prisma.$executeRaw(Prisma.sql`UPDATE "BookingDepositProofPurgeAudit" SET "reason" = 'RETENTION_12_MONTHS' WHERE "proofId" = ${due.proofId}`), /append-only/i, 'purge audit cannot be edited')
  const replay = await purgeDueDepositProofBytes(prisma, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:due` })
  assert.equal(replay.replayed, true, 'same operation key replays its durable outcome')

  await assert.rejects(prisma.$transaction(async (tx) => {
    await purgeDueDepositProofBytesInTransaction(tx, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:rollback` })
    throw new Error('force rollback')
  }), /force rollback/)
  const rollbackState = await prisma.$queryRaw<Array<{ bytesPresent: boolean; operations: bigint }>>(Prisma.sql`
    SELECT ("sourceData" IS NOT NULL AND "derivedData" IS NOT NULL) AS "bytesPresent",
      (SELECT count(*) FROM "BookingDepositProofPurgeOperation" WHERE "operationKey" = ${`purge:${suffix}:rollback`})::bigint AS "operations"
    FROM "BookingDepositProof" WHERE "id" = ${rollback.proofId}
  `)
  assert.deepEqual(rollbackState[0], { bytesPresent: true, operations: 0n }, 'row mutation, event and operation roll back together')
  await purgeDueDepositProofBytes(prisma, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:rollback-recovered` })

  const concurrent = await Promise.all([
    purgeDueDepositProofBytes(prisma, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:race-a` }),
    purgeDueDepositProofBytes(prisma, { mode: 'EXECUTE', batchSize: 1, businessId: ids.business, operationKey: `purge:${suffix}:race-b` })
  ])
  assert.equal(concurrent.reduce((total, result) => total + result.purgedCount, 0), 2, 'SKIP LOCKED gives concurrent workers disjoint bounded rows')
  const raced = await prisma.$queryRaw<Array<{ purged: bigint; audits: bigint }>>(Prisma.sql`
    SELECT (SELECT count(*) FROM "BookingDepositProof" WHERE "id" IN (${raceA.proofId}, ${raceB.proofId}) AND "purgedAt" IS NOT NULL)::bigint AS "purged",
      (SELECT count(*) FROM "BookingDepositProofPurgeAudit" WHERE "proofId" IN (${raceA.proofId}, ${raceB.proofId}))::bigint AS "audits"
  `)
  assert.deepEqual(raced[0], { purged: 2n, audits: 2n })
  console.log('OK F8 purge PG: due/not-due, DB clock, replay, concurrency, rollback, metadata preservation and no byte restoration.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seedRoot() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.business}, ${`F8PURGE-${suffix}`}, 'F8 purge contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${ids.customer}, ${ids.business}, 'Cliente', ${`54911${suffix.slice(0, 8)}`}, ${`54911${suffix.slice(0, 8)}`})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${ids.business}, 'Profesional')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration") VALUES (${ids.service}, ${ids.business}, 'Servicio', 30)`)
  })
}

async function seedProof(label: string, due: boolean) {
  const appointmentId = `f8purge_appointment_${label}_${suffix}`, depositId = `f8purge_deposit_${label}_${suffix}`, proofId = `f8purge_proof_${label}_${suffix}`
  const bytes = Buffer.from(`f8-purge-${label}-${suffix}`), hash = createHash('sha256').update(bytes).digest('hex')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes") VALUES (${appointmentId}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp(), 30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "mode", "configuredValue", "amount", "expiresAt", "updatedAt") VALUES (${depositId}, ${ids.business}, ${appointmentId}, 'FIXED'::"ServiceDepositMode", 1, 1, clock_timestamp() + interval '1 hour', clock_timestamp())`)
    const receivedAt = due ? Prisma.sql`clock_timestamp() - interval '13 months'` : Prisma.sql`clock_timestamp()`
    const retentionEligibleAt = due ? Prisma.sql`clock_timestamp() - interval '1 month'` : Prisma.sql`clock_timestamp() + interval '12 months'`
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${proofId}, ${ids.business}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f8-contract', ${receivedAt}, ${receivedAt}, ${bytes}, 'image/png', 'proof.png', ${bytes.length}, ${hash}, ${bytes}, 'image/webp', ${bytes.length}, ${hash}, ${retentionEligibleAt})`)
  })
  return { appointmentId, depositId, proofId, bytes, hash }
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "id" LIKE ${`f8purge_appointment_%${suffix}`}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${ids.service}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${ids.customer}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`)
  }).catch(() => undefined)
}
