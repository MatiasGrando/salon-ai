import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 review contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, review, notifications, bridgeWorker, worker, sender, content] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/deposit-review-operation.js'),
  import('../src/services/deposit-notification-outbox.js'),
  import('../src/bot-options/application/bridge-deposit-notification-job.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/services/deposit-notification-content.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 10, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `f88_b_${suffix}`, config: `f88_cfg_${suffix}`, deployment: `f88_dep_${suffix}`,
  whatsapp: `f88_wa_${suffix}`,
  conversation: `f88_conv_${suffix}`, session: `f88_session_${suffix}`, customer: `f88_customer_${suffix}`,
  professional: `f88_prof_${suffix}`, service: `f88_service_${suffix}`, reviewerA: `f88_reviewer_a_${suffix}`, reviewerB: `f88_reviewer_b_${suffix}`
}

try {
  await seedBase()

  // Same key/payload must replay the durable decision, not create another
  // review side effect.
  const approval = await seedReviewable('approval', 60, true)
  const approveInput = reviewInput(approval.depositId, 'approve-replay', ids.reviewerA)
  const firstApproval = await review.approveCurrentDepositProof(prisma, approveInput)
  const replay = await review.approveCurrentDepositProof(prisma, approveInput)
  assert.equal(firstApproval.outcome, 'APPLIED')
  assert.deepEqual(replay, { outcome: 'REPLAYED', auditId: firstApproval.auditId })
  assert.deepEqual(await aggregate(approval), { deposit: 'APPROVED', visit: 'CONFIRMED', appointment: 'CONFIRMED', jobs: 1n, readyJobs: 1n, audits: 1n, outbox: 1n, operations: 1n })

  // A proof cannot be replaced or removed in normal operation. Exercise the
  // service's stale-proof gate inside the only transaction where the deferred
  // append-only delete check permits observing a missing current proof.
  const stale = await seedReviewable('stale')
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "id" = ${stale.proofId}`)
    await review.approveCurrentDepositProofInTransaction(tx, reviewInput(stale.depositId, 'approve-stale', ids.reviewerA))
  }), /no longer eligible for approval/i)
  assert.deepEqual(await aggregate(stale), { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', jobs: 1n, readyJobs: 1n, audits: 0n, outbox: 0n, operations: 0n })

  // Resubmission keeps the agenda hold pending, resets its expiry from the DB
  // clock using the sealed TTL, and retargets exactly the single unique job.
  const resubmission = await seedReviewable('resubmission', 37, true)
  const beforeResubmission = new Date()
  const resubmitted = await review.rejectCurrentDepositProof(prisma, rejectionInput(resubmission.depositId, 'resubmit', ids.reviewerA, 'RESUBMISSION_ALLOWED'))
  const resubmissionState = await aggregate(resubmission, true)
  assert.equal(resubmitted.outcome, 'APPLIED')
  assert.deepEqual(pickState(resubmissionState), { deposit: 'PENDING_RESUBMISSION', visit: 'HELD', appointment: 'PENDING', jobs: 1n, readyJobs: 1n, audits: 1n, outbox: 1n, operations: 1n })
  assert.ok(resubmissionState.expiresAt && resubmissionState.jobAvailableAt)
  assert.equal(resubmissionState.expiresAt.getTime(), resubmissionState.jobAvailableAt.getTime(), 'replacement job deadline must equal the aggregate deadline')
  assert.ok(resubmissionState.expiresAt.getTime() >= beforeResubmission.getTime() + 36 * 60_000, 'deadline is derived from DB review time, not caller time')
  assert.ok(resubmissionState.expiresAt.getTime() <= Date.now() + 38 * 60_000, 'sealed TTL is retained without an unbounded extension')

  // FINAL is terminal and leaves no runnable expiry work behind.
  const final = await seedReviewable('final')
  await review.rejectCurrentDepositProof(prisma, rejectionInput(final.depositId, 'final', ids.reviewerA, 'FINAL'))
  assert.deepEqual(await aggregate(final), { deposit: 'REJECTED', visit: 'CANCELLED', appointment: 'CANCELLED', jobs: 1n, readyJobs: 0n, audits: 1n, outbox: 1n, operations: 1n })

  // Every review kind must survive ROUTE_UNAVAILABLE through the durable bridge.
  // Refresh the one existing ACTIVE session; never manufacture a second route.
  await exerciseReviewRecovery('APPROVED')
  await exerciseReviewRecovery('FINAL_REJECTION')

  // Independent reviewers race distinct idempotency keys. Aggregate locks and
  // conditional state fences allow one decision, never a mixed terminal state.
  const raced = await seedReviewable('race')
  const race = await Promise.allSettled([
    review.approveCurrentDepositProof(prisma, reviewInput(raced.depositId, 'race-approve', ids.reviewerA)),
    review.rejectCurrentDepositProof(prisma, rejectionInput(raced.depositId, 'race-reject', ids.reviewerB, 'FINAL'))
  ])
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1, 'one reviewer must own the aggregate outcome')
  assert.equal(race.filter((result) => result.status === 'rejected').length, 1, 'the losing reviewer must fail closed')
  const raceState = await aggregate(raced)
  assert.ok(
    (raceState.deposit === 'APPROVED' && raceState.visit === 'CONFIRMED' && raceState.appointment === 'CONFIRMED') ||
    (raceState.deposit === 'REJECTED' && raceState.visit === 'CANCELLED' && raceState.appointment === 'CANCELLED'),
    `mixed reviewer state: ${raceState.deposit}/${raceState.visit}/${raceState.appointment}`
  )
  assert.equal(raceState.audits, 1n)
  assert.equal(raceState.operations, 1n)

  // Caller-owned transaction rollback must erase every decision side effect.
  const rolledBack = await seedReviewable('rollback')
  await assert.rejects(prisma.$transaction(async (tx) => {
    await review.approveCurrentDepositProofInTransaction(tx, reviewInput(rolledBack.depositId, 'rollback', ids.reviewerA))
    throw new Error('F8_REVIEW_ROLLBACK')
  }), /F8_REVIEW_ROLLBACK/)
  assert.deepEqual(await aggregate(rolledBack), { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', jobs: 1n, readyJobs: 1n, audits: 0n, outbox: 0n, operations: 0n })

  // Tenant binding happens before any reservation or audit write.
  const isolated = await seedReviewable('tenant')
  await assert.rejects(review.approveCurrentDepositProof(prisma, { ...reviewInput(isolated.depositId, 'foreign', ids.reviewerA), businessId: `${ids.business}_foreign` }), /aggregate is unavailable/i)
  assert.deepEqual(await aggregate(isolated), { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', jobs: 1n, readyJobs: 1n, audits: 0n, outbox: 0n, operations: 0n })

  // Late-proof handoff belongs to deposit-proof-writer, not either review
  // operation. It is intentionally covered by the proof-writer PG contract.
  console.log('OK F8.8 PG: review replay, stale-proof rejection, DB-time resubmission, final neutralization, reviewer race, rollback and tenant isolation.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

function reviewInput(depositId: string, operationKey: string, actorUserId: string) {
  return { businessId: ids.business, depositId, actorUserId, operationKey: `f88-${operationKey}-${suffix}`, method: 'POST', path: `/api/crm/deposits/${depositId}/approve` }
}

function rejectionInput(depositId: string, operationKey: string, actorUserId: string, mode: 'RESUBMISSION_ALLOWED' | 'FINAL') {
  return { ...reviewInput(depositId, operationKey, actorUserId), path: `/api/crm/deposits/${depositId}/reject`, rejection: { mode, reason: 'Comprobante ilegible' } }
}

async function seedBase() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.business}, ${`F88-${suffix}`}, 'F8.8 review contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "accessToken", "appSecret", "updatedAt") VALUES (${ids.whatsapp}, ${ids.business}, 'CONNECTED'::"WhatsAppConnectionStatus", ${`f88-phone-${suffix}`}, 'f88-test-token', 'f88-test-secret', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${ids.business}, 'deterministic-options', 'F8.8', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${ids.deployment}, ${ids.business}, ${ids.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${ids.conversation}, ${`54911${suffix.slice(0, 8)}`}, ${ids.business}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt") VALUES (${ids.session}, ${ids.business}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${ids.customer}, ${ids.business}, 'Cliente F8.8', ${`54912${suffix.slice(0, 8)}`}, ${`54912${suffix.slice(0, 8)}`})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${ids.business}, 'Profesional F8.8')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "depositMode") VALUES (${ids.service}, ${ids.business}, 'Servicio F8.8', 30, 'FIXED'::"ServiceDepositMode")`)
  })
}

