import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import Fastify from 'fastify'
import { Readable } from 'node:stream'
import { installEgressBaseline } from '../src/observability/egress-baseline/install.js'
import { resolveEgressBaselineConfig } from '../src/config/egress-baseline.js'

class CaptureWritable extends EventEmitter {
  chunks: string[] = []
  write(chunk: string, callback?: (error?: Error | null) => void) { this.chunks.push(chunk); callback?.(null); return true }
}

const writable = new CaptureWritable()
let healthSamples = 0
let healthDisabled = 0
const health = { sample: () => { healthSamples++; return { samplingStatus: 'ok' as const, eventLoopDelayP95Ms: 1, eventLoopDelayMaxMs: 2, heapUsedBytes: 3, heapTotalBytes: 4, saturated: false } }, disable: () => { healthDisabled++ } }
const app = Fastify()
installEgressBaseline(app, resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_WINDOW_MS: '10000',
  EGRESS_BASELINE_JITTER_MS: '0'
}), { writable, diagnosticWritable: writable, processHealth: health })
await app.register(async (child) => {
  child.get('/alpha', async () => ({ ok: true }))
  child.head('/head', async () => 'hidden')
  child.get('/empty', async (_request, reply) => reply.status(204).send())
  child.get('/not-modified', async (_request, reply) => reply.status(304).send())
  child.get('/failure', async () => { throw new Error('private-error-secret') })
  child.route({ method: 'TRACE' as never, url: '/other-method', handler: async () => 'other' })
  child.get('/stream', async (_request, reply) => reply.send(Readable.from(['private-stream'])))
  child.get('/crm/events', async () => 'event')
})
const response = await app.inject({ method: 'GET', url: '/alpha' })
assert.equal(response.statusCode, 200)
assert.deepEqual(response.json(), { ok: true })
await app.inject({ method: 'GET', url: '/alpha?token=private-matched' })
await app.inject({ method: 'GET', url: '/crm/events' })
await app.inject({ method: 'HEAD', url: '/head' })
await app.inject({ method: 'GET', url: '/empty' })
await app.inject({ method: 'GET', url: '/not-modified' })
await app.inject({ method: 'GET', url: '/failure' })
await app.inject({ method: 'TRACE', url: '/other-method' })
const streamResponse = await app.inject({ method: 'GET', url: '/stream' })
assert.equal(streamResponse.body, 'private-stream')
assert.equal(streamResponse.body.indexOf('private-stream'), streamResponse.body.lastIndexOf('private-stream'), 'instrumentation does not duplicate or replace unsupported stream output')
await app.inject({ method: 'GET', url: '/secret-customer?token=private' })
await app.close()
const records = writable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))
assert.equal(records.length, 1)
assert.equal(records[0].httpEntries.reduce((sum: number, entry: { requestCount: number }) => sum + entry.requestCount, 0), 9)
assert.equal(JSON.stringify(records).includes('/alpha?'), false)
assert.equal(JSON.stringify(records).includes('token=private'), false)
assert.equal(records[0].metric, 'egress_baseline_process_window')
assert.equal('entries' in records[0], false)
assert.equal(records[0].httpEntries.some((entry: { key: string; unknownPayloadCount: number }) => entry.key.includes('/stream') && entry.unknownPayloadCount === 1), true)
assert.equal(records[0].httpEntries.some((entry: { key: string }) => entry.key.includes('__unmatched__')), true)
assert.equal(records[0].httpEntries.some((entry: { key: string; errorCount: number }) => entry.key.includes('/failure') && entry.errorCount === 1), true)
const alphaEntry = records[0].httpEntries.find((entry: { key: string }) => JSON.parse(entry.key)[1] === '/alpha')
const alphaBytes = Buffer.byteLength(JSON.stringify({ ok: true }))
assert.equal(JSON.parse(alphaEntry.key)[5], 'serialized_string')
assert.equal(alphaEntry.measuredPayloadCount, 2)
assert.equal(alphaEntry.responseBytesTotal, alphaBytes * 2)
assert.equal(alphaEntry.responseBytesMax, alphaBytes)
assert.equal(JSON.stringify(records).includes('token'), false)
assert.equal(JSON.stringify(records).includes('private-matched'), false)
assert.equal(records[0].httpEntries.some((entry: { key: string }) => JSON.parse(entry.key)[1] === '__unmatched__' && entry.key.includes('/alpha')), false)
assert.equal(JSON.stringify(records).includes('private-error-secret'), false)
assert.equal(JSON.stringify(records).includes('stack'), false)
assert.equal(writable.chunks.every((chunk) => !chunk.includes('private-error-secret')), true, 'no stdout record or side-channel output contains the raw route error')
assert.equal(writable.chunks.every((chunk) => !chunk.includes('stack')), true, 'no stdout record or side-channel output contains an Error stack')
assert.equal(writable.chunks.some((chunk) => chunk.includes('egress_baseline_output_incomplete')), false, 'the handled application error creates no telemetry-output diagnostic')
assert.equal(records[0].httpEntries.some((entry: { key: string; responseBytesTotal: number }) => entry.key.includes('/not-modified') && entry.responseBytesTotal === 0), true)
assert.equal(records[0].httpEntries.some((entry: { key: string }) => entry.key.startsWith('["OTHER"') && entry.key.includes('/other-method')), true)
assert.equal(records[0].processHealth.heapUsedBytes, 3)
assert.deepEqual(Object.keys(records[0].processHealth).sort(), ['eventLoopDelayMaxMs', 'eventLoopDelayP95Ms', 'heapTotalBytes', 'heapUsedBytes', 'samplingStatus'].sort())
assert.equal(healthSamples, 1)
assert.equal(healthDisabled, 1)

