import type { ProcessHealthSample, ProcessHealthSampler } from './process-health.js'

export type SaturationDomain = 'http' | 'sse' | 'output' | 'processHealth'
export type SaturationFlags = Record<SaturationDomain, boolean>

export interface HttpAggregate {
  key: string
  requestCount: number
  measuredPayloadCount: number
  unknownPayloadCount: number
  responseBytesTotal: number
  responseBytesMax: number
  durationTotalMs: number
  durationMaxMs: number
  errorCount: number
}

export interface SseAggregate {
  opened: number
  closed: number
  activeLocalCurrent: number
  activeLocalMax: number
  durationTotalMs: number
  durationMaxMs: number
  controlChunksAttempted: number
  heartbeatChunksAttempted: number
  businessChunksAttempted: number
  sseApplicationBytesAttempted: number
  writeBackpressureSignals: number
  synchronousWriteFailures: number
  closeReasons: Record<'client_close' | 'server_shutdown' | 'write_failure' | 'unknown', number>
}

export interface OutputPending { droppedSnapshots: number; bytes: number; records: number; backpressureSignals: number }

export interface WindowSnapshot {
  processStartId: string
  windowId: string
  windowSequence: number
  windowStartUtc: string
  windowEndUtc: string
  windowDurationMs: number
  resetReason: 'process_start' | 'interval' | 'manual' | 'close'
  httpEntries: readonly HttpAggregate[]
  foldedHttpEntry: HttpAggregate | null
  sse: SseAggregate
  overflowDistinctKeys: number
  overflowRequestCount: number
  indivisibleOversizedEntryCount: number
  counterSaturation: SaturationFlags
  processHealth: ProcessHealthSample
  pendingBeforeFlush: OutputPending
}

export function saturatingAdd(current: number, delta: number, saturation: { value: boolean }) {
  if (!Number.isFinite(delta) || delta < 0 || current > Number.MAX_SAFE_INTEGER - delta) {
    saturation.value = true
    return Number.MAX_SAFE_INTEGER
  }
  return current + delta
}

function add(current: number, delta: number, flags: SaturationFlags, domain: SaturationDomain) {
  const marker = { value: flags[domain] }
  const result = saturatingAdd(current, delta, marker)
  flags[domain] = marker.value
  return result
}

function safeMax(current: number, candidate: number, flags: SaturationFlags, domain: SaturationDomain) {
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > Number.MAX_SAFE_INTEGER) {
    flags[domain] = true
    return Number.MAX_SAFE_INTEGER
  }
  return Math.max(current, candidate)
}

export function newHttpAggregate(key: string): HttpAggregate {
  return { key, requestCount: 0, measuredPayloadCount: 0, unknownPayloadCount: 0, responseBytesTotal: 0, responseBytesMax: 0, durationTotalMs: 0, durationMaxMs: 0, errorCount: 0 }
}

export class EgressBaselineController {
  private sequence = 0
  private startedAt: Date
  private entries = new Map<string, HttpAggregate>()
  private other: HttpAggregate | null = null
  private overflowKeys = new Set<string>()
  private overflowRequestCount = 0
  private activeSse = 0
  private sse: SseAggregate
  private saturation: SaturationFlags = { http: false, sse: false, output: false, processHealth: false }
  private pending: OutputPending = { droppedSnapshots: 0, bytes: 0, records: 0, backpressureSignals: 0 }
  private incompleteReasons = { sink_failure: 0, shutdown_budget: 0, pressure: 0, encoder_failure: 0 }
  private terminalSummary: { pending: OutputPending; reasons: typeof this.incompleteReasons } | null = null
  private enabled = true
  private processHealthDisabled = false

  constructor(private readonly options: { processStartId: string; utcNow: () => Date; maxHttpKeys: number; processHealth?: ProcessHealthSampler }) {
    this.startedAt = options.utcNow()
    this.sse = this.newSseAggregate()
  }

  get measurementEnabled() { return this.enabled }

