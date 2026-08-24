import assert from 'node:assert/strict'
import { EgressBaselineController, saturatingAdd } from '../src/observability/egress-baseline/controller.js'
import { createProductionProcessHealthSampler, sampleProcessHealth } from '../src/observability/egress-baseline/process-health.js'

let now = 10
const controller = new EgressBaselineController({ processStartId: 'p1', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2 })
controller.recordHttp({ key: 'a', durationMs: 4, bytes: 3, hadError: false })
controller.recordHttp({ key: 'a', durationMs: 6, bytes: 2, hadError: true })
controller.recordHttp({ key: 'b', durationMs: 1, bytes: 1, hadError: false })
controller.recordHttp({ key: 'c', durationMs: 2, bytes: 1, hadError: false })
const first = controller.detach()
assert.equal(first.processStartId, 'p1')
assert.equal(first.httpEntries.find((entry) => entry.key === 'a')?.requestCount, 2)
assert.equal(first.httpEntries.find((entry) => entry.key === 'a')?.durationMaxMs, 6)
assert.equal(first.httpEntries.find((entry) => entry.key === 'a')?.measuredPayloadCount, 2)
assert.equal(first.overflowRequestCount, 1)
assert.equal(first.overflowDistinctKeys, 1)
assert.equal(Object.isFrozen(first), true)
controller.recordHttp({ key: 'after-detach', durationMs: 3, bytes: 4, hadError: false })
const second = controller.detach()
assert.equal(first.httpEntries.some((entry) => entry.key === 'after-detach'), false, 'detached snapshot remains immutable and never receives later requests')
assert.equal(second.httpEntries.find((entry) => entry.key === 'after-detach')?.requestCount, 1, 'new window accepts immediately after detach')
assert.equal(first.processStartId, second.processStartId)
assert.notEqual(first.windowId, second.windowId)
assert.equal(second.windowSequence, first.windowSequence + 1)
const other = first.httpEntries.find((entry) => entry.key === '__other__')
assert.equal(other?.requestCount, 1)
assert.equal(other?.measuredPayloadCount, 1)
assert.equal(other?.responseBytesTotal, 1)
assert.equal(other?.durationTotalMs, 2)
assert.equal(first.httpEntries.reduce((sum, entry) => sum + entry.requestCount, 0), 4)
assert.equal(first.httpEntries.reduce((sum, entry) => sum + entry.responseBytesTotal, 0), 7)
assert.equal(Object.isFrozen(first), true)
assert.notEqual(controller.detach().windowId, first.windowId)

const saturation = { value: false }
assert.equal(saturatingAdd(Number.MAX_SAFE_INTEGER, 1, saturation), Number.MAX_SAFE_INTEGER)
assert.equal(saturation.value, true)

let resetCount = 0
const health = sampleProcessHealth({ count: 2, percentile: () => 2_000_000, max: 4_000_000, reset: () => { resetCount++ } }, () => ({ heapUsed: 10, heapTotal: 20 }))
assert.deepEqual(health, { samplingStatus: 'ok', eventLoopDelayP95Ms: 2, eventLoopDelayMaxMs: 4, heapUsedBytes: 10, heapTotalBytes: 20, saturated: false })
assert.equal(resetCount, 1)
const empty = sampleProcessHealth({ count: 0, percentile: () => 1, max: 1, reset: () => { resetCount++ } }, () => ({ heapUsed: 10, heapTotal: 20 }))
assert.equal(empty.eventLoopDelayP95Ms, null)

const lifecycle = new EgressBaselineController({ processStartId: 'p2', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 4 })
assert.equal(lifecycle.openSse(), true)
lifecycle.attemptSse('control', 'retry: 5000\n\n', false)
lifecycle.noteOutputAttempt(100)
lifecycle.noteOutputBackpressure()
const active = lifecycle.detach()
assert.equal(active.sse.activeLocalCurrent, 1)
assert.equal(active.sse.activeLocalMax, 1)
assert.equal(active.sse.writeBackpressureSignals, 1)
assert.equal(active.pendingBeforeFlush.bytes, 100)
lifecycle.noteOutputAttempt(20)
lifecycle.noteSnapshotComplete(active.pendingBeforeFlush)
const inherited = lifecycle.detach()
assert.equal(inherited.sse.activeLocalCurrent, 1)
assert.equal(inherited.sse.activeLocalMax, 1)
assert.equal(inherited.pendingBeforeFlush.bytes, 20)
lifecycle.closeSse(12, 'client_close')
const closed = lifecycle.detach()
assert.equal(closed.sse.closed, 1)
assert.equal(closed.sse.durationTotalMs, 12)
assert.equal(closed.sse.closeReasons.client_close, 1)
assert.equal(closed.sse.activeLocalCurrent, 0)
assert.equal(closed.sse.activeLocalMax, 1, 'inherited active connection establishes the next window maximum')
assert.equal(closed.sse.closed, 1)
assert.equal(closed.sse.durationTotalMs, 12)

