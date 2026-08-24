import { newHttpAggregate, type HttpAggregate, type WindowSnapshot } from './controller.js'

export interface EncodeLimits { maxRecordBytes: number; maxRecords: number; maxFlushBytes: number }
export interface EncodeMetadata { replicaId: string; deploymentId: string }
export type EncodeResult = { ok: true; recordCount: number; bytes: number; foldedEntryCount: number; indivisibleOversizedEntryCount: number } | { ok: false; reason: 'envelope' | 'bounds' | 'serialization' }

export function encodeSnapshot(snapshot: WindowSnapshot, metadata: EncodeMetadata, limits: EncodeLimits, consume: (record: string) => void): EncodeResult {
  try {
    const remaining = snapshot.httpEntries.map(safeHttpEntry).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    let folded: HttpAggregate | null = snapshot.foldedHttpEntry ? safeHttpEntry(snapshot.foldedHttpEntry) : null
    let foldedEntryCount = folded ? 1 : 0
    let indivisibleOversizedEntryCount = snapshot.indivisibleOversizedEntryCount

    for (let index = remaining.length - 1; index >= 0; index--) {
      const entry = remaining[index]!
      const probe = encodeRecord(snapshot, metadata, 1, 2, [entry], null, foldedEntryCount, indivisibleOversizedEntryCount)
      if (Buffer.byteLength(probe) <= limits.maxRecordBytes) continue
      folded = foldEntries(folded, entry)
      foldedEntryCount++
      indivisibleOversizedEntryCount++
      remaining.splice(index, 1)
    }

    let chunks: HttpAggregate[][] = []
    while (true) {
      const stable = stablePartition(snapshot, metadata, remaining, folded, foldedEntryCount, indivisibleOversizedEntryCount, limits.maxRecordBytes)
      if (!stable) return { ok: false, reason: 'bounds' }
      chunks = stable
      let totalBytes = 0
      let individualBounded = true
      for (let index = 0; index < chunks.length; index++) {
        const recordBytes = Buffer.byteLength(encodeRecord(snapshot, metadata, index, chunks.length, chunks[index]!, index === 0 ? folded : null, foldedEntryCount, indivisibleOversizedEntryCount))
        totalBytes += recordBytes
        if (recordBytes > limits.maxRecordBytes) individualBounded = false
      }
      if (individualBounded && chunks.length <= limits.maxRecords && totalBytes <= limits.maxFlushBytes) break
      const tail = remaining.pop()
      if (!tail) return { ok: false, reason: 'bounds' }
      folded = foldEntries(folded, tail)
      foldedEntryCount++
    }

    let bytes = 0
    for (let index = 0; index < chunks.length; index++) {
      const record = encodeRecord(snapshot, metadata, index, chunks.length, chunks[index]!, index === 0 ? folded : null, foldedEntryCount, indivisibleOversizedEntryCount)
      const recordBytes = Buffer.byteLength(record)
      if (recordBytes > limits.maxRecordBytes || bytes + recordBytes > limits.maxFlushBytes) return { ok: false, reason: 'bounds' }
      consume(record)
      bytes += recordBytes
    }
    return { ok: true, recordCount: chunks.length, bytes, foldedEntryCount, indivisibleOversizedEntryCount }
  } catch {
    return { ok: false, reason: 'serialization' }
  }
}

function partition(snapshot: WindowSnapshot, metadata: EncodeMetadata, entries: HttpAggregate[], folded: HttpAggregate | null, foldedEntryCount: number, oversized: number, maxRecordBytes: number, assumedChunkCount: number) {
  const chunks: HttpAggregate[][] = []
  let current: HttpAggregate[] = []
  for (const entry of entries) {
    const candidate = [...current, entry]
    const probe = encodeRecord(snapshot, metadata, chunks.length, assumedChunkCount, candidate, chunks.length === 0 ? folded : null, foldedEntryCount, oversized)
    if (Buffer.byteLength(probe) > maxRecordBytes && current.length === 0 && chunks.length === 0) {
      const isolatedLaterProbe = encodeRecord(snapshot, metadata, 1, Math.max(2, assumedChunkCount), [entry], null, foldedEntryCount, oversized)
      if (Buffer.byteLength(isolatedLaterProbe) <= maxRecordBytes) {
        chunks.push([])
        current = [entry]
        continue
      }
    }
    if (Buffer.byteLength(probe) > maxRecordBytes && current.length > 0) {
      chunks.push(current)
      current = [entry]
    } else current = candidate
  }
  if (current.length || chunks.length === 0) chunks.push(current)
  return chunks
}

function stablePartition(snapshot: WindowSnapshot, metadata: EncodeMetadata, entries: HttpAggregate[], folded: HttpAggregate | null, foldedEntryCount: number, oversized: number, maxRecordBytes: number) {
  let assumedCount = 1
  let chunks: HttpAggregate[][] = []
  for (let attempt = 0; attempt <= 64; attempt++) {
    chunks = partition(snapshot, metadata, entries, folded, foldedEntryCount, oversized, maxRecordBytes, assumedCount)
    if (chunks.length === assumedCount) return chunks
    if (chunks.length > 64) return null
    assumedCount = chunks.length
  }
  return null
}

