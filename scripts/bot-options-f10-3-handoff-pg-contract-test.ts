import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

const connectionString = resolveF10PgContractDatabase('F10.3 handoff silence contract')
const [{ createPrismaClient }, { Prisma }, handoff, admission, worker, sender, processor, proofProcessor, state] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/handoff-operations.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/application/process-deposit-proof-job.js'),
  import('../src/bot-options/domain/state.js')
])
const prisma = createPrismaClient({ connectionString, max: 6, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `f103_b_${suffix}`, config: `f103_c_${suffix}`, deployment: `f103_d_${suffix}`,
  conversation: `f103_v_${suffix}`, session: `f103_s_${suffix}`, handoff: `f103_h_${suffix}`,
  phone: `54911${suffix.slice(0, 8)}`
}
const key = (value: string) => `f103_${value}_${suffix}`

try {
  await seedTakenHandoff()
  await assertClaimedInitialInboxSilencesAfterTake()
  await assertTakeWaitsForLeasedWorkerAndClaimedSender()
  await assertInboundIsVisibleToCrmWithoutAutomation()
  await assertProofJobIsSilentAfterTake()
  await assertHumanTakenJobsCannotBeClaimed()
  await assertHumanTakenOutboxCannotBeClaimed()
  console.log('OK F10.3 PG: HUMAN_TAKEN persists inbound for CRM and blocks worker/sender claims.')
} finally {
  await prisma.$disconnect()
}

async function seedTakenHandoff() {
  const initial = state.createInitialBotOptionsState()
  const queued = { ...initial, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED' }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${ids.business},${key('customer')},'F10.3 contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","updatedAt") VALUES (${ids.business},'UTC',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${ids.config},${ids.business},'deterministic-options','F10.3','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${ids.deployment},${ids.business},'deterministic-options',${ids.config},1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${ids.conversation},${ids.business},${ids.phone},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${ids.session},${ids.business},${ids.conversation},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${ids.handoff},${ids.business},${ids.session},'contract',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","status") VALUES (${key('prompt')},${ids.session},${key('prompt-token')},0,'OPEN'::"BotPromptStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","status") VALUES (${key('selected-event')},'WHATSAPP',${key('selected-event-key')},'MESSAGE'::"BotProviderEventType",${ids.business},'ADMITTED'::"BotProviderEventStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","sessionId","promptId","deploymentId","deploymentGeneration","actionType","status") VALUES (${key('selected-inbox')},${ids.business},${key('selected-event')},${ids.session},${key('prompt')},${ids.deployment},0,'menu.main','SELECTED'::"BotInboxStatus")`)
    for (const [kind, aggregateId] of [['PROCESS_SESSION', key('selected-inbox')], ['RECONCILE_PROMPT', key('prompt')]] as const) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","updatedAt") VALUES (${key(`job-${kind}`)},${kind},${aggregateId},${ids.business},${ids.deployment},0,'READY'::"BotJobStatus",clock_timestamp())`)
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${key('outbox')},${ids.business},${ids.session},'f103-transition',${key('group')},0,'TEXT','{}'::jsonb,${key('outbox-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  })
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: ids.conversation, actorUserId: key('owner'), operationKey: key('take') })
}

