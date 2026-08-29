import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

/**
 * F10.6 CONTROLLED/LOCAL half — deterministic contract over real F10.3/F10.4 seams.
 *
 * This is TEST-ONLY code. It does NOT alter production runtime semantics, config
 * flags, schema/migrations, server, routing, the Meta provider, or the handoff
 * writers. It reuses the existing F10 scratch safety gate and the public seams
 * `handoff.take/resolveBotHandoff`, `worker.claimBotJob`, `sender.claimOutbox`,
 * `sender.sendClaimedOutbox` (with an injected controlled provider) and
 * `PrismaAuthoritativeAdmissionRepository.admitAuthoritative`.
 *
 * It runs ONLY against an explicit loopback F10 scratch
 * (F10_PG_CONTRACT_DATABASE_URL) and uses run-unique tenant fixtures.
 * BotHandoffAudit is append-only by design: this script never deletes it, and
 * the client is disconnected in `finally`.
 */

const connectionString = resolveF10PgContractDatabase('F10.6 handoff controlled contract')
const [
  { createPrismaClient },
  { Prisma },
  handoff,
  worker,
  sender,
  admission,
  state
] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/handoff-operations.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/domain/state.js')
])
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })

const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `f106_b_${suffix}`,
  config: `f106_c_${suffix}`,
  deployment: `f106_d_${suffix}`
}
const key = (value: string) => `f106_${value}_${suffix}`
const owner = key('owner')
const admissionRepository = new admission.PrismaAuthoritativeAdmissionRepository(prisma, { authoritativeTransactionTimeoutMs: 30_000 })

try {
  await assertSchema()
  await seedBusiness()
  await assertSenderTakeRaceZeroProviderCallsWhenTakeWins() // case 1
  await assertInboundDuringHumanTakenMaterializedOnceForCrm() // case 2
  await assertDuplicateProviderMessageIdIdempotency() // case 3
  await assertValidResumeDurableReplayableAndNoRevival() // case 4
  await assertNewInboundAfterResumeProcessable() // case 5
  await assertUnknownBlocksTakeAndNotForceCleaned() // case 6
  console.log('OK F10.6 controlled: sender/TAKE race yields zero provider calls when TAKE wins; inbound during HUMAN_TAKEN materializes exactly once in the CRM Message ledger with provider event/inbox silenced and zero automatic job/outbox; duplicate providerMessageId is idempotent at the CRM ledger; valid RESUME is durable/replayable and does not revive pre-TAKE suppressed work; a new inbound after RESUME becomes processable; UNKNOWN blocks TAKE and is never force-cleaned.')
} finally {
  // Append-only scratch: never delete BotHandoffAudit; just disconnect.
  await prisma.$disconnect()
}

// ---------------------------------------------------------------------------
// Schema guard (read-only): the scratch must already carry the F10.4/F10.5
// handoff surface (resumeSnapshot, the HUMAN_TAKEN gate column, and the
// append-only BotHandoffAudit ledger). The contract never migrates.
// ---------------------------------------------------------------------------
async function assertSchema() {
  const row = (await prisma.$queryRaw<Array<{
    snapshot: boolean
    audit: boolean
    immutable: boolean
    paused: boolean
  }>>(Prisma.sql`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='BotHandoff' AND column_name='resumeSnapshot') AS "snapshot",
      to_regclass('public."BotHandoffAudit"') IS NOT NULL AS "audit",
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='BotHandoffAudit_append_only') AS "immutable",
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='BotSession' AND column_name='handoffClaimsPausedAt') AS "paused"
  `))[0]
  assert.deepEqual(row, { snapshot: true, audit: true, immutable: true, paused: true })
}

async function seedBusiness() {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${ids.business},${key('customer')},'F10.6 controlled contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","updatedAt") VALUES (${ids.business},'UTC',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${ids.config},${ids.business},'deterministic-options','F10.6','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${ids.deployment},${ids.business},'deterministic-options',${ids.config},1,clock_timestamp())`)
  })
}

async function seedQueuedSession(tag: string) {
  const conversationId = key(`${tag}-conversation`)
  const sessionId = key(`${tag}-session`)
  const handoffId = key(`${tag}-handoff`)
  const phone = key(`${tag}-phone`)
  const initial = state.createInitialBotOptionsState()
  const queued = { ...initial, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED' }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${conversationId},${ids.business},${phone},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'F10.6 controlled contract',clock_timestamp())`)
  })
  return { conversationId, sessionId, handoffId, phone }
}

