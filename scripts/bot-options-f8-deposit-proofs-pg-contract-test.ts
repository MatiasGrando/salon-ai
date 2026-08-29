import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 proof contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f8proof_business_${suffix}`
const customerId = `f8proof_customer_${suffix}`
const professionalId = `f8proof_professional_${suffix}`
const serviceId = `f8proof_service_${suffix}`
const appointmentId = `f8proof_appointment_${suffix}`
const depositId = `f8proof_deposit_${suffix}`

try {
  await seed()
  await insertProof(1, 'INITIAL')
  await assert.rejects(insertProof(3, 'RESUBMISSION'), /sequence must append contiguously/i)
  const concurrent = await Promise.allSettled([insertProof(2, 'RESUBMISSION'), insertProof(2, 'RESUBMISSION')])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1, 'root lock serializes concurrent appenders')
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1, 'a racing duplicate fails closed')
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BookingDepositProof" SET "kind" = 'LATE'::"BookingDepositProofKind" WHERE "businessId" = ${businessId} AND "depositId" = ${depositId} AND "sequence" = 1`),
    /permits only one-way due byte purge/i
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${businessId} AND "depositId" = ${depositId} AND "sequence" = 1`),
    /immutable while its deposit exists/i
  )
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${businessId} AND "depositId" = ${depositId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId} AND "id" = ${depositId}`)
  })
  const remains = await prisma.$queryRaw<Array<{ proofs: bigint; deposits: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingDepositProof" WHERE "businessId" = ${businessId})::bigint AS "proofs",
      (SELECT count(*) FROM "BookingDeposit" WHERE "businessId" = ${businessId})::bigint AS "deposits"
  `)
  assert.deepEqual(remains[0], { proofs: 0n, deposits: 0n }, 'aggregate retention purge is possible only as one transaction')
  console.log('OK F8.5 PG: tenant scope, contiguous sequence under race, immutable evidence and aggregate-purge escape hatch.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F8PROOF-${suffix}`}, 'F8 proof contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${businessId}, 'Cliente F8', ${`54911${suffix.slice(0, 8)}`}, ${`54911${suffix.slice(0, 8)}`})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${professionalId}, ${businessId}, 'Profesional F8')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration") VALUES (${serviceId}, ${businessId}, 'Servicio F8', 30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes") VALUES (${appointmentId}, ${customerId}, ${professionalId}, ${serviceId}, clock_timestamp(), 30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "mode", "configuredValue", "amount", "expiresAt", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, 'FIXED'::"ServiceDepositMode", 1, 1, clock_timestamp() + interval '1 hour', clock_timestamp())`)
  })
}

async function insertProof(sequence: number, kind: 'INITIAL' | 'RESUBMISSION' | 'LATE') {
  const proofBytes = Buffer.from(`f8-proof-contract-${sequence}`)
  const proofHash = createHash('sha256').update(proofBytes).digest('hex')
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDepositProof" (
      "id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt",
      "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256",
      "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt"
    ) VALUES (
      ${randomUUID()}, ${businessId}, ${depositId}, ${sequence}, ${kind}::"BookingDepositProofKind", 'f8-contract', clock_timestamp(), clock_timestamp(),
      ${proofBytes}, 'image/png', 'proof.png', ${proofBytes.length}, ${proofHash},
      ${proofBytes}, 'image/webp', ${proofBytes.length}, ${proofHash}, clock_timestamp() + interval '12 months'
    )
  `)
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    // The proof trigger evaluates at commit, after its root is removed.
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "id" = ${appointmentId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${professionalId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${serviceId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${customerId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  }).catch(() => undefined)
}
