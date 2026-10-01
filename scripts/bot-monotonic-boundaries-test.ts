import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createQueueMilestoneTracker, jobQueueKey, observeQueueProducerTransaction,
  recordProducedQueueResource, type QueueMilestoneDiagnostic } from '../src/bot-options/observability/queue-milestones.js'
import { runClaimedBotJob, type BotJobLatencyDiagnostic } from '../src/bot-options/infrastructure/postgres-worker.js'
import { MetaOutboxProvider } from '../src/bot-options/infrastructure/meta-outbox-provider.js'
import type { OutboxProviderDiagnostic } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

const tenant = 'synthetic-tenant'
const key = jobQueueKey({ businessId: tenant, kind: 'PROCESS_PROVIDER_EVENT', aggregateId: 'synthetic-event' })
let now = 100
const events: QueueMilestoneDiagnostic[] = []
const tracker = createQueueMilestoneTracker({ businessId: tenant, now: () => now,
  monotonicBoundaries: true, monotonicRunRef: 'synthetic-clock',
  emit(event) { events.push(event); now += 1000 } })
await observeQueueProducerTransaction(tracker, async body => body({}), async tx => { recordProducedQueueResource(tx, key) })
now = 110
const claim = tracker.beginClaim()
now = 150
tracker.claimEnded(claim, key, 1)
now = 155
tracker.handlerStarted(claim)
assert.deepEqual(events[0]!.monotonic, { runRef: 'synthetic-clock', producerAckMonoMs: 100,
  claimStartMonoMs: 110, claimEndMonoMs: 150, handlerStartMonoMs: 155 })
assert.deepEqual([events[0]!.readyWaitMs, events[0]!.claimMs, events[0]!.dispatchMs], [10, 40, 5], 'callback cost does not change endpoints')
assert.equal(tracker.producerAckMonoMs(claim, 'different-clock'), null, 'never translate clocks')
assert.equal(tracker.producerAckMonoMs(claim, 'synthetic-clock'), 100)

// Late producer ACK updates only a bounded entry, not the emitted censored snapshot.
for (const outcome of ['commit', 'rollback'] as const) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const bodyEntered = new Promise<void>(resolve => { entered = resolve })
  const failure = new Error('synthetic rollback')
  const lateKey = jobQueueKey({ businessId: tenant, kind: 'PROCESS_PROVIDER_EVENT', aggregateId: outcome })
  const base = outcome === 'commit' ? 2000 : 5000
  now = base
  const pending = observeQueueProducerTransaction(tracker, async body => {
    const result = await body({}); entered(); await gate
    if (outcome === 'rollback') throw failure
    return result
  }, async tx => { recordProducedQueueResource(tx, lateKey) })
  await bodyEntered
  now = base + 10
  const lateClaim = tracker.beginClaim()
  now = base + 20
  tracker.claimEnded(lateClaim, lateKey, 1)
  now = base + 21
  tracker.handlerStarted(lateClaim)
  const emitted = events.at(-1)!
  assert.equal(emitted.readiness, 'overlap_censored')
  assert.equal(emitted.monotonic?.producerAckMonoMs, null)
  assert.equal(tracker.producerAckMonoMs(lateClaim, 'synthetic-clock'), null)
  now = base + 1100
  release()
  if (outcome === 'rollback') await assert.rejects(pending, error => error === failure)
  else await pending
  assert.equal(tracker.producerAckMonoMs(lateClaim, 'synthetic-clock'), outcome === 'commit' ? base + 1100 : null)
  assert.equal(emitted.monotonic?.producerAckMonoMs, null, 'old diagnostics are immutable')
  const before = events.length
  tracker.handlerStarted(lateClaim)
  assert.equal(events.length, before, 'no extra callback for late ACK')
}

let invalidClock = false
const invalid = createQueueMilestoneTracker({ businessId: tenant, monotonicBoundaries: true,
  monotonicRunRef: 'invalid-clock', now: () => { if (invalidClock) throw new Error('clock'); return 1 },
  emit: event => { events.push(event) } })
const invalidClaim = invalid.beginClaim()
invalidClock = true
invalid.claimEnded(invalidClaim, key, 1)
invalid.handlerStarted(invalidClaim)
assert.deepEqual(events.at(-1)!.monotonic, { runRef: 'invalid-clock', producerAckMonoMs: null,
  claimStartMonoMs: 1, claimEndMonoMs: null, handlerStartMonoMs: null })
assert.equal(invalid.producerAckMonoMs(invalidClaim, 'invalid-clock'), null)
const unnamed = createQueueMilestoneTracker({ businessId: tenant, now: () => 1, monotonicBoundaries: true, emit: event => { events.push(event) } })
const unnamedClaim = unnamed.beginClaim()
unnamed.claimEnded(unnamedClaim, key, 1); unnamed.handlerStarted(unnamedClaim)
assert.equal(events.at(-1)!.monotonic, undefined, 'unnamed injected clock is not the process clock')