  recordHttp(input: { key: string; durationMs: number; bytes: number | null; hadError: boolean }) {
    if (!this.enabled) return
    let aggregate = this.entries.get(input.key)
    if (!aggregate && this.entries.size < this.options.maxHttpKeys) {
      aggregate = newHttpAggregate(input.key)
      this.entries.set(input.key, aggregate)
    }
    if (!aggregate) {
      this.overflowRequestCount = add(this.overflowRequestCount, 1, this.saturation, 'http')
      if (this.overflowKeys.size < this.options.maxHttpKeys) this.overflowKeys.add(input.key)
      else this.saturation.http = true
      this.other ??= newHttpAggregate('__other__')
      aggregate = this.other
    }
    aggregate.requestCount = add(aggregate.requestCount, 1, this.saturation, 'http')
    aggregate.durationTotalMs = add(aggregate.durationTotalMs, input.durationMs, this.saturation, 'http')
    aggregate.durationMaxMs = safeMax(aggregate.durationMaxMs, input.durationMs, this.saturation, 'http')
    if (input.bytes === null) aggregate.unknownPayloadCount = add(aggregate.unknownPayloadCount, 1, this.saturation, 'http')
    else {
      aggregate.measuredPayloadCount = add(aggregate.measuredPayloadCount, 1, this.saturation, 'http')
      aggregate.responseBytesTotal = add(aggregate.responseBytesTotal, input.bytes, this.saturation, 'http')
      aggregate.responseBytesMax = safeMax(aggregate.responseBytesMax, input.bytes, this.saturation, 'http')
    }
    if (input.hadError) aggregate.errorCount = add(aggregate.errorCount, 1, this.saturation, 'http')
  }

  openSse() {
    if (!this.enabled) return false
    this.activeSse = add(this.activeSse, 1, this.saturation, 'sse')
    this.sse.opened = add(this.sse.opened, 1, this.saturation, 'sse')
    this.sse.activeLocalCurrent = this.activeSse
    this.sse.activeLocalMax = safeMax(this.sse.activeLocalMax, this.activeSse, this.saturation, 'sse')
    return true
  }

  attemptSse(kind: 'control' | 'heartbeat' | 'business', chunk: string, accepted: boolean) {
    if (!this.enabled) return
    const field = kind === 'control' ? 'controlChunksAttempted' : kind === 'heartbeat' ? 'heartbeatChunksAttempted' : 'businessChunksAttempted'
    this.sse[field] = add(this.sse[field], 1, this.saturation, 'sse')
    this.sse.sseApplicationBytesAttempted = add(this.sse.sseApplicationBytesAttempted, Buffer.byteLength(chunk), this.saturation, 'sse')
    if (!accepted) this.sse.writeBackpressureSignals = add(this.sse.writeBackpressureSignals, 1, this.saturation, 'sse')
  }

  recordSseBackpressure() {
    if (this.enabled) this.sse.writeBackpressureSignals = add(this.sse.writeBackpressureSignals, 1, this.saturation, 'sse')
  }

  synchronousSseFailure() {
    if (this.enabled) this.sse.synchronousWriteFailures = add(this.sse.synchronousWriteFailures, 1, this.saturation, 'sse')
  }

  closeSse(durationMs: number, reason: keyof SseAggregate['closeReasons']) {
    if (!this.enabled) return
    if (this.activeSse > 0) this.activeSse--
    this.sse.closed = add(this.sse.closed, 1, this.saturation, 'sse')
    this.sse.activeLocalCurrent = this.activeSse
    this.sse.durationTotalMs = add(this.sse.durationTotalMs, durationMs, this.saturation, 'sse')
    this.sse.durationMaxMs = safeMax(this.sse.durationMaxMs, durationMs, this.saturation, 'sse')
    this.sse.closeReasons[reason] = add(this.sse.closeReasons[reason], 1, this.saturation, 'sse')
  }

  noteOutputAttempt(bytes: number) {
    this.pending.bytes = add(this.pending.bytes, bytes, this.saturation, 'output')
    this.pending.records = add(this.pending.records, 1, this.saturation, 'output')
  }

  noteOutputBackpressure() {
    this.pending.backpressureSignals = add(this.pending.backpressureSignals, 1, this.saturation, 'output')
  }

  noteSnapshotComplete(captured: OutputPending) {
    this.pending.bytes = Math.max(0, this.pending.bytes - captured.bytes)
    this.pending.records = Math.max(0, this.pending.records - captured.records)
    this.pending.backpressureSignals = Math.max(0, this.pending.backpressureSignals - captured.backpressureSignals)
    this.pending.droppedSnapshots = Math.max(0, this.pending.droppedSnapshots - captured.droppedSnapshots)
  }

  noteSnapshotDropped(reason: keyof typeof this.incompleteReasons = 'sink_failure') {
    this.pending.droppedSnapshots = add(this.pending.droppedSnapshots, 1, this.saturation, 'output')
    this.incompleteReasons[reason] = add(this.incompleteReasons[reason], 1, this.saturation, 'output')
  }

  getIncompleteState() { return this.terminalSummary ?? { pending: { ...this.pending }, reasons: { ...this.incompleteReasons } } }

