/** Executes production settlement SQL in disposable memory-only PostgreSQL/WASM. */
import assert from 'node:assert/strict'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import type { Prisma } from '../src/generated/prisma/client.js'
import { processConversationInbox } from '../src/conversational-bot/process-inbox-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { withAttemptMetrics, type AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'

const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1,
  configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } } }
const now = new Date('2026-10-01T12:00:00Z')
const row = { ...config, id: 'inbox', deploymentGeneration: 1, fenceEpoch: 1, providerEventId: 'event', providerMessageId: 'msg',
  status: 'ADMITTED', dbNow: now, businessTimezone: 'UTC', admittedAt: now, providerOccurredAt: now, botEnabled: true,
  payload: { fromPhone: 'phone', textBody: 'restart', messageType: 'text', contextWindowEvaluated: true } }
const session = { sessionId: 'session', conversationId: 'conversation', revision: 0n, status: 'ACTIVE',
  state: createInitialBotOptionsState(), businessTimezone: 'UTC', handoffFenceEpoch: 0, handoffClaimsPausedAt: null,
  deploymentId: 'dep', deploymentGeneration: 1 }
const job = { id: 'job', kind: 'PROCESS_INBOX', aggregateId: 'inbox', businessId: 'biz', deploymentId: 'dep',
  deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: 'job-token',
  claimedUntil: new Date('2100-01-01'), queueWaitMs: 0 }
const db = new PGlite()
let activeTx: Transaction | undefined
let batchCalls = 0
let releases = 0
let mutation = ''
let failCommit = false
let observedOrder: string[] = []
let checkedPlan = false
const metrics: AttemptMetricEvent[] = []
const client = {
  async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      activeTx = tx
      try {
        const result = await operation(client)
        if (failCommit && batchCalls) throw new Error('COMMIT failed')
        return result
      } finally { activeTx = undefined }
    })
  },
  async $executeRaw(_q: Prisma.Sql) { if (!activeTx) releases++; return 1 }, // Non-settlement orchestration is stubbed.
  async $queryRaw(q: Prisma.Sql) {
    if (q.sql.includes('conversation-policy')) return [config]
    if (q.sql.includes('conversation-target')) return [{ fenceEpoch: 1 }]
    if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
    if (q.sql.includes('conversation-claims-assert')) return [{ jobCount: 1n, dispatchCount: 1n }]
    if (q.sql.includes('conversation-feature-lock')) return []
    if (q.sql.includes('conversation-inbox-lock')) return [row]
    if (q.sql.includes('conversation-order')) return [{ blocked: false }]
    if (q.sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
    if (q.sql.includes('UPDATE "Conversation" conversation')) return []
    if (q.sql.includes('conversation-settle-batch')) {
      assert.ok(activeTx)
      batchCalls++
      if (!checkedPlan) {
        const explained = await activeTx.query<Record<string, unknown>>(`EXPLAIN (FORMAT JSON) ${q.text}`, q.values)
        const rendered = JSON.stringify(explained.rows[0]?.['QUERY PLAN'])
        for (const dependency of ['settled_inbox', 'settled_event', 'event_done', 'settled_dispatch', 'settled_job'])
          assert.ok(rendered.includes(dependency), `real plan retains ${dependency}`)
        assert.match(q.sql, /FROM event_done[\s\S]*event_done\."completed" >= 0/,
          'aggregate barrier consumes completion, not existence, of the optional event update')
        assert.match(q.sql, /count\(\*\) FROM settled_dispatch\) = 1/)
        assert.ok(!q.sql.includes('pg_advisory'), 'settlement does not move the cutover gate into its snapshot')
        checkedPlan = true
      }
      const result = await activeTx.query<{ inboxCount: number | string; dispatchCount: number | string; jobCount: number | string }>(q.text, q.values)
      observedOrder = (await activeTx.query<{ resource: string }>(`SELECT "resource" FROM "Audit" ORDER BY "sequence"`)).rows.map(item => item.resource)
      return result.rows.map(item => ({ inboxCount: BigInt(item.inboxCount), dispatchCount: BigInt(item.dispatchCount), jobCount: BigInt(item.jobCount) }))
    }
    throw new Error(`unexpected query: ${q.sql.slice(0, 100)}`)
  }
}
const run = () => withAttemptMetrics({ jobId: job.id, attempt: 1 }, () => processConversationInbox({ client: client as never, job,
  lockSession: async () => structuredClone(session) as never, isRestart: () => true, projectInbound: async () => {},
  writeView: async () => {
    assert.ok(activeTx)
    await activeTx.exec(`INSERT INTO "BotOutbox" VALUES ('outbox','durable-reply')`)
    if (mutation) await activeTx.exec(mutation)
    await activeTx.exec('TRUNCATE "Audit"') // Remove fault-injection audit rows, not settlement evidence.
  },
  dialogueFactory: async () => ({ context: { businessId: 'biz', timezone: 'UTC', dbNow: now }, port: {
    catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) } })
}), { emit: event => { metrics.push(event) } })
const reset = async () => {
  await db.exec(`TRUNCATE "Audit", "BotActionInbox", "BotProviderEvent", "BotDispatchClaim", "BotJob", "BotOutbox";
    INSERT INTO "BotActionInbox" VALUES ('inbox','biz','ADMITTED','old-error'),('foreign-inbox','foreign','ADMITTED','untouched');
    INSERT INTO "BotProviderEvent" VALUES ('event','biz','ADMITTED'),('foreign-event','foreign','ADMITTED');
    INSERT INTO "BotDispatchClaim" VALUES ('claim','dispatch-token','CLAIMED',NULL),('foreign-claim','foreign-token','CLAIMED',NULL);
    INSERT INTO "BotJob" VALUES ('job','job-token','LEASED',clock_timestamp()+interval '1 hour','old-error',NULL),
      ('foreign-job','foreign-token','LEASED',clock_timestamp()+interval '1 hour','untouched',NULL);`)
  batchCalls = releases = 0
  mutation = ''
  failCommit = false
  observedOrder = []
  metrics.length = 0
}
const state = async () => (await db.query<Record<string, unknown>>(`SELECT
  (SELECT "status"::text FROM "BotActionInbox" WHERE "id"='inbox') AS inbox,
  (SELECT "status"::text FROM "BotProviderEvent" WHERE "id"='event') AS event,
  (SELECT "status"::text FROM "BotDispatchClaim" WHERE "id"='claim') AS dispatch,
  (SELECT "status"::text FROM "BotJob" WHERE "id"='job') AS job,
  (SELECT count(*) FROM "BotOutbox") AS outbox`)).rows[0]!
