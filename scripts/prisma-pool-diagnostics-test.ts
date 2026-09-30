import assert from 'node:assert/strict'
import { instrumentPrismaPool, type PrismaPoolDiagnostic } from '../src/config/prisma-pool-diagnostics.js'
import { withAttemptMetrics } from '../src/bot-options/observability/attempt-metrics.js'

const events: PrismaPoolDiagnostic[] = []
const release = () => undefined
let calls = 0
const failure = Object.assign(new Error('private SQL phone password'), { code: 'ECONNRESET' })
const client = {
  release,
  query(...args: unknown[]) {
    calls++
    assert.equal(this, client)
    const callback = args.at(-1)
    if (typeof callback === 'function') { callback(null, 42); return undefined }
    if (args[0] === 'fail') return Promise.reject(failure)
    return Promise.resolve(42)
  }
}
const pool = {
  totalCount: 1, idleCount: 1, waitingCount: 0,
  connect(callback?: (error: Error | null, connection?: typeof client, done?: typeof release) => void) {
    assert.equal(this, pool)
    if (callback) { callback(null, client, release); return undefined }
    return Promise.resolve(client)
  }
}
instrumentPrismaPool(pool as never, 'worker', event => events.push(event))
const before = client.query
await withAttemptMetrics({ jobId: 'private-job', attempt: 2 }, async () => {
  assert.equal(await pool.connect(), client)
  assert.equal(client.release, release)
  assert.equal(await client.query('secret sql', ['private values']), 42)
  assert.equal(await client.query({ text: 'secret sql', values: ['private'] }), 42)
  pool.connect((error, acquired, done) => {
    assert.equal(error, null); assert.equal(acquired, client); assert.equal(done, release)
  })
  assert.equal(client.query('secret', (error: unknown, result: unknown) => {
    assert.equal(error, null); assert.equal(result, 42)
  }), undefined)
  await assert.rejects(client.query('fail') as Promise<number>, (error: unknown) => error === failure)
}, { emit: () => undefined })
assert.equal(calls, 4)
assert.equal(events.filter(event => event.phase === 'acquire_total').length, 2)
assert.equal(events.filter(event => event.phase === 'client_query_total').length, 4)
assert.equal(events.at(-1)!.errorCode, 'ECONNRESET')
assert.ok(events.every(event => event.context.jobRef !== null && event.context.attempt === 2))
assert.doesNotMatch(JSON.stringify(events), /private|secret|SQL|password/)
const once = client.query
assert.notEqual(once, before)
instrumentPrismaPool(pool as never, 'worker', () => { throw new Error('sink') })
await pool.connect()
assert.equal(client.query, once, 'instrument once across acquisitions and enable calls')
assert.equal(await client.query('normal'), 42)
assert.equal(events.length, 6, 'no logging outside an attempt, including continuous polling')
const errorPool = { totalCount: 0, idleCount: 0, waitingCount: 1,
  connect(callback?: (error: Error) => void) {
    if (callback) { callback(failure); return undefined }
    return Promise.reject(failure)
  }
}
instrumentPrismaPool(errorPool as never, 'ingress', () => { throw new Error('sink') })
await withAttemptMetrics({ jobId: 'error-job', attempt: 1 }, async () => {
  await assert.rejects(errorPool.connect() as Promise<never>, (error: unknown) => error === failure)
  errorPool.connect(error => assert.equal(error, failure))
}, { emit: () => undefined })
console.log('PASS pool diagnostics: overloads, identity, errors, once-only wrappers, safe context')

// Factory opt-in remains lazy and owns disposal; the test forbids all network acquisition.
const { Pool } = await import('pg')
const { createPrismaClient, enablePrismaClientDiagnostics } = await import('../src/config/prisma-client.js')
const originalConnect = Pool.prototype.connect
const originalEnd = Pool.prototype.end
let ended = 0
Pool.prototype.connect = function() { throw new Error('network acquisition forbidden in offline test') } as typeof originalConnect
Pool.prototype.end = function(this: InstanceType<typeof Pool>, ...args: unknown[]) {
  ended++
  return Reflect.apply(originalEnd, this, args)
} as typeof originalEnd
try {
  for (const optIn of [false, true]) {
    const prisma = createPrismaClient({ connectionString: 'postgresql://offline:offline@127.0.0.1:1/offline',
      max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 })
    if (optIn) {
      assert.equal(enablePrismaClientDiagnostics(prisma, { role: 'worker', emit: () => { throw new Error('sink') } }), true)
      assert.equal(enablePrismaClientDiagnostics(prisma, { role: 'worker', emit: () => undefined }), false)
    }
    await prisma.$connect()
    assert.equal(enablePrismaClientDiagnostics(prisma, { role: 'worker', emit: () => undefined }), false, 'no late pool swapping')
    await prisma.$disconnect()
  }
  assert.equal(ended, 2, 'external diagnostic pool and default internal pool both disposed exactly once')
} finally { Pool.prototype.connect = originalConnect; Pool.prototype.end = originalEnd }
console.log('PASS pool factory: explicit opt-in, default untouched, lazy start, disposal')

const more: PrismaPoolDiagnostic[] = []
const originalFailure = new Error('private sync')
const queryObject = { submit() { return undefined } }
const callbackClient = {
  release,
  query(...args: unknown[]) {
    if (args[0] === 'sync') throw originalFailure
    if (args[0] === queryObject) return queryObject
    const callback = args.at(-1)
    if (typeof callback === 'function') { callback(failure); return undefined }
    return Promise.resolve(7)
  }
}
let grant: (() => void) | undefined
const queued = { totalCount: 3, idleCount: 0, waitingCount: 1,
  connect() { return new Promise(resolve => { grant = () => { queued.waitingCount = 0; resolve(callbackClient) } }) }
}
instrumentPrismaPool(queued as never, 'worker', event => more.push(event))
await withAttemptMetrics({ jobId: 'queued-job', attempt: 3 }, async () => {
  const pending = queued.connect()
  assert.ok(grant); grant()
  await pending
  assert.equal(callbackClient.query(queryObject), queryObject, 'submittable return and event semantics untouched')
  assert.equal(callbackClient.query('callback error', (error: unknown) => assert.equal(error, failure)), undefined)
  assert.throws(() => callbackClient.query('sync'), error => error === originalFailure)
  assert.throws(() => callbackClient.query('callback throw', () => { throw originalFailure }), error => error === originalFailure)
}, { emit: () => undefined })
assert.equal(more[0]!.start.waiting, 1)
assert.equal(more[0]!.end.waiting, 0)
assert.equal(more.length, 4, 'submittable has no invented completion; throwing callback only emits once')
assert.equal(more[1]!.outcome, 'error')
assert.equal(more[2]!.errorCode, 'UNKNOWN')
assert.ok(more.every(event => event.durationMs >= 0))
console.log('PASS pool diagnostics: queued snapshots, sync/callback errors and submittable semantics')

const brokenConnection = { release }
Object.defineProperty(brokenConnection, 'query', { get() { throw failure } })
const brokenPool = { idleCount: 0, waitingCount: 0, connect() { return Promise.resolve(brokenConnection) } }
Object.defineProperty(brokenPool, 'totalCount', { get() { throw failure } })
instrumentPrismaPool(brokenPool as never, 'worker', () => { throw failure })
await withAttemptMetrics({ jobId: 'broken-observer', attempt: 1 }, async () => {
  assert.equal(await brokenPool.connect(), brokenConnection, 'counter/getter/wrapper failures cannot reject an acquired connection')
}, { emit: () => undefined })
console.log('PASS pool diagnostics: broken counter/client hooks fail open')
