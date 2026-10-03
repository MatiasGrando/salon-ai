import { parseTimePreference, fallbackTemporalRequest, filterTimePreference, type TimePreference } from './time-preference.js'
import { parseInformationFocus, type InformationTarget, type InformationFocus, type ProfessionalInformationTarget, type ProfessionalInformationFacts } from './information-contract.js'
import { readInformation, inferInformationTarget, informationReply, type InformationRead } from './information-read.js'
export type { InformationTarget } from './information-contract.js'
import { parseSandboxReservation, presentSandboxProposal, sandboxProposalMatchesState, sandboxReceiptReply, SANDBOX_CONFIRMATION_QUESTION, type SandboxReservation, type SandboxBookingCommand } from './sandbox-booking.js'
import { matchContextualItems, matchNamedItems, matchingQuestion, affirmativeMatchAnswer, matchPresentedServiceAnswer, type MatchingCategory, type MatchingResult, type MatchingScope } from './contextual-matching.js'
import { normalizeAnswer, fallbackIdentity, explicitIdentity, contextualizeIdentity, rememberDialogueQuestion, parseDialogueQuestion, resolveDialogueRoute, type DialogueQuestionContext, type DialogueQuestionOption } from './dialogue-context.js'
import { resolveServiceEstimate, serviceConfigurationKey, type ServiceBookingPolicy } from '../bot-options/domain/service-booking.js'
import { guidanceBlockMessage, guidanceQuestion, parseServiceEstimates, renderGuidedEstimates, resolveGuidance, serviceGuidance, type GuidanceBlock, type GuidedSelection, type ServiceEstimates } from './service-guidance.js'
import { ACTION_REGISTRY, routeActions, type InformationAction } from './actions.js'
import { pendingQuestion, renderInformation, renderServices, validateFacts, type BusinessFacts } from './information.js'
import { localDateKey, localDateTimeToInstants, parseMinutes, type AvailabilityProfessional, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'
import { resolveDialogueDate } from './dialogue-date.js'
import { parseTurnPlan, type TurnPlan } from './turn-plan.js'
import { applyBasketMutation, basketIsResolved, basketServiceIds, hasBasketSelection, parseServiceBasket, selectionBasket, selectionSummary, type ServiceBasket, type BasketMutation } from './service-basket.js'

export type DialogueService = { id: string; name: string; aliases?: readonly string[]; description?: string | null; durationMinMinutes?: number | null; durationMaxMinutes?: number | null; durationMinutes: number | null; requiresConsultation: boolean; price: number | null; priceMode?: 'FIXED' | 'STARTING_AT'; professionalDurationMinutes?: number | null; customerDurationMinutes?: number | null; bookingPolicy?: ServiceBookingPolicy }
export type DialogueContext = { businessId: string; timezone: string; dbNow: Date; sandboxBooking?: boolean }
export type DialogueBasketAvailability =
  | { ok: false; reason: 'SERVICE_UNAVAILABLE' | GuidanceBlock | 'INVALID_DURATION' | 'COMBINATION_BLOCKED' | 'COMBINATION_REVIEW' | 'NO_COMMON_PROFESSIONAL' | 'UNSUPPORTED_OCCUPANCY' }
  | { ok: false; reason: 'GUIDANCE_REQUIRED'; services: readonly DialogueService[] }
  | { ok: true; services: readonly DialogueService[]; durationMinutes: number; totalPrice: number | null; professionals: DialogueProfessional[]; slots: AvailabilitySlot[]; customerDurationMinutes?: number }
export type DialogueProfessional = AvailabilityProfessional & { aliases?: readonly string[] }
export type DialoguePort = {
  information?(actions?: readonly InformationAction[]): Promise<BusinessFacts>
  professionalInformation?(target: ProfessionalInformationTarget): Promise<ProfessionalInformationFacts>
  catalog(): Promise<DialogueService[]>
  availabilityBasket?(services: readonly DialogueService[], date: string, professionalId?: string, serviceEstimates?: ServiceEstimates): Promise<DialogueBasketAvailability>
  availability(service: DialogueService, date: string, professionalId?: string): Promise<{ professionals: DialogueProfessional[]; slots: AvailabilitySlot[] }>
}
export type PresentedOffer = { businessId: string; serviceId: string | null; serviceIds?: string[]; durationMinutes?: number; date: string; professionalId: string | null }
export type DialogueState = {
  schemaVersion: 1; engine: 'conversational-booking-v1'; businessId: string
  pending: 'service' | 'estimate' | 'date' | 'professional' | 'time' | 'name' | 'proposal'
  serviceId: string | null; basket?: ServiceBasket; serviceEstimates?: Record<string, GuidedSelection>; date: string | null
  professional: null | { kind: 'any' } | { kind: 'specific'; id: string }
  /** Unverified name until uniquely matched against the selected service's compatible professionals. */
  professionalNameHint: string | null
  timePreference?: TimePreference; requestedTime: string | null; slot: AvailabilitySlot | null; customerName: string | null
  /** Evidence of the offer actually presented, not a cache of live availability or chat history. */
  dialogueContext?: { lastQuestion: string | null; presentedOffer: PresentedOffer | null }
  /** Bounded evidence of the last asked field; options are never a permission or availability cache. */
  questionContext?: DialogueQuestionContext
  informationFocus?: InformationFocus
  /** Server-owned QA presentation/receipt; never a production booking capability. */
  sandboxReservation?: SandboxReservation
}
export type BookingProposal = { kind: 'BOOKING_PROPOSAL'; businessId: string; serviceId: string; professionalId: string; startAt: string; customerName: string; serviceIds?: string[]; services?: readonly DialogueService[]; durationMinutes?: number; totalPrice?: number | null; customerDurationMinutes?: number; estimates?: ReturnType<typeof resolveGuidance>['estimates'] }
/** Ephemeral result of this turn only: never persisted as availability or customer state. */
export type AvailabilityDiagnostic = {
  outcome: 'verified' | 'no_slots' | 'guidance_required' | 'blocked' | 'unsupported'
  phase: 'preflight' | 'query' | 'fresh_guidance' | 'contract' | 'slots'
  reason: Exclude<DialogueBasketAvailability, { ok: true }>['reason'] | 'PORT_UNAVAILABLE' | 'CUSTOMER_DURATION_PROOF_MISSING' | 'GUIDANCE_RESULT_NOT_PENDING' | null
  /** Only present when an availability query actually ran. */
  scope?: 'all_compatible' | 'preferred'
}
export type DialogueResponse = { state: DialogueState; reply: string; proposal: BookingProposal | null; availability?: AvailabilityDiagnostic; bookingCommand?: SandboxBookingCommand }
/** Validated QA decision: IDs are rechecked against the current catalog; text still supplies dates and preferences. */
export type DialogueDecision = { serviceId: string | null; candidateIds: readonly string[]; correction: boolean; intent?: 'booking' | 'information' | 'other'; professionalMention?: string | null; informationTarget?: InformationTarget | null; turnPlan?: TurnPlan }
export function hasActiveBooking(state: DialogueState): boolean {
  return Boolean(hasBasketSelection(state) || state.date || state.professional || state.professionalNameHint || state.requestedTime || state.timePreference || state.slot || state.dialogueContext?.lastQuestion || state.pending !== 'service')
}
/** Resume context without presenting an old availability result as freshly checked. */
export function socialQuestion(state: DialogueState): string {
  return state.pending === 'time' ? '¿Querés que consultemos los horarios para tu turno?' : pendingQuestion(state)
}
export function initialDialogueState(businessId: string): DialogueState {
  return { schemaVersion: 1, engine: 'conversational-booking-v1', businessId, pending: 'service', serviceId: null, date: null, professional: null, professionalNameHint: null, requestedTime: null, slot: null, customerName: null }
}
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value)
function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const instant = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day
}
export function parseDialogueState(value: unknown, businessId: string, timezone?: string): DialogueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid dialogue state')
  const s = value as DialogueState
  if (JSON.stringify(value).length > 16384 || s.schemaVersion !== 1 || s.engine !== 'conversational-booking-v1' || s.businessId !== businessId || !bounded(businessId, 128)) throw new Error('invalid dialogue scope')
  if (!['service', 'estimate', 'date', 'professional', 'time', 'name', 'proposal'].includes(s.pending)) throw new Error('invalid dialogue step')
  for (const v of [s.serviceId, s.customerName]) if (v !== null && !bounded(v, v === s.customerName ? 100 : 128)) throw new Error('invalid dialogue field')
  if (s.date !== null && !validCalendarDate(s.date)) throw new Error('invalid date')
  if (s.requestedTime !== null && parseMinutes(s.requestedTime) === null) throw new Error('invalid requested time')
  if (s.timePreference !== undefined) { parseTimePreference(s.timePreference); if (s.requestedTime !== null || s.slot !== null) throw new Error('preference cannot select a slot') }
  if (s.professional !== null && (s.professional.kind !== 'any' && (s.professional.kind !== 'specific' || !bounded(s.professional.id, 128)))) throw new Error('invalid professional')
  // Older schemaVersion 1 snapshots have no hint; keep them readable without a SQL migration.
  if (s.professionalNameHint !== undefined && s.professionalNameHint !== null && (!bounded(s.professionalNameHint, 100) || !/^[a-z0-9:/-]+(?: [a-z0-9:/-]+)*$/.test(s.professionalNameHint))) throw new Error('invalid professional hint')
  if (s.basket !== undefined) {
    parseServiceBasket(s.basket)
    const ids = basketServiceIds(s)
    const singular = ids.length === 1 ? ids[0] : null
    if (s.serviceId !== singular) throw new Error('invalid basket projection')
  }
  if (s.serviceEstimates !== undefined && s.serviceEstimates !== null) parseServiceEstimates(s.serviceEstimates, selectionBasket(s).members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds))
  if (s.pending === 'estimate' && (!basketIsResolved(s) || s.slot !== null)) throw new Error('invalid guidance pending')
  const resolvedSelection = basketIsResolved(s)
  if (s.slot !== null && (!resolvedSelection || !s.date || !s.professional || s.slot.date !== s.date || !bounded(s.slot.professionalId, 128) || !bounded(s.slot.professionalName, 200) || !Number.isFinite(Date.parse(s.slot.startAt)) || parseMinutes(s.slot.time) === null || (s.professional.kind === 'specific' && s.professional.id !== s.slot.professionalId))) throw new Error('invalid slot')
  if ((!resolvedSelection && (s.date && s.slot || (!s.basket && s.professional?.kind === 'specific') || s.slot)) || (!s.date && s.slot) || (s.pending === 'proposal' && (!s.slot || !s.customerName))) throw new Error('invalid dialogue invariants')
  if (s.dialogueContext !== undefined) {
    const dc = s.dialogueContext
    if (!dc || typeof dc !== 'object' || Array.isArray(dc) || Object.keys(dc).sort().join(',') !== 'lastQuestion,presentedOffer' ||
      dc.lastQuestion !== null && (!bounded(dc.lastQuestion, 240) || !dc.lastQuestion.startsWith('¿') || !dc.lastQuestion.endsWith('?'))) throw new Error('invalid dialogue context')
    const offer = dc.presentedOffer
    if (offer !== null && (!offer || typeof offer !== 'object' || Array.isArray(offer) ||
      (offer.serviceIds === undefined ? Object.keys(offer).sort().join(',') !== 'businessId,date,professionalId,serviceId'
        : Object.keys(offer).sort().join(',') !== 'businessId,date,durationMinutes,professionalId,serviceId,serviceIds' ||
          JSON.stringify(offer.serviceIds) !== JSON.stringify(basketServiceIds(s)) || !resolvedSelection || !Number.isSafeInteger(offer.durationMinutes) || Number(offer.durationMinutes) <= 0) ||
      offer.businessId !== businessId || offer.serviceId !== s.serviceId || (basketServiceIds(s).length > 1 && !offer.serviceIds) || !validCalendarDate(offer.date) || offer.date !== s.date ||
      !s.professional || (s.professional.kind === 'specific' ? offer.professionalId !== s.professional.id : offer.professionalId !== null))) throw new Error('invalid presented offer')
  }
  if (s.sandboxReservation !== undefined) parseSandboxReservation(s.sandboxReservation, s)
  if (s.questionContext !== undefined) parseDialogueQuestion(s.questionContext, s)
  if (s.informationFocus !== undefined) parseInformationFocus(s.informationFocus, businessId)
  if (s.slot && timezone) {
    const instant = new Date(s.slot.startAt)
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
    if (localDateKey(instant, timezone) !== s.slot.date || time !== s.slot.time) throw new Error('invalid slot wall time')
  }
  const parsed = structuredClone({ ...s, professionalNameHint: s.professionalNameHint ?? null, ...(s.serviceEstimates === null ? {serviceEstimates: {}} : {}) })
  if (parsed.questionContext && parseDialogueQuestion(parsed.questionContext, parsed) === null) delete parsed.questionContext
  return parsed
}
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9:/-]+/g, ' ').trim()
function matches<T extends { id: string; name: string; aliases?: readonly string[] }>(text: string, items: T[], businessId = 'local', category: MatchingCategory = 'service'): T[] {
  if (!text.trim()) return []
  const result = matchNamedItems({ businessId, category }, text, items)
  return result.kind === 'exact' && result.complete ? items.filter(item => result.items.some(found => found.id === item.id)) : []
}
type MatchRequest = { category: MatchingCategory; query?: string; confirmationId?: string; candidateIds?: readonly string[]; targetServiceId?: string; configurationKey?: string; targetMemberId?: string; answerOnly?: boolean; eligibleIds?: readonly string[] }
function requestedNamedMatch(request: MatchRequest, scope: MatchingScope, items: readonly { id: string; name: string; aliases?: readonly string[] }[]): MatchingResult | null {
  if (request.eligibleIds) items = items.filter(item => request.eligibleIds!.includes(item.id))
  if (request.eligibleIds && request.query) return matchPresentedServiceAnswer(scope, request.query,
    items.map(item => ({ ...scope, id: item.id, label: item.name })))
  if (request.candidateIds) return { kind: 'candidates', complete: true,
    items: items.filter(item => request.candidateIds!.includes(item.id)).map(item => ({ ...scope, id: item.id, label: item.name })) }
  return request.query ? matchNamedItems(scope, request.query, items) : null
}
function exactNamedAnswer<T extends { name: string; aliases?: readonly string[] }>(request: MatchRequest, proposed: T | undefined): T | undefined {
  return proposed && (!request.answerOnly || [proposed.name, ...(proposed.aliases ?? [])].some(label => normalizeAnswer(label) === normalizeAnswer(request.query ?? ''))) ? proposed : undefined
}
const socialMessage = (message: string) => /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|como estas|gracias|muchas gracias|chau|hasta luego)$/.test(normalize(message))

