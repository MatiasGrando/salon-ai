import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'

export type DiagnosticTransport = {
  writeBatch: (lines: readonly string[]) => unknown
  close?: () => unknown
}
type Options = {
  enabled?: boolean
  now?: () => number
  capacity?: number
  maxQueuedBytes?: number
  maxRecordBytes?: number
  batchSize?: number
  shutdownTimeoutMs?: number
  schedule?: (callback: () => void) => void
  transport?: DiagnosticTransport
}
type Entry = { line: string; bytes: number }
type Counters = { pending: number; accepted: number; written: number; dropped: number; failed: number; asyncDrainMs: number | null; stopped: boolean }
const bounded = (value: number | undefined, fallback: number, maximum: number) =>
  Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, maximum) : fallback

/** Direct output happens on a dedicated native worker, never on the request's event loop. */
function workerTransport(): DiagnosticTransport {
  const worker = new Worker(new URL('./diagnostic-output-worker.cjs', import.meta.url), { execArgv: [] })
  worker.unref()
  let stopped = false
  let nextId = 0
  let pending: { id: number; resolve: () => void; reject: () => void } | null = null
  const fail = () => { stopped = true; pending?.reject(); pending = null }
  worker.on('error', fail)
  worker.on('exit', fail)
  worker.on('message', (message: { id?: number; ok?: boolean }) => {
    if (!pending || message.id !== pending.id) return
    const waiting = pending; pending = null
    worker.unref()
    if (message.ok === true) waiting.resolve()
    else { stopped = true; waiting.reject() }
  })
  return {
    writeBatch(lines) {
      if (stopped || pending) throw new Error('Diagnostic output unavailable')
      return new Promise<void>((resolve, reject) => {
        const id = ++nextId
        pending = { id, resolve, reject: () => reject(new Error('Diagnostic output failed')) }
        worker.ref()
        try { worker.postMessage({ id, lines }) } catch { fail() }
      })
    },
    async close() {
      fail()
      await worker.terminate()
    }
  }
}

/**
 * Best effort diagnostics only. Does not buffer business errors or replace their normal logger.
 * Return time measures enqueue/serialization; async drain is deliberately excluded.
 */
