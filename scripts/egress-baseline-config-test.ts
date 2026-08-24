import assert from 'node:assert/strict'
import { resolveEgressBaselineConfig } from '../src/config/egress-baseline.js'

const disabled = resolveEgressBaselineConfig({})
assert.equal(disabled.sinkEffective, false)
assert.equal(disabled.httpEffective, false)
assert.equal(disabled.sseEffective, false)
assert.equal(disabled.pollingMarkerEffective, false)

const full = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_SSE_ENABLED: 'true',
  EGRESS_BASELINE_POLLING_MARKER_ENABLED: 'true'
})
assert.equal(full.httpEffective, true)
assert.equal(full.sseEffective, true)
assert.equal(full.pollingMarkerEffective, true)
assert.equal(full.maxRecordBytes * full.maxRecords <= full.maxFlushBytes, true)

const invalidProduct = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_MAX_RECORD_BYTES: '32768',
  EGRESS_BASELINE_MAX_RECORDS: '64',
  EGRESS_BASELINE_MAX_FLUSH_BYTES: '65536'
})
assert.equal(invalidProduct.sinkEffective, false)
assert.equal(invalidProduct.httpEffective, false)

const invalidMetadata = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  RAILWAY_REPLICA_ID: 'customer@example.com'
})
assert.equal(invalidMetadata.sinkEffective, false)

const invalidHttpOnly = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_SSE_ENABLED: 'true',
  EGRESS_BASELINE_MAX_HTTP_KEYS: '2'
})
assert.equal(invalidHttpOnly.httpEffective, false)
assert.equal(invalidHttpOnly.sseEffective, true, 'HTTP-only invalid config must not disable SSE')

const invalidShutdownOnly = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_SHUTDOWN_BUDGET_MS: 'invalid'
})
assert.equal(invalidShutdownOnly.httpEffective, true)
assert.equal(invalidShutdownOnly.finalFlushEffective, false)

for (const invalidDecimal of ['', '   ', '5e3', '0x1388', '+5000', '05000']) {
  const invalidJitterOnly = resolveEgressBaselineConfig({
    EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true',
    EGRESS_BASELINE_JITTER_MS: invalidDecimal
  })
  assert.equal(invalidJitterOnly.httpEffective, false, `non-canonical jitter ${JSON.stringify(invalidDecimal)} disables HTTP only through the shared window gate`)
  assert.equal(invalidJitterOnly.sseEffective, false)
  assert.equal(invalidJitterOnly.finalFlushEffective, true, 'invalid jitter does not disable an independent valid shutdown budget')

  const invalidBudgetOnly = resolveEgressBaselineConfig({
    EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true',
    EGRESS_BASELINE_SHUTDOWN_BUDGET_MS: invalidDecimal
  })
  assert.equal(invalidBudgetOnly.httpEffective, true, 'invalid shutdown budget does not disable collectors')
  assert.equal(invalidBudgetOnly.sseEffective, true)
  assert.equal(invalidBudgetOnly.finalFlushEffective, false)
}
const canonicalZeros = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true',
  EGRESS_BASELINE_JITTER_MS: '0', EGRESS_BASELINE_SHUTDOWN_BUDGET_MS: '0'
})
assert.equal(canonicalZeros.jitterMs, 0)
assert.equal(canonicalZeros.shutdownBudgetMs, 0)
assert.equal(canonicalZeros.httpEffective, true)
assert.equal(canonicalZeros.finalFlushEffective, true)
assert.equal(resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_WINDOW_MS: '6e4' }).httpEffective, false, 'exponential notation is never accepted for non-zero integer fields')
assert.equal(resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_MAX_HTTP_KEYS: '0x100' }).httpEffective, false, 'hex notation is never accepted for non-zero integer fields')

const emptySuppliedMetadata = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_SSE_ENABLED: 'true',
  RAILWAY_REPLICA_ID: ''
})
assert.equal(emptySuppliedMetadata.sinkEffective, false)
assert.equal(emptySuppliedMetadata.sseEffective, false)

const markerWithoutHttp = resolveEgressBaselineConfig({ EGRESS_BASELINE_POLLING_MARKER_ENABLED: 'true' })
assert.equal(markerWithoutHttp.pollingMarkerEffective, false)

const sinkOnly = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true' })
assert.equal(sinkOnly.sinkEffective, true)
assert.equal(sinkOnly.httpEffective || sinkOnly.sseEffective, false)
assert.equal(resolveEgressBaselineConfig({ EGRESS_BASELINE_HTTP_ENABLED: 'true' }).httpEffective, false)
assert.equal(resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true' }).sseEffective, true)
const malformedHttp = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'yes', EGRESS_BASELINE_SSE_ENABLED: 'true' })
assert.equal(malformedHttp.httpEffective, false)
assert.equal(malformedHttp.sseEffective, true)
const invalidSharedWindow = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true', EGRESS_BASELINE_WINDOW_MS: '9999' })
assert.equal(invalidSharedWindow.httpEffective, false)
assert.equal(invalidSharedWindow.sseEffective, false)
assert.equal(resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', RAILWAY_DEPLOYMENT_ID: 'bad:value' }).sinkEffective, false)
const malformedSink = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'yes', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true' })
assert.equal(malformedSink.sinkEffective || malformedSink.httpEffective || malformedSink.sseEffective, false)
const malformedSse = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'yes' })
assert.equal(malformedSse.httpEffective, true)
assert.equal(malformedSse.sseEffective, false)
const malformedMarker = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_POLLING_MARKER_ENABLED: 'yes' })
assert.equal(malformedMarker.httpEffective, true)
assert.equal(malformedMarker.pollingMarkerEffective, false)

for (const [field, value] of [
  ['EGRESS_BASELINE_WINDOW_MS', 'NaN'],
  ['EGRESS_BASELINE_JITTER_MS', '-1'],
  ['EGRESS_BASELINE_MAX_HTTP_KEYS', 'Infinity'],
  ['EGRESS_BASELINE_MAX_RECORD_BYTES', '-1'],
  ['EGRESS_BASELINE_MAX_RECORDS', 'NaN'],
  ['EGRESS_BASELINE_MAX_FLUSH_BYTES', '-1'],
  ['EGRESS_BASELINE_METADATA_MAX_CHARS', '-1'],
  ['EGRESS_BASELINE_SHUTDOWN_BUDGET_MS', 'Infinity']
] as const) {
  let resolved: ReturnType<typeof resolveEgressBaselineConfig> | undefined
  assert.doesNotThrow(() => { resolved = resolveEgressBaselineConfig({
    EGRESS_BASELINE_SINK_ENABLED: 'true',
    EGRESS_BASELINE_HTTP_ENABLED: 'true',
    EGRESS_BASELINE_SSE_ENABLED: 'true',
    [field]: value
  }) }, `${field}=${value} must fail closed without throwing startup`)
  assert.ok(resolved)
  if (field === 'EGRESS_BASELINE_SHUTDOWN_BUDGET_MS') assert.equal(resolved.finalFlushEffective, false)
  else if (field === 'EGRESS_BASELINE_MAX_HTTP_KEYS') { assert.equal(resolved.httpEffective, false); assert.equal(resolved.sseEffective, true) }
  else if (field === 'EGRESS_BASELINE_WINDOW_MS' || field === 'EGRESS_BASELINE_JITTER_MS') { assert.equal(resolved.httpEffective, false); assert.equal(resolved.sseEffective, false) }
  else assert.equal(resolved.sinkEffective, false)
}

console.log('egress baseline config: ok')
