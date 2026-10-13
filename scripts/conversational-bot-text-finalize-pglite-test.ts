/** Production SQL in disposable PostgreSQL/WASM; not multi-session PostgreSQL evidence. */
import assert from 'node:assert/strict'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import type { Prisma } from '../src/generated/prisma/client.js'
import { persistConversationTurnTx } from '../src/conversational-bot/persist-conversation-turn.js'
import { persistView, planPersistedView } from '../src/bot-options/application/process-session-job.js'
import { processConversationInbox } from '../src/conversational-bot/process-inbox-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { textView } from '../src/bot-options/domain/views.js'
import { createQueueMilestoneTracker, observeQueueProducerTransaction } from '../src/bot-options/observability/queue-milestones.js'

const db = new PGlite()
const now = new Date('2026-10-01T12:00:00Z')
const state = createInitialBotOptionsState()
const envelope = { version: 1 as const, businessId: 'biz', sessionId: 'session', deploymentId: 'dep', generation: 1,
  handoffFenceEpoch: 0, baseState: state, eventIds: ['event','b','c','d','e'], sealed: false, revision: '1' }
const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1,
  configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } } }
const job = { id: 'job', kind: 'PROCESS_INBOX', aggregateId: 'inbox', businessId: 'biz', deploymentId: 'dep',
  deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: 'job-token',
  claimedUntil: new Date('2100-01-01'), queueWaitMs: 0 }
const row = { ...config, id: 'inbox', deploymentGeneration: 1, fenceEpoch: 1, providerEventId: 'event', providerMessageId: 'msg',
  status: 'ADMITTED', dbNow: now, businessTimezone: 'UTC', admittedAt: now, providerOccurredAt: now, botEnabled: true,
  payload: { fromPhone: 'phone', textBody: 'restart', messageType: 'text', contextWindowEvaluated: true } }
// Capture the unchanged production settlement for the legacy injected-writer comparison.
let legacySettlement: Prisma.Sql | undefined
const capture = {
  async $transaction<T>(body: (tx: unknown) => Promise<T>) { return body(capture) },
  async $executeRaw() { return 1 },
  async $queryRaw(q: Prisma.Sql) {
      if (q.sql.includes('conversation-terminal-inbox-reconcile')) return [] // Fixture has no historical exhausted inbox; dedicated SQL suite covers recovery.
    if (q.sql.includes('conversation-policy')) return [config]
    if (q.sql.includes('conversation-target')) return [{ fenceEpoch: 1, phone: 'phone' }]
    if (q.sql.includes('consolidation-inbox-identity')) return [{ phone: 'phone' }]
    if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
    if (q.sql.includes('conversation-claims-assert')) return [{ jobCount: 1n, dispatchCount: 1n }]
    if (q.sql.includes('conversation-feature-lock')) return []
    if (q.sql.includes('conversation-inbox-lock')) return [row]
    if (q.sql.includes('consolidation-previous')) return []
    if (q.sql.includes('consolidation-candidates')) return envelope.eventIds.map(id => ({ id, admittedAt: now, payload: row.payload, actionType: 'input.initial', scopeMatches: true }))
    if (q.sql.includes('conversation-order')) return [{ blocked: false }]
    if (q.sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
    if (q.sql.includes('conversation-turn-persist')) return [{ sessionCount: 1n, transitionCount: 1n, stepCount: 0n, conversationId: null, updatedAt: null }]
    if (q.sql.includes('conversation-settle-batch')) {
      legacySettlement = q
      return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }]
    }
    throw new Error('unexpected capture query')
  }
}
await processConversationInbox({ client: capture as never, job, lockSession: async () => ({ sessionId: 'session', conversationId: 'conversation',
  revision: 0n, status: 'ACTIVE', state, businessTimezone: 'UTC', handoffFenceEpoch: 0, handoffClaimsPausedAt: null,
  deploymentId: 'dep', deploymentGeneration: 1 }) as never, isRestart: () => false, projectInbound: async () => {}, writeView: async () => {},
  dialogueFactory: async () => ({ context: { businessId: 'biz', timezone: 'UTC', dbNow: now }, port: {
    catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) } }) })
assert.ok(legacySettlement)

