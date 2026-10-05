import { parseProfessionalReference } from './communicative-act.js'
import { canonicalPreferenceOptionId } from './dialogue-choice-presentation.js'
import { assign, initialTransition, setup, transition } from 'xstate'
import { basketIsResolved, basketServiceIds, selectionBasket } from './service-basket.js'
import { resolveGuidance } from './service-guidance.js'
import { resolveDialogueDate } from './dialogue-date.js'
import { routeActions } from './actions.js'
import type { DialogueService, DialogueState } from './engine.js'
import type { TurnOperation, TurnPlan } from './turn-plan.js'

export type DialogueField = DialogueState['pending']
export type AnswerRole = 'service' | 'estimate' | 'professional' | 'customer' | 'date' | 'time' | 'confirmation' | 'none'
export type DialogueQuestionOption = { id: string; label: string }
export type DialogueQuestionContext = {
  businessId: string; field: DialogueField; role: AnswerRole; question: string
  scope: string; options: DialogueQuestionOption[]; complete: boolean; targetServiceId: string | null
  matchCandidateIds?: string[]; matchConfigurationKey?: string; matchTargetMemberId?: string
}
type RouteFacts = { service: boolean; estimate: boolean; date: boolean; professional: boolean; time: boolean; name: boolean; required: DialogueField | null }
const questions = {
  service: { role: 'service', question: '¿Qué servicio necesitás?' },
  estimate: { role: 'estimate', question: '¿Qué opción del presupuesto del servicio querés?' },
  date: { role: 'date', question: '¿Para qué día querés el turno?' },
  professional: { role: 'professional', question: '¿Con qué profesional querés atenderte?' },
  time: { role: 'time', question: '¿Qué horario de los disponibles elegís?' },
  name: { role: 'customer', question: '¿A nombre de quién sería el turno?' },
  proposal: { role: 'none', question: 'La propuesta sigue pendiente; todavía no está reservado.' }
} as const
const fields = Object.keys(questions) as DialogueField[]
const machine = setup({
  types: { context: {} as RouteFacts, input: {} as RouteFacts, events: {} as { type: 'RESOLVE'; facts: RouteFacts } }
}).createMachine({
  id: 'dialogue-route', initial: 'service', context: ({ input }) => input,
  on: { RESOLVE: { target: '.routing', actions: assign(({ event }) => event.facts) } },
  states: {
    routing: { always: [
      ...fields.map(field => ({ guard: ({ context }: { context: RouteFacts }) => context.required === field, target: field })),
      { guard: ({ context }) => !context.service, target: 'service' },
      { guard: ({ context }) => context.estimate, target: 'estimate' },
      { guard: ({ context }) => !context.date, target: 'date' },
      { guard: ({ context }) => !context.professional, target: 'professional' },
      { guard: ({ context }) => !context.time, target: 'time' },
      { guard: ({ context }) => !context.name, target: 'name' },
      { target: 'proposal' }
    ] },
    service: { meta: questions.service }, estimate: { meta: questions.estimate }, date: { meta: questions.date },
    professional: { meta: questions.professional }, time: { meta: questions.time }, name: { meta: questions.name }, proposal: { meta: questions.proposal }
  }
})
/** The machine is evaluated purely for each draft, never started or persisted as a second actor. */
function resolveFacts(facts: RouteFacts) {
  const [initial] = initialTransition(machine, facts)
  const [snapshot] = transition(machine, initial, { type: 'RESOLVE', facts })
  const pending = snapshot.value as DialogueField
  return { pending, ...questions[pending] }
}
export function resolveDialogueRoute(state: DialogueState, services: readonly DialogueService[] = [], required: DialogueField | null = null) {
  const selected = basketServiceIds(state).flatMap(id => services.filter(service => service.id === id))
  return resolveFacts({ service: basketIsResolved(state), estimate: selected.length > 0 && !!resolveGuidance(selected, state.serviceEstimates).pending,
    date: !!state.date, professional: !!state.professional, time: !!state.slot, name: !!state.customerName, required: required ?? state.editRequest?.fields[0] ?? null })
}
export function dialogueQuestion(field: DialogueField): string {
  return resolveFacts({ service: false, estimate: false, date: false, professional: false, time: false, name: false, required: field }).question
}
/** Keep the previous scope shape while making professional insertion order irrelevant. */
const scopeOf = (state: DialogueState) => JSON.stringify({ basket: selectionBasket(state).members.map(member => [member.memberId, member.mode, member.serviceIds]), date: state.date,
  ...(state.datePreferences ? { datePreferences: state.datePreferences.map(item => [item.expression, item.value]) } : {}),
  professional: state.professional?.kind === 'specific' ? { kind: 'specific', id: state.professional.id } : state.professional })