class ThrowingWritable extends EventEmitter {
  write(): boolean { throw new Error('telemetry failure') }
}
const failOpenApp = Fastify()
installEgressBaseline(failOpenApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true' }), { writable: new ThrowingWritable() as never })
failOpenApp.get('/ok', async (_request, reply) => reply.header('x-contract', 'kept').status(201).send('functional'))
const functional = await failOpenApp.inject({ method: 'GET', url: '/ok' })
assert.equal(functional.statusCode, 201)
assert.equal(functional.headers['x-contract'], 'kept')
assert.equal(functional.body, 'functional')
await failOpenApp.close()

class FakeTimer { unrefCalled = false; unref() { this.unrefCalled = true } }
class FakeScheduler {
  callback: (() => void) | null = null
  cleared = false
  timer = new FakeTimer()
  setTimeout(callback: () => void) { this.callback = callback; return this.timer }
  clearTimeout() { this.cleared = true; this.callback = null }
  setImmediate(callback: () => void) { const timer = new FakeTimer(); callback(); return timer }
}

const disabledContractWritable = new CaptureWritable()
const disabledContractScheduler = new FakeScheduler()
const disabledContractApp = Fastify()
installEgressBaseline(disabledContractApp, resolveEgressBaselineConfig({}), { writable: disabledContractWritable, scheduler: disabledContractScheduler })
disabledContractApp.get('/disabled-contract', async (_request, reply) => reply.header('x-contract', 'preserved').status(202).send('disabled-functional'))
const disabledContractResponse = await disabledContractApp.inject('/disabled-contract')
assert.equal(disabledContractResponse.statusCode, 202)
assert.equal(disabledContractResponse.headers['x-contract'], 'preserved')
assert.equal(disabledContractResponse.body, 'disabled-functional')
assert.equal(disabledContractWritable.chunks.length, 0)
assert.equal(disabledContractWritable.listenerCount('error'), 0)
assert.equal(disabledContractWritable.listenerCount('drain'), 0)
assert.equal(disabledContractScheduler.callback, null)
await disabledContractApp.close()

const minimumEnvelope = resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true',
  EGRESS_BASELINE_MAX_RECORD_BYTES: '4096', EGRESS_BASELINE_METADATA_MAX_CHARS: '128',
  RAILWAY_REPLICA_ID: 'r'.repeat(128), RAILWAY_DEPLOYMENT_ID: 'd'.repeat(128)
})
assert.equal(minimumEnvelope.sinkEffective, true, 'S43 reserved maximum envelope is reachable within the public minimum and passes startup preflight by design')
const outsideEnvelope = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_MAX_RECORD_BYTES: '4095' })
assert.equal(outsideEnvelope.sinkEffective, false)
assert.equal(outsideEnvelope.httpEffective, false)
assert.equal(outsideEnvelope.sseEffective, false)
const outsideEnvelopeApp = Fastify()
const outsideEnvelopeWritable = new CaptureWritable()
const outsideEnvelopeScheduler = new FakeScheduler()
assert.doesNotThrow(() => installEgressBaseline(outsideEnvelopeApp, outsideEnvelope, { writable: outsideEnvelopeWritable, scheduler: outsideEnvelopeScheduler }))
assert.equal(outsideEnvelopeWritable.listenerCount('error'), 0)
assert.equal(outsideEnvelopeScheduler.callback, null)
await outsideEnvelopeApp.close()
assert.equal(outsideEnvelopeWritable.chunks.length, 0)

