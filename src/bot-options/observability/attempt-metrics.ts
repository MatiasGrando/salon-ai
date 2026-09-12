import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

const STAGES = ['session_context_load', 'session_effects', 'session_persist_view', 'session_critical_transaction', 'transition_execution', 'worker_processing', 'worker_finalize', 'session_claim_validation', 'session_state_lock', 'session_action_load', 'session_recovery_reconcile', 'session_settlement'] as const
export type AttemptStage = typeof STAGES[number]
export type AttemptMetricEvent = {
  event: 'bot_options_attempt_stage'
  jobRef: string
  attempt: number
  stage: AttemptStage | 'attempt'
  durationMs: number
  outcome: 'ok' | 'error'
  errorCode: string | null
}
type Context = { jobRef: string; attempt: number; emit: (event: AttemptMetricEvent) => void }
const storage = new AsyncLocalStorage<Context>()

function safeErrorCode(error: unknown): string {
  // Never stringify exceptions: Prisma messages can include SQL and customer data.
  try {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    return typeof code === 'string' && (/^P\d{4}$/.test(code) || ['40001', '40P01', '57014', '55P03', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(code)) ? code : 'UNKNOWN'
  } catch { return 'UNKNOWN' }
}

async function measure<T>(stage: AttemptMetricEvent['stage'], operation: () => Promise<T>): Promise<T> {
  const context = storage.getStore()
  if (!context) return operation()
  const startedAt = performance.now()
  let outcome: 'ok' | 'error' = 'ok'
  let errorCode: string | null = null
  try { return await operation() } catch (error) {
    outcome = 'error'
    errorCode = safeErrorCode(error)
    throw error
  } finally {
    try {
      context.emit({ event: 'bot_options_attempt_stage', jobRef: context.jobRef, attempt: context.attempt,
        stage, durationMs: Math.max(0, Math.round(performance.now() - startedAt)), outcome, errorCode })
    } catch { /* Observability must never change the processing result. */ }
  }
}

/** Call once per claimed job attempt, outside its database transaction. */
export async function withAttemptMetrics<T>(context: { jobId: string; attempt: number }, operation: () => Promise<T>, options?: { emit?: (event: AttemptMetricEvent) => void }): Promise<T> {
  return storage.run({
    jobRef: createHash('sha256').update(context.jobId).digest('hex').slice(0, 24),
    attempt: Number.isSafeInteger(context.attempt) && context.attempt >= 0 ? context.attempt : 0,
    emit: options?.emit ?? (event => console.info('[bot-options-attempt-stage]', JSON.stringify(event)))
  }, () => measure('attempt', operation))
}

export async function measureAttemptStage<T>(stage: AttemptStage, operation: () => Promise<T>): Promise<T> {
  // Defense against untyped callers introducing free-text metric labels.
  if (!STAGES.includes(stage)) return operation()
  return measure(stage, operation)
}
