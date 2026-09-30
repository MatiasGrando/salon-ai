import assert from 'node:assert/strict'
import {
  createQueueMilestoneTracker, jobQueueKey, outboxQueueKey,
  observeQueueProducerTransaction, recordProducedQueueResource,
  type QueueMilestoneDiagnostic, type QueueMilestoneKey
} from '../src/bot-options/observability/queue-milestones.js'

const tenant = 'barber-test-tenant'
const job = (id = 'private-aggregate', businessId = tenant) => jobQueueKey({ businessId, kind: 'PROCESS_INBOX', aggregateId: id })
const outbox = (id = 'private-outbox') => outboxQueueKey({ businessId: tenant, id })
let time = 0
const events: QueueMilestoneDiagnostic[] = []
const tracker = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit: event => { events.push(event) }, ttlMs: 1000, capacity: 4 })
const tx = {}
const transaction = async <T>(body: (value: object) => Promise<T>): Promise<T> => body(tx)
async function produce(key: QueueMilestoneKey = job(), target = tracker) {
  return observeQueueProducerTransaction(target, transaction, async current => {
    recordProducedQueueResource(current, key)
    return 'unchanged-result'
  })
}
function consume(key: QueueMilestoneKey = job(), attempt = 1, target = tracker) {
  const claim = target.beginClaim()
  time += 40
  target.claimEnded(claim, key, attempt)
  time += 10
  target.handlerStarted(claim)
  return events.at(-1)!
}

// ACK, claim operations and dispatch have separate non-overlapping spans.
time = 100
assert.equal(await produce(), 'unchanged-result')
time = 150
const normal = consume()
assert.deepEqual([normal.readyWaitMs, normal.claimMs, normal.dispatchMs], [50, 40, 10])
assert.equal(normal.readiness, 'observed')
assert.match(normal.resourceRef, /^[a-f0-9]{24}$/)
assert.equal(normal.kind, 'PROCESS_INBOX')
assert.ok(!JSON.stringify(normal).includes('private-aggregate'))
assert.ok(!JSON.stringify(normal).includes(tenant))
assert.equal(consume().readiness, 'unavailable')

// Claim starts before ACK, although ACK arrives before claim returns.
time = 250
const overlap = tracker.beginClaim()
time = 260
await produce(job('overlap'))
time = 290
tracker.claimEnded(overlap, job('overlap'), 1)
time = 300
tracker.handlerStarted(overlap)
assert.equal(events.at(-1)!.readiness, 'overlap_censored')
assert.equal(events.at(-1)!.readyWaitMs, null)

// Consumed staged evidence cannot resurrect after a late ACK.
let resolveCommit!: () => void
const commitWait = new Promise<void>(resolve => { resolveCommit = resolve })
time = 310
const pending = observeQueueProducerTransaction(tracker, async body => {
  const value = await body({})
  await commitWait
  return value
}, async current => { recordProducedQueueResource(current, job('late')); return 42 })
await Promise.resolve()
time = 320
assert.equal(consume(job('late')).readiness, 'overlap_censored')
resolveCommit()
assert.equal(await pending, 42)
assert.equal(consume(job('late')).readiness, 'unavailable')

// Duplicate commits preserve earliest successful ACK and consumed tombstones.
time = 510
await produce(job('duplicate'))
time = 540
await produce(job('duplicate'))
time = 550
assert.equal(consume(job('duplicate')).readyWaitMs, 40)
time = 610
await produce(job('duplicate'))
assert.equal(consume(job('duplicate')).readiness, 'unavailable')

const error = new Error('private SQL/password/prompt error')
for (const mode of ['body', 'commit'] as const) {
  time += 10
  const key = job(mode)
  await assert.rejects(observeQueueProducerTransaction(tracker, async body => {
    const value = await body({})
    if (mode === 'commit') throw error
    return value
  }, async current => {
    recordProducedQueueResource(current, key)
    if (mode === 'body') throw error
    return 'value'
  }), actual => actual === error)
  assert.equal(consume(key).readiness, 'unavailable')
}

// Rollback of a pending sibling cannot erase another successful producer.
time = 900
let rejectSibling!: (error: Error) => void
const siblingCommit = new Promise<void>((_resolve, reject) => { rejectSibling = reject })
const sibling = observeQueueProducerTransaction(tracker, async body => {
  await body({})
  await siblingCommit
}, async current => { recordProducedQueueResource(current, job('sibling')) })
await Promise.resolve()
time = 910
await produce(job('sibling'))
rejectSibling(error)
await assert.rejects(sibling, actual => actual === error)
time = 920
assert.equal(consume(job('sibling')).readyWaitMs, 10)

// Off/readonly passthrough has one callback, same TX object, no collector evidence.
let calls = 0
const outside = {}
recordProducedQueueResource(outside, job('outside'))
assert.equal(await observeQueueProducerTransaction(undefined, async body => {
  calls++
  return body(outside)
}, async current => { assert.equal(current, outside); recordProducedQueueResource(current, job('off')); return 7 }), 7)
assert.equal(calls, 1)
assert.equal(consume(job('off')).readiness, 'unavailable')
time += 10
await produce(job('other-tenant', 'other-tenant'))
const countBeforeOtherTenant = events.length
consume(job('other-tenant', 'other-tenant'))
assert.equal(events.length, countBeforeOtherTenant)
time += 10
await produce(job('retry'))
assert.equal(consume(job('retry'), 2).readiness, 'unavailable')
assert.equal(consume(job('retry')).readiness, 'unavailable')

