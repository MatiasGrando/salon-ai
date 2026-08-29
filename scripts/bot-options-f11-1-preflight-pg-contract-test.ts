import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF11PgContractDatabase } from './f11-pg-contract-database.js'
import type { DispatchPauseHandle } from '../src/bot-options/infrastructure/prisma-activation.js'

const connectionString = resolveF11PgContractDatabase('F11.1 activation preflight contract')
const [{ createPrismaClient }, { Prisma }, activation, dispatch] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/activation-operations.js'),
  import('../src/bot-options/infrastructure/dispatch-claims.js')
])
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const id = (name: string) => `f111_${name}_${suffix}`
const businessId = id('business')
const deploymentId = id('deployment')
const configurationId = id('configuration')
const actorId = 'f11-1-contract'

try {
  await seedBase()
  await assertCleanPreflightKeepsPauseAndPermitsDraft()
  await assertProtectedCategoriesBlock()
  await assertUnknownBlocksAndAdmissionCannotCrossPause()
  await assertFinancialStatesAndConfirmedWithoutProcess()
  console.log('OK F11.1 PG: exclusive preflight pauses dispatch, drains claims, permits disposable drafts and confirmed/approved records without active process, blocks inbox/jobs/outbox/holds/deposits/handoffs and UNKNOWN, fences concurrent dispatch claims, and recovers an interrupted pause handle.')
} finally {
  await prisma.$disconnect()
}

