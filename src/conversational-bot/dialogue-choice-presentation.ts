import { parseTimePreference } from './time-preference.js'
import { serviceConfigurationKey } from '../bot-options/domain/service-booking.js'
import { serviceGuidance } from './service-guidance.js'
import type { DialogueService, DialogueState } from './engine.js'
import type { ChoicePresentation } from './availability-presentation.js'
import type { ConversationChoiceOperation, ConversationChoicePresentation } from './choices.js'
export const ANY_PROFESSIONAL_OPTION = 'professional:any'
export const preferenceOptionId = (operation: Extract<ConversationChoiceOperation, { kind: 'preference' }>) => 'preference:' + JSON.stringify(parseTimePreference(operation.preference))
/** Canonicalize only valid persisted preference operations, never arbitrary option IDs. */
export function canonicalPreferenceOptionId(id: string): string {
  if (!id.startsWith('preference:')) return id
  try { return preferenceOptionId({ kind: 'preference', preference: parseTimePreference(JSON.parse(id.slice('preference:'.length))) }) }
  catch { return id }
}
export function adaptChoicePresentation(presentation: ChoicePresentation, questionKind: 'slots' | 'professionals' | 'dates', cursor = 0): ConversationChoicePresentation | undefined {
  if (!presentation.choices.length) return undefined
  const choices: { label: string; operation: ConversationChoiceOperation }[] = presentation.choices.map(choice => {
    const operation: ConversationChoiceOperation = choice.kind === 'slot' ? { kind: 'slot', date: choice.slot.date, time: choice.slot.time, startAt: choice.slot.startAt, professionalId: choice.slot.professionalId, ...(choice.slot.coordination ? {coordinationKey:choice.slot.coordination.key} : {}) }
      : choice.kind === 'preference' ? { kind: 'preference', preference: choice.preference }
      : choice.kind === 'date' ? { kind: 'date', date: choice.date }
      : choice.kind === 'professional' ? { kind: 'professional', professionalId: choice.professionalId } : { kind: 'any_professional' }
    return { label: choice.label, operation }
  })
  if (cursor > 0) choices.push({ label: 'Página anterior', operation: { kind: 'page', questionKind, cursor: cursor - 1 } })
  if (presentation.hasMore) choices.push({ label: 'Ver más opciones', operation: { kind: 'page', questionKind, cursor: cursor + 1 } })
  return { kind: presentation.kind === 'slots' ? 'slot' : presentation.kind === 'dates' ? 'date' : presentation.kind === 'professionals' ? 'professional' : 'preference', title: presentation.kind === 'slots' ? 'Horarios disponibles' : presentation.kind === 'dates' ? 'Días disponibles' : presentation.kind === 'professionals' ? 'Profesionales disponibles' : 'Preferencia horaria', choices }
}
export function choiceOptionId(operation: ConversationChoiceOperation): string {
  return operation.kind === 'slot' ? operation.startAt + '/' + operation.professionalId + (operation.coordinationKey ? '/' + operation.coordinationKey : '') : operation.kind === 'date' ? operation.date
    : operation.kind === 'professional' ? operation.professionalId : operation.kind === 'any_professional' ? ANY_PROFESSIONAL_OPTION
    : operation.kind === 'preference' ? preferenceOptionId(operation) : operation.kind === 'service' ? operation.serviceId
    : operation.kind === 'estimate' ? operation.optionId : operation.kind === 'confirm' ? operation.nonce : `page:${operation.questionKind}:${operation.cursor}`
}
/** Converts only freshly generated, finite question options; persisted options alone are never availability. */
export function choicePresentationForQuestion(state: DialogueState, services: readonly DialogueService[]): ConversationChoicePresentation | undefined {
  const question = state.questionContext
  if (!question?.complete || !question.options.length || question.options.length > 10 || !['service', 'professional', 'estimate'].includes(question.role)) return undefined
  const target = question.targetServiceId ? services.find(service => service.id === question.targetServiceId) : undefined
  const guide = target ? serviceGuidance(target) : null
  const choices = question.options.map(option => {
    const operation: ConversationChoiceOperation | null = question.role === 'service' ? { kind: 'service', serviceId: option.id, ...(question.matchTargetMemberId ? { targetMemberId: question.matchTargetMemberId } : {}) }
      : question.role === 'professional' ? option.id === ANY_PROFESSIONAL_OPTION ? { kind: 'any_professional' } : { kind: 'professional', professionalId: option.id }
      : target && guide?.kind === 'guided' ? { kind: 'estimate', serviceId: target.id, optionId: option.id, configurationKey: serviceConfigurationKey(guide.policy) } : null
    return operation ? { label: option.label, operation } : null
  })
  if (choices.some(choice => choice === null)) return undefined
  return { kind: question.role === 'estimate' ? 'estimate' : question.role === 'service' ? 'service' : 'professional', title: question.role === 'estimate' ? 'Opciones para ' + target?.name : question.role === 'service' ? 'Servicios disponibles' : 'Profesionales disponibles', choices: choices.filter(choice => choice !== null) }
}

/** An informational question has its own scope and never selects a booking service. */
export function choicePresentationForInformation(state: DialogueState): ConversationChoicePresentation | undefined {
  const focus = state.informationFocus
  if (!focus?.awaitingChoice || !focus.options.length || focus.options.length > 10) return undefined
  return { kind: 'service', title: focus.aspect === 'price' ? 'Precios por servicio' : 'Información del servicio', choices: focus.options.map(option => ({ label: option.label, operation: { kind: 'service', serviceId: option.id } })) }
}
