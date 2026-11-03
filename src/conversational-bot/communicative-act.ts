import { validServiceCandidateContext, validServiceReferenceContext } from './service-request.js'
import { validCurrentServiceReadOrigin, validCurrentServiceRead, validCurrentServiceInquiry, uniqueLiteralSpan, type CurrentServiceReadEvidence, type CurrentServiceInquiry } from './service-information-scope.js'
import { dateExpressionCoversCurrentEvidence } from './date-preference.js'
import { choiceDraftFingerprint } from './choices.js'
import { currentProfessionalOption } from './dialogue-context.js'
import { preferenceOptionId, informationBookingService } from './dialogue-choice-presentation.js'
import { serviceGuidance } from './service-guidance.js'
import { isCustomerText } from './customer-text.js'
import { matchPresentedServiceAnswer } from './contextual-matching.js'
import { applyBasketMutation, selectionBasket } from './service-basket.js'
import { TurnPlanValidationError, type TurnOperation, type TurnPlan } from './turn-plan.js'
import type { DialogueService, DialogueState } from './engine.js'

export const COMMUNICATIVE_FIELDS = ['service', 'professional', 'date', 'time', 'name', 'estimate', 'general'] as const
export type CommunicativeField = typeof COMMUNICATIVE_FIELDS[number]
const kinds = ['request', 'change', 'answer', 'inquiry', 'reference', 'uncertain', 'notice', 'pause', 'repair', 'social', 'decline', 'conversation'] as const
export type CommunicativeAct = {
  kind: typeof kinds[number]; field: CommunicativeField; evidence: string; confidence: number
  mention: string | null; operationIndexes: number[]
}
export type CommunicativeActs = { version: 1; acts: CommunicativeAct[] }
export type ProfessionalReference = { businessId: string; mention: string; evidence: string; scope: string; question: string }
export type InquiryBinding = { requestOperationIndex: number; informationOperationIndex: number }
export const COMMUNICATIVE_REJECTION_REASONS = ['catalog_owner', 'catalog_context', 'server_field', 'service_reference', 'professional_option',
  'management_owner', 'multiple_owners', 'act_owner', 'act_field', 'act_kind', 'act_confidence', 'act_evidence',
  'date_evidence', 'professional_reference', 'professional_mention', 'basket_conflict'] as const
