import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { EgressBaselineController, type WindowSnapshot } from './controller.js'
import { installHttpLifecycle } from './http-lifecycle.js'
import { encodeSnapshot } from './snapshot-encoder.js'
import { StdoutNdjsonSink } from './stdout-ndjson-sink.js'
import { DISABLED_SSE_RECORDER, EffectiveSseRecorder } from './sse-recorder.js'
import { DISABLED_POLLING_MARKER, type Clock, type EgressBaselineConfig, type EgressBaselineInstallation, type PollingMarkerConfig, type RandomSource, type Scheduler, type TimerHandle, type WritableLike } from './types.js'
import { nextWindowDelay, productionClock, productionRandomSource, productionScheduler } from './runtime.js'
import { createProductionProcessHealthSampler, type ProcessHealthSampler } from './process-health.js'

export interface EgressBaselineDependencies {
  writable?: WritableLike
  diagnosticWritable?: WritableLike
  uuid?: () => string
  clock?: Clock
  scheduler?: Scheduler
  randomSource?: RandomSource
  processHealth?: ProcessHealthSampler
}

export function installEgressBaseline(app: FastifyInstance, config: EgressBaselineConfig, dependencies: EgressBaselineDependencies = {}): EgressBaselineInstallation {
  const pollingMarker: PollingMarkerConfig = config.pollingMarkerEffective ? Object.freeze({ effective: true, headerName: 'X-CRM-Refresh-Mode', headerValue: 'fallback-poll' }) : DISABLED_POLLING_MARKER
  if (!config.httpEffective && !config.sseEffective) return { sseRecorder: DISABLED_SSE_RECORDER, pollingMarker }

  const clock = dependencies.clock ?? productionClock
  const scheduler = dependencies.scheduler ?? productionScheduler
  const randomSource = dependencies.randomSource ?? productionRandomSource
  const processHealth = dependencies.processHealth ?? createProductionProcessHealthSampler()
  const controller = new EgressBaselineController({ processStartId: (dependencies.uuid ?? randomUUID)(), utcNow: () => clock.utcNow(), maxHttpKeys: config.maxHttpKeys, processHealth })
  let timer: TimerHandle | null = null
  let terminal = false
  let closing = false
  let httpLifecycle: { disable(): void } | null = null
  let sseRecorder: EffectiveSseRecorder | typeof DISABLED_SSE_RECORDER

  const disableOutputTerminal = () => {
    if (terminal) return
    terminal = true
    if (timer) scheduler.clearTimeout(timer)
    timer = null
    httpLifecycle?.disable()
    if (sseRecorder instanceof EffectiveSseRecorder) sseRecorder.disableMeasurement()
    controller.disableOutputTerminal()
  }

  const writable = dependencies.writable ?? process.stdout as unknown as WritableLike
  const sink = new StdoutNdjsonSink(writable, disableOutputTerminal)
  const diagnosticWritable = dependencies.diagnosticWritable
  const writeIncompleteDiagnostic = (reason: 'sink_failure' | 'shutdown_budget' | 'pressure' | 'encoder_failure') => {
    if (!diagnosticWritable || diagnosticWritable === writable) return
    const state = controller.getIncompleteState()
    try {
      diagnosticWritable.write(`${JSON.stringify({
        message: 'egress_baseline_output_incomplete',
        level: 'warn',
        reason,
        droppedSnapshotsPending: state.pending.droppedSnapshots,
        outputBytesAttemptedPending: state.pending.bytes,
        outputRecordsAttemptedPending: state.pending.records,
        outputBackpressureSignalsPending: state.pending.backpressureSignals,
        reasonCount: state.reasons[reason]
      })}\n`)
    } catch {}
  }
  if (config.httpEffective) httpLifecycle = installHttpLifecycle(app, controller, pollingMarker, () => clock.monotonicNow())
  sseRecorder = config.sseEffective ? new EffectiveSseRecorder(controller, () => clock.monotonicNow()) : DISABLED_SSE_RECORDER

  const outputSnapshot = (snapshot: WindowSnapshot, deadline: number | null = null) => {
    if (terminal) return
    if (sink.pressured) { controller.noteSnapshotDropped('pressure'); writeIncompleteDiagnostic('pressure'); return }
    let incomplete: 'sink_failure' | 'shutdown_budget' | null = null
    const encoded = encodeSnapshot(snapshot, { replicaId: config.replicaId, deploymentId: config.deploymentId }, config, (record) => {
      if (incomplete || terminal) return
      if (deadline !== null && clock.monotonicNow() >= deadline) { incomplete = 'shutdown_budget'; return }
      controller.noteOutputAttempt(Buffer.byteLength(record))
      const acceptedWithoutPressure = sink.write(record)
      if (sink.lastWriteFailedSynchronously) { incomplete = 'sink_failure'; return }
      if (sink.terminal) return
      if (!acceptedWithoutPressure) controller.noteOutputBackpressure()
    })
    if (sink.terminal && !incomplete && encoded.ok) return
    if (!encoded.ok || incomplete) {
      controller.noteSnapshotDropped(!encoded.ok ? 'encoder_failure' : incomplete ?? 'sink_failure')
      writeIncompleteDiagnostic(!encoded.ok ? 'encoder_failure' : incomplete ?? 'sink_failure')
      if (!encoded.ok || incomplete === 'sink_failure') disableOutputTerminal()
      return
    }
    controller.noteSnapshotComplete(snapshot.pendingBeforeFlush)
  }

  const rotate = (reason: 'interval' | 'close' = 'interval', deadline: number | null = null) => {
    if (terminal) return
    const snapshot = controller.detach(reason)
    outputSnapshot(snapshot, deadline)
  }

  const schedule = () => {
    if (terminal || closing) return
    try {
      const delay = nextWindowDelay(config.windowMs, config.jitterMs, randomSource)
      timer = scheduler.setTimeout(() => {
        timer = null
        try { rotate('interval') } catch { disableOutputTerminal() }
        schedule()
      }, delay)
      timer.unref()
    } catch { disableOutputTerminal() }
  }
  schedule()

  app.addHook('preClose', async () => {
    closing = true
    if (timer) scheduler.clearTimeout(timer)
    timer = null
    for (const session of sseRecorder.beginClosingAndSnapshotFunctionalSse()) session.close('server_shutdown')
  })
  app.addHook('onClose', async () => {
    try {
      if (config.finalFlushEffective && !terminal) {
        if (sink.pressured) { controller.detach('close'); controller.noteSnapshotDropped('pressure'); writeIncompleteDiagnostic('pressure') }
        else rotate('close', clock.monotonicNow() + config.shutdownBudgetMs)
      }
    } catch { disableOutputTerminal() }
    controller.close()
    sink.close()
  })
  return { sseRecorder, pollingMarker }
}
