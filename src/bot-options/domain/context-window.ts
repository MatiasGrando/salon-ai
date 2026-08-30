import type { BotOptionsState } from './state.js'

export const CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Use durable event time, never processing time or BotSession.updatedAt. */
export function customerActivityAt(input: { admittedAt: Date; providerOccurredAt: Date | null }): Date {
  const received = input.admittedAt.getTime()
  if (!Number.isFinite(received)) throw new Error('invalid customer activity admission time')
  const occurred = input.providerOccurredAt?.getTime()
  return new Date(occurred !== undefined && Number.isFinite(occurred) ? Math.min(occurred, received) : received)
}

export function decideContextWindow(input: {
  state: BotOptionsState
  sessionStatus: string
  touchedAt: Date | null
  expiresAt: Date | null
  activityAt: Date
  isMedia: boolean
}): 'INITIALIZE' | 'RENEW' | 'UNCHANGED' | 'EXPIRE' | 'PROTECTED' {
  if (input.sessionStatus !== 'ACTIVE' || input.state.handoff !== 'NONE' || input.isMedia
    || input.state.booking === 'HELD' || input.state.booking === 'PENDING_PAYMENT_REVIEW'
    || ['PENDING_PROOF', 'PROOF_RECEIVED', 'REJECTED_RESUBMISSION_ALLOWED'].includes(input.state.deposit)) {
    return 'PROTECTED'
  }
  if (!input.touchedAt) return 'INITIALIZE'
  if (input.activityAt.getTime() <= input.touchedAt.getTime()) return 'UNCHANGED'
  const deadline = input.expiresAt?.getTime() ?? input.touchedAt.getTime() + CONTEXT_WINDOW_MS
  return input.activityAt.getTime() >= deadline ? 'EXPIRE' : 'RENEW'
}
