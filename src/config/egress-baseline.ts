import type { EgressBaselineConfig } from '../observability/egress-baseline/types.js'

const SAFE_METADATA = /^[A-Za-z0-9._-]+$/

function strictBoolean(value: string | undefined, fallback = false) {
  if (value === undefined) return { valid: true, value: fallback }
  if (value === 'true') return { valid: true, value: true }
  if (value === 'false') return { valid: true, value: false }
  return { valid: false, value: false }
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const canonical = value === undefined || /^(0|[1-9][0-9]*)$/.test(value)
  const parsed = value === undefined ? fallback : canonical ? Number(value) : Number.NaN
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max
  return { valid, value: valid ? parsed : fallback }
}

function metadata(value: string | undefined, max: number) {
  if (value === undefined) return { valid: true, value: 'unknown' }
  if (value.length === 0) return { valid: false, value: 'unknown' }
  return { valid: value.length <= max && SAFE_METADATA.test(value), value: value.length <= max && SAFE_METADATA.test(value) ? value : 'unknown' }
}

export function resolveEgressBaselineConfig(env: Record<string, string | undefined>): EgressBaselineConfig {
  const sink = strictBoolean(env.EGRESS_BASELINE_SINK_ENABLED)
  const http = strictBoolean(env.EGRESS_BASELINE_HTTP_ENABLED)
  const sse = strictBoolean(env.EGRESS_BASELINE_SSE_ENABLED)
  const marker = strictBoolean(env.EGRESS_BASELINE_POLLING_MARKER_ENABLED)
  const window = boundedInteger(env.EGRESS_BASELINE_WINDOW_MS, 60_000, 10_000, 900_000)
  const jitter = boundedInteger(env.EGRESS_BASELINE_JITTER_MS, 5_000, 0, Math.min(window.value / 4, 30_000))
  const keys = boundedInteger(env.EGRESS_BASELINE_MAX_HTTP_KEYS, 256, 16, 512)
  const record = boundedInteger(env.EGRESS_BASELINE_MAX_RECORD_BYTES, 16_384, 4_096, 32_768)
  const records = boundedInteger(env.EGRESS_BASELINE_MAX_RECORDS, 32, 1, 64)
  const flush = boundedInteger(env.EGRESS_BASELINE_MAX_FLUSH_BYTES, 524_288, 65_536, 1_048_576)
  const metaCap = boundedInteger(env.EGRESS_BASELINE_METADATA_MAX_CHARS, 64, 16, 128)
  const budget = boundedInteger(env.EGRESS_BASELINE_SHUTDOWN_BUDGET_MS, 250, 0, 2_000)
  const replica = metadata(env.RAILWAY_REPLICA_ID, metaCap.value)
  const deployment = metadata(env.RAILWAY_DEPLOYMENT_ID, metaCap.value)
  const productValid = record.value * records.value <= flush.value
  const envelopeProbeBytes = Buffer.byteLength(JSON.stringify({
    message: 'egress_baseline_process_window', level: 'info', metric: 'egress_baseline_process_window', schemaVersion: 2,
    processStartId: 'x'.repeat(36), windowId: `${'x'.repeat(36)}:${Number.MAX_SAFE_INTEGER}`, windowSequence: Number.MAX_SAFE_INTEGER,
    windowStartUtc: new Date(0).toISOString(), windowEndUtc: new Date(0).toISOString(), windowDurationMs: Number.MAX_SAFE_INTEGER, resetReason: 'process_start',
    replicaId: 'x'.repeat(Math.min(metaCap.value, 128)), deploymentId: 'x'.repeat(Math.min(metaCap.value, 128)), chunkIndex: Number.MAX_SAFE_INTEGER, chunkCount: Number.MAX_SAFE_INTEGER,
    droppedSnapshotsPendingBeforeFlush: Number.MAX_SAFE_INTEGER, outputBytesAttemptedPendingBeforeFlush: Number.MAX_SAFE_INTEGER, outputRecordsAttemptedPendingBeforeFlush: Number.MAX_SAFE_INTEGER,
    outputBackpressureSignalsPendingBeforeFlush: Number.MAX_SAFE_INTEGER, httpOverflowDistinctKeyCount: Number.MAX_SAFE_INTEGER, httpOverflowRequestCount: Number.MAX_SAFE_INTEGER,
    foldedEntryCount: Number.MAX_SAFE_INTEGER, indivisibleOversizedEntryCount: Number.MAX_SAFE_INTEGER,
    counterSaturation: { http: true, sse: true, output: true, processHealth: true }, processHealth: { samplingStatus: 'ok', eventLoopDelayP95Ms: Number.MAX_SAFE_INTEGER, eventLoopDelayMaxMs: Number.MAX_SAFE_INTEGER, heapUsedBytes: Number.MAX_SAFE_INTEGER, heapTotalBytes: Number.MAX_SAFE_INTEGER },
    sse: { opened: Number.MAX_SAFE_INTEGER, closed: Number.MAX_SAFE_INTEGER, activeLocalCurrent: Number.MAX_SAFE_INTEGER, activeLocalMax: Number.MAX_SAFE_INTEGER, durationTotalMs: Number.MAX_SAFE_INTEGER, durationMaxMs: Number.MAX_SAFE_INTEGER, controlChunksAttempted: Number.MAX_SAFE_INTEGER, heartbeatChunksAttempted: Number.MAX_SAFE_INTEGER, businessChunksAttempted: Number.MAX_SAFE_INTEGER, sseApplicationBytesAttempted: Number.MAX_SAFE_INTEGER, writeBackpressureSignals: Number.MAX_SAFE_INTEGER, synchronousWriteFailures: Number.MAX_SAFE_INTEGER, closeReasons: { client_close: Number.MAX_SAFE_INTEGER, server_shutdown: Number.MAX_SAFE_INTEGER, write_failure: Number.MAX_SAFE_INTEGER, unknown: Number.MAX_SAFE_INTEGER } },
    foldedHttpEntry: { key: '__folded__', requestCount: Number.MAX_SAFE_INTEGER, measuredPayloadCount: Number.MAX_SAFE_INTEGER, unknownPayloadCount: Number.MAX_SAFE_INTEGER, responseBytesTotal: Number.MAX_SAFE_INTEGER, responseBytesMax: Number.MAX_SAFE_INTEGER, durationTotalMs: Number.MAX_SAFE_INTEGER, durationMaxMs: Number.MAX_SAFE_INTEGER, errorCount: Number.MAX_SAFE_INTEGER }, httpEntries: []
  })) + 1
  const envelopeValid = envelopeProbeBytes <= record.value
  const sinkValid = [sink, record, records, flush, metaCap, replica, deployment].every((item) => item.valid) && productValid && envelopeValid
  const sharedWindowValid = window.valid && jitter.valid
  const sinkEffective = sink.value && sinkValid
  const httpEffective = sinkEffective && http.valid && http.value && sharedWindowValid && keys.valid
  const sseEffective = sinkEffective && sse.valid && sse.value && sharedWindowValid
  return {
    sinkEffective,
    httpEffective,
    sseEffective,
    pollingMarkerEffective: httpEffective && marker.valid && marker.value,
    windowMs: window.value,
    jitterMs: jitter.value,
    maxHttpKeys: keys.value,
    maxRecordBytes: record.value,
    maxRecords: records.value,
    maxFlushBytes: flush.value,
    metadataMaxChars: metaCap.value,
    shutdownBudgetMs: budget.value,
    finalFlushEffective: sinkEffective && budget.valid,
    replicaId: replica.value,
    deploymentId: deployment.value
  }
}
