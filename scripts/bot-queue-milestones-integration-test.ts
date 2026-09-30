import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaAuthoritativeAdmissionRepository, upsertJob } from '../src/bot-options/infrastructure/prisma-admission.js'
import { persistView } from '../src/bot-options/application/process-session-job.js'
import { processProviderEventJob } from '../src/bot-options/application/process-provider-event-job.js'
import { textView } from '../src/bot-options/domain/views.js'
import { startPostgresWorkerLoop, type ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'
import { startOutboxSenderLoop } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'
import { startBarberWorkerLoops } from '../src/barber-local/runtime.js'
import { BARBER_DEMO_BUSINESS_ID } from '../src/barber-local/ingress.js'
import { createWorkerWakeSignal } from '../src/bot-options/infrastructure/worker-wake.js'
import { createQueueMilestoneTracker, jobQueueKey, outboxQueueKey, observeQueueProducerTransaction,
  recordProducedQueueResource, type QueueMilestoneKey, type QueueMilestoneDiagnostic } from '../src/bot-options/observability/queue-milestones.js'

type Query = { strings: readonly string[]; values: unknown[] }
const tenant = BARBER_DEMO_BUSINESS_ID
let time = 100
const events: QueueMilestoneDiagnostic[] = []
const tracker = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit: event => { events.push(event) } })
function consume(key: QueueMilestoneKey, target = tracker) {
  time += 10
  const claim = target.beginClaim()
  time += 20
  target.claimEnded(claim, key, 1)
  time += 5
  target.handlerStarted(claim)
  return events.at(-1)!
}
const txRun = async <T>(body: (tx: object) => Promise<T>) => body({})
const original = new Error('private rollback/commit error')

// Existing executeRaw and void contract; count zero must not publish a marker.
for (const count of [1, 0]) {
  let writes = 0
  const tx = { async $executeRaw() { writes++; return count } }
  const value = await observeQueueProducerTransaction(tracker, async body => body(tx), current =>
    upsertJob(current as never, 'PROCESS_INBOX', 'inbox-' + count, tenant, 'deployment', 1, null, new Date()))
  assert.equal(value, undefined)
  assert.equal(writes, 1)
  assert.equal(consume(jobQueueKey({ businessId: tenant, kind: 'PROCESS_INBOX', aggregateId: 'inbox-' + count })).readiness,
    count === 1 ? 'observed' : 'unavailable', 'upsert must register only an affected producer statement')
}

const route = { kind: 'new' as const, businessId: tenant, deploymentId: 'deployment', generation: 1,
  appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null }
