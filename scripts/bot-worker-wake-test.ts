import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createWorkerWakeSignal } from '../src/bot-options/infrastructure/worker-wake.js'
import { startPostgresWorkerLoop } from '../src/bot-options/infrastructure/postgres-worker.js'
import { startOutboxSenderLoop } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'
import { barberOnlyRepository, BARBER_DEMO_BUSINESS_ID } from '../src/barber-local/ingress.js'
import { startBarberWorkerLoops } from '../src/barber-local/runtime.js'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const wake = createWorkerWakeSignal()
const before = wake.version
wake.notify(); wake.notify()
await wake.waitSince(before, 60_000)
const a = new AbortController(), b = new AbortController()
let wokeA = false, wokeB = false
const waitingA = wake.waitSince(wake.version, 60_000, a.signal).then(() => { wokeA = true })
const waitingB = wake.waitSince(wake.version, 60_000, b.signal).then(() => { wokeB = true })
a.abort(); await waitingA
assert.equal(wokeA, true); assert.equal(wokeB, false, 'stop only cancels its own consumer')
wake.notify(); await waitingB
mock.timers.enable({ apis: ['setTimeout'] })
try {
  let timedOut = false
  const timeout = wake.waitSince(wake.version, 250).then(() => { timedOut = true })
  mock.timers.tick(249); await Promise.resolve(); assert.equal(timedOut, false)
  mock.timers.tick(1); await timeout; assert.equal(timedOut, true)
} finally { mock.timers.reset() }
await wake.waitSince(wake.version, 60_000, a.signal)

// An event committed during an empty claim must not be lost before wait registration.
for (const kind of ['worker', 'sender'] as const) {
  const signal = createWorkerWakeSignal()
  const firstClaim = deferred<void>(), releaseClaim = deferred<void>(), secondClaim = deferred<void>()
  let claims = 0
  const client = {
    async $executeRaw() { return 0 }, async $queryRaw() { return [] },
    async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
      return operation({ async $queryRaw() {
        claims += 1
        if (claims === 1) { firstClaim.resolve(); await releaseClaim.promise }
        if (claims === 2) secondClaim.resolve()
        return []
      } })
    }
  }
  const common = { client: client as never, pollMs: 60_000, wakeSignal: signal }
  const loop = kind === 'worker'
    ? startPostgresWorkerLoop({ ...common, maintenanceEnabled: false, async handle() {} })
    : startOutboxSenderLoop({ ...common, provider: { async send() { throw new Error('no item') } } })
  await firstClaim.promise
  signal.notify(); signal.notify(); releaseClaim.resolve()
  await secondClaim.promise
  await tick()
  assert.equal(claims, 2, 'multiple hints do not create a polling storm')
  signal.notify(); await tick()
  assert.equal(claims, 3, 'registered idle waits wake immediately')
  await loop.stop()
}

// Ordinary timeout still polls without notifications, including no signal injection.
for (const wakeSignal of [undefined, createWorkerWakeSignal()]) {
  const polled = deferred<void>(); let count = 0
  const loop = startPostgresWorkerLoop({
    client: { async $transaction(operation: (tx: unknown) => Promise<unknown>) {
      return operation({ async $queryRaw() { if (++count === 2) polled.resolve(); return [] } })
    } } as never,
    wakeSignal, pollMs: 1, maintenanceEnabled: false, async handle() {}
  })
  await polled.promise; await loop.stop()
}

// Error backoff must not be bypassed by a work hint.
for (const kind of ['worker', 'sender'] as const) {
  const signal = createWorkerWakeSignal(); let claims = 0
  const errorSeen = deferred<void>()
  const common = {
    client: { async $executeRaw() { return 0 }, async $queryRaw() { return [] },
      async $transaction() { claims++; throw new Error('claim error') } } as never,
    pollMs: 30, wakeSignal: signal, onError() { errorSeen.resolve() }
  }
  const loop = kind === 'worker'
    ? startPostgresWorkerLoop({ ...common, maintenanceEnabled: false, async handle() {} })
    : startOutboxSenderLoop({ ...common, provider: { async send() { throw new Error('unused') } } })
  await errorSeen.promise; signal.notify(); await tick()
  assert.equal(claims, 1)
  await loop.stop()
}

// Repository result is { eventCount, insertedCount }, not the HTTP decision shape.
const route = { kind: 'new' as const, businessId: BARBER_DEMO_BUSINESS_ID, deploymentId: 'd', generation: 1,
  appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null }
const admission = { route, phoneNumberId: 'p', events: [] }
let notifications = 0
const committed = deferred<{ eventCount: number; insertedCount: number }>()
const repository = barberOnlyRepository({ async resolveRoute() { return route },
  async admitAuthoritative() { return committed.promise } }, () => { notifications++ })