/** Typed presentation plus unchanged catalog labels binds retrieval to one basket member. */
function presentedBasketChoices(state: DialogueState, services: readonly DialogueService[]) {
  const question = state.questionContext
  if (state.pending !== 'service' || question?.role !== 'service' || !question.complete || !question.options.length) return null
  const groups = selectionBasket(state).members.filter(member =>
    (!question.matchTargetMemberId || question.matchTargetMemberId === member.memberId) &&
    (member.mode === 'alternatives' && question.options.every(option => member.serviceIds.includes(option.id)) ||
      member.mode === 'unresolved' && question.matchTargetMemberId === member.memberId &&
      question.matchCandidateIds?.length === 1 && question.options.length === 1))
  if (groups.length !== 1) return null
  const choices = question.options.flatMap(option => services.filter(service =>
    service.id === option.id && normalizeAnswer(service.name) === normalizeAnswer(option.label)))
  if (choices.length !== question.options.length) return null
  return { member: groups[0]!, choices }
}

function matchingTurn(state: DialogueState, message: string, raw: TurnPlan, context: DialogueContext, services: readonly DialogueService[]): { plan: TurnPlan; matching?: MatchRequest } {
  let matching: MatchRequest | undefined
  // Semantic IDs already passed catalog/evidence validation. Retrieval must not police synonyms or typos.
  const operations = raw.operations
  const unresolved = operations.find(op => op.kind === 'service' && op.mode === 'unresolved')
  const unresolvedMember = operations.flatMap(op => op.kind === 'basket' ? op.members : []).find(member => member.mode === 'unresolved')
  if (unresolved?.kind === 'service' || unresolvedMember) matching = { category: 'service', query: unresolved?.evidence ?? unresolvedMember!.evidence }
  const scopedChange = operations.some(op => ['service','basket','date','professional','estimate'].includes(op.kind))
  const question = state.questionContext
  const basketChoices = presentedBasketChoices(state, services)
  const basketServiceQuestion = question?.field === 'service' && hasBasketSelection(state)
  if (!matching && !scopedChange && question?.matchCandidateIds &&
      (!basketServiceQuestion || basketChoices && !/[?¿]/.test(message)) && affirmativeMatchAnswer(message, operations.map(op => op.evidence))) {
    matching = { category: question.field as MatchingCategory, ...(question.matchCandidateIds.length === 1 ? { confirmationId: question.matchCandidateIds[0]! } : { candidateIds: question.matchCandidateIds }),
      ...(question.targetServiceId ? { targetServiceId: question.targetServiceId } : {}), ...(question.matchConfigurationKey ? { configurationKey: question.matchConfigurationKey } : {}), ...(question.matchTargetMemberId ? { targetMemberId: question.matchTargetMemberId } : {}),
      ...(basketChoices ? { eligibleIds: basketChoices.choices.map(item => item.id), targetMemberId: basketChoices.member.memberId } : {}) }
  }
  const identity = operations.find(op => op.kind === 'name')
  if (!matching && state.pending === 'professional' && identity?.kind === 'name' && !explicitIdentity(message, identity.value) && !operations.some(op => op.kind === 'professional')) {
    // Use the literal ambiguous identity span, not an unrelated date, time or information span.
    matching = { category: 'professional', query: identity.value, answerOnly: true }
  }
  if (!matching && !socialMessage(message) && !operations.some(op => op.kind !== 'name') && !extractDate(normalize(message), context) && !extractTime(normalize(message)) && !routeActions(message).information.length && !raw.operations.some(op => op.kind === 'name' && explicitIdentity(message, op.value))) {
    if (state.pending === 'professional') matching = { category: 'professional', query: message, answerOnly: true }
    if (state.pending === 'estimate' && question?.targetServiceId) matching = { category: 'estimate', query: message, targetServiceId: question.targetServiceId, answerOnly: true }
    if (state.pending === 'service' && !operations.length && !hasBasketSelection(state) && (!state.customerName || normalize(message) !== normalize(state.customerName))) matching = { category: 'service', query: message, answerOnly: true }
  }
  if (!matching && !operations.length && basketChoices && !socialMessage(message) &&
      !extractDate(normalize(message), context) && !extractTime(normalize(message)) && !routeActions(message).information.length &&
      !routeActions(message).pendingAction) {
    const result = matchPresentedServiceAnswer({ businessId: state.businessId, category: 'service' }, message,
      basketChoices.choices.map(item => ({ businessId: state.businessId, category: 'service', id: item.id, label: item.name })))
    if (result.kind === 'exact' && result.items.length === 1 && result.complete) {
      const replacement = { kind: 'basket', mutation: 'replace', scope: 'members', targetMemberIds: [basketChoices.member.memberId],
        members: [{ mode: 'single', serviceIds: [result.items[0]!.id], evidence: message, confidence: 1 }], evidence: message, confidence: 1 }
      return { plan: parseTurnPlan({ version: 1, operations: [replacement] }, message, services.map(service => service.id)) }
    }
    if (result.items.length) matching = { category: 'service', query: message, eligibleIds: basketChoices.choices.map(item => item.id), targetMemberId: basketChoices.member.memberId }
  }
  return { plan: { ...raw, operations }, ...(matching ? { matching } : {}) }
}
function extractProfessionalHint(text: string): string | null {
  const match = /\bcon\s+([a-z]+(?:\s+(?!(?:manana|hoy|pasado|para|el|la|a|las|y|pero|no|quiero|un|una|turno|servicio)\b)[a-z]+){0,2})\b/.exec(text)
  return match?.[1] ?? null
}
function extractDate(text: string, context: DialogueContext): string | null {
  const result = resolveDialogueDate(text, localDateKey(context.dbNow, context.timezone))
  return result.kind === 'resolved' && localDateTimeToInstants(result.date, 720, context.timezone).length ? result.date : null
}
function containsInvalidDateExpression(text: string, context: DialogueContext): boolean {
  if (!/\b(?:hoy|manana|pasado\s+manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?)\b/.test(text)) return false
  const result = resolveDialogueDate(text, localDateKey(context.dbNow, context.timezone))
  return result.kind === 'invalid' || result.kind === 'ambiguous'
}
function extractTime(text: string): string | null {
  const match = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (match) return `${match[1]!.padStart(2, '0')}:${match[2]}`
  const compact = /^(?:el de las |a las )?([01]?\d|2[0-3])([0-5]\d)$/.exec(text)
  if (compact) return `${compact[1]!.padStart(2, '0')}:${compact[2]}`
  return null
}
/** Provider fallback may rescue explicit independent data, never infer or replace basket services. */
export function fallbackIndependentTurnPlan(context: DialogueContext, state: DialogueState, message: string, services: readonly DialogueService[]): TurnPlan {
  if (message.length > 300 || routeActions(message).information.length || routeActions(message).pendingAction) return { version: 1, operations: [] }
  const operations: TurnPlan['operations'][number][] = []
  const identity = fallbackIdentity(message, state, services)
  if (identity && explicitIdentity(message, identity)) operations.push({ kind: 'name', value: identity, evidence: identity, confidence: 1 })
  const date = extractDate(normalize(message), context)
  if (date) operations.push({ kind: 'date', expression: message, value: date, evidence: message, confidence: 1 })
  const hint = extractProfessionalHint(normalize(message))
  if (hint) operations.push({ kind: 'professional', mode: 'specific', mention: hint, evidence: message, confidence: 1 })
  const temporal = fallbackTemporalRequest(message, state.pending === 'time')
  if (temporal && temporal.kind !== 'ambiguous' && (temporal.kind === 'preference' || state.pending === 'time' || /\ba las?\b/.test(normalize(message)) || identity && explicitIdentity(message, identity))) operations.push(temporal.kind === 'exact'
    ? { kind: 'time', value: temporal.time, evidence: message, confidence: 1 }
    : { kind: 'time_preference', preference: temporal.preference, evidence: message, confidence: 1 })
  return parseTurnPlan({ version: 1, operations }, message, services.map(service => service.id))
}
function clearSlot(state: DialogueState) { state.slot = null; state.requestedTime = null; delete state.dialogueContext; delete state.questionContext }
function dateLabel(date: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const instant = new Date(Date.UTC(year, month - 1, day, 12))
  const weekday = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'long' }).format(instant)
  return weekday + ' ' + String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0')
}
const serviceList = renderServices
function mutateStateBasket(state: DialogueState, op: BasketMutation): void {
  const previous = selectionBasket(state)
  const previouslyResolved = basketIsResolved(state)
  const result = applyBasketMutation(previous, op)
  state.basket = result.basket
  const ids = basketServiceIds(state)
  state.serviceId = ids.length === 1 ? ids[0]! : null
  if (state.serviceEstimates) {
    const exactIds = state.basket.members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds)
    state.serviceEstimates = Object.fromEntries(Object.entries(state.serviceEstimates).filter(([id]) => exactIds.includes(id)))
  }
  if (result.changed) {
    state.slot = null
    if (previouslyResolved) state.requestedTime = null
    delete state.dialogueContext; delete state.questionContext
  }
}
function basketQuestion(state: DialogueState, services: readonly DialogueService[]): string | null {
  const pending = selectionBasket(state).members.find(member => member.mode !== 'single')
  if (!pending) return null
  const exact = selectionBasket(state).members.filter(member => member.mode === 'single').map(member => services.find(s => s.id === member.serviceIds[0])?.name).filter(Boolean)
  const retained = exact.length ? '\nMantengo también: ' + exact.join(', ') + '.' : ''
  return pending.mode === 'unresolved' ? 'No pude identificar ese servicio. ¿Qué servicio necesitás?' + retained
    : '¿Cuál de estos servicios querés?\n' + serviceList(services.filter(service => pending.serviceIds.includes(service.id))) + retained
}