for (const mode of ['commit', 'duplicate', 'rollback', 'off'] as const) {
  const sql: string[] = []
  let aggregate = ''
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => { release = resolve })
  const client = { async $transaction<T>(body: (tx: unknown) => Promise<T>) {
    const result = await body({
      async $executeRaw(query: Query) { sql.push(query.strings?.join('?') ?? String(query)); return 1 },
      async $queryRaw(query: Query) {
        const statement = query.strings.join('?'); sql.push(statement)
        if (statement.includes('INSERT INTO "BotProviderEvent"')) return mode === 'duplicate' ? [] : [{ id: query.values[0] }]
        return [{ id: 'deployment', generation: 1 }]
      }
    })
    const insert = sql.find(statement => statement.includes('INSERT INTO "BotJob"'))
    assert.equal(Boolean(insert), mode !== 'duplicate')
    await acknowledgement
    if (mode === 'rollback') throw original
    return result
  } }
  // Capture the generated aggregate from the same existing write, without SQL reads.
  const wrapped = { async $transaction<T>(body: (tx: never) => Promise<T>) {
    return client.$transaction(async (tx: unknown) => {
      const inner = tx as { $executeRaw(query: Query): Promise<number>; $queryRaw(query: Query): Promise<unknown> }
      return body({ ...inner, async $executeRaw(query: Query) {
        if (query.strings?.join('?').includes('INSERT INTO "BotJob"')) aggregate = String(query.values[2])
        return inner.$executeRaw(query)
      } } as never)
    })
  } }
  const repository = new PrismaAuthoritativeAdmissionRepository(wrapped as never, { queueMilestones: mode === 'off' ? undefined : tracker })
  const operation = repository.admitAuthoritative({ route, phoneNumberId: 'phone-id', events: [{ kind: 'unsupported_change', eventKey: 'synthetic' }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!events.some(event => event.resourceRef === jobQueueKey({ businessId: tenant, kind: 'PROCESS_PROVIDER_EVENT', aggregateId: aggregate }).resourceRef))
  time += 10
  release()
  if (mode === 'rollback') {
    const saved = console.error; console.error = () => {}
    try { await assert.rejects(operation, error => error === original) } finally { console.error = saved }
  } else assert.deepEqual(await operation, { eventCount: 1, insertedCount: mode === 'duplicate' ? 0 : 1 })
  assert.equal(consume(jobQueueKey({ businessId: tenant, kind: 'PROCESS_PROVIDER_EVENT', aggregateId: aggregate })).readiness,
    mode === 'commit' ? 'observed' : 'unavailable')
  assert.equal(sql.length, mode === 'duplicate' ? 5 : 6, 'instrumentation performs no additional SQL')
}

// Outbox keys come from the already-checked plan/RETURNING counts.
for (const mode of ['commit', 'bad-count', 'rollback'] as const) {
  const id = 'outbox-' + mode
  let queries = 0
  const tx = { async $queryRaw() { queries++; return [{ choiceCount: 0n, outboxCount: mode === 'bad-count' ? 0n : 1n }] } }
  const operation = observeQueueProducerTransaction(tracker, async body => {
    const result = await body(tx)
    if (mode === 'rollback') throw original
    return result
  }, current => persistView(current as never, { businessId: tenant, sessionId: 'session', revision: 1n,
    transitionId: 'transition:session:1', toPhone: 'private-phone', view: textView('private text'), dbNow: new Date(), idFactory: () => id }))
  if (mode === 'bad-count') await assert.rejects(operation, /row count mismatch/)
  else if (mode === 'rollback') await assert.rejects(operation, error => error === original)
  else assert.equal(await operation, undefined)
  assert.equal(queries, 1)
  assert.equal(consume(outboxQueueKey({ businessId: tenant, id })).readiness, mode === 'commit' ? 'observed' : 'unavailable')
}

// Real classifier creates inbox in its second independent transaction only.
for (const failCommit of [false, true]) {
  let transactions = 0, aggregate = '', writes = 0, batchQueries = 0
  const job = { id: 'provider-job', kind: 'PROCESS_PROVIDER_EVENT', aggregateId: 'provider-event', businessId: tenant,
    deploymentId: 'deployment', deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 5,
    claimToken: 'claim-token', claimedUntil: new Date(), queueWaitMs: 999 } satisfies ClaimedBotJob
  const client = { async $transaction<T>(body: (tx: unknown) => Promise<T>) {
    transactions++
    const result = await body({
      async $executeRaw(query: Query) {
        writes++
        if (query.strings.join('?').includes('INSERT INTO "BotJob"')) aggregate = String(query.values[2])
        return 1
      },
      async $queryRaw(query: Query) {
        const sql = query.strings.join('?')
        if (sql.includes('initial-classification-batch')) {
          aggregate = String(query.values[0])
          batchQueries++
          return [{ inboxCount: 1n, jobCount: 1n }]
        }
        if (sql.includes('conversation-policy')) return []
        if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: job.id }]
        if (sql.includes('FROM "BotChannelDeployment"')) return [{ id: job.deploymentId, generation: 1 }]
        if (sql.includes('FROM "BotJob" j') || sql.includes('FROM "BotProviderEvent"')) return [{
          id: job.aggregateId, eventKey: 'unsupported', eventType: 'UNSUPPORTED', businessId: tenant,
          providerMessageId: null, phoneNumberId: null, payload: {}, status: 'ADMITTED' }]
        throw new Error('unexpected offline query')
      }
    })
    if (transactions === 2 && failCommit) throw original
    return result
  } }
  const operation = processProviderEventJob({ client: client as never, job, queueMilestones: tracker })
  if (failCommit) await assert.rejects(operation, error => error === original)
  else assert.equal(await operation, 'PROCESSED')
  assert.equal(transactions, 2)
  assert.equal(writes, 3)
  assert.equal(batchQueries, 1, 'inbox and enqueue use one returning statement')
  assert.equal(consume(jobQueueKey({ businessId: tenant, kind: 'PROCESS_INBOX', aggregateId: aggregate })).readiness,
    failCommit ? 'unavailable' : 'observed')
}

