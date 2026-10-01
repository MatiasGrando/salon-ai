/** Real production guard SQL, disposable memory-only PostgreSQL/WASM; no remote connection. */
import assert from 'node:assert/strict'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { processConversationInbox } from '../src/conversational-bot/process-inbox-job.js'

const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1,
  configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } } }
const job = { id: 'job', kind: 'PROCESS_INBOX', aggregateId: 'inbox', businessId: 'biz', deploymentId: 'dep',
  deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: 'job-token',
  claimedUntil: new Date('2100-01-01'), queueWaitMs: 0 }
const db = new PGlite()
type Query = Prisma.Sql
let activeTx: Transaction | undefined
let txNumber = 0
let releases = 0
let guardCalls = 0
let reachedInbox = 0
let checkedDiscardedPlan = false
let afterGate: (() => Promise<void>) | undefined
const operations: string[] = []
const client = {
  async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
    txNumber++
    return db.transaction(async tx => {
      activeTx = tx
      try { return await operation(client) } finally { activeTx = undefined }
    })
  },
  async $executeRaw(q: Query) {
    if (!activeTx) { releases++; operations.push('cleanup'); return 1 }
    if (txNumber === 1) return 1 // Existing acquisition is outside this focused regression.
    const shared = q.sql.includes('pg_advisory_xact_lock_shared')
    assert.ok(shared || q.sql.includes('pg_advisory_xact_lock('), 'only the cutover and phone gates precede guard query')
    operations.push(shared ? 'gate' : 'phone')
    await activeTx.query(q.text, q.values)
    if (shared) await afterGate?.()
    return 1
  },
  async $queryRaw(q: Query) {
    if (q.sql.includes('consolidation-inbox-identity')) { operations.push('identity'); return [{ phone: 'phone' }] }
    if (q.sql.includes('conversation-turn-persist')) return [{ sessionCount: 1n, stepCount: 0n, conversationId: null, updatedAt: null }]
    if (q.sql.includes('conversation-policy')) return [config]
    if (q.sql.includes('conversation-target')) return [{ fenceEpoch: 1 }]
    if (txNumber === 1 && q.sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
    if (q.sql.includes('conversation-claims-assert')) {
      assert.ok(activeTx)
      guardCalls++
      assert.equal(operations.filter(step => step === 'gate').length, 1, 'one standalone cutover acquisition per transaction')
      assert.deepEqual(operations, ['gate', 'identity', 'phone'], 'fresh validation follows shared cutover then identity and phone lock')
      assert.ok(!q.sql.includes('pg_advisory_xact_lock_shared'))
      assert.match(q.sql, /locked_job AS MATERIALIZED/)
      assert.match(q.sql, /locked_dispatch AS MATERIALIZED/)
      assert.match(q.sql, /FROM locked_job validated_job[\s\S]*CROSS JOIN LATERAL/)
      assert.match(q.sql, /FOR UPDATE OF j[\s\S]*FOR UPDATE OF c/, 'dependent row locks keep job-before-dispatch order')
      // Inspect PostgreSQL's real plan, not just SQL spelling: dispatch LockRows consumes the job CTE.
      const explained = await activeTx.query<Record<string, unknown>>(`EXPLAIN (FORMAT JSON) ${q.text}`, q.values)
      const plan = explained.rows[0]?.['QUERY PLAN']
      const nodes = (value: unknown): Record<string, unknown>[] => {
        if (Array.isArray(value)) return value.flatMap(nodes)
        if (typeof value !== 'object' || value === null) return []
        const node = value as Record<string, unknown>
        return [node, ...Object.values(node).flatMap(nodes)]
      }
      const assertDriver = (tree: unknown) => {
        const dispatchPlan = nodes(tree).find(node => node['Subplan Name'] === 'CTE locked_dispatch')
        assert.ok(dispatchPlan, 'dispatch materialization remains a separate plan')
        const lateralLoop = nodes(dispatchPlan).find(node => node['Node Type'] === 'Nested Loop'
          && Array.isArray(node['Plans']) && (node['Plans'][0] as Record<string, unknown>)['CTE Name'] === 'locked_job')
        assert.ok(lateralLoop, 'job CTE must be the outer driver, not just a sibling of dispatch predicates')
        const children = lateralLoop['Plans'] as Record<string, unknown>[]
        const dependentDispatch = children[1]
        assert.ok(dependentDispatch)
        assert.ok(nodes(dependentDispatch).some(node => node['Node Type'] === 'LockRows'), 'dispatch row lock stays in dependent inner plan')
        assert.ok(nodes(dependentDispatch).some(node => Object.values(node).some(value => typeof value === 'string'
          && value.includes('validated_job.'))), 'inner dispatch predicates remain parameterized by the completed job tuple')
      }
      assertDriver(plan)
      if (!checkedDiscardedPlan) {
        // Negative control of the discarded ON TRUE design; production code is never weakened for this check.
        const unordered = q.text
          .replace(/SELECT validated_claim\."id" FROM locked_job validated_job\s+CROSS JOIN LATERAL \(\s+SELECT c\."id" FROM "BotDispatchClaim" c/,
            'SELECT c."id" FROM "BotDispatchClaim" c JOIN locked_job validated_job ON TRUE')
          .replace(/\s+AND c\."businessId" = validated_job\."businessId"/, '')
          .replace(/\s+OFFSET 0\s+FOR UPDATE OF c\s+\) validated_claim/, ' FOR UPDATE OF c')
        assert.notEqual(unordered, q.text)
        const discarded = await activeTx.query<Record<string, unknown>>(`EXPLAIN (FORMAT JSON) ${unordered}`, q.values)
        assert.throws(() => assertDriver(discarded.rows[0]?.['QUERY PLAN']), /job CTE must be the outer driver/,
          'plan regression rejects the discarded unordered variant, without executing its claim SQL')
        checkedDiscardedPlan = true
      }
      operations.push('guards')
      const result = await activeTx.query<{ jobCount: string | number | bigint; dispatchCount: string | number | bigint }>(q.text, q.values)
      return result.rows.map(row => ({ jobCount: BigInt(row.jobCount), dispatchCount: BigInt(row.dispatchCount) }))
    }
    if (q.sql.includes('conversation-feature-lock')) { operations.push('features'); return [] }
    if (q.sql.includes('conversation-inbox-lock')) { reachedInbox++; throw new Error('GUARDS_PASSED') }
    throw new Error(`unexpected query before combined guard: ${q.sql.slice(0, 90)}`)
  }
}
const run = () => processConversationInbox({ client: client as never, job,
  writeView: async () => { throw new Error('outbox must not be reached') },
  projectInbound: async () => { throw new Error('projection must not be reached') },
  lockSession: async () => { throw new Error('session must not be reached') }, isRestart: () => false })
