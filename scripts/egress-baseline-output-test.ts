import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { resolveEgressBaselineConfig } from '../src/config/egress-baseline.js'
import { installEgressBaseline } from '../src/observability/egress-baseline/install.js'
import { StdoutNdjsonSink } from '../src/observability/egress-baseline/stdout-ndjson-sink.js'
import { encodeSnapshot } from '../src/observability/egress-baseline/snapshot-encoder.js'
import { analyzeEgressBaselineFile, analyzeEgressBaselineText, iterateBoundedLines } from './analyze-egress-baseline-logs.js'
import { EgressBaselineController } from '../src/observability/egress-baseline/controller.js'

const noEvidence = analyzeEgressBaselineText('')
assert.deepEqual(noEvidence.layers.httpSerializedResponseBytes, { status: 'unavailable', value: null }, 'zero complete windows never masquerades as measured zero HTTP egress')
assert.deepEqual(noEvidence.layers.sseApplicationBytesAttempted, { status: 'unavailable', value: null }, 'zero complete windows never masquerades as measured zero SSE egress')

class FakeWritable extends EventEmitter {
  mode: 'true' | 'false' | 'throw' = 'true'
  chunks: string[] = []
  write(chunk: string, callback?: (error?: Error | null) => void) {
    if (this.mode === 'throw') throw new Error('sync')
    this.chunks.push(chunk)
    callback?.(null)
    return this.mode === 'true'
  }
}

class AsyncFakeWritable extends EventEmitter {
  callbacks: Array<(error?: Error | null) => void> = []
  write(_chunk: string, callback?: (error?: Error | null) => void) { if (callback) this.callbacks.push(callback); return true }
}

type WriteAction = true | false | 'throw'
class ScriptedWritable extends EventEmitter {
  attempts: string[] = []
  constructor(private readonly actions: WriteAction[]) { super() }
  write(chunk: string, callback?: (error?: Error | null) => void) {
    this.attempts.push(chunk)
    const action = this.actions.shift() ?? true
    if (action === 'throw') throw new Error('scripted synchronous failure')
    callback?.(null)
    return action
  }
}

class ManualTimer { unref() {} }
class ManualScheduler {
  callback: (() => void) | null = null
  setTimeout(callback: () => void) { this.callback = callback; return new ManualTimer() }
  clearTimeout() { this.callback = null }
  setImmediate(callback: () => void) { callback(); return new ManualTimer() }
  fire() { const callback = this.callback; assert.ok(callback, 'a productive flush timer is scheduled'); this.callback = null; callback() }
}

async function createInstalledOutputFixture(writable: ScriptedWritable, diagnosticWritable?: FakeWritable) {
  const app = Fastify()
  const scheduler = new ManualScheduler()
  installEgressBaseline(app, resolveEgressBaselineConfig({
    EGRESS_BASELINE_SINK_ENABLED: 'true',
    EGRESS_BASELINE_HTTP_ENABLED: 'true',
    EGRESS_BASELINE_JITTER_MS: '0',
    EGRESS_BASELINE_MAX_HTTP_KEYS: '64',
    EGRESS_BASELINE_MAX_RECORD_BYTES: '4096',
    EGRESS_BASELINE_MAX_RECORDS: '64',
    EGRESS_BASELINE_MAX_FLUSH_BYTES: '262144'
  }), { writable, diagnosticWritable, scheduler })
  app.get('/output-seed', async () => ({ ok: true }))
  for (let index = 0; index < 24; index++) {
    app.get(`/output-split-${index}-${'x'.repeat(72)}`, async () => ({ index }))
  }
  return { app, scheduler }
}

async function recordSplitTraffic(app: ReturnType<typeof Fastify>) {
  for (let index = 0; index < 24; index++) {
    const response = await app.inject(`/output-split-${index}-${'x'.repeat(72)}`)
    assert.equal(response.statusCode, 200)
  }
}