/** Persist only the concrete alternatives actually rendered, never the whole catalog. */
function rememberBasketClarification(state: DialogueState, services: readonly DialogueService[], reply: string): void {
  const member = selectionBasket(state).members.find(item => item.mode !== 'single')
  if (!member) return
  const question = reply.slice(reply.indexOf('¿'), reply.indexOf('?') + 1)
  const options = services.filter(item => member.serviceIds.includes(item.id)).map(item => ({ id: item.id, label: item.name }))
  state.dialogueContext = { lastQuestion: question, presentedOffer: state.dialogueContext?.presentedOffer ?? null }
  rememberDialogueQuestion(state, question, options)
}

function validBookableService(service: DialogueService, allowDual = false): boolean {
  return serviceGuidance(service).kind !== 'blocked' && Number.isSafeInteger(service.durationMinutes) && Number(service.durationMinutes) > 0 &&
    (service.professionalDurationMinutes === undefined || Number.isSafeInteger(service.professionalDurationMinutes) && service.professionalDurationMinutes === service.durationMinutes) &&
    (service.customerDurationMinutes === undefined || Number.isSafeInteger(service.customerDurationMinutes) && Number(service.customerDurationMinutes) > 0 && (allowDual || Number(service.customerDurationMinutes) <= Number(service.durationMinutes))) &&
    (service.price === null || Number.isSafeInteger(service.price) && service.price >= 0) &&
    (service.priceMode === undefined || ['FIXED', 'STARTING_AT'].includes(service.priceMode))
}
function validateBasketAvailability(result: Extract<DialogueBasketAvailability, { ok: true }>, ids: readonly string[], selections: ServiceEstimates = {}): ReturnType<typeof resolveGuidance> {
  if (!Array.isArray(result.services) || JSON.stringify(result.services.map(s => s.id)) !== JSON.stringify(ids) ||
      result.services.some(service => !validBookableService(service, result.customerDurationMinutes !== undefined)) ||
      !Number.isSafeInteger(result.durationMinutes) || result.durationMinutes <= 0 ||
      (result.totalPrice !== null && (!Number.isSafeInteger(result.totalPrice) || result.totalPrice < 0))) throw new Error('invalid basket availability')
  const guidance = resolveGuidance(result.services, selections)
  if (guidance.blocked || guidance.pending) throw new Error('invalid basket guidance')
  if (guidance.changed && result.services.some(service => {
    const old = Object.hasOwn(selections,service.id) ? selections[service.id] : undefined
    const next = Object.hasOwn(guidance.selections,service.id) ? guidance.selections[service.id] : undefined
    if (JSON.stringify(old) === JSON.stringify(next)) return false
    const guide = serviceGuidance(service)
    return guide.kind !== 'direct' && !(guide.kind === 'guided' && guide.policy.estimateOptions?.length === 0 && next?.optionId === null)
  })) throw new Error('invalid basket guidance change')
  const customerDuration = result.services.reduce((n, service) => n + Math.max(service.durationMinutes!, service.customerDurationMinutes ?? service.durationMinutes!), 0)
  if (result.customerDurationMinutes !== undefined && (!Number.isSafeInteger(result.customerDurationMinutes) || result.customerDurationMinutes !== customerDuration)) throw new Error('invalid basket customer duration')
  const summary = selectionSummary(result.services)
  if (result.durationMinutes !== summary.durationMinutes || result.totalPrice !== summary.totalPrice ||
      !Array.isArray(result.professionals) || result.professionals.length > 50 ||
      !Array.isArray(result.slots) || result.slots.length > 500) throw new Error('invalid basket availability')
  return guidance
}
async function respondBooking(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision, preparedCatalog?: DialogueService[], matching?: MatchRequest): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  // A prepared turn has already applied every semantic operation: never reparse its information text.
  const text = preparedCatalog ? '' : normalize(message)
  let availability: AvailabilityDiagnostic | undefined
  let questionOptions: DialogueQuestionOption[] = []
  let questionTarget: string | null = null
  let questionMatching: Parameters<typeof rememberDialogueQuestion>[4] = null
  // Verification failures invalidate dependent evidence, not an independently stated time preference.
  const invalidateAvailability = () => { state.slot = null; delete state.dialogueContext; delete state.questionContext }
  const finish = (reply: string, proposal: BookingProposal | null = null): DialogueResponse => {
    const lastLine = reply.trim().split('\n').at(-1) ?? ''
    const expected = state.pending === 'estimate' && state.dialogueContext?.lastQuestion ? state.dialogueContext.lastQuestion : pendingQuestion(state)
    const question = expected.startsWith('¿') && reply.includes(expected) ? expected :
      lastLine.startsWith('¿') && lastLine.endsWith('?') && lastLine.length <= 240 ? lastLine : null
    if (hasBasketSelection(state) || state.dialogueContext || decision?.intent === 'booking') state.dialogueContext = { lastQuestion: question, presentedOffer: state.dialogueContext?.presentedOffer ?? null }
    if (question || questionOptions.length) rememberDialogueQuestion(state, question ?? resolveDialogueRoute(state, [], state.pending).question, questionOptions, questionTarget, questionMatching)
    else delete state.questionContext
    return { state, reply, proposal, ...(availability ? { availability } : {}) }
  }
  const failedAvailability = (reason: NonNullable<AvailabilityDiagnostic['reason']>, phase: AvailabilityDiagnostic['phase'], scope?: AvailabilityDiagnostic['scope']): DialogueResponse => {
    invalidateAvailability()
    const unsupported = reason === 'PORT_UNAVAILABLE' || reason === 'CUSTOMER_DURATION_PROOF_MISSING' || reason === 'GUIDANCE_RESULT_NOT_PENDING'
    availability = { outcome: unsupported || reason === 'UNSUPPORTED_OCCUPANCY' ? 'unsupported' : 'blocked', phase, reason, ...(scope ? { scope } : {}) }
    state.pending = unsupported ? !basketIsResolved(state) ? 'service' : !state.date ? 'date' : !state.professional ? 'professional' : 'time'
      : reason === 'NO_COMMON_PROFESSIONAL' && scope === 'preferred' ? 'professional' : 'service'
    const message = ['INVALID_CONFIGURATION','DOMAIN_REVIEW','PHOTO_REQUIRED','VALIDATION_REQUIRED','ESTIMATE_NOT_BOOKABLE'].includes(reason)
      ? guidanceBlockMessage(reason as GuidanceBlock)
      : reason === 'UNSUPPORTED_OCCUPANCY' || reason === 'CUSTOMER_DURATION_PROOF_MISSING' ? 'No pude verificar la permanencia completa del cliente. Mantengo todos los servicios; necesitás consultarlo con el equipo.'
      : reason === 'INVALID_DURATION' ? 'No pude verificar los datos de duración o precio de todos los servicios. Mantengo el pedido; necesitás consultarlo con el equipo.'
      : reason === 'SERVICE_UNAVAILABLE' ? 'Un servicio del pedido ya no está disponible. Necesitás cambiarlo o quitarlo; mantengo el resto del pedido.'
      : reason === 'COMBINATION_BLOCKED' ? 'Estos servicios no se pueden reservar juntos con las reglas actuales. Mantengo el pedido; podés cambiar o quitar un servicio, o consultarlo con el equipo.'
      : reason === 'COMBINATION_REVIEW' ? 'Esta combinación requiere revisión del equipo antes de reservar. Mantengo todos los servicios; podés cambiar o quitar alguno, o consultarlo con el equipo.'
      : reason === 'NO_COMMON_PROFESSIONAL' && scope === 'preferred' ? 'No pude verificar todos los servicios con esa preferencia de profesional. Mantengo el pedido; podés indicar otra preferencia o consultarlo con el equipo.'
      : reason === 'NO_COMMON_PROFESSIONAL' ? 'No hay un profesional compatible con todos los servicios del pedido. Podés cambiar o quitar un servicio, o consultarlo con el equipo.'
      : 'No pude verificar la disponibilidad conjunta de todos los servicios. Mantengo el pedido; necesitás consultarlo con el equipo.'
    return finish(message)
  }
  if (/^(reset|volver a empezar|empezar de nuevo|no quiero nada|nada gracias)$/.test(text)) return { state: initialDialogueState(context.businessId), reply: 'De acuerdo. Cuando quieras, podemos buscar otro turno.', proposal: null }
  if (/^(gracias|muchas gracias|chau|hasta luego)$/.test(text)) return finish('Gracias a vos. Estoy disponible si necesitás algo más.')
  const services = preparedCatalog ?? await port.catalog()
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  const askMatch = (result: MatchingResult, category: MatchingCategory, targetServiceId: string | null = null): DialogueResponse => {
    state.pending = resolveDialogueRoute(state, [], category).pending
    state.slot = null
    questionTarget = targetServiceId
    questionOptions = result.items.map(item => ({ id: item.id, label: item.label }))
    questionMatching = result.complete && result.items.length ? { candidateIds: result.items.map(item => item.id),
      ...(matching?.configurationKey ? { configurationKey: matching.configurationKey } : {}), ...(matching?.targetMemberId ? { targetMemberId: matching.targetMemberId } : {}) } : null
    const response = finish(matchingQuestion(result, category))
    if (!result.complete && state.questionContext) { state.questionContext.complete = false; state.questionContext.options = [] }
    return response
  }
  if (matching?.category === 'service') {
    const unresolvedMember = selectionBasket(state).members.find(member => member.mode !== 'single')
    if (!matching.targetMemberId && unresolvedMember) matching.targetMemberId = unresolvedMember.memberId
    const found = matching.confirmationId ? services.filter(service => service.id === matching!.confirmationId && (!matching!.eligibleIds || matching!.eligibleIds.includes(service.id))) : []
    const result = requestedNamedMatch(matching, { businessId: context.businessId, category: 'service' }, services)
    const proposed = result?.kind === 'exact' && result.items.length === 1 ? services.find(service => service.id === result.items[0]!.id) : undefined
    const exact = found[0] ?? exactNamedAnswer(matching, proposed)
    if (!exact) return askMatch(result ?? { kind: 'none', items: [], complete: true }, 'service')
    mutateStateBasket(state, { kind: 'basket', mutation: matching.targetMemberId ? 'replace' : 'set', scope: matching.targetMemberId ? 'members' : 'all', targetMemberIds: matching.targetMemberId ? [matching.targetMemberId] : [],
      members: [{ mode: 'single', serviceIds: [exact.id], evidence: message, confidence: 1 }], evidence: message, confidence: 1 })
  }
  let service = services.find(s => s.id === state.serviceId)

  let anyProfessional = false
  let rejectsProfessional = false
  let name: string | null = null
  let prefix = ''
  if (!preparedCatalog) {
    if (/\bcambiar (?:la )?(?:hora|horario)\b/.test(text)) clearSlot(state)
    if (/\bcambiar (?:el )?servicio\b/.test(text)) { state.serviceId = null; delete state.basket; service = undefined; state.professional = null; clearSlot(state) }
    const decisionProfessional = decision?.professionalMention ? normalize(decision.professionalMention) : null
    anyProfessional = /\b(cualquiera|cualquier profesional|sin preferencia|me da igual)\b/.test(text)
    rejectsProfessional = /\bnunca te dije\b/.test(text)
    if (rejectsProfessional) { state.professional = null; state.professionalNameHint = null; clearSlot(state); state.pending = resolveDialogueRoute(state, [], 'professional').pending }
    if (anyProfessional) state.professionalNameHint = null
    else if (!rejectsProfessional) {
      const earlyName = decisionProfessional ?? extractProfessionalHint(text)
      if (earlyName && !matches(earlyName, services).length) {
        state.professionalNameHint = earlyName
        state.professional = null
        clearSlot(state)
      }
    }
    const identity = fallbackIdentity(message, state, services)
    name = identity && explicitIdentity(message, identity) ? identity : null
    const bareControl = !name && /\b(hola|buenas|quiero|servicios|servicio|horarios|horario|gracias|no|si|ok|okey|dale|perfecto|confirmar|confirmo|cancelar|cambiar|reset|volver|turno|cualquiera|cualquier|profesional|preferencia|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|precio|direccion|soy|nombre|llamo)\b/.test(normalize(identity ?? ''))
    if (identity && (name || state.pending === 'name') && !bareControl && !matches(identity, services).length) { state.customerName = identity; name = identity }
    const temporal = fallbackTemporalRequest(message, state.pending === 'time')
    const preserveTemporal = () => {
      if (!temporal || temporal.kind === 'ambiguous') return
      state.slot = null; delete state.dialogueContext; delete state.questionContext
      if (temporal.kind === 'preference') { state.timePreference = temporal.preference; state.requestedTime = null }
      else { delete state.timePreference; state.requestedTime = temporal.time }
    }
    preserveTemporal()
    const catalogQuestion = /(?:que|cuales|mostrame|mostrar).*servicios/.test(text)
    if (decision?.correction) { state.serviceId = null; delete state.basket; service = undefined; state.professional = null; clearSlot(state) }
    const serviceMatch = catalogQuestion || decision ? null : matchNamedItems({ businessId: context.businessId, category: 'service' }, message, services)
    if (serviceMatch?.kind === 'candidates' && (!decision && !hasBasketSelection(state))) {
      const date = extractDate(text, context)
      if (date && date !== state.date) { state.date = date; clearSlot(state) }
      preserveTemporal()
      return askMatch(serviceMatch, 'service')
    }
    const found = decision ? services.filter(item => decision.candidateIds.includes(item.id) || item.id === decision.serviceId)
      : catalogQuestion ? [] : matches(text, services)
    if (decision && found.length !== new Set([...decision.candidateIds, ...(decision.serviceId ? [decision.serviceId] : [])]).size) throw new Error('invalid decision catalog')
    if (found.length > 1) {
      const earlyDate = extractDate(text, context)
      if (earlyDate && earlyDate !== state.date) { state.date = earlyDate; clearSlot(state) }
      preserveTemporal()
      state.pending = resolveDialogueRoute(state, [], 'service').pending
      questionOptions = found.map(item => ({ id: item.id, label: item.name }))
      return finish(`¿Cuál de estos servicios querés?\n${serviceList(found)}`)
    }
    if (found.length === 1 && found[0]!.id !== state.serviceId) {
      if (state.basket) {
        const group = state.basket.members.find(member => member.mode === 'alternatives' && member.serviceIds.includes(found[0]!.id))
        if (group) mutateStateBasket(state, { kind: 'basket', mutation: 'replace', scope: 'members', targetMemberIds: [group.memberId], members: [{ mode: 'single', serviceIds: [found[0]!.id], evidence: message, confidence: 1 }], evidence: message, confidence: 1 })
        else if (!basketServiceIds(state).includes(found[0]!.id)) return finish('¿Querés agregar ese servicio o reemplazar alguno de los que ya elegiste?')
      } else { service = found[0]!; state.serviceId = service.id; state.professional = null; clearSlot(state) }
    }
    const date = extractDate(text, context)
    if (containsInvalidDateExpression(text, context) && !date) {
      state.date = null; clearSlot(state); state.pending = resolveDialogueRoute(state, [], 'date').pending
      return finish('Esa fecha no es válida. ¿Qué día querés consultar?')
    }
    if (date && date !== state.date) { state.date = date; clearSlot(state) }
    if (/^(otro dia|probamos otro dia)$/.test(text)) { state.date = null; clearSlot(state) }
    preserveTemporal()
    if (temporal?.kind === 'ambiguous') return finish('No pude confirmar una preferencia horaria única. ¿Qué horario o franja preferís?')
    prefix = catalogQuestion ? `${serviceList(services)}\n` : /^(hola|buenas|como estas|sos linda|salimos)/.test(text) ? 'Hola. Te ayudo con tu turno.\n' : ''
  }
  const clarification = basketQuestion(state, services)
  if (clarification) {
    state.pending = resolveDialogueRoute(state, [], 'service').pending; state.slot = null
    const member = selectionBasket(state).members.find(item => item.mode !== 'single')
    questionOptions = services.filter(item => member?.serviceIds.includes(item.id)).map(item => ({ id: item.id, label: item.name }))
    return finish(clarification)
  }
  let selectedServices = basketServiceIds(state).map(id => services.find(item => item.id === id))
  if (selectedServices.some(item => !item)) return failedAvailability('SERVICE_UNAVAILABLE', 'preflight')
  if (state.basket && selectedServices.length === 1) service = selectedServices[0]
  if (selectedServices.length > 1) {
    const trusted = selectedServices as DialogueService[]
    const summary = selectionSummary(trusted)
    service = { ...trusted[0]!, name: trusted.map(item => item.name).join(' + '), durationMinutes: summary.durationMinutes, price: summary.totalPrice }
  }
  if (!service) {
    state.pending = resolveDialogueRoute(state, [], 'service').pending
    questionOptions = services.map(item => ({ id: item.id, label: item.name }))
    return finish(`${prefix}¿Qué servicio necesitás?\n${serviceList(services) || 'No tengo servicios disponibles para consultar.'}`)
  }
  let guidance = resolveGuidance(selectedServices as DialogueService[], state.serviceEstimates)
  if (guidance.pending && (matching?.category === 'estimate' || !preparedCatalog && (previous as DialogueState).pending === 'estimate' && !socialMessage(message))) {
    const target = guidance.pending, guide = serviceGuidance(target)
    if (guide.kind === 'guided') {
      const scope = { businessId: context.businessId, category: 'estimate' as const, targetId: target.id }
      const items = (guide.policy.estimateOptions ?? []).map(option => ({ ...scope, id: option.id, label: option.label }))
      const configurationKey = serviceConfigurationKey(guide.policy)
      const confirmed = matching?.targetServiceId === target.id && matching.configurationKey === configurationKey && matching.confirmationId ? items.find(item => item.id === matching!.confirmationId) : undefined
      const result: MatchingResult = matching?.candidateIds && matching.configurationKey === configurationKey ? { kind: 'candidates', complete: true, items: items.filter(item => matching!.candidateIds!.includes(item.id)) } : matchContextualItems(scope, matching?.query ?? message, items)
      const proposed = result.kind === 'exact' && result.items.length === 1 ? result.items[0] : undefined
      const exact = confirmed ?? (proposed && normalizeAnswer(proposed.label) === normalizeAnswer(matching?.query ?? message) ? proposed : undefined)
      if (exact) {
        state.serviceEstimates = { ...state.serviceEstimates, [target.id]: { configurationKey, optionId: exact.id } }
        state.slot = null; delete state.questionContext; delete state.dialogueContext
        guidance = resolveGuidance(selectedServices as DialogueService[], state.serviceEstimates)
      } else if (result.items.length && !(matching?.confirmationId && matching.configurationKey !== configurationKey)) {
        matching = { category: 'estimate', targetServiceId: target.id, configurationKey }
        return askMatch(result, 'estimate', target.id)
      }
    }
  }
  if (guidance.changed) { if (state.slot || Object.keys(state.serviceEstimates ?? {}).length || state.dialogueContext?.presentedOffer) clearSlot(state); state.serviceEstimates = guidance.selections }
  if (guidance.blocked) return failedAvailability(guidance.blocked.reason, 'preflight')
  if (guidance.pending) {
    availability = { outcome: 'guidance_required', phase: 'preflight', reason: 'GUIDANCE_REQUIRED' }
    state.slot = null; state.pending = resolveDialogueRoute(state, [], 'estimate').pending
    const question = guidance.pending.bookingPolicy?.estimateQuestion
    state.dialogueContext = { lastQuestion: question?.startsWith('¿') && question.endsWith('?') ? question : null, presentedOffer: null }
    questionOptions = (guidance.pending.bookingPolicy?.estimateOptions ?? []).map(option => ({ id: option.id, label: option.label }))
    questionTarget = guidance.pending.id
    return finish(guidanceQuestion(guidance.pending))
  }
  if (selectedServices.some(item => !item || !validBookableService(item,true))) return failedAvailability('INVALID_DURATION', 'preflight')
  let needsVerifiedSelection = selectedServices.some(item => item?.bookingPolicy?.attentionMode === 'GUIDED_ESTIMATE' || Number(item?.customerDurationMinutes ?? item?.durationMinutes) > Number(item?.durationMinutes))
  let verifiedCustomerDuration: number | undefined
  if (!state.date) { state.pending = resolveDialogueRoute(state, [], 'date').pending; return finish(`${prefix}¿Para qué día querés ${service.name}?`) }
  if (state.date < localDateKey(context.dbNow, context.timezone)) { state.date = null; clearSlot(state); state.pending = resolveDialogueRoute(state, [], 'date').pending; return finish('Esa fecha ya pasó. ¿Qué otro día querés consultar?') }
  let availabilityFailure: DialogueResponse | null = null
  const queryAvailability = async (professionalId?: string) => {
    const scope = professionalId ? 'preferred' : 'all_compatible'
    if (selectedServices.length <= 1 && !needsVerifiedSelection && selectedServices.every(item => item?.bookingPolicy === undefined)) {
      const result = await port.availability(service!, state.date!, professionalId)
      availability = { outcome: 'verified', phase: 'slots', reason: null, scope }
      return result
    }
    if (!port.availabilityBasket) { availabilityFailure = failedAvailability('PORT_UNAVAILABLE', 'preflight'); return null }
    const result = await port.availabilityBasket(selectedServices as DialogueService[], state.date!, professionalId, state.serviceEstimates)
    if (!result.ok) {
      if (result.reason !== 'GUIDANCE_REQUIRED') { availabilityFailure = failedAvailability(result.reason, 'query', scope); return null }
      const ids = basketServiceIds(state)
      if (!Array.isArray(result.services) || JSON.stringify(result.services.map(item => item.id)) !== JSON.stringify(ids) ||
          result.services.some(item => !bounded(item.id,128) || !bounded(item.name,200))) throw new Error('invalid fresh guidance services')
      const fresh = resolveGuidance(result.services,state.serviceEstimates)
      if (fresh.changed) clearSlot(state); else invalidateAvailability()
      state.serviceEstimates = fresh.selections
      if (fresh.blocked) { availabilityFailure = failedAvailability(fresh.blocked.reason, 'fresh_guidance', scope); return null }
      if (result.services.some(item => !validBookableService(item,true))) { availabilityFailure = failedAvailability('INVALID_DURATION', 'fresh_guidance', scope); return null }
      if (!fresh.pending) { availabilityFailure = failedAvailability('GUIDANCE_RESULT_NOT_PENDING', 'fresh_guidance', scope); return null }
      availability = { outcome: 'guidance_required', phase: 'fresh_guidance', reason: 'GUIDANCE_REQUIRED', scope }
      state.pending = resolveDialogueRoute(state, [], 'estimate').pending
      const question = fresh.pending.bookingPolicy?.estimateQuestion
      state.dialogueContext = {lastQuestion:question?.startsWith('¿') && question.endsWith('?') ? question : null,presentedOffer:null}
      questionOptions = (fresh.pending.bookingPolicy?.estimateOptions ?? []).map(option => ({ id: option.id, label: option.label }))
      questionTarget = fresh.pending.id
      availabilityFailure = finish(guidanceQuestion(fresh.pending))
      return null
    }
    const freshNeedsVerifiedSelection = result.services.some(item => item.bookingPolicy?.attentionMode === 'GUIDED_ESTIMATE' || Number(item.customerDurationMinutes ?? item.durationMinutes) > Number(item.durationMinutes))
    if ((needsVerifiedSelection || freshNeedsVerifiedSelection) && result.customerDurationMinutes === undefined) { availabilityFailure = failedAvailability('CUSTOMER_DURATION_PROOF_MISSING', 'contract', scope); return null }
    const verifiedGuidance = validateBasketAvailability(result, basketServiceIds(state), state.serviceEstimates)
    if (verifiedGuidance.changed) { clearSlot(state); state.serviceEstimates = verifiedGuidance.selections }
    needsVerifiedSelection = freshNeedsVerifiedSelection
    verifiedCustomerDuration = result.customerDurationMinutes
    availability = { outcome: 'verified', phase: 'slots', reason: null, scope }
    selectedServices = [...result.services]
    service = { ...result.services[0]!, name: result.services.map(item => item.name).join(' + '), durationMinutes: result.durationMinutes, price: result.totalPrice }
    return result
  }
  const available = await queryAvailability(selectedServices.length > 1 ? undefined : state.professional?.kind === 'specific' ? state.professional.id : undefined)
  if (!available) return availabilityFailure!
  const professionals = available.professionals
  const professionalOptions = professionals.map(item => ({ id: item.id, label: item.name }))
  if (matching?.category === 'professional') {
    const result = requestedNamedMatch(matching, { businessId: context.businessId, category: 'professional' }, professionals)
    const proposed = result?.kind === 'exact' && result.items.length === 1 ? professionals.find(item => item.id === result.items[0]!.id) : undefined
    const exact = matching.confirmationId ? professionals.find(item => item.id === matching!.confirmationId) : exactNamedAnswer(matching, proposed)
    if (!exact) { state.professional = null; state.professionalNameHint = null; return askMatch(result ?? { kind: 'none', items: [], complete: true }, 'professional') }
    state.professional = { kind: 'specific', id: exact.id }; state.professionalNameHint = null; state.slot = null
    const selected = await queryAvailability(exact.id)
    if (!selected) return availabilityFailure!
    available.slots = selected.slots
  }
  const professionalText = name ? normalize(message.replace(name, '')) : text
  const negativePreference = !extractProfessionalHint(text) && /\b(?:no|nunca)\b/.test(professionalText) && matches(professionalText.replace(/\b(?:no|nunca|te|dije|quiero)\b/g, ''), professionals, context.businessId, 'professional').length > 0
  if (negativePreference) { state.professional = null; state.professionalNameHint = null; clearSlot(state); state.pending = resolveDialogueRoute(state, [], 'professional').pending }
  if ((previous as DialogueState).pending === 'name' && !name && matches(text, professionals, context.businessId, 'professional').length) state.customerName = (previous as DialogueState).customerName
  let slots = available.slots.filter(s => s.date === state.date && Date.parse(s.startAt) > context.dbNow.getTime() && professionals.some(p => p.id === s.professionalId))
  if (anyProfessional) { if (state.professional?.kind !== 'any') { delete state.dialogueContext; delete state.questionContext } state.professional = { kind: 'any' }; state.professionalNameHint = null; state.slot = null }
  else if (!negativePreference && !rejectsProfessional) {
    const namedNow = (previous as DialogueState).pending === 'professional' && professionals.length === 1 && /^(si|dale|perfecto)$/.test(professionalText)
      ? professionals : matches(professionalText, professionals, context.businessId, 'professional')
    const hint = state.professionalNameHint
    const named = namedNow.length ? namedNow : hint ? matches(hint, professionals, context.businessId, 'professional') : []
    if (named.length > 1) { state.professionalNameHint = null; state.pending = resolveDialogueRoute(state, [], 'professional').pending; questionOptions = named.map(item => ({ id: item.id, label: item.name })); return finish(`¿Con quién querés atenderte? ${named.map(p => p.name).join(', ')}.`) }
    const matchQuery = hint ?? professionalText
    const near = matchQuery ? matchNamedItems({ businessId: context.businessId, category: 'professional' }, matchQuery, professionals) : null
    if (!named.length && near?.kind === 'candidates' && (hint || (previous as DialogueState).pending === 'professional' && !extractDate(text, context) && !extractTime(text) && !routeActions(message).information.length)) {
      state.professional = null; state.professionalNameHint = null
      return askMatch(near, 'professional')
    }
    if (!named.length && hint) {
      state.professionalNameHint = null; state.pending = resolveDialogueRoute(state, [], 'professional').pending; questionOptions = professionalOptions
      return finish(`No encuentro a ${hint} para ${service.name}. ¿Con qué profesional querés atenderte? ${professionals.map(p => p.name).join(', ')}. También podés elegir cualquier profesional.`)
    }
    if (named.length === 1) {
      state.professionalNameHint = null
      if (state.professional?.kind !== 'specific' || state.professional.id !== named[0]!.id) {
        delete state.dialogueContext; delete state.questionContext; state.slot = null; state.professional = { kind: 'specific', id: named[0]!.id }
        const selected = await queryAvailability(named[0]!.id)
        if (!selected) return availabilityFailure!
        slots = selected.slots.filter(s => s.date === state.date && s.professionalId === named[0]!.id && Date.parse(s.startAt) > context.dbNow.getTime())
      }
    }
  }
  if (state.professional?.kind === 'specific') {
    if (!professionals.some(p => p.id === (state.professional as { id: string }).id)) { state.professional = null; clearSlot(state) }
    else slots = slots.filter(s => s.professionalId === (state.professional as { id: string }).id)
  }
  if (!slots.length) { availability = { ...availability!, outcome: 'no_slots' }; state.date = null; clearSlot(state); state.pending = resolveDialogueRoute(state, [], 'date').pending; return finish('No hay horarios disponibles para esa fecha y preferencia. ¿Qué otro día querés consultar?') }
  if (!state.professional) { state.pending = resolveDialogueRoute(state, [], 'professional').pending; questionOptions = professionalOptions; return finish(`${prefix}¿Con qué profesional? ${professionals.map(p => p.name).join(', ')}. También podés elegir cualquier profesional.`) }
  if (state.slot && !slots.some(s => s.startAt === state.slot!.startAt && s.professionalId === state.slot!.professionalId)) state.slot = null
  if (state.timePreference) {
    slots = filterTimePreference(slots, state.timePreference)
    if (!slots.length) {
      invalidateAvailability(); state.pending = 'time'
      availability = { ...availability!, outcome: 'no_slots' }
      return finish('No hay horarios que cumplan esa preferencia. Mantengo el día y el pedido. ¿En qué otro horario te gustaría venir?')
    }
  }
  if (state.requestedTime && !state.slot) {
    const selected = slots.filter(s => s.time === state.requestedTime)
    if (selected.length === 1 || selected.length > 1 && state.professional.kind === 'any') state.slot = selected[0]!
    else if (selected.length > 1) return finish(`Ese horario tiene varias opciones: ${selected.map(s => `${s.time} con ${s.professionalName}`).join(', ')}. Indicá el profesional.`)
  }
  if (!state.slot) {
    state.pending = resolveDialogueRoute(state, [], 'time').pending
    state.dialogueContext = { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: context.businessId, serviceId: service.id, date: state.date,
      professionalId: state.professional.kind === 'specific' ? state.professional.id : null, ...(selectedServices.length > 1 ? { serviceId: null, serviceIds: basketServiceIds(state), durationMinutes: service.durationMinutes! } : {}) } }
    questionOptions = slots.map(item => ({ id: item.startAt + '/' + item.professionalId, label: item.time + ' con ' + item.professionalName }))
    return finish(`${prefix}Horarios disponibles para ${dateLabel(state.date, context.timezone)}:\n${slots.map(s => `${s.time} con ${s.professionalName}`).join('\n')}\n¿Cuál elegís?`) }
  if (!state.customerName) { state.pending = resolveDialogueRoute(state, [], 'name').pending; return finish(`${prefix}¿A nombre de quién sería el turno?`) }
  state.pending = resolveDialogueRoute(state, [], 'proposal').pending
  const summary = selectionSummary(selectedServices as DialogueService[])
  const finalGuidance = resolveGuidance(selectedServices as DialogueService[],state.serviceEstimates)
  const proposal: BookingProposal = { kind: 'BOOKING_PROPOSAL', businessId: context.businessId, serviceId: service.id, professionalId: state.slot.professionalId, startAt: state.slot.startAt, customerName: state.customerName,
    ...(selectedServices.length > 1 || needsVerifiedSelection ? { serviceIds: basketServiceIds(state), services: selectedServices as DialogueService[], durationMinutes: summary.durationMinutes, totalPrice: summary.totalPrice } : {}), ...(verifiedCustomerDuration !== undefined ? {customerDurationMinutes:verifiedCustomerDuration} : {}), ...(Object.keys(finalGuidance.estimates).length ? {estimates:finalGuidance.estimates} : {}) }
  const details = selectedServices.length > 1 ? ' (' + summary.durationMinutes + ' min; ' + (summary.totalPrice === null ? 'precio total a consultar' : '$ ' + summary.totalPrice.toLocaleString('es-AR')) + ')' : ''
  const estimates = renderGuidedEstimates(selectedServices as DialogueService[],state.serviceEstimates ?? {})
  return finish(`${prefix}Propuesta: ${service.name}${details}, ${state.date.split('-').reverse().join('/')} a las ${state.slot.time} con ${state.slot.professionalName}, a nombre de ${state.customerName}. Todavía no está reservado.${estimates ? '\n' + estimates : ''}`, proposal)
}

