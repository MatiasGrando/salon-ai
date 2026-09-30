/** Memory is disposable: callers provide a fresh durable stamp and consistent snapshot loader. */
export type PublicCacheDiagnostics = { hits: number; misses: number; bypasses: number; stampReads: number; stampMs: number; loadMs: number }
type Entry = { stamp: string; expiresAt: number; value?: unknown; flight?: Promise<unknown> }
type Request<T> = { key: string; stamp: string; readStamp(): Promise<string>; load(): Promise<T>;
  loadSnapshot?(): Promise<{ stamp: string; value: T }>; diagnostics?: PublicCacheDiagnostics }
export class PublicDataCache {
  readonly #entries = new Map<string, Entry>()
  readonly #maxEntries: number
  readonly #ttlMs: number
  readonly #now: () => number
  #active = 0
  constructor(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
    this.#maxEntries = options.maxEntries ?? 128
    this.#ttlMs = options.ttlMs ?? 300_000
    this.#now = options.now ?? Date.now
    if (!Number.isInteger(this.#maxEntries) || this.#maxEntries < 1 || !Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0) throw new Error('invalid public cache limits')
  }
  async read<T>(request: Request<T>, retry = 0): Promise<T> {
    const entry = this.#entries.get(request.key)
    if (entry?.stamp === request.stamp && (entry.flight || entry.expiresAt > this.#now())) {
      this.#entries.delete(request.key); this.#entries.set(request.key, entry)
      if (request.diagnostics) request.diagnostics.hits++
      return structuredClone(entry.flight ? await entry.flight : entry.value) as T
    }
    const cacheable = this.#active < 32
    if (request.diagnostics) { request.diagnostics.misses++; if (!cacheable) request.diagnostics.bypasses++ }
    const next: Entry = { stamp: request.stamp, expiresAt: 0 }
    if (cacheable) {
      this.#entries.delete(request.key); this.#entries.set(request.key, next)
      while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value!)
      this.#active++
    }
    next.flight = (async () => {
      const started = performance.now()
      let loaded: { stamp: string; value: T }
      try { loaded = request.loadSnapshot ? await request.loadSnapshot() : { stamp: request.stamp, value: await request.load() } }
      finally { if (request.diagnostics) request.diagnostics.loadMs += performance.now() - started }
      const value = structuredClone(loaded.value)
      const after = await request.readStamp()
      if (after !== loaded.stamp) {
        if (this.#entries.get(request.key) === next) this.#entries.delete(request.key)
        if (retry >= 2) throw new Error('public source changed repeatedly during load')
        return this.read({ ...request, stamp: after }, retry + 1)
      }
      if (cacheable && this.#entries.get(request.key) === next) {
        next.stamp = loaded.stamp; next.value = value; next.expiresAt = this.#now() + this.#ttlMs
      }
      return value
    })()
    try { return structuredClone(await next.flight) as T }
    catch (error) { if (this.#entries.get(request.key) === next) this.#entries.delete(request.key); throw error }
    finally { if (cacheable) this.#active--; delete next.flight }
  }
}
const caches = new WeakMap<object, PublicDataCache>()
export function publicCacheFor(client: object): PublicDataCache {
  let cache = caches.get(client)
  if (!cache) { cache = new PublicDataCache(); caches.set(client, cache) }
  return cache
}