const admitted = repository.admitAuthoritative(admission)
await tick(); assert.equal(notifications, 0, 'no hint before commit resolves')
committed.resolve({ eventCount: 2, insertedCount: 1 }); await admitted
assert.equal(notifications, 1)
for (const mode of ['duplicate', 'rollback', 'throwing-hint'] as const) {
  const repo = barberOnlyRepository({ async resolveRoute() { return route }, async admitAuthoritative() {
    if (mode === 'rollback') throw new Error('rollback')
    return { eventCount: 1, insertedCount: mode === 'duplicate' ? 0 : 1 }
  } }, () => { notifications++; if (mode === 'throwing-hint') throw new Error('hint error') })
  if (mode === 'rollback') await assert.rejects(repo.admitAuthoritative(admission), /rollback/)
  else await repo.admitAuthoritative(admission)
}
assert.equal(notifications, 2, 'duplicate and rollback do not notify; throwing hint is fail-open')
await assert.rejects(repository.admitAuthoritative({ ...admission, route: { ...route, businessId: 'foreign' } }), /non-Barber/)
assert.equal(notifications, 2)

// Only successful self-settling handlers publish hints to both channels.
const jobs = createWorkerWakeSignal(), outbox = createWorkerWakeSignal()
let workerInput: Parameters<typeof startPostgresWorkerLoop>[0] | undefined
let senderInput: Parameters<typeof startOutboxSenderLoop>[0] | undefined
let handlerCommit = deferred<void>()
const loops = await startBarberWorkerLoops({
  scope: { mode: 'include', businessId: BARBER_DEMO_BUSINESS_ID }, client: {} as never,
  provider: { async send() { throw new Error('unused') } }, wakeSignals: { jobs, outbox },
  async handle() { await handlerCommit.promise },
  startWorker(input) { workerInput = input; return { async stop() {} } },
  startSender(input) { senderInput = input; return { async stop() {} } }
})
assert.equal(workerInput?.wakeSignal, jobs); assert.equal(senderInput?.wakeSignal, outbox)
assert.equal(workerInput?.handlerSettlesJob, true)
const running = workerInput!.handle({ businessId: BARBER_DEMO_BUSINESS_ID } as never)
await tick(); assert.equal(jobs.version, 0); assert.equal(outbox.version, 0)
handlerCommit.resolve(); await running
assert.equal(jobs.version, 1); assert.equal(outbox.version, 1)
handlerCommit = deferred<void>()
const failing = workerInput!.handle({ businessId: BARBER_DEMO_BUSINESS_ID } as never)
handlerCommit.reject(new Error('rollback')); await assert.rejects(failing, /rollback/)
assert.equal(jobs.version, 1); assert.equal(outbox.version, 1)
await loops.stop()

// stop aborts idle waiting, but must still drain a claim already in flight.
for (const kind of ['worker', 'sender'] as const) {
  const claimed = deferred<void>(), release = deferred<void>()
  const common = { client: { async $executeRaw() { return 0 }, async $queryRaw() { return [] },
    async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
      return operation({ async $queryRaw() { claimed.resolve(); await release.promise; return [] } })
    }
  } as never, pollMs: 60_000, wakeSignal: createWorkerWakeSignal() }
  const loop = kind === 'worker'
    ? startPostgresWorkerLoop({ ...common, maintenanceEnabled: false, async handle() {} })
    : startOutboxSenderLoop({ ...common, provider: { async send() { throw new Error('unused') } } })
  await claimed.promise
  let stopped = false
  const stopping = loop.stop().then(() => { stopped = true })
  await tick(); assert.equal(stopped, false)
  release.resolve(); await stopping; assert.equal(stopped, true)
}

// Broken notification consumers cannot make a committed job fail or block the other channel.
const stillWakes = createWorkerWakeSignal()
let committedHandler: Parameters<typeof startPostgresWorkerLoop>[0]['handle'] | undefined
const brokenHintLoops = await startBarberWorkerLoops({
  scope: { mode: 'include', businessId: BARBER_DEMO_BUSINESS_ID }, client: {} as never,
  provider: { async send() { throw new Error('unused') } }, async handle() {},
  wakeSignals: { jobs: { ...createWorkerWakeSignal(), notify() { throw new Error('broken hint') } }, outbox: stillWakes },
  startWorker(input) { committedHandler = input.handle; return { async stop() {} } },
  startSender() { return { async stop() {} } }
})
await committedHandler!({ businessId: BARBER_DEMO_BUSINESS_ID } as never)
assert.equal(stillWakes.version, 1)
await brokenHintLoops.stop()
console.log('OK worker wake: post-commit hints, lost-wake protection, polling fallback and isolated stop.')
