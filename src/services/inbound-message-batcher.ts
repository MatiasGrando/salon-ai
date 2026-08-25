import { performance } from 'node:perf_hooks'

export type InboundMessageBatchProcessor<TItem, TResult> = (
  items: TItem[]
) => Promise<TResult>

export type InboundMessageBatcherTiming = {
  onDebounceComplete?: (durationMs: number) => unknown
  onProcessingTailReady?: (durationMs: number) => unknown
}

type PendingBatch<TItem, TResult> = {
  items: TItem[]
  firstMessageAt: number
  timer: NodeJS.Timeout | null
  processor: InboundMessageBatchProcessor<TItem, TResult>
  promise: Promise<TResult>
  resolve: (result: TResult) => void
  reject: (error: unknown) => void
  debounceStartedAt: number
  timing?: InboundMessageBatcherTiming
}

export class InboundMessageBatcher {
  private readonly pending = new Map<string, PendingBatch<unknown, unknown>>()
  private readonly processingTails = new Map<string, Promise<void>>()

  constructor(
    private readonly delayMs: number,
    private readonly maxWaitMs: number
  ) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error('delayMs debe ser un numero mayor o igual a cero')
    }
    if (!Number.isFinite(maxWaitMs) || maxWaitMs < delayMs) {
      throw new Error('maxWaitMs debe ser mayor o igual a delayMs')
    }
  }

  enqueue<TItem, TResult>(input: {
    key: string
    item: TItem
    process: InboundMessageBatchProcessor<TItem, TResult>
    immediate?: boolean
    timing?: InboundMessageBatcherTiming
  }): Promise<TResult> {
    let existing = this.pending.get(input.key) as PendingBatch<TItem, TResult> | undefined
    if (existing && input.immediate) {
      void this.flush(input.key, existing)
      existing = undefined
    }
    if (existing) {
      existing.items.push(input.item)
      this.schedule(input.key, existing, false)
      return existing.promise
    }

    let resolve!: (result: TResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const batch: PendingBatch<TItem, TResult> = {
      items: [input.item],
      firstMessageAt: Date.now(),
      timer: null,
      processor: input.process,
      promise,
      resolve,
      reject,
      debounceStartedAt: performance.now(),
      ...(input.timing ? { timing: input.timing } : {})
    }
    this.pending.set(input.key, batch as PendingBatch<unknown, unknown>)
    this.schedule(input.key, batch, input.immediate === true)
    return promise
  }

  private schedule<TItem, TResult>(
    key: string,
    batch: PendingBatch<TItem, TResult>,
    immediate: boolean
  ) {
    if (batch.timer) clearTimeout(batch.timer)
    const elapsedMs = Date.now() - batch.firstMessageAt
    const remainingMaxWaitMs = Math.max(0, this.maxWaitMs - elapsedMs)
    const waitMs = immediate ? 0 : Math.min(this.delayMs, remainingMaxWaitMs)
    batch.timer = setTimeout(() => {
      void this.flush(key, batch)
    }, waitMs)
  }

  private async flush<TItem, TResult>(key: string, batch: PendingBatch<TItem, TResult>) {
    if (this.pending.get(key) !== batch) return
    this.pending.delete(key)
    if (batch.timer) clearTimeout(batch.timer)
    notifyTiming(batch.timing?.onDebounceComplete, performance.now() - batch.debounceStartedAt)

    const previous = this.processingTails.get(key) ?? Promise.resolve()
    const tailWaitStartedAt = performance.now()
    const execution = (async () => {
      await previous.catch(() => undefined)
      notifyTiming(batch.timing?.onProcessingTailReady, performance.now() - tailWaitStartedAt)
      return batch.processor([...batch.items])
    })()
    const tail = execution.then(() => undefined, () => undefined)
    this.processingTails.set(key, tail)

    try {
      batch.resolve(await execution)
    } catch (error) {
      batch.reject(error)
    } finally {
      if (this.processingTails.get(key) === tail) {
        this.processingTails.delete(key)
      }
    }
  }
}

function notifyTiming(callback: ((durationMs: number) => unknown) | undefined, durationMs: number) {
  try {
    const result = callback?.(durationMs)
    void Promise.resolve(result).catch(() => undefined)
  } catch {
    // La observabilidad nunca debe interrumpir el procesamiento del batch.
  }
}