let calls = 0
let lastSql: Prisma.Sql | undefined
function adapter(tx: Transaction) {
  return {
    async $queryRaw(q: Prisma.Sql) {
      if (q.sql.includes('conversation-terminal-inbox-reconcile')) return [] // Fixture has no historical exhausted inbox; dedicated SQL suite covers recovery.
      calls++; lastSql = q
      const result = await tx.query<Record<string, unknown>>(q.text, q.values)
      return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, key.endsWith('Count') ? BigInt(String(value)) : value])))
    },
    async $executeRaw(q: Prisma.Sql) { calls++; return (await tx.query(q.text,q.values)).affectedRows ?? 0 }
  }
}
const turn = { businessId: 'biz', sessionId: 'session', expectedRevision: 0n, revision: 1n, handoffFenceEpoch: 0,
  state: { ...state, flow: 'SERVICE_SELECT' }, transitionId: 'transition:session:1', deploymentId: 'dep', generation: 1,
  providerEventId: 'event', consolidation: envelope, admittedAt: now, actionType: 'conversation.message', step: 'BOOKING_IN_PROGRESS' as const }
const final = (reply: string) => ({ reply, toPhone: 'phone', dbNow: now, inboxId: 'inbox', coveredIds: envelope.eventIds,
  dispatchToken: 'dispatch-token', jobId: 'job', jobToken: 'job-token' })
