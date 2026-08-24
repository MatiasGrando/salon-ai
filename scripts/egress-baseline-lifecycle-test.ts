import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import Fastify from 'fastify'
import { crmRoutes } from '../src/routes/crm.js'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { installEgressBaseline } from '../src/observability/egress-baseline/install.js'
import { resolveEgressBaselineConfig } from '../src/config/egress-baseline.js'
import { EgressBaselineController } from '../src/observability/egress-baseline/controller.js'
import { EffectiveSseRecorder } from '../src/observability/egress-baseline/sse-recorder.js'
import { DISABLED_SSE_RECORDER } from '../src/observability/egress-baseline/sse-recorder.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'
import { publishConversationUpdated } from '../src/services/crm-realtime-events.js'

class CaptureWritable extends EventEmitter {
  chunks: string[] = []
  write(chunk: string, callback?: (error?: Error | null) => void) { this.chunks.push(chunk); callback?.(null); return true }
}

const writable = new CaptureWritable()
const app = Fastify()
const baseline = installEgressBaseline(app, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true', EGRESS_BASELINE_WINDOW_MS: '10000', EGRESS_BASELINE_JITTER_MS: '0' }), { writable, diagnosticWritable: writable })
await app.register(crmRoutes, { sseRecorder: baseline.sseRecorder })
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address()
assert.equal(typeof address, 'object')
const port = typeof address === 'object' && address ? address.port : 0

let received = ''
const responseEnded = new Promise<void>((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port, path: '/crm/events?businessId=safe-test' }, (response) => {
    assert.equal(response.statusCode, 200)
    response.once('data', (chunk) => { received += String(chunk); void app.close().catch(reject) })
    response.once('end', resolve)
    response.once('error', reject)
  })
  request.on('error', reject)
})
await responseEnded
assert.equal(received, 'retry: 5000\n\n')
const records = writable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))
assert.equal(records.length, 1)
assert.equal(records[0].sse.opened, 1)
assert.equal(records[0].sse.closed, 1)
assert.equal(records[0].sse.controlChunksAttempted, 1)
assert.equal(records[0].sse.closeReasons.server_shutdown, 1)
assert.equal(records[0].httpEntries.length, 0)

const disabledWritable = new CaptureWritable()
const disabledApp = Fastify()
const disabledBaseline = installEgressBaseline(disabledApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'false' }), { writable: disabledWritable })
assert.equal(disabledBaseline.sseRecorder, DISABLED_SSE_RECORDER, 'SSE-ineffective install uses stateless disabled facade')
await disabledApp.register(crmRoutes, { sseRecorder: disabledBaseline.sseRecorder })
await disabledApp.listen({ host: '127.0.0.1', port: 0 })
const disabledAddress = disabledApp.server.address()
const disabledPort = typeof disabledAddress === 'object' && disabledAddress ? disabledAddress.port : 0
await new Promise<void>((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port: disabledPort, path: '/crm/events?businessId=disabled-test' }, (response) => {
    response.once('data', () => { void disabledApp.close().catch(reject) })
    response.once('end', resolve)
    response.once('error', reject)
  })
  request.on('error', reject)
})
const disabledRecords = disabledWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))
assert.equal(disabledRecords[0].sse.opened, 0, 'SSE-ineffective mode closes functional stream without telemetry state')

const allDisabledApp = Fastify()
const allDisabledWritable = new CaptureWritable()
const allDisabled = installEgressBaseline(allDisabledApp, resolveEgressBaselineConfig({}), { writable: allDisabledWritable })
assert.equal(allDisabled.sseRecorder, DISABLED_SSE_RECORDER)
assert.equal(allDisabledWritable.listenerCount('error'), 0)
assert.equal(allDisabledWritable.listenerCount('drain'), 0)
await allDisabledApp.register(crmRoutes, { sseRecorder: allDisabled.sseRecorder })
await allDisabledApp.listen({ host: '127.0.0.1', port: 0 })
const allDisabledAddress = allDisabledApp.server.address()
const allDisabledPort = typeof allDisabledAddress === 'object' && allDisabledAddress ? allDisabledAddress.port : 0
await new Promise<void>((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port: allDisabledPort, path: '/crm/events?businessId=all-disabled' }, (response) => {
    response.once('data', () => { void allDisabledApp.close().catch(reject) })
    response.once('end', resolve)
    response.once('error', reject)
  })
  request.on('error', reject)
})
assert.equal(allDisabledWritable.chunks.length, 0)