try {
  await db.exec(`
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','PROCESSED','FAILED');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED','REJECTED');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','DONE');
    CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','DONE');
    CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY,"businessId" text,"status" "BotInboxStatus","error" text);
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY,"businessId" text,"status" "BotProviderEventStatus");
    CREATE TABLE "BotDispatchClaim" ("id" text PRIMARY KEY,"claimToken" text,"status" "BotDispatchStatus","updatedAt" timestamptz);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY,"leaseToken" text,"status" "BotJobStatus","leasedUntil" timestamptz,"lastError" text,"updatedAt" timestamptz);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"payload" text);
    CREATE TABLE "Audit" ("sequence" bigserial,"resource" text,"at" timestamptz DEFAULT clock_timestamp());
    CREATE FUNCTION log_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO "Audit" ("resource") VALUES (TG_TABLE_NAME); RETURN NEW; END $$;
    CREATE TRIGGER inbox_audit AFTER UPDATE ON "BotActionInbox" FOR EACH ROW EXECUTE FUNCTION log_settlement();
    CREATE TRIGGER event_audit AFTER UPDATE ON "BotProviderEvent" FOR EACH ROW EXECUTE FUNCTION log_settlement();
    CREATE TRIGGER dispatch_audit AFTER UPDATE ON "BotDispatchClaim" FOR EACH ROW EXECUTE FUNCTION log_settlement();
    CREATE TRIGGER job_audit AFTER UPDATE ON "BotJob" FOR EACH ROW EXECUTE FUNCTION log_settlement();
  `)
  await reset()
  assert.equal(await run(), 'PROCESSED')
  assert.equal(batchCalls, 1, 'one real production settlement query')
  assert.deepEqual(observedOrder, ['BotActionInbox', 'BotProviderEvent', 'BotDispatchClaim', 'BotJob'])
  assert.deepEqual(await state(), { inbox: 'PROCESSED', event: 'PROCESSED', dispatch: 'DONE', job: 'DONE', outbox: 1 })
  assert.equal(releases, 0, 'committed settlement suppresses cleanup')
  assert.ok(metrics.some(event => event.stage === 'conversation_settlement' && event.outcome === 'ok'))
  const cleared = (await db.query<Record<string, unknown>>(`SELECT "leaseToken","leasedUntil","lastError","updatedAt" FROM "BotJob" WHERE "id"='job'`)).rows[0]!
  assert.equal(cleared['leaseToken'], null); assert.equal(cleared['leasedUntil'], null); assert.equal(cleared['lastError'], null)
  assert.ok(cleared['updatedAt'] instanceof Date)
  const dispatchAt = (await db.query<{ updatedAt: Date }>(`SELECT "updatedAt" FROM "BotDispatchClaim" WHERE "id"='claim'`)).rows[0]!.updatedAt
  assert.ok(dispatchAt instanceof Date)
  assert.ok(dispatchAt.getTime() <= (cleared['updatedAt'] as Date).getTime(), 'DB timestamps follow dependent dispatch-to-job updates')
  assert.notEqual(dispatchAt.getTime(), now.getTime(), 'application clock is not substituted for clock_timestamp')
  const foreign = (await db.query<Record<string, unknown>>(`SELECT "status"::text FROM "BotActionInbox" WHERE "id"='foreign-inbox'`)).rows[0]!
  assert.equal(foreign['status'], 'ADMITTED')

  // Optional event settlement has no required row count and no prior-status condition.
  for (const setup of [`DELETE FROM "BotProviderEvent" WHERE "id"='event'`,
    `UPDATE "BotProviderEvent" SET "businessId"='foreign' WHERE "id"='event'`,
    `UPDATE "BotProviderEvent" SET "status"='REJECTED' WHERE "id"='event'`]) {
    await reset(); await db.exec(setup); await db.exec('TRUNCATE "Audit"')
    const matchedEvent = (await db.query(`SELECT "id" FROM "BotProviderEvent" WHERE "id"='event' AND "businessId"='biz'`)).rows.length === 1
    assert.equal(await run(), 'PROCESSED')
    assert.deepEqual(observedOrder, matchedEvent ? ['BotActionInbox','BotProviderEvent','BotDispatchClaim','BotJob']
      : ['BotActionInbox','BotDispatchClaim','BotJob'], 'zero event rows still completes event barrier before dispatch/job')
    assert.equal((await state())['dispatch'], 'DONE')
    assert.equal((await state())['job'], 'DONE')
  }
  const cases: ReadonlyArray<readonly [string, string, RegExp, readonly string[]]> = [
    ['inbox status', `UPDATE "BotActionInbox" SET "status"='FAILED' WHERE "id"='inbox'`, /conversation inbox settlement lost/, []],
    ['inbox tenant', `UPDATE "BotActionInbox" SET "businessId"='foreign' WHERE "id"='inbox'`, /conversation inbox settlement lost/, []],
    ['dispatch token', `UPDATE "BotDispatchClaim" SET "claimToken"='other' WHERE "id"='claim'`, /cannot complete stale dispatch claim/, ['BotActionInbox','BotProviderEvent']],
    ['dispatch status', `UPDATE "BotDispatchClaim" SET "status"='SENDING' WHERE "id"='claim'`, /cannot complete stale dispatch claim/, ['BotActionInbox','BotProviderEvent']],
    ['job token', `UPDATE "BotJob" SET "leaseToken"='other' WHERE "id"='job'`, /cannot complete stale bot job claim/, ['BotActionInbox','BotProviderEvent','BotDispatchClaim']],
    ['job status', `UPDATE "BotJob" SET "status"='DONE' WHERE "id"='job'`, /cannot complete stale bot job claim/, ['BotActionInbox','BotProviderEvent','BotDispatchClaim']],
    ['inbox error first', `UPDATE "BotActionInbox" SET "status"='FAILED' WHERE "id"='inbox'; UPDATE "BotDispatchClaim" SET "claimToken"='other' WHERE "id"='claim'; UPDATE "BotJob" SET "leaseToken"='other' WHERE "id"='job'`, /conversation inbox settlement lost/, []],
    ['dispatch error before job', `UPDATE "BotDispatchClaim" SET "claimToken"='other' WHERE "id"='claim'; UPDATE "BotJob" SET "leaseToken"='other' WHERE "id"='job'`, /cannot complete stale dispatch claim/, ['BotActionInbox','BotProviderEvent']]
  ]
  for (const [label, change, error, expected] of cases) {
    await reset(); mutation = change
    await assert.rejects(run(), error, label)
    assert.deepEqual(observedOrder, expected, label)
    assert.deepEqual(await state(), { inbox: 'ADMITTED', event: 'ADMITTED', dispatch: 'CLAIMED', job: 'LEASED', outbox: 0 }, label)
    assert.equal(releases, 1, label)
    assert.ok(metrics.some(event => event.stage === 'conversation_settlement' && event.outcome === 'error'), label)
  }
  await reset(); failCommit = true
  await assert.rejects(run(), /COMMIT failed/)
  assert.deepEqual(await state(), { inbox: 'ADMITTED', event: 'ADMITTED', dispatch: 'CLAIMED', job: 'LEASED', outbox: 0 })
  assert.equal(releases, 1)
  console.log('conversational settlement real SQL/order/counts/optional-event/outbox rollback: PASS (multi-session contention not covered)')
} finally { await db.close() }