const pressureScheduler = new FakeScheduler()
const pressureWritable = new CaptureWritable()
pressureWritable.write = function (chunk: string, callback?: (error?: Error | null) => void) { this.chunks.push(chunk); callback?.(null); return this.chunks.length !== 1 }
const pressureApp = Fastify()
installEgressBaseline(pressureApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }), { writable: pressureWritable, scheduler: pressureScheduler })
pressureApp.get('/pressure-functional', async () => 'pressure-functional')
await pressureApp.inject('/pressure-functional')
pressureScheduler.callback?.()
const writesAtPressure = pressureWritable.chunks.length
const pressureResponses = await Promise.all([pressureApp.inject('/pressure-functional'), pressureApp.inject('/pressure-functional')])
assert.equal(pressureResponses.every((item) => item.body === 'pressure-functional'), true, 'functional requests complete before drain')
pressureScheduler.callback?.()
assert.equal(pressureWritable.chunks.length, writesAtPressure, 'sustained pressure creates no new write, retry or record queue')
pressureWritable.emit('drain')
pressureScheduler.callback?.()
assert.equal(pressureWritable.chunks.length, writesAtPressure + 1, 'one later rotation resumes after drain')
await pressureApp.close()

const overlapScheduler = new FakeScheduler()
const overlapWritable = new CaptureWritable()
const overlapApp = Fastify()
installEgressBaseline(overlapApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }), { writable: overlapWritable, scheduler: overlapScheduler })
let overlapEntered!: () => void
let overlapRelease!: () => void
const overlapEntry = new Promise<void>((resolve) => { overlapEntered = resolve })
const overlapBarrier = new Promise<void>((resolve) => { overlapRelease = resolve })
overlapApp.get('/overlap-window', async () => { overlapEntered(); await overlapBarrier; return 'overlap-functional' })
const overlapRequest = overlapApp.inject('/overlap-window')
await overlapEntry
overlapScheduler.callback?.()
overlapRelease()
assert.equal((await overlapRequest).body, 'overlap-functional')
overlapScheduler.callback?.()
await overlapApp.close()
const overlapRecords = overlapWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))
const overlapEntries = overlapRecords.flatMap((record) => record.httpEntries).filter((entry: { key: string }) => JSON.parse(entry.key)[1] === '/overlap-window')
assert.equal(overlapEntries.reduce((sum: number, entry: { requestCount: number }) => sum + entry.requestCount, 0), 1)
assert.equal(overlapEntries.length, 1, 'overlapping request belongs to exactly one detached window')
const terminalScheduler = new FakeScheduler()
const terminalWritable = new CaptureWritable()
const terminalApp = Fastify()
installEgressBaseline(terminalApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true' }), { writable: terminalWritable, scheduler: terminalScheduler })
terminalApp.get('/still-functional', async () => 'ok')
assert.equal(terminalScheduler.timer.unrefCalled, true)
terminalWritable.emit('error', new Error('async terminal'))
assert.equal(terminalScheduler.cleared, true)
assert.equal((await terminalApp.inject('/still-functional')).body, 'ok')
await terminalApp.close()
assert.equal(terminalWritable.chunks.length, 0)

const invalidRandomApp = Fastify()
installEgressBaseline(invalidRandomApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true' }), { writable: new CaptureWritable(), randomSource: { nextUnit: () => Number.NaN } })
invalidRandomApp.get('/random-fail-open', async () => 'preserved')
assert.equal((await invalidRandomApp.inject('/random-fail-open')).body, 'preserved')
await invalidRandomApp.close()

class ScriptedWritable extends EventEmitter {
  calls = 0
  write(_chunk: string, callback?: (error?: Error | null) => void) {
    this.calls++
    if (this.calls === 2) throw new Error('second chunk sync failure')
    callback?.(null)
    return true
  }
}
const partialWritable = new ScriptedWritable()
const partialDiagnostic = new CaptureWritable()
const partialApp = Fastify()
installEgressBaseline(partialApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_MAX_HTTP_KEYS: '16', EGRESS_BASELINE_MAX_RECORD_BYTES: '4096' }), { writable: partialWritable, diagnosticWritable: partialDiagnostic })
for (let index = 0; index < 16; index++) partialApp.get(`/bounded-${index}-${'x'.repeat(120)}`, async () => ({ index }))
for (let index = 0; index < 16; index++) await partialApp.inject(`/bounded-${index}-${'x'.repeat(120)}`)
await partialApp.close()
assert.equal(partialWritable.calls, 2, 'accepted prefix then sync throw is attempted once without retry')
const partialSummary = JSON.parse(partialDiagnostic.chunks[0]!)
assert.equal(partialSummary.reason, 'sink_failure')
assert.equal(partialSummary.outputRecordsAttemptedPending, 2, 'failing write is still an output attempt')
assert.equal(partialSummary.droppedSnapshotsPending, 1)
assert.equal(partialSummary.reasonCount, 1)