/** Apply independent semantic updates in dependency order, then reuse the existing booking progression. */
async function respondTurnPlan(context: DialogueContext, state: DialogueState, message: string, port: DialoguePort, rawPlan: unknown): Promise<DialogueResponse> {
  let raw = parseTurnPlan(rawPlan, message)
  const possibleMatch = !socialMessage(message) && (state.pending === 'professional' || state.pending === 'estimate' || state.pending === 'service') && !raw.operations.some(op => op.kind === 'information')
  const needsCatalog = possibleMatch || raw.operations.some(op => !['information', 'unsupported_action'].includes(op.kind) || op.kind === 'information' && (op.target.kind === 'service' || op.target.kind === 'professional' && op.target.serviceIds.length > 0 || op.target.kind === 'business' && op.target.actions.some(action => ['SERVICES', 'PRICES', 'SERVICE_DETAILS'].includes(action))))
  const services = needsCatalog ? await port.catalog() : []
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200) || s.price !== null && (!Number.isFinite(s.price) || s.price < 0)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  parseTurnPlan(raw, message, services.map(service => service.id))
  const implicitRead = inferInformationTarget(state, message, services)
  const explicitBooking = /\b(reservar|agendar|turno)\b/.test(normalizeAnswer(message)) && !routeActions(message).information.length
  if (implicitRead && !explicitBooking && !raw.operations.some(op => op.kind === 'information') &&
      raw.operations.every(op => ['name', 'service', 'basket'].includes(op.kind))) {
    raw = parseTurnPlan({ version: 1, operations: [...raw.operations.filter(op => op.kind === 'name'),
      { kind: 'information', target: implicitRead, evidence: message, confidence: 1 }] }, message, services.map(service => service.id))
  }
  if (state.informationFocus && implicitRead?.kind === 'service' && !explicitBooking) {
    raw = { ...raw, operations: raw.operations.filter(op => op.kind !== 'name' || explicitIdentity(message, op.value)) }
  }
  const matched = matchingTurn(state, message, raw, context, services)
  const contextual = contextualizeIdentity(matched.plan, state, message)
  const tentativeTemporal = contextual.plan.operations.some(op => (op.kind === 'time_preference' || op.kind === 'time') && op.confidence < 0.85)
  const plan = { ...contextual.plan, operations: contextual.plan.operations.filter(op => op.kind !== 'time_preference' && op.kind !== 'time' || op.confidence >= 0.85) }
  const identityClarification = contextual.clarify && matched.matching?.category !== 'professional' ? '¿Ese nombre corresponde al cliente o al profesional? Indicame a quién te referís.' : ''
  const clarificationReply = [identityClarification, tentativeTemporal ? 'No pude confirmar esa elección o preferencia horaria. ¿Qué horario o franja preferís?' : ''].filter(Boolean).join('\n')
  const originalOffer = state.dialogueContext?.presentedOffer ? structuredClone(state.dialogueContext.presentedOffer) : null
  const updates = plan.operations.filter(op => !['information', 'unsupported_action'].includes(op.kind))
  const bookingUpdates = updates.filter(op => op.kind !== 'name')
  if (bookingUpdates.length) delete state.informationFocus
  const invalidate = (clearTime: boolean) => { state.slot = null; if (clearTime) state.requestedTime = null; delete state.dialogueContext; delete state.questionContext }
  const serviceOp = plan.operations.find(op => op.kind === 'service')
  const basketOp = plan.operations.find(op => op.kind === 'basket')
  if (basketOp?.kind === 'basket') mutateStateBasket(state, basketOp)
  else if (serviceOp?.kind === 'service' && (serviceOp.mode !== 'unresolved' || serviceOp.correction || !hasBasketSelection(state))) {
    const current = selectionBasket(state)
    const group = serviceOp.mode === 'single' && !serviceOp.correction ? current.members.find(member => (member.mode === 'alternatives' && member.serviceIds.includes(serviceOp.serviceIds[0]!) || member.mode === 'unresolved')) : null
    const members = serviceOp.mode === 'multiple'
      ? serviceOp.serviceIds.map(id => ({ mode: 'single' as const, serviceIds: [id], evidence: serviceOp.evidence, confidence: serviceOp.confidence }))
      : [{ mode: serviceOp.mode, serviceIds: [...serviceOp.serviceIds], evidence: serviceOp.evidence, confidence: serviceOp.confidence }]
    // A repeated existing exact service in a multi-service basket is not a request to discard its peers.
    const repeated = serviceOp.mode === 'single' && !serviceOp.correction && current.members.length > 1 && basketServiceIds(state).includes(serviceOp.serviceIds[0]!)
    if (!repeated) mutateStateBasket(state, { kind: 'basket', mutation: group ? 'replace' : 'set', scope: group ? 'members' : 'all', targetMemberIds: group ? [group.memberId] : [], members, evidence: serviceOp.evidence, confidence: serviceOp.confidence })
  }
  const dateOp = plan.operations.find(op => op.kind === 'date')
  let uncertainDate = false
  if (dateOp?.kind === 'date') {
    const today = localDateKey(context.dbNow, context.timezone)
    const resolution = resolveDialogueDate(dateOp.expression, today)
    const resolved = resolution.kind === 'resolved' && (!dateOp.value || dateOp.value === resolution.date) ? resolution.date
      : resolution.kind === 'unsupported' ? dateOp.value ?? null : null
    const date = resolved && resolved >= today && localDateTimeToInstants(resolved, 720, context.timezone).length ? resolved : null
    uncertainDate = !date
    if (date !== state.date || !date) { invalidate(Boolean(state.date) || !date); state.date = date }
  }
  const professionalOp = plan.operations.find(op => op.kind === 'professional')
  if (professionalOp?.kind === 'professional') {
    const mention = professionalOp.mode === 'specific' ? normalize(professionalOp.mention) || null : null
    // The current slot binds its name to the verified professional ID; aliases remain untrusted hints.
    const sameSpecific = professionalOp.mode === 'specific' && mention && state.professional?.kind === 'specific' &&
      state.slot?.professionalId === state.professional.id && normalize(state.slot.professionalName) === mention
    const sameAny = professionalOp.mode === 'any' && state.professional?.kind === 'any'
    if (!sameSpecific && !sameAny) invalidate(Boolean(state.professional))
    if (!sameSpecific) state.professional = professionalOp.mode === 'any' ? { kind: 'any' } : null
    state.professionalNameHint = mention
  }
  const timeOp = plan.operations.find(op => op.kind === 'time')
  if (timeOp?.kind === 'time') { delete state.timePreference; invalidate(false); state.requestedTime = timeOp.value }
  const preferenceOp = plan.operations.find(op => op.kind === 'time_preference')
  if (preferenceOp?.kind === 'time_preference') { invalidate(true); state.timePreference = parseTimePreference(preferenceOp.preference) }
  const nameOp = plan.operations.find(op => op.kind === 'name')
  if (nameOp?.kind === 'name') state.customerName = nameOp.value.trim()

  for (const op of plan.operations) {
    if (op.kind !== 'estimate') continue
    if (!selectionBasket(state).members.some(member => member.mode === 'single' && member.serviceIds.includes(op.serviceId))) throw new Error('invalid guidance service target')
    const selected = services.find(service => service.id === op.serviceId)!
    const guide = serviceGuidance(selected)
    if (guide.kind !== 'guided') throw new Error('invalid guidance target policy')
    const estimate = resolveServiceEstimate(guide.policy,op.optionId)
    const entries = Object.entries(state.serviceEstimates ?? {}).filter(([id]) => id !== op.serviceId)
    const previousChoice = state.serviceEstimates && Object.hasOwn(state.serviceEstimates,op.serviceId) ? state.serviceEstimates[op.serviceId] : undefined
    const nextChoice = estimate ? {configurationKey:serviceConfigurationKey(guide.policy),optionId:op.optionId} : undefined
    if (JSON.stringify(previousChoice) !== JSON.stringify(nextChoice)) invalidate(Boolean(previousChoice))
    state.serviceEstimates = Object.fromEntries(nextChoice ? [...entries,[op.serviceId,nextChoice]] : entries)
  }
  if (bookingUpdates.length || nameOp && hasActiveBooking(state)) state.pending = resolveDialogueRoute(state, services).pending

  // Facts are read after applying fields, so an unavailable information read cannot roll back valid preferences.
  const answers: string[] = []
  const informationReads: InformationRead[] = []
  for (const op of plan.operations) {
    if (op.kind === 'unsupported_action') answers.push('Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.')
    if (op.kind !== 'information') continue
    if (op.target.kind === 'presented_offer') {
      const offer = originalOffer
      answers.push(offer ? 'Los horarios que te mostré corresponden a ' + dateLabel(offer.date, context.timezone) + '.'
        : 'No tengo una oferta de horarios mostrada para identificar.')
      continue
    }
    const read = await readInformation(context, state, op.evidence, port, op.target, services)
    informationReads.push(read)
    if (read.focus) state.informationFocus = read.focus
    answers.push(read.reply)
  }
  const finishWithoutAgenda = (reply: string): DialogueResponse => ({ state, reply: [...answers, reply, clarificationReply].filter(Boolean).join('\n'), proposal: null })
  if (informationReads.length && !bookingUpdates.length && (!nameOp || !hasActiveBooking(state))) return finishWithoutAgenda(informationReads.every(read => read.outcome === 'found') && hasActiveBooking(state) ? pendingQuestion(state) : '')
  if (!matched.matching && !plan.operations.length && hasActiveBooking(state)) {
    const clarification = state.pending === 'service' && !socialMessage(message) ? basketQuestion(state, services) : null
    if (clarification) {
      rememberBasketClarification(state, services, clarification)
      return finishWithoutAgenda(clarification)
    }
    return finishWithoutAgenda(socialQuestion(state))
  }
  if (!matched.matching && !updates.length) return finishWithoutAgenda(hasActiveBooking(state) ? pendingQuestion(state) : answers.length ? '' : '¿En qué te puedo ayudar con el local?')
  const clarification = basketQuestion(state, services)
  if (!matched.matching && (clarification || serviceOp?.kind === 'service' && serviceOp.mode === 'unresolved')) {
    state.pending = resolveDialogueRoute(state, [], 'service').pending
    if (clarification) rememberBasketClarification(state, services, clarification)
    return finishWithoutAgenda(clarification || 'No pude identificar ese servicio. ¿Qué servicio necesitás?\n' + serviceList(services))
  }
  if (uncertainDate) {
    state.pending = basketIsResolved(state) ? 'date' : 'service'
    return finishWithoutAgenda('No pude determinar una fecha válida y única. ¿Qué día querés consultar?' + (!basketIsResolved(state) ? '\n' + pendingQuestion(state) : ''))
  }
  const next = await respondBooking(context, state, message, port, undefined, services, matched.matching)
  return { ...next, reply: [...answers, next.reply, clarificationReply].filter(Boolean).join('\n') }
}

