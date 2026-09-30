import { createHash } from 'node:crypto'

export type QueueMilestoneKey = Readonly<{
  businessId: string
  resource: 'job' | 'outbox'
  resourceRef: string
  kind: 'PROCESS_PROVIDER_EVENT' | 'PROCESS_INBOX' | 'other' | null
}>
export type QueueMilestoneDiagnostic = {
  event: 'bot_queue_milestones'
  resource: 'job' | 'outbox'
  resourceRef: string
  kind: QueueMilestoneKey['kind']
  attempt: number
  readiness: 'observed' | 'overlap_censored' | 'unavailable'
  readyWaitMs: number | null
  claimMs: number | null
  dispatchMs: number | null
}
// These references never contain IDs, messages or other source values.
function reference(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)
}
export function jobQueueKey(input: { businessId: string; kind: string; aggregateId: string }): QueueMilestoneKey {
  return { businessId: input.businessId, resource: 'job',
    resourceRef: reference(['job', input.businessId, input.kind, input.aggregateId]),
    kind: input.kind === 'PROCESS_PROVIDER_EVENT' || input.kind === 'PROCESS_INBOX' ? input.kind : 'other' }
}
export function outboxQueueKey(input: { businessId: string; id: string }): QueueMilestoneKey {
  return { businessId: input.businessId, resource: 'outbox',
    resourceRef: reference(['outbox', input.businessId, input.id]), kind: null }
}

type Entry = { readyAt: number | null; expiresAt: number; pending: number; consumed: boolean }
type Registration = { ref: string; entry: Entry }
type Collector = { tracker: QueueMilestoneTracker; registrations: Map<string, Registration> }
const collectors = new WeakMap<object, Collector>()
declare const claimBrand: unique symbol
export type QueueClaimWindow = { readonly [claimBrand]: true }
type ClaimState = {
  start: number | null; end: number | null
  key: QueueMilestoneKey | null; attempt: number
  readiness: QueueMilestoneDiagnostic['readiness']; readyWait: number | null; emitted: boolean
}
type Options = {
  businessId: string
  now?: () => number
  emit: (diagnostic: QueueMilestoneDiagnostic) => void | Promise<void>
  ttlMs?: number
  capacity?: number
}
const duration = (start: number | null, end: number | null): number | null =>
  start !== null && end !== null && end >= start ? end - start : null

/**
 * Process-local diagnostic evidence, never a queue or a durable source of truth.
 * ACK observation is later than DB commit. Wait is observed ACK -> claim start,
 * not exact DB commit -> lease. Legacy createdAt-based metrics remain separate.
 */
export class QueueMilestoneTracker {
  readonly #options: Options
  readonly #capacity: number
  readonly #ttlMs: number
  readonly #entries = new Map<string, Entry>()
  readonly #claims = new WeakMap<QueueClaimWindow, ClaimState>()
  #lastNow: number | null = null