async function seedReviewable(name: string, ttlMinutes = 60, deadlinesExpired = false) {
  const visitId = `f88_visit_${name}_${suffix}`, appointmentId = `f88_appointment_${name}_${suffix}`, depositId = `f88_deposit_${name}_${suffix}`, jobId = `f88_job_${name}_${suffix}`, proofId = randomUUID()
  const bytes = Buffer.from(`f8.8-proof-${name}`), hash = createHash('sha256').update(bytes).digest('hex')
  const deadline = deadlinesExpired ? Prisma.sql`clock_timestamp() - interval '1 minute'` : Prisma.sql`clock_timestamp() + interval '1 hour'`
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.session}, 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus", clock_timestamp() + interval '1 day', 30, ${deadline}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + interval '1 day', 30, 'PENDING'::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${depositId}, ${ids.business}, ${appointmentId}, ${ids.conversation}, ${visitId}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'PROOF_RECEIVED'::"BookingDepositStatus", ${deadline}, ${ttlMinutes}, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount") VALUES (${randomUUID()}, ${ids.business}, ${depositId}, ${ids.service}, 0, 'Servicio F8.8', 'FIXED'::"ServiceDepositMode", 100, NULL, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${proofId}, ${ids.business}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f8.8-contract', clock_timestamp(), clock_timestamp(), ${bytes}, 'image/png', 'proof.png', ${bytes.length}, ${hash}, ${bytes}, 'image/webp', ${bytes.length}, ${hash}, clock_timestamp() + interval '12 months')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "updatedAt") VALUES (${jobId}, 'EXPIRE_DEPOSIT', ${depositId}, ${ids.business}, ${ids.deployment}, 1, clock_timestamp() + interval '1 hour', clock_timestamp())`)
  })
  return { visitId, appointmentId, depositId, jobId, proofId }
}

