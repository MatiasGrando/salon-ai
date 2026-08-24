import { createReadStream } from 'node:fs'

const FORBIDDEN_KEYS = new Set(['rawUrl', 'url', 'query', 'body', 'authorization', 'cookie', 'headers', 'tenantId', 'businessId', 'userId', 'email', 'phone', 'ip', 'userAgent', 'host', 'requestId', 'error', 'stack'])
const REPEATED = ['message', 'level', 'metric', 'schemaVersion', 'processStartId', 'windowId', 'windowSequence', 'windowStartUtc', 'windowEndUtc', 'windowDurationMs', 'resetReason', 'replicaId', 'deploymentId', 'chunkCount', 'droppedSnapshotsPendingBeforeFlush', 'outputBytesAttemptedPendingBeforeFlush', 'outputRecordsAttemptedPendingBeforeFlush', 'outputBackpressureSignalsPendingBeforeFlush', 'httpOverflowDistinctKeyCount', 'httpOverflowRequestCount', 'foldedEntryCount', 'indivisibleOversizedEntryCount', 'counterSaturation', 'processHealth'] as const
const TOP_KEYS = new Set([...REPEATED, 'chunkIndex', 'sse', 'foldedHttpEntry', 'httpEntries'])
const MAX_LINE_BYTES = 32_768
const MAX_ACTIVE_WINDOWS = 512
const MAX_RETAINED_ACTIVE_BYTES = 4 * 1024 * 1024
const MAX_RESULT_HTTP_KEYS = 512
const MAX_RECENT_COMPLETED_IDS = 512

type SelectedRecord = Record<string, any>

