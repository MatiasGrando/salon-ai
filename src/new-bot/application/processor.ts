import type { NewBotQueueClaim, NewBotQueueRepository } from '../infrastructure/queue-repository.js'

export interface NewBotProcessorOptions<TResult> {
  readonly queue: NewBotQueueRepository
  readonly concurrency: number
  readonly leaseDurationMs: number
  readonly handlerTimeoutMs: number
  readonly retryDelayMs: number
  /** Must only prepare a value; it must not persist state or cause external effects. */
  readonly prepare: (claim: Readonly<NewBotQueueClaim>, signal: AbortSignal) => Promise<TResult> | TResult
  /**
   * Persist prepared state and complete the inbox atomically under the claim's lease fence.
   * A false result means ownership was lost. Throws are uncertain and must not be retried inline.
   * Implementations must re-check the lease inside the same transaction as every write.
   */
  readonly commit: (claim: Readonly<NewBotQueueClaim>, result: TResult, signal: AbortSignal) => Promise<boolean>
}

export interface NewBotProcessorOutcome {
  readonly claimed: number
  readonly committed: number
  readonly retried: number
  readonly commitRejected: number
  readonly commitUncertain: number
  readonly leaseLost: number
  readonly aborted: number
  readonly retryUncertain: number
  readonly claimFailed: boolean
}

export interface NewBotProcessor {
  /** Manually drains at most the currently free handler slots; concurrent calls share one batch. */
  runOnce(): Promise<NewBotProcessorOutcome>
  /** Stops future claims and aborts preparation. It does not wait for handlers that ignore abort; their slots remain reserved until settlement. Current leases are left to expire/reclaim. */
  shutdown(): Promise<void>
}

const MAX_CONCURRENCY = 100
const MAX_LEASE_MS = 5 * 60 * 1000
const MIN_LEASE_MS = 100
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

function emptyOutcome(overrides: Partial<NewBotProcessorOutcome> = {}): NewBotProcessorOutcome {
  return {
    claimed: 0,
    committed: 0,
    retried: 0,
    commitRejected: 0,
    commitUncertain: 0,
    leaseLost: 0,
    aborted: 0,
    retryUncertain: 0,
    claimFailed: false,
    ...overrides,
  }
}

function freezeClaim(claim: NewBotQueueClaim): Readonly<NewBotQueueClaim> {
  return Object.freeze({ ...claim, message: Object.freeze({ ...claim.message }), leaseExpiresAt: new Date(claim.leaseExpiresAt) })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function prepareWithDeadline<TResult>(
  prepare: NewBotProcessorOptions<TResult>['prepare'],
  claim: Readonly<NewBotQueueClaim>,
  controller: AbortController,
  timeoutMs: number,
): Promise<{ readonly status: 'prepared'; readonly result: TResult; readonly settled: Promise<void> } | { readonly status: 'timeout' | 'aborted' | 'failed'; readonly settled: Promise<void> }> {
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) {
      const error = new Error('Preparation aborted before start')
      error.name = 'AbortError'
      throw error
    }
    return prepare(claim, controller.signal)
  })
  // A handler may ignore abort and reject after timeout. Keep its physical slot reserved until this settles.
  const settled = work.then(() => undefined, () => undefined)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interruption = new Promise<{ readonly status: 'timeout' | 'aborted'; readonly settled: Promise<void> }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ status: 'timeout', settled })
      controller.abort()
    }, timeoutMs)
    onAbort = () => resolve({ status: 'aborted', settled })
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const completed = work.then(
      (result) => ({ status: 'prepared' as const, result, settled }),
      () => ({ status: 'failed' as const, settled }),
    )
    const outcome = await Promise.race([completed, interruption])
    return outcome
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (onAbort) controller.signal.removeEventListener('abort', onAbort)
  }
}