const bounded = createQueueMilestoneTracker({ businessId: tenant, now: () => now, capacity: 1, ttlMs: 10,
  monotonicBoundaries: true, monotonicRunRef: 'synthetic-clock', emit() {} })
now = 4000
await observeQueueProducerTransaction(bounded, async body => body({}), async tx => { recordProducedQueueResource(tx, key) })
const boundedClaim = bounded.beginClaim()
bounded.claimEnded(boundedClaim, key, 1)
assert.equal(bounded.producerAckMonoMs(boundedClaim, 'synthetic-clock'), 4000)
now = 4011
bounded.claimEnded(bounded.beginClaim(), key, 1)
assert.equal(bounded.producerAckMonoMs(boundedClaim, 'synthetic-clock'), null, 'expired evidence is unavailable')
assert.equal(bounded.retainedCount, 0)

const workerEvents: BotJobLatencyDiagnostic[] = []
const workerJob = { id: 'synthetic-job', kind: 'PROCESS_PROVIDER_EVENT', aggregateId: 'synthetic-event', businessId: tenant,
  deploymentId: 'synthetic-deployment', deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 3,
  claimToken: 'synthetic-claim', claimedUntil: new Date(), queueWaitMs: 0 }
let queries = 0
const client = { async $queryRaw() { queries++; return [{ status: 'READY' }] } }
const runWorker = async (fail = false, enabled = true) => runClaimedBotJob({ client: client as never, job: workerJob,
  monotonicBoundaries: enabled, handlerSettlesJob: true, async handle() { if (fail) throw new Error('synthetic handler') },
  onDiagnostic: event => { workerEvents.push(event) } })
await runWorker()
const processing = workerEvents[0]!
assert.ok(processing.monotonic)
assert.equal(processing.monotonic.endMonoMs! - processing.monotonic.startMonoMs!, processing.durationMs)
assert.equal(workerEvents[1]!.monotonic, undefined, 'settled zero is not a physical interval')
await runWorker(true)
assert.equal(workerEvents[2]!.outcome, 'error')
assert.ok(workerEvents[2]!.monotonic)
assert.equal(queries, 1, 'one existing retry statement, no diagnostic SQL')
await runWorker(false, false)
assert.equal(workerEvents.at(-2)!.monotonic, undefined)

