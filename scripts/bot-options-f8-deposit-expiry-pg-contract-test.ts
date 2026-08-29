import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 expiry contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, worker, expiry, notifications, bridgeWorker] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/expire-deposit-hold.js'),
  import('../src/services/deposit-notification-outbox.js'),
  import('../src/bot-options/application/bridge-deposit-notification-job.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 6, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f8exp_b_${suffix}`
const configId = `f8exp_cfg_${suffix}`
const deploymentId = `f8exp_dep_${suffix}`
const conversationId = `f8exp_conv_${suffix}`
const sessionId = `f8exp_session_${suffix}`
const customerId = `f8exp_customer_${suffix}`
const professionalId = `f8exp_prof_${suffix}`
const serviceId = `f8exp_service_${suffix}`

try {
  await seed()
  const held = await seedHold('expired')
  // A cutover must not strand an existing financial hold. The lease token,
  // tenant binding and conditional aggregate state remain the fencing boundary.
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "generation" = 2, "activeConfigurationId" = NULL WHERE "id" = ${deploymentId}`)
  const firstClaim = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(firstClaim?.id, held.jobId, 'expiry job remains claimable after cutover')
  assert.ok(firstClaim)
  // A stale expiry at its final generic retry is recovered, rather than
  // poisoned: a POISON expiry could strand a customer slot forever.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "attempts" = "maxAttempts", "leasedUntil" = clock_timestamp() - interval '1 second',
      "availableAt" = clock_timestamp() - interval '1 second'
    WHERE "id" = ${held.jobId}
  `)
  assert.equal(await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId }), null, 'exhausted stale expiry is rescheduled with a recovery delay')
  const recoveryState = await prisma.$queryRaw<Array<{ status: string; attempts: number; availableAt: Date }>>(Prisma.sql`
    SELECT "status"::text AS "status", "attempts", "availableAt" FROM "BotJob" WHERE "id" = ${held.jobId}
  `)
  assert.equal(recoveryState[0]?.status, 'RETRY')
  assert.equal(recoveryState[0]?.attempts, 0)
  assert.ok(recoveryState[0]!.availableAt > new Date(), 'recovery must back off rather than hot-loop')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() WHERE "id" = ${held.jobId}`)
  const recoveredClaim = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(recoveredClaim?.id, held.jobId)
  assert.ok(recoveredClaim)
  assert.notEqual(recoveredClaim.claimToken, firstClaim.claimToken, 'recovered lease fences the crashed worker')
  await assert.rejects(expiry.expireDepositHold(prisma, firstClaim), /stale or fenced/i)
  assert.equal(await expiry.expireDepositHold(prisma, recoveredClaim), 'EXPIRED')
  const released = await prisma.$queryRaw<Array<{
    depositStatus: string; visitStatus: string; appointmentStatus: string; auditCount: bigint; outboxCount: bigint; jobStatus: string; reason: string | null; expiredAt: Date | null
  }>>(Prisma.sql`
    SELECT
      (SELECT "status"::text FROM "BookingDeposit" WHERE "id" = ${held.depositId}) AS "depositStatus",
      (SELECT "status"::text FROM "BookingVisit" WHERE "id" = ${held.visitId}) AS "visitStatus",
      (SELECT "status"::text FROM "Appointment" WHERE "id" = ${held.appointmentId}) AS "appointmentStatus",
      (SELECT count(*) FROM "BookingDepositExpiryAudit" WHERE "depositId" = ${held.depositId})::bigint AS "auditCount",
      (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${businessId})::bigint AS "outboxCount",
      (SELECT "status"::text FROM "BotJob" WHERE "id" = ${held.jobId}) AS "jobStatus",
      (SELECT "expirationReason" FROM "BookingDeposit" WHERE "id" = ${held.depositId}) AS "reason",
      (SELECT "expiredAt" FROM "BookingDeposit" WHERE "id" = ${held.depositId}) AS "expiredAt"
  `)
  assert.deepEqual(released[0], {
    depositStatus: 'EXPIRED', visitStatus: 'EXPIRED', appointmentStatus: 'CANCELLED', auditCount: 1n,
    outboxCount: 0n, jobStatus: 'DONE', reason: 'HOLD_TTL_EXPIRED', expiredAt: released[0]!.expiredAt
  })
  assert.ok(released[0]!.expiredAt instanceof Date, 'expiry timestamp comes from DB and is retained')
  const auditId = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BookingDepositExpiryAudit" WHERE "depositId" = ${held.depositId}`))[0]!.id
  const recoveryAggregate = notifications.encodeDirectNotificationRecovery({ kind: 'EXPIRED', depositId: held.depositId, sourceId: auditId })
  const recoveryJob = (await prisma.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status" FROM "BotJob"
    WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${recoveryAggregate}
  `))[0]!
  assert.equal(recoveryJob.status, 'READY', 'expired aggregate commits with durable notification recovery after cutover')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "activeConfigurationId" = ${configId}, "updatedAt" = clock_timestamp() WHERE "id" = ${deploymentId}`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "deploymentGeneration" = 2, "updatedAt" = clock_timestamp() WHERE "id" = ${sessionId}`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${recoveryJob.id}`)
  const recoveryClaim = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(recoveryClaim?.id, recoveryJob.id)
  assert.ok(recoveryClaim)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, recoveryClaim), 'COMPLETED')
  assert.equal((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotOutbox"
    WHERE "idempotencyKey" = ${`deposit-notification:EXPIRED:${auditId}`}
  `))[0]!.count, 1n, 'refreshed current route enqueues exactly one EXPIRED outbox')
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositExpiryAudit" WHERE "depositId" = ${held.depositId}`),
    /append-only/i,
    'expiry evidence cannot be deleted while its deposit aggregate is retained'
  )

  const proofRace = await seedHold('proof-race', 'PROOF_RECEIVED')
  const proofJob = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(proofJob?.id, proofRace.jobId)
  assert.ok(proofJob)
  assert.equal(await expiry.expireDepositHold(prisma, proofJob), 'INELIGIBLE', 'proof wins the race; expiry must not undo it')
  const proofState = await prisma.$queryRaw<Array<{ status: string; visit: string; appointment: string; auditCount: bigint }>>(Prisma.sql`
    SELECT d."status"::text AS "status", v."status"::text AS "visit", a."status"::text AS "appointment",
      (SELECT count(*) FROM "BookingDepositExpiryAudit" WHERE "depositId" = d."id")::bigint AS "auditCount"
    FROM "BookingDeposit" d JOIN "BookingVisit" v ON v."id" = d."visitId"
    JOIN "Appointment" a ON a."id" = d."appointmentId" WHERE d."id" = ${proofRace.depositId}
  `)
  assert.deepEqual(proofState[0], { status: 'PROOF_RECEIVED', visit: 'HELD', appointment: 'PENDING', auditCount: 0n })
  console.log('OK F8.6 PG: DB-time expiry, F7 hierarchy, stale-lease fencing, poisoned-job recovery, cutover recovery, atomic release, immutable audit and proof race fail-closed.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F8EXP-${suffix}`}, 'F8 expiry contract')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "accessToken", "updatedAt") VALUES (${`f8exp_wa_${suffix}`}, ${businessId}, 'CONNECTED'::"WhatsAppConnectionStatus", ${`f8exp_phone_${suffix}`}, 'f8exp-token', clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${configId}, ${businessId}, 'deterministic-options', 'F8 expiry', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${deploymentId}, ${businessId}, ${configId}, 1, 1, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, ${`54911${suffix.slice(0, 8)}`}, ${businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt") VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'UTC', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${businessId}, 'Cliente F8', ${`54911${suffix.slice(0, 8)}`}, ${`54911${suffix.slice(0, 8)}`})`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${professionalId}, ${businessId}, 'Profesional F8')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "depositMode") VALUES (${serviceId}, ${businessId}, 'Servicio F8', 30, 'FIXED'::"ServiceDepositMode")`)
}