export function analyzeEgressBaselineText(text: string) {
  const windows = new Map<string, SelectedRecord[]>()
  let rejectedRecords = 0
  let retainedBytes = 0
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const lineBytes = Buffer.byteLength(line)
    if (lineBytes > MAX_LINE_BYTES || retainedBytes + lineBytes > MAX_RETAINED_ACTIVE_BYTES) { rejectedRecords++; continue }
    let raw: unknown
    try { raw = JSON.parse(line) } catch { rejectedRecords++; continue }
    if (!isObject(raw) || hasForbiddenNested(raw) || raw.message !== 'egress_baseline_process_window' || raw.schemaVersion !== 2) { rejectedRecords++; continue }
    const record = selectRecord(raw)
    if (!record) { rejectedRecords++; continue }
    const id = `${record.processStartId}\u0000${record.windowId}`
    if (!windows.has(id) && windows.size >= MAX_ACTIVE_WINDOWS) { rejectedRecords++; continue }
    const group = windows.get(id) ?? []
    if (group.length >= 64) { rejectedRecords++; continue }
    group.push(record)
    retainedBytes += lineBytes
    windows.set(id, group)
  }

  let completeWindows = 0
  let incompleteWindows = 0
  let duplicateWindows = 0
  let outputBytesPending = 0
  let outputRecordsPending = 0
  let outputBackpressureSignalsPending = 0
  let droppedSnapshotsPending = 0
  const httpByKey = new Map<string, Record<string, any>>()
  let foldedHttpEntry: Record<string, any> | null = null
  let sseAggregate: Record<string, any> | null = null
  let httpOverflowDistinctKeyCount = 0
  let httpOverflowRequestCount = 0
  let foldedEntryCount = 0
  let indivisibleOversizedEntryCount = 0
  const counterSaturation = { http: false, sse: false, output: false, processHealth: false }
  const processHealth = { okWindows: 0, unavailableWindows: 0, eventLoopDelayP95MsMax: null as number | null, eventLoopDelayMaxMsMax: null as number | null, heapUsedBytesMax: null as number | null, heapTotalBytesMax: null as number | null }
  let resultHttpKeyOverflow = 0
  const completeSequences = new Map<string, number[]>()

  for (const group of windows.values()) {
    const sorted = [...group].sort((left, right) => left.chunkIndex - right.chunkIndex)
    const first = sorted[0]
    const indexes = sorted.map((record) => record.chunkIndex)
    const hasDuplicate = new Set(indexes).size !== indexes.length
    const complete = Boolean(first?.sse)
      && !hasDuplicate
      && Number.isInteger(first.chunkCount)
      && first.chunkCount > 0
      && first.chunkCount <= 64
      && sorted.length === first.chunkCount
      && sorted.every((record, index) => record.chunkIndex === index && repeatedEqual(first, record) && (index === 0 || (record.sse === null && record.foldedHttpEntry === null)))
      && canonicalWindowPayload(first, sorted)
    if (!complete) {
      incompleteWindows++
      if (hasDuplicate) duplicateWindows++
      continue
    }
    completeWindows++
    outputBytesPending += first.outputBytesAttemptedPendingBeforeFlush
    outputRecordsPending += first.outputRecordsAttemptedPendingBeforeFlush
    outputBackpressureSignalsPending += first.outputBackpressureSignalsPendingBeforeFlush
    droppedSnapshotsPending += first.droppedSnapshotsPendingBeforeFlush
    for (const record of sorted) {
      for (const entry of record.httpEntries) {
        const existing = httpByKey.get(entry.key)
        if (existing) mergeHttpAggregate(existing, entry)
        else if (httpByKey.size < MAX_RESULT_HTTP_KEYS) httpByKey.set(entry.key, { ...entry })
        else resultHttpKeyOverflow++
      }
    }
    if (first.foldedHttpEntry) foldedHttpEntry = foldedHttpEntry ? mergeHttpAggregate(foldedHttpEntry, first.foldedHttpEntry) : { ...first.foldedHttpEntry }
    sseAggregate = mergeSseAggregate(sseAggregate, first.sse)
    httpOverflowDistinctKeyCount = saturatedSum(httpOverflowDistinctKeyCount, first.httpOverflowDistinctKeyCount)
    httpOverflowRequestCount = saturatedSum(httpOverflowRequestCount, first.httpOverflowRequestCount)
    foldedEntryCount = saturatedSum(foldedEntryCount, first.foldedEntryCount)
    indivisibleOversizedEntryCount = saturatedSum(indivisibleOversizedEntryCount, first.indivisibleOversizedEntryCount)
    for (const domain of Object.keys(counterSaturation) as Array<keyof typeof counterSaturation>) counterSaturation[domain] ||= first.counterSaturation[domain]
    mergeHealthSummary(processHealth, first.processHealth)
    const sequences = completeSequences.get(first.processStartId) ?? []
    sequences.push(first.windowSequence)
    completeSequences.set(first.processStartId, sequences)
  }

  let sequenceGaps = 0
  for (const sequences of completeSequences.values()) {
    sequences.sort((a, b) => a - b)
    for (let index = 1; index < sequences.length; index++) if (sequences[index] !== sequences[index - 1]! + 1) sequenceGaps++
  }
  const httpEntries = [...httpByKey.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  const applicationHttpBytes = httpEntries.reduce((sum, entry) => saturatedSum(sum, entry.responseBytesTotal), foldedHttpEntry?.responseBytesTotal ?? 0)
  const httpLayer = completeWindows > 0 ? { status: 'available' as const, value: applicationHttpBytes } : { status: 'unavailable' as const, value: null }
  const sseLayer = completeWindows > 0 ? { status: 'available' as const, value: sseAggregate?.sseApplicationBytesAttempted ?? 0 } : { status: 'unavailable' as const, value: null }
  return {
    completeWindows, incompleteWindows, duplicateWindows, sequenceGaps, outputBytesPending, outputRecordsPending, outputBackpressureSignalsPending, droppedSnapshotsPending,
    httpEntries, foldedHttpEntry, sseAggregate, httpOverflowDistinctKeyCount, httpOverflowRequestCount, foldedEntryCount, indivisibleOversizedEntryCount, counterSaturation, processHealth,
    resultHttpKeyOverflow, admissionRejectedWindows: 0, rejectedRecords,
    layers: {
      httpSerializedResponseBytes: httpLayer,
      sseApplicationBytesAttempted: sseLayer,
      databaseProviderEgressDelta: { status: 'unavailable', value: null },
      storageProviderEgressDelta: { status: 'unavailable', value: null },
      railwayTransmitDelta: { status: 'unavailable', value: null }
    }
  }
}