async function aggregate(ref: { visitId: string; appointmentId: string; depositId: string }, deadlines = false) {
  const rows = await prisma.$queryRaw<Array<{ deposit: string; visit: string; appointment: string; jobs: bigint; readyJobs: bigint; audits: bigint; outbox: bigint; operations: bigint; expiresAt: Date | null; jobAvailableAt: Date | null }>>(Prisma.sql`
    SELECT (SELECT "status"::text FROM "BookingDeposit" WHERE "id" = ${ref.depositId}) AS "deposit", (SELECT "status"::text FROM "BookingVisit" WHERE "id" = ${ref.visitId}) AS "visit", (SELECT "status"::text FROM "Appointment" WHERE "id" = ${ref.appointmentId}) AS "appointment",
      (SELECT count(*) FROM "BotJob" WHERE "aggregateId" = ${ref.depositId} AND "kind" = 'EXPIRE_DEPOSIT')::bigint AS "jobs", (SELECT count(*) FROM "BotJob" WHERE "aggregateId" = ${ref.depositId} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus"))::bigint AS "readyJobs",
      (SELECT count(*) FROM "BookingDepositReviewAudit" WHERE "depositId" = ${ref.depositId})::bigint AS "audits", (SELECT count(*) FROM "BookingDepositReviewOutbox" WHERE "depositId" = ${ref.depositId})::bigint AS "outbox", (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${ids.business} AND "sessionId" = ${ids.session} AND "resultRef" IN (SELECT "id" FROM "BookingDepositReviewAudit" WHERE "depositId" = ${ref.depositId}))::bigint AS "operations",
      (SELECT "expiresAt" FROM "BookingDeposit" WHERE "id" = ${ref.depositId}) AS "expiresAt", (SELECT "availableAt" FROM "BotJob" WHERE "aggregateId" = ${ref.depositId} AND "kind" = 'EXPIRE_DEPOSIT') AS "jobAvailableAt"
  `)
  return deadlines ? rows[0]! : pickState(rows[0]!)
}

