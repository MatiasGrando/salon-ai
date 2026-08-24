import type { ServerResponse } from 'node:http'
import type { EgressBaselineController } from './controller.js'
import type { FunctionalSseSession, SseCloseReason, SseMeasurementHandle, SseOpenResult, SseRecorderFacade } from './types.js'

class FunctionalSession implements FunctionalSseSession {
  private closed = false
  private cleanup: ((reason: SseCloseReason) => void) | null = null
  constructor(private readonly finalize: (reason: SseCloseReason) => void) {}
  bindCleanup(cleanup: (reason: SseCloseReason) => void) { this.cleanup = cleanup }
  close(reason: SseCloseReason) {
    if (this.closed) return
    this.closed = true
    try { this.cleanup?.(reason) } finally { this.finalize(reason) }
  }
}

class DisabledFacade implements SseRecorderFacade {
  isClosing() { return false }
  canOpenSse() { return true }
  openSse(_response: ServerResponse): SseOpenResult { return { status: 'opened', session: new FunctionalSession(() => {}), measurement: null } }
  beginClosingAndSnapshotFunctionalSse(): readonly FunctionalSseSession[] { return [] }
}

export const DISABLED_SSE_RECORDER: SseRecorderFacade = Object.freeze(new DisabledFacade())

export class EffectiveSseRecorder implements SseRecorderFacade {
  private closing = false
  private measurementEnabled = true
  private sessions = new Map<FunctionalSession, { detach(): void }>()
  get activeCount() { return this.sessions.size }

  constructor(private readonly controller?: EgressBaselineController, private readonly monotonicNow: () => number = () => performance.now()) {}
  isClosing() { return this.closing }
  canOpenSse() { return !this.closing }

  openSse(_response: ServerResponse): SseOpenResult {
    if (this.closing) return { status: 'closing' }
    const openedAt = this.monotonicNow()
    let measured = false
    let measurementClosed = false
    let session!: FunctionalSession
    const closeMeasurement = (reason: SseCloseReason) => {
      if (measurementClosed) return
      measurementClosed = true
      if (measured) this.controller?.closeSse(Math.max(0, this.monotonicNow() - openedAt), reason)
      measured = false
    }
    session = new FunctionalSession((reason) => {
      closeMeasurement(reason)
      this.sessions.delete(session)
    })
    this.sessions.set(session, { detach: () => {} })
    try {
      measured = this.measurementEnabled && Boolean(this.controller?.openSse())
    } catch (error) {
      session.close('unknown')
      throw error
    }
    const measurement: SseMeasurementHandle | null = measured ? {
      control: (chunk, accepted) => { if (measured) this.controller?.attemptSse('control', chunk, accepted) },
      heartbeat: (chunk, accepted) => { if (measured) this.controller?.attemptSse('heartbeat', chunk, accepted) },
      business: (chunk, accepted) => { if (measured) this.controller?.attemptSse('business', chunk, accepted) },
      writeBackpressure: () => { if (measured) this.controller?.recordSseBackpressure() },
      writeFailure: () => { if (measured) this.controller?.synchronousSseFailure() },
      close: closeMeasurement,
      detach: () => { measured = false; measurementClosed = true }
    } : null
    this.sessions.set(session, { detach: () => measurement?.detach() })
    return { status: 'opened', session, measurement }
  }

  beginClosingAndSnapshotFunctionalSse() { this.closing = true; return [...this.sessions.keys()] }

  disableMeasurement() {
    if (!this.measurementEnabled) return
    this.measurementEnabled = false
    for (const state of this.sessions.values()) state.detach()
  }
}