// Wiring passes one tracker to both workers and sender, without changing wakes.
const signals = { jobs: createWorkerWakeSignal(), outbox: createWorkerWakeSignal() }
const wired: unknown[] = []
const loops = await startBarberWorkerLoops({ scope: { mode: 'include', businessId: tenant }, client: {} as never,
  provider: {} as never, async handle() {}, queueMilestones: tracker, wakeSignals: signals,
  startWorker(input) { wired.push(input.queueMilestones); return { async stop() {} } },
  startSender(input) { wired.push(input.queueMilestones); return { async stop() {} } } })
assert.deepEqual(wired, [tracker, tracker, tracker])
await loops.stop()
const entrypoint = readFileSync(new URL('../src/barber-local.ts', import.meta.url), 'utf8')
assert.match(entrypoint, /createQueueMilestoneTracker\(\{\s*businessId: BARBER_DEMO_BUSINESS_ID/)
assert.match(entrypoint, /processSessionJob\(\{[^}]*queueMilestones/s)

// Productive worker/sender loops preserve legacy queue events and empty claim silence.
for (const resource of ['job', 'outbox'] as const) {
  time += 100
  const key = resource === 'job' ? jobQueueKey({ businessId: tenant, kind: 'PROCESS_INBOX', aggregateId: 'loop-inbox' }) : outboxQueueKey({ businessId: tenant, id: 'loop-outbox' })
  await observeQueueProducerTransaction(tracker, txRun, async current => { recordProducedQueueResource(current, key) })
  time += 50
  const before = events.length
  let resolveEmpty!: () => void
  const empty = new Promise<void>(resolve => { resolveEmpty = resolve })
  let calls = 0, handled = 0
  const legacy: string[] = []
  const item = { id: resource === 'job' ? 'loop-job' : 'loop-outbox', businessId: tenant, kind: 'PROCESS_INBOX',
    aggregateId: 'loop-inbox', sessionId: 'session', transitionId: 'transition:session:1', customerCode: null, attempts: 1, queueWaitMs: 9876 }
  const client = {
    async $executeRaw() { return 0 }, async $queryRaw() { return [] },
    async $transaction<T>(body: (tx: unknown) => Promise<T>) {
      return body({ async $executeRaw() { return 0 }, async $queryRaw(query: Query) {
        if (query.strings.join('?').includes('WITH candidate') || query.strings.join('?').includes('SELECT o."id", o."businessId"')) {
          calls++; time += 20
          if (calls === 1) return [item]
          resolveEmpty(); return []
        }
        if (query.strings.join('?').includes('WITH telemetry AS')) return [item]
        return []
      } })
    }
  }
  const wake = createWorkerWakeSignal()
  const common = { client: client as never, queueMilestones: tracker, wakeSignal: wake, pollMs: 60000,
    onDiagnostic(event: { phase: string; durationMs: number | null }) {
      legacy.push(event.phase)
      if (event.phase === 'queue') { assert.equal(event.durationMs, 9876); time += 5 }
    } }
  const loop = resource === 'job'
    ? startPostgresWorkerLoop({ ...common, maintenanceEnabled: false, handlerSettlesJob: true, async handle() { handled++ } })
    : startOutboxSenderLoop({ ...common, provider: { async send() { throw new Error('provider must not run without preflight claim') } } })
  await empty
  await new Promise(resolve => setImmediate(resolve))
  await loop.stop()
  assert.equal(events.length, before + 1, 'empty subsequent claims emit no queue milestone')
  const event = events.at(-1)!
  assert.deepEqual([event.readyWaitMs, event.claimMs], [50, 20])
  assert.equal(event.dispatchMs, resource === 'job' ? 5 : 0)
  assert.equal(handled, resource === 'job' ? 1 : 0)
  if (resource === 'job') assert.ok(legacy.includes('queue'))
}
assert.ok(events.every(event => !JSON.stringify(event).includes('private')))
console.log('PASS queue milestone integration: admission/classification/outbox commits, rollback, wiring and real loops.')
