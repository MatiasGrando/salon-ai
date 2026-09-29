import assert from 'node:assert/strict'
import { measureAttemptStage, withAttemptMetrics, type AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'

const events: AttemptMetricEvent[] = []
const failure = Object.assign(new Error('secret phone 5491153313037'), { code: 'P2028' })
await assert.rejects(withAttemptMetrics({ jobId: 'internal-job', attempt: 2 }, async () => {
  assert.equal(await measureAttemptStage('session_context_load', async () => 42), 42)
  await measureAttemptStage('session_effects', async () => { throw failure })
}, { emit: event => events.push(event) }), error => error === failure)
assert.deepEqual(events.map(event => [event.stage, event.outcome, event.errorCode]), [
  ['session_context_load', 'ok', null], ['session_effects', 'error', 'P2028'], ['attempt', 'error', 'P2028']
])
assert.ok(events.every(event => event.attempt === 2 && event.durationMs >= 0))
assert.ok(events.every(event => event.jobRef === events[0]!.jobRef))
assert.doesNotMatch(JSON.stringify(events), /internal-job|5491153313037|secret/)

const parallel: AttemptMetricEvent[] = []
await Promise.all([1, 2].map(attempt => withAttemptMetrics({ jobId: `job-${attempt}`, attempt }, async () => {
  await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 5 : 0))
  await measureAttemptStage('session_context_load', async () => attempt)
}, { emit: event => parallel.push(event) })))
assert.equal(parallel.filter(event => event.attempt === 1).length, 2)
assert.equal(new Set(parallel.map(event => event.jobRef)).size, 2)

assert.equal(await withAttemptMetrics({ jobId: 'j', attempt: 1 }, () => measureAttemptStage('session_effects', async () => 7), {
  emit: () => { throw new Error('logging unavailable') }
}), 7, 'logging failures must never break booking')

const unsafe: AttemptMetricEvent[] = []
await assert.rejects(withAttemptMetrics({ jobId: 'j', attempt: 1 }, async () => {
  throw Object.assign(new Error('private'), { code: 'PRIVATE_CUSTOMER_VALUE' })
}, { emit: event => unsafe.push(event) }))
assert.equal(unsafe[0]!.errorCode, 'UNKNOWN')
assert.equal(await measureAttemptStage('session_effects', async () => 'outside-context'), 'outside-context')
const conversation: AttemptMetricEvent[] = []
await withAttemptMetrics({ jobId: 'conversation-job', attempt: 1 }, () =>
  measureAttemptStage('conversation_policy_load' as never, async () => 'policy'), { emit: event => conversation.push(event) })
assert.deepEqual(conversation.map(event => event.stage), ['conversation_policy_load', 'attempt'], 'new runtime stages must be allowed')

const { measureAttemptTransaction } = await import('../src/bot-options/observability/attempt-metrics.js')
const sleep = () => new Promise(resolve => setTimeout(resolve, 2))
async function transactionEvents(fail: 'begin' | 'body' | 'commit' | null = null, throwingSink = false) {
  const emitted: AttemptMetricEvent[] = []
  const original = Object.assign(new Error('private transaction details'), { code: 'P2028' })
  const promise = withAttemptMetrics({ jobId: 'transaction-job', attempt: 1 }, () => measureAttemptTransaction(
    'conversation_snapshot', async body => {
      await sleep()
      if (fail === 'begin') throw original
      const result = await body('tx')
      await sleep()
      if (fail === 'commit') throw original
      return result
    }, async tx => {
      assert.equal(tx, 'tx'); await sleep()
      if (fail === 'body') throw original
      return 42
    }), { emit: event => { emitted.push(event); if (throwingSink) throw new Error('sink unavailable') } })
  if (fail) await assert.rejects(promise, error => error === original)
  else assert.equal(await promise, 42)
  return emitted
}
const complete = await transactionEvents()
assert.deepEqual(complete.map(event => event.stage), [
  'conversation_snapshot_transaction_start_wait', 'conversation_snapshot_transaction_body',
  'conversation_snapshot_transaction_tail', 'conversation_snapshot_transaction_total', 'attempt'
])
assert.ok(complete.every(event => event.outcome === 'ok' && event.errorCode === null && event.durationMs >= 0))
assert.ok(complete[3]!.durationMs >= Math.max(...complete.slice(0, 3).map(event => event.durationMs)), 'total is inclusive')
for (const fail of ['begin', 'body', 'commit'] as const) {
  const failed = await transactionEvents(fail)
  assert.equal(failed.at(-2)!.stage, 'conversation_snapshot_transaction_total')
  assert.equal(failed.at(-2)!.outcome, 'error'); assert.equal(failed.at(-2)!.errorCode, 'P2028')
  if (fail === 'begin') assert.deepEqual(failed.map(event => event.stage), [
    'conversation_snapshot_transaction_start_wait', 'conversation_snapshot_transaction_total', 'attempt'
  ], 'failed acquisition must not invent callback or tail spans')
  else {
    assert.equal(failed.find(event => event.stage === 'conversation_snapshot_transaction_body')!.outcome, fail === 'body' ? 'error' : 'ok')
    assert.equal(failed.find(event => event.stage === 'conversation_snapshot_transaction_tail')!.outcome, 'error')
  }
  assert.doesNotMatch(JSON.stringify(failed), /private|transaction-job/)
  await transactionEvents(fail, true)
}
await transactionEvents(null, true)
const invalidLabels: AttemptMetricEvent[] = []
await withAttemptMetrics({ jobId: 'invalid-label', attempt: 1 }, () => measureAttemptTransaction('__proto__' as never,
  async body => body('tx'), async () => 42), { emit: event => invalidLabels.push(event) })
assert.deepEqual(invalidLabels.map(event => event.stage), ['attempt'], 'untyped labels cannot leak or access inherited stages')
assert.equal(await measureAttemptTransaction('conversation_final', async body => body('tx'), async () => 7), 7, 'no context is transparent')
console.log('PASS attempt metrics: timings, error preservation, redaction, parallel isolation, fail-open logging')