async function assertInboundIsVisibleToCrmWithoutAutomation() {
  const repository = new admission.PrismaAuthoritativeAdmissionRepository(prisma, { authoritativeTransactionTimeoutMs: 30_000 })
  const messageId = key('provider-message')
  await repository.admitAuthoritative({
    route: { kind: 'new', businessId: ids.business, deploymentId: ids.deployment, generation: 0, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    phoneNumberId: key('phone-number'),
    events: [{ kind: 'message', eventKey: messageId, providerMessageId: messageId, phoneNumberId: key('phone-number'), displayPhoneNumber: null, fromPhone: ids.phone, textBody: 'Necesito hablar con una persona', messageType: 'text', interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null }]
  })
  const rows = await prisma.$queryRaw<Array<{ body: string; inboxStatus: string; inboxError: string; automationJobs: bigint; eventStatus: string }>>(Prisma.sql`
    SELECT m."body", i."status"::text AS "inboxStatus", i."error" AS "inboxError", e."status"::text AS "eventStatus",
      (SELECT count(*)::bigint FROM "BotJob" WHERE "aggregateId" = i."id") AS "automationJobs"
    FROM "Message" m JOIN "BotActionInbox" i ON i."providerMessageId"=m."providerMessageId"
    JOIN "BotProviderEvent" e ON e."id"=i."providerEventId"
    WHERE m."conversationId"=${ids.conversation} AND m."providerMessageId"=${messageId}
  `)
  assert.deepEqual(rows[0], { body: 'Necesito hablar con una persona', inboxStatus: 'PROCESSED', inboxError: 'HUMAN_TAKEN_SILENCED', eventStatus: 'PROCESSED', automationJobs: 0n })
}

async function assertTakeWaitsForLeasedWorkerAndClaimedSender() {
  const workerFixture = await seedQueuedSession('leased-worker')
  const eventId = key('leased-worker-event'), inboxId = key('leased-worker-inbox'), jobId = key('leased-worker-job')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","status") VALUES (${eventId},'WHATSAPP',${key('leased-worker-event-key')},'MESSAGE'::"BotProviderEventType",${ids.business},'ADMITTED'::"BotProviderEventStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","actionType","status") VALUES (${inboxId},${ids.business},${eventId},${workerFixture.sessionId},${ids.deployment},0,'menu.main','SELECTED'::"BotInboxStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","leaseToken","leasedUntil","updatedAt") VALUES (${jobId},'PROCESS_SESSION',${inboxId},${ids.business},${ids.deployment},0,'LEASED'::"BotJobStatus",${key('leased-worker-token')},clock_timestamp() + interval '1 minute',clock_timestamp())`)
  })
  await assert.rejects(() => handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: workerFixture.conversationId, actorUserId: key('owner'), operationKey: key('take-leased-worker'), drainMs: 0 }), /timed out/)
  await assertQueuedAndGateReopened(workerFixture.sessionId, workerFixture.handoffId)

  const senderFixture = await seedQueuedSession('claimed-sender')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","leaseToken","leasedUntil","maxAttempts","availableAt","updatedAt") VALUES (${key('claimed-sender-outbox')},${ids.business},${senderFixture.sessionId},'f103-claimed-transition',${key('claimed-sender-group')},0,'TEXT','{}'::jsonb,${key('claimed-sender-idempotency')},'CLAIMED'::"BotOutboxStatus",${key('claimed-sender-token')},clock_timestamp() + interval '1 minute',1,clock_timestamp(),clock_timestamp())`)
  await assert.rejects(() => handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: senderFixture.conversationId, actorUserId: key('owner'), operationKey: key('take-claimed-sender'), drainMs: 0 }), /timed out/)
  await assertQueuedAndGateReopened(senderFixture.sessionId, senderFixture.handoffId)

  const proof = await seedQueuedSession('leased-proof')
  const proofEventId = key('leased-proof-event'), proofJobId = key('leased-proof-job')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","payload","status") VALUES (${proofEventId},'WHATSAPP',${key('leased-proof-event-key')},'MESSAGE'::"BotProviderEventType",${ids.business},${JSON.stringify({ kind: 'message', fromPhone: proof.phone, messageType: 'image', mediaId: 'proof-media' })}::jsonb,'ADMITTED'::"BotProviderEventStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","leaseToken","leasedUntil","updatedAt") VALUES (${proofJobId},'RECEIVE_DEPOSIT_PROOF',${proofEventId},${ids.business},${ids.deployment},0,'LEASED'::"BotJobStatus",${key('leased-proof-token')},clock_timestamp() + interval '1 minute',clock_timestamp())`)
  })
  await assert.rejects(() => handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: proof.conversationId, actorUserId: key('owner'), operationKey: key('take-leased-proof'), drainMs: 0 }), /timed out/)
  await assertQueuedAndGateReopened(proof.sessionId, proof.handoffId)
}