/** Route current-message reads before booking extraction; reads never publish a proposal. */
async function respondCore(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  if (decision && Object.hasOwn(decision, 'turnPlan')) return respondTurnPlan(context, state, message, port, decision.turnPlan)
  const delivered = (reply: string): DialogueResponse => {
    const question = pendingQuestion(state)
    if (state.dialogueContext) state.dialogueContext.lastQuestion = question.startsWith('¿') && question.endsWith('?') && reply.endsWith(question) ? question : null
    return { state, proposal: null, reply }
  }
  const lexicalRoute = routeActions(message)
  const target = decision?.informationTarget
  const focusTarget = !target && state.informationFocus ? inferInformationTarget(state, message, await port.catalog()) : null
  if (target?.kind === 'service' || target?.kind === 'professional' || focusTarget && !lexicalRoute.bookingMessage?.match(/\b(reservar|agendar|turno)\b/)) {
    const read = await readInformation(context, state, message, port, target ?? focusTarget!)
    if (read.focus) state.informationFocus = read.focus
    return { state, reply: informationReply(read, state, hasActiveBooking(state)), proposal: null }
  }
  if (!target && state.dialogueContext?.presentedOffer && lexicalRoute.information.includes('HOURS')) {
    return { state, proposal: null, reply: '¿Consultás por el horario de atención del local o por los horarios que te mostré para tu turno?' }
  }
  if (target?.kind === 'presented_offer') {
    const offer = state.dialogueContext?.presentedOffer
    return delivered(offer
      ? 'Los horarios que te mostré corresponden a ' + dateLabel(offer.date, context.timezone) + '.\n' + pendingQuestion(state)
      : 'No tengo una oferta de horarios mostrada para identificar. ¿Querés que consultemos los horarios para tu turno?')
  }
  const route = target?.kind === 'business'
    ? { ...lexicalRoute, information: [...target.actions], informationMessage: message, bookingMessage: null }
    : lexicalRoute
  if (route.pendingAction && ACTION_REGISTRY[route.pendingAction].status === 'pending') return { state, proposal: null, reply: 'Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.' }
  if (!route.information.length && decision?.intent === 'other' && !decision.serviceId && !decision.candidateIds.length && !decision.professionalMention &&
      !/^(reset|volver a empezar|empezar de nuevo|no quiero nada|nada gracias)$/.test(normalize(message))) return { state, proposal: null,
    reply: !hasActiveBooking(state) ? '¿En qué te puedo ayudar con el local?' : socialQuestion(state) }
  if (!route.information.length && !decision && hasActiveBooking(state) && /^(hola|buenas|buenos dias|buenas tardes|buenas noches|como estas)$/.test(normalize(message))) return delivered(socialQuestion(state))
  if (!route.information.length && state.questionContext?.matchCandidateIds && affirmativeMatchAnswer(message) && !extractDate(normalize(message), context) && !extractProfessionalHint(normalize(message))) return respondTurnPlan(context, state, message, port, { version: 1, operations: [] })
  if (!route.information.length) return respondBooking(context, state, message, port, decision)
  const services = route.information.some(action => ['SERVICES', 'PRICES', 'SERVICE_DETAILS'].includes(action)) ? await port.catalog() : []
  const identity = fallbackIdentity(message, state, services)
  if (identity && explicitIdentity(message, identity)) state.customerName = identity
  const read = await readInformation(context, state, route.informationMessage, port, target ?? { kind: 'business', actions: route.information }, services)
  if (read.focus) state.informationFocus = read.focus
  const answer = read.reply
  if (route.bookingMessage) {
    const next = await respondBooking(context, state, route.bookingMessage, services.length ? { ...port, catalog: async () => services } : port, decision)
    const bookingFields = ({ dialogueContext: _context, ...fields }: DialogueState) => fields
    return { ...next, proposal: JSON.stringify(bookingFields(next.state)) === JSON.stringify(bookingFields(state)) ? null : next.proposal, reply: answer + '\n' + next.reply }
  }
  return delivered(informationReply(read, state, hasActiveBooking(state)))
}

