import { isDeepStrictEqual } from 'node:util'
import { createInitialBotOptionsState, parseBotOptionsState, type BotOptionsState, type BotOptionsFlowStep } from '../bot-options/domain/state.js'
import { initialDialogueState, parseDialogueState, hasActiveBooking, type DialogueState } from './engine.js'
import type { ConversationPolicy } from './runtime-policy.js'
import { basketServiceIds } from './service-basket.js'

type ConversationSidecar = { policy: ConversationPolicy; dialogue: DialogueState }
export type ConversationSessionState = BotOptionsState & { conversationDraft: ConversationSidecar }
const flows: Record<DialogueState['pending'], BotOptionsFlowStep> = {
  service: 'SERVICE_SELECT', estimate: 'SERVICE_ESTIMATE', date: 'DATE_SELECT', professional: 'PROFESSIONAL_SELECT', time: 'SLOT_SELECT', name: 'NAME_INPUT', proposal: 'BOOKING_SUMMARY'
}
export function readConversationDraft(value: unknown, policy: ConversationPolicy, timezone: string): DialogueState {
  const parsed = parseBotOptionsState(value)
  if (!parsed.ok) throw new Error('invalid conversational session')
  const sidecar = (value as Partial<ConversationSessionState>).conversationDraft
  if (sidecar === undefined) {
    // Activation is not a migration of a partially completed/financial legacy session.
    if (!isDeepStrictEqual(parsed.state, createInitialBotOptionsState())) throw new Error('legacy session requires explicit reset')
    return initialDialogueState(policy.businessId)
  }
  if (!sidecar || !sidecar.policy || Object.keys(policy).some(key => !isDeepStrictEqual(sidecar.policy[key as keyof ConversationPolicy], policy[key as keyof ConversationPolicy])) || !isDeepStrictEqual(sidecar.policy.serviceContent, policy.serviceContent)) throw new Error('conversation policy changed; reset required')
  return parseDialogueState(sidecar.dialogue, policy.businessId, timezone)
}
export function projectConversationDraft(draft: DialogueState, policy: ConversationPolicy): ConversationSessionState {
  const state = parseDialogueState(draft, policy.businessId)
  const base = createInitialBotOptionsState()
  const historical = !state.bookingReservation && !hasActiveBooking(state) ? state.completedBooking : undefined
  const receipt=state.bookingReservation?.receipt ?? historical?.receipt
  const terms=historical?.presented.terms, first=terms?.segments[0]
  const financial=receipt?.kind==='HELD'?receipt.depositStatus:null
  const booking=financial==='APPROVED'?'CONFIRMED':financial==='PROOF_RECEIVED'?'PENDING_PAYMENT_REVIEW':financial==='EXPIRED'?'EXPIRED':financial==='REJECTED'?'CANCELLED':financial?'HELD':receipt?'CONFIRMED':'DRAFT'
  const deposit=financial==='PENDING_RESUBMISSION'?'REJECTED_RESUBMISSION_ALLOWED':financial==='REJECTED'?'REJECTED_FINAL':financial??'NONE'
  const financialFlow=financial==='APPROVED'?'BOOKING_CONFIRMED':financial==='PROOF_RECEIVED'?'DEPOSIT_REVIEW':financial==='EXPIRED'||financial==='REJECTED'?'APPOINTMENT_DETAIL':financial?'DEPOSIT_INSTRUCTIONS':null
  const projected: ConversationSessionState = { ...base, flow: state.appointmentManagement?.outcome?.kind === 'CANCELLED' ? 'APPOINTMENT_DETAIL' : financialFlow ?? (receipt ? 'BOOKING_CONFIRMED' : flows[state.pending]), booking: state.appointmentManagement?.outcome?.kind === 'CANCELLED' ? 'CANCELLED' : booking, deposit,
    cart: (terms ? terms.segments.map(s=>s.serviceId) : basketServiceIds(state)).map(serviceId => ({ serviceId })), nameCandidate: state.customerName,
    selections: { ...base.selections, professionalId: terms?.preference.kind === 'specific' ? terms.preference.id : state.professional?.kind === 'specific' ? state.professional.id : null,
      anyProfessional: terms ? terms.preference.kind === 'any' : state.professional?.kind === 'any', appointmentId:receipt?.appointments[0]?.appointmentId??null, date: terms?.date ?? state.date, slotStartAt: first?.startAt ?? state.slot?.startAt ?? null,
      provisionalProfessionalId: terms?.preference.kind === 'any' ? first?.professionalId ?? null : state.professional?.kind === 'any' ? state.slot?.professionalId ?? null : null },
    conversationDraft: { policy: { ...policy }, dialogue: state } }
  const parsed = parseBotOptionsState(projected)
  if (!parsed.ok) throw new Error(`invalid conversation projection: ${parsed.invariant}`)
  return projected
}

/** Policy replacement starts clean, but validates old tenant/version before discarding it. */
export function reconcileConversationDraft(value: unknown, policy: ConversationPolicy, timezone: string) {
  const sidecar = (value as Partial<ConversationSessionState> | null)?.conversationDraft
  if (!sidecar) {
    const parsed = parseBotOptionsState(value)
    if (!parsed.ok) throw new Error('invalid legacy session state')
    if (!['NONE', 'DRAFT'].includes(parsed.state.booking) || parsed.state.deposit !== 'NONE' || parsed.state.handoff !== 'NONE') throw new Error('protected legacy session')
    return { draft: initialDialogueState(policy.businessId), reset: !isDeepStrictEqual(parsed.state, createInitialBotOptionsState()) }
  }
  if (!sidecar.policy || sidecar.policy.businessId !== policy.businessId) throw new Error('invalid conversation sidecar tenant')
  const previous = readConversationDraft(value, sidecar.policy, timezone)
  const changed = Object.keys(policy).some(key => !isDeepStrictEqual(sidecar.policy[key as keyof ConversationPolicy], policy[key as keyof ConversationPolicy])) || !isDeepStrictEqual(sidecar.policy.serviceContent, policy.serviceContent)
  if(changed && previous.bookingReservation?.receipt)throw new Error('protected conversation requires financial reconciliation')
  return { draft: changed ? initialDialogueState(policy.businessId) : previous, reset: changed }
}