function canonicalWindowPayload(first: SelectedRecord, records: SelectedRecord[]) {
  const entries = records.flatMap((record) => record.httpEntries)
  const keys = entries.map((entry: { key: string }) => entry.key)
  if (new Set(keys).size !== keys.length) return false
  if (first.foldedEntryCount === 0 && first.foldedHttpEntry !== null) return false
  if (first.foldedEntryCount > 0 && first.foldedHttpEntry === null) return false
  if (first.indivisibleOversizedEntryCount > first.foldedEntryCount) return false
  const hasOther = keys.includes('__other__')
  const other = entries.find((entry: { key: string }) => entry.key === '__other__')
  if ((first.httpOverflowRequestCount > 0 || first.httpOverflowDistinctKeyCount > 0) && !hasOther) return false
  if (first.httpOverflowRequestCount === 0 && (first.httpOverflowDistinctKeyCount !== 0 || hasOther)) return false
  if (other && other.requestCount !== first.httpOverflowRequestCount) return false
  if (first.httpOverflowDistinctKeyCount > first.httpOverflowRequestCount) return false
  return true
}

function saturatedSum(left: number, right: number) {
  return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right
}

function mergeHttpAggregate(target: Record<string, any>, source: Record<string, any>) {
  for (const field of ['requestCount', 'measuredPayloadCount', 'unknownPayloadCount', 'responseBytesTotal', 'durationTotalMs', 'errorCount']) target[field] = saturatedSum(target[field], source[field])
  target.responseBytesMax = Math.max(target.responseBytesMax, source.responseBytesMax)
  target.durationMaxMs = Math.max(target.durationMaxMs, source.durationMaxMs)
  return target
}

function mergeSseAggregate(target: Record<string, any> | null, source: Record<string, any>) {
  if (!target) return { ...source, closeReasons: { ...source.closeReasons } }
  for (const field of ['opened', 'closed', 'durationTotalMs', 'controlChunksAttempted', 'heartbeatChunksAttempted', 'businessChunksAttempted', 'sseApplicationBytesAttempted', 'writeBackpressureSignals', 'synchronousWriteFailures']) target[field] = saturatedSum(target[field], source[field])
  target.activeLocalCurrent = source.activeLocalCurrent
  target.activeLocalMax = Math.max(target.activeLocalMax, source.activeLocalMax)
  target.durationMaxMs = Math.max(target.durationMaxMs, source.durationMaxMs)
  for (const reason of ['client_close', 'server_shutdown', 'write_failure', 'unknown']) target.closeReasons[reason] = saturatedSum(target.closeReasons[reason], source.closeReasons[reason])
  return target
}

function mergeHealthSummary(target: Record<string, any>, source: Record<string, any>) {
  if (source.samplingStatus === 'ok') target.okWindows++
  else target.unavailableWindows++
  for (const [sourceField, targetField] of [['eventLoopDelayP95Ms', 'eventLoopDelayP95MsMax'], ['eventLoopDelayMaxMs', 'eventLoopDelayMaxMsMax'], ['heapUsedBytes', 'heapUsedBytesMax'], ['heapTotalBytes', 'heapTotalBytesMax']] as const) {
    if (source[sourceField] !== null) target[targetField] = target[targetField] === null ? source[sourceField] : Math.max(target[targetField], source[sourceField])
  }
}

function selectRecord(raw: Record<string, any>): SelectedRecord | null {
  if (!exactKeys(raw, TOP_KEYS)) return null
  const selected: SelectedRecord = {}
  for (const field of REPEATED) selected[field] = raw[field]
  selected.chunkIndex = raw.chunkIndex
  selected.sse = raw.sse === null ? null : safeSse(raw.sse)
  selected.foldedHttpEntry = raw.foldedHttpEntry === null ? null : safeHttpEntry(raw.foldedHttpEntry, 'fold')
  selected.httpEntries = Array.isArray(raw.httpEntries) ? raw.httpEntries.map((entry: unknown) => safeHttpEntry(entry, 'http')) : null
  if (!REPEATED.every((field) => raw[field] !== undefined) || !Number.isInteger(selected.chunkIndex) || !Array.isArray(selected.httpEntries)) return null
  selected.counterSaturation = safeSaturation(raw.counterSaturation)
  selected.processHealth = safeHealth(raw.processHealth)
  if ((raw.sse !== null && !selected.sse) || selected.httpEntries.some((entry: unknown) => !entry) || (raw.foldedHttpEntry !== null && !selected.foldedHttpEntry) || !selected.counterSaturation || !selected.processHealth) return null
  if (!safeFiniteFields(selected) || !validIdentity(selected)) return null
  return selected
}

