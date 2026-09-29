import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

const STAGES = ['session_context_load', 'session_effects', 'session_persist_view', 'session_critical_transaction', 'transition_execution', 'worker_processing', 'worker_finalize', 'session_claim_validation', 'session_state_lock', 'session_action_load', 'session_recovery_reconcile', 'session_settlement',
  // Repository durations include projection; nested stages overlap and must not be summed.
  'catalog_list_categories', 'catalog_get_category', 'catalog_list_services', 'catalog_get_subcategory', 'catalog_get_service',
  'hours_weekly', 'hours_exceptions',
  // Conversation helpers and SQL awaits are inclusive; SQL labels include driver/network wait.
  'conversation_policy_load', 'conversation_target_read', 'conversation_dispatch_acquire', 'conversation_dispatch_release',
  'conversation_claim_assert', 'conversation_dispatch_assert', 'conversation_feature_lock', 'conversation_inbox_lock',
  'conversation_order_read', 'conversation_conversation_upsert', 'conversation_session_lock', 'conversation_inbound_project',
  'conversation_context_window', 'conversation_session_create', 'conversation_inbox_attach', 'conversation_generation_reset',
  'conversation_transition_insert', 'conversation_context_load', 'conversation_catalog_load', 'conversation_compute',
  'conversation_session_save', 'conversation_step_project', 'conversation_view_persist', 'conversation_inbox_settle',
  'conversation_event_settle', 'conversation_dispatch_complete', 'conversation_job_complete', 'conversation_job_reschedule',
  'conversation_snapshot_transaction_start_wait', 'conversation_snapshot_transaction_body', 'conversation_snapshot_transaction_tail', 'conversation_snapshot_transaction_total',
  'conversation_final_transaction_start_wait', 'conversation_final_transaction_body', 'conversation_final_transaction_tail', 'conversation_final_transaction_total',
  'availability_settings', 'availability_compatible_professionals', 'availability_search'
] as const
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

const TRANSACTION_STAGES = {
  conversation_snapshot: ['conversation_snapshot_transaction_start_wait', 'conversation_snapshot_transaction_body', 'conversation_snapshot_transaction_tail', 'conversation_snapshot_transaction_total'],
  conversation_final: ['conversation_final_transaction_start_wait', 'conversation_final_transaction_body', 'conversation_final_transaction_tail', 'conversation_final_transaction_total']
} as const satisfies Record<string, readonly AttemptStage[]>

/**
 * Total includes all subspans. Start wait is connection/pool + BEGIN, not pure pool time;
 * tail is settlement after callback exit (commit/rollback/network). Never sum with SQL/helper spans.
 * A failed BEGIN emits wait + total only: the callback and tail never ran.
 */
export async function measureAttemptTransaction<T, Tx>(
  stage: keyof typeof TRANSACTION_STAGES,
  transaction: (body: (tx: Tx) => Promise<T>) => Promise<T>,
  body: (tx: Tx) => Promise<T>
): Promise<T> {
  const context = storage.getStore()
  if (!context || !Object.hasOwn(TRANSACTION_STAGES, stage)) return transaction(body)
  const labels = TRANSACTION_STAGES[stage]
  const [waitStage, bodyStage, tailStage, totalStage] = labels
  const startedAt = performance.now()
  let entered = false
  let exitedAt: number | null = null
  let outcome: 'ok' | 'error' = 'ok'
  let failure: unknown
  const emit = (label: AttemptStage, since: number) => {
    try {
      context.emit({ event: 'bot_options_attempt_stage', jobRef: context.jobRef, attempt: context.attempt,
        stage: label, durationMs: Math.max(0, Math.round(performance.now() - since)), outcome,
        errorCode: outcome === 'error' ? safeErrorCode(failure) : null })
    } catch { /* Metrics cannot change transaction settlement or the original exception. */ }
  }
  return measure(totalStage, async () => {
    try {
      return await transaction(async tx => {
        entered = true
        emit(waitStage, startedAt)
        try { return await measure(bodyStage, () => body(tx)) }
        finally { exitedAt = performance.now() }
      })
    } catch (error) { outcome = 'error'; failure = error; throw error }
    finally {
      if (!entered) emit(waitStage, startedAt)
      else if (exitedAt !== null) emit(tailStage, exitedAt)
    }
  })
}