export function createBoundedDiagnosticSink(options: Options = {}) {
  const enabled = options.enabled !== false
  const capacity = bounded(options.capacity, 512, 4096)
  const maxBytes = bounded(options.maxQueuedBytes, 512 * 1024, 4 * 1024 * 1024)
  const maxRecordBytes = bounded(options.maxRecordBytes, 16 * 1024, 64 * 1024)
  const batchSize = bounded(options.batchSize, 16, 64)
  const timeoutMs = bounded(options.shutdownTimeoutMs, 500, 5000)
  const schedule = options.schedule ?? (callback => { setImmediate(callback) })
  const readNow = (): number | null => {
    try { const value = (options.now ?? (() => performance.now()))(); return Number.isFinite(value) && value >= 0 ? value : null }
    catch { return null }
  }
  const queue: Entry[] = []
  const counts: Counters = { pending: 0, accepted: 0, written: 0, dropped: 0, failed: 0, asyncDrainMs: 0, stopped: false }
  let transport: DiagnosticTransport | undefined = options.transport
  let accepting = enabled
  let healthy = true
  let draining = false
  let scheduled = false
  let queuedBytes = 0
  let inFlight = 0
  let reportedDrops = 0
  let reportedFailures = 0
  let stopPromise: Promise<void> | null = null
  const idleWaiters = new Set<() => void>()
  const notifyIdle = () => { for (const resolve of idleWaiters) resolve(); idleWaiters.clear() }
  const hasSummary = () => counts.dropped !== reportedDrops || counts.failed !== reportedFailures
  const dropRemaining = () => {
    counts.dropped += queue.length + inFlight
    queue.length = 0; inFlight = 0; queuedBytes = 0; counts.pending = 0
  }
  const getTransport = () => {
    if (!transport) transport = workerTransport()
    return transport
  }
  const requestDrain = () => {
    if (scheduled || draining || counts.stopped || !healthy) return
    scheduled = true
    try { schedule(() => { scheduled = false; void drain() }) }
    catch { scheduled = false; healthy = false; counts.failed++; dropRemaining(); notifyIdle() }
  }
  const drain = async () => {
    if (draining || counts.stopped || !healthy) return
    draining = true
    const entries = queue.splice(0, batchSize)
    inFlight = entries.length
    const lines = entries.map(entry => entry.line)
    if (lines.length < batchSize && hasSummary()) {
      reportedDrops = counts.dropped; reportedFailures = counts.failed
      lines.push('[barber-local-diagnostic-sink] ' + JSON.stringify({
        event: 'bounded_diagnostic_sink', dropped: reportedDrops, failed: reportedFailures,
        asyncDrainMs: counts.asyncDrainMs, measurement: 'async_output_excluded_from_enqueue_cost'
      }))
    }
    const start = readNow()
    try {
      if (lines.length > 0) await getTransport().writeBatch(lines)
      if (!counts.stopped) counts.written += entries.length
    } catch {
      if (!counts.stopped) { healthy = false; counts.failed += entries.length || 1; dropRemaining() }
    } finally {
      if (!counts.stopped) {
        const end = readNow()
        if (start === null || end === null || end < start) counts.asyncDrainMs = null
        else if (counts.asyncDrainMs !== null) counts.asyncDrainMs += end - start
        queuedBytes -= entries.reduce((total, entry) => total + entry.bytes, 0)
        queuedBytes = Math.max(0, queuedBytes)
        counts.pending -= inFlight
        inFlight = 0
      }
      draining = false
      if (healthy && !counts.stopped && (queue.length > 0 || hasSummary())) requestDrain()
      else notifyIdle()
    }
  }
  const emit = (label: string, event: unknown): boolean => {
    if (!accepting || !healthy || counts.stopped) return false
    try {
      if (!/^[a-z0-9-]{1,80}$/.test(label)) throw new Error('Invalid diagnostic label')
      const serialized = JSON.stringify(event)
      if (serialized === undefined) throw new Error('Invalid diagnostic event')
      const line = '[' + label + '] ' + serialized
      const bytes = Buffer.byteLength(line, 'utf8') + 1
      if (bytes > maxRecordBytes || counts.pending >= capacity || queuedBytes + bytes > maxBytes) {
        counts.dropped++; requestDrain(); return false
      }
      queue.push({ line, bytes })
      queuedBytes += bytes; counts.pending++; counts.accepted++
      requestDrain()
      return true
    } catch { counts.dropped++; requestDrain(); return false }
  }
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise
    accepting = false
    stopPromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) })
      const completion = (async () => {
        while (healthy && !counts.stopped && (draining || queue.length > 0 || hasSummary())) {
          const idle = new Promise<void>(resolve => idleWaiters.add(resolve))
          if (!draining) await drain()
          if (draining || queue.length > 0 || hasSummary()) await idle
        }
        if (transport && healthy && enabled && !counts.stopped) {
          try {
            await transport.writeBatch(['[barber-local-diagnostic-sink] ' + JSON.stringify({
              event: 'bounded_diagnostic_sink', phase: 'shutdown', ...counts,
              measurement: 'async_drain_includes_transport_ack_excludes_this_summary'
            })])
          } catch { counts.failed++ }
        }
      })()
      await Promise.race([completion, deadline])
      counts.stopped = true
      dropRemaining(); notifyIdle()
      try { await Promise.race([Promise.resolve(transport?.close?.()), deadline]) } catch { /* Diagnostic close never overrides shutdown. */ }
      if (timer) clearTimeout(timer)
    })()
    return stopPromise
  }
  return { emit, stop, get stats(): Readonly<Counters> { return { ...counts } } }
}