const writable = new FakeWritable()
let terminal = 0
const sink = new StdoutNdjsonSink(writable, () => { terminal++ })
assert.equal(sink.write('{"a":1}\n'), true)
writable.mode = 'false'
assert.equal(sink.write('{"b":2}\n'), false)
assert.equal(sink.pressured, true)
writable.emit('drain')
assert.equal(sink.pressured, false)
writable.emit('error', new Error('async'))
assert.equal(terminal, 1)
assert.equal(sink.terminal, true)
assert.equal(sink.droppedSnapshots, 0, 'async errors cannot retroactively drop an accepted snapshot')
assert.equal(sink.write('{"c":3}\n'), false)

const throwing = new FakeWritable()
throwing.mode = 'throw'
const throwSink = new StdoutNdjsonSink(throwing, () => {})
assert.equal(throwSink.write('x'), false)
assert.equal(throwSink.droppedSnapshots, 1)

const asyncWritable = new AsyncFakeWritable()
const firstSink = new StdoutNdjsonSink(asyncWritable, () => {})
const secondSink = new StdoutNdjsonSink(asyncWritable, () => {})
firstSink.write('pending')
firstSink.close()
assert.equal(asyncWritable.listenerCount('error'), 2, 'in-flight close keeps its own late-error listener')
asyncWritable.callbacks.shift()?.(null)
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(asyncWritable.listenerCount('error'), 1, 'closing one sink never removes the other sink listener')
secondSink.close()
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(asyncWritable.listenerCount('error'), 0)

const delayedErrorWritable = new AsyncFakeWritable()
let delayedTerminal = 0
const delayedErrorSink = new StdoutNdjsonSink(delayedErrorWritable, () => { delayedTerminal++ })
assert.equal(delayedErrorSink.write('accepted-but-uncertain'), true)
delayedErrorWritable.callbacks.shift()?.(new Error('late callback'))
assert.equal(delayedTerminal, 1)
assert.equal(delayedErrorSink.droppedSnapshots, 0, 'late async error is terminal-only, never retroactive drop')

const neverCallbackWritable = new AsyncFakeWritable()
const neverCallbackSink = new StdoutNdjsonSink(neverCallbackWritable, () => {})
neverCallbackSink.write('bounded-in-flight')
neverCallbackSink.close()
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(neverCallbackWritable.listenerCount('error'), 1, 'one app-scoped listener remains for never-callback compromise')