function safeFiniteFields(record: SelectedRecord) {
  const fields = ['windowSequence', 'windowDurationMs', 'chunkIndex', 'chunkCount', 'droppedSnapshotsPendingBeforeFlush', 'outputBytesAttemptedPendingBeforeFlush', 'outputRecordsAttemptedPendingBeforeFlush', 'outputBackpressureSignalsPendingBeforeFlush', 'httpOverflowDistinctKeyCount', 'httpOverflowRequestCount', 'foldedEntryCount', 'indivisibleOversizedEntryCount']
  return fields.every((field) => Number.isSafeInteger(record[field]) && record[field] >= 0)
}

function safeHttpEntry(entry: unknown, placement: 'http' | 'fold') {
  const keys = new Set(['key', 'requestCount', 'measuredPayloadCount', 'unknownPayloadCount', 'responseBytesTotal', 'responseBytesMax', 'durationTotalMs', 'durationMaxMs', 'errorCount'])
  if (!isObject(entry) || !exactKeys(entry, keys) || typeof entry.key !== 'string' || entry.key.length > 512) return null
  if (placement === 'fold' ? entry.key !== '__folded__' : !validHttpKey(entry.key)) return null
  const integerFields = ['requestCount', 'measuredPayloadCount', 'unknownPayloadCount', 'responseBytesTotal', 'responseBytesMax', 'errorCount']
  const durationFields = ['durationTotalMs', 'durationMaxMs']
  if (!integerFields.every((field) => Number.isSafeInteger(entry[field]) && entry[field] >= 0)) return null
  if (!durationFields.every((field) => Number.isFinite(entry[field]) && entry[field] >= 0 && entry[field] <= Number.MAX_SAFE_INTEGER)) return null
  if (entry.measuredPayloadCount + entry.unknownPayloadCount !== entry.requestCount) return null
  if (entry.errorCount > entry.requestCount || entry.responseBytesMax > entry.responseBytesTotal || entry.durationMaxMs > entry.durationTotalMs) return null
  if (entry.measuredPayloadCount === 0 && (entry.responseBytesTotal !== 0 || entry.responseBytesMax !== 0)) return null
  return Object.fromEntries([...keys].map((key) => [key, entry[key]]))
}

function validHttpKey(key: string) {
  if (key === '__other__') return true
  let tuple: unknown
  try { tuple = JSON.parse(key) } catch { return false }
  if (!Array.isArray(tuple) || tuple.length !== 6) return false
  const [method, route, statusClass, source, polling, mode] = tuple
  return key === JSON.stringify(tuple)
    && ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'].includes(method)
    && typeof route === 'string'
    && (route === '__unmatched__' || route === '__unknown_registered__' || (route.length > 0 && route.length <= 160 && /^[A-Za-z0-9_./:*-]+$/.test(route)))
    && ['1xx', '2xx', '3xx', '4xx', '5xx'].includes(statusClass)
    && ['crm', 'webhook', 'public', 'internal', 'unknown'].includes(source)
    && typeof polling === 'boolean'
    && ['serialized_string', 'buffer', 'typed_array', 'zero_semantic', 'unknown'].includes(mode)
}