const credentials = { accessToken: 'synthetic-token', phoneNumberId: 'synthetic-phone', apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' as const }
let credentialsCalls = 0
let apiCalls = 0
const providerEvents: OutboxProviderDiagnostic[] = []
const provider = new MetaOutboxProvider({ monotonicBoundaries: true,
  async resolveCredentials() { credentialsCalls++; return credentials },
  api: { async sendTextMessage(input) { apiCalls++; return { sent: true as const, to: input.to, response: { messages: [{ id: 'synthetic-message' }] } } },
    async sendReplyButtonsMessage() { throw new Error('unexpected') }, async sendInteractiveListMessage() { throw new Error('unexpected') } } })
const result = await provider.send({ businessId: tenant, payload: { to: 'synthetic-recipient', item: { type: 'informative_text', body: 'synthetic' } } }, new AbortController().signal,
  event => { providerEvents.push(event) })
assert.deepEqual(result, { kind: 'accepted', providerMessageId: 'synthetic-message' })
assert.equal(credentialsCalls, 1); assert.equal(apiCalls, 1)
assert.equal(providerEvents.length, 1, 'no extra acceptance event')
assert.equal(providerEvents[0]!.monotonic?.runRef, processing.monotonic.runRef, 'same process clock identity')
assert.equal(providerEvents[0]!.monotonic!.endMonoMs! - providerEvents[0]!.monotonic!.startMonoMs!, providerEvents[0]!.durationMs)

const credentialFailure = new Error('synthetic credential failure')
const failedProvider = new MetaOutboxProvider({ monotonicBoundaries: true,
  async resolveCredentials() { throw credentialFailure } })
const failedEvents: OutboxProviderDiagnostic[] = []
await assert.rejects(failedProvider.send({ businessId: tenant,
  payload: { to: 'synthetic-recipient', item: { type: 'informative_text', body: 'synthetic' } } },
  new AbortController().signal, event => { failedEvents.push(event) }), error => error === credentialFailure)
assert.equal(failedEvents.length, 1)
assert.equal(failedEvents[0]!.outcome, 'error')
assert.ok(failedEvents[0]!.monotonic, 'partial failure retains the real credentials interval')
// Callback failure does not alter a successful provider result.
assert.deepEqual(await provider.send({ businessId: tenant,
  payload: { to: 'synthetic-recipient', item: { type: 'informative_text', body: 'synthetic' } } },
  new AbortController().signal, () => { throw new Error('synthetic sink failure') }),
  { kind: 'accepted', providerMessageId: 'synthetic-message' })

// End-of-processing can recover the producer ACK when the claim started first.
const liveEvents: QueueMilestoneDiagnostic[] = []
const live = createQueueMilestoneTracker({ businessId: tenant, monotonicBoundaries: true, emit: event => { liveEvents.push(event) } })
let releaseLive!: () => void
let enteredLive!: () => void
const liveGate = new Promise<void>(resolve => { releaseLive = resolve })
const liveEntered = new Promise<void>(resolve => { enteredLive = resolve })
const liveProducer = observeQueueProducerTransaction(live, async body => {
  await body({}); enteredLive(); await liveGate
}, async tx => { recordProducedQueueResource(tx, key) })
await liveEntered
const liveClaim = live.beginClaim()
live.claimEnded(liveClaim, key, 1)
const recovered: BotJobLatencyDiagnostic[] = []
await runClaimedBotJob({ client: client as never, job: workerJob, handlerSettlesJob: true,
  monotonicBoundaries: true, queueMilestones: live, queueClaim: liveClaim,
  async handle() { releaseLive(); await liveProducer }, onDiagnostic: event => { recovered.push(event) } })
assert.equal(liveEvents[0]!.readiness, 'overlap_censored')
assert.equal(liveEvents[0]!.monotonic!.producerAckMonoMs, null)
assert.ok(recovered[0]!.monotonic!.producerAckMonoMs! >= recovered[0]!.monotonic!.startMonoMs)
assert.ok(recovered[0]!.monotonic!.producerAckMonoMs! <= recovered[0]!.monotonic!.endMonoMs)

const { startBarberWorkerLoops } = await import('../src/barber-local/runtime.js')
const { BARBER_DEMO_BUSINESS_ID } = await import('../src/barber-local/ingress.js')
for (const enabled of [true, false]) {
  const forwarded: Array<boolean | undefined> = []
  const loops = await startBarberWorkerLoops({ client: {} as never,
    scope: { mode: 'include', businessId: BARBER_DEMO_BUSINESS_ID },
    ...(enabled ? { monotonicBoundaries: true } : {}),
    provider: { async send() { return { kind: 'accepted', providerMessageId: 'synthetic' } } }, async handle() {},
    startWorker(input) { forwarded.push(input.monotonicBoundaries); return { async stop() {} } },
    startSender(input) { forwarded.push(input.monotonicBoundaries); return { async stop() {} } } })
  await loops.stop()
  assert.deepEqual(forwarded, enabled ? [true, true, true] : [undefined, undefined, undefined], 'Barber forwards opt-in to both workers and sender; off shape unchanged')
}

// Simulated small serialization callback budget, not production accuracy evidence.
let serialized = 0
const overhead = createQueueMilestoneTracker({ businessId: tenant, monotonicBoundaries: true,
  emit: event => { serialized += JSON.stringify(event).length } })
const begin = performance.now()
for (let i = 0; i < 10_000; i++) { const window = overhead.beginClaim(); overhead.claimEnded(window, key, 1); overhead.handlerStarted(window) }
const averageMs = (performance.now() - begin) / 10_000
assert.ok(serialized > 0)
assert.ok(averageMs < 1, `offline callback average ${averageMs}ms exceeds sub-ms smoke budget`)
// Verify the three pilot-only opt-ins independently, not a nested regex match.
const pilotSource = ts.createSourceFile('barber-local.ts',
  readFileSync(new URL('../src/barber-local.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const seamNames = ['createQueueMilestoneTracker', 'MetaOutboxProvider', 'startBarberWorkerLoops']
const seamFlags = new Map<string, boolean>()
function inspectPilot(node: ts.Node): void {
  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)
    && seamNames.includes(node.expression.text)) {
    const options = node.arguments?.[0]
    const flag = options && ts.isObjectLiteralExpression(options) && options.properties.some(property =>
      ts.isPropertyAssignment(property) && property.name.getText(pilotSource) === 'monotonicBoundaries'
      && property.initializer.kind === ts.SyntaxKind.TrueKeyword)
    seamFlags.set(node.expression.text, Boolean(flag))
  }
  ts.forEachChild(node, inspectPilot)
}
inspectPilot(pilotSource)
assert.equal(seamFlags.size, 3, 'all three existing pilot seams remain present')
assert.deepEqual(seamNames.map(name => seamFlags.get(name)), [true, true, true],
  'only Barber explicitly enables tracker, provider and isolated-loop boundaries')

console.log('PASS monotonic boundaries: clocks, overlap, late ACK/rollback, missing fields, event/query counts; callback average ms', averageMs)
