import type { BotOptionsFlowStep, BotOptionsState } from './state.js'

export type BotOptionsConversationStep =
  | 'BOOKING_IN_PROGRESS'
  | 'AWAITING_DEPOSIT'
  | 'COMPLETED'
  | 'CANCEL_SELECT_APPOINTMENT'
  | 'EDIT_SELECT_APPOINTMENT'

const BOOKING_FLOWS: ReadonlySet<BotOptionsFlowStep> = new Set([
  'DRAFT_RESUME', 'NAME_INPUT', 'NAME_CONFIRM', 'CATEGORY_SELECT', 'SERVICE_SELECT',
  'SERVICE_DETAIL', 'SERVICE_ESTIMATE', 'SERVICE_VALIDATION', 'SERVICE_PHOTOS',
  'RECOMMENDATION_SELECT', 'CART_REVIEW', 'INCOMPATIBLE_SERVICE_DECISION',
  'PROFESSIONAL_SELECT', 'DATE_SELECT', 'SLOT_SELECT', 'BOOKING_SUMMARY', 'DISCARD_CONFIRM'
])

const DEPOSIT_FLOWS: ReadonlySet<BotOptionsFlowStep> = new Set([
  'DEPOSIT_INSTRUCTIONS', 'DEPOSIT_CANCEL_CONFIRM', 'DEPOSIT_REVIEW'
])

const RESCHEDULE_FLOWS: ReadonlySet<BotOptionsFlowStep> = new Set([
  'APPOINTMENT_RESCHEDULE_DATE', 'APPOINTMENT_RESCHEDULE_SLOT', 'APPOINTMENT_RESCHEDULE_SUMMARY'
])

/** Proyección operativa del bot de opciones para el CRM, no su estado interno detallado. */
export function conversationStepForBotOptionsState(state: BotOptionsState): BotOptionsConversationStep | null {
  if (state.handoff !== 'NONE') return null
  if (
    DEPOSIT_FLOWS.has(state.flow) || state.booking === 'HELD' || state.booking === 'PENDING_PAYMENT_REVIEW' ||
    ['PENDING_PROOF', 'PROOF_RECEIVED', 'REJECTED_RESUBMISSION_ALLOWED'].includes(state.deposit)
  ) return 'AWAITING_DEPOSIT'
  if (state.flow === 'BOOKING_CONFIRMED' || state.booking === 'CONFIRMED') return 'COMPLETED'
  if (state.flow === 'APPOINTMENT_CANCEL_CONFIRM') return 'CANCEL_SELECT_APPOINTMENT'
  if (RESCHEDULE_FLOWS.has(state.flow)) return 'EDIT_SELECT_APPOINTMENT'
  if (state.catalogMode === 'BOOKING' && BOOKING_FLOWS.has(state.flow)) return 'BOOKING_IN_PROGRESS'
  return null
}