async function seedBase() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${businessId},${id('customer')},'F11.1 contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${configurationId},${businessId},'deterministic-options','F11.1','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${deploymentId},${businessId},'deterministic-options',${configurationId},1,clock_timestamp())`)
  })
}

async function begin() {
  return activation.preflightExclusiveActivation({ client: prisma, businessId, expectedGeneration: 0, actorId, legacyCoverageComplete: true, timeoutMs: 0 })
}
async function abort(result: { handle: DispatchPauseHandle }) {
  await activation.abortExclusiveActivationPreflight({ client: prisma, handle: result.handle, actorId })
}
async function clearRuntimeRows() {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId"=${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId"=${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId"=${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId"=${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotHandoff" WHERE "businessId"=${businessId}`)
}
async function insertSession(tag: string, booking = 'NONE') {
  const sessionId = id(`session_${tag}`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","deploymentId","deploymentGeneration","businessTimezone","state","status","updatedAt") VALUES (${sessionId},${businessId},${deploymentId},0,'UTC',${JSON.stringify({ schemaVersion: 1, flow: 'MAIN_MENU', booking, deposit: 'NONE', handoff: 'NONE', cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, slotStartAt: null, date: null, appointmentId: null }, invalidStreak: 0, presentation: { kind: 'plain' }, discardReturnFlow: null, handoffReturnFlow: null, catalogMode: 'BOOKING', nameCandidate: null, pendingEntityRef: null, rejectedRecommendationIds: [] })}::jsonb,'ACTIVE'::"BotSessionStatus",clock_timestamp())`)
  return sessionId
}

async function assertCleanPreflightKeepsPauseAndPermitsDraft() {
  const sessionId = await insertSession('draft', 'DRAFT')
  const result = await begin()
  assert.equal(result.kind, 'CLEAN')
  assert.deepEqual(result.snapshot.drafts.map((entry: { id: string }) => entry.id), [sessionId])
  const paused = await prisma.$queryRaw<Array<{ paused: Date | null }>>(Prisma.sql`SELECT "claimsPausedAt" AS "paused" FROM "BotChannelDeployment" WHERE "id"=${deploymentId}`)
  assert.ok(paused[0]?.paused, 'clean preflight must retain the fence for F11.2')
  assert.deepEqual(await activation.recoverExclusiveActivationPreflight({ client: prisma, businessId, expectedGeneration: 0 }), result.handle, 'a crash can recover the durable paused handle without parsing audit JSON')
  assert.equal(await dispatch.acquireDispatchClaim({
    client: prisma, businessId, sessionId: null, generation: 0, fenceEpoch: result.handle.fenceEpoch, kind: 'SEND'
  }), null, 'a sender/admission dispatch claim cannot cross a clean paused preflight')
  const audit = await prisma.$queryRaw<Array<{ detail: { outcome: string; counts: { drafts: string } } }>>(Prisma.sql`
    SELECT "detail" FROM "BotDeploymentAudit" WHERE "businessId"=${businessId} AND "action"='ACTIVATION_PREFLIGHT' ORDER BY "createdAt" DESC LIMIT 1
  `)
  assert.deepEqual(audit[0]?.detail, { outcome: 'CLEAN', counts: { drafts: '1', legacyDrafts: '0', legacyProtected: '0', inbox: '0', jobs: '0', outbox: '0', holds: '0', deposits: '0', handoffs: '0', unknown: '0' }, fenceEpoch: result.handle.fenceEpoch })
  await abort(result)
  await clearRuntimeRows()
}

async function assertProtectedCategoriesBlock() {
  const sessionId = await insertSession('protected')
  const jobId = id('job')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","updatedAt") VALUES (${jobId},'PROCESS_INBOX',${id('aggregate')},${businessId},${deploymentId},0,clock_timestamp())`)
  const jobResult = await begin()
  assert.equal(jobResult.kind, 'BLOCKED'); assert.equal(jobResult.reason, 'PROTECTED_STATE'); assert.equal(jobResult.snapshot.jobs[0]?.id, jobId)
  await abort(jobResult); await clearRuntimeRows()

  const inboxId = id('inbox')
  const eventId = id('event')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","eventKey","eventType","businessId","status") VALUES (${eventId},${id('event-key')},'MESSAGE'::"BotProviderEventType",${businessId},'ADMITTED'::"BotProviderEventStatus")`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","deploymentId","deploymentGeneration","status") VALUES (${inboxId},${businessId},${eventId},${deploymentId},0,'ADMITTED'::"BotInboxStatus")`)
  const inboxResult = await begin()
  assert.equal(inboxResult.kind, 'BLOCKED'); assert.equal(inboxResult.snapshot.inbox[0]?.id, inboxId)
  await abort(inboxResult); await clearRuntimeRows()

  const outboxId = id('outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","updatedAt") VALUES (${outboxId},${businessId},${sessionId},${id('transition')},${id('group')},0,'informative_text','{}'::jsonb,${id('idempotency')},clock_timestamp())`)
  const outboxResult = await begin()
  assert.equal(outboxResult.kind, 'BLOCKED'); assert.equal(outboxResult.snapshot.outbox[0]?.id, outboxId)
  await abort(outboxResult); await clearRuntimeRows()

  const handoffId = id('handoff')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","status","reason","updatedAt") VALUES (${handoffId},${businessId},${sessionId},'QUEUED'::"BotHandoffStatus",'contract',clock_timestamp())`)
  const handoffResult = await begin()
  assert.equal(handoffResult.kind, 'BLOCKED'); assert.equal(handoffResult.snapshot.handoffs[0]?.id, handoffId)
  await abort(handoffResult); await clearRuntimeRows()

  const legacyId = id('legacy-handoff')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","currentStep") VALUES (${legacyId},${businessId},${id('legacy-phone')},'HUMAN_HANDOFF'::"ConversationStep")`)
  const legacyResult = await begin()
  assert.equal(legacyResult.kind, 'BLOCKED'); assert.equal(legacyResult.snapshot.legacyProtected[0]?.id, legacyId)
  await abort(legacyResult)
  await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "currentStep"='COMPLETED'::"ConversationStep" WHERE "id"=${legacyId}`)
}

async function assertUnknownBlocksAndAdmissionCannotCrossPause() {
  const unknownId = id('unknown')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotDispatchClaim" ("id","businessId","engineKey","generation","fenceEpoch","kind","status","claimToken","claimedUntil","updatedAt") VALUES (${unknownId},${businessId},'deterministic-options',0,0,'SEND'::"BotDispatchKind",'UNKNOWN'::"BotDispatchStatus",${id('token')},clock_timestamp()+interval '1 minute',clock_timestamp())`)
  const result = await begin()
  assert.equal(result.kind, 'BLOCKED'); assert.equal(result.reason, 'UNKNOWN'); assert.equal(result.snapshot.unknown[0]?.id, unknownId)
  const admitted = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotChannelDeployment" WHERE "id"=${deploymentId} AND "claimsPausedAt" IS NULL`)
  assert.equal(admitted[0]?.count, 0n, 'new admission/claims cannot pass the closed gate')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotDispatchClaim" SET "status"='DONE'::"BotDispatchStatus" WHERE "id"=${unknownId}`)
  await abort(result)
  await clearRuntimeRows()
}