let wall = 0
const controller = new EgressBaselineController({ processStartId: 'p', utcNow: () => new Date(wall++ * 1000), maxHttpKeys: 20 })
for (let index = 0; index < 8; index++) controller.recordHttp({ key: JSON.stringify(['GET', `/crm/test-${index}-${'x'.repeat(20)}`, '2xx', 'crm', false, 'serialized_string']), durationMs: index + 1, bytes: 10, hadError: index === 7 })
const snapshot = controller.detach()
const records: string[] = []
const encoded = encodeSnapshot(snapshot, { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 1600, maxRecords: 8, maxFlushBytes: 12_800 }, (record) => records.push(record))
assert.equal(encoded.ok, true)
assert.equal(records.length > 1, true)
const parsed = records.map((record) => JSON.parse(record))
assert.equal(parsed.every((record) => record.message === 'egress_baseline_process_window'), true)
assert.equal(parsed[0].sse.opened, 0)
assert.equal(parsed.slice(1).every((record) => record.sse === null), true)
assert.equal(parsed.flatMap((record) => record.httpEntries).length, 8)
assert.equal(records.every((record) => Buffer.byteLength(record) <= 1600), true)
const allowed = new Set(['message', 'level', 'metric', 'schemaVersion', 'processStartId', 'windowId', 'windowSequence', 'windowStartUtc', 'windowEndUtc', 'windowDurationMs', 'resetReason', 'replicaId', 'deploymentId', 'chunkIndex', 'chunkCount', 'droppedSnapshotsPendingBeforeFlush', 'outputBytesAttemptedPendingBeforeFlush', 'outputRecordsAttemptedPendingBeforeFlush', 'outputBackpressureSignalsPendingBeforeFlush', 'httpOverflowDistinctKeyCount', 'httpOverflowRequestCount', 'foldedEntryCount', 'indivisibleOversizedEntryCount', 'counterSaturation', 'processHealth', 'sse', 'foldedHttpEntry', 'httpEntries'])
assert.equal(parsed.every((record) => Object.keys(record).length === allowed.size && Object.keys(record).every((key) => allowed.has(key))), true)
assert.equal(parsed.some((record) => 'entries' in record), false)
assert.equal(parsed.every((record) => record.metric === 'egress_baseline_process_window'), true)
assert.deepEqual(Object.keys(parsed[0].counterSaturation).sort(), ['http', 'output', 'processHealth', 'sse'])
assert.deepEqual(parsed[0].processHealth, { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null })
assert.deepEqual(Object.keys(parsed[0].sse).sort(), ['activeLocalCurrent', 'activeLocalMax', 'businessChunksAttempted', 'closeReasons', 'closed', 'controlChunksAttempted', 'durationMaxMs', 'durationTotalMs', 'heartbeatChunksAttempted', 'opened', 'sseApplicationBytesAttempted', 'synchronousWriteFailures', 'writeBackpressureSignals'].sort())
assert.deepEqual(Object.keys(parsed[0].sse.closeReasons).sort(), ['client_close', 'server_shutdown', 'unknown', 'write_failure'])
const analyzed = analyzeEgressBaselineText(records.join(''))
assert.equal(analyzed.completeWindows, 1)
assert.equal(analyzed.httpEntries.length, 8)
const nullHealth = JSON.parse(records[0]!)
nullHealth.processHealth = null
assert.equal(analyzeEgressBaselineText(`${JSON.stringify(nullHealth)}\n`).rejectedRecords, 1, 'exact V2 schema rejects nullable processHealth object')
const streamingPath = join(tmpdir(), `egress-baseline-${process.pid}.ndjson`)
writeFileSync(streamingPath, records.join(''), 'utf8')
const streamed = await analyzeEgressBaselineFile(streamingPath)
unlinkSync(streamingPath)
assert.equal(streamed.completeWindows, 1)
assert.equal(streamed.httpEntries.length, 8)
const privateNested = JSON.parse(records[0]!)
privateNested.httpEntries[0].diagnostic = { email: 'private@example.com' }
assert.equal(analyzeEgressBaselineText(`${JSON.stringify(privateNested)}\n`).rejectedRecords, 1)
for (const extra of ['BusinessId', 'providerPayload', 'mediaPath', 'rawPath', 'arbitraryExtra']) {
  const unsafe = JSON.parse(records[0]!)
  unsafe.sse[extra] = 'must-not-survive'
  assert.equal(analyzeEgressBaselineText(`${JSON.stringify(unsafe)}\n`).rejectedRecords, 1, `nested extra ${extra} must be rejected by positive allowlist`)
}
if (records.length > 1) {
  const mismatched = records.map((record) => JSON.parse(record))
  mismatched[1].deploymentId = 'different'
  assert.equal(analyzeEgressBaselineText(mismatched.map((record) => JSON.stringify(record)).join('\n')).incompleteWindows, 1)
  const duplicated = [records[0], records[0]].join('')
  assert.equal(analyzeEgressBaselineText(duplicated).duplicateWindows, 1)
  const duplicateKey = records.map((record) => JSON.parse(record))
  duplicateKey[1].httpEntries[0] = { ...duplicateKey[0].httpEntries[0] }
  assert.equal(analyzeEgressBaselineText(duplicateKey.map((record) => JSON.stringify(record)).join('\n')).completeWindows, 0, 'HTTP partition keys must be unique across chunks')
  const missingChunk = records.filter((_record, index) => index !== 1).join('')
  const missingAnalysis = analyzeEgressBaselineText(missingChunk)
  assert.equal(missingAnalysis.completeWindows, 0)
  assert.equal(missingAnalysis.incompleteWindows, 1)
  assert.equal(missingAnalysis.httpEntries.length, 0, 'missing chunk indexes prevent canonical aggregation of the whole window')
}

