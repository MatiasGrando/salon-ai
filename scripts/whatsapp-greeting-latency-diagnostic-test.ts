import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isGreetingLatencyDiagnosticMessage,
  LatencyDiagnostic
} from '../src/services/latency-diagnostic.js'

let currentTime = 0
const diagnostic = new LatencyDiagnostic('whatsapp_greeting_test', () => currentTime)

currentTime += 120
diagnostic.checkpoint('resolve_business')
currentTime += 300
diagnostic.checkpoint('persist_inbound')
currentTime += 2_400
diagnostic.checkpoint('marketing_check')
currentTime += 80
diagnostic.checkpoint('pre_enqueue')
currentTime += 3_500
diagnostic.recordDuration('batch_debounce', 3_000)
diagnostic.recordDuration('local_processing_tail_wait', 0)
diagnostic.recordDuration('conversation_lease_wait', 500)
await diagnostic.measure('conversation_processing', async () => {
  currentTime += 450
})
await diagnostic.measure('meta_send', async () => {
  currentTime += 1_200
})
currentTime += 80
diagnostic.checkpoint('persist_outbound')

const report = diagnostic.report()
assert.equal(report.totalMs, 8_130)
assert.equal(report.stages.batch_debounce, 3_000)
assert.equal(report.stages.conversation_lease_wait, 500)
assert.equal(report.stages.marketing_check, 2_400)
assert.equal(report.stages.meta_send, 1_200)
assert.deepEqual(report.slowestStages.map((item) => item.stage), [
  'batch_debounce',
  'marketing_check',
  'meta_send'
])
assert.ok(report.alerts.some((alert) => alert.includes('batch_debounce')))
assert.ok(report.alerts.some((alert) => alert.includes('marketing_check')))
assert.ok(report.alerts.some((alert) => alert.includes('tiempo total critico')))

for (const greeting of ['hola', 'Hola!', 'buen día', 'Buenas tardes', 'buenas noches']) {
  assert.equal(isGreetingLatencyDiagnosticMessage(greeting), true)
}
assert.equal(isGreetingLatencyDiagnosticMessage('hola quiero un turno'), false)

const webhookSource = readFileSync('src/services/whatsapp-webhook-service.ts', 'utf8')
for (const stage of [
  'resolve_business',
  'duplicate_check',
  'persist_inbound',
  'conversation_housekeeping',
  'marketing_check',
  'post_sale_check',
  'bot_settings',
  'pre_enqueue',
  'batch_debounce',
  'local_processing_tail_wait',
  'conversation_lease_wait',
  'conversation_processing',
  'outbound_gate',
  'meta_send',
  'persist_outbound'
]) {
  assert.match(webhookSource, new RegExp(`['"]${stage}['"]`))
}
assert.match(webhookSource, /\[whatsapp-latency-diagnostic\]/)
assert.match(webhookSource, /WHATSAPP_LATENCY_DIAGNOSTICS_ENABLED|latencyDiagnosticsEnabled/)
assert.match(webhookSource, /traceId: firstMessage\.inboundMessageId/)
assert.match(webhookSource, /JSON\.stringify/)
assert.doesNotMatch(webhookSource, /checkpoint\(['"]batch_wait['"]\)/)

console.log('whatsapp-greeting-latency-diagnostic-test: OK')
console.log(JSON.stringify(report, null, 2))