export type CommunicativeRejection = { kind: TurnOperation['kind']; field: CommunicativeField; reason: typeof COMMUNICATIVE_REJECTION_REASONS[number] }
export type CommunicativeAdmission = {
  plan: TurnPlan; blockedFields: CommunicativeField[]
  /** Closed server diagnostic codes only; never rejected evidence or model content. */
  rejections?: readonly CommunicativeRejection[]
  /** Server-only links between two reads admitted from the same current inquiry. */
  inquiryBindings?: readonly InquiryBinding[]
  /** Server-only proof of the identity span of one current factual inquiry. */
  currentServiceInquiries?: readonly CurrentServiceInquiry[]
  currentServiceReads?: readonly CurrentServiceReadEvidence[]
  /** Server-only current temporal authority; never a model or persisted claim. */
  timeMeaningRejected?: true
  /** Current admitted temporal inquiry scopes a search, never a slot selection. */
  temporalInquiry?: true
  /** Sole admitted exact-time answer ownership; ephemeral, never model or stored authority. */
  currentTimeAnswer?: true
  /** A validated refusal of the current management proposal authorizes only dismissing that proposal. */
  managementDeclined?: true
  /** Refuses only the live service suggestions; never a selected service or appointment. */
  serviceCandidatesDeclined?: true
  /** A validated contextual answer authorizes only confirming the displayed reprogramming proposal. */
  managementConfirmed?: true
  reference?: { mention: string; evidence: string }
  /** Ephemeral server admission, never a model flag or persisted booking action. */
  continuity?: 'notice' | 'pause' | 'repair'
  /** A validated social act carries no booking authority. */
  social?: true
  /** Independent conversation owns prose only, never entities or operational commands. */
  conversation?: true
}
export function allowsConversationalContent(state: DialogueState): boolean {
  return state.pending !== 'proposal' && !state.bookingReservation && !state.sandboxReservation &&
    !state.appointmentManagement && !state.ownAppointmentInquiry && !state.referral && !state.professionalReference &&
    state.pending !== 'estimate' && !state.timeMeaningClarification && !state.timeClarification && !state.questionContext?.matchCandidateIds
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
    if (raw.mention !== null && mention === null) {
      // A zero-ID explanation has no identity to prove. A synthetic descriptive
      // mention is discarded, never normalized or used as selection authority.
      // The original proposal remains untouched for diagnostics.
      const operation = source?.operations[0]
      const descriptiveOwner = source?.operations.length === 1 && value.acts.length === 1 &&
        raw.kind === 'inquiry' && raw.field === 'service' && raw.confidence >= .85 &&
        raw.operationIndexes.length === 1 && raw.operationIndexes[0] === 0 &&
        operation?.kind === 'information' && operation.target.kind === 'service' &&
        operation.target.serviceIds.length === 0 && operation.target.actions.length === 0 &&
        ['description', 'comparison', 'recommendation'].includes(operation.target.aspect) &&
        operation.target.estimateOptionId === undefined && Number.isFinite(operation.confidence) && operation.confidence >= .85 &&
        !!uniqueLiteralSpan(message, operation.evidence) && !!uniqueLiteralSpan(raw.evidence, operation.evidence)
      if (!descriptiveOwner) fail('evidence')
    }
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
  if (['basket', 'service', 'service_request', 'service_reference'].includes(operation.kind)) return 'service'
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
/** Current ownership is derived against the final admitted operation, never an old focus. */
export function deriveCurrentServiceInquiries(metadata: CommunicativeActs | null, source: TurnPlan, final: TurnPlan,
  message: string, businessId: string): CurrentServiceInquiry[] {
  if (!metadata) return []
  return final.operations.flatMap((operation, operationIndex) => {
    if (operation.kind !== 'information' || operation.target.kind !== 'service' ||
        operation.target.serviceIds.length !== 1 || operation.target.estimateOptionId !== undefined) return []
    const sourceIndex = sourceOperationIndex(operation, source)
    if (sourceIndex < 0 || JSON.stringify(source.operations[sourceIndex]) !== JSON.stringify(operation)) return []
    const owners = metadata.acts.filter(act => act.operationIndexes.includes(sourceIndex))
    const owner = owners[0]
    if (owners.length !== 1 || !owner || owner.kind !== 'inquiry' || owner.field !== 'service' ||
        owner.confidence < .85 || owner.confidence > 1 || !Number.isFinite(owner.confidence) || owner.mention === null) return []
    const scope: CurrentServiceInquiry = { operationIndex, businessId, serviceId: operation.target.serviceIds[0]!,
      aspect: operation.target.aspect, identityMention: owner.mention,
      ownerEvidence: owner.evidence, inquiryEvidence: message, operationEvidence: operation.evidence }
    return validCurrentServiceInquiry(scope, operation, message, businessId) ? [scope] : []
  })
}
/** Recheck immutable evidence/target and follow structural clones through final engine filters. */
export function remapCurrentServiceInquiries(scopes: readonly CurrentServiceInquiry[], source: TurnPlan, final: TurnPlan,
  message: string, businessId: string): CurrentServiceInquiry[] {
  return scopes.flatMap(scope => {
    if (scopes.filter(other => other.operationIndex === scope.operationIndex).length !== 1) return []
    const original = source.operations[scope.operationIndex]
    if (!validCurrentServiceInquiry(scope, original, message, businessId)) return []
    const matches = final.operations.map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => JSON.stringify(operation) === JSON.stringify(original))
    if (matches.length !== 1) return []
    const current = { ...scope, operationIndex: matches[0]!.index }
    return validCurrentServiceInquiry(current, matches[0]!.operation, message, businessId) ? [current] : []
  })
}