/** Trusted sandbox capability changes only proposal delivery; effects remain an adapter responsibility. */
export async function respond(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const reservation = state.sandboxReservation
  if (context.sandboxBooking !== true) {
    delete state.sandboxReservation
    if (state.questionContext?.role === 'confirmation') delete state.questionContext
    return respondCore(context, state, message, port, decision)
  }
  const plan = decision?.turnPlan ? parseTurnPlan(decision.turnPlan, message) : null
  const onlyInformation = !!plan?.operations.length && plan.operations.every(operation => operation.kind === 'information')
  const lexical = routeActions(message)
  const information = onlyInformation || !plan && lexical.information.length > 0 && !lexical.bookingMessage && !lexical.pendingAction
  if (reservation?.receipt && !information) {
    const modifying = !!plan?.operations.some(operation => operation.kind !== 'confirm_proposal') || !/^(si|confirmo|confirmar|quiero reservar|reservar|ok|okey|dale|gracias)$/.test(normalize(message))
    return { state, proposal: null, reply: sandboxReceiptReply(reservation) + (modifying ? '\nModificar o cancelar un turno ya reservado todavía no está disponible en este motor.' : '') }
  }
  const consentVeto = /[?¿]/.test(message) || /\b(no|pero|mejor|antes|depende|quizas|tal vez)\b/.test(normalize(message))
  const semanticConfirmation = !consentVeto && plan?.operations.length === 1 && plan.operations[0]?.kind === 'confirm_proposal' && plan.operations[0].confidence >= 0.85 && normalize(plan.operations[0].evidence) === normalize(message)
  const fallbackConfirmation = !consentVeto && !plan && !lexical.information.length && !lexical.pendingAction && !decision?.serviceId && !decision?.candidateIds.length && !decision?.professionalMention &&
    /^(si|confirmo|confirmar|confirmo el turno|quiero reservar|reservar|dale|si confirmo)$/.test(normalize(message))
  if (reservation && !reservation.receipt && sandboxProposalMatchesState(reservation.presented, state) && !state.questionContext?.matchCandidateIds && (semanticConfirmation || fallbackConfirmation)) {
    return { state, proposal: null, reply: 'Voy a verificar y confirmar el turno de prueba.', bookingCommand: { kind: 'CONFIRM_SANDBOX_BOOKING', presented: structuredClone(reservation.presented) } }
  }
  // A semantic confirmation cannot manufacture a proposal or authorize effects before it was shown.
  const nextDecision = plan?.operations.some(operation => operation.kind === 'confirm_proposal')
    ? { ...decision!, turnPlan: { ...plan, operations: plan.operations.filter(operation => operation.kind !== 'confirm_proposal') } } : decision
  delete state.sandboxReservation
  if (state.questionContext?.role === 'confirmation') delete state.questionContext
  let catalog: DialogueService[] = []
  const observedPort: DialoguePort = { ...port, catalog: async () => { catalog = await port.catalog(); return catalog } }
  const response = await respondCore(context, state, message, observedPort, nextDecision)
  if (reservation?.receipt) {
    response.state.sandboxReservation = structuredClone(reservation)
    response.reply = response.reply.replace(SANDBOX_CONFIRMATION_QUESTION, '').replace('La propuesta sigue pendiente; todavía no está reservado.', '').trim() + '\n' + sandboxReceiptReply(reservation)
    delete response.state.questionContext
    if (response.state.dialogueContext) response.state.dialogueContext.lastQuestion = null
    return response
  }
  if (response.proposal) {
    response.reply = presentSandboxProposal(context, response.state, catalog, response.proposal, reservation)
    response.state.dialogueContext = { lastQuestion: SANDBOX_CONFIRMATION_QUESTION, presentedOffer: response.state.dialogueContext?.presentedOffer ?? null }
    rememberDialogueQuestion(response.state, SANDBOX_CONFIRMATION_QUESTION)
  } else if (reservation && sandboxProposalMatchesState(reservation.presented, response.state)) {
    response.state.sandboxReservation = structuredClone(reservation)
    response.reply = response.reply.replace('La propuesta sigue pendiente; todavía no está reservado.', SANDBOX_CONFIRMATION_QUESTION)
    rememberDialogueQuestion(response.state, SANDBOX_CONFIRMATION_QUESTION)
  }
  return response
}