async function exerciseReviewRecovery(kind: 'APPROVED' | 'FINAL_REJECTION') {
  const name = `recovery_${kind.toLowerCase()}`
  const ref = await seedReviewable(name)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotSession" SET "deploymentGeneration" = 0, "updatedAt" = clock_timestamp()
    WHERE "id" = ${ids.session} AND "status" = 'ACTIVE'::"BotSessionStatus"
  `)
  const decision = kind === 'APPROVED'
    ? await review.approveCurrentDepositProof(prisma, reviewInput(ref.depositId, `${name}-decision`, ids.reviewerA))
    : await review.rejectCurrentDepositProof(prisma, rejectionInput(ref.depositId, `${name}-decision`, ids.reviewerA, 'FINAL'))
  const reviewOutbox = (await prisma.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status" FROM "BookingDepositReviewOutbox" WHERE "auditId" = ${decision.auditId}
  `))[0]!
  assert.equal(reviewOutbox.status, 'PENDING_CONTENT')
  const bridgeJob = (await prisma.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status" FROM "BotJob"
    WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${reviewOutbox.id}
  `))[0]!
  assert.equal(bridgeJob.status, 'READY', `${kind} must retain durable recovery work`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour' WHERE "businessId" = ${ids.business} AND "id" <> ${bridgeJob.id} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${bridgeJob.id}`)
  const unavailableClaim = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(unavailableClaim?.id, bridgeJob.id)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, unavailableClaim!), 'ROUTE_UNAVAILABLE')
  assert.deepEqual((await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`SELECT "status"::text AS "status", "attempts" FROM "BotJob" WHERE "id" = ${bridgeJob.id}`))[0], { status: 'READY', attempts: 0 })
  assert.equal((await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS "status" FROM "BookingDepositReviewOutbox" WHERE "id" = ${reviewOutbox.id}`))[0]?.status, 'PENDING_CONTENT')
  const activeSessions = (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotSession"
    WHERE "businessId" = ${ids.business} AND "conversationId" = ${ids.conversation}
      AND "status" = 'ACTIVE'::"BotSessionStatus"
  `))[0]!.count
  assert.equal(activeSessions, 1n, 'recovery must refresh, never duplicate, the active session')
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotSession" SET "deploymentGeneration" = 1, "updatedAt" = clock_timestamp()
    WHERE "id" = ${ids.session} AND "status" = 'ACTIVE'::"BotSessionStatus"
  `)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour' WHERE "businessId" = ${ids.business} AND "id" <> ${bridgeJob.id} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${bridgeJob.id}`)
  const claim = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(claim?.id, bridgeJob.id)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, claim!), 'COMPLETED')
  const key = `deposit-notification:${kind}:${reviewOutbox.id}`
  const recovered = (await prisma.$queryRaw<Array<{ id: string; count: bigint; payload: unknown }>>(Prisma.sql`
    SELECT min("id") AS "id", count(*)::bigint AS "count", min("payload"::text)::jsonb AS "payload"
    FROM "BotOutbox" WHERE "idempotencyKey" = ${key}
  `))[0]!
  assert.equal(recovered.count, 1n)
  assert.equal((recovered.payload as { item: { body: string } }).item.body, content.DEPOSIT_NOTIFICATION_TEXT[kind])
  await prisma.$transaction(async (tx) => {
    assert.equal(await notifications.bridgeDepositReviewOutboxTx(tx, { businessId: ids.business, reviewOutboxId: reviewOutbox.id }), 'REPLAYED')
  })
  assert.equal((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotOutbox" WHERE "idempotencyKey" = ${key}`))[0]!.count, 1n)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus"
    WHERE "businessId" = ${ids.business} AND "idempotencyKey" <> ${key}
      AND "status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
  `)
  const senderClaim = await sender.claimOutbox(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(senderClaim?.id, recovered.id, `${kind} recovery must be sender-claimable`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus", "leaseToken" = NULL, "leasedUntil" = NULL WHERE "id" = ${recovered.id}`)
}

function pickState(state: Awaited<ReturnType<typeof aggregate>>) {
  const { deposit, visit, appointment, jobs, readyJobs, audits, outbox, operations } = state
  return { deposit, visit, appointment, jobs, readyJobs, audits, outbox, operations }
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "StaffAuditLog" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositReviewOutbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositReviewAudit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLateProofHandoff" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" WHERE "appointmentId" IN (SELECT a."id" FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE v."businessId" = ${ids.business})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "visitId" IN (SELECT "id" FROM "BookingVisit" WHERE "businessId" = ${ids.business})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${ids.service}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${ids.customer}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${ids.session}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${ids.conversation}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${ids.deployment}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessWhatsAppConfig" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${ids.config}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`)
  }).catch(() => undefined)
}