const emptyBoundary = new EgressBaselineController({ processStartId: 'empty-sse', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2 })
for (const emptyWindow of [emptyBoundary.detach(), emptyBoundary.detach()]) {
  assert.equal(emptyWindow.sse.activeLocalCurrent, 0)
  assert.equal(emptyWindow.sse.activeLocalMax, 0)
}
const twoOpenController = new EgressBaselineController({ processStartId: 'two-open', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2 })
twoOpenController.openSse()
twoOpenController.openSse()
twoOpenController.closeSse(7, 'client_close')
const twoOpen = twoOpenController.detach()
assert.equal(twoOpen.sse.opened, 2)
assert.equal(twoOpen.sse.closed, 1)
assert.equal(twoOpen.sse.activeLocalCurrent, 1)
assert.equal(twoOpen.sse.activeLocalMax, 2)

const saturatedController = new EgressBaselineController({
  processStartId: 'saturated',
  utcNow: () => new Date(now++ * 1000),
  maxHttpKeys: 2,
  processHealth: { sample: () => ({ samplingStatus: 'ok', eventLoopDelayP95Ms: Number.MAX_SAFE_INTEGER, eventLoopDelayMaxMs: Number.MAX_SAFE_INTEGER, heapUsedBytes: Number.MAX_SAFE_INTEGER, heapTotalBytes: Number.MAX_SAFE_INTEGER, saturated: true }), disable: () => {} }
})
saturatedController.recordHttp({ key: 'http', durationMs: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER, hadError: true })
saturatedController.recordHttp({ key: 'http', durationMs: 1, bytes: 1, hadError: true })
saturatedController.openSse()
saturatedController.closeSse(Number.MAX_SAFE_INTEGER, 'unknown')
saturatedController.openSse()
saturatedController.closeSse(1, 'unknown')
saturatedController.noteOutputAttempt(Number.MAX_SAFE_INTEGER)
saturatedController.noteOutputAttempt(1)
saturatedController.noteOutputBackpressure()
saturatedController.noteOutputBackpressure()
assert.deepEqual(saturatedController.detach().counterSaturation, { http: true, sse: true, output: true, processHealth: true })

const terminalController = new EgressBaselineController({ processStartId: 'terminal', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2 })
terminalController.recordHttp({ key: 'private-active-state', durationMs: 1, bytes: 1, hadError: false })
terminalController.openSse()
terminalController.noteOutputAttempt(25)
terminalController.noteSnapshotDropped('pressure')
terminalController.noteSnapshotDropped('sink_failure')
terminalController.disableOutputTerminal()
assert.deepEqual(terminalController.getIncompleteState(), { pending: { droppedSnapshots: 2, bytes: 25, records: 1, backpressureSignals: 0 }, reasons: { sink_failure: 1, shutdown_budget: 0, pressure: 1, encoder_failure: 0 } })
const released = terminalController.detach()
assert.equal(released.httpEntries.length, 0)
assert.equal(released.sse.opened, 0)
assert.equal(released.sse.activeLocalCurrent, 0)
assert.deepEqual(released.pendingBeforeFlush, { droppedSnapshots: 0, bytes: 0, records: 0, backpressureSignals: 0 })

let throwingDisableCalls = 0
const throwingHealthController = new EgressBaselineController({
  processStartId: 'throwing-health', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2,
  processHealth: { sample: () => { throw new Error('sample') }, disable: () => { throwingDisableCalls++; throw new Error('disable') } }
})
assert.doesNotThrow(() => assert.equal(throwingHealthController.detach().processHealth.samplingStatus, 'unavailable'))
assert.doesNotThrow(() => throwingHealthController.disableOutputTerminal())
assert.doesNotThrow(() => throwingHealthController.close())
assert.equal(throwingDisableCalls, 1, 'throwing health disable remains idempotent')

const malformedHealthController = new EgressBaselineController({
  processStartId: 'malformed-health', utcNow: () => new Date(now++ * 1000), maxHttpKeys: 2,
  processHealth: { sample: () => ({ samplingStatus: 'ok', eventLoopDelayP95Ms: Number.NaN } as never), disable: () => {} }
})
assert.deepEqual(malformedHealthController.detach().processHealth, { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null, saturated: false }, 'malformed dependency samples fail open to the fixed unavailable object')

const factoryFailure = createProductionProcessHealthSampler(() => { throw new Error('factory') })
assert.equal(factoryFailure.sample().samplingStatus, 'unavailable')
assert.doesNotThrow(() => factoryFailure.disable())
const enableFailure = createProductionProcessHealthSampler(() => ({ count: 0, percentile: () => 0, max: 0, reset() {}, enable() { throw new Error('enable') }, disable() {} } as never))
assert.equal(enableFailure.sample().samplingStatus, 'unavailable')
let partialActive = false
let partialDisableCalls = 0
let partialResetCalls = 0
const partialEnableFailure = createProductionProcessHealthSampler(() => ({
  count: 0, percentile: () => 0, max: 0,
  enable() { partialActive = true; throw new Error('partial enable') },
  disable() { partialDisableCalls++; partialActive = false },
  reset() { partialResetCalls++ }
} as never))
assert.equal(partialEnableFailure.sample().samplingStatus, 'unavailable')
assert.equal(partialActive, false, 'a partially enabled histogram is cleaned before returning unavailable')
assert.equal(partialDisableCalls, 1)
assert.equal(partialResetCalls, 1)

console.log('egress baseline recorder: ok')