function repeatedEqual(left: SelectedRecord, right: SelectedRecord) { return REPEATED.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field])) }
function isObject(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, any>, allowed: Set<string>) { const keys = Object.keys(value); return keys.length === allowed.size && keys.every((key) => allowed.has(key)) }
function safeSaturation(value: unknown) { const keys = new Set(['http', 'sse', 'output', 'processHealth']); return isObject(value) && exactKeys(value, keys) && [...keys].every((key) => typeof value[key] === 'boolean') ? { http: value.http, sse: value.sse, output: value.output, processHealth: value.processHealth } : null }
function safeHealth(value: unknown) {
  const keys = new Set(['samplingStatus', 'eventLoopDelayP95Ms', 'eventLoopDelayMaxMs', 'heapUsedBytes', 'heapTotalBytes'])
  if (!isObject(value) || !exactKeys(value, keys) || !['ok', 'unavailable'].includes(value.samplingStatus)) return null
  const validDuration = (field: string) => value[field] === null || (Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= Number.MAX_SAFE_INTEGER)
  const validHeap = (field: string) => value[field] === null || (Number.isSafeInteger(value[field]) && value[field] >= 0)
  if (!['eventLoopDelayP95Ms', 'eventLoopDelayMaxMs'].every(validDuration) || !['heapUsedBytes', 'heapTotalBytes'].every(validHeap)) return null
  if (value.samplingStatus === 'ok' && ['eventLoopDelayP95Ms', 'eventLoopDelayMaxMs', 'heapUsedBytes', 'heapTotalBytes'].some((field) => value[field] === null)) return null
  if (value.samplingStatus === 'unavailable' && (value.eventLoopDelayP95Ms !== null || value.eventLoopDelayMaxMs !== null)) return null
  return { samplingStatus: value.samplingStatus, eventLoopDelayP95Ms: value.eventLoopDelayP95Ms, eventLoopDelayMaxMs: value.eventLoopDelayMaxMs, heapUsedBytes: value.heapUsedBytes, heapTotalBytes: value.heapTotalBytes }
}
function safeSse(value: unknown) {
  const keys = new Set(['opened', 'closed', 'activeLocalCurrent', 'activeLocalMax', 'durationTotalMs', 'durationMaxMs', 'controlChunksAttempted', 'heartbeatChunksAttempted', 'businessChunksAttempted', 'sseApplicationBytesAttempted', 'writeBackpressureSignals', 'synchronousWriteFailures', 'closeReasons'])
  const closeKeys = new Set(['client_close', 'server_shutdown', 'write_failure', 'unknown'])
  if (!isObject(value) || !exactKeys(value, keys) || !isObject(value.closeReasons) || !exactKeys(value.closeReasons, closeKeys)) return null
  const durationFields = new Set(['durationTotalMs', 'durationMaxMs'])
  if (![...keys].filter((key) => key !== 'closeReasons' && !durationFields.has(key)).every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null
  if (![...durationFields].every((key) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= Number.MAX_SAFE_INTEGER)) return null
  if (![...closeKeys].every((key) => Number.isSafeInteger(value.closeReasons[key]) && value.closeReasons[key] >= 0)) return null
  return { ...Object.fromEntries([...keys].filter((key) => key !== 'closeReasons').map((key) => [key, value[key]])), closeReasons: Object.fromEntries([...closeKeys].map((key) => [key, value.closeReasons[key]])) }
}
function validIdentity(value: SelectedRecord) {
  const safeMetadata = (candidate: unknown) => typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128 && /^[A-Za-z0-9._-]+$/.test(candidate)
  return value.message === 'egress_baseline_process_window'
    && value.level === 'info'
    && value.metric === 'egress_baseline_process_window'
    && value.schemaVersion === 2
    && safeMetadata(value.processStartId)
    && typeof value.windowId === 'string'
    && value.windowId === `${value.processStartId}:${value.windowSequence}`
    && safeMetadata(value.replicaId)
    && safeMetadata(value.deploymentId)
    && ['process_start', 'interval', 'manual', 'close'].includes(value.resetReason)
    && typeof value.windowStartUtc === 'string'
    && typeof value.windowEndUtc === 'string'
    && canonicalUtc(value.windowStartUtc)
    && canonicalUtc(value.windowEndUtc)
    && Date.parse(value.windowEndUtc) >= Date.parse(value.windowStartUtc)
    && Date.parse(value.windowEndUtc) - Date.parse(value.windowStartUtc) === value.windowDurationMs
}

function canonicalUtc(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
function hasForbiddenNested(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenNested)
  if (!isObject(value)) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || hasForbiddenNested(child))
}

if (process.argv[1]?.endsWith('analyze-egress-baseline-logs.ts') && process.argv[2]) process.stdout.write(`${JSON.stringify(await analyzeEgressBaselineFile(process.argv[2]))}\n`)