async function assertFinancialStatesAndConfirmedWithoutProcess() {
  const sessionId = await insertSession('financial')
  const customerId = id('customer-financial')
  const professionalId = id('professional-financial')
  const serviceId = id('service-financial')
  const appointmentId = id('appointment-financial')
  const visitId = id('visit-financial')
  const depositId = id('deposit-financial')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id","businessId","name","phone") VALUES (${customerId},${businessId},'F11.1 customer',${id('phone')})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id","businessId","name") VALUES (${professionalId},${businessId},'F11.1 professional')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id","businessId","name","duration") VALUES (${serviceId},${businessId},'F11.1 service',30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id","businessId","customerId","professionalId","sessionId","status","scheduledStartAt","totalDurationMinutes","holdExpiresAt","updatedAt") VALUES (${visitId},${businessId},${customerId},${professionalId},${sessionId},'HELD'::"BookingVisitStatus",clock_timestamp()+interval '1 day',30,clock_timestamp()+interval '1 hour',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id","customerId","professionalId","serviceId","visitId","startAt","totalDurationMinutes","status") VALUES (${appointmentId},${customerId},${professionalId},${serviceId},${visitId},clock_timestamp()+interval '1 day',30,'PENDING'::"AppointmentStatus")`)
  })
  const holdResult = await begin()
  assert.equal(holdResult.kind, 'BLOCKED'); assert.equal(holdResult.snapshot.holds[0]?.id, visitId)
  await abort(holdResult)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status"='CONFIRMED'::"BookingVisitStatus","holdExpiresAt"=NULL WHERE "id"=${visitId}`)
  const confirmedResult = await begin()
  assert.equal(confirmedResult.kind, 'CLEAN', 'a confirmed visit without active process must not block cutover')
  await abort(confirmedResult)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id","businessId","appointmentId","visitId","mode","configuredValue","amount","status","expiresAt","updatedAt") VALUES (${depositId},${businessId},${appointmentId},${visitId},'FIXED'::"ServiceDepositMode",1,1,'PENDING_PROOF'::"BookingDepositStatus",clock_timestamp()+interval '1 hour',clock_timestamp())`)
  const depositResult = await begin()
  assert.equal(depositResult.kind, 'BLOCKED'); assert.equal(depositResult.snapshot.deposits[0]?.id, depositId)
  await abort(depositResult)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "status"='APPROVED'::"BookingDepositStatus" WHERE "id"=${depositId}`)
  // A completed normal legacy journal is audit/idempotency evidence, not an
  // unresolved paused receipt. It must not turn every future F11 preflight
  // into protected state.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "LegacyWhatsAppCutoverInbound" (
      "id","receiptKey","businessId","deploymentId","deploymentGeneration","dispatchFenceEpoch",
      "providerMessageId","fromPhone","payload","status","updatedAt"
    ) VALUES (
      ${id('normal-terminal')},${id('normal-terminal-key')},${businessId},${deploymentId},0,0,
      ${id('normal-terminal-provider')},${id('normal-terminal-phone')},'{"version":1,"text":"terminal"}'::jsonb,
      'NORMAL_DONE'::"LegacyWhatsAppCutoverInboundStatus",clock_timestamp()
    )
  `)
  const approvedResult = await begin()
  assert.equal(approvedResult.kind, 'CLEAN', 'an approved deposit without active process must not block cutover')
  assert.equal(approvedResult.snapshot.counts.legacyProtected, 0n, 'terminal normal legacy journals are not paused F11 protected state')
  await abort(approvedResult)
}
