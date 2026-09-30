import type { Pool, PoolClient } from 'pg'
import { getAttemptDiagnosticContext, safeAttemptErrorCode } from '../bot-options/observability/attempt-metrics.js'

export type PrismaPoolDiagnostic = {
  event: 'prisma_pool_diagnostic'
  role: 'worker' | 'ingress'
  phase: 'acquire_total' | 'client_query_total'
  durationMs: number
  outcome: 'ok' | 'error'
  errorCode: string | null
  context: NonNullable<ReturnType<typeof getAttemptDiagnosticContext>>
  start: { total: number; idle: number; waiting: number }
  end: { total: number; idle: number; waiting: number }
}
export type PrismaPoolDiagnostics = { role: PrismaPoolDiagnostic['role']; emit: (event: PrismaPoolDiagnostic) => void }
const instrumented = new WeakSet<Pool>()

/** Per-instance hooks only. Acquisition includes cold connection/TLS; query includes DB, wire and locks. */
export function instrumentPrismaPool(pool: Pool, role: PrismaPoolDiagnostic['role'], emit: PrismaPoolDiagnostics['emit']): void {
  if (instrumented.has(pool) || !['worker', 'ingress'].includes(role)) return
  instrumented.add(pool)
  const clients = new WeakSet<PoolClient>()
  const counts = () => {
    try { return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } } catch { return null }
  }
  const measuredCall = (receiver: unknown, original: (...args: unknown[]) => unknown, args: unknown[],
    phase: PrismaPoolDiagnostic['phase'], acquired?: (client: PoolClient) => void): unknown => {
    const context = getAttemptDiagnosticContext()
    const start = context ? counts() : null
    const startedAt = context ? performance.now() : 0
    let finished = false
    const finish = (error: unknown, value?: unknown) => {
      if (finished) return
      finished = true
      try { if (!error && acquired && value) acquired(value as PoolClient) } catch { /* Instrumentation cannot reject an acquired connection. */ }
      const end = context ? counts() : null
      if (!context || !start || !end) return
      try {
        emit({ event: 'prisma_pool_diagnostic', role, phase, durationMs: Math.max(0, performance.now() - startedAt),
          outcome: error ? 'error' : 'ok', errorCode: error ? safeAttemptErrorCode(error) : null, context, start, end })
      } catch { /* Diagnostics never affect acquisition, delivery or release. */ }
    }
    const callback = args.at(-1)
    const forwarded = typeof callback === 'function'
      ? [...args.slice(0, -1), function(this: unknown, ...callbackArgs: unknown[]) {
          finish(callbackArgs[0], callbackArgs[1])
          return Reflect.apply(callback, this, callbackArgs)
        }]
      : args
    try {
      const result = Reflect.apply(original, receiver, forwarded)
      if (typeof callback === 'function') return result
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(value => { finish(null, value); return value },
          error => { finish(error); throw error })
      }
      // Query/submittable overloads retain their object and event semantics; no fake completion span.
      return result
    } catch (error) { finish(error); throw error }
  }
  const wrapClient = (client: PoolClient) => {
    if (clients.has(client)) return
    clients.add(client)
    const query = client.query
    client.query = function(this: PoolClient, ...args: unknown[]) {
      if (!getAttemptDiagnosticContext()) return Reflect.apply(query, this, args)
      return measuredCall(this, query as (...args: unknown[]) => unknown, args, 'client_query_total')
    } as typeof client.query
  }
  const connect = pool.connect
  try { pool.connect = function(this: Pool, ...args: unknown[]) {
    return measuredCall(this, connect as (...args: unknown[]) => unknown, args, 'acquire_total', wrapClient)
  } as typeof pool.connect } catch { instrumented.delete(pool) }
}