const sinkOnlyApp = Fastify()
const sinkOnlyWritable = new CaptureWritable()
const sinkOnlyBaseline = installEgressBaseline(sinkOnlyApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true' }), { writable: sinkOnlyWritable })
assert.equal(sinkOnlyBaseline.sseRecorder, DISABLED_SSE_RECORDER)
assert.equal(sinkOnlyWritable.listenerCount('error'), 0, 'sink-only does not install a terminal sink without an effective collector')
await sinkOnlyApp.close()
assert.equal(sinkOnlyWritable.chunks.length, 0)

const closingApp = Fastify()
const closingFacade = { isClosing: () => true, canOpenSse: () => false, openSse: () => ({ status: 'closing' as const }), beginClosingAndSnapshotFunctionalSse: () => [] }
await closingApp.register(crmRoutes, { sseRecorder: closingFacade })
const unavailable = await closingApp.inject({ method: 'GET', url: '/crm/events?businessId=safe-test' })
assert.equal(unavailable.statusCode, 503)
await closingApp.close()

async function captureEventsHandler(recorder: EffectiveSseRecorder) {
  let handler: ((request: any, reply: any) => Promise<unknown>) | null = null
  const fakeApp = new Proxy({}, { get: () => (path: string, candidate: typeof handler) => { if (path === '/crm/events') handler = candidate } })
  await crmRoutes(fakeApp as never, { sseRecorder: recorder })
  assert.ok(handler)
  return handler as unknown as (request: any, reply: any) => Promise<unknown>
}

let fakeWall = 0
const failureController = new EgressBaselineController({ processStartId: 'failure', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const failureRecorder = new EffectiveSseRecorder(failureController, () => fakeWall * 10)
const failureHandler = await captureEventsHandler(failureRecorder)
const requestRaw = new EventEmitter()
const throwingRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { throw new Error('raw write') }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
await failureHandler({ query: { businessId: 'safe' }, raw: requestRaw }, { raw: throwingRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
const failedSse = failureController.detach().sse
assert.equal(failedSse.opened, 1)
assert.equal(failedSse.controlChunksAttempted, 1, 'attempt is counted before raw write')
assert.equal(failedSse.synchronousWriteFailures, 1)
assert.equal(failedSse.closed, 1)

const headerController = new EgressBaselineController({ processStartId: 'header', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const headerRecorder = new EffectiveSseRecorder(headerController)
const headerHandler = await captureEventsHandler(headerRecorder)
const headerRaw = Object.assign(new EventEmitter(), { destroyed: false, writeHead() { throw new Error('headers') }, destroy() { this.destroyed = true } })
await headerHandler({ query: { businessId: 'safe' }, raw: new EventEmitter() }, { raw: headerRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
assert.equal(headerController.detach().sse.opened, 0, 'header failure occurs before authoritative open accounting')

const openThrowHandler = await captureEventsHandler({
  isClosing: () => false,
  canOpenSse: () => true,
  openSse: () => { throw new Error('authoritative open failed') },
  beginClosingAndSnapshotFunctionalSse: () => []
} as never)
const openThrowRaw = Object.assign(new EventEmitter(), { destroyed: false, writeHead() {}, destroy() { this.destroyed = true } })
await openThrowHandler({ query: { businessId: 'safe' }, raw: new EventEmitter() }, { raw: openThrowRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
assert.equal(openThrowRaw.destroyed, true, 'authoritative open failure is fail-open and releases the raw response')

const duplicateController = new EgressBaselineController({ processStartId: 'duplicates', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const duplicateHandler = await captureEventsHandler(new EffectiveSseRecorder(duplicateController, () => fakeWall * 10))
const duplicateRequestRaw = new EventEmitter()
const duplicateResponseRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { return true }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
await duplicateHandler({ query: { businessId: 'safe' }, raw: duplicateRequestRaw }, { raw: duplicateResponseRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
duplicateResponseRaw.emit('error', new Error('socket'))
duplicateResponseRaw.emit('close')
duplicateRequestRaw.emit('close')
const duplicateSse = duplicateController.detach().sse
assert.equal(duplicateSse.closed, 1, 'error/response-close/request-close race finalizes exactly once')
assert.equal(duplicateSse.closeReasons.write_failure, 1)

const backpressureController = new EgressBaselineController({ processStartId: 'retry-backpressure', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const effectiveBackpressureRecorder = new EffectiveSseRecorder(backpressureController, () => fakeWall * 10)
let finalizedMeasurement: ReturnType<EffectiveSseRecorder['openSse']> extends { measurement: infer T } ? T : never = null
const capturingBackpressureRecorder = {
  isClosing: () => effectiveBackpressureRecorder.isClosing(),
  canOpenSse: () => effectiveBackpressureRecorder.canOpenSse(),
  openSse: (response: any) => {
    const opened = effectiveBackpressureRecorder.openSse(response)
    if (opened.status === 'opened') finalizedMeasurement = opened.measurement
    return opened
  },
  beginClosingAndSnapshotFunctionalSse: () => effectiveBackpressureRecorder.beginClosingAndSnapshotFunctionalSse()
}
const backpressureHandler = await captureEventsHandler(capturingBackpressureRecorder as never)
const backpressureRequestRaw = new EventEmitter()
const backpressureRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { return false }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
await backpressureHandler({ query: { businessId: 'backpressure-safe' }, raw: backpressureRequestRaw }, { raw: backpressureRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
backpressureRequestRaw.emit('close')
finalizedMeasurement?.control('late-control', true)
finalizedMeasurement?.heartbeat('late-heartbeat', true)
finalizedMeasurement?.business('late-business', true)
const backpressureSse = backpressureController.detach().sse
assert.equal(backpressureSse.opened, 1)
assert.equal(backpressureSse.closed, 1)
assert.equal(backpressureSse.controlChunksAttempted, 1, 'real crmRoutes retry is the only control attempt')
assert.equal(backpressureSse.heartbeatChunksAttempted, 0, 'post-finalization heartbeat method is inert')
assert.equal(backpressureSse.businessChunksAttempted, 0, 'post-finalization business method is inert')
assert.equal(backpressureSse.writeBackpressureSignals, 1, 'retry write=false records one real backpressure signal')
assert.equal(backpressureSse.closeReasons.client_close, 1, 'finalization remains exactly once')

const postHeaderClosingHandler = await captureEventsHandler({
  isClosing: () => false,
  canOpenSse: () => true,
  openSse: () => ({ status: 'closing' as const }),
  beginClosingAndSnapshotFunctionalSse: () => []
} as never)
const postHeaderRaw = Object.assign(new EventEmitter(), { destroyed: false, writeHead() {}, end() { throw new Error('late end') }, destroy() { this.destroyed = true } })
await postHeaderClosingHandler({ query: { businessId: 'safe' }, raw: new EventEmitter() }, { raw: postHeaderRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
assert.equal(postHeaderRaw.destroyed, true, 'post-header closing end failure destroys without leaking hijacked response')

const businessController = new EgressBaselineController({ processStartId: 'business-write', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const businessRecorder = new EffectiveSseRecorder(businessController, () => fakeWall * 10)
const businessHandler = await captureEventsHandler(businessRecorder)
const businessRequestRaw = new EventEmitter()
let businessWrites = 0
const businessChunks: string[] = []
const businessRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write(chunk: string) { businessChunks.push(chunk); businessWrites++; if (businessWrites === 3) throw new Error('business write'); return businessWrites === 1 }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
await businessHandler({ query: { businessId: 'business-safe' }, raw: businessRequestRaw }, { raw: businessRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
const beforeBusiness = businessController.detach().sse
assert.equal(beforeBusiness.businessChunksAttempted, 0)
assert.equal(beforeBusiness.writeBackpressureSignals, 0)
assert.equal(beforeBusiness.synchronousWriteFailures, 0)
assert.equal(beforeBusiness.closed, 0)
assert.equal(businessChunks[0], 'retry: 5000\n\n')
const businessEvent = { businessId: 'business-safe', conversationId: 'safe', updatedAt: new Date(0).toISOString() }
const businessChunk = `event: conversation_updated\ndata: ${JSON.stringify({ type: 'conversation_updated', ...businessEvent })}\n\n`
publishConversationUpdated(businessEvent)
const businessSse = businessController.detach().sse
assert.equal(businessSse.businessChunksAttempted, 1)
assert.equal(businessChunks[1], businessChunk)
assert.equal(businessSse.sseApplicationBytesAttempted, Buffer.byteLength(businessChunk))
assert.equal(businessSse.writeBackpressureSignals, 1)
assert.equal(businessSse.synchronousWriteFailures, 0)
assert.equal(businessSse.closed, 0)
assert.equal(businessSse.activeLocalCurrent, 1)
publishConversationUpdated({ businessId: 'business-safe', conversationId: 'safe', updatedAt: new Date(1).toISOString() })
const laterBusinessFailureSse = businessController.detach().sse
assert.equal(laterBusinessFailureSse.businessChunksAttempted, 1)
assert.equal(laterBusinessFailureSse.synchronousWriteFailures, 1)
assert.equal(laterBusinessFailureSse.closed, 1)

const endFailureController = new EgressBaselineController({ processStartId: 'end-failure', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const endFailureRecorder = new EffectiveSseRecorder(endFailureController, () => fakeWall * 10)
const endFailureHandler = await captureEventsHandler(endFailureRecorder)
const endFailureRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { return true }, end() { throw new Error('shutdown end') }, destroy() { this.destroyed = true } })
await endFailureHandler({ query: { businessId: 'end-safe' }, raw: new EventEmitter() }, { raw: endFailureRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
assert.doesNotThrow(() => endFailureRecorder.beginClosingAndSnapshotFunctionalSse().forEach((session) => session.close('server_shutdown')))
assert.equal(endFailureController.detach().sse.closed, 1)

const heartbeatController = new EgressBaselineController({ processStartId: 'heartbeat-write', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const heartbeatHandler = await captureEventsHandler(new EffectiveSseRecorder(heartbeatController, () => fakeWall * 10))
let heartbeatCallback: (() => void) | null = null
const originalSetInterval = globalThis.setInterval
globalThis.setInterval = ((callback: () => void) => { heartbeatCallback = callback; return { unref() {} } }) as never
let heartbeatWrites = 0
const heartbeatChunks: string[] = []
const heartbeatRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write(chunk: string) { heartbeatChunks.push(chunk); heartbeatWrites++; return heartbeatWrites === 1 }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
try {
  await heartbeatHandler({ query: { businessId: 'heartbeat-safe' }, raw: new EventEmitter() }, { raw: heartbeatRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
  const beforeHeartbeat = heartbeatController.detach().sse
  assert.equal(beforeHeartbeat.heartbeatChunksAttempted, 0)
  assert.equal(beforeHeartbeat.writeBackpressureSignals, 0)
  assert.equal(beforeHeartbeat.synchronousWriteFailures, 0)
  assert.equal(beforeHeartbeat.closed, 0)
  assert.equal(heartbeatChunks[0], 'retry: 5000\n\n')
  assert.ok(heartbeatCallback)
  ;(heartbeatCallback as () => void)()
} finally {
  globalThis.setInterval = originalSetInterval
}
const heartbeatSse = heartbeatController.detach().sse
assert.equal(heartbeatSse.heartbeatChunksAttempted, 1)
assert.equal(heartbeatChunks[1], ': ping\n\n')
assert.equal(heartbeatSse.sseApplicationBytesAttempted, Buffer.byteLength(': ping\n\n'))
assert.equal(heartbeatSse.writeBackpressureSignals, 1)
assert.equal(heartbeatSse.synchronousWriteFailures, 0)
assert.equal(heartbeatSse.closed, 0)
assert.equal(heartbeatSse.activeLocalCurrent, 1)

const responseCloseController = new EgressBaselineController({ processStartId: 'response-close-only', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
let responseCloseMonotonic = 100
const responseCloseHandler = await captureEventsHandler(new EffectiveSseRecorder(responseCloseController, () => responseCloseMonotonic))
const responseCloseRequest = new EventEmitter()
const responseCloseRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { return true }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
await responseCloseHandler({ query: { businessId: 'response-close-safe' }, raw: responseCloseRequest }, { raw: responseCloseRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
responseCloseMonotonic = 137
responseCloseRaw.emit('close')
responseCloseRaw.emit('close')
responseCloseRequest.emit('close')
const responseCloseSse = responseCloseController.detach().sse
assert.equal(responseCloseSse.closed, 1)
assert.equal(responseCloseSse.activeLocalCurrent, 0)
assert.equal(responseCloseSse.durationTotalMs, 37)
assert.equal(responseCloseSse.durationMaxMs, 37)
assert.equal(responseCloseSse.closeReasons.client_close, 1)

const subscriptionController = new EgressBaselineController({ processStartId: 'subscription-failure', utcNow: () => new Date(fakeWall++ * 1000), maxHttpKeys: 2 })
const subscriptionHandler = await captureEventsHandler(new EffectiveSseRecorder(subscriptionController, () => fakeWall * 10))
const originalMapSet = Map.prototype.set
const subscriptionRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write() { return true }, end() { this.writableEnded = true }, destroy() { this.destroyed = true } })
Map.prototype.set = function (key: unknown, value: any) {
  if (value?.businessId === 'subscription-throw' && typeof value?.send === 'function') throw new Error('subscription setup')
  return originalMapSet.call(this, key, value)
}
try {
  await subscriptionHandler({ query: { businessId: 'subscription-throw' }, raw: new EventEmitter() }, { raw: subscriptionRaw, hijack() {}, status() { return this }, send(value: unknown) { return value } })
} finally {
  Map.prototype.set = originalMapSet
}
const subscriptionSse = subscriptionController.detach().sse
assert.equal(subscriptionSse.opened, 1)
assert.equal(subscriptionSse.closed, 1)
assert.equal(subscriptionSse.closeReasons.unknown, 1)
assert.equal(subscriptionRaw.destroyed, true)

const disconnectWritable = new CaptureWritable()
const disconnectApp = Fastify()
const disconnectBaseline = installEgressBaseline(disconnectApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }), { writable: disconnectWritable })
await disconnectApp.register(crmRoutes, { sseRecorder: disconnectBaseline.sseRecorder })
await disconnectApp.listen({ host: '127.0.0.1', port: 0 })
const disconnectAddress = disconnectApp.server.address()
const disconnectPort = typeof disconnectAddress === 'object' && disconnectAddress ? disconnectAddress.port : 0
await new Promise<void>((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port: disconnectPort, path: '/crm/events?businessId=disconnect-safe' }, (response) => {
    response.once('data', () => { response.destroy(); request.destroy() })
    response.once('close', resolve)
    response.once('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
  })
  request.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
})
for (let attempt = 0; attempt < 20 && (disconnectBaseline.sseRecorder as EffectiveSseRecorder).activeCount > 0; attempt++) await new Promise<void>((resolve) => setTimeout(resolve, 5))
assert.equal((disconnectBaseline.sseRecorder as EffectiveSseRecorder).activeCount, 0)
await disconnectApp.close()
const disconnectRecord = disconnectWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))[0]
assert.equal(disconnectRecord.sse.closeReasons.client_close, 1, 'real localhost disconnect finalizes client_close once')
assert.equal(disconnectRecord.httpEntries.length, 0, 'SSE-only does not install generic HTTP collection')

const raceWritable = new CaptureWritable()
const raceApp = Fastify()
let releasePreHandler!: () => void
let enteredPreHandler!: () => void
const entered = new Promise<void>((resolve) => { enteredPreHandler = resolve })
const release = new Promise<void>((resolve) => { releasePreHandler = resolve })
raceApp.addHook('preHandler', async (request) => { if (request.routeOptions.url === '/crm/events') { enteredPreHandler(); await release } })
const raceBaseline = installEgressBaseline(raceApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_SSE_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }), { writable: raceWritable })
await raceApp.register(crmRoutes, { sseRecorder: raceBaseline.sseRecorder })
await raceApp.listen({ host: '127.0.0.1', port: 0 })
const raceAddress = raceApp.server.address()
const racePort = typeof raceAddress === 'object' && raceAddress ? raceAddress.port : 0
const lateResponse = new Promise<number | undefined>((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port: racePort, path: '/crm/events?businessId=race-safe' }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)); response.once('error', reject) })
  request.on('error', reject)
})
await entered
const closingRace = raceApp.close()
for (let attempt = 0; attempt < 20 && !raceBaseline.sseRecorder.isClosing(); attempt++) await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(raceBaseline.sseRecorder.isClosing(), true, 'preClose marks the recorder before deferred handler resumes')
releasePreHandler()
assert.equal(await lateResponse, 503, 'deferred preHandler request observes preClose closing before hijack')
await closingRace
const raceRecords = raceWritable.chunks.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))
assert.equal(raceRecords[0].sse.opened, 0)

const isolatedConfig = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' })
const isolatedWritableA = new CaptureWritable()
const isolatedWritableB = new CaptureWritable()
const isolatedAppA = Fastify()
const isolatedAppB = Fastify()
installEgressBaseline(isolatedAppA, isolatedConfig, { writable: isolatedWritableA, uuid: () => 'isolated-a' })
installEgressBaseline(isolatedAppB, isolatedConfig, { writable: isolatedWritableB, uuid: () => 'isolated-b' })
isolatedAppA.get('/isolated-a', async () => 'a')
isolatedAppB.get('/isolated-b', async () => 'b')
await isolatedAppA.inject('/isolated-a')
await isolatedAppB.inject('/isolated-b')
await isolatedAppA.close()
await isolatedAppB.close()
const isolatedRecordA = JSON.parse(isolatedWritableA.chunks.find((chunk) => chunk.includes('egress_baseline_process_window'))!)
const isolatedRecordB = JSON.parse(isolatedWritableB.chunks.find((chunk) => chunk.includes('egress_baseline_process_window'))!)
assert.equal(isolatedRecordA.processStartId, 'isolated-a')
assert.equal(isolatedRecordB.processStartId, 'isolated-b')
assert.equal(JSON.stringify(isolatedRecordA).includes('/isolated-b'), false)
assert.equal(JSON.stringify(isolatedRecordB).includes('/isolated-a'), false)

const markerAppA = Fastify()
const markerAppB = Fastify()
await markerAppA.register(crmUiRoutes, { pollingMarker: { effective: true, headerName: 'X-CRM-Refresh-Mode', headerValue: 'fallback-poll' } })
await markerAppB.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const markerHtmlA = (await markerAppA.inject('/crm')).body
const markerHtmlB = (await markerAppB.inject('/crm')).body
assert.match(markerHtmlA, /name="crm-polling-marker"[^>]*data-effective="true"/)
assert.match(markerHtmlB, /name="crm-polling-marker"[^>]*data-effective="false"/)
assert.doesNotMatch(markerHtmlB, /data-effective="true"/)
await markerAppA.close()
await markerAppB.close()

class MatrixTimer { constructor(readonly id: number) {} unref() {} }
class MatrixScheduler {
  nextId = 1
  active = new Set<number>()
  scheduled = 0
  cleared = 0
  setTimeout(_callback: () => void) { const timer = new MatrixTimer(this.nextId++); this.active.add(timer.id); this.scheduled++; return timer }
  clearTimeout(timer: MatrixTimer) { if (this.active.delete(timer.id)) this.cleared++ }
  setImmediate(callback: () => void) { callback(); return new MatrixTimer(this.nextId++) }
}
const disabledMatrixScheduler = new MatrixScheduler()
const disabledMatrixApp = Fastify()
installEgressBaseline(disabledMatrixApp, resolveEgressBaselineConfig({}), { scheduler: disabledMatrixScheduler, writable: new CaptureWritable() })
await disabledMatrixApp.close()
assert.equal(disabledMatrixScheduler.scheduled, 0, 'all-disabled installs no timer')
assert.equal(disabledMatrixScheduler.active.size, 0)
const sinkMatrixScheduler = new MatrixScheduler()
const sinkMatrixApp = Fastify()
installEgressBaseline(sinkMatrixApp, resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true' }), { scheduler: sinkMatrixScheduler, writable: new CaptureWritable() })
await sinkMatrixApp.close()
assert.equal(sinkMatrixScheduler.scheduled, 0, 'sink-only installs no timer without collectors')
assert.equal(sinkMatrixScheduler.active.size, 0)

const effectiveMatrixScheduler = new MatrixScheduler()
const effectiveMatrixAppA = Fastify()
const effectiveMatrixAppB = Fastify()
const effectiveMatrixConfig = resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' })
installEgressBaseline(effectiveMatrixAppA, effectiveMatrixConfig, { scheduler: effectiveMatrixScheduler, writable: new CaptureWritable(), uuid: () => 'matrix-a' })
installEgressBaseline(effectiveMatrixAppB, effectiveMatrixConfig, { scheduler: effectiveMatrixScheduler, writable: new CaptureWritable(), uuid: () => 'matrix-b' })
assert.equal(effectiveMatrixScheduler.scheduled, 2, 'each effective app owns one timer')
assert.equal(effectiveMatrixScheduler.active.size, 2)
await effectiveMatrixAppA.close()
assert.equal(effectiveMatrixScheduler.active.size, 1, 'closing app A preserves app B timer')
await effectiveMatrixAppB.close()
assert.equal(effectiveMatrixScheduler.active.size, 0, 'closing app B releases the final owned timer')
assert.equal(effectiveMatrixScheduler.cleared, 2)

async function runDisabledCloseRace(config: ReturnType<typeof resolveEgressBaselineConfig>) {
  const raceOutput = new CaptureWritable()
  const disabledRaceApp = Fastify()
  let enter!: () => void
  let resume!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const resumed = new Promise<void>((resolve) => { resume = resolve })
  disabledRaceApp.addHook('preHandler', async (request) => { if (request.routeOptions.url === '/crm/events') { enter(); await resumed } })
  const disabledRaceBaseline = installEgressBaseline(disabledRaceApp, config, { writable: raceOutput })
  assert.equal(disabledRaceBaseline.sseRecorder, DISABLED_SSE_RECORDER)
  await disabledRaceApp.register(crmRoutes, { sseRecorder: disabledRaceBaseline.sseRecorder })
  await disabledRaceApp.listen({ host: '127.0.0.1', port: 0 })
  const address = disabledRaceApp.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const responseStatus = new Promise<number | undefined>((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/crm/events?businessId=disabled-race' }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)); response.once('error', reject) })
    request.on('error', reject)
  })
  await entered
  const closing = disabledRaceApp.close()
  for (let turn = 0; turn < 20; turn++) await new Promise<void>((resolve) => setImmediate(resolve))
  resume()
  assert.equal(await responseStatus, 503)
  await closing
  return raceOutput.chunks
}
const allDisabledRaceOutput = await runDisabledCloseRace(resolveEgressBaselineConfig({}))
assert.equal(allDisabledRaceOutput.length, 0)
const httpOnlyRaceOutput = await runDisabledCloseRace(resolveEgressBaselineConfig({ EGRESS_BASELINE_SINK_ENABLED: 'true', EGRESS_BASELINE_HTTP_ENABLED: 'true', EGRESS_BASELINE_JITTER_MS: '0' }))
const httpOnlyRaceRecord = httpOnlyRaceOutput.filter((chunk) => chunk.includes('egress_baseline_process_window')).map((chunk) => JSON.parse(chunk))[0]
assert.equal(httpOnlyRaceRecord.sse.opened, 0)

console.log('egress baseline lifecycle loopback: ok')