const reset = async () => {
  await db.exec(`TRUNCATE "BotJob", "BotDispatchClaim", "BotSession", "BotChannelDeployment";
    INSERT INTO "BotChannelDeployment" VALUES ('dep','biz','WHATSAPP',1,'cfg',1,NULL,1);
    INSERT INTO "BotJob" VALUES ('job','biz','dep',1,'LEASED','job-token',clock_timestamp()+interval '1 hour');
    INSERT INTO "BotDispatchClaim" VALUES ('claim','biz','WHATSAPP',NULL,1,1,NULL,'CLAIMED','dispatch-token',clock_timestamp()+interval '1 hour');`)
  txNumber = releases = guardCalls = reachedInbox = 0
  operations.length = 0
  afterGate = undefined
}
try {
  await db.exec(`
    CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','DONE');
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','DONE');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TABLE "BotChannelDeployment" ("id" text PRIMARY KEY,"businessId" text,"channel" "BotChannel",
      "generation" int,"activeConfigurationId" text,"legacyDispatchCoverageVersion" int,"claimsPausedAt" timestamptz,"dispatchFenceEpoch" int);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY,"businessId" text,"deploymentId" text,"deploymentGeneration" int,
      "status" "BotJobStatus","leaseToken" text,"leasedUntil" timestamptz);
    CREATE TABLE "BotDispatchClaim" ("id" text PRIMARY KEY,"businessId" text,"channel" "BotChannel","sessionId" text,
      "generation" int,"fenceEpoch" int,"handoffFenceEpoch" int,"status" "BotDispatchStatus","claimToken" text,"claimedUntil" timestamptz);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"status" "BotSessionStatus","handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" int);
  `)
  await reset()
  await assert.rejects(run(), /GUARDS_PASSED/)
  assert.equal(guardCalls, 1)
  assert.deepEqual(operations, ['gate', 'identity', 'phone', 'guards', 'features', 'cleanup'])
  assert.equal(releases, 1, 'unsettled transaction releases dispatch through existing cleanup')

  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['job token', `UPDATE "BotJob" SET "leaseToken"='other'`, /stale or fenced bot job claim/],
    ['job tenant', `UPDATE "BotJob" SET "businessId"='foreign'`, /stale or fenced bot job claim/],
    ['job id', `UPDATE "BotJob" SET "id"='other'`, /stale or fenced bot job claim/],
    ['job status', `UPDATE "BotJob" SET "status"='DONE'`, /stale or fenced bot job claim/],
    ['job expired', `UPDATE "BotJob" SET "leasedUntil"=clock_timestamp()-interval '1 second'`, /stale or fenced bot job claim/],
    ['job deployment', `UPDATE "BotJob" SET "deploymentId"='other'`, /stale or fenced bot job claim/],
    ['job generation', `UPDATE "BotJob" SET "deploymentGeneration"=2`, /stale or fenced bot job claim/],
    ['deployment generation', `UPDATE "BotChannelDeployment" SET "generation"=2`, /stale or fenced bot job claim/],
    ['deployment config', `UPDATE "BotChannelDeployment" SET "activeConfigurationId"=NULL`, /stale or fenced bot job claim/],
    ['deployment coverage', `UPDATE "BotChannelDeployment" SET "legacyDispatchCoverageVersion"=0`, /stale or fenced bot job claim/],
    ['deployment paused', `UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp()`, /stale or fenced bot job claim/],
    ['dispatch token', `UPDATE "BotDispatchClaim" SET "claimToken"='other'`, /stale or fenced dispatch claim/],
    ['dispatch tenant', `UPDATE "BotDispatchClaim" SET "businessId"='foreign'`, /stale or fenced dispatch claim/],
    ['dispatch status', `UPDATE "BotDispatchClaim" SET "status"='SENDING'`, /stale or fenced dispatch claim/],
    ['dispatch expired', `UPDATE "BotDispatchClaim" SET "claimedUntil"=clock_timestamp()-interval '1 second'`, /stale or fenced dispatch claim/],
    ['dispatch generation', `UPDATE "BotDispatchClaim" SET "generation"=2`, /stale or fenced dispatch claim/],
    ['dispatch fence', `UPDATE "BotDispatchClaim" SET "fenceEpoch"=2`, /stale or fenced dispatch claim/],
    ['dispatch missing session', `UPDATE "BotDispatchClaim" SET "sessionId"='session'`, /stale or fenced dispatch claim/],
    ['dispatch session tenant', `INSERT INTO "BotSession" VALUES ('session','foreign','ACTIVE',NULL,0); UPDATE "BotDispatchClaim" SET "sessionId"='session',"handoffFenceEpoch"=0`, /stale or fenced dispatch claim/],
    ['dispatch human taken', `INSERT INTO "BotSession" VALUES ('session','biz','HUMAN_TAKEN',NULL,0); UPDATE "BotDispatchClaim" SET "sessionId"='session',"handoffFenceEpoch"=0`, /stale or fenced dispatch claim/],
    ['dispatch handoff paused', `INSERT INTO "BotSession" VALUES ('session','biz','ACTIVE',clock_timestamp(),0); UPDATE "BotDispatchClaim" SET "sessionId"='session',"handoffFenceEpoch"=0`, /stale or fenced dispatch claim/],
    ['dispatch handoff fence', `INSERT INTO "BotSession" VALUES ('session','biz','ACTIVE',NULL,1); UPDATE "BotDispatchClaim" SET "sessionId"='session',"handoffFenceEpoch"=0`, /stale or fenced dispatch claim/],
    ['both invalid prefer job', `UPDATE "BotJob" SET "leaseToken"='other'; UPDATE "BotDispatchClaim" SET "claimToken"='other'`, /stale or fenced bot job claim/]
  ]
  for (const [label, mutation, error] of cases) {
    await reset()
    await db.exec(mutation)
    await assert.rejects(run(), error, label)
    assert.equal(guardCalls, 1, label)
    assert.equal(reachedInbox, 0, label)
    assert.equal(releases, 1, label)
  }
  // Controlled adversarial scheduling, not cross-connection contention: change target after the gate await.
  await reset()
  afterGate = async () => { await activeTx!.exec(`UPDATE "BotChannelDeployment" SET "generation"=2`) }
  await assert.rejects(run(), /stale or fenced bot job claim/)
  const rolledBack = await db.query<{ generation: number }>(`SELECT "generation" FROM "BotChannelDeployment"`)
  assert.equal(rolledBack.rows[0]!.generation, 1, 'gate/body mutations roll back on failed claim assertion')
  assert.equal(releases, 1)
  // DB clock remains authoritative on every validation, not a cached application timestamp.
  await reset()
  afterGate = async () => { await activeTx!.exec(`UPDATE "BotDispatchClaim" SET "claimedUntil"=clock_timestamp()-interval '1 second'`) }
  await assert.rejects(run(), /stale or fenced dispatch claim/)
  assert.equal(reachedInbox, 0)
  console.log('conversational batched claims real SQL/predicates/order/rollback/cleanup: PASS (multi-session contention not covered)')
} finally { await db.close() }