let budgetNow = 0
const budgetWritable = new CaptureWritable()
const budgetDiagnostic = new CaptureWritable()
const budgetApp = Fastify()
installEgressBaseline(budgetApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SHUTDOWN_BUDGET_MS: '1' }), { writable: budgetWritable, diagnosticWritable: budgetDiagnostic, clock: { utcNow: () => new Date(), monotonicNow: () => (budgetNow += 2) } })
budgetApp.get('/budget', async () => 'functional')
await budgetApp.inject('/budget')
await budgetApp.close()
assert.equal(budgetWritable.chunks.length, 0, 'expired cooperative close budget performs no write')
assert.equal(JSON.parse(budgetDiagnostic.chunks[0]!).reason, 'shutdown_budget')

const abortWritable = new CaptureWritable()
const abortApp = Fastify()
installEgressBaseline(abortApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }), { writable: abortWritable })
let enterAbort!: () => void
let releaseAbort!: () => void
const abortEntered = new Promise<void>((resolve) => { enterAbort = resolve })
const abortReleased = new Promise<void>((resolve) => { releaseAbort = resolve })
abortApp.get('/abort-race', async () => { enterAbort(); await abortReleased; throw new Error('late error after abort') })
abortApp.get('/after-abort', async () => 'ok')
await abortApp.listen({ host: '127.0.0.1', port: 0 })
const abortAddress = abortApp.server.address()
const abortPort = typeof abortAddress === 'object' && abortAddress ? abortAddress.port : 0
const clientClosed = new Promise<void>((resolve) => {
  const request = http.get({ hostname: '127.0.0.1', port: abortPort, path: '/abort-race' })
  request.on('error', () => resolve())
  request.on('close', resolve)
  void abortEntered.then(() => request.destroy())
})
await abortEntered
await clientClosed
await new Promise<void>((resolve) => setImmediate(resolve))
releaseAbort()
await abortApp.inject('/after-abort')
await abortApp.close()
const abortRecord = abortWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))[0]
assert.equal(abortRecord.httpEntries.reduce((sum: number, entry: { requestCount: number }) => sum + entry.requestCount, 0), 1, 'aborted/error race contributes zero and later response contributes exactly once')
const abortEntries = abortRecord.httpEntries.map((entry: { key: string; requestCount: number; errorCount: number }) => ({ ...entry, tuple: JSON.parse(entry.key) }))
assert.equal(abortEntries.some((entry: any) => entry.tuple[1] === '/abort-race'), false, 'combined abort then handler error contributes no key')
assert.equal(abortEntries.find((entry: any) => entry.tuple[1] === '/after-abort')?.requestCount, 1, 'later successful request contributes once to its exact key')

const markerWritable = new CaptureWritable()
const markerApp = Fastify()
installEgressBaseline(markerApp, resolveEgressBaselineConfig({
  EGRESS_BASELINE_SINK_ENABLED: 'true',
  EGRESS_BASELINE_HTTP_ENABLED: 'true',
  EGRESS_BASELINE_POLLING_MARKER_ENABLED: 'true',
  EGRESS_BASELINE_JITTER_MS: '0'
}), { writable: markerWritable })
markerApp.get('/marker-contract', async () => ({ ok: true }))
await markerApp.inject({ url: '/marker-contract', headers: { 'x-crm-refresh-mode': 'fallback-poll' } })
await markerApp.inject({ url: '/marker-contract', headers: { 'x-crm-refresh-mode': 'fallback-poll-arbitrary' } })
await markerApp.inject('/marker-contract')
await markerApp.close()
const markerRecord = markerWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))[0]
const markerEntries = markerRecord.httpEntries
  .map((entry: { key: string; requestCount: number }) => ({ ...entry, tuple: JSON.parse(entry.key) }))
  .filter((entry: any) => entry.tuple[1] === '/marker-contract')
assert.equal(markerEntries.find((entry: any) => entry.tuple[4] === true)?.requestCount, 1, 'only exact literal fallback marker is causal')
assert.equal(markerEntries.find((entry: any) => entry.tuple[4] === false)?.requestCount, 2, 'arbitrary and absent marker values remain non-causal')
assert.equal(JSON.stringify(markerRecord).includes('fallback-poll-arbitrary'), false, 'raw marker values are never emitted')

console.log('egress baseline http: ok')
