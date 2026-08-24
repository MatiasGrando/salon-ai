import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runbook = readFileSync(new URL('../measurements/egress-baseline/http-sse-egress-baseline-runbook-template.txt', import.meta.url), 'utf8')
assert.match(runbook, /railway logs <deploymentId>.*@message:egress_baseline_process_window/)
assert.match(runbook, /railway logs <deploymentId> --http/)
assert.match(runbook, /railway metrics .*--cpu --memory --network/)
assert.match(runbook, /source unavailable.*bloquea/i)
assert.match(runbook, /databaseProviderEgressDelta/)
assert.match(runbook, /storageProviderEgressDelta/)
assert.match(runbook, /railwayTransmitDelta/)
assert.match(runbook, /owner\/approver/)
for (const indicator of ['CPU', 'heap', 'event-loop', 'latency', 'stdout', 'overflow', 'drops']) {
  const section = runbook.match(new RegExp(`INDICATOR: ${indicator}([\\s\\S]*?)(?=INDICATOR:|$)`, 'i'))?.[1] || ''
  for (const field of ['Owner:', 'Baseline:', 'Observation window:', 'Aggregation:', 'Sustained rule:', 'Immediate rule:', 'Recovery window:', 'Unavailable behavior:']) assert.match(section, new RegExp(field), `${indicator} missing ${field}`)
}
assert.match(runbook, /T0: snapshot immediately before/i)
assert.match(runbook, /T1: snapshot at the declared end/i)
assert.match(runbook, /T1-confirmation: later provider reading/i)
for (const layer of ['httpSerializedResponseBytes', 'sseApplicationBytesAttempted', 'databaseProviderEgressDelta', 'storageProviderEgressDelta', 'railwayTransmitDelta']) assert.match(runbook, new RegExp(`${layer}.*T0 value/status:.*T1 value/status:.*T1-confirmation value/status:`))
assert.match(runbook, /unavailable.*never substituted with numeric zero/i)
assert.match(runbook, /unusual traffic/i)
assert.match(runbook, /jobs\/scripts executed/i)
assert.match(runbook, /retain only totalDuration and deploymentInstanceId/i)
assert.match(runbook, /transient samples do not trigger rollback/i)
assert.match(runbook, /Un crash del proceso puede omitir el contador `closed` y la duración final de una conexión SSE activa\./)
assert.match(runbook, /Esa ausencia no debe interpretarse como conexión entregada, activa globalmente ni finalización exitosa\./)

console.log('egress baseline runbook: ok')
