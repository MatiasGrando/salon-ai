/** Process-local hints only: durable queues and periodic polling remain authoritative. */
export type WorkerWakeSignal = {
  readonly version: number
  notify(): void
  waitSince(version: number, timeoutMs: number, signal?: AbortSignal): Promise<void>
}

export function createWorkerWakeSignal(): WorkerWakeSignal {
  let version = 0
  const waiters = new Set<() => void>()
  return {
    get version() { return version },
    notify() {
      version += 1
      for (const finish of [...waiters]) finish()
    },
    waitSince(observed, timeoutMs, signal) {
      if (observed !== version || signal?.aborted) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          waiters.delete(finish)
          signal?.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, timeoutMs)
        waiters.add(finish)
        signal?.addEventListener('abort', finish, { once: true })
      })
    }
  }
}

/** A failed hint must never turn a committed operation into a retry. */
export function notifyWorkerWake(signal: WorkerWakeSignal | undefined): void {
  try { signal?.notify() } catch { /* polling recovers missed hints */ }
}