const splitAcceptedWritable = new ScriptedWritable([true, false, true])
const splitAccepted = await createInstalledOutputFixture(splitAcceptedWritable)
await recordSplitTraffic(splitAccepted.app)
splitAccepted.scheduler.fire()
const acceptedSplitRecords = splitAcceptedWritable.attempts.map((record) => JSON.parse(record))
assert.ok(acceptedSplitRecords.length >= 3, 'productive install emits a genuinely split snapshot')
assert.equal(new Set(splitAcceptedWritable.attempts).size, splitAcceptedWritable.attempts.length, 'every bounded chunk is attempted exactly once without retry')
assert.equal(analyzeEgressBaselineText(splitAcceptedWritable.attempts.join('')).completeWindows, 1, 'false is accepted and the complete productive snapshot remains analyzable')
assert.equal(acceptedSplitRecords.every((record) => record.outputBackpressureSignalsPendingBeforeFlush === 0), true, 'the backpressure raised by this batch remains pending for a later snapshot')
const attemptsAtPressure = splitAcceptedWritable.attempts.length
const pressureResponses = await Promise.all([splitAccepted.app.inject('/output-seed'), splitAccepted.app.inject('/output-seed')])
assert.equal(pressureResponses.every((response) => response.statusCode === 200), true, 'productive requests complete while output remains pressured')
splitAccepted.scheduler.fire()
assert.equal(splitAcceptedWritable.attempts.length, attemptsAtPressure, 'a future snapshot is dropped under pressure without write, retry or queue')
splitAcceptedWritable.emit('drain')
await splitAccepted.app.inject('/output-seed')
splitAccepted.scheduler.fire()
assert.equal(splitAcceptedWritable.attempts.length, attemptsAtPressure + 1, 'one later productive snapshot is attempted after drain')
await splitAccepted.app.close()

const partialDiagnostic = new FakeWritable()
const partialWritable = new ScriptedWritable([false, true, 'throw'])
const partialFixture = await createInstalledOutputFixture(partialWritable, partialDiagnostic)
await partialFixture.app.inject('/output-seed')
partialFixture.scheduler.fire()
await partialFixture.app.inject('/output-seed')
partialFixture.scheduler.fire()
assert.equal(partialWritable.attempts.length, 1, 'pressure creates the prior dropped snapshot without retrying its accepted record')
partialWritable.emit('drain')
await recordSplitTraffic(partialFixture.app)
partialFixture.scheduler.fire()
const partialAttemptCount = partialWritable.attempts.length
assert.equal(partialAttemptCount, 3, 'productive split attempts its accepted prefix and the later synchronous failing record exactly once')
assert.equal(partialFixture.scheduler.callback, null, 'synchronous failure makes output terminal and prevents implicit retry')
const partialSummary = partialDiagnostic.chunks.map((chunk) => JSON.parse(chunk)).find((record) => record.reason === 'sink_failure')
assert.ok(partialSummary, 'productive terminal path emits a bounded sink-failure diagnostic on the separate diagnostic sink')
assert.equal(partialSummary.droppedSnapshotsPending, 2, 'one prior pressure drop is preserved and the current partial snapshot increments the cumulative drop exactly once')
assert.equal(partialSummary.outputRecordsAttemptedPending, 3, 'attempted records include the accepted prefix and later synchronous failed write')
assert.equal(partialWritable.attempts.length, partialAttemptCount, 'terminal output never retries any partial record')
await partialFixture.app.close()

