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
console.log('PASS attempt metrics: timings, error preservation, redaction, parallel isolation, fail-open logging')