async function admitInbound(conversationPhone: string, providerMessageId: string, eventKey: string, textBody = 'Necesito hablar con una persona') {
  await admissionRepository.admitAuthoritative({
    route: { kind: 'new', businessId: ids.business, deploymentId: ids.deployment, generation: 0, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    phoneNumberId: key('phone-number'),
    events: [{
      kind: 'message',
      eventKey,
      providerMessageId,
      phoneNumberId: key('phone-number'),
      displayPhoneNumber: null,
      fromPhone: conversationPhone,
      textBody,
      messageType: 'text',
      interactiveReplyId: null,
      mediaType: null,
      mediaMimeType: null,
      mediaId: null,
      filename: null,
      providerOccurredAtIso: null
    }]
  })
}

// A controlled, blockable provider: we inject it into the real sender seam and
// count every `send`. The "blockable" behavior (an in-flight send that TAKE must
// wait for) is the complementary F10.2 case; here F10.6 proves the inverse —
// a TAKE win pre-empts any provider call.
function controlledProvider() {
  const calls = { n: 0 }
  return {
    calls,
    provider: {
      send: async (_input: { businessId: string; payload: unknown }, _signal: AbortSignal) => {
        calls.n += 1
        await new Promise(resolve => setTimeout(resolve, 20))
        return { kind: 'accepted' as const, providerMessageId: key('provider-sent') }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Case 1: sender/TAKE race with a blockable controlled provider and zero
// provider calls when TAKE wins.
// ---------------------------------------------------------------------------
async function assertSenderTakeRaceZeroProviderCallsWhenTakeWins() {
  // Deterministic proof: TAKE owns the session first; the sender can no longer
  // claim the suppressed outbox, so the injected provider is never invoked.
  const fixture = await seedQueuedSession('sender')
  const outboxId = key('sender-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${fixture.sessionId},'t',${key('sender-group')},0,'TEXT','{}'::jsonb,${key('sender-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  const deterministic = controlledProvider()
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('take-sender'), drainMs: 2_000 })
  const claimed = await sender.claimOutbox(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(claimed, null, 'once TAKE owns the session, the sender cannot claim the pre-TAKE outbox')
  assert.equal(deterministic.calls.n, 0, 'TAKE winning the race yields zero provider calls')
  assert.equal(await outboxStatus(outboxId), 'SKIPPED', 'TAKE terminally suppresses the pre-TAKE outbox')

  // Coordinated concurrent race: start TAKE, observe its durable gate, and only
  // then let the sender attempt a claim. This proves the TAKE-winning branch
  // without timing sleeps or accepting the opposite outcome as a green test.
  const race = await seedQueuedSession('sender-race')
  const raceOutboxId = key('sender-race-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${raceOutboxId},${ids.business},${race.sessionId},'t',${key('sender-race-group')},0,'TEXT','{}'::jsonb,${key('sender-race-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  const controlled = controlledProvider()
  const take = handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: race.conversationId, actorUserId: owner, operationKey: key('take-sender-race'), drainMs: 2_000 })
  const sendAttempt = (async () => {
    await waitForSessionGatePaused(race.sessionId)
    const c = await sender.claimOutbox(prisma, 30_000, randomUUID(), { businessId: ids.business })
    if (!c) return { result: 'not-claimed' as const }
    const sent = await sender.sendClaimedOutbox({ client: prisma, item: c, provider: controlled.provider })
    return { result: 'sent' as const, sent }
  })()
  const [takeResult, sendResult] = await Promise.all([take, sendAttempt])
  assert.equal(takeResult.status, 'TAKEN')
  assert.equal(sendResult.result, 'not-claimed', 'the sender cannot claim after TAKE closes the durable session gate')
  assert.equal(await outboxStatus(raceOutboxId), 'SKIPPED', 'the TAKE-winning race terminally suppresses the pre-TAKE outbox')
  assert.equal(controlled.calls.n, 0, 'the TAKE-winning race never invokes the controlled provider')
}

// ---------------------------------------------------------------------------
// Case 2: inbound during HUMAN_TAKEN materialized once in CRM Message with
// provider event/inbox silenced and zero automatic job/outbox/effect.
// ---------------------------------------------------------------------------
async function assertInboundDuringHumanTakenMaterializedOnceForCrm() {
  const fixture = await seedQueuedSession('inbound')
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('take-inbound') })
  const messageId = key('inbound-message')
  await admitInbound(fixture.phone, messageId, key('inbound-event'))
  assert.equal(await messageCount(messageId), 1, 'exactly one CRM Message is materialized for the human-owned inbound')
  const inbox = await inboxRows(messageId)
  assert.deepEqual(inbox, [{ status: 'PROCESSED', error: 'HUMAN_TAKEN_SILENCED', count: 1n }], 'BotActionInbox is silenced, not processed into automation')
  assert.equal(await eventStatus(key('inbound-event')), 'PROCESSED', 'provider event is acknowledged/silenced')
  assert.equal(await jobCountForInbox(messageId), 0, 'no automatic BotJob is created for the silenced inbound')
  assert.equal(await outboxCountForSession(fixture.sessionId), 0, 'no automatic BotOutbox is created for the silenced inbound')
  assert.equal(await sessionStatus(fixture.sessionId), 'HUMAN_TAKEN', 'the session is not altered into an active/automated state')
}

// ---------------------------------------------------------------------------
// Case 3: duplicate providerMessageId idempotency.
// ---------------------------------------------------------------------------
async function assertDuplicateProviderMessageIdIdempotency() {
  const fixture = await seedQueuedSession('dup')
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('take-dup') })
  const messageId = key('dup-message')
  await admitInbound(fixture.phone, messageId, key('dup-event-1'))
  await admitInbound(fixture.phone, messageId, key('dup-event-2')) // duplicate delivery, different eventKey
  assert.equal(await messageCount(messageId), 1, 'a re-delivered providerMessageId is idempotent in the CRM Message ledger (ON CONFLICT providerMessageId DO NOTHING)')
  assert.equal(await jobCountForInbox(messageId), 0, 'duplicate delivery creates no second automation job')
  const eventRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotProviderEvent" WHERE "providerMessageId"=${messageId}`)
  assert.equal(Number(eventRows[0]!.count), 2, 'two provider events are admitted but collapse to one CRM Message')
}