const laterCompleteWritable = new ScriptedWritable([false])
const laterCompleteFixture = await createInstalledOutputFixture(laterCompleteWritable)
await laterCompleteFixture.app.inject('/output-seed')
laterCompleteFixture.scheduler.fire()
await laterCompleteFixture.app.inject('/output-seed')
laterCompleteFixture.scheduler.fire()
laterCompleteWritable.emit('drain')
await recordSplitTraffic(laterCompleteFixture.app)
const beforeLaterComplete = laterCompleteWritable.attempts.length
laterCompleteFixture.scheduler.fire()
const laterCompleteRecords = laterCompleteWritable.attempts.slice(beforeLaterComplete).map((record) => JSON.parse(record))
assert.ok(laterCompleteRecords.length > 1, 'later productive snapshot is split and fully accepted')
assert.equal(laterCompleteRecords.every((record) => record.droppedSnapshotsPendingBeforeFlush === 1), true, 'every chunk repeats the captured cumulative incomplete count')
assert.equal(laterCompleteRecords.every((record) => record.outputRecordsAttemptedPendingBeforeFlush === 1), true, 'every chunk repeats the same captured prior output attempt')
assert.equal(laterCompleteRecords.every((record) => record.outputBackpressureSignalsPendingBeforeFlush === 1), true, 'every chunk repeats the same captured prior backpressure')
assert.equal(new Set(laterCompleteRecords.map((record) => record.windowId)).size, 1, 'all chunks repeat one common productive window identity')
assert.equal(laterCompleteRecords.every((record) => record.chunkCount === laterCompleteRecords.length), true)
await laterCompleteFixture.app.inject('/output-seed')
const beforePendingProof = laterCompleteWritable.attempts.length
laterCompleteFixture.scheduler.fire()
const pendingProof = JSON.parse(laterCompleteWritable.attempts[beforePendingProof]!)
assert.equal(pendingProof.droppedSnapshotsPendingBeforeFlush, 0, 'full acceptance consumes only the captured cumulative drops')
assert.equal(pendingProof.outputRecordsAttemptedPendingBeforeFlush, laterCompleteRecords.length, 'attempts made while emitting the complete batch remain pending for the next window')
await laterCompleteFixture.app.close()

const foldingController = new EgressBaselineController({ processStartId: 'fold', utcNow: () => new Date(wall++ * 1000), maxHttpKeys: 20 })
for (let index = 0; index < 6; index++) foldingController.recordHttp({ key: `very-long-${index}-${'z'.repeat(500)}`, durationMs: index + 2, bytes: 20 + index, hadError: index % 2 === 0 })
const foldedRecords: string[] = []
const foldedResult = encodeSnapshot(foldingController.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 1550, maxRecords: 1, maxFlushBytes: 1550 }, (record) => foldedRecords.push(record))
assert.equal(foldedResult.ok, true)
const foldedRecord = JSON.parse(foldedRecords[0]!)
const preservedCount = foldedRecord.httpEntries.reduce((sum: number, entry: { requestCount: number }) => sum + entry.requestCount, 0) + (foldedRecord.foldedHttpEntry?.requestCount ?? 0)
assert.equal(preservedCount, 6)
assert.equal(foldedRecord.foldedEntryCount > 0, true)
assert.equal(foldedRecord.indivisibleOversizedEntryCount > 0, true)
assert.equal(Buffer.byteLength(foldedRecords[0]!) <= 1550, true)

const deterministicA = new EgressBaselineController({ processStartId: 'det', utcNow: () => new Date(1000), maxHttpKeys: 10 })
const deterministicB = new EgressBaselineController({ processStartId: 'det', utcNow: () => new Date(1000), maxHttpKeys: 10 })
for (const key of ['b', 'a']) deterministicA.recordHttp({ key, durationMs: 1, bytes: 1, hadError: false })
for (const key of ['a', 'b']) deterministicB.recordHttp({ key, durationMs: 1, bytes: 1, hadError: false })
const outA: string[] = []; const outB: string[] = []
const originalLocaleCompare = String.prototype.localeCompare
String.prototype.localeCompare = () => { throw new Error('locale-dependent comparator used') }
try {
  encodeSnapshot(deterministicA.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 4096, maxRecords: 4, maxFlushBytes: 16384 }, (value) => outA.push(value))
  encodeSnapshot(deterministicB.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 4096, maxRecords: 4, maxFlushBytes: 16384 }, (value) => outB.push(value))
} finally {
  String.prototype.localeCompare = originalLocaleCompare
}
assert.deepEqual(JSON.parse(outA[0]!).httpEntries.map((entry: { key: string }) => entry.key), ['a', 'b'])
assert.deepEqual(JSON.parse(outB[0]!).httpEntries.map((entry: { key: string }) => entry.key), ['a', 'b'])