export async function analyzeEgressBaselineFile(path: string) {
  const boundedWindows = new Map<string, { records: SelectedRecord[]; bytes: number }>()
  const recentCompletedWindowIds = new Map<string, true>()
  const lastSequenceByProcess = new Map<string, number>()
  const aggregate = emptyAnalysis()
  let rejected = 0
  let retainedActiveBytes = 0
  const lines = iterateBoundedLines(createReadStream(path), MAX_LINE_BYTES, () => {}, () => { rejected++ })
  for await (const line of lines) {
    const lineBytes = Buffer.byteLength(line)
    if (lineBytes > MAX_LINE_BYTES) { rejected++; continue }
    let raw: unknown
    try { raw = JSON.parse(line) } catch { rejected++; continue }
    if (!isObject(raw) || hasForbiddenNested(raw) || !exactKeys(raw, TOP_KEYS)) { rejected++; continue }
    const selected = selectRecord(raw)
    if (!selected) { rejected++; continue }
    const id = `${selected.processStartId}\u0000${selected.windowId}`
    if (recentCompletedWindowIds.has(id)) { aggregate.duplicateWindows++; rejected++; continue }
    let group = boundedWindows.get(id)
    if (!group) {
      if (boundedWindows.size >= MAX_ACTIVE_WINDOWS || retainedActiveBytes + lineBytes > MAX_RETAINED_ACTIVE_BYTES) { aggregate.admissionRejectedWindows++; rejected++; continue }
      group = { records: [], bytes: 0 }
      boundedWindows.set(id, group)
    }
    if (group.records.length >= 64 || retainedActiveBytes + lineBytes > MAX_RETAINED_ACTIVE_BYTES) { rejected++; continue }
    group.records.push(selected)
    group.bytes += lineBytes
    retainedActiveBytes += lineBytes
    if (Number.isSafeInteger(selected.chunkCount) && selected.chunkCount > 0 && group.records.length === selected.chunkCount) {
      const windowResult = analyzeEgressBaselineText(group.records.map((record) => JSON.stringify(record)).join('\n'))
      mergeAnalysis(aggregate, windowResult)
      if (windowResult.completeWindows === 1) {
        const canonical = group.records.find((record) => record.chunkIndex === 0)!
        const previous = lastSequenceByProcess.get(canonical.processStartId)
        if (previous !== undefined && canonical.windowSequence > previous + 1) aggregate.sequenceGaps++
        if (lastSequenceByProcess.size < MAX_ACTIVE_WINDOWS || lastSequenceByProcess.has(canonical.processStartId)) lastSequenceByProcess.set(canonical.processStartId, Math.max(previous ?? -1, canonical.windowSequence))
      }
      recentCompletedWindowIds.set(id, true)
      if (recentCompletedWindowIds.size > MAX_RECENT_COMPLETED_IDS) recentCompletedWindowIds.delete(recentCompletedWindowIds.keys().next().value!)
      retainedActiveBytes -= group.bytes
      boundedWindows.delete(id)
    }
  }
  for (const group of boundedWindows.values()) mergeAnalysis(aggregate, analyzeEgressBaselineText(group.records.map((record) => JSON.stringify(record)).join('\n')))
  aggregate.rejectedRecords += rejected
  return aggregate
}

export async function* iterateBoundedLines(input: AsyncIterable<Buffer | string>, maxLineBytes = MAX_LINE_BYTES, observeRetainedBytes: (bytes: number) => void = () => {}, onOversizedLine: () => void = () => {}) {
  let parts: Buffer[] = []
  let retainedBytes = 0
  let discarding = false
  const reset = () => { parts = []; retainedBytes = 0; observeRetainedBytes(0) }
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset)
      const end = newline === -1 ? chunk.length : newline
      const segment = chunk.subarray(offset, end)
      if (!discarding && retainedBytes + segment.length <= maxLineBytes) {
        if (segment.length) parts.push(segment)
        retainedBytes += segment.length
        observeRetainedBytes(retainedBytes)
      } else if (!discarding) {
        discarding = true
        onOversizedLine()
        reset()
      }
      if (newline !== -1) {
        if (!discarding) {
          const line = Buffer.concat(parts, retainedBytes)
          const content = line.length > 0 && line[line.length - 1] === 0x0d ? line.subarray(0, -1) : line
          yield content.toString('utf8')
        }
        discarding = false
        reset()
        offset = newline + 1
      } else offset = chunk.length
    }
  }
  if (!discarding && retainedBytes > 0) yield Buffer.concat(parts, retainedBytes).toString('utf8')
}

type AnalysisResult = ReturnType<typeof analyzeEgressBaselineText>

