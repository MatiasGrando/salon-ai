import { createInitialBotOptionsState, parseBotOptionsState, type BotOptionsState, type BotOptionsFlowStep } from '../bot-options/domain/state.js'
import { initialDialogueState, parseDialogueState, type DialogueState } from './engine.js'
import type { ConversationPolicy } from './runtime-policy.js'

type ConversationSidecar = { policy: ConversationPolicy; dialogue: DialogueState }
export type ConversationSessionState = BotOptionsState & { conversationDraft: ConversationSidecar }
const flows: Record<DialogueState['pending'], BotOptionsFlowStep> = {
  service: 'SERVICE_SELECT', date: 'DATE_SELECT', professional: 'PROFESSIONAL_SELECT', time: 'SLOT_SELECT', name: 'NAME_INPUT', proposal: 'BOOKING_SUMMARY'
}
export function readConversationDraft(value: unknown, policy: ConversationPolicy, timezone: string): DialogueState {
  const parsed = parseBotOptionsState(value)
  if (!parsed.ok) throw new Error('invalid conversational session')
  const sidecar = (value as Partial<ConversationSessionState>).conversationDraft
  if (sidecar === undefined) {
    // Activation is not a migration of a partially completed/financial legacy session.
    if (JSON.stringify(parsed.state) !== JSON.stringify(createInitialBotOptionsState())) throw new Error('legacy session requires explicit reset')
    return initialDialogueState(policy.businessId)
  }
  if (!sidecar || !sidecar.policy || Object.keys(policy).some(key => sidecar.policy[key as keyof ConversationPolicy] !== policy[key as keyof ConversationPolicy])) throw new Error('conversation policy changed; reset required')
  return parseDialogueState(sidecar.dialogue, policy.businessId, timezone)
}
export function projectConversationDraft(draft: DialogueState, policy: ConversationPolicy): ConversationSessionState {
  const state = parseDialogueState(draft, policy.businessId)
  const base = createInitialBotOptionsState()
  const projected: ConversationSessionState = { ...base, flow: flows[state.pending], booking: 'DRAFT',
    cart: state.serviceId ? [{ serviceId: state.serviceId }] : [], nameCandidate: state.customerName,
    selections: { ...base.selections, professionalId: state.professional?.kind === 'specific' ? state.professional.id : null,
      anyProfessional: state.professional?.kind === 'any', date: state.date, slotStartAt: state.slot?.startAt ?? null,
      provisionalProfessionalId: state.professional?.kind === 'any' ? state.slot?.professionalId ?? null : null },
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
    return { draft: initialDialogueState(policy.businessId), reset: JSON.stringify(parsed.state) !== JSON.stringify(createInitialBotOptionsState()) }
  }
  if (!sidecar.policy || sidecar.policy.businessId !== policy.businessId) throw new Error('invalid conversation sidecar tenant')
  const previous = readConversationDraft(value, sidecar.policy, timezone)
  const changed = Object.keys(policy).some(key => sidecar.policy[key as keyof ConversationPolicy] !== policy[key as keyof ConversationPolicy])
  return { draft: changed ? initialDialogueState(policy.businessId) : previous, reset: changed }
}