  constructor(options: Options) {
    this.#options = options
    this.#capacity = Number.isSafeInteger(options.capacity) && options.capacity! > 0
      ? Math.min(options.capacity!, 10_000) : 2048
    this.#ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs! > 0
      ? Math.min(options.ttlMs!, 600_000) : 120_000
  }
  get retainedCount(): number { return this.#entries.size }

  #now(): number | null {
    try {
      const now = (this.#options.now ?? (() => performance.now()))()
      if (!Number.isFinite(now) || now < 0 || (this.#lastNow !== null && now < this.#lastNow)) return null
      this.#lastNow = now
      return now
    } catch { return null }
  }
  #purge(now: number): void {
    for (const [ref, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(ref)
  }
  #stage(key: QueueMilestoneKey): Registration | null {
    if (key.businessId !== this.#options.businessId) return null
    const now = this.#now()
    if (now === null) return null
    this.#purge(now)
    let entry = this.#entries.get(key.resourceRef)
    if (entry?.consumed) return null
    if (!entry) {
      while (this.#entries.size >= this.#capacity) {
        const oldest = this.#entries.keys().next().value
        if (oldest === undefined) break
        this.#entries.delete(oldest)
      }
      entry = { readyAt: null, expiresAt: now + this.#ttlMs, pending: 0, consumed: false }
      this.#entries.set(key.resourceRef, entry)
    }
    entry.pending++
    return { ref: key.resourceRef, entry }
  }
  register(collector: Collector, key: QueueMilestoneKey): void {
    // One registration per key/TX, including duplicates in a large webhook.
    if (collector.registrations.has(key.resourceRef) || collector.registrations.size >= this.#capacity) return
    const registration = this.#stage(key)
    if (registration) collector.registrations.set(key.resourceRef, registration)
  }
  settle(collector: Collector, committed: boolean): void {
    const now = committed ? this.#now() : null
    if (now !== null) this.#purge(now)
    for (const { ref, entry } of collector.registrations.values()) {
      entry.pending--
      if (this.#entries.get(ref) !== entry || entry.consumed) continue
      // A missing/broken clock cannot fabricate commit evidence.
      if (committed && now !== null && entry.readyAt === null) entry.readyAt = now
      if (entry.readyAt === null && entry.pending === 0) this.#entries.delete(ref)
    }
    collector.registrations.clear()
  }
  beginClaim(): QueueClaimWindow {
    const window = {} as QueueClaimWindow
    this.#claims.set(window, { start: this.#now(), end: null, key: null, attempt: 0,
      readiness: 'unavailable', readyWait: null, emitted: false })
    return window
  }
  claimEnded(window: QueueClaimWindow, key: QueueMilestoneKey, attempt: number): void {
    const state = this.#claims.get(window)
    if (!state || state.key || key.businessId !== this.#options.businessId) return
    state.key = key
    state.attempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 0
    state.end = this.#now()
    if (state.end !== null) this.#purge(state.end)
    const entry = this.#entries.get(key.resourceRef)
    if (!entry || entry.consumed) return
    entry.consumed = true
    if (state.attempt !== 1 || state.start === null || state.end === null) return
    if (entry.readyAt === null || entry.readyAt > state.start) {
      state.readiness = 'overlap_censored'
      return
    }
    state.readiness = 'observed'
    state.readyWait = duration(entry.readyAt, state.start)
  }
  handlerStarted(window: QueueClaimWindow): void {
    const state = this.#claims.get(window)
    if (!state?.key || state.emitted) return
    state.emitted = true
    const end = this.#now()
    const diagnostic: QueueMilestoneDiagnostic = {
      event: 'bot_queue_milestones', resource: state.key.resource, resourceRef: state.key.resourceRef,
      kind: state.key.kind, attempt: state.attempt, readiness: state.readiness,
      readyWaitMs: state.readyWait, claimMs: duration(state.start, state.end), dispatchMs: duration(state.end, end)
    }
    try {
      const pending = this.#options.emit(diagnostic)
      if (pending) void Promise.resolve(pending).catch(() => {})
    } catch { /* Diagnostics never affect handler/delivery. */ }
  }
}
export function createQueueMilestoneTracker(options: Options): QueueMilestoneTracker {
  return new QueueMilestoneTracker(options)
}

/** Called only after a producer statement succeeded and its row counts were checked. */
export function recordProducedQueueResource(tx: object, key: QueueMilestoneKey): void {
  try {
    const collector = collectors.get(tx)
    collector?.tracker.register(collector, key)
  } catch { /* No diagnostic failure may change the producer statement. */ }
}

/** Wrap the existing transaction once; no queries, timestamps from DB, or extra work. */
export async function observeQueueProducerTransaction<T, Tx extends object>(
  tracker: QueueMilestoneTracker | undefined,
  transaction: (body: (tx: Tx) => Promise<T>) => Promise<T>,
  body: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!tracker) return transaction(body)
  const collector: Collector = { tracker, registrations: new Map() }
  try {
    const result = await transaction(async tx => {
      // Do not replace an enclosing collector if a transaction seam reuses TX.
      const previous = collectors.get(tx)
      collectors.set(tx, collector)
      try { return await body(tx) }
      finally {
        if (previous) collectors.set(tx, previous)
        else collectors.delete(tx)
      }
    })
    try { tracker.settle(collector, true) } catch { /* Commit already succeeded. */ }
    return result
  } catch (error) {
    try { tracker.settle(collector, false) } catch { /* Preserve original error. */ }
    throw error
  }
}

/** Lazy keys: off/readonly transactions do not hash source identifiers. */
export function recordProducedJob(tx: object, input: Parameters<typeof jobQueueKey>[0]): void {
  try { if (collectors.has(tx)) recordProducedQueueResource(tx, jobQueueKey(input)) } catch { /* fail-open */ }
}
export function recordProducedOutbox(tx: object, input: Parameters<typeof outboxQueueKey>[0]): void {
  try { if (collectors.has(tx)) recordProducedQueueResource(tx, outboxQueueKey(input)) } catch { /* fail-open */ }
}