// ---------------------------------------------------------------------------
// Case 4: valid RESUME durable/replayable and no revival of pre-TAKE suppressed
// work.
// ---------------------------------------------------------------------------
async function assertValidResumeDurableReplayableAndNoRevival() {
  const fixture = await seedQueuedSession('resume')
  // Pre-TAKE inbound creates a real READY PROCESS_INBOX job; TAKE must suppress it.
  const messageId = key('resume-message')
  await admitInbound(fixture.phone, messageId, key('resume-event'))
  assert.equal(await jobStatusForInbox(messageId), 'READY', 'pre-TAKE inbound is normally processable')
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('take-resume') })
  assert.equal(await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business }), null, 'TAKE terminally suppresses the pre-TAKE job')
  assert.deepEqual(await suppressedJob(messageId), { status: 'DONE', error: 'HUMAN_TAKEN_SUPPRESSED' }, 'pre-TAKE work is suppressed, not merely unleased')

  const resolved = await handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('resolve-resume'), resolution: 'RESUME' })
  assert.equal(resolved.resolution, 'RESUME', 'a stable immutable snapshot-backed RESUME is applied')
  assert.equal(await sessionStatus(fixture.sessionId), 'ACTIVE', 'RESUME returns the session to ACTIVE')
  assert.equal((await handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('resolve-resume'), resolution: 'RESUME' })).resolution, 'RESUME', 'completed RESUME replay returns the durable applied result')
  // No revival: the suppressed pre-TAKE job must stay DONE/HUMAN_TAKEN_SUPPRESSED.
  assert.equal(await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business }), null, 'RESUME does not revive the pre-TAKE suppressed job')
  assert.deepEqual(await suppressedJob(messageId), { status: 'DONE', error: 'HUMAN_TAKEN_SUPPRESSED' }, 'pre-TAKE suppressed work is not revived after RESUME')
}