const reset = async () => {
  await db.exec(`SET TIME ZONE 'UTC';TRUNCATE "BotSession","BotTransitionLog","Conversation","BotPrompt","BotOutbox","BotActionInbox","BotProviderEvent","BotDispatchClaim","BotJob","Audit";
    INSERT INTO "BotSession" VALUES ('session','biz','conversation','{}',0,'ACTIVE',NULL,0,NULL,NULL,NULL),
      ('foreign-session','foreign','foreign-conversation','{}',0,'ACTIVE',NULL,0,NULL,NULL,NULL);
    INSERT INTO "Conversation" VALUES ('conversation','biz','IDLE',NULL),('foreign-conversation','foreign','IDLE',NULL);
    INSERT INTO "BotPrompt" VALUES ('open','session','OPEN',NULL),('stabilizing','session','STABILIZING',NULL),
      ('resolved','session','RESOLVED',NULL),('foreign-prompt','foreign-session','OPEN',NULL);
    INSERT INTO "BotOutbox" VALUES ('old-sending','biz','session','previous','old-group',0,'informative_text','{}','previous:0','SENDING',NULL,'2100-01-01',NULL),
      ('old-unknown','biz','session','previous','old-group',1,'informative_text','{}','previous:1','UNKNOWN',NULL,'2100-01-01',NULL);
    INSERT INTO "BotActionInbox" VALUES ('inbox','biz','event','ADMITTED','old'),('covered','biz','b','CLAIMED','old'),('foreign-inbox','foreign','c','ADMITTED','old');
    INSERT INTO "BotProviderEvent" VALUES ('event','biz','ADMITTED'),('b','biz','ADMITTED'),('c','biz','ADMITTED'),
      ('d','biz','ADMITTED'),('e','biz','ADMITTED'),('foreign-event','foreign','ADMITTED');
    INSERT INTO "BotDispatchClaim" VALUES ('claim','dispatch-token','CLAIMED',NULL),('foreign-claim','foreign-token','CLAIMED',NULL);
    INSERT INTO "BotJob" VALUES ('job','job-token','LEASED','2100-01-01'::timestamptz,'old',NULL),
      ('foreign-job','foreign-token','LEASED','2100-01-01'::timestamptz,'old',NULL);`)
  calls = 0; lastSql = undefined
}
async function effects() {
  const tables = ['BotSession','BotTransitionLog','Conversation','BotPrompt','BotOutbox','BotActionInbox','BotProviderEvent','BotDispatchClaim','BotJob']
  const result: Record<string, unknown> = {}
  for (const table of tables) {
    const rows = (await db.query<Record<string, unknown>>(`SELECT * FROM "${table}" ORDER BY "id"`)).rows
    result[table] = rows.map(row => {
      const normalized = { ...row }
      for (const key of ['updatedAt','resolvedAt']) if (normalized[key] !== undefined) normalized[key] = normalized[key] === null ? null : 'db-timestamp'
      if (table === 'BotOutbox') { delete normalized['id']; delete normalized['deliveryGroupId'] }
      return normalized
    }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return result
}
try {
  await db.exec(`SET TIME ZONE 'UTC';
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TYPE "ConversationStep" AS ENUM ('BOOKING_IN_PROGRESS','IDLE');
    CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','INVALIDATED','RESOLVED');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','SENDING','UNKNOWN');
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"conversationId" text,"state" jsonb,"revision" bigint,"status" "BotSessionStatus",
      "handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" integer,"updatedAt" timestamptz,"draftTouchedAt" timestamptz,"draftExpiresAt" timestamptz);
    CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" integer,
      "revisionFrom" bigint,"revisionTo" bigint,"actionType" text,"outcome" text,"providerEventId" text,"detail" jsonb);
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY,"businessId" text,"currentStep" "ConversationStep","updatedAt" timestamptz);
    CREATE TABLE "BotPrompt" ("id" text PRIMARY KEY,"sessionId" text,"status" "BotPromptStatus","resolvedAt" timestamptz);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"deliveryGroupId" text,"sequence" integer,
      "kind" text,"payload" jsonb,"idempotencyKey" text UNIQUE,"status" "BotOutboxStatus","dependsOnSequence" integer,"availableAt" timestamptz,"updatedAt" timestamptz);

    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','CLAIMED','SELECTED','CONFLICT','PROCESSED','FAILED');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED','REJECTED');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','DONE');
    CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','DONE');
    CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY,"businessId" text,"providerEventId" text,"status" "BotInboxStatus","error" text);
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY,"businessId" text,"status" "BotProviderEventStatus");
    CREATE TABLE "BotDispatchClaim" ("id" text PRIMARY KEY,"claimToken" text,"status" "BotDispatchStatus","updatedAt" timestamptz);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY,"leaseToken" text,"status" "BotJobStatus","leasedUntil" timestamptz,"lastError" text,"updatedAt" timestamptz);
    CREATE TABLE "Audit" ("sequence" bigserial,"resource" text);
    CREATE FUNCTION audit_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO "Audit" ("resource") VALUES (TG_TABLE_NAME); RETURN NEW; END $$;
  `)
  for (const table of ['BotSession','BotTransitionLog','Conversation','BotPrompt','BotOutbox','BotActionInbox','BotProviderEvent','BotDispatchClaim','BotJob']) {
    await db.exec(`SET TIME ZONE 'UTC';CREATE TRIGGER write_audit AFTER INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION audit_write()`)
  }
  const reply = 'á😀'.repeat(5000)
  const plan = planPersistedView({ view: textView(reply), toPhone: 'phone', transitionId: turn.transitionId, promptToken: '', idFactory: () => 'unused' })
  assert.ok(plan.outboxRows.length > 1, 'regression must exercise unicode multi-part output')
  await reset()
  await db.transaction(async sql => {
    const tx = adapter(sql)
    await persistConversationTurnTx(tx as never, turn)
    await persistView(tx as never, { ...turn, view: textView(reply), toPhone: 'phone', dbNow: now })
    await tx.$queryRaw(legacySettlement!)
  })
  assert.equal(calls, 3, 'the legacy turn/view/settlement needs three SQL trips')
  const old = await effects()
  await reset()
  let update: Awaited<ReturnType<typeof persistConversationTurnTx>> = null
  await db.transaction(async sql => { update = await persistConversationTurnTx(adapter(sql) as never, { ...turn, finalizeText: final(reply) }) })
  assert.equal(calls, 1)
  assert.ok(update)
  assert.deepEqual(await effects(), old, 'old/new logical state, transition, prompt, outbox and settlement effects agree')
  const outbox = (await db.query<{ sequence: number; deliveryGroupId: string; idempotencyKey: string; dependsOnSequence: number | null; payload: { item: { body: string }; consolidation: unknown } }>(
    `SELECT * FROM "BotOutbox" WHERE "transitionId"='transition:session:1' ORDER BY "sequence"`)).rows
  assert.equal(new Set(outbox.map(row => row.deliveryGroupId)).size, 1)
  for (const [index,row] of outbox.entries()) {
    assert.equal(row.sequence,index); assert.equal(row.idempotencyKey,`${turn.transitionId}:${index}`)
    assert.equal(row.dependsOnSequence,plan.outboxRows[index]!.dependsOnSequence)
    assert.equal(row.payload.item.body,plan.outboxRows[index]!.item.type === 'informative_text' ? plan.outboxRows[index]!.item.body : '')
    assert.deepEqual(row.payload.consolidation,envelope)
    assert.doesNotMatch(row.payload.item.body,/[\uD800-\uDBFF]$/)
    assert.doesNotMatch(row.payload.item.body,/^[\uDC00-\uDFFF]/)
  }
  const explained = await db.query<Record<string, unknown>>(`EXPLAIN (FORMAT JSON) ${lastSql!.text}`,lastSql!.values)
  const rendered = JSON.stringify(explained.rows[0]?.['QUERY PLAN'])
  for (const cte of ['saved_session','inserted_transition','projected_step','step_done','invalidated','prompt_done','inserted_outbox','settled_inbox','covered_inbox','settled_event','event_done','settled_dispatch','settled_job']) assert.ok(rendered.includes(cte),cte)
  const order = (await db.query<{ resource: string }>(`SELECT "resource" FROM "Audit" ORDER BY "sequence"`)).rows.map(row=>row.resource)
  const last = (table: string) => order.lastIndexOf(table)
  assert.ok(last('BotSession') < last('BotTransitionLog') && last('BotTransitionLog') < last('Conversation'))
  assert.ok(last('Conversation') < last('BotPrompt') && last('BotPrompt') < last('BotOutbox'))
  assert.ok(last('BotOutbox') < last('BotActionInbox') && last('BotActionInbox') < last('BotProviderEvent'))
  assert.ok(last('BotProviderEvent') < last('BotDispatchClaim') && last('BotDispatchClaim') < last('BotJob'))

  const failures: Array<[string, RegExp]> = [
    [`UPDATE "BotSession" SET "revision"=2 WHERE "id"='session'`, /conversation revision lost/],
    [`UPDATE "BotSession" SET "status"='HUMAN_TAKEN' WHERE "id"='session'`, /conversation revision lost/],
    [`UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp() WHERE "id"='session'`, /conversation revision lost/],
    [`UPDATE "BotSession" SET "handoffFenceEpoch"=1 WHERE "id"='session'`, /conversation revision lost/],
    [`UPDATE "BotSession" SET "businessId"='foreign' WHERE "id"='session'`, /conversation revision lost/],
    [`UPDATE "BotActionInbox" SET "status"='FAILED' WHERE "id"='inbox'`, /conversation inbox settlement lost/],
    [`UPDATE "BotActionInbox" SET "businessId"='foreign' WHERE "id"='inbox'`, /conversation inbox settlement lost/],
    [`UPDATE "BotDispatchClaim" SET "claimToken"='other' WHERE "id"='claim'`, /cannot complete stale dispatch claim/],
    [`UPDATE "BotDispatchClaim" SET "status"='SENDING' WHERE "id"='claim'`, /cannot complete stale dispatch claim/],
    [`UPDATE "BotJob" SET "leaseToken"='other' WHERE "id"='job'`, /cannot complete stale bot job claim/],
    [`UPDATE "BotJob" SET "status"='DONE' WHERE "id"='job'`, /cannot complete stale bot job claim/]
  ]
  for (const [mutation,error] of failures) {
    await reset(); await db.exec(mutation)
    const before = await effects()
    await assert.rejects(db.transaction(async sql => { await persistConversationTurnTx(adapter(sql) as never, { ...turn, finalizeText: final(reply) }) }),error)
    assert.deepEqual(await effects(),before,'every effect rolls back on the exact failed count or fence')
  }
  // BEFORE triggers suppress writes without throwing; production must reject exact counters.
  for (const [table,error] of [['BotTransitionLog',/conversation transition row count mismatch/],['BotOutbox',/persist view row count mismatch/]] as const) {
    await reset()
    await db.exec(`SET TIME ZONE 'UTC';CREATE FUNCTION skip_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER skip_insert BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION skip_insert()`)
    const before = await effects()
    await assert.rejects(db.transaction(async sql => { await persistConversationTurnTx(adapter(sql) as never, { ...turn, finalizeText: final(reply) }) }),error)
    assert.deepEqual(await effects(),before)
    await db.exec(`SET TIME ZONE 'UTC';DROP TRIGGER skip_insert ON "${table}"; DROP FUNCTION skip_insert()`)
  }
  for (const mutation of [`DELETE FROM "BotProviderEvent" WHERE "businessId"='biz'`,`UPDATE "BotProviderEvent" SET "status"='REJECTED' WHERE "businessId"='biz'`]) {
    await reset(); await db.exec(mutation)
    await db.transaction(async sql => { await persistConversationTurnTx(adapter(sql) as never,{ ...turn,finalizeText:final('reply') }) })
    assert.equal((await db.query<{status:string}>(`SELECT "status" FROM "BotJob" WHERE "id"='job'`)).rows[0]!.status,'DONE','optional event count remains optional')
  }
  for (const sameStep of [true,false]) {
    await reset()
    if (sameStep) await db.exec(`UPDATE "Conversation" SET "currentStep"='BOOKING_IN_PROGRESS' WHERE "id"='conversation'`)
    const value = await db.transaction(sql => persistConversationTurnTx(adapter(sql) as never,{ ...turn,step: sameStep ? turn.step : null,finalizeText:final('reply') }))
    assert.equal(value,null,'unchanged or absent step produces no CRM update')
  }
  await reset()
  await db.exec(`SET TIME ZONE 'UTC';UPDATE "BotSession" SET "draftTouchedAt"='2100-01-01',"draftExpiresAt"='2100-01-02' WHERE "id"='session'`)
  await db.transaction(sql => persistConversationTurnTx(adapter(sql) as never,{ ...turn,finalizeText:final('reply') }))
  const durable = (await db.query<{ draftTouchedAt: Date; draftExpiresAt: Date; updatedAt: Date }>(`SELECT * FROM "BotSession" WHERE "id"='session'`)).rows[0]!
  assert.equal(durable.draftTouchedAt.toISOString(),'2100-01-01T00:00:00.000Z')
  assert.equal(durable.draftExpiresAt.toISOString(),'2100-01-02T00:00:00.000Z')
  assert.notEqual(durable.updatedAt.getTime(),now.getTime(),'durable writes use the DB clock')
  const timestampOrder = (await db.query<{ outbox: Date; dispatch: Date; job: Date }>(`SELECT
    (SELECT max("updatedAt") FROM "BotOutbox") AS outbox,
    (SELECT "updatedAt" FROM "BotDispatchClaim" WHERE "id"='claim') AS dispatch,
    (SELECT "updatedAt" FROM "BotJob" WHERE "id"='job') AS job`)).rows[0]!
  assert.ok(timestampOrder.outbox <= timestampOrder.dispatch && timestampOrder.dispatch <= timestampOrder.job)

  for (const failCommit of [false,true]) {
    await reset()
    const tracker = createQueueMilestoneTracker({ businessId:'biz', emit() {} })
    const operation = observeQueueProducerTransaction(tracker, body => db.transaction(async sql => {
      const result = await body(adapter(sql))
      if (failCommit) throw new Error('COMMIT failed')
      return result
    }), async tx => {
      await persistConversationTurnTx(tx as never,{ ...turn,finalizeText:final(reply) })
      assert.equal(tracker.retainedCount,plan.outboxRows.length,'registrations stage but are not committed ACK')
    })
    if (failCommit) {
      await assert.rejects(operation,/COMMIT failed/)
      assert.equal(tracker.retainedCount,0)
      assert.equal((await db.query<{ count:number }>(`SELECT count(*) FROM "BotOutbox" WHERE "transitionId"='transition:session:1'`)).rows[0]!.count,0)
    } else { await operation; assert.equal(tracker.retainedCount,plan.outboxRows.length) }
  }
  console.log('atomic text finalization SQL/equivalence/unicode/order/fences/counts/rollback/commit/milestones: PASS (no multi-session contention evidence)')
} finally { await db.close() }
