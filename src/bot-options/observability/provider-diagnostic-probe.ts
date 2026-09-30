import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { withAttemptMetrics, type AttemptMetricEvent } from './attempt-metrics.js'
import type { PrismaPoolDiagnostic } from '../../config/prisma-pool-diagnostics.js'

type SinkCost = { count: number; totalMs: number | null; maxMs: number | null }
export type ProviderDiagnosticSummary = {
  event: 'provider_diagnostic_sink_cost'
  jobRef: string
  attempt: number
  attemptSink: SinkCost
  poolSink: SinkCost
  windowMs: number | null
  overlap: boolean
  eventLoop: { scope: 'process_window'; utilization: number | null; activeMs: number | null; idleMs: number | null }
  exclusions: 'summary_emission_async_flush_other_sinks'
}
type Options = {
  enabled?: boolean
  capacity?: number
  now?: () => number
  emitAttempt: (event: AttemptMetricEvent) => void
  emitPool: (event: PrismaPoolDiagnostic) => void
  emitSummary: (event: ProviderDiagnosticSummary) => void
}
type Active = { jobRef: string; attempt: number; attemptSink: SinkCost; poolSink: SinkCost; overlap: boolean }
const blank = (): SinkCost => ({ count: 0, totalMs: 0, maxMs: 0 })

/** Measures synchronous sink return only, not eventual stdout/disk flush or exclusive job CPU. */
export function createProviderDiagnosticProbe(options: Options) {
  const active = new Map<string, Active>()
  const capacity = Number.isSafeInteger(options.capacity) && options.capacity! > 0 ? Math.min(options.capacity!, 128) : 16
  const readNow = (): number | null => {
    try { const value = (options.now ?? (() => performance.now()))(); return Number.isFinite(value) && value >= 0 ? value : null }
    catch { return null }
  }
  const deliver = <T>(sink: (event: T) => void, event: T, cost?: SinkCost) => {
    if (!cost) { try { sink(event) } catch { /* Preserve pipeline result. */ } return }
    const start = readNow()
    try { sink(event) } catch { /* Sink failure is still timed, never propagated. */ }
    finally {
      const end = readNow()
      cost.count++
      if (start === null || end === null || end < start) { cost.totalMs = null; cost.maxMs = null }
      else {
        if (cost.totalMs !== null) cost.totalMs += end - start
        if (cost.maxMs !== null) cost.maxMs = Math.max(cost.maxMs, end - start)
      }
    }
  }
  return {
    get activeCount() { return active.size },
    emitPool(event: PrismaPoolDiagnostic): void {
      const entry = active.get(event.context.jobRef + ':' + event.context.attempt)
      deliver(options.emitPool, event, entry?.poolSink)
    },
    async run<T>(context: { jobId: string; attempt: number }, operation: () => Promise<T>): Promise<T> {
      if (options.enabled === false) return operation()
      const jobRef = createHash('sha256').update(context.jobId).digest('hex').slice(0, 24)
      const attempt = Number.isSafeInteger(context.attempt) && context.attempt >= 0 ? context.attempt : 0
      const key = jobRef + ':' + attempt
      if (active.size >= capacity || active.has(key)) {
        for (const entry of active.values()) entry.overlap = true
        // Capacity overflow never blocks real work or invents a partially measured summary.
        return withAttemptMetrics(context, operation, { emit: event => deliver(options.emitAttempt, event) })
      }
      const entry: Active = { jobRef, attempt, attemptSink: blank(), poolSink: blank(), overlap: active.size > 0 }
      for (const existing of active.values()) existing.overlap = true
      active.set(key, entry)
      const start = readNow()
      const loopStart = performance.eventLoopUtilization()
      try {
        return await withAttemptMetrics(context, operation, { emit: event => deliver(options.emitAttempt, event, entry.attemptSink) })
      } finally {
        const end = readNow()
        const loop = performance.eventLoopUtilization(loopStart)
        active.delete(key)
        const finite = (value: number): number | null => Number.isFinite(value) && value >= 0 ? value : null
        deliver(options.emitSummary, {
          event: 'provider_diagnostic_sink_cost', jobRef, attempt,
          attemptSink: { ...entry.attemptSink }, poolSink: { ...entry.poolSink },
          windowMs: start !== null && end !== null && end >= start ? end - start : null,
          overlap: entry.overlap,
          eventLoop: { scope: 'process_window', utilization: finite(loop.utilization), activeMs: finite(loop.active), idleMs: finite(loop.idle) },
          exclusions: 'summary_emission_async_flush_other_sinks'
        })
      }
    }
  }
}
