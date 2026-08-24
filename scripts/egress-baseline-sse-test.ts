import assert from 'node:assert/strict'
import { EffectiveSseRecorder, DISABLED_SSE_RECORDER } from '../src/observability/egress-baseline/sse-recorder.js'
import { EgressBaselineController } from '../src/observability/egress-baseline/controller.js'

const response = {} as never
assert.equal(DISABLED_SSE_RECORDER.canOpenSse(), true)
assert.equal(DISABLED_SSE_RECORDER.openSse(response).status, 'opened')

const recorder = new EffectiveSseRecorder()
const opened = recorder.openSse(response)
assert.equal(opened.status, 'opened')
assert.equal(recorder.activeCount, 1)
assert.equal(recorder.beginClosingAndSnapshotFunctionalSse().length, 1)
assert.equal(recorder.canOpenSse(), false)
assert.equal(recorder.openSse(response).status, 'closing')
if (opened.status === 'opened') {
  opened.session.close('server_shutdown')
  opened.session.close('client_close')
}
assert.equal(recorder.beginClosingAndSnapshotFunctionalSse().length, 0)
assert.equal(recorder.activeCount, 0)

let wall = 0
let mono = 10
const controller = new EgressBaselineController({ processStartId: 'sse', utcNow: () => new Date(wall++ * 1000), maxHttpKeys: 2 })
const integrated = new EffectiveSseRecorder(controller, () => mono)
const tracked = integrated.openSse(response)
assert.equal(tracked.status, 'opened')
if (tracked.status === 'opened') {
  tracked.measurement?.control('retry\n\n', false)
  tracked.measurement?.business('data: ok\n\n', true)
  mono = 35
  tracked.session.close('client_close')
  tracked.session.close('write_failure')
}
const measured = controller.detach()
assert.equal(measured.sse.opened, 1)
assert.equal(measured.sse.closed, 1)
assert.equal(measured.sse.durationTotalMs, 25)
assert.equal(measured.sse.writeBackpressureSignals, 1)
assert.equal(measured.sse.closeReasons.client_close, 1)

const terminalTracked = integrated.openSse(response)
integrated.disableMeasurement()
assert.equal(integrated.activeCount, 1, 'terminal telemetry keeps functional sessions')
if (terminalTracked.status === 'opened') terminalTracked.session.close('client_close')
assert.equal(controller.detach().sse.closed, 0, 'detached terminal measurement no longer mutates metrics')

const failingAccounting = new EffectiveSseRecorder({ openSse: () => { throw new Error('metric open') } } as never)
assert.throws(() => failingAccounting.openSse(response), /metric open/)
assert.equal(failingAccounting.activeCount, 0, 'failed metric accounting rolls back the newly registered functional session')

console.log('egress baseline sse: ok')
