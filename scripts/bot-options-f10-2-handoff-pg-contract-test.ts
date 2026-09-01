import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

// Requires an already migrated disposable salon_ai_f10_* scratch. This script
// never creates, migrates, resets or drops a database. Audit history is
// deliberately retained: the F10.2 DB invariant forbids deleting it.
const connectionString = resolveF10PgContractDatabase('F10.2 handoff contract')
const [{ createPrismaClient }, { Prisma }, operations, claims, sender, state] = await Promise.all([
  import('../src/config/prisma-client.js'), import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/handoff-operations.js'), import('../src/bot-options/infrastructure/dispatch-claims.js'), import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/domain/state.js')
])
const prisma = createPrismaClient({ connectionString, max: 8, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `f102_b_${suffix}`, otherBusiness: `f102_other_b_${suffix}`, config: `f102_c_${suffix}`, deployment: `f102_d_${suffix}`, otherConfig: `f102_other_c_${suffix}`, otherDeployment: `f102_other_d_${suffix}` }
const actor = `f102_owner_${suffix}`
const key = (value: string) => `f102_${value}_${suffix}`

try {
  await assertSchema()
  await seedBase()
  await assertClaimSnapshotsBothFencesAndGate()
  await assertTakeDrainsWorkerAndSender()
  await assertUnknownBlocksDurably()
  await assertConcurrentTakeAndReplay()
  await assertCrashReplayDoesNotBumpEpoch()
  await assertTakeTransitionsAndSuppresses()
  await assertTakeFinalAtomicRollbackAndReplay()
  await assertResolveOwnershipReplayAndHome()
  await assertHistoricalReplayAndTenantScope()
  await assertAuditIsAppendOnly()
  console.log('OK F10.2 PG: session/deployment fences, gate, drain, UNKNOWN durability, concurrent TAKE/replay, final atomic rollback/replay, exact timeout reopen, state/log transitions, suppression, owner-only resolve, F10.4 snapshot-backed RESUME/replay and append-only audit.')
} finally {
  // No cleanup: BotHandoffAudit is append-only and has RESTRICT FKs by design.
  await prisma.$disconnect()
}

async function assertSchema() {
  const row = (await prisma.$queryRaw<Array<{ sessionGate: boolean; claimFence: boolean; audit: boolean; immutable: boolean; takeUniqueness: boolean }>>(Prisma.sql`
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='BotSession' AND column_name='handoffFenceEpoch') AS "sessionGate",
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='BotDispatchClaim' AND column_name='handoffFenceEpoch') AS "claimFence",
      to_regclass('public."BotHandoffAudit"') IS NOT NULL AS audit,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='BotHandoffAudit_append_only') AS immutable,
      EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='BotOperation_one_started_handoff_take_per_session' AND indexdef LIKE '%WHERE%') AS "takeUniqueness"`))[0]
  assert.deepEqual(row, { sessionGate: true, claimFence: true, audit: true, immutable: true, takeUniqueness: true })
}
async function seedBase() {
  await prisma.$transaction(async tx => {
    for (const [business, config, deployment] of [[ids.business, ids.config, ids.deployment], [ids.otherBusiness, ids.otherConfig, ids.otherDeployment]] as const) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${business},${`F102-${business}`},'F10.2 contract')`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${config},${business},'deterministic-options','F10.2','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${deployment},${business},'deterministic-options',${config},1,clock_timestamp())`)
    }
  })
}
async function scenario(tag: string, businessId = ids.business) {
  const deploymentId = businessId === ids.business ? ids.deployment : ids.otherDeployment
  const sessionId = `f102_s_${tag}_${suffix}`, conversationId = `f102_v_${tag}_${suffix}`, handoffId = `f102_h_${tag}_${suffix}`
  const initial = state.createInitialBotOptionsState()
  const queued = { ...initial, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED' }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${conversationId},${businessId},${`f102-${tag}-${suffix}`},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${sessionId},${businessId},${conversationId},${deploymentId},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${businessId},${sessionId},'contract',clock_timestamp())`)
  })
  return { sessionId, conversationId, conversationPhone: `f102-${tag}-${suffix}`, handoffId }
}
async function dispatch(sessionId: string, resourceId: string, kind: 'PROCESS' | 'SEND' = 'PROCESS') {
  return claims.acquireDispatchClaim({ client: prisma, businessId: ids.business, sessionId, resourceId, generation: 0, fenceEpoch: 0, kind, leaseMs: 60_000 })
}
async function session(sessionId: string) {
  return (await prisma.$queryRaw<Array<{ epoch: number; paused: Date | null; status: string; state: unknown; revision: bigint }>>(Prisma.sql`SELECT "handoffFenceEpoch" AS epoch,"handoffClaimsPausedAt" AS paused,"status"::text AS status,"state","revision" FROM "BotSession" WHERE "id"=${sessionId}`))[0]!
}
async function handoff(handoffId: string) {
  return (await prisma.$queryRaw<Array<{ status: string; owner: string | null; takenAt: Date | null }>>(Prisma.sql`SELECT "status"::text AS status,"ownerUserId" AS owner,"takenAt" FROM "BotHandoff" WHERE "id"=${handoffId}`))[0]!
}
async function assertClaimSnapshotsBothFencesAndGate() {
  const x = await scenario('claim')
  const token = await dispatch(x.sessionId, key('claim-resource'))
  assert.ok(token)
  const fence = (await prisma.$queryRaw<Array<{ dispatch: number; handoff: number | null }>>(Prisma.sql`SELECT "fenceEpoch" AS dispatch,"handoffFenceEpoch" AS handoff FROM "BotDispatchClaim" WHERE "claimToken"=${token}`))[0]!
  assert.deepEqual(fence, { dispatch: 0, handoff: 0 })
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp() WHERE "id"=${x.sessionId}`)
  assert.equal(await dispatch(x.sessionId, key('blocked-resource')), null, 'paused session cannot acquire a claim')
}
async function assertTakeDrainsWorkerAndSender() {
  const worker = await scenario('worker')
  const claim = await dispatch(worker.sessionId, key('worker-inflight'))
  const workerKey = key('take-worker')
  await assert.rejects(() => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: worker.conversationId, actorUserId: actor, operationKey: workerKey, drainMs: 0 }), /timed out/)
  assert.equal((await session(worker.sessionId)).paused, null, 'timeout reopens only its exact gate')
  assert.equal((await operation(workerKey)).status, 'ABORTED')
  await claims.releaseDispatchClaim(prisma, claim!)
  const job = await scenario('leased_job'), eventId = key('job-event'), inboxId = key('job-inbox'), jobId = key('job-id'), jobTakeKey = key('take-leased-job')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","status") VALUES (${eventId},'WHATSAPP',${key('job-event-key')},'MESSAGE'::"BotProviderEventType",${ids.business},'ADMITTED'::"BotProviderEventStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","status") VALUES (${inboxId},${ids.business},${eventId},${job.sessionId},${ids.deployment},0,'CLAIMED'::"BotInboxStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","updatedAt") VALUES (${jobId},'PROCESS_SESSION',${inboxId},${ids.business},${ids.deployment},0,'LEASED'::"BotJobStatus",clock_timestamp())`)
  })
  await assert.rejects(() => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: job.conversationId, actorUserId: actor, operationKey: jobTakeKey, drainMs: 0 }), /timed out/)
  assert.equal((await session(job.sessionId)).paused, null); assert.equal((await operation(jobTakeKey)).status, 'ABORTED')
  await assertRealSenderDrain()
}
async function assertRealSenderDrain() {
  const x = await scenario('sender_real'), outboxId = key('sender-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${x.sessionId},'t',${key('sender-group')},0,'TEXT','{}'::jsonb,${key('sender-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  const item = await sender.claimOutbox(prisma, 60_000, key('sender-lease'), { businessId: ids.business })
  assert.equal(item?.id, outboxId)
  let started!: () => void; const providerStarted = new Promise<void>(resolve => { started = resolve })
  let accept!: () => void; const accepted = new Promise<{ kind: 'accepted'; providerMessageId: string }>(resolve => { accept = () => resolve({ kind: 'accepted', providerMessageId: key('provider-message') }) })
  const send = sender.sendClaimedOutbox({ client: prisma, item: item!, provider: { send: async () => { started(); return accepted } } })
  await providerStarted
  let completed = false
  const take = operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key('take-sender-real'), drainMs: 2_000 }).then(() => { completed = true })
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(completed, false, 'TAKE cannot pass while real sender is SENDING')
  accept(); assert.equal(await send, 'ACCEPTED'); await take
  assert.equal((await session(x.sessionId)).status, 'HUMAN_TAKEN')
}
async function assertUnknownBlocksDurably() {
  const x = await scenario('unknown')
  const outboxId = key('unknown-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${x.sessionId},'t',${key('unknown-group')},0,'TEXT','{}'::jsonb,${key('unknown-idempotency')},'UNKNOWN'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  const takeKey = key('take-unknown')
  await assert.rejects(() => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey, drainMs: 0 }), /UNKNOWN/)
  assert.ok((await session(x.sessionId)).paused, 'UNKNOWN leaves gate paused')
  assert.equal((await operation(takeKey)).status, 'BLOCKED_UNKNOWN')
  assert.equal(await auditCount(x.handoffId, 'TAKE_BLOCKED_UNKNOWN'), 1)
  const epoch = (await session(x.sessionId)).epoch
  await sender.resolveUnknownOutbox({ client: prisma, outboxId, type: 'SKIP', actorId: actor, reason: 'contract disposition' })
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey })
  assert.equal((await session(x.sessionId)).epoch, epoch, 'resolved UNKNOWN resumes its original paused epoch')
}
async function assertConcurrentTakeAndReplay() {
  const x = await scenario('concurrent')
  const results = await Promise.allSettled(['a', 'b'].map(part => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key(`take-concurrent-${part}`), drainMs: 50 })))
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1, 'only one concurrent TAKE owns the queued handoff')
  assert.equal((await session(x.sessionId)).epoch, 1, 'loser never increments the fence')
  const winner = results.findIndex(x => x.status === 'fulfilled') === 0 ? 'a' : 'b'
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key(`take-concurrent-${winner}`) })
  assert.equal((await session(x.sessionId)).epoch, 1, 'completed replay does not increment the fence')
  assert.equal(await startedTakeCount(x.sessionId), 0, 'no STARTED TAKE is stranded')
  await assertCanonicalReplayLockOrder(x.sessionId, x.handoffId, key(`take-concurrent-${winner}`))
}
async function assertCanonicalReplayLockOrder(sessionId: string, handoffId: string, operationKey: string) {
  // Bounds a regression test to the canonical replay hierarchy; the real
  // concurrent TAKE/replay above exercises the application transactions.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '2s'`)
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BotSession" WHERE "id"=${sessionId} FOR UPDATE`)
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BotHandoff" WHERE "id"=${handoffId} FOR UPDATE`)
    await tx.$queryRaw(Prisma.sql`SELECT "operationKey" FROM "BotOperation" WHERE "operationKey"=${operationKey} FOR UPDATE`)
  })
}
async function assertCrashReplayDoesNotBumpEpoch() {
  const x = await scenario('crash')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp(),"handoffFenceEpoch"=1 WHERE "id"=${x.sessionId}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${key('crash-id')},${key('take-crash')},'HANDOFF_TAKE',${ids.business},${x.sessionId},'STARTED',${hashTake(actor, x.conversationId)},${x.handoffId},clock_timestamp())`)
  })
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key('take-crash') })
  assert.equal((await session(x.sessionId)).epoch, 1, 'crash replay continues the existing paused fence')
}
async function assertTakeTransitionsAndSuppresses() {
  const x = await scenario('transition')
  const promptId = key('prompt'), outboxId = key('pending-outbox')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","status") VALUES (${promptId},${x.sessionId},${key('prompt-token')},0,'OPEN'::"BotPromptStatus")`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${x.sessionId},'t',${key('pending-group')},0,'TEXT','{}'::jsonb,${key('pending-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key('take-transition') })
  const current = await session(x.sessionId)
  assert.equal(current.status, 'HUMAN_TAKEN'); assert.equal((current.state as { handoff: string }).handoff, 'TAKEN')
  assert.equal(await outboxStatus(outboxId), 'SKIPPED')
  assert.equal(await promptStatus(promptId), 'INVALIDATED')
  assert.equal(await transitionCount(x.sessionId, 'handoff.take'), 1)
}
async function assertTakeFinalAtomicRollbackAndReplay() {
  const x = await scenario('take_atomic')
  const promptId = key('take-atomic-prompt'), outboxId = key('take-atomic-outbox'), takeKey = key('take-atomic')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","status") VALUES (${promptId},${x.sessionId},${key('take-atomic-prompt-token')},0,'OPEN'::"BotPromptStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","maxAttempts","availableAt","updatedAt") VALUES (${outboxId},${ids.business},${x.sessionId},'t',${key('take-atomic-group')},0,'TEXT','{}'::jsonb,${key('take-atomic-idempotency')},'PENDING'::"BotOutboxStatus",1,clock_timestamp(),clock_timestamp())`)
  })
  const original = await session(x.sessionId)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id"=${x.conversationId} AND "businessId"=${ids.business}`)
  await assert.rejects(() => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey }), /taken conversation lost row ownership/)
  const rolledBack = await session(x.sessionId), queued = await handoff(x.handoffId)
  assert.deepEqual(queued, { status: 'QUEUED', owner: null, takenAt: null })
  assert.equal(rolledBack.status, 'HUMAN_QUEUED'); assert.deepEqual(rolledBack.state, original.state); assert.equal(rolledBack.revision, original.revision)
  assert.equal(await transitionCount(x.sessionId, 'handoff.take'), 0)
  assert.equal(await promptStatus(promptId), 'OPEN'); assert.equal(await outboxStatus(outboxId), 'PENDING')
  assert.equal(await auditCount(x.handoffId, 'TAKE_COMPLETED'), 0)
  assert.equal((await operation(takeKey)).status, 'STARTED'); assert.ok(rolledBack.paused); assert.equal(rolledBack.epoch, original.epoch + 1)
  assert.equal(await auditCount(x.handoffId, 'TAKE_STARTED'), 1)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${x.conversationId},${ids.business},${x.conversationPhone},clock_timestamp())`)
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey })
  const taken = await session(x.sessionId)
  assert.equal(taken.status, 'HUMAN_TAKEN'); assert.equal((taken.state as { handoff: string }).handoff, 'TAKEN')
  assert.equal(await promptStatus(promptId), 'INVALIDATED'); assert.equal(await outboxStatus(outboxId), 'SKIPPED')
  assert.equal((await operation(takeKey)).status, 'COMPLETED'); assert.equal(await transitionCount(x.sessionId, 'handoff.take'), 1)
  assert.equal(await auditCount(x.handoffId, 'TAKE_COMPLETED'), 1)
}
async function assertResolveOwnershipReplayAndHome() {
  const x = await scenario('resolve')
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: key('take-resolve') })
  await assert.rejects(() => operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: 'other', operationKey: key('resolve-other'), resolution: 'HOME' }), /only handoff owner/)
  const resolveKey = key('resolve-owner')
  const resolved = await operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: resolveKey, resolution: 'RESUME' })
  assert.equal(resolved.resolution, 'HOME', 'manual attention always resolves to a clean initial session')
  const current = await session(x.sessionId)
  assert.equal(current.status, 'ACTIVE'); assert.equal((current.state as { handoff: string }).handoff, 'NONE')
  assert.equal(await transitionCount(x.sessionId, 'handoff.resolve_home'), 1)
  assert.equal(await resumePolicy(x.handoffId), 'HOME')
  assert.equal((await operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: resolveKey, resolution: 'RESUME' })).resolution, 'HOME', 'completed replay returns the durable HOME result')
  const blocked = await scenario('resolve_unknown')
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: blocked.conversationId, actorUserId: actor, operationKey: key('take-resolve-unknown') })
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotDispatchClaim" ("id","businessId","channel","sessionId","engineKey","generation","fenceEpoch","handoffFenceEpoch","kind","status","claimToken","claimedUntil","updatedAt") VALUES (${key('resolve-unknown-claim')},${ids.business},'WHATSAPP'::"BotChannel",${blocked.sessionId},'deterministic-options',0,0,1,'SEND'::"BotDispatchKind",'UNKNOWN'::"BotDispatchStatus",${key('resolve-unknown-token')},clock_timestamp(),clock_timestamp())`)
  await assert.rejects(() => operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: blocked.conversationId, actorUserId: actor, operationKey: key('resolve-unknown'), resolution: 'HOME' }), /UNKNOWN/)
  assert.equal(await auditCount(blocked.handoffId, 'RESOLVE_BLOCKED_UNKNOWN'), 1)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotDispatchClaim" SET "status"='DONE'::"BotDispatchStatus" WHERE "claimToken"=${key('resolve-unknown-token')}`)
  await operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: blocked.conversationId, actorUserId: actor, operationKey: key('resolve-unknown'), resolution: 'HOME' })
  assert.equal((await session(blocked.sessionId)).status, 'ACTIVE', 'the same resolve key recovers after UNKNOWN disposition')
}
async function assertHistoricalReplayAndTenantScope() {
  const x = await scenario('historical'), takeKey = key('historical-take'), resolveKey = key('historical-resolve')
  await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey })
  await operations.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: resolveKey, resolution: 'HOME' })
  const newer = key('historical-newer')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${newer},${ids.business},${x.sessionId},'new active',clock_timestamp())`)
  assert.equal((await operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: actor, operationKey: takeKey })).handoffId, x.handoffId, 'historical replay is bound to resultRef, never a newer active handoff')
  const other = await scenario('tenant', ids.otherBusiness), wrongKey = key('wrong-tenant-take')
  await assert.rejects(() => operations.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId: other.conversationId, actorUserId: actor, operationKey: wrongKey }), /active deterministic handoff not found/)
  assert.equal(await operationCount(wrongKey), 0); assert.equal(await auditCount(other.handoffId, 'TAKE_STARTED'), 0)
}
async function assertAuditIsAppendOnly() { const x = await scenario('audit'), auditId = key('audit-id'); await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey") VALUES (${auditId},${ids.business},${x.sessionId},${x.handoffId},'TEST',${key('audit-operation')})`); await assert.rejects(() => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotHandoffAudit" WHERE "id"=${auditId}`), /append-only/) }
async function operation(key: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status" FROM "BotOperation" WHERE "operationKey"=${key}`))[0]! }
async function operationCount(operationKey: string) { return Number((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotOperation" WHERE "operationKey"=${operationKey}`))[0]!.count) }
async function auditCount(handoffId: string, action: string) { return Number((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotHandoffAudit" WHERE "handoffId"=${handoffId} AND "action"=${action}`))[0]!.count) }
async function startedTakeCount(sessionId: string) { return Number((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotOperation" WHERE "sessionId"=${sessionId} AND "type"='HANDOFF_TAKE' AND "status"='STARTED'`))[0]!.count) }
async function outboxStatus(id: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id"=${id}`))[0]!.status }
async function promptStatus(id: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotPrompt" WHERE "id"=${id}`))[0]!.status }
async function transitionCount(sessionId: string, action: string) { return Number((await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotTransitionLog" WHERE "sessionId"=${sessionId} AND "actionType"=${action}`))[0]!.count) }
async function resumePolicy(handoffId: string) { return (await prisma.$queryRaw<Array<{ resumePolicy: string }>>(Prisma.sql`SELECT "resumePolicy" FROM "BotHandoff" WHERE "id"=${handoffId}`))[0]!.resumePolicy }
function hashTake(actorUserId: string, conversationId: string) { return createHash('sha256').update(JSON.stringify({ action: 'TAKE', actorUserId, conversationId }), 'utf8').digest('hex') }