/** An opt-in single-process execution tick; importing this module starts no work or timers. */
export function createNewBotProcessor<TResult>(options: NewBotProcessorOptions<TResult>): NewBotProcessor {
  if (
    !options || !options.queue ||
    !boundedInteger(options.concurrency, 1, MAX_CONCURRENCY) ||
    !boundedInteger(options.leaseDurationMs, MIN_LEASE_MS, MAX_LEASE_MS) ||
    !boundedInteger(options.handlerTimeoutMs, 1, options.leaseDurationMs - 1) ||
    !boundedInteger(options.retryDelayMs, 0, MAX_RETRY_DELAY_MS) ||
    typeof options.prepare !== 'function' || typeof options.commit !== 'function'
  ) throw new TypeError('Invalid new-bot processor options')

  const active = new Set<AbortController>()
  let running: Promise<NewBotProcessorOutcome> | undefined
  let stopped = false

  async function processClaim(claim: NewBotQueueClaim, outcome: {
    committed: number; retried: number; commitRejected: number; commitUncertain: number;
    leaseLost: number; aborted: number; retryUncertain: number
  }): Promise<void> {
    const ownership = freezeClaim(claim)
    const controller = new AbortController()
    active.add(controller)
    let retainSlotUntilPreparationSettles = false
    try {
      const prepared = await prepareWithDeadline(options.prepare, ownership, controller, options.handlerTimeoutMs)
      if (prepared.status === 'aborted' || stopped) {
        outcome.aborted += 1
        retainSlotUntilPreparationSettles = true
        void prepared.settled.then(() => active.delete(controller))
        return
      }
      if (prepared.status !== 'prepared') {
        if (prepared.status === 'timeout') {
          outcome.aborted += 1
          retainSlotUntilPreparationSettles = true
          void prepared.settled.then(() => active.delete(controller))
        }
        try {
          if (await options.queue.retry({
            eventId: ownership.eventId, businessId: ownership.businessId, provider: ownership.provider,
            conversationId: ownership.conversationId, leaseToken: ownership.leaseToken, delayMs: options.retryDelayMs,
          })) outcome.retried += 1
          else outcome.leaseLost += 1
        } catch {
          outcome.retryUncertain += 1
        }
        return
      }
      // Do not begin a durable write after shutdown/timeout has revoked preparation authority.
      if (controller.signal.aborted || stopped) {
        outcome.aborted += 1
        return
      }
      try {
        if (await options.commit(ownership, prepared.result, controller.signal)) outcome.committed += 1
        else outcome.commitRejected += 1
      } catch {
        // Commit outcome may be uncertain. Never complete or re-run effects in this tick.
        outcome.commitUncertain += 1
      }
    } catch {
      outcome.retryUncertain += 1
    } finally {
      if (!retainSlotUntilPreparationSettles) active.delete(controller)
    }
  }

  async function runBatch(): Promise<NewBotProcessorOutcome> {
    const availableSlots = options.concurrency - active.size
    if (stopped || availableSlots <= 0) return emptyOutcome()
    let claims: NewBotQueueClaim[]
    try {
      claims = await options.queue.claimBatch({ batchSize: availableSlots, leaseDurationMs: options.leaseDurationMs })
    } catch {
      return emptyOutcome({ claimFailed: true })
    }
    if (stopped) return emptyOutcome({ claimed: claims.length, aborted: claims.length })
    const tally = { committed: 0, retried: 0, commitRejected: 0, commitUncertain: 0, leaseLost: 0, aborted: 0, retryUncertain: 0 }
    await Promise.all(claims.map((claim) => processClaim(claim, tally)))
    return { claimed: claims.length, ...tally, claimFailed: false }
  }

  return {
    runOnce() {
      if (stopped) return Promise.resolve(emptyOutcome())
      if (running) return running
      const current = runBatch().finally(() => {
        if (running === current) running = undefined
      })
      running = current
      return current
    },
    async shutdown() {
      if (stopped) return
      stopped = true
      for (const controller of active) controller.abort()
    },
  }
}
