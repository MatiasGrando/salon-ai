import { monitorEventLoopDelay } from 'node:perf_hooks'

export interface HistogramLike { count: number; percentile(value: number): number; max: number; reset(): void; disable?(): void }
export interface ProcessHealthSample { samplingStatus: 'ok' | 'unavailable'; eventLoopDelayP95Ms: number | null; eventLoopDelayMaxMs: number | null; heapUsedBytes: number | null; heapTotalBytes: number | null; saturated: boolean }
export interface ProcessHealthSampler { sample(): ProcessHealthSample; disable(): void }

export function sampleProcessHealth(histogram: HistogramLike, memoryUsage: () => { heapUsed: number; heapTotal: number }): ProcessHealthSample {
  let resetAttempted = false
  try {
    const count = histogram.count
    const memory = memoryUsage()
    const heapValid = [memory.heapUsed, memory.heapTotal].every((value) => Number.isFinite(value) && value >= 0)
    if (count === 0) {
      histogram.reset(); resetAttempted = true
      return { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: heapValid ? memory.heapUsed : null, heapTotalBytes: heapValid ? memory.heapTotal : null, saturated: !heapValid }
    }
    const p95 = histogram.percentile(95)
    const max = histogram.max
    if (![p95, max].every((value) => Number.isFinite(value) && value >= 0) || !heapValid) throw new Error('invalid process health sample')
    const values = [p95 / 1_000_000, max / 1_000_000, memory.heapUsed, memory.heapTotal]
    const saturated = values.some((value) => value > Number.MAX_SAFE_INTEGER)
    histogram.reset(); resetAttempted = true
    return { samplingStatus: 'ok', eventLoopDelayP95Ms: Math.min(values[0]!, Number.MAX_SAFE_INTEGER), eventLoopDelayMaxMs: Math.min(values[1]!, Number.MAX_SAFE_INTEGER), heapUsedBytes: Math.min(values[2]!, Number.MAX_SAFE_INTEGER), heapTotalBytes: Math.min(values[3]!, Number.MAX_SAFE_INTEGER), saturated }
  } catch {
    if (!resetAttempted) try { histogram.reset() } catch {}
    return { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null, saturated: false }
  }
}

export function createProductionProcessHealthSampler(createHistogram: () => HistogramLike & { enable(): void } = () => monitorEventLoopDelay({ resolution: 20 })): ProcessHealthSampler {
  let histogram: (HistogramLike & { enable(): void }) | null = null
  try {
    histogram = createHistogram()
    histogram.enable()
  } catch {
    try { histogram?.disable?.() } catch {}
    try { histogram?.reset() } catch {}
    return { sample: unavailableProcessHealth, disable: () => {} }
  }
  const activeHistogram = histogram
  let disabled = false
  return {
    sample: () => disabled ? unavailableProcessHealth() : sampleProcessHealth(activeHistogram, process.memoryUsage),
    disable: () => {
      if (disabled) return
      disabled = true
      try { activeHistogram.disable?.() } catch {}
      try { activeHistogram.reset() } catch {}
    }
  }
}

function unavailableProcessHealth(): ProcessHealthSample {
  return { samplingStatus: 'unavailable', eventLoopDelayP95Ms: null, eventLoopDelayMaxMs: null, heapUsedBytes: null, heapTotalBytes: null, saturated: false }
}
