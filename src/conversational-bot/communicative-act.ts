import { dateExpressionCoversCurrentEvidence } from './date-preference.js'
import { choiceDraftFingerprint } from './choices.js'
import { preferenceOptionId } from './dialogue-choice-presentation.js'
import { serviceGuidance } from './service-guidance.js'
import { isCustomerText } from './customer-text.js'
import { matchPresentedServiceAnswer } from './contextual-matching.js'
import { applyBasketMutation, selectionBasket } from './service-basket.js'
import { TurnPlanValidationError, type TurnOperation, type TurnPlan } from './turn-plan.js'
import type { DialogueService, DialogueState } from './engine.js'

export const COMMUNICATIVE_FIELDS = ['service', 'professional', 'date', 'time', 'name', 'estimate', 'general'] as const
export type CommunicativeField = typeof COMMUNICATIVE_FIELDS[number]
const kinds = ['request', 'change', 'answer', 'inquiry', 'reference', 'uncertain', 'notice', 'pause', 'repair'] as const
export type CommunicativeAct = {
  kind: typeof kinds[number]; field: CommunicativeField; evidence: string; confidence: number
  mention: string | null; operationIndexes: number[]
}
export type CommunicativeActs = { version: 1; acts: CommunicativeAct[] }
export type ProfessionalReference = { businessId: string; mention: string; evidence: string; scope: string; question: string }
export type InquiryBinding = { requestOperationIndex: number; informationOperationIndex: number }
export type CommunicativeAdmission = {
  plan: TurnPlan; blockedFields: CommunicativeField[]
  /** Server-only links between two reads admitted from the same current inquiry. */
  inquiryBindings?: readonly InquiryBinding[]
  /** Server-only current temporal authority; never a model or persisted claim. */
  timeMeaningRejected?: true
  reference?: { mention: string; evidence: string }
  /** Ephemeral server admission, never a model flag or persisted booking action. */
  continuity?: 'notice' | 'pause' | 'repair'
}
const fieldsSchema = {
  kind: { type: 'string', enum: kinds }, field: { type: 'string', enum: COMMUNICATIVE_FIELDS },
  evidence: { type: 'string', minLength: 1, maxLength: 300 },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  mention: { type: ['string', 'null'], minLength: 1, maxLength: 100 },
  operationIndexes: { type: 'array', maxItems: 12, items: { type: 'integer', minimum: 0, maximum: 11 } }
}
export const COMMUNICATIVE_ACTS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['version', 'acts'],
  properties: { version: { type: 'integer', enum: [1] }, acts: { type: 'array', maxItems: 12,
    items: { type: 'object', additionalProperties: false, required: Object.keys(fieldsSchema), properties: fieldsSchema } } }
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contains = (text: string, evidence: string) => (' ' + normalized(text) + ' ').includes(' ' + normalized(evidence) + ' ')
const plain = (value: unknown, max: number): value is string => isCustomerText(value, max) && !/[\u0000-\u001f]/.test(value)
function fail(cause: 'shape' | 'evidence' | 'conflict'): never { throw new TurnPlanValidationError(cause, 'invalid communicative acts') }
/** Case-only tolerance is a literal, uniquely located span, never identity normalization. */
function anchoredMention(evidence: string, mention: string): string | null {
  if (evidence.includes(mention)) return mention
  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escaped, 'giu')
  const first = pattern.exec(evidence)
  if (!first) return null
  // Include overlapping candidates without starting inside a Unicode code point.
  pattern.lastIndex = first.index + (evidence.codePointAt(first.index)! > 0xffff ? 2 : 1)
  if (pattern.exec(evidence)) return null
  return evidence.slice(first.index, first.index + first[0].length)
}
/** Validate claims against the original utterance/operation positions, before any filtering. */
export function parseCommunicativeActs(value: unknown, message: string, operationCount: number, source?: TurnPlan): CommunicativeActs | null {
  if (value === undefined || value === null) return null
  if (!record(value) || Object.keys(value).sort().join(',') !== 'acts,version' || value.version !== 1 ||
      !Array.isArray(value.acts) || value.acts.length > 12 || JSON.stringify(value).length > 8000) fail('shape')
  if (source && source.operations.length !== operationCount) fail('conflict')
  const anchored: (string | null)[] = []
  const owned = new Set<number>()
  for (const raw of (value as Record<string, unknown>).acts as unknown[]) {
    if (!record(raw) || Object.keys(raw).sort().join(',') !== 'confidence,evidence,field,kind,mention,operationIndexes' ||
        !kinds.includes(raw.kind as CommunicativeAct['kind']) || !COMMUNICATIVE_FIELDS.includes(raw.field as CommunicativeField) ||
        typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 ||
        !Array.isArray(raw.operationIndexes) || raw.operationIndexes.length > 12 ||
        !(raw.mention === null || plain(raw.mention, 100))) fail('shape')
    if (!isCustomerText(raw.evidence, 300) || !message.includes(raw.evidence)) fail('evidence')
    const mention = raw.mention === null ? null : anchoredMention(raw.evidence, raw.mention as string)
    if (raw.mention !== null && mention === null) fail('evidence')
    anchored.push(mention)
    const local = new Set<number>()
    for (const index of raw.operationIndexes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= operationCount || local.has(index) ||
          owned.has(index) && source?.operations[index]?.kind !== 'basket') fail('conflict')
      local.add(index); owned.add(index)
    }
  }
  const result = structuredClone(value) as unknown as CommunicativeActs
  result.acts.forEach((act, index) => { act.mention = anchored[index]! })
  return result
}
function operationKey(operation: TurnOperation): string {
  if (operation.kind === 'information') return 'information:' + operation.target.kind
  if (['basket', 'service', 'service_request'].includes(operation.kind)) return 'service'
  if (['time', 'time_preference', 'time_clarification'].includes(operation.kind)) return 'time'
  if (operation.kind === 'professional_reference') return 'professional'
  if (operation.kind === 'date_preferences') return 'date'
  return operation.kind
}
/** Known server projection changes representation, not the original speech act. */
function sourceOperationIndex(operation: TurnOperation, source: TurnPlan): number {
  const direct = source.operations.findIndex(item => {
    // The parser permits one estimate per service and one change per field.
    // Preserve those identities rather than assigning a later operation the first act.
    if (operation.kind === 'estimate') return item.kind === 'estimate' && item.serviceId === operation.serviceId
    if (operation.kind === 'request_change') return item.kind === 'request_change' && item.field === operation.field
    return operationKey(item) === operationKey(operation)
  })
  if (direct >= 0) return direct
  if (operation.kind !== 'information' || operation.target.kind !== 'service' || operation.target.aspect !== 'price' ||
      operation.target.serviceIds.length !== 1 || operation.target.estimateOptionId == null) return -1
  const target = operation.target
  const matches = source.operations.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'estimate' &&
    item.serviceId === target.serviceIds[0] && item.optionId === target.estimateOptionId &&
    item.evidence === operation.evidence && item.confidence === operation.confidence)
  return matches.length === 1 ? matches[0]!.index : -1
}
function unresolvedInquiry(operation: TurnOperation | undefined): boolean {
  return operation?.kind === 'service_request' && operation.purpose === 'inquiry' &&
    operation.disposition !== 'clear' && operation.confidence >= .85
}
function emptyServiceRead(operation: TurnOperation | undefined): boolean {
  return operation?.kind === 'information' && operation.target.kind === 'service' &&
    operation.target.serviceIds.length === 0 && operation.target.estimateOptionId === undefined && operation.confidence >= .85
}
/** Derive only after the final server projection; old state never creates read ownership. */
export function deriveInquiryBindings(metadata: CommunicativeActs | null, source: TurnPlan, final: TurnPlan): InquiryBinding[] {
  if (!metadata) return []
  const bindings: InquiryBinding[] = []
  final.operations.forEach((request, requestOperationIndex) => {
    if (!unresolvedInquiry(request)) return
    const requestSourceIndex = sourceOperationIndex(request, source)
    final.operations.forEach((information, informationOperationIndex) => {
      if (!emptyServiceRead(information)) return
      const informationSourceIndex = sourceOperationIndex(information, source)
      if (requestSourceIndex < 0 || informationSourceIndex < 0) return
      const act = metadata.acts.find(item => item.kind === 'inquiry' && item.field === 'service' && item.confidence >= .85 &&
        item.operationIndexes.includes(requestSourceIndex) && item.operationIndexes.includes(informationSourceIndex) &&
        contains(item.evidence, request.evidence) && contains(item.evidence, information.evidence))
      if (act) bindings.push({ requestOperationIndex, informationOperationIndex })
    })
  })
  return bindings
}
/** Structural remapping rejects corrupt metadata and follows cloned/filter-projected operations. */
export function remapInquiryBindings(bindings: readonly InquiryBinding[], source: TurnPlan, final: TurnPlan): InquiryBinding[] {
  const result: InquiryBinding[] = []
  for (const binding of bindings) {
    if (!Number.isSafeInteger(binding.requestOperationIndex) || !Number.isSafeInteger(binding.informationOperationIndex)) continue
    const request = source.operations[binding.requestOperationIndex], information = source.operations[binding.informationOperationIndex]
    if (!unresolvedInquiry(request) || !emptyServiceRead(information)) continue
    const locate = (operation: TurnOperation | undefined) => final.operations.findIndex(item => JSON.stringify(item) === JSON.stringify(operation))
    const requestOperationIndex = locate(request), informationOperationIndex = locate(information)
    if (requestOperationIndex >= 0 && informationOperationIndex >= 0) result.push({ requestOperationIndex, informationOperationIndex })
  }
  return result
}
function fieldOf(operation: TurnOperation): CommunicativeField {
  if (operation.kind === 'information') return operation.target.kind === 'service' ? 'service' : operation.target.kind === 'professional' ? 'professional' : 'general'
  if (operation.kind === 'request_change') return operation.field
  const key = operationKey(operation)
  return COMMUNICATIVE_FIELDS.includes(key as CommunicativeField) ? key as CommunicativeField : 'general'
}
function closedAnswer(operation: TurnOperation, message: string, state: DialogueState, services: readonly DialogueService[]): boolean {
  if (state.professionalReference) return false
  const question = state.questionContext
  if (!question?.complete || question.field !== state.pending) return false
  const label = normalized(message)
  let option = question.options.find(item => normalized(item.label) === label)
  if (!option && question.role === 'service') {
    // The existing closed-choice matcher accepts a unique short label, not a mention
    // embedded in a historical clause; every displayed ID/label must still be current.
    const currentOptions = question.options.filter(item => services.some(service => service.id === item.id && normalized(service.name) === normalized(item.label)))
    if (currentOptions.length !== question.options.length) return false
    const matched = matchPresentedServiceAnswer({ businessId: state.businessId, category: 'service' }, message,
      currentOptions.map(item => ({ businessId: state.businessId, category: 'service', id: item.id, label: item.label })))
    if (matched.kind === 'exact' && matched.complete && matched.items.length === 1) option = currentOptions.find(item => item.id === matched.items[0]!.id)
  }
  if (!option) return false
  if (operation.kind === 'basket') {
    const basket = selectionBasket(state)
    const groups = basket.members.filter(member => (!question.matchTargetMemberId || member.memberId === question.matchTargetMemberId) &&
      (member.mode === 'alternatives' && question.options.every(item => member.serviceIds.includes(item.id)) ||
        member.mode === 'unresolved' && member.memberId === question.matchTargetMemberId))
    const target = groups.length === 1 ? groups[0]!.memberId : null
    return operation.members.length === 1 && operation.members[0]?.mode === 'single' && operation.members[0].serviceIds[0] === option.id &&
      question.role === 'service' && services.some(item => item.id === option.id) && !!target &&
      (operation.scope === 'all' ? basket.members.length === 1 && operation.mutation === 'set' || basket.members.length === 1 && operation.mutation === 'replace'
        : operation.mutation === 'replace' && operation.targetMemberIds.length === 1 && operation.targetMemberIds[0] === target)
  }
  if (operation.kind === 'professional') return question.role === 'professional' && operation.mode === 'specific' && normalized(operation.mention) === label
  if (operation.kind === 'name' && question.role === 'professional') return normalized(operation.value) === label
  if (operation.kind === 'service') return question.role === 'service' && operation.mode === 'single' && operation.serviceIds[0] === option.id
  if (operation.kind === 'date') return question.role === 'date' && operation.value === option.id
  if (operation.kind === 'time') {
    const times = option.label.match(/(?:[01]\d|2[0-3]):[0-5]\d/g) ?? []
    return question.role === 'time' && times.length === 1 && times[0] === operation.value && !!state.date && option.id.startsWith(state.date + 'T')
  }
  if (operation.kind === 'time_preference') return question.role === 'time' && preferenceOptionId({ kind: 'preference', preference: operation.preference }) === option.id
  if (operation.kind === 'estimate') {
    const service = services.find(item => item.id === question.targetServiceId), guide = service ? serviceGuidance(service) : null
    return question.role === 'estimate' && operation.serviceId === question.targetServiceId && operation.optionId === option.id &&
      guide?.kind === 'guided' && !!guide.policy.estimateOptions?.some(item => item.id === option.id && normalized(item.label) === normalized(option.label))
  }
  return operation.kind === 'name' && question.role === 'customer' && normalized(operation.value) === label
}
function changesExisting(operation: TurnOperation, state: DialogueState): boolean {
  if (['basket', 'service'].includes(operation.kind)) return selectionBasket(state).members.length > 0
  if (operation.kind === 'service_request') return operation.purpose === 'booking' && selectionBasket(state).members.length > 0
  if (operation.kind === 'professional' || operation.kind === 'professional_reference') return true
  if (operation.kind === 'date_preferences') return !!(state.date || state.datePreferences)
  if (operation.kind === 'date') return !!state.datePreferences || !!state.date && operation.value !== state.date
  if (['time', 'time_preference', 'time_clarification'].includes(operation.kind)) return !!(state.slot || state.requestedTime || state.timePreference || state.timeClarification)
  if (operation.kind === 'name') return !!state.customerName && normalized(state.customerName) !== normalized(operation.value)
  if (operation.kind === 'estimate') return Object.hasOwn(state.serviceEstimates ?? {}, operation.serviceId)
  return false
}
function duplicateError(error: unknown): boolean {
  return error instanceof Error && error.message === 'invalid basket: duplicate or invalid service'
}
/** A current-catalog no-op is safe without granting any new selection or destroying a peer. */
function repeatedAdd(operation: TurnOperation, state: DialogueState): boolean {
  return operation.kind === 'basket' && operation.mutation === 'add' && operation.members.every(member =>
    member.mode === 'single' && selectionBasket(state).members.some(old => old.mode === 'single' && old.serviceIds[0] === member.serviceIds[0]))
}
/** Every owner must support the same current mutation; union coverage is not partial consent. */
function sharedBasketAuthority(owners: readonly CommunicativeAct[], operation: TurnOperation | undefined,
  message: string, state: DialogueState, services: readonly DialogueService[]): boolean {
  if (operation?.kind !== 'basket' || operation.members.length === 0) return false
  const kind = owners[0]?.kind
  if (!kind || !['request', 'change', 'answer'].includes(kind) || owners.some(owner =>
      owner.kind !== kind || owner.field !== 'service' || owner.confidence < .85)) return false
  const current = selectionBasket(state)
  if (operation.targetMemberIds.some(id => !current.members.some(member => member.memberId === id))) return false
  const legitimate = kind === 'request'
    ? operation.mutation === 'set' && current.members.length === 0 || operation.mutation === 'add'
    : kind === 'change' ? current.members.length > 0 && ['set', 'replace'].includes(operation.mutation)
      : closedAnswer(operation, message, state, services)
  if (!legitimate) return false
  const coverage = owners.map(owner => operation.members.map(member => contains(owner.evidence, member.evidence)))
  return coverage.every(members => members.some(Boolean)) && operation.members.every((_member, index) => coverage.some(members => members[index]))
}
/** Typed/evidence/catalog validation precedes this semantic admission; no unsafe candidate rescue. */
export function admitCommunicativePlan(metadata: CommunicativeActs | null, source: TurnPlan, plan: TurnPlan,
  message: string, state: DialogueState, services: readonly DialogueService[], businessDate?: string, serverBlockedFields: readonly CommunicativeField[] = []): CommunicativeAdmission {
  const blocked = new Set<CommunicativeField>()
  let timeMeaningRejected = false
  const reference = metadata?.acts.find(act => act.kind === 'reference' && act.field === 'professional' && act.confidence >= .85 && act.mention !== null)
  const admitted = plan.operations.filter(operation => {
    const index = sourceOperationIndex(operation, source)
    const original = source.operations[index]
    const field = fieldOf(original ?? operation)
    const owners = metadata?.acts.filter(item => item.operationIndexes.includes(index)) ?? []
    const act = owners[0]
    if (serverBlockedFields.includes(field)) {
      blocked.add(field)
      if (field === 'time' && act?.field === field && ['request', 'change', 'answer'].includes(act.kind) &&
          act.confidence >= .85 && operation.confidence >= .85 && contains(act.evidence, operation.evidence)) timeMeaningRejected = true
      return false
    }
    // Preserve already selected exact identities before generic grounding can widen them.
    if (repeatedAdd(operation, state)) return false

    if (!metadata) {
      if (changesExisting(operation, state) && !closedAnswer(operation, message, state, services)) { blocked.add(field); return false }
      return true
    }
    if (owners.length > 1) {
      if (!sharedBasketAuthority(owners, original, message, state, services)) { blocked.add(field); return false }
      return true
    }
    const read = original?.kind === 'information' || original?.kind === 'unsupported_action' ||
      original?.kind === 'service_request' && original.purpose === 'inquiry'
    const sameField = act?.field === field
    const current = act && ['request', 'change', 'answer'].includes(act.kind)
    const appropriate = read ? act && ['request', 'change', 'answer', 'inquiry'].includes(act.kind) : current
    if (!act || !sameField || !appropriate || act.confidence < .85 || !contains(act.evidence, operation.evidence)) {
      blocked.add(field); return false
    }
    if (operation.kind === 'date' && businessDate && !dateExpressionCoversCurrentEvidence(operation.expression, act.evidence, businessDate)) {
      blocked.add('date'); return false
    }
    if (operation.kind === 'professional_reference' && (act.kind !== 'answer' || !state.professionalReference ||
        act.evidence !== message || operation.evidence !== message)) { blocked.add(field); return false }
    if (operation.kind === 'professional' && operation.mode === 'specific' && act.mention !== operation.mention) { blocked.add(field); return false }
    return true
  })
  const continuityActs = metadata?.acts.filter(act => ['notice', 'pause', 'repair'].includes(act.kind) &&
    act.field === 'general' && act.confidence >= .85 && act.operationIndexes.length === 0) ?? []
  // Only an unambiguous nonoperative current turn can suspend progression. An
  // independently proposed request/inquiry (even empty) still owns its usual route.
  const distinct = [...new Set(continuityActs.map(act => act.kind))]
  const continuity = source.operations.length === 0 && admitted.length === 0 && blocked.size === 0 && !reference && distinct.length === 1 &&
    !metadata?.acts.some(act => ['request', 'change', 'answer', 'inquiry', 'uncertain'].includes(act.kind))
    ? distinct[0] as NonNullable<CommunicativeAdmission['continuity']> : undefined
  return { plan: { ...plan, operations: admitted }, blockedFields: [...blocked],
    ...(timeMeaningRejected ? { timeMeaningRejected: true as const } : {}),
    ...(continuity ? { continuity } : {}),
    ...(reference?.mention ? { reference: { mention: reference.mention, evidence: reference.evidence } } : {}) }
}
/** Validate composition on a copy after each transformation; only a known overlap is a semantic conflict. */
export function protectProspectiveBasket(admission: CommunicativeAdmission, state: DialogueState): CommunicativeAdmission {
  const operation = admission.plan.operations.find(item => item.kind === 'basket')
  if (!operation || operation.kind !== 'basket') return admission
  try { applyBasketMutation(selectionBasket(state), operation); return admission }
  catch (error) {
    if (!duplicateError(error)) throw error
    return { ...admission, plan: { ...admission.plan, operations: admission.plan.operations.filter(item => item !== operation) },
      blockedFields: [...new Set([...admission.blockedFields, 'service' as const])] }
  }
}
export function professionalReferenceScope(state: DialogueState): string {
  return choiceDraftFingerprint({ businessId: state.businessId, basket: selectionBasket(state).members.map(member => [member.memberId, member.mode, member.serviceIds]),
    estimates: state.serviceEstimates ?? {}, date: state.date,
    ...(state.datePreferences ? { datePreferences: state.datePreferences.map(item => [item.expression, item.value]) } : {}), professional: state.professional, hint: state.professionalNameHint,
    time: state.requestedTime, preference: state.timePreference ?? null, clarification: state.timeClarification ?? null,
    slot: state.slot, name: state.customerName })
}
export function createProfessionalReference(state: DialogueState, mention: string, evidence: string): ProfessionalReference {
  return { businessId: state.businessId, mention, evidence, scope: professionalReferenceScope(state),
    question: '¿Querés atenderte nuevamente con ' + mention + '?' }
}
export function parseProfessionalReference(value: unknown, state: DialogueState): ProfessionalReference {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'businessId,evidence,mention,question,scope' ||
      value.businessId !== state.businessId || !plain(value.mention, 100) || !isCustomerText(value.evidence, 300) ||
      !value.evidence.includes(value.mention) || typeof value.scope !== 'string' || !/^[a-f0-9]{64}$/.test(value.scope) || value.scope !== professionalReferenceScope(state) ||
      value.question !== '¿Querés atenderte nuevamente con ' + value.mention + '?') throw new Error('invalid professional reference scope')
  return structuredClone(value) as unknown as ProfessionalReference
}
export function communicativeClarification(admission: CommunicativeAdmission): string {
  if (admission.blockedFields.includes('service')) return 'Mantengo los servicios del pedido. ¿Qué servicio querés elegir o cambiar?'
  const questions: Partial<Record<CommunicativeField, string>> = {
    name: '¿Ese nombre corresponde al cliente o al profesional?', professional: '¿Con qué profesional querés atenderte?',
    date: '¿Para qué día querés el turno?', time: '¿Qué horario o franja preferís?', estimate: '¿Qué opción del presupuesto querés elegir?'
  }
  return 'Mantengo los datos del pedido. ' + (questions[admission.blockedFields[0]!] ?? '¿Qué dato querés elegir o cambiar?')
}

/** Reply to a validated nonoperative act without inventing a real-world capability. */
export function conversationalContinuityReply(kind: NonNullable<CommunicativeAdmission['continuity']>, state: DialogueState): string {
  if (kind === 'notice') return 'Gracias por avisar.'
  if (kind === 'pause') return 'Dale, cuando quieras seguimos con tu pedido.'
  const subject = {
    service: 'la elección del servicio', estimate: 'el presupuesto del servicio', date: 'el día del turno',
    professional: 'la elección del profesional', time: 'el horario del turno', name: 'el nombre del cliente',
    proposal: 'la propuesta del turno'
  }[state.pending]
  return '¿Qué parte de ' + subject + ' querés que aclaremos?'
}