/** Only original modern singleton information operations carry this no-authority fence. */
export function deriveCurrentServiceReads(metadata: CommunicativeActs | null, source: TurnPlan, final: TurnPlan,
  message: string, businessId: string): CurrentServiceReadEvidence[] {
  if (!metadata) return []
  return final.operations.flatMap((operation, operationIndex) => {
    if (operation.kind !== 'information' || operation.target.kind !== 'service' || operation.target.serviceIds.length !== 1) return []
    const sourceIndex = sourceOperationIndex(operation, source), original = source.operations[sourceIndex]
    if (original?.kind !== 'information' || original.target.kind !== 'service' || original.target.serviceIds.length !== 1) return []
    const scope: CurrentServiceReadEvidence = { operationIndex: sourceIndex, businessId, serviceId: original.target.serviceIds[0]!,
      aspect: original.target.aspect, inquiryEvidence: message, operationEvidence: original.evidence }
    if (!validCurrentServiceReadOrigin(scope, original, message, businessId)) return []
    return [{ ...scope, operationIndex,
      ...(!validCurrentServiceRead(scope, original, message, businessId) ||
        !validCurrentServiceRead(scope, operation, message, businessId) ? { projectionRejected: true as const } : {}) }]
  })
}
/** A changed singleton retains rejection provenance instead of downgrading to a legacy quote. */
export function remapCurrentServiceReads(scopes: readonly CurrentServiceReadEvidence[], source: TurnPlan, final: TurnPlan,
  message: string, businessId: string): CurrentServiceReadEvidence[] {
  return scopes.flatMap(scope => {
    const original = source.operations[scope.operationIndex]
    const exact = final.operations.map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => JSON.stringify(operation) === JSON.stringify(original))
    const candidates = exact.length === 1 ? exact : final.operations.map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.kind === 'information' && operation.target.kind === 'service')
    if (candidates.length !== 1) return []
    const current = { ...scope, operationIndex: candidates[0]!.index }
    const unique = scopes.filter(other => other.operationIndex === scope.operationIndex).length === 1
    return [{ ...current, ...(!unique || !validCurrentServiceRead(scope, original, message, businessId) ||
      !validCurrentServiceRead(current, candidates[0]!.operation, message, businessId) ? { projectionRejected: true as const } : {}) }]
  })
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
/** A fresh, complete request can retain independent facts when its optional act map groups their ownership. */
function completeProspectiveBookingRequest(plan: TurnPlan, state: DialogueState): boolean {
  if (selectionBasket(state).members.length || state.date || state.datePreferences || state.requestedTime || state.timePreference ||
      state.timeClarification || state.timeMeaningClarification || state.slot || state.professional || state.professionalNameHint ||
      state.serviceRequest || state.editRequest || state.referral || state.professionalReference || state.questionContext ||
      state.dialogueContext || state.sandboxReservation) return false
  const service = plan.operations.some(operation => operation.kind === 'basket' && operation.mutation === 'set' &&
    operation.scope === 'all' && operation.targetMemberIds.length === 0 && operation.members.length > 0 ||
    operation.kind === 'service' && operation.mode !== 'unresolved' && !operation.correction ||
    operation.kind === 'service_request' && operation.purpose === 'booking' && operation.disposition === 'clear')
  return service && plan.operations.some(operation => operation.kind === 'date') &&
    plan.operations.some(operation => operation.kind === 'time')
}
/** This admits only an omitted or grouped current request; every explicit contrary act remains authoritative. */
function groupedProspectiveRequestOwner(owners: readonly CommunicativeAct[], operation: TurnOperation): boolean {
  const owner = owners[0]
  return owners.length <= 1 && (owners.length === 0 || !!owner && owner.kind === 'request' && owner.confidence >= .85 &&
    contains(owner.evidence, operation.evidence)) && operation.confidence >= .85
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
  const rejections: CommunicativeRejection[] = []
  const reject = (operation: TurnOperation, field: CommunicativeField, reason: CommunicativeRejection['reason']) => {
    blocked.add(field); rejections.push({ kind: operation.kind, field, reason }); return false
  }
  let timeMeaningRejected = false
  let temporalInquiry = false
  let currentTimeAnswer = false
  const completeProspectiveRequest = completeProspectiveBookingRequest(source, state)
  const reference = metadata?.acts.find(act => act.kind === 'reference' && act.field === 'professional' && act.confidence >= .85 && act.mention !== null)
  // Establish sole current nonoperative ownership before inspecting unowned proposals.
  const continuityActs = metadata?.acts.filter(act => ['notice', 'pause', 'repair'].includes(act.kind) &&
    act.field === 'general' && Number.isFinite(act.confidence) && act.confidence >= .85 && act.confidence <= 1 &&
    act.operationIndexes.length === 0 && isCustomerText(act.evidence, 300) && message.includes(act.evidence)) ?? []
  const distinct = [...new Set(continuityActs.map(act => act.kind))]
  const continuityCandidate = distinct.length === 1 && continuityActs.length === metadata?.acts.filter(act => act.kind !== 'social').length
    ? distinct[0] as NonNullable<CommunicativeAdmission['continuity']> : undefined
  const managementDeclined=Boolean(state.appointmentManagement?.context.proposal && state.appointmentManagement.presentedScope &&
    !state.appointmentManagement.outcome && metadata?.acts.some(act=>act.kind==='pause' && act.field==='general' && act.confidence>=.85 &&
      act.evidence===message && act.mention===null) && !metadata?.acts.some(act=>['request','change'].includes(act.kind)) &&
    !source.operations.some(operation=>operation.kind==='confirm_proposal'))
  const managementConfirmed=Boolean(state.appointmentManagement?.context.proposal?.kind==='GROUP_RESCHEDULE_PROPOSAL' &&
    state.appointmentManagement.presentedScope && !state.appointmentManagement.outcome && !/[?¿]/.test(message) && source.operations.length===0 &&
    metadata?.acts.some(act=>act.kind==='answer' && act.field==='general' && act.confidence>=.85 && act.evidence===message &&
      act.mention===null && act.operationIndexes.length===0) &&
    metadata.acts.every(act=>act.kind==='social' || act.kind==='answer' && act.field==='general' && act.confidence>=.85 &&
      act.evidence===message && act.mention===null && act.operationIndexes.length===0))
  const serviceCandidatesDeclined = Boolean(state.pending === 'service' && !state.bookingReservation && !state.sandboxReservation && !state.appointmentManagement &&
    state.serviceRequest && !state.serviceRequest.referenceConfirmed && source.operations.length === 0 &&
    (state.serviceRequest.serviceIds.length > 0 &&
      validServiceCandidateContext(state.serviceRequest, state.serviceRequest.serviceIds[0]!, state.businessId, services, state.questionContext, false) ||
      state.serviceRequest.catalogGuidanceOffered && state.catalogNavigation && state.questionContext?.complete &&
        ['category', 'service'].includes(state.questionContext.role) && state.questionContext.options.length > 0) &&
    metadata?.acts.some(act => act.kind === 'decline' && act.field === 'service' && act.confidence >= .85 &&
      uniqueLiteralSpan(message, act.evidence) && act.mention === null && act.operationIndexes.length === 0) &&
    metadata.acts.every(act => act.kind === 'social' ||
      (act.kind === 'decline' && act.field === 'service' || act.kind === 'inquiry' && ['service', 'general'].includes(act.field)) &&
      act.confidence >= .85 && uniqueLiteralSpan(message, act.evidence) && act.mention === null && act.operationIndexes.length === 0))
  const conversation = Boolean(allowsConversationalContent(state) && source.operations.length === 0 &&
    metadata?.acts.some(act => ['conversation', 'social'].includes(act.kind) && act.field === 'general' && act.confidence >= .85 &&
      act.mention === null && act.operationIndexes.length === 0 && uniqueLiteralSpan(message, act.evidence)) &&
    metadata.acts.every(act => ['social', 'conversation'].includes(act.kind) && act.field === 'general' &&
      act.confidence >= .85 && act.mention === null && act.operationIndexes.length === 0 && uniqueLiteralSpan(message, act.evidence)))
  const admitted = plan.operations.filter(operation => {
    const index = sourceOperationIndex(operation, source)
    const original = source.operations[index]
    const field = fieldOf(original ?? operation)
    const owners = metadata?.acts.filter(item => item.operationIndexes.includes(index)) ?? []
    const act = owners[0]
    if (operation.kind === 'catalog_navigation') {
      // Reading a category is not choosing a service or replaying a native option.
      // The motor independently verifies this ID against the current scoped catalog.
      const initialRead = state.pending === 'service' && selectionBasket(state).members.length === 0 &&
        !state.bookingReservation && !state.sandboxReservation && !state.appointmentManagement
      const presentedRead = state.catalogNavigation?.view === 'categories' && state.questionContext?.role === 'category' &&
        state.questionContext.complete && state.questionContext.options.some(option => option.id === 'category:' + operation.categoryId)
      if (!initialRead && !presentedRead) return reject(operation, 'general', 'catalog_context')
      const admitted = owners.length === 1 && act && ['request', 'inquiry', 'answer'].includes(act.kind) &&
        ['general', 'service'].includes(act.field) && act.confidence >= .85 && operation.confidence >= .85 && contains(act.evidence, operation.evidence)
      return admitted ? true : reject(operation, 'general', 'catalog_owner')
    }
    if (serverBlockedFields.includes(field)) {
      if (field === 'time' && act?.field === field && ['request', 'change', 'answer'].includes(act.kind) &&
          act.confidence >= .85 && operation.confidence >= .85 && contains(act.evidence, operation.evidence)) timeMeaningRejected = true
      return reject(operation, field, 'server_field')
    }
    // An orphan cannot authorize effects or reopen a field under sole validated continuity.
    if (continuityCandidate && owners.length === 0) return false
    // Preserve already selected exact identities before generic grounding can widen them.
    if (repeatedAdd(operation, state)) return false

    const informationalSelection = operation.kind === 'service_reference' && operation.action === 'select' &&
      act && (act.kind === 'answer' || act.kind === 'request') && informationBookingService(state, services, act.kind)?.id === operation.serviceId
    if (operation.kind === 'service_reference' && (owners.length !== 1 || (!informationalSelection && act?.kind !== 'answer') || act?.field !== 'service' ||
        act.confidence < .85 || operation.confidence < .85 || !contains(act.evidence, operation.evidence) ||
        (operation.action === 'confirm' ? !validServiceReferenceContext(state.serviceRequest, operation.serviceId, state.businessId, services, state.questionContext)
          : !informationalSelection && (state.serviceRequest?.serviceIds.length !== 1 || !validServiceCandidateContext(state.serviceRequest, operation.serviceId, state.businessId, services, state.questionContext))))) {
      return reject(operation, 'service', 'service_reference')
    }
    if (operation.kind === 'professional' && operation.mode === 'option' && (owners.length !== 1 || act?.kind !== 'answer' ||
        act.field !== 'professional' || act.confidence < .85 || act.mention !== null || !contains(act.evidence, operation.evidence) ||
        !currentProfessionalOption(state, operation, source.operations))) {
      return reject(operation, 'professional', 'professional_option')
    }
    if (operation.kind==='own_appointment' && operation.action!=='read' &&
      (!act || owners.length!==1 || !['request','change','answer'].includes(act.kind))) {
      return reject(operation, 'general', 'management_owner')
    }
    if (!metadata) {
      if (changesExisting(operation, state) && !closedAnswer(operation, message, state, services)) return reject(operation, field, 'act_owner')
      return true
    }
    if (owners.length > 1) {
      if (!sharedBasketAuthority(owners, original, message, state, services)) return reject(operation, field, 'multiple_owners')
      return true
    }
    // The act map is secondary metadata, not a second semantic parser. A single
    // new request can legitimately own service/date/time together, or omit a
    // sibling index; its already validated plan keeps those prospective facts.
    if (completeProspectiveRequest && ['service', 'date', 'time'].includes(field) &&
        groupedProspectiveRequestOwner(owners, operation)) return true
    const read = original?.kind === 'information' || original?.kind === 'unsupported_action' || original?.kind === 'own_appointment' ||
      original?.kind === 'service_request' && original.purpose === 'inquiry'
    // Catalog exploration may be expressed as a service inquiry/request. Its field
    // metadata cannot turn the read into basket, selection or booking authority.
    const sharedServicesRead = original?.kind === 'information' && original.target.kind === 'business' &&
      original.target.actions.length === 1 && original.target.actions[0] === 'SERVICES' && act?.field === 'service'
    const sameField = act?.field === field || sharedServicesRead
    const current = act && ['request', 'change', 'answer'].includes(act.kind)
    const temporalRead = act?.kind === 'inquiry' && ['date', 'time', 'time_preference', 'time_clarification'].includes(operation.kind)
    const appropriate = read ? act && ['request', 'change', 'answer', 'inquiry'].includes(act.kind) : current || temporalRead
    if (!act) return reject(operation, field, 'act_owner')
    if (!sameField) return reject(operation, field, 'act_field')
    if (!appropriate) return reject(operation, field, 'act_kind')
    if (act.confidence < .85) return reject(operation, field, 'act_confidence')
    if (!contains(act.evidence, operation.evidence)) return reject(operation, field, 'act_evidence')
    if (operation.kind === 'date' && businessDate && !dateExpressionCoversCurrentEvidence(operation.expression, act.evidence, businessDate)) {
      return reject(operation, 'date', 'date_evidence')
    }
    if (operation.kind === 'professional_reference' && (act.kind !== 'answer' || !state.professionalReference ||
        act.evidence !== message || operation.evidence !== message)) return reject(operation, field, 'professional_reference')
    if (operation.kind === 'professional' && operation.mode === 'specific' && act.mention !== operation.mention) return reject(operation, field, 'professional_mention')
    if (temporalRead && field === 'time' && operation.confidence >= .85) temporalInquiry = true
    if (operation.kind === 'time' && operation.confidence >= .85 && act.kind === 'answer' &&
        plan.operations.filter(item => item.kind === 'time').length === 1) currentTimeAnswer = true
    return true
  })
  const continuity = admitted.length === 0 && blocked.size === 0 ? continuityCandidate : undefined
  return { plan: { ...plan, operations: admitted }, blockedFields: [...blocked],
    ...(rejections.length ? { rejections } : {}),
    ...(timeMeaningRejected ? { timeMeaningRejected: true as const } : {}),
    ...(temporalInquiry ? { temporalInquiry: true as const } : {}),
    ...(currentTimeAnswer ? { currentTimeAnswer: true as const } : {}),
    ...(managementDeclined ? { managementDeclined: true as const } : {}),
    ...(serviceCandidatesDeclined ? { serviceCandidatesDeclined: true as const } : {}),
    ...(managementConfirmed ? { managementConfirmed: true as const } : {}),
    ...(conversation ? { conversation: true as const, social: true as const } : {}),
    ...(continuity ? { continuity } : {}),
    ...(blocked.size === 0 && metadata?.acts.some(act => act.kind === 'social' && act.field === 'general' && act.confidence >= .85 && act.operationIndexes.length === 0 && act.mention === null) &&
      !metadata.acts.some(act => ['notice', 'pause', 'repair'].includes(act.kind)) ? { social: true as const } : {}),
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
      blockedFields: [...new Set([...admission.blockedFields, 'service' as const])],
      rejections: [...admission.rejections ?? [], { kind: 'basket', field: 'service', reason: 'basket_conflict' }] }
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
  if (admission.blockedFields.includes('service')) return '¿Qué te gustaría hacerte?'
  const questions: Partial<Record<CommunicativeField, string>> = {
    name: '¿Ese nombre corresponde al cliente o al profesional?', professional: '¿Con qué profesional querés atenderte?',
    date: '¿Para qué día querés el turno?', time: '¿Qué horario o franja preferís?', estimate: '¿Qué opción del presupuesto querés elegir?'
  }
  return questions[admission.blockedFields[0]!] ?? '¿Qué te gustaría hacerte o consultar del local?'
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