function emptyAnalysis(): AnalysisResult {
  return {
    completeWindows: 0,
    incompleteWindows: 0,
    duplicateWindows: 0,
    sequenceGaps: 0,
    outputBytesPending: 0,
    outputRecordsPending: 0,
    outputBackpressureSignalsPending: 0,
    droppedSnapshotsPending: 0,
    httpEntries: [],
    foldedHttpEntry: null,
    sseAggregate: null,
    httpOverflowDistinctKeyCount: 0,
    httpOverflowRequestCount: 0,
    foldedEntryCount: 0,
    indivisibleOversizedEntryCount: 0,
    counterSaturation: { http: false, sse: false, output: false, processHealth: false },
    processHealth: { okWindows: 0, unavailableWindows: 0, eventLoopDelayP95MsMax: null, eventLoopDelayMaxMsMax: null, heapUsedBytesMax: null, heapTotalBytesMax: null },
    resultHttpKeyOverflow: 0,
    admissionRejectedWindows: 0,
    rejectedRecords: 0,
    layers: { httpSerializedResponseBytes: { status: 'unavailable', value: null }, sseApplicationBytesAttempted: { status: 'unavailable', value: null }, databaseProviderEgressDelta: { status: 'unavailable', value: null }, storageProviderEgressDelta: { status: 'unavailable', value: null }, railwayTransmitDelta: { status: 'unavailable', value: null } }
  }
}

function mergeAnalysis(target: AnalysisResult, source: AnalysisResult) {
  target.completeWindows += source.completeWindows
  target.incompleteWindows += source.incompleteWindows
  target.duplicateWindows += source.duplicateWindows
  target.sequenceGaps += source.sequenceGaps
  target.outputBytesPending += source.outputBytesPending
  target.outputRecordsPending += source.outputRecordsPending
  target.outputBackpressureSignalsPending += source.outputBackpressureSignalsPending
  target.droppedSnapshotsPending += source.droppedSnapshotsPending
  for (const entry of source.httpEntries) {
    const existing = target.httpEntries.find((candidate) => candidate.key === entry.key)
    if (existing) mergeHttpAggregate(existing, entry)
    else if (target.httpEntries.length < MAX_RESULT_HTTP_KEYS) target.httpEntries.push({ ...entry })
    else target.resultHttpKeyOverflow++
  }
  if (source.foldedHttpEntry) target.foldedHttpEntry = target.foldedHttpEntry ? mergeHttpAggregate(target.foldedHttpEntry, source.foldedHttpEntry) : { ...source.foldedHttpEntry }
  target.sseAggregate = source.sseAggregate ? mergeSseAggregate(target.sseAggregate, source.sseAggregate) : target.sseAggregate
  target.httpOverflowDistinctKeyCount = saturatedSum(target.httpOverflowDistinctKeyCount, source.httpOverflowDistinctKeyCount)
  target.httpOverflowRequestCount = saturatedSum(target.httpOverflowRequestCount, source.httpOverflowRequestCount)
  target.foldedEntryCount = saturatedSum(target.foldedEntryCount, source.foldedEntryCount)
  target.indivisibleOversizedEntryCount = saturatedSum(target.indivisibleOversizedEntryCount, source.indivisibleOversizedEntryCount)
  for (const domain of Object.keys(target.counterSaturation) as Array<keyof typeof target.counterSaturation>) target.counterSaturation[domain] ||= source.counterSaturation[domain]
  target.processHealth.okWindows += source.processHealth.okWindows
  target.processHealth.unavailableWindows += source.processHealth.unavailableWindows
  for (const field of ['eventLoopDelayP95MsMax', 'eventLoopDelayMaxMsMax', 'heapUsedBytesMax', 'heapTotalBytesMax'] as const) if (source.processHealth[field] !== null) target.processHealth[field] = target.processHealth[field] === null ? source.processHealth[field] : Math.max(target.processHealth[field]!, source.processHealth[field]!)
  target.resultHttpKeyOverflow += source.resultHttpKeyOverflow
  target.admissionRejectedWindows += source.admissionRejectedWindows
  if (source.layers.httpSerializedResponseBytes.status === 'available') {
    const previous = target.layers.httpSerializedResponseBytes.status === 'available' ? target.layers.httpSerializedResponseBytes.value : 0
    target.layers.httpSerializedResponseBytes = { status: 'available', value: saturatedSum(previous!, source.layers.httpSerializedResponseBytes.value!) }
  }
  if (source.layers.sseApplicationBytesAttempted.status === 'available') {
    const previous = target.layers.sseApplicationBytesAttempted.status === 'available' ? target.layers.sseApplicationBytesAttempted.value : 0
    target.layers.sseApplicationBytesAttempted = { status: 'available', value: saturatedSum(previous!, source.layers.sseApplicationBytesAttempted.value!) }
  }
  target.rejectedRecords += source.rejectedRecords
}