function encodeRecord(snapshot: WindowSnapshot, metadata: EncodeMetadata, chunkIndex: number, chunkCount: number, httpEntries: HttpAggregate[], foldedHttpEntry: HttpAggregate | null, foldedEntryCount: number, indivisibleOversizedEntryCount: number) {
  const record = {
    message: 'egress_baseline_process_window',
    level: 'info',
    metric: 'egress_baseline_process_window',
    schemaVersion: 2,
    processStartId: snapshot.processStartId,
    windowId: snapshot.windowId,
    windowSequence: snapshot.windowSequence,
    windowStartUtc: snapshot.windowStartUtc,
    windowEndUtc: snapshot.windowEndUtc,
    windowDurationMs: snapshot.windowDurationMs,
    resetReason: snapshot.resetReason,
    replicaId: metadata.replicaId,
    deploymentId: metadata.deploymentId,
    chunkIndex,
    chunkCount,
    droppedSnapshotsPendingBeforeFlush: snapshot.pendingBeforeFlush.droppedSnapshots,
    outputBytesAttemptedPendingBeforeFlush: snapshot.pendingBeforeFlush.bytes,
    outputRecordsAttemptedPendingBeforeFlush: snapshot.pendingBeforeFlush.records,
    outputBackpressureSignalsPendingBeforeFlush: snapshot.pendingBeforeFlush.backpressureSignals,
    httpOverflowDistinctKeyCount: snapshot.overflowDistinctKeys,
    httpOverflowRequestCount: snapshot.overflowRequestCount,
    foldedEntryCount,
    indivisibleOversizedEntryCount,
    counterSaturation: safeSaturation(snapshot.counterSaturation, foldedHttpEntry),
    processHealth: safeProcessHealth(snapshot.processHealth),
    sse: chunkIndex === 0 ? safeSse(snapshot.sse) : null,
    foldedHttpEntry: chunkIndex === 0 && foldedHttpEntry ? safeHttpEntry(foldedHttpEntry) : null,
    httpEntries: httpEntries.map(safeHttpEntry)
  }
  return `${JSON.stringify(record)}\n`
}

function safeHttpEntry(entry: HttpAggregate): HttpAggregate {
  return {
    key: String(entry.key).slice(0, 512),
    requestCount: safeInteger(entry.requestCount), measuredPayloadCount: safeInteger(entry.measuredPayloadCount), unknownPayloadCount: safeInteger(entry.unknownPayloadCount),
    responseBytesTotal: safeInteger(entry.responseBytesTotal), responseBytesMax: safeInteger(entry.responseBytesMax), durationTotalMs: safeDuration(entry.durationTotalMs), durationMaxMs: safeDuration(entry.durationMaxMs), errorCount: safeInteger(entry.errorCount)
  }
}

function safeInteger(value: number) { return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER }
function safeDuration(value: number) { return Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER }

function foldEntries(current: HttpAggregate | null, entry: HttpAggregate) {
  const folded = current ? { ...current } : newHttpAggregate('__folded__')
  folded.requestCount = saturated(folded.requestCount, entry.requestCount)
  folded.measuredPayloadCount = saturated(folded.measuredPayloadCount, entry.measuredPayloadCount)
  folded.unknownPayloadCount = saturated(folded.unknownPayloadCount, entry.unknownPayloadCount)
  folded.responseBytesTotal = saturated(folded.responseBytesTotal, entry.responseBytesTotal)
  folded.responseBytesMax = Math.max(folded.responseBytesMax, entry.responseBytesMax)
  folded.durationTotalMs = saturated(folded.durationTotalMs, entry.durationTotalMs)
  folded.durationMaxMs = Math.max(folded.durationMaxMs, entry.durationMaxMs)
  folded.errorCount = saturated(folded.errorCount, entry.errorCount)
  return folded
}

function saturated(left: number, right: number) { return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right }
function foldedEntrySaturated(entry: HttpAggregate | null) {
  if (!entry) return false
  return [entry.requestCount, entry.measuredPayloadCount, entry.unknownPayloadCount, entry.responseBytesTotal, entry.durationTotalMs, entry.errorCount].some((value) => value === Number.MAX_SAFE_INTEGER)
}

function safeSaturation(value: WindowSnapshot['counterSaturation'], folded: HttpAggregate | null) {
  return { http: Boolean(value.http || foldedEntrySaturated(folded)), sse: Boolean(value.sse), output: Boolean(value.output), processHealth: Boolean(value.processHealth) }
}

function safeProcessHealth(value: WindowSnapshot['processHealth']) {
  return { samplingStatus: value.samplingStatus, eventLoopDelayP95Ms: value.eventLoopDelayP95Ms, eventLoopDelayMaxMs: value.eventLoopDelayMaxMs, heapUsedBytes: value.heapUsedBytes, heapTotalBytes: value.heapTotalBytes }
}

function safeSse(value: WindowSnapshot['sse']) {
  return {
    opened: safeInteger(value.opened), closed: safeInteger(value.closed), activeLocalCurrent: safeInteger(value.activeLocalCurrent), activeLocalMax: safeInteger(value.activeLocalMax),
    durationTotalMs: safeDuration(value.durationTotalMs), durationMaxMs: safeDuration(value.durationMaxMs), controlChunksAttempted: safeInteger(value.controlChunksAttempted),
    heartbeatChunksAttempted: safeInteger(value.heartbeatChunksAttempted), businessChunksAttempted: safeInteger(value.businessChunksAttempted), sseApplicationBytesAttempted: safeInteger(value.sseApplicationBytesAttempted),
    writeBackpressureSignals: safeInteger(value.writeBackpressureSignals), synchronousWriteFailures: safeInteger(value.synchronousWriteFailures),
    closeReasons: { client_close: safeInteger(value.closeReasons.client_close), server_shutdown: safeInteger(value.closeReasons.server_shutdown), write_failure: safeInteger(value.closeReasons.write_failure), unknown: safeInteger(value.closeReasons.unknown) }
  }
}