async function assertClaimedInitialInboxSilencesAfterTake() {
  const fixture = await seedQueuedSession('claimed-initial')
  const repository = new admission.PrismaAuthoritativeAdmissionRepository(prisma, { authoritativeTransactionTimeoutMs: 30_000 })
  const messageId = key('claimed-initial-message')
  await repository.admitAuthoritative({
    route: { kind: 'new', businessId: ids.business, deploymentId: ids.deployment, generation: 0, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    phoneNumberId: key('phone-number'),
    events: [{ kind: 'message', eventKey: messageId, providerMessageId: messageId, phoneNumberId: key('phone-number'), displayPhoneNumber: null, fromPhone: fixture.phone, textBody: 'Mensaje en vuelo', messageType: 'text', interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null }]
  })
  const claimed = await worker.claimBotJob(prisma, 30_000, key('claimed-initial-token'), { businessId: ids.business })
  assert.equal(claimed?.kind, 'PROCESS_INBOX', 'the inbound is claimed before TAKE')
  assert.ok(claimed)
  // The pre-TAKE lease is part of handoffDrain.  Do not await TAKE first: it
  // must wait for this worker rather than time out because the lease is now
  // correctly correlated through ProviderEvent -> Conversation.
  const taking = handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: key('owner'), operationKey: key('take-claimed-initial') })
  const processing = processor.processSessionJob({ client: prisma, job: claimed })
  const [taken, processed] = await Promise.all([taking, processing])
  assert.equal(taken.status, 'TAKEN')
  assert.equal(processed, 'PROCESSED')
  const rows = await prisma.$queryRaw<Array<{ sessions: bigint; active: bigint; messages: bigint; inbox: string; inboxError: string | null; event: string; outbox: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*)::bigint FROM "BotSession" WHERE "conversationId"=${fixture.conversationId}) AS sessions,
      (SELECT count(*)::bigint FROM "BotSession" WHERE "conversationId"=${fixture.conversationId} AND "status"='ACTIVE'::"BotSessionStatus") AS active,
      (SELECT count(*)::bigint FROM "Message" WHERE "conversationId"=${fixture.conversationId} AND "providerMessageId"=${messageId}) AS messages,
      (SELECT "status"::text FROM "BotActionInbox" WHERE "providerMessageId"=${messageId}) AS inbox,
      (SELECT "error" FROM "BotActionInbox" WHERE "providerMessageId"=${messageId}) AS "inboxError",
      (SELECT "status"::text FROM "BotProviderEvent" WHERE "eventKey"=${messageId}) AS event,
      (SELECT count(*)::bigint FROM "BotOutbox" WHERE "sessionId"=${fixture.sessionId}) AS outbox
  `)
  const outcome = rows[0]
  const humanInboundPersisted = outcome?.messages === 1n && outcome.inbox === 'PROCESSED' && outcome.inboxError === 'HUMAN_TAKEN_SILENCED' && outcome.event === 'PROCESSED'
  const queuedSessionConsumed = outcome?.messages === 0n && outcome.inbox === 'PROCESSED' && outcome.inboxError === 'EXISTING_SESSION_INITIAL_SUPPRESSED' && outcome.event === 'ADMITTED'
  assert.ok(
    outcome?.sessions === 1n && outcome.active === 0n && outcome.outbox === 0n && (humanInboundPersisted || queuedSessionConsumed),
    'the winning serialization either persists the human-owned inbound for CRM or consumes it against the queued session; neither creates an ACTIVE session or automatic outbox'
  )

  const guarded = await seedQueuedSession('ready-initial')
  const guardedMessageId = key('ready-initial-message')
  await repository.admitAuthoritative({
    route: { kind: 'new', businessId: ids.business, deploymentId: ids.deployment, generation: 0, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    phoneNumberId: key('phone-number'),
    events: [{ kind: 'message', eventKey: guardedMessageId, providerMessageId: guardedMessageId, phoneNumberId: key('phone-number'), displayPhoneNumber: null, fromPhone: guarded.phone, textBody: 'Mensaje listo antes de TAKE', messageType: 'text', interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null }]
  })
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: guarded.conversationId, actorUserId: key('owner'), operationKey: key('take-ready-initial') })
  assert.equal(await worker.claimBotJob(prisma, 30_000, key('ready-initial-token'), { businessId: ids.business }), null, 'a READY initial inbox is fenced before lease once TAKE completes')
  const resumed = await handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: guarded.conversationId, actorUserId: key('owner'), operationKey: key('resume-ready-initial'), resolution: 'RESUME' })
  assert.equal(resumed.resolution, 'HOME')
  const ready = await prisma.$queryRaw<Array<{ status: string; leaseToken: string | null; reason: string | null }>>(Prisma.sql`SELECT j."status"::text AS status,j."leaseToken" AS "leaseToken",j."lastError" AS reason FROM "BotJob" j JOIN "BotActionInbox" i ON i."id"=j."aggregateId" WHERE i."providerMessageId"=${guardedMessageId}`)
  assert.deepEqual(ready[0], { status: 'DONE', leaseToken: null, reason: 'HUMAN_TAKEN_SUPPRESSED' }, 'TAKE terminally suppresses pre-TAKE READY work, and RESUME cannot revive it')
}

async function seedQueuedSession(tag: string) {
  const conversationId = key(`${tag}-conversation`), sessionId = key(`${tag}-session`), handoffId = key(`${tag}-handoff`)
  const initial = state.createInitialBotOptionsState()
  const queued = { ...initial, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED' }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${conversationId},${ids.business},${key(`${tag}-phone`)},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'contract',clock_timestamp())`)
  })
  return { conversationId, sessionId, handoffId, phone: key(`${tag}-phone`) }
}

