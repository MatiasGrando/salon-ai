import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

// Deliberately isolated: run only after the two F8 proof migrations and a
// regenerated client are authorised on this exact local test target.
const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 proof-writer contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, writer, validator, worker, expiry, notifications] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/deposit-proof-writer.js'),
  import('../src/services/deposit-proof-image-validation.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/expire-deposit-hold.js'),
  import('../src/services/deposit-notification-outbox.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `f85_b_${suffix}`, config: `f85_cfg_${suffix}`, deployment: `f85_dep_${suffix}`,
  conversation: `f85_conv_${suffix}`, session: `f85_session_${suffix}`, customer: `f85_customer_${suffix}`,
  professional: `f85_prof_${suffix}`, service: `f85_service_${suffix}`
}
// Isolated contracts deliberately exercise row-lock fencing and multi-row
// cleanup; do not change production transaction defaults for test scheduling.

try {
  await seedBase()
  const evidence = await validatedEvidence('#135')
  const active = await seedHold('active', false)
  const first = await writer.writeValidatedDepositProof(prisma, proofInput(active.depositId, 'op-active', 'event-active', evidence))
  assert.deepEqual({ outcome: first.outcome, kind: first.kind }, { outcome: 'APPLIED', kind: 'INITIAL' })
  const applied = await state(active.depositId, active.visitId, active.appointmentId, active.jobId)
  assert.deepEqual(applied, { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', proofs: 1n, operations: 1n, job: 'DONE' })
  assert.equal(await countRecovery(notifications.encodeDirectNotificationRecovery({ kind: 'PROOF_RECEIVED', depositId: active.depositId, sourceId: first.proofId })), 1n,
    'proof commit without a connected route retains exact PROOF_RECEIVED recovery')
  const replay = await writer.writeValidatedDepositProof(prisma, proofInput(active.depositId, 'op-active', 'event-active', evidence))
  assert.equal(replay.outcome, 'REPLAYED', 'same operation/provider/hash must not append a second proof')
  const hashReplay = await writer.writeValidatedDepositProof(prisma, proofInput(active.depositId, 'op-active-same-hash', 'event-active-other', evidence))
  assert.equal(hashReplay.outcome, 'REPLAYED', 'the same source hash under a different provider event remains one immutable proof')
  assert.equal((await state(active.depositId, active.visitId, active.appointmentId, active.jobId)).proofs, 1n)

  const collision = await seedHold('collision', false)
  await writer.writeValidatedDepositProof(prisma, proofInput(collision.depositId, 'op-collision-1', 'event-collision', evidence))
  await assert.rejects(
    writer.writeValidatedDepositProof(prisma, proofInput(collision.depositId, 'op-collision-2', 'event-collision', await validatedEvidence('#246'))),
    /reused with different evidence/i,
    'a provider identity cannot be rebound to other bytes'
  )

  // A worker may already own the job row before it waits for the agenda lock.
  // The proof writer must not invert that lock order; it leaves the lease
  // fenced by aggregate state, and the worker becomes INELIGIBLE on resume.
  const fenced = await seedHold('fenced', false)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour' WHERE "businessId" = ${ids.business} AND "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
  const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(claimed?.id, fenced.jobId)
  assert.ok(claimed)
  await writer.writeValidatedDepositProof(prisma, proofInput(fenced.depositId, 'op-fenced', 'event-fenced', evidence))
  assert.equal(await expiry.expireDepositHold(prisma, claimed), 'INELIGIBLE')
  assert.deepEqual(await state(fenced.depositId, fenced.visitId, fenced.appointmentId, fenced.jobId), { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', proofs: 1n, operations: 1n, job: 'DONE' }, 'a claimed expiry is fenced by the proof state rather than deadlocking the writer')

  const late = await seedHold('late', true)
  const lateResult = await writer.writeValidatedDepositProof(prisma, proofInput(late.depositId, 'op-late', 'event-late', evidence))
  assert.deepEqual({ outcome: lateResult.outcome, kind: lateResult.kind }, { outcome: 'APPLIED', kind: 'LATE' })
  assert.deepEqual(await state(late.depositId, late.visitId, late.appointmentId, late.jobId), { deposit: 'EXPIRED', visit: 'EXPIRED', appointment: 'CANCELLED', proofs: 1n, operations: 1n, job: 'READY' }, 'late evidence is retained and never reopens the aggregate')
  assert.equal(await countRecovery(notifications.encodeDirectNotificationRecovery({ kind: 'LATE_PROOF', depositId: late.depositId, sourceId: lateResult.proofId })), 1n,
    'late evidence commit retains exact LATE_PROOF recovery without reopening')

  const rollback = await seedHold('rollback', false)
  const outboxBeforeRollback = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotOutbox" WHERE "businessId" = ${ids.business}`).then((rows) => rows[0]!.count)
  await assert.rejects(prisma.$transaction(async (tx) => {
    await writer.writeValidatedDepositProofInTransaction(tx, proofInput(rollback.depositId, 'op-rollback', 'event-rollback', evidence))
    throw new Error('test rollback')
  }), /test rollback/)
  assert.deepEqual(await state(rollback.depositId, rollback.visitId, rollback.appointmentId, rollback.jobId), { deposit: 'PENDING_PROOF', visit: 'HELD', appointment: 'PENDING', proofs: 0n, operations: 0n, job: 'READY' }, 'proof, state, operation and expiry neutralization roll back together')
  assert.equal(await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotOutbox" WHERE "businessId" = ${ids.business}`).then((rows) => rows[0]!.count), outboxBeforeRollback, 'notification outbox must roll back with the proof transition')

  await assert.rejects(
    writer.writeValidatedDepositProof(prisma, proofInput(active.depositId, 'op-cross-tenant', 'event-cross', evidence, `${ids.business}_other`)),
    /not found in tenant/i,
    'tenant-scoped lookup must not write a foreign aggregate'
  )
  console.log('OK F8.5 PG: replay, provider/hash collision, late non-reopen, transaction rollback, tenant isolation and expiry neutralization/fencing contract.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

function proofInput(depositId: string, operationKey: string, providerEventId: string, evidence: Awaited<ReturnType<typeof validatedEvidence>>, businessId = ids.business) {
  return { businessId, depositId, operationKey, providerEventId, providerMessageId: `message-${providerEventId}`, providerMediaId: `media-${providerEventId}`, evidence }
}

async function validatedEvidence(color: string) {
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer()
  return validator.validateDepositProofImage({ data, declaredMimeType: 'image/png', filename: 'proof.png' })
}

async function seedBase() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.business}, ${`F85-${suffix}`}, 'F8.5 proof writer')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${ids.business}, 'deterministic-options', 'F8.5', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${ids.deployment}, ${ids.business}, ${ids.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${ids.conversation}, ${`54911${suffix.slice(0, 8)}`}, ${ids.business}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt") VALUES (${ids.session}, ${ids.business}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${ids.customer}, ${ids.business}, 'Cliente F8.5', ${`54912${suffix.slice(0, 8)}`}, ${`54912${suffix.slice(0, 8)}`})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${ids.business}, 'Profesional F8.5')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "depositMode") VALUES (${ids.service}, ${ids.business}, 'Servicio F8.5', 30, 'FIXED'::"ServiceDepositMode")`)
  }, transactionOptions)
}

async function seedHold(name: string, expired: boolean) {
  const visitId = `f85_visit_${name}_${suffix}`, appointmentId = `f85_appointment_${name}_${suffix}`, depositId = `f85_deposit_${name}_${suffix}`, jobId = `f85_job_${name}_${suffix}`
  await prisma.$transaction(async (tx) => {
    const due = expired ? Prisma.sql`clock_timestamp() - interval '1 second'` : Prisma.sql`clock_timestamp() + interval '1 hour'`
    const depositStatus = expired ? 'EXPIRED' : 'PENDING_PROOF', visitStatus = expired ? 'EXPIRED' : 'HELD', appointmentStatus = expired ? 'CANCELLED' : 'PENDING'
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.session}, ${visitStatus}::"BookingVisitStatus", clock_timestamp() + interval '1 day', 30, ${due}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + interval '1 day', 30, ${appointmentStatus}::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "expiredAt", "expirationReason", "updatedAt") VALUES (${depositId}, ${ids.business}, ${appointmentId}, ${ids.conversation}, ${visitId}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, ${depositStatus}::"BookingDepositStatus", ${due}, 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", ${expired ? Prisma.sql`clock_timestamp()` : null}, ${expired ? 'HOLD_TTL_EXPIRED' : null}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount") VALUES (${randomUUID()}, ${ids.business}, ${depositId}, ${ids.service}, 0, 'Servicio F8.5', 'FIXED'::"ServiceDepositMode", 100, NULL, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "updatedAt") VALUES (${jobId}, 'EXPIRE_DEPOSIT', ${depositId}, ${ids.business}, ${ids.deployment}, 1, clock_timestamp(), clock_timestamp())`)
  }, transactionOptions)
  return { visitId, appointmentId, depositId, jobId }
}

async function state(depositId: string, visitId: string, appointmentId: string, jobId: string) {
  const rows = await prisma.$queryRaw<Array<{ deposit: string; visit: string; appointment: string; proofs: bigint; operations: bigint; job: string }>>(Prisma.sql`
    SELECT (SELECT "status"::text FROM "BookingDeposit" WHERE "id" = ${depositId}) AS "deposit", (SELECT "status"::text FROM "BookingVisit" WHERE "id" = ${visitId}) AS "visit", (SELECT "status"::text FROM "Appointment" WHERE "id" = ${appointmentId}) AS "appointment", (SELECT count(*) FROM "BookingDepositProof" WHERE "depositId" = ${depositId})::bigint AS "proofs", (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${ids.business} AND "resultRef" IN (SELECT "id" FROM "BookingDepositProof" WHERE "depositId" = ${depositId}))::bigint AS "operations", (SELECT "status"::text FROM "BotJob" WHERE "id" = ${jobId}) AS "job"
  `)
  return rows[0]!
}

async function countRecovery(aggregateId: string) {
  return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotJob"
    WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${aggregateId}
  `))[0]!.count
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "visitId" IN (SELECT "id" FROM "BookingVisit" WHERE "businessId" = ${ids.business})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${ids.service}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${ids.customer}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${ids.session}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${ids.conversation}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${ids.deployment}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${ids.config}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`)
  }, transactionOptions).catch(() => undefined)
}