const boundaryController = new EgressBaselineController({ processStartId: 'boundary', utcNow: () => new Date(1000), maxHttpKeys: 4 })
boundaryController.recordHttp({ key: `entry-${'e'.repeat(420)}`, durationMs: 1, bytes: 1, hadError: false })
const boundarySnapshot = boundaryController.detach()
const boundaryFold = { key: '__folded__', requestCount: 1, measuredPayloadCount: 1, unknownPayloadCount: 0, responseBytesTotal: 1, responseBytesMax: 1, durationTotalMs: 1, durationMaxMs: 1, errorCount: 0 }
const boundaryRecords: string[] = []
const boundaryResult = encodeSnapshot({ ...boundarySnapshot, foldedHttpEntry: boundaryFold }, { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 2000, maxRecords: 4, maxFlushBytes: 8000 }, (value) => boundaryRecords.push(value))
assert.equal(boundaryResult.ok, true)
assert.equal(boundaryResult.indivisibleOversizedEntryCount, 0, 'entry fitting an isolated chunk is not indivisible merely because chunk zero also owns fold')

const fractionalController = new EgressBaselineController({ processStartId: 'fractional', utcNow: () => new Date(1000), maxHttpKeys: 4 })
fractionalController.recordHttp({ key: '["GET","/crm","2xx","crm",false,"serialized_string"]', durationMs: 1.25, bytes: 2, hadError: false })
const fractionalRecords: string[] = []
encodeSnapshot(fractionalController.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 4096, maxRecords: 4, maxFlushBytes: 16_384 }, (value) => fractionalRecords.push(value))
assert.equal(analyzeEgressBaselineText(fractionalRecords.join('')).completeWindows, 1, 'fractional production monotonic durations remain valid')
const fractionalSseController = new EgressBaselineController({ processStartId: 'fractional-sse', utcNow: () => new Date(1000), maxHttpKeys: 4 })
fractionalSseController.openSse()
fractionalSseController.closeSse(1.25, 'client_close')
const fractionalSseRecords: string[] = []
encodeSnapshot(fractionalSseController.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 4096, maxRecords: 4, maxFlushBytes: 16_384 }, (value) => fractionalSseRecords.push(value))
assert.equal(analyzeEgressBaselineText(fractionalSseRecords.join('')).completeWindows, 1, 'fractional SSE monotonic durations remain valid')
const fractionalCounterBase = fractionalSseController.detach()
const fractionalCounterSnapshot = { ...fractionalCounterBase, sse: { ...fractionalCounterBase.sse, opened: 1.5, durationTotalMs: 2.5 } }
const fractionalCounterRecords: string[] = []
encodeSnapshot(fractionalCounterSnapshot, { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 4096, maxRecords: 4, maxFlushBytes: 16_384 }, (value) => fractionalCounterRecords.push(value))
const safeFractionalCounter = JSON.parse(fractionalCounterRecords[0]!).sse
assert.equal(safeFractionalCounter.opened, Number.MAX_SAFE_INTEGER, 'fractional counters are converted to a bounded safe integer')
assert.equal(safeFractionalCounter.durationTotalMs, 2.5, 'fractional durations remain lossless')
for (const mutate of [
  (record: any) => { record.httpEntries[0].key = '/raw/private?token=secret' },
  (record: any) => { record.processHealth = { samplingStatus: 'unavailable', eventLoopDelayP95Ms: -1, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null } },
  (record: any) => { record.processHealth = { samplingStatus: 'ok', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: 1, heapUsedBytes: 1, heapTotalBytes: 1 } },
  (record: any) => { record.windowStartUtc = '2026-08-23 10:00:00' },
  (record: any) => { record.windowDurationMs += 1 },
  (record: any) => { record.chunkCount = 65 },
  (record: any) => { record.foldedEntryCount = 1; record.foldedHttpEntry = null }
]) {
  const invalid = JSON.parse(fractionalRecords[0]!)
  mutate(invalid)
  const invalidResult = analyzeEgressBaselineText(`${JSON.stringify(invalid)}\n`)
  assert.equal(invalidResult.completeWindows, 0)
}