async function assertQueuedAndGateReopened(sessionId: string, handoffId: string) {
  const rows = await prisma.$queryRaw<Array<{ sessionStatus: string; paused: Date | null; handoffStatus: string }>>(Prisma.sql`
    SELECT s."status"::text AS "sessionStatus", s."handoffClaimsPausedAt" AS paused, h."status"::text AS "handoffStatus"
    FROM "BotSession" s JOIN "BotHandoff" h ON h."sessionId"=s."id" AND h."businessId"=s."businessId"
    WHERE s."id"=${sessionId} AND h."id"=${handoffId}
  `)
  assert.deepEqual(rows[0], { sessionStatus: 'HUMAN_QUEUED', paused: null, handoffStatus: 'QUEUED' })
}

async function assertHumanTakenJobsCannotBeClaimed() {
  assert.equal(await worker.claimBotJob(prisma, 30_000, key('job-claim'), { businessId: ids.business }), null, 'HUMAN_TAKEN must block session-bound worker claims')
  const suppressed = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotJob" WHERE "businessId"=${ids.business} AND "aggregateId" IN (${key('selected-inbox')},${key('prompt')}) AND "status"='DONE'::"BotJobStatus" AND "lastError"='HUMAN_TAKEN_SUPPRESSED'`)
  assert.equal(suppressed[0]!.count, 2n, 'pre-TAKE jobs are terminally suppressed rather than merely left unleased')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","updatedAt") VALUES (${key('expiry-job')},'EXPIRE_DEPOSIT',${key('expiry-aggregate')},${ids.business},${ids.deployment},0,'READY'::"BotJobStatus",clock_timestamp())`)
  const system = await worker.claimBotJob(prisma, 30_000, key('expiry-token'), { businessId: ids.business })
  assert.equal(system?.kind, 'EXPIRE_DEPOSIT', 'unrelated recovery work remains claimable during human ownership')
  assert.ok(system)
  await worker.completeBotJob(prisma, system.id, system.claimToken)
}

async function assertProofJobIsSilentAfterTake() {
  const eventId = key('taken-proof-event'), jobId = key('taken-proof-job'), messageId = key('taken-proof-message')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","providerMessageId","payload","status") VALUES (${eventId},'WHATSAPP',${key('taken-proof-event-key')},'MESSAGE'::"BotProviderEventType",${ids.business},${messageId},${JSON.stringify({ kind: 'message', fromPhone: ids.phone, textBody: 'comprobante', messageType: 'image', mediaId: 'proof-media' })}::jsonb,'ADMITTED'::"BotProviderEventStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","leaseToken","leasedUntil","updatedAt") VALUES (${jobId},'RECEIVE_DEPOSIT_PROOF',${eventId},${ids.business},${ids.deployment},0,'LEASED'::"BotJobStatus",${key('taken-proof-token')},clock_timestamp() + interval '1 minute',clock_timestamp())`)
  })
  const job = (await prisma.$queryRaw<Array<{ id: string; kind: string; aggregateId: string; businessId: string; deploymentId: string; deploymentGeneration: number; expectedRevision: bigint | null; attempts: number; maxAttempts: number; claimToken: string; claimedUntil: Date; queueWaitMs: number }>>(Prisma.sql`SELECT "id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","expectedRevision","attempts","maxAttempts","leaseToken" AS "claimToken","leasedUntil" AS "claimedUntil",0::double precision AS "queueWaitMs" FROM "BotJob" WHERE "id"=${jobId}`))[0]!
  let fetchCalls = 0
  assert.equal(await proofProcessor.processDepositProofJob({ client: prisma, job, capabilityEnabled: true, fetch: async () => { fetchCalls += 1; throw new Error('must not fetch after TAKE') } }), 'HUMAN_TAKEN_SILENCED')
  assert.equal(fetchCalls, 0)
  const rows = await prisma.$queryRaw<Array<{ job: string; event: string; messages: bigint }>>(Prisma.sql`
    SELECT (SELECT "status"::text FROM "BotJob" WHERE "id"=${jobId}) AS job,
      (SELECT "status"::text FROM "BotProviderEvent" WHERE "id"=${eventId}) AS event,
      (SELECT count(*)::bigint FROM "Message" WHERE "conversationId"=${ids.conversation} AND "providerMessageId"=${messageId}) AS messages
  `)
  assert.deepEqual(rows[0], { job: 'DONE', event: 'PROCESSED', messages: 1n })
}

async function assertHumanTakenOutboxCannotBeClaimed() {
  const status = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id"=${key('outbox')}`)
  assert.equal(status[0]!.status, 'SKIPPED', 'TAKE suppresses outbox queued before ownership')
  assert.equal(await sender.claimOutbox(prisma, 30_000, key('outbox-claim'), { businessId: ids.business }), null, 'HUMAN_TAKEN must block sender claims')
}