  detach(requestedReason: 'interval' | 'manual' | 'close' = 'interval'): WindowSnapshot {
    const observedEnd = this.options.utcNow()
    const endedAt = observedEnd.getTime() < this.startedAt.getTime() ? new Date(this.startedAt) : observedEnd
    const health = this.enabled ? this.safeSampleProcessHealth() : unavailableProcessHealth()
    if (health?.saturated) this.saturation.processHealth = true
    const sequence = this.sequence++
    const snapshot: WindowSnapshot = Object.freeze({
      processStartId: this.options.processStartId,
      windowId: `${this.options.processStartId}:${sequence}`,
      windowSequence: sequence,
      windowStartUtc: this.startedAt.toISOString(),
      windowEndUtc: endedAt.toISOString(),
      windowDurationMs: Math.max(0, endedAt.getTime() - this.startedAt.getTime()),
      resetReason: sequence === 0 && requestedReason === 'interval' ? 'process_start' : requestedReason,
      httpEntries: Object.freeze([...this.entries.values(), ...(this.other ? [this.other] : [])].map((entry) => Object.freeze({ ...entry }))),
      foldedHttpEntry: null,
      sse: Object.freeze({ ...this.sse, closeReasons: Object.freeze({ ...this.sse.closeReasons }), activeLocalCurrent: this.activeSse }),
      overflowDistinctKeys: this.overflowKeys.size,
      overflowRequestCount: this.overflowRequestCount,
      indivisibleOversizedEntryCount: 0,
      counterSaturation: Object.freeze({ ...this.saturation }),
      processHealth: Object.freeze({ ...health }),
      pendingBeforeFlush: Object.freeze({ ...this.pending })
    })
    this.startedAt = endedAt
    this.entries = new Map()
    this.other = null
    this.overflowKeys = new Set()
    this.overflowRequestCount = 0
    this.sse = this.newSseAggregate()
    this.saturation = { http: false, sse: false, output: this.saturation.output, processHealth: false }
    return snapshot
  }

  disableOutputTerminal() {
    if (!this.enabled) return
    this.enabled = false
    this.terminalSummary = { pending: { ...this.pending }, reasons: { ...this.incompleteReasons } }
    this.entries.clear()
    this.other = null
    this.overflowKeys.clear()
    this.activeSse = 0
    this.sse = this.newSseAggregate()
    this.saturation = { http: false, sse: false, output: false, processHealth: false }
    this.incompleteReasons = { sink_failure: 0, shutdown_budget: 0, pressure: 0, encoder_failure: 0 }
    this.pending = { droppedSnapshots: 0, bytes: 0, records: 0, backpressureSignals: 0 }
    this.safeDisableProcessHealth()
  }

  close() { this.safeDisableProcessHealth() }

  private newSseAggregate(): SseAggregate {
    return { opened: 0, closed: 0, activeLocalCurrent: this.activeSse, activeLocalMax: this.activeSse, durationTotalMs: 0, durationMaxMs: 0, controlChunksAttempted: 0, heartbeatChunksAttempted: 0, businessChunksAttempted: 0, sseApplicationBytesAttempted: 0, writeBackpressureSignals: 0, synchronousWriteFailures: 0, closeReasons: { client_close: 0, server_shutdown: 0, write_failure: 0, unknown: 0 } }
  }

  private safeSampleProcessHealth() {
    if (this.processHealthDisabled || !this.options.processHealth) return unavailableProcessHealth()
    try {
      const sample = this.options.processHealth.sample()
      const duration = (value: unknown) => Number.isFinite(value) && Number(value) >= 0 && Number(value) <= Number.MAX_SAFE_INTEGER
      const heap = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
      const valid = typeof sample?.saturated === 'boolean' && (
        sample.samplingStatus === 'ok'
          ? duration(sample.eventLoopDelayP95Ms) && duration(sample.eventLoopDelayMaxMs) && heap(sample.heapUsedBytes) && heap(sample.heapTotalBytes)
          : sample.samplingStatus === 'unavailable' && sample.eventLoopDelayP95Ms === null && sample.eventLoopDelayMaxMs === null && (sample.heapUsedBytes === null || heap(sample.heapUsedBytes)) && (sample.heapTotalBytes === null || heap(sample.heapTotalBytes))
      )
      return valid ? sample : unavailableProcessHealth()
    } catch { return unavailableProcessHealth() }
  }

  private safeDisableProcessHealth() {
    if (this.processHealthDisabled) return
    this.processHealthDisabled = true
    try { this.options.processHealth?.disable() } catch {}
  }
}

function unavailableProcessHealth(): ProcessHealthSample {
  return { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null, saturated: false }
}