function scopeMatches(scope: string, state: DialogueState): boolean {
  try {
    const value: unknown = JSON.parse(scope)
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['basket,date,professional', 'basket,date,datePreferences,professional'].includes(Object.keys(value).sort().join(','))) return false
    const row = value as Record<string, unknown>, professional = row.professional
    let canonicalProfessional: DialogueState['professional'] = null
    if (professional !== null) {
      if (!professional || typeof professional !== 'object' || Array.isArray(professional)) return false
      const choice = professional as Record<string, unknown>, keys = Object.keys(choice).sort().join(',')
      if (choice.kind === 'specific' && keys === 'id,kind' && typeof choice.id === 'string') canonicalProfessional = { kind: 'specific', id: choice.id }
      else if (choice.kind === 'any' && keys === 'kind') canonicalProfessional = { kind: 'any' }
      else return false
    }
    // Arrays retain member order/multiplicity, and every real draft value must still match.
    return JSON.stringify({ basket: row.basket, date: row.date, ...(Object.hasOwn(row, 'datePreferences') ? { datePreferences: row.datePreferences } : {}), professional: canonicalProfessional }) === scopeOf(state)
  } catch { return false }
}
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value)
/** Options describe the last question, not permission or a live availability cache. */
export function rememberDialogueQuestion(state: DialogueState, question: string, options: readonly DialogueQuestionOption[] = [], targetServiceId: string | null = null, matching: { candidateIds: readonly string[]; configurationKey?: string; targetMemberId?: string } | null = null): void {
  if (!validText(question, 240)) { delete state.questionContext; return }
  const route = resolveDialogueRoute(state, [], state.pending)
  let context: DialogueQuestionContext = { businessId: state.businessId, field: state.pending, role: state.pending === 'proposal' && state.sandboxReservation ? 'confirmation' : route.role, question,
    scope: scopeOf(state), options: options.map(option => ({ ...option })), complete: true, targetServiceId,
    ...(matching ? { matchCandidateIds: [...matching.candidateIds], ...(matching.configurationKey ? { matchConfigurationKey: matching.configurationKey } : {}), ...(matching.targetMemberId ? { matchTargetMemberId: matching.targetMemberId } : {}) } : {}) }
  if (options.length > 50 || options.some(option => !validText(option.id, 128) || !validText(option.label, 200)) || new Set(options.map(option => option.id)).size !== options.length || JSON.stringify(context).length > 4096) context = { ...context, options: [], complete: false }
  if (!context.complete) { delete context.matchCandidateIds; delete context.matchConfigurationKey; delete context.matchTargetMemberId }
  delete state.questionContext
  if (JSON.stringify(context).length <= 4096 && JSON.stringify({ ...state, questionContext: context }).length <= 16384) state.questionContext = context
}
export function parseDialogueQuestion(value: unknown, state: DialogueState): DialogueQuestionContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid question context')
  const item = value as DialogueQuestionContext
  if (Object.keys(item).filter(key => !['matchCandidateIds','matchConfigurationKey','matchTargetMemberId'].includes(key)).sort().join(',') !== 'businessId,complete,field,options,question,role,scope,targetServiceId' ||
      JSON.stringify(item).length > 4096 || item.businessId !== state.businessId || !fields.includes(item.field) ||
      item.role !== (item.field === 'proposal' && state.sandboxReservation ? 'confirmation' : questions[item.field].role) || !validText(item.question, 240) || !validText(item.scope, 4096) ||
      typeof item.complete !== 'boolean' || !Array.isArray(item.options) || item.options.length > 50 ||
      !item.complete && item.options.length !== 0 || new Set(item.options.map(option => option?.id)).size !== item.options.length ||
      item.options.some(option => !option || Object.keys(option).sort().join(',') !== 'id,label' || !validText(option.id, 128) || !validText(option.label, 200)) ||
      item.targetServiceId !== null && !validText(item.targetServiceId, 128) ||
      item.field !== 'estimate' && item.targetServiceId !== null) throw new Error('invalid question context')
  if (item.matchCandidateIds !== undefined && (!item.complete || !['service','professional','estimate'].includes(item.field) || !Array.isArray(item.matchCandidateIds) || item.matchCandidateIds.length < 1 || item.matchCandidateIds.length > 10 ||
      new Set(item.matchCandidateIds).size !== item.matchCandidateIds.length || item.matchCandidateIds.some(id => !validText(id, 128) || !item.options.some(option => option.id === id))) ||
      item.matchConfigurationKey !== undefined && (item.field !== 'estimate' || !item.matchCandidateIds || !validText(item.matchConfigurationKey, 6000)) ||
      item.matchTargetMemberId !== undefined && (item.field !== 'service' || !item.matchCandidateIds || !/^m[1-9][0-9]*$/.test(item.matchTargetMemberId))) throw new Error('invalid matching question')
  if (item.field !== state.pending || !scopeMatches(item.scope, state)) return null
  if (item.matchTargetMemberId && !selectionBasket(state).members.some(member => member.memberId === item.matchTargetMemberId)) throw new Error('invalid matching member')
  if (item.targetServiceId !== null && !selectionBasket(state).members.some(member => member.mode === 'single' && member.serviceIds.includes(item.targetServiceId!))) throw new Error('invalid question target')
  const parsed = structuredClone(item)
  if (parsed.role === 'time') {
    parsed.options = parsed.options.map(option => ({ ...option, id: canonicalPreferenceOptionId(option.id) }))
    if (new Set(parsed.options.map(option => option.id)).size !== parsed.options.length) throw new Error('invalid question options')
  }
  return parsed
}
export function expectedDialogueAnswer(state: DialogueState) {
  if (state.professionalReference) {
    const reference = parseProfessionalReference(state.professionalReference, state)
    return { field: 'professional' as const, role: 'professional' as const, question: reference.question, options: [], complete: false, targetServiceId: null }
  }
  if (state.questionContext) { const { matchConfigurationKey: _configuration, ...answer } = state.questionContext; return answer }
  return { field: state.pending, role: state.pending === 'proposal' && state.sandboxReservation && !state.sandboxReservation.receipt ? 'confirmation' : questions[state.pending].role, question: dialogueQuestion(state.pending), options: [], complete: false, targetServiceId: null }
}
export const normalizeAnswer = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export function explicitIdentity(message: string, value: string): boolean {
  const text = normalizeAnswer(message), name = normalizeAnswer(value)
  return new RegExp('(?:^| )(?:soy|me llamo|a nombre de|(?:mi )?nombre(?: del cliente)?(?: es| a)?) ' + name + '(?:$| )').test(text)
}
/** Structural grounding is not enough to authorize interpreting a professional answer as customer identity. */
export function contextualizeIdentity(plan: TurnPlan, state: DialogueState, message: string): { plan: TurnPlan; clarify: boolean } {
  const expected = expectedDialogueAnswer(state)
  let clarify = false
  const operations = plan.operations.flatMap<TurnOperation>(operation => {
    if (operation.kind !== 'name') return [operation]
    if (operation.confidence < 0.85) { clarify = true; return [] }
    const unchangedIdentity = !!state.customerName && normalizeAnswer(operation.value) === normalizeAnswer(state.customerName) && expected.role !== 'professional' && expected.role !== 'estimate'
    const legacyIdentity = !state.customerName && !!state.professional && !state.questionContext && !state.dialogueContext?.lastQuestion &&
      expected.role !== 'professional' && expected.role !== 'estimate' && !(' ' + normalizeAnswer(message) + ' ').includes(' con ' + normalizeAnswer(operation.value) + ' ')
    const initialIdentity = !state.customerName && !state.serviceId && !state.basket?.members.length && !state.date && !state.professional &&
      !state.professionalNameHint && !state.dialogueContext && !state.questionContext && operation.confidence >= 0.85 &&
      (normalizeAnswer(message) === normalizeAnswer(operation.value) || plan.operations.some(op => op.kind === 'basket' || op.kind === 'service')) &&
      !(' ' + normalizeAnswer(message) + ' ').includes(' con ' + normalizeAnswer(operation.value) + ' ') &&
      !plan.operations.some(op => op.kind === 'professional' && op.mode === 'specific' && normalizeAnswer(op.mention) === normalizeAnswer(operation.value))
    if (explicitIdentity(message, operation.value) || expected.role === 'customer' || initialIdentity || unchangedIdentity || legacyIdentity) return [operation]
    if (expected.role === 'professional' && expected.complete && !plan.operations.some(op => op.kind === 'professional')) {
      const options = expected.options.filter(option => normalizeAnswer(option.label) === normalizeAnswer(operation.value))
      if (options.length === 1) return [{ kind: 'professional' as const, mode: 'specific' as const, mention: operation.value, evidence: operation.evidence, confidence: operation.confidence }]
    }
    clarify = true
    return []
  })
  return { plan: { ...plan, operations }, clarify }
}
/** Deterministic fallback only: a mixed sentence cannot become a full customer name. */
export function fallbackIdentity(message: string, state: DialogueState, services: readonly DialogueService[]): string | null {
  const match = /\b(?:soy|me llamo|mi nombre es)\s+([\p{L}][\p{L} '\-]{1,98}?)(?=\s+(?:quiero|turno|hoy|mañana|manana|con)\b|[,;.]|$)/iu.exec(message)
  const candidate = (match?.[1] ?? (state.pending === 'name' ? message.trim() : '')).trim()
  if (!candidate || !/^[\p{L}][\p{L} '\-]*$/u.test(candidate)) return null
  const terms = normalizeAnswer(candidate).split(' ')
  const catalogTerms = new Set(services.flatMap(service => normalizeAnswer(service.name).split(' ').filter(term => term.length >= 3)))
  const hasService = terms.some(term => catalogTerms.has(term))
  const route = routeActions(candidate)
  const mixed = hasService || resolveDialogueDate(candidate, state.date ?? '2000-01-01').kind !== 'unsupported' || route.information.length > 0 || route.pendingAction !== null || /\bcon\s+\p{L}/u.test(normalizeAnswer(candidate))
  if (mixed) return null
  // Bare identities are deliberately conservative; compound names should be explicit or semantic.
  if (!match && terms.length > 1 && candidate.split(/\s+/).some(word => word[0] !== word[0]?.toUpperCase())) return null
  return candidate
}