async function seedHold(name: string, depositStatus = 'PENDING_PROOF') {
  const visitId = `f8exp_visit_${name}_${suffix}`
  const appointmentId = `f8exp_appointment_${name}_${suffix}`
  const depositId = `f8exp_deposit_${name}_${suffix}`
  const jobId = `f8exp_job_${name}_${suffix}`
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${businessId}, ${customerId}, ${professionalId}, ${sessionId}, 'HELD'::"BookingVisitStatus", clock_timestamp() + interval '1 day', 30, clock_timestamp() - interval '1 second', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${customerId}, ${professionalId}, ${serviceId}, clock_timestamp() + interval '1 day', 30, 'PENDING'::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${serviceId}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, ${conversationId}, ${visitId}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, ${depositStatus}::"BookingDepositStatus", clock_timestamp() - interval '1 second', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount") VALUES (${randomUUID()}, ${businessId}, ${depositId}, ${serviceId}, 0, 'Servicio F8', 'FIXED'::"ServiceDepositMode", 100, NULL, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    // F8.5 adds a deferred invariant: a sealed PROOF_RECEIVED root must have
    // retained append-only evidence. This fixture models a proof winner
    // without using the writer, because this is an expiry-specific contract.
    if (depositStatus === 'PROOF_RECEIVED') {
      const bytes = Buffer.from(`f8-expiry-proof-${name}`)
      const hash = createHash('sha256').update(bytes).digest('hex')
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${randomUUID()}, ${businessId}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f8-expiry-fixture', clock_timestamp(), clock_timestamp(), ${bytes}, 'image/png', 'proof.png', ${bytes.length}, ${hash}, ${bytes}, 'image/webp', ${bytes.length}, ${hash}, clock_timestamp() + interval '12 months')`)
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "updatedAt") VALUES (${jobId}, 'EXPIRE_DEPOSIT', ${depositId}, ${businessId}, ${deploymentId}, 1, clock_timestamp(), clock_timestamp())`)
  })
  return { visitId, appointmentId, depositId, jobId }
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositExpiryAudit" WHERE "businessId" = ${businessId}`).catch(() => undefined)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "visitId" IN (SELECT "id" FROM "BookingVisit" WHERE "businessId" = ${businessId})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${professionalId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${serviceId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${customerId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${sessionId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${conversationId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${deploymentId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessWhatsAppConfig" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${configId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  }).catch(() => undefined)
}