// ---------------------------------------------------------------------------
// Case 5: a NEW inbound after RESUME becomes processable.
// ---------------------------------------------------------------------------
async function assertNewInboundAfterResumeProcessable() {
  const fixture = await seedQueuedSession('resume2')
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('take-resume2') })
  await handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: key('resolve-resume2'), resolution: 'RESUME' })
  const messageId = key('resume2-new-message')
  await admitInbound(fixture.phone, messageId, key('resume2-new-event'))
  const inbox = await inboxRows(messageId)
  assert.deepEqual(inbox, [{ status: 'ADMITTED', error: null, count: 1n }], 'post-RESUME inbound is admitted for processing, not silenced')
  const jobId = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT j."id" FROM "BotJob" j JOIN "BotActionInbox" i ON i."id"=j."aggregateId" WHERE i."providerMessageId"=${messageId}`))[0]!.id
  const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.ok(claimed, 'a new inbound after RESUME is claimable by the worker')
  assert.equal(claimed!.id, jobId, 'the claimed job is exactly the new inbound job')
  assert.equal(claimed!.kind, 'PROCESS_INBOX', 'the new inbound is processable (PROCESS_INBOX), not silenced')
  await worker.completeBotJob(prisma, claimed!.id, claimed!.claimToken)
}

// ---------------------------------------------------------------------------
// Case 6: UNKNOWN blocks TAKE and is not force-cleaned.
// ---------------------------------------------------------------------------
async function assertUnknownBlocksTakeAndNotForceCleaned() {
  const fixture = await seedQueuedSession('unknown')
  const outboxId = key('unknown-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${fixture.sessionId},'t',${key('unknown-group')},0,'TEXT','{}'::jsonb,${key('unknown-idempotency')},'UNKNOWN'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  const takeKey = key('take-unknown')
  // First TAKE: the UNKNOWN outbox blocks ownership durably; the outbox is NOT
  // force-cleaned (it stays UNKNOWN awaiting an explicit disposition).
  await assert.rejects(() => handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: takeKey, drainMs: 0 }), /UNKNOWN/)
  assert.ok(await sessionPausedAt(fixture.sessionId), 'UNKNOWN leaves the handoff gate paused')
  assert.equal(await operationStatus(takeKey), 'BLOCKED_UNKNOWN', 'the blocked TAKE is recorded as BLOCKED_UNKNOWN')
  assert.equal(await outboxStatus(outboxId), 'UNKNOWN', 'TAKE must NOT force-clean/auto-resolve the UNKNOWN outbox')
  // Repeated TAKE (same operation key = idempotent replay) still blocks on the
  // unresolved UNKNOWN and still leaves the outbox uncleaned; it does not become
  // a stranded STARTED take. A distinct key would trip the "already being taken"
  // guard because the first BLOCKED_UNKNOWN operation is intentionally retained.
  await assert.rejects(() => handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: fixture.conversationId, actorUserId: owner, operationKey: takeKey, drainMs: 0 }), /UNKNOWN/)
  assert.equal(await outboxStatus(outboxId), 'UNKNOWN', 'repeated TAKE still leaves the UNKNOWN outbox uncleaned')
}

// ---------------------------------------------------------------------------
// Read-only assertions helpers.
// ---------------------------------------------------------------------------
async function messageCount(providerMessageId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "Message" WHERE "providerMessageId"=${providerMessageId}`)
  return Number(rows[0]!.count)
}
async function sessionStatus(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotSession" WHERE "id"=${sessionId}`)
  return rows[0]!.status
}
async function outboxStatus(outboxId: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id"=${outboxId}`)
  return rows[0]!.status
}
async function sessionPausedAt(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ paused: Date | null }>>(Prisma.sql`SELECT "handoffClaimsPausedAt" AS paused FROM "BotSession" WHERE "id"=${sessionId}`)
  return rows[0]!.paused
}
async function waitForSessionGatePaused(sessionId: string) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await sessionPausedAt(sessionId)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for TAKE to close the durable session gate')
}
async function operationStatus(operationKey: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOperation" WHERE "operationKey"=${operationKey}`)
  return rows[0]?.status ?? null
}
async function inboxRows(providerMessageId: string) {
  return prisma.$queryRaw<Array<{ status: string; error: string | null; count: bigint }>>(Prisma.sql`
    SELECT i."status"::text AS status, i."error" AS "error", count(*)::bigint AS count
    FROM "BotActionInbox" i WHERE i."providerMessageId"=${providerMessageId} GROUP BY i."status", i."error"`)
}
async function eventStatus(eventKey: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotProviderEvent" WHERE "eventKey"=${eventKey}`)
  return rows[0]?.status ?? null
}
async function jobCountForInbox(providerMessageId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM "BotJob" j JOIN "BotActionInbox" i ON i."id"=j."aggregateId" WHERE i."providerMessageId"=${providerMessageId}`)
  return Number(rows[0]!.count)
}
async function jobStatusForInbox(providerMessageId: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT j."status"::text AS status FROM "BotJob" j JOIN "BotActionInbox" i ON i."id"=j."aggregateId" WHERE i."providerMessageId"=${providerMessageId}`)
  return rows[0]?.status ?? null
}
async function outboxCountForSession(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotOutbox" WHERE "sessionId"=${sessionId}`)
  return Number(rows[0]!.count)
}
async function suppressedJob(providerMessageId: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string; error: string | null }>>(Prisma.sql`
    SELECT j."status"::text AS status, j."lastError" AS "error"
    FROM "BotJob" j JOIN "BotActionInbox" i ON i."id"=j."aggregateId" WHERE i."providerMessageId"=${providerMessageId}`)
  return rows[0] ?? null
}