time = 1500
await produce(outbox())
time = 1510
const outboxEvent = consume(outbox())
assert.equal(outboxEvent.resource, 'outbox')
assert.equal(outboxEvent.kind, null)
assert.equal(outboxEvent.readyWaitMs, 10)
assert.notEqual(job('same').resourceRef, outbox('same').resourceRef)
assert.notEqual(job('same').resourceRef, job('same', 'different-tenant').resourceRef)

// TTL/capacity bound pending entries and consumed tombstones as well.
const bounded = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit: event => { events.push(event) }, ttlMs: 100, capacity: 2 })
time = 1700
await produce(job('expires'), bounded)
time = 1801
assert.equal(consume(job('expires'), 1, bounded).readiness, 'unavailable')
time = 1900
await produce(job('evicted'), bounded)
await produce(job('kept-a'), bounded)
await produce(job('kept-b'), bounded)
assert.equal(bounded.retainedCount, 2)
assert.equal(consume(job('evicted'), 1, bounded).readiness, 'unavailable')
assert.equal(consume(job('kept-a'), 1, bounded).readiness, 'observed')
assert.equal(bounded.retainedCount, 2)
const restarted = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit: event => { events.push(event) } })
assert.equal(consume(job('kept-b'), 1, restarted).readiness, 'unavailable')

// Clock/sink errors preserve application values/errors, with null not false zero.
let breakClock = false
const brokenClock = createQueueMilestoneTracker({ businessId: tenant, now: () => { if (breakClock) throw error; return time }, emit: event => { events.push(event) } })
time = 2300
await produce(job('clock'), brokenClock)
breakClock = true
const brokenEvent = consume(job('clock'), 1, brokenClock)
assert.equal(brokenEvent.readiness, 'unavailable')
assert.deepEqual([brokenEvent.readyWaitMs, brokenEvent.claimMs, brokenEvent.dispatchMs], [null, null, null])
assert.equal(await produce(job('bad-ack'), brokenClock), 'unchanged-result')
breakClock = false
assert.equal(consume(job('bad-ack'), 1, brokenClock).readiness, 'unavailable')
for (const emit of [() => { throw error }, async () => { throw error }]) {
  const brokenSink = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit })
  await produce(job('sink'), brokenSink)
  consume(job('sink'), 1, brokenSink)
  await assert.rejects(observeQueueProducerTransaction(brokenSink, async () => { throw error }, async () => 1), actual => actual === error)
}

// Evicted/expired pending producers cannot return after late settlement.
for (const eviction of ['capacity', 'ttl'] as const) {
  const limited = createQueueMilestoneTracker({ businessId: tenant, now: () => time, emit: event => { events.push(event) }, capacity: 1, ttlMs: 100 })
  let finish!: () => void
  const delayed = new Promise<void>(resolve => { finish = resolve })
  const late = observeQueueProducerTransaction(limited, async body => {
    await body({})
    await delayed
  }, async current => { recordProducedQueueResource(current, job('lost-pending')) })
  await Promise.resolve()
  if (eviction === 'capacity') await produce(job('replacement'), limited)
  else time += 101
  finish()
  await late
  assert.equal(consume(job('lost-pending'), 1, limited).readiness, 'unavailable')
  assert.ok(limited.retainedCount <= 1)
}

// Collector associations disappear after callback, and arbitrary labels stay static.
let escapedTx: object | undefined
await observeQueueProducerTransaction(tracker, transaction, async current => { escapedTx = current })
recordProducedQueueResource(escapedTx!, job('escaped'))
assert.equal(consume(job('escaped')).readiness, 'unavailable')
const privateKind = jobQueueKey({ businessId: tenant, aggregateId: 'value', kind: 'private phone/prompt' })
await produce(privateKind)
const staticLabel = consume(privateKind)
assert.equal(staticLabel.kind, 'other')
assert.ok(!JSON.stringify(staticLabel).includes('private phone/prompt'))
assert.ok(!JSON.stringify(staticLabel).includes('value'))

// Non-finite or backwards clocks are unavailable, not exact zero.
for (const invalid of [NaN, Infinity, -1]) {
  const invalidClock = createQueueMilestoneTracker({ businessId: tenant, now: () => invalid, emit: event => { events.push(event) } })
  assert.equal(await produce(job('invalid-clock'), invalidClock), 'unchanged-result')
  assert.deepEqual([consume(job('invalid-clock'), 1, invalidClock).readyWaitMs, events.at(-1)!.claimMs, events.at(-1)!.dispatchMs], [null, null, null])
}
let backwardsTime = 100
const backwardsClock = createQueueMilestoneTracker({ businessId: tenant, now: () => backwardsTime, emit: event => { events.push(event) } })
await produce(job('backwards'), backwardsClock)
backwardsTime = 99
assert.equal(consume(job('backwards'), 1, backwardsClock).readiness, 'unavailable')

await new Promise(resolve => setTimeout(resolve, 0))
assert.ok(events.every(event => !JSON.stringify(event).includes(error.message)))
console.log('PASS queue milestones: observed wait/claim/dispatch, overlap, rollback, bounded opt-in and fail-open.')
