import type { WritableLike } from './types.js'
import type { MetricsSink } from './metrics-sink.js'

export class StdoutNdjsonSink implements MetricsSink {
  terminal = false
  pressured = false
  droppedSnapshots = 0
  lastWriteFailedSynchronously = false
  private closed = false
  private inFlightCallbacks = 0
  private cleanupScheduled = false
  private readonly onError = () => this.disableOutputTerminal()
  private readonly onDrain = () => { if (!this.terminal) this.pressured = false }

  constructor(private readonly writable: WritableLike, private readonly terminalCallback: () => void) {
    writable.on('error', this.onError)
    writable.on('drain', this.onDrain)
  }

  write(record: string) {
    this.lastWriteFailedSynchronously = false
    if (this.terminal || this.closed) return false
    try {
      this.inFlightCallbacks++
      const accepted = this.writable.write(record, (error) => {
        this.inFlightCallbacks = Math.max(0, this.inFlightCallbacks - 1)
        if (error) this.disableOutputTerminal()
        this.scheduleCleanupIfSafe()
      })
      if (!accepted) this.pressured = true
      return accepted
    } catch {
      this.inFlightCallbacks = Math.max(0, this.inFlightCallbacks - 1)
      this.droppedSnapshots++
      this.lastWriteFailedSynchronously = true
      this.terminal = true
      this.pressured = false
      return false
    }
  }

  disableOutputTerminal() {
    if (this.terminal) return
    this.terminal = true
    this.pressured = false
    this.terminalCallback()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.writable.removeListener('drain', this.onDrain)
    this.scheduleCleanupIfSafe()
  }

  private scheduleCleanupIfSafe() {
    if (!this.closed || this.inFlightCallbacks > 0 || this.cleanupScheduled) return
    this.cleanupScheduled = true
    setImmediate(() => {
      if (this.inFlightCallbacks === 0) this.writable.removeListener('error', this.onError)
      else this.cleanupScheduled = false
    })
  }
}