const adversarialPath = join(tmpdir(), `egress-baseline-adversarial-${process.pid}.ndjson`)
const incompleteLines: string[] = []
for (let index = 0; index < 513; index++) {
  const incomplete = JSON.parse(fractionalRecords[0]!)
  incomplete.processStartId = `process-${index}`
  incomplete.windowId = `process-${index}:0`
  incomplete.windowSequence = 0
  incomplete.chunkCount = 2
  incomplete.chunkIndex = 0
  incompleteLines.push(JSON.stringify(incomplete))
}
incompleteLines.push('x'.repeat(32_769))
writeFileSync(adversarialPath, incompleteLines.join('\n'), 'utf8')
const adversarial = await analyzeEgressBaselineFile(adversarialPath)
unlinkSync(adversarialPath)
assert.equal(adversarial.admissionRejectedWindows >= 1, true, 'active-window admission is globally bounded')
assert.equal(adversarial.httpEntries.length <= 512, true, 'result HTTP aggregation is bounded')
assert.equal(adversarial.rejectedRecords >= 2, true, 'over-cap active identity and over-cap line are rejected')
assert.deepEqual(adversarial.layers.databaseProviderEgressDelta, { status: 'unavailable', value: null })
let maxFramerRetained = 0
let oversizedFramerLines = 0
async function* adversarialChunks() {
  yield Buffer.alloc(100_000, 0x78)
  yield Buffer.from('\n{"safe":true}\n')
}
const framed: string[] = []
for await (const line of iterateBoundedLines(adversarialChunks(), 32_768, (bytes) => { maxFramerRetained = Math.max(maxFramerRetained, bytes) }, () => { oversizedFramerLines++ })) framed.push(line)
assert.deepEqual(framed, ['{"safe":true}'])
assert.equal(oversizedFramerLines, 1)
assert.equal(maxFramerRetained <= 32_768, true, 'framer never retains an oversized line while discarding to newline')

function encodeDigitBoundary(entryCount: number) {
  const digitController = new EgressBaselineController({ processStartId: `digits-${entryCount}`, utcNow: () => new Date(1000), maxHttpKeys: 128 })
  for (let index = 0; index < entryCount; index++) digitController.recordHttp({ key: JSON.stringify(['GET', `/crm/${String(index).padStart(3, '0')}-${'x'.repeat(150)}`, '2xx', 'crm', false, 'serialized_string']), durationMs: 1, bytes: 1, hadError: false })
  const values: string[] = []
  const result = encodeSnapshot(digitController.detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 1400, maxRecords: 64, maxFlushBytes: 89_600 }, (value) => values.push(value))
  return { result, values }
}
const digitNine = encodeDigitBoundary(8)
const digitTen = encodeDigitBoundary(9)
const digitSixtyFour = encodeDigitBoundary(63)
assert.equal(digitNine.result.ok && digitNine.result.recordCount, 9)
assert.equal(digitTen.result.ok && digitTen.result.recordCount, 10)
assert.equal(digitSixtyFour.result.ok && digitSixtyFour.result.recordCount, 64)
assert.equal(digitSixtyFour.result.ok && digitSixtyFour.result.indivisibleOversizedEntryCount, 0)
assert.equal(digitSixtyFour.values.every((value) => Buffer.byteLength(value) <= 1400), true)
let partialConsumption = 0
const impossible = encodeSnapshot(new EgressBaselineController({ processStartId: 'no-partial', utcNow: () => new Date(1000), maxHttpKeys: 2 }).detach(), { replicaId: 'r', deploymentId: 'd' }, { maxRecordBytes: 100, maxRecords: 1, maxFlushBytes: 100 }, () => { partialConsumption++ })
assert.equal(impossible.ok, false)
assert.equal(partialConsumption, 0, 'bounds failure is fully preflighted before consume')

console.log('egress baseline output: ok')
