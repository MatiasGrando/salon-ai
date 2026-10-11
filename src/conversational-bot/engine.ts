import { parseAppointmentManagement, beginAppointmentManagement, attachManagementRescheduleOffers, selectManagementRescheduleOffer, confirmAppointmentManagement, cancellationFingerprint, type AppointmentManagementContext, type CancellationSnapshot, type GroupCancellationCommand, type GroupRescheduleCommand, type ManagementRescheduleOffer } from './appointment-management.js'
import { parseRuntimeBookingReservation, runtimeProposalMatchesState, runtimeBookingSummary, runtimeBookingReceiptReply, type RuntimeBookingReservation, type RuntimePresentedBooking, type RuntimeShownScope, type RuntimeBookingResult } from './prisma-conversational-booking.js'
import { socialContinuationFacts } from './reply-contract.js'
import { validateCoordinatedSlot, coordinationLabel, type CoordinatedSegment, type DialogueAvailabilitySlot as AvailabilitySlot } from './coordinated-booking.js'
import { remapCurrentServiceReads, remapCurrentServiceInquiries, remapInquiryBindings, conversationalContinuityReply, communicativeClarification, createProfessionalReference, parseProfessionalReference, professionalReferenceScope, protectProspectiveBasket, type CommunicativeAdmission, type ProfessionalReference } from './communicative-act.js'
import { parseDatePreferences, resolveDatePreferences, type DatePreference } from './date-preference.js'
import { isCustomerText } from './customer-text.js'
import { attachReferralOffer, explicitReferralAction, parseConversationalReferral, reconcileConversationalReferral, referralPendingReply, type ConversationalReferral } from './conversational-referral.js'
import { retainServiceRequestBase, assessServiceIdentity, parseServiceRequestContext, resolveServiceRequest, serviceRequestReply, serviceRequestQuestion, serviceRequestDelivery, serviceRequestCaveat, serviceSelectionNote, serviceCandidateMutation, validServiceCandidateContext, validServiceReferenceContext, type ServiceRequestContext } from './service-request.js'
import { requestedTimeExplanation } from './requested-time-presentation.js'
import { memoBusinessTimeContext, type BusinessTimeContextReader } from './business-time-context.js'
import { groundTemporalPlan, parseTimeClarification, temporalClarificationQuestion } from './temporal-grounding.js'
import { professionalIdentities, professionalFailureMessage, type ProfessionalEligibilityFailure } from './professional-preference.js'
import { parseAvailabilityExplanation, parseRequestedStartExplanation, type RequestedStartEvidence, type RequestedStartExplanation, type AvailabilityCause, type AvailabilityExplanation } from '../bot-options/application/availability-evidence.js'
import { acknowledgmentContent, appliedChangeAcknowledgment } from './draft-delivery.js'
import { guidanceDelivery } from './service-guidance.js'
import type { ReplyFact } from './reply-contract.js'
import { ANY_PROFESSIONAL_OPTION, adaptChoicePresentation, choiceOptionId, choicePresentationForQuestion, choicePresentationForInformation, priceBookingChoice } from './dialogue-choice-presentation.js'
import { introduceDialogue, type DialogueIdentity } from './dialogue-identity.js'
import { presentAvailability, presentProfessionals, presentVerifiedDates, presentDateTimeQuestion, type ChoicePresentation, type PresentationChoice } from './availability-presentation.js'
import { parseConversationChoiceOperation, type ConversationChoiceOperation, type ConversationChoicePresentation } from './choices.js'
import { parseTimePreference, approximateTimeRequest, fallbackTemporalRequest, filterTimePreference, type TimePreference } from './time-preference.js'
import { parseInformationFocus, type InformationTarget, type InformationFocus, type ProfessionalInformationTarget, type ProfessionalInformationFacts } from './information-contract.js'
import { validCatalogInquiry, type CatalogInquiryScope, type CatalogInformationContext } from './catalog-information-answer.js'
import { normalizeInformativeEstimates, readInformation, inferInformationTarget, informationAspect, informationNext, type InformationRead } from './information-read.js'
export type { InformationTarget } from './information-contract.js'
import { parseSandboxReservation, presentSandboxProposal, sandboxProposalMatchesState, sandboxReceiptReply, SANDBOX_CONFIRMATION_QUESTION, type SandboxReservation, type SandboxBookingCommand } from './sandbox-booking.js'
import { matchContextualItems, matchNamedItems, matchingQuestion, affirmativeMatchAnswer, matchPresentedServiceAnswer, type MatchingCategory, type MatchingResult, type MatchingScope } from './contextual-matching.js'
import { normalizeAnswer, fallbackIdentity, explicitIdentity, contextualizeIdentity, rememberDialogueQuestion, parseDialogueQuestion, resolveDialogueRoute, type DialogueQuestionContext, type DialogueQuestionOption } from './dialogue-context.js'
import { resolveServiceEstimate, serviceConfigurationKey, type ServiceBookingPolicy } from '../bot-options/domain/service-booking.js'
import { guidanceBlockMessage, guidanceQuestion, parseServiceEstimates, renderGuidedEstimates, resolveGuidance, serviceGuidance, type GuidanceBlock, type GuidedSelection, type ServiceEstimates } from './service-guidance.js'
import { ACTION_REGISTRY, routeActions, type InformationAction } from './actions.js'
import { pendingQuestion, renderInformation, renderServices, validateFacts, type BusinessFacts } from './information.js'
import { localDateKey, localDateTimeToInstants, parseMinutes, type AvailabilityProfessional } from '../bot-options/application/availability-queries.js'
import { resolveDialogueDate } from './dialogue-date.js'
import { DRAFT_EDIT_FIELDS, parseTurnPlan, type DraftEditField, type TurnOperation, type TurnPlan } from './turn-plan.js'
import { applyBasketMutation, basketIsResolved, basketServiceIds, hasBasketSelection, parseServiceBasket, selectionBasket, selectionSummary, type ServiceBasket, type BasketMutation } from './service-basket.js'

export type DialogueService = { id: string; name: string; aliases?: readonly string[]; description?: string | null; durationMinMinutes?: number | null; durationMaxMinutes?: number | null; durationMinutes: number | null; requiresConsultation: boolean; price: number | null; priceMode?: 'FIXED' | 'STARTING_AT'; professionalDurationMinutes?: number | null; customerDurationMinutes?: number | null; bookingPolicy?: ServiceBookingPolicy }
export type DialogueContext = { businessId: string; timezone: string; dbNow: Date; sandboxBooking?: boolean; humanHandoff?: true; serverRuntimeBookingScope?: RuntimeShownScope; serverManagementSnapshot?: CancellationSnapshot }
export type DialogueBasketAvailability =
  | { ok: false; reason: 'SERVICE_UNAVAILABLE' | GuidanceBlock | 'INVALID_DURATION' | 'COMBINATION_BLOCKED' | 'COMBINATION_REVIEW' | 'NO_COMMON_PROFESSIONAL' | 'UNSUPPORTED_OCCUPANCY' }
  | { ok: false; reason: 'PREFERRED_PROFESSIONAL_INCOMPATIBLE'; professionals: DialogueProfessional[]; professionalFailure?: ProfessionalEligibilityFailure }
  | { ok: false; reason: 'GUIDANCE_REQUIRED'; services: readonly DialogueService[] }
  | { ok: true; services: readonly DialogueService[]; durationMinutes: number; totalPrice: number | null; professionals: DialogueProfessional[]; slots: AvailabilitySlot[]; customerDurationMinutes?: number; explanation?: AvailabilityExplanation; requestedStartEvidence?: RequestedStartEvidence }
export type DialogueProfessional = AvailabilityProfessional & { aliases?: readonly string[] }
export type DialoguePort = {
  managementRescheduleOffers?(snapshot: CancellationSnapshot, date: string): Promise<readonly ManagementRescheduleOffer[]>
  businessTimeContext?: BusinessTimeContextReader
  identity?(): Promise<DialogueIdentity>
  verifiedDateChoices?(services: readonly DialogueService[], professionalId?: string, serviceEstimates?: ServiceEstimates, temporal?: { requestedTime: string | null; preference?: TimePreference }): Promise<DialogueBasketAvailability>
  information?(actions?: readonly InformationAction[]): Promise<BusinessFacts>
  professionalInformation?(target: ProfessionalInformationTarget): Promise<ProfessionalInformationFacts>
  prepareRuntimeBooking?(state: DialogueState, scope: RuntimeShownScope): Promise<import('./prisma-conversational-booking.js').RuntimeBookingPreparation>
  catalog(): Promise<DialogueService[]>
  availabilityBasket?(services: readonly DialogueService[], date: string, professionalId?: string, serviceEstimates?: ServiceEstimates, temporal?: {requestedTime:string|null;preference?:TimePreference}): Promise<DialogueBasketAvailability>
  availability(service: DialogueService, date: string, professionalId?: string, temporal?: {requestedTime:string|null;preference?:TimePreference}): Promise<{ professionals: DialogueProfessional[]; slots: AvailabilitySlot[]; explanation?: AvailabilityExplanation; preferredProfessionalIncompatible?: true; professionalFailure?: ProfessionalEligibilityFailure; requestedStartEvidence?: RequestedStartEvidence }>
}
export type PresentedOffer = { businessId: string; serviceId: string | null; serviceIds?: string[]; durationMinutes?: number; date: string; professionalId: string | null }
export type DialogueState = {
  schemaVersion: 1; engine: 'conversational-booking-v1'; businessId: string
  introduced?: boolean
  /** Unverified procedure inquiry; independent of the booking draft. */
  serviceRequest?: ServiceRequestContext
  /** Conversation-only consultation; never BotHandoff ownership or a queue. */
  referral?: ConversationalReferral
  /** An unanswered request to edit draft fields is not a replacement value or consent. */
  editRequest?: { fields: DraftEditField[] }
  pending: 'service' | 'estimate' | 'date' | 'professional' | 'time' | 'name' | 'proposal'
  serviceId: string | null; basket?: ServiceBasket; serviceEstimates?: Record<string, GuidedSelection>; date: string | null
  /** Ordered dates remain unresolved until the client selects one concrete date. */
  datePreferences?: DatePreference[]
  professional: null | { kind: 'any' } | { kind: 'specific'; id: string }
  /** Unverified name until uniquely identified publicly and checked against fresh booking eligibility. */
  professionalNameHint: string | null
  /** Tentative historical reference, not a current professional preference or roster assertion. */
  professionalReference?: ProfessionalReference
  /** Server-owned unresolved temporal meaning; never a requested time or availability. */
  timeMeaningClarification?: true
  /** Server-derived search target: persists across answers, but cannot auto-select a slot. */
  requestedTimeMode?: 'inquiry'
  timePreference?: TimePreference; timeClarification?: { candidateTimes: string[] }; requestedTime: string | null; slot: AvailabilitySlot | null; customerName: string | null
  /** Evidence of the offer actually presented, not a cache of live availability or chat history. */
  dialogueContext?: { lastQuestion: string | null; presentedOffer: PresentedOffer | null }
  /** Bounded evidence of the last asked field; options are never a permission or availability cache. */
  questionContext?: DialogueQuestionContext
  informationFocus?: InformationFocus
  /** Server-owned QA presentation/receipt; never a production booking capability. */
  appointmentManagement?: { context: AppointmentManagementContext; date?: string; selectedTime?: string; presentedScope?: RuntimeShownScope; outcome?: { kind: 'CANCELLED' | 'RESCHEDULED'; appointmentIds: string[]; moves?: readonly { appointmentId: string; newStartAt: string }[] } }
  bookingReservation?: RuntimeBookingReservation
  sandboxReservation?: SandboxReservation
}
export type BookingProposal = { kind: 'BOOKING_PROPOSAL'; segments?: CoordinatedSegment[]; businessId: string; serviceId: string; professionalId: string; startAt: string; customerName: string; serviceIds?: string[]; services?: readonly DialogueService[]; durationMinutes?: number; totalPrice?: number | null; customerDurationMinutes?: number; estimates?: ReturnType<typeof resolveGuidance>['estimates'] }
/** Ephemeral result of this turn only: never persisted as availability or customer state. */
export type AvailabilityDiagnostic = {
  outcome: 'verified' | 'no_slots' | 'guidance_required' | 'blocked' | 'unsupported'
  phase: 'preflight' | 'query' | 'fresh_guidance' | 'contract' | 'slots'
  reason: Exclude<DialogueBasketAvailability, { ok: true }>['reason'] | 'PORT_UNAVAILABLE' | 'CUSTOMER_DURATION_PROOF_MISSING' | 'GUIDANCE_RESULT_NOT_PENDING' | AvailabilityCause | null
  /** Only present when an availability query actually ran. */
  scope?: 'all_compatible' | 'preferred'
}
export type DialogueTurnOutcome = { changedFields: (DraftEditField | 'estimate')[]; appliedFields: (DraftEditField | 'estimate')[]; requestedChanges: DraftEditField[]; rejectedProfessionalPreference: boolean }
export type DialogueResponse = { catalogInformation?: CatalogInformationContext; replyPrepared?: true; replyFacts?: readonly ReplyFact[]; turnOutcome?: DialogueTurnOutcome; state: DialogueState; reply: string; proposal: BookingProposal | null; availability?: AvailabilityDiagnostic; bookingCommand?: SandboxBookingCommand | {kind:'CONFIRM_BOOKING';presented:RuntimePresentedBooking}; managementCommand?: GroupCancellationCommand | GroupRescheduleCommand; handoffCommand?: { referral: ConversationalReferral; evidence: string }; choicePresentation?: ConversationChoicePresentation }
function informationChoiceFields(state: DialogueState): Pick<DialogueResponse, 'choicePresentation'> {
  const presentation = choicePresentationForInformation(state)
  return presentation ? { choicePresentation: presentation } : {}
}
/** Validated QA decision: IDs are rechecked against the current catalog; text still supplies dates and preferences. */
export type DialogueDecision = { catalogInquiries?: readonly CatalogInquiryScope[]; serviceId: string | null; candidateIds: readonly string[]; correction: boolean; intent?: 'booking' | 'information' | 'other'; confirmationEvidence?: string; professionalMention?: string | null; informationTarget?: InformationTarget | null; turnPlan?: TurnPlan; informationOnly?: true; communicative?: CommunicativeAdmission }
export function hasActiveBooking(state: DialogueState): boolean {
  return Boolean(hasBasketSelection(state) || state.date || state.datePreferences || state.professional || state.professionalNameHint || state.requestedTime || state.timePreference || state.slot || state.dialogueContext?.lastQuestion || state.pending !== 'service')
}
/** Resume context without presenting an old availability result as freshly checked. */
export function socialQuestion(state: DialogueState): string {
  return state.pending === 'time' ? '¿Querés que consultemos los horarios para tu turno?' : pendingQuestion(state)
}
/** Bind the actual invitation without replacing an existing draft's pending field. */
function rememberInformationContinuation(state: DialogueState, read: InformationRead, next: string): void {
  const localOverview = read.outcome === 'found' && read.focus?.aspect === 'overview' &&
    read.focus.serviceId !== null && read.focus.options.length === 1 && read.focus.options[0]!.id === read.focus.serviceId
  if (read.catalogInformation && !localOverview) { rememberDialogueQuestion(state, next, [], null); return }
  const retained = hasBasketSelection(state) || state.editRequest || state.serviceRequest || state.referral
  const service = read.outcome === 'found' && read.focus?.serviceId ? read.focus.options.find(option => option.id === read.focus!.serviceId) : null
  if (service && next === '¿Querés agendar ' + service.label + '?' && (!retained || read.focus?.aspect === 'price' || localOverview)) {
    if (!retained) state.pending = 'service'
    rememberDialogueQuestion(state, next, [{ id: service.id, label: service.label }], null,
      state.pending === 'service' && !localOverview ? { candidateIds: [service.id] } : null)
  } else if (!retained) delete state.questionContext
}
function renderInformationContinuation(read: InformationRead, state: DialogueState): string {
  const next = informationNext(read, state, hasActiveBooking(state))
  rememberInformationContinuation(state, read, next)
  return read.reply + (next ? '\n' + next : '')
}
/** An accepted informational candidate resolves the reference, not the booking draft or technique. */
async function readServiceCandidate(context: DialogueContext, state: DialogueState, request: ServiceRequestContext,
  serviceId: string, port: DialoguePort, services: readonly DialogueService[]): Promise<DialogueResponse> {
  delete state.serviceRequest
  delete state.informationFocus
  reconcileConversationalReferral(state, services)
  const read = await readInformation(context, state, 'stored choice', port,
    { kind: 'service', actions: [], serviceIds: [serviceId], aspect: request.aspect ?? 'overview' }, services)
  if (read.focus) state.informationFocus = read.focus
  return { state, proposal: null, reply: [serviceRequestCaveat(request, services), renderInformationContinuation(read, state)].filter(Boolean).join('\n'),
    replyPrepared: true, ...(read.focus ? informationChoiceFields(state) : {}) }
}
function timeMeaningQuestion(state: DialogueState): string {
  state.pending = 'time'
  const question = '¿Qué horario o franja preferís?'
  rememberDialogueQuestion(state, question)
  return question
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
  if (s.referral !== undefined) parseConversationalReferral(s.referral, businessId)
  if (s.serviceRequest !== undefined) parseServiceRequestContext(s.serviceRequest, businessId)
  if (s.introduced !== undefined && typeof s.introduced !== 'boolean') throw new Error('invalid introduction marker')
  if (!['service', 'estimate', 'date', 'professional', 'time', 'name', 'proposal'].includes(s.pending)) throw new Error('invalid dialogue step')
  if (s.editRequest !== undefined && (!s.editRequest || Object.keys(s.editRequest).join(',') !== 'fields' ||
      !Array.isArray(s.editRequest.fields) || !s.editRequest.fields.length || s.editRequest.fields.length > DRAFT_EDIT_FIELDS.length ||
      new Set(s.editRequest.fields).size !== s.editRequest.fields.length || s.editRequest.fields.some(field => !DRAFT_EDIT_FIELDS.includes(field)) ||
      s.pending !== s.editRequest.fields[0] || s.sandboxReservation !== undefined)) throw new Error('invalid draft edit request')
  for (const v of [s.serviceId, s.customerName]) if (v !== null && !bounded(v, v === s.customerName ? 100 : 128)) throw new Error('invalid dialogue field')
  if (s.date !== null && !validCalendarDate(s.date)) throw new Error('invalid date')
  if (s.datePreferences !== undefined) {
    parseDatePreferences(s.datePreferences)
    if (s.date !== null || s.slot !== null) throw new Error('date priorities cannot select a date or slot')
  }
  if (s.requestedTime !== null && parseMinutes(s.requestedTime) === null) throw new Error('invalid requested time')
  if (s.requestedTimeMode !== undefined && (s.requestedTimeMode !== 'inquiry' || s.requestedTime === null || s.slot !== null)) throw new Error('invalid requested time mode')
  if (s.timeMeaningClarification !== undefined && (s.timeMeaningClarification !== true || s.requestedTime !== null ||
      s.slot !== null || s.timePreference !== undefined || s.timeClarification !== undefined ||
      s.sandboxReservation !== undefined && !s.sandboxReservation.receipt)) throw new Error('invalid temporal meaning clarification')
  if (s.timeClarification !== undefined) { parseTimeClarification(s.timeClarification); if (s.requestedTime !== null || s.slot !== null || s.timePreference !== undefined) throw new Error('clarification cannot select a slot') }
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
  if (s.slot) validateCoordinatedSlot(s.slot,{businessId,serviceIds:basketServiceIds(s),...(timezone ? {timezone} : {})})
  if (s.appointmentManagement !== undefined) {
    const m = s.appointmentManagement
    if (!m || Object.keys(m).some(key => !['context', 'date', 'selectedTime', 'presentedScope', 'outcome'].includes(key)) || !s.bookingReservation?.receipt) throw new Error('invalid management sidecar')
    const original = s.bookingReservation
    parseAppointmentManagement(m.context, businessId, original.presented.scope.sessionId)
    if (m.context.snapshot.groupId !== original.receipt!.coordinationGroupId || m.context.snapshot.members.length !== original.receipt!.appointments.length ||
      m.context.snapshot.members.some(member => !original.receipt!.appointments.some(item => item.appointmentId === member.appointmentId && item.visitId === member.visitId))) throw new Error('management receipt membership mismatch')
    if (m.date !== undefined && !validCalendarDate(m.date) || m.selectedTime !== undefined && parseMinutes(m.selectedTime) === null) throw new Error('invalid management temporal fields')
    if (m.presentedScope && (Object.keys(m.presentedScope).sort().join(',') !== Object.keys(original.presented.scope).sort().join(',') ||
      ['businessId', 'sessionId', 'deploymentId', 'configurationId', 'generation', 'dispatchFenceEpoch', 'handoffFenceEpoch'].some(key => m.presentedScope![key as keyof RuntimeShownScope] !== original.presented.scope[key as keyof RuntimeShownScope]) || !/^\d+$/.test(m.presentedScope.revision))) throw new Error('invalid management shown scope')
    if (m.outcome && (Object.keys(m.outcome).some(key => !['kind', 'appointmentIds', 'moves'].includes(key)) || !['CANCELLED', 'RESCHEDULED'].includes(m.outcome.kind) ||
      !Array.isArray(m.outcome.appointmentIds) || canonicalManagementIds(m.outcome.appointmentIds) !== canonicalManagementIds(m.context.snapshot.members.map(member => member.appointmentId)) ||
      m.outcome.kind === 'RESCHEDULED' && JSON.stringify(m.outcome.moves) !== JSON.stringify(m.context.proposal?.kind === 'GROUP_RESCHEDULE_PROPOSAL' ? m.context.proposal.moves : null))) throw new Error('invalid management outcome')
  }
  if (s.bookingReservation !== undefined) {
    parseRuntimeBookingReservation(s.bookingReservation,businessId)
    if (s.sandboxReservation || !runtimeProposalMatchesState(s.bookingReservation.presented,s) || timezone && s.bookingReservation.presented.terms.timezone!==timezone) throw new Error('invalid runtime proposal state')
  }
  if (s.sandboxReservation !== undefined) parseSandboxReservation(s.sandboxReservation, s)
  if (s.professionalReference !== undefined) parseProfessionalReference(s.professionalReference, s)
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
type MatchRequest = { category: MatchingCategory; identityEvidence?: string; query?: string; confirmationId?: string; candidateIds?: readonly string[]; targetServiceId?: string; configurationKey?: string; targetMemberId?: string; answerOnly?: boolean; eligibleIds?: readonly string[] }
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
function standaloneIdentityMessage(message: string, name: string): boolean {
  if (/[?¿]/.test(message)) return false
  const text = normalizeAnswer(message).replace(/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)\s+/, '')
  const identity = normalizeAnswer(name)
  return ['soy ' + identity, 'me llamo ' + identity, 'mi nombre es ' + identity].includes(text)
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
  const scopedChange = operations.some(op => ['service','basket','date','professional','estimate','request_change'].includes(op.kind))
  const question = state.questionContext
  const basketChoices = presentedBasketChoices(state, services)
  const basketServiceQuestion = question?.field === 'service' && hasBasketSelection(state)
  const currentServiceQuestion = question?.field !== 'service' || question.matchCandidateIds?.every(id =>
    question.options.some(option => option.id === id && services.some(service => service.id === id && normalizeAnswer(service.name) === normalizeAnswer(option.label))))
  if (!matching && !scopedChange && question?.matchCandidateIds && currentServiceQuestion &&
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
    if (state.pending === 'service' && !operations.length && (!hasBasketSelection(state) || state.editRequest?.fields[0] === 'service') && (!state.customerName || normalize(message) !== normalize(state.customerName))) matching = { category: 'service', query: message, answerOnly: true }
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
export function fallbackIndependentTurnPlan(context: DialogueContext, state: DialogueState, message: string, services: readonly DialogueService[], port?: DialoguePort): TurnPlan {
  if (message.length > 300 || routeActions(message).information.length || routeActions(message).pendingAction) return { version: 1, operations: [] }
  const operations: TurnPlan['operations'][number][] = []
  const identity = fallbackIdentity(message, state, services)
  if (identity && explicitIdentity(message, identity)) operations.push({ kind: 'name', value: identity, evidence: identity, confidence: 1 })
  const date = !state.timeClarification || /^(?:hoy|manana|pasado manana|(?:el )?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?)$/.test(normalize(message)) ? extractDate(normalize(message), context) : null
  if (date) operations.push({ kind: 'date', expression: message, value: date, evidence: message, confidence: 1 })
  const hint = extractProfessionalHint(normalize(message))
  if (hint) operations.push({ kind: 'professional', mode: 'specific', mention: hint, evidence: message, confidence: 1 })
  const temporal = !state.timeClarification || /^(?:a las? )?\d{1,2}(?::[0-5]\d)?(?: (?:am|pm|de la (?:manana|tarde|noche)))?$/.test(normalize(message)) ? fallbackTemporalRequest(message, state.pending === 'time') : null
  if (temporal && temporal.kind !== 'ambiguous' && (temporal.kind === 'preference' || state.pending === 'time' || /\ba las?\b/.test(normalize(message)) || identity && explicitIdentity(message, identity))) operations.push(temporal.kind === 'exact'
    ? { kind: 'time', value: temporal.time, evidence: message, confidence: 1 }
    : { kind: 'time_preference', preference: temporal.preference, evidence: message, confidence: 1 })
  return parseTurnPlan(groundTemporalPlan({ version: 1, operations }, message, state, {businessId:context.businessId,timezone:context.timezone,businessDate:localDateKey(context.dbNow,context.timezone),...(port?.businessTimeContext ? {read:port.businessTimeContext} : {})}), message, services.map(service => service.id))
}
function clearSlot(state: DialogueState) { state.slot = null; state.requestedTime = null; delete state.requestedTimeMode; delete state.dialogueContext; delete state.questionContext }
function dateLabel(date: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const instant = new Date(Date.UTC(year, month - 1, day, 12))
  const weekday = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'long' }).format(instant)
  return weekday + ' ' + String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0')
}
const serviceList = renderServices
function completeDraftEdit(state: DialogueState, field: DraftEditField): void {
  const remaining = state.editRequest?.fields.filter(item => item !== field)
  if (remaining?.length) { state.editRequest = { fields: remaining }; state.pending = remaining[0]! }
  else delete state.editRequest
}
function draftEditResponse(state: DialogueState, services: readonly DialogueService[]): DialogueResponse {
  const field = state.editRequest!.fields[0]!
  state.pending = field
  const question = resolveDialogueRoute(state, services, field).question
  rememberDialogueQuestion(state, question, field === 'service' ? services.map(service => ({ id: service.id, label: service.name })) : [])
  const presentation = choicePresentationForQuestion(state, services)
  return { state, reply: question, proposal: null, ...(presentation ? { choicePresentation: presentation } : {}) }
}
function mutateStateBasket(state: DialogueState, op: BasketMutation): void {
  const previous = selectionBasket(state)
  const previouslyResolved = basketIsResolved(state)
  const result = applyBasketMutation(previous, op)
  state.basket = result.basket
  completeDraftEdit(state, 'service')
  const ids = basketServiceIds(state)
  state.serviceId = ids.length === 1 ? ids[0]! : null
  if (state.serviceEstimates) {
    const exactIds = state.basket.members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds)
    state.serviceEstimates = Object.fromEntries(Object.entries(state.serviceEstimates).filter(([id]) => exactIds.includes(id)))
  }
  if (result.changed) {
    state.slot = null
    if (previouslyResolved) { state.requestedTime = null; delete state.requestedTimeMode }
    delete state.dialogueContext; delete state.questionContext
  }
}
function basketQuestion(state: DialogueState, services: readonly DialogueService[]): string | null {
  const members = selectionBasket(state).members
  const pending = members.find(member => member.mode !== 'single')
  if (!pending) return null
  const names = (ids: readonly string[]) => services.filter(service => ids.includes(service.id)).map(service => service.name)
  const summary = members.map(member => member.mode === 'single' ? names(member.serviceIds).join(' / ')
    : member.evidence || names(member.serviceIds).join(' / ')).filter(Boolean)
  const heading = members.length > 1 ? 'Perfecto, seguimos con ' + summary.join(' y ') + '.\n\n' : ''
  const exact = members.filter(member => member.mode === 'single').flatMap(member => names(member.serviceIds))
  const retained = exact.length ? '\nMantengo también: ' + exact.join(', ') + '.' : ''
  if (pending.mode === 'unresolved') return heading + serviceRequestReply({
    businessId: state.businessId, purpose: 'booking', disposition: 'unverified_variant', serviceIds: [],
    correction: false, basis: 'related_category', sourceQuote: null, continuation: false, request: pending.evidence
  }, services) + retained
  return heading + 'Para ' + pending.evidence + ', ¿Cuál de estos servicios querés?\n\n' +
    renderServices(services.filter(service => pending.serviceIds.includes(service.id))) + retained
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
/** Cause copy is selected only from scoped fresh evidence, never guessed from an empty list. */
function availabilityRecoveryMessage(serviceName: string, day: string, reasons: readonly AvailabilityCause[], professionalName?: string): string {

  const copy: Record<AvailabilityCause, string> = {
    BUSINESS_CLOSED: 'El local no atiende ese día.',
    PROFESSIONAL_NOT_WORKING: professionalName ? professionalName + ' no tiene jornada de atención ese día.' : 'No hay jornada de atención ese día para uno o más de los profesionales compatibles.',
    NO_COMPATIBLE_WINDOW: professionalName ? 'Las jornadas del local y de ' + professionalName + ' no tienen una ventana de atención coincidente.' : 'Para uno o más profesionales, la jornada no coincide con la atención del local.',
    DURATION_DOES_NOT_FIT: 'No queda una ventana con la duración completa que necesita este pedido.',
    LEAD_TIME: 'Los horarios posibles no cumplen la anticipación mínima para reservar.',
    BLOCKED: 'Hay bloqueos de agenda que impiden completar este pedido.',
    BUSY: 'Hay turnos ocupados que impiden completar este pedido.',
    DATE_PAST: 'La fecha ya pasó.',
    OUTSIDE_HORIZON: 'La fecha queda fuera del período habilitado para buscar turnos.',
    PREFERENCE_NO_MATCH: 'No hay horarios que cumplan esa preferencia.',
    REQUESTED_START_OUTSIDE_BUSINESS_HOURS: 'El inicio solicitado queda fuera de la atención del local.',
    REQUESTED_START_OUTSIDE_PROFESSIONAL_HOURS: 'El inicio solicitado queda fuera de la jornada del profesional.',
    NO_SLOTS: 'No encontré horarios disponibles para este pedido.'
  }
  return 'Para ' + serviceName + ' el ' + day + ':\n' + (reasons.length ? reasons.map(reason => copy[reason]).join('\n') : copy.NO_SLOTS)
}
async function respondBooking(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision, preparedCatalog?: DialogueService[], matching?: MatchRequest, presentationPage?: { kind: 'slots' | 'professionals' | 'dates'; cursor: number }): Promise<DialogueResponse> {
  if (!isCustomerText(message, 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  // A prepared turn has already applied every semantic operation: never reparse its information text.
  const text = preparedCatalog ? '' : normalize(message)
  let availability: AvailabilityDiagnostic | undefined
  let availabilityExplanation: AvailabilityExplanation | undefined
  let targetExplanation: RequestedStartExplanation | undefined
  let choicePresentation: ConversationChoicePresentation | undefined
  let questionOptions: DialogueQuestionOption[] = []
  let questionTarget: string | null = null
  let questionMatching: Parameters<typeof rememberDialogueQuestion>[4] = null
  // Verification failures invalidate dependent evidence, not an independently stated time preference.
  const invalidateAvailability = () => { state.slot = null; delete state.dialogueContext; delete state.questionContext }
  const finish = (reply: string, proposal: BookingProposal | null = null): DialogueResponse => {
    if (!hasActiveBooking(state) && /^¿En qué.*ayudar/.test(reply)) { delete state.questionContext; return { state, reply, proposal: null } }
    const questionLine = reply.trim().split('\n').map(line => line.match(/¿[^?]+\?$/)?.[0]).find(Boolean) ?? ''
    const expected = state.pending === 'estimate' && state.dialogueContext?.lastQuestion ? state.dialogueContext.lastQuestion : pendingQuestion(state)
    const question = expected.startsWith('¿') && reply.includes(expected) ? expected :
      questionLine.length <= 240 && questionLine ? questionLine : null
    if (hasBasketSelection(state) || state.dialogueContext || decision?.intent === 'booking' || /\b(?:turno|reservar|agendar)\b/.test(normalize(message))) state.dialogueContext = { lastQuestion: question, presentedOffer: state.dialogueContext?.presentedOffer ?? null }
    if (question || questionOptions.length) rememberDialogueQuestion(state, question ?? resolveDialogueRoute(state, [], state.pending).question, questionOptions, questionTarget, questionMatching)
    else delete state.questionContext
    const freshChoices = choicePresentation ?? (questionOptions.length ? choicePresentationForQuestion(state, preparedCatalog ?? services) : undefined)
    return { state, reply, proposal, ...(availability ? { availability } : {}), ...(freshChoices ? { choicePresentation: freshChoices } : {}) }
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
    const identityQuestion = category === 'service' && matching?.identityEvidence && result.items.length === 1
      ? serviceRequestReply({ businessId: context.businessId, purpose: 'booking', disposition: 'needs_detail',
          serviceIds: result.items.map(item => item.id), correction: false, continuation: false,
          basis: 'semantic_equivalent', sourceQuote: null, request: matching.identityEvidence }, services) : null
    const companions = identityQuestion ? selectionBasket(state).members.filter(member => member.mode === 'single')
      .flatMap(member => services.filter(service => member.serviceIds.includes(service.id))).map(service => service.name) : []
    const response = finish((identityQuestion ?? matchingQuestion(result, category)) +
      (companions.length ? '\nMantengo también: ' + companions.join(', ') + '.' : ''))
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
    if (!exact) {
      const targetMemberId = matching.targetMemberId
      const unresolved = selectionBasket(state).members.find(member => member.mode === 'unresolved' && member.memberId === targetMemberId)
      if (unresolved && (!result || result.kind === 'none')) return { ...finish(basketQuestion(state, services)!), replyPrepared: true }
      return askMatch(result ?? { kind: 'none', items: [], complete: true }, 'service')
    }
    mutateStateBasket(state, { kind: 'basket', mutation: matching.targetMemberId ? 'replace' : 'set', scope: matching.targetMemberId ? 'members' : 'all', targetMemberIds: matching.targetMemberId ? [matching.targetMemberId] : [],
      members: [{ mode: 'single', serviceIds: [exact.id], evidence: message, confidence: 1 }], evidence: message, confidence: 1 })
  }
  if (state.editRequest) return draftEditResponse(state, services)
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
      delete state.timeMeaningClarification; delete state.requestedTimeMode
      state.slot = null; delete state.dialogueContext; delete state.questionContext
      if (temporal.kind === 'preference') { state.timePreference = temporal.preference; state.requestedTime = null }
      else { delete state.timePreference; state.requestedTime = temporal.time }
    }
    preserveTemporal()
    if (name && !hasActiveBooking(state) && standaloneIdentityMessage(message,name)) return finish('¿En qué te puedo ayudar con el local?')
    const catalogQuestion = /(?:que|cuales|mostrame|mostrar).*servicios/.test(text)
    if (decision?.correction) { state.serviceId = null; delete state.basket; service = undefined; state.professional = null; clearSlot(state) }
    const serviceMatch = catalogQuestion || decision ? null : matchNamedItems({ businessId: context.businessId, category: 'service' }, message, services)
    if (serviceMatch?.kind === 'candidates' && (!decision && !hasBasketSelection(state))) {
      const date = extractDate(text, context)
      if (date && date !== state.date) { state.date = date; delete state.datePreferences; clearSlot(state) }
      preserveTemporal()
      return askMatch(serviceMatch, 'service')
    }
    const found = decision ? services.filter(item => decision.candidateIds.includes(item.id) || item.id === decision.serviceId)
      : catalogQuestion ? [] : matches(text, services)
    if (decision && found.length !== new Set([...decision.candidateIds, ...(decision.serviceId ? [decision.serviceId] : [])]).size) throw new Error('invalid decision catalog')
    if (found.length > 1) {
      const earlyDate = extractDate(text, context)
      if (earlyDate && earlyDate !== state.date) { state.date = earlyDate; delete state.datePreferences; clearSlot(state) }
      preserveTemporal()
      state.pending = resolveDialogueRoute(state, [], 'service').pending
      questionOptions = found.map(item => ({ id: item.id, label: item.name }))
      return finish(renderServices(found, 'booking'))
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
    if (date && date !== state.date) { state.date = date; delete state.datePreferences; clearSlot(state) }
    if (/^(otro dia|probamos otro dia)$/.test(text)) { state.date = null; clearSlot(state) }
    preserveTemporal()
    if (temporal?.kind === 'ambiguous') return finish('No pude confirmar una preferencia horaria única. ¿Qué horario o franja preferís?')
    prefix = catalogQuestion ? `${serviceList(services)}\n` : port.identity ? '' : /^(hola|buenas|como estas|sos linda|salimos)/.test(text) ? 'Hola. Te ayudo con tu turno.\n' : ''
  }
  if (state.timeMeaningClarification) return finish(timeMeaningQuestion(state))
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
    return { ...finish(`${prefix}¿Qué servicio necesitás?\n${serviceList(services) || 'No tengo servicios disponibles para consultar.'}`), ...(decision?.intent === 'booking' ? { replyPrepared: true as const } : {}) }
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
    return finish(guidanceQuestion(guidance.pending, context.businessId))
  }
  if (selectedServices.some(item => !item || !validBookableService(item,true))) return failedAvailability('INVALID_DURATION', 'preflight')
  let needsVerifiedSelection = selectedServices.some(item => item?.bookingPolicy?.attentionMode === 'GUIDED_ESTIMATE' || Number(item?.customerDurationMinutes ?? item?.durationMinutes) > Number(item?.durationMinutes))
  let verifiedCustomerDuration: number | undefined
  if (!state.date) {
    state.pending = resolveDialogueRoute(state, [], 'date').pending
    const question = presentDateTimeQuestion({ date: null, hasTemporalRequest: Boolean(state.timePreference || state.requestedTime), serviceName: service.name })!
    if (!port.verifiedDateChoices) return { ...finish(prefix + (state.datePreferences
      ? 'Mantengo tus fechas por orden de preferencia; no pude verificar disponibilidad con esta búsqueda. ¿Qué fecha querés que consultemos?'
      : question)), replyPrepared: true }
    const result = await port.verifiedDateChoices(selectedServices as DialogueService[], state.professional?.kind === 'specific' ? state.professional.id : undefined,
      state.serviceEstimates, { requestedTime: state.requestedTime, ...(state.timePreference ? { preference: state.timePreference } : {}) })
    if (!result.ok) {
      if (result.reason !== 'GUIDANCE_REQUIRED') return failedAvailability(result.reason, 'query')
      const fresh = resolveGuidance(result.services, state.serviceEstimates)
      if (fresh.blocked) return failedAvailability(fresh.blocked.reason, 'fresh_guidance')
      if (!fresh.pending) return failedAvailability('GUIDANCE_RESULT_NOT_PENDING', 'fresh_guidance')
      state.slot = null; state.serviceEstimates = fresh.selections; state.pending = 'estimate'; questionTarget = fresh.pending.id
      questionOptions = (fresh.pending.bookingPolicy?.estimateOptions ?? []).map(option => ({ id: option.id, label: option.label }))
      return finish(guidanceQuestion(fresh.pending, context.businessId))
    }
    validateBasketAvailability(result, basketServiceIds(state), state.serviceEstimates)
    const scope = { businessId: context.businessId, serviceIds: basketServiceIds(state), date: null, professionalId: state.professional?.kind === 'specific' ? state.professional.id : null }
    const dates = presentVerifiedDates({ scope, read: { fresh: true, scope, slots: result.slots }, timezone: context.timezone, now: context.dbNow,
      ...(state.datePreferences ? { orderedDates: state.datePreferences.map(item => item.value) } : {}),
      ...(presentationPage?.kind === 'dates' ? { cursor: presentationPage.cursor } : {}) })
    choicePresentation = adaptChoicePresentation(dates, 'dates', presentationPage?.kind === 'dates' ? presentationPage.cursor : 0)
    questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
    return finish(prefix + dates.text.replace('¿Qué día y horario te vendrían bien?', question))
  }
  if (state.date < localDateKey(context.dbNow, context.timezone)) {
    invalidateAvailability(); state.pending = 'date'
    availability = { outcome: 'no_slots', phase: 'slots', reason: 'DATE_PAST' }
    return finish('La fecha ' + dateLabel(state.date, context.timezone) + ' para ' + service.name + ' ya pasó. ¿Qué otro día querés consultar?')
  }
  let availabilityFailure: DialogueResponse | null = null
  const incompatiblePreference = (professionalId: string, professionals: DialogueProfessional[], proof?: ProfessionalEligibilityFailure): null => {
    if (!professionalId || !Array.isArray(professionals) || professionals.length > 50 ||
        new Set(professionals.map(item => item.id)).size !== professionals.length ||
        professionals.some(item => !bounded(item.id, 128) || !bounded(item.name, 200) || item.id === professionalId)) throw new Error('invalid compatible professional alternatives')
    invalidateAvailability(); state.professionalNameHint = null; state.pending = 'professional'
    availability = { outcome: 'blocked', phase: 'query', reason: 'PREFERRED_PROFESSIONAL_INCOMPATIBLE', scope: 'preferred' }
    const rendered = presentProfessionals(professionals, 0)
    choicePresentation = adaptChoicePresentation(rendered, 'professionals', 0)
    questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
    const explanation = proof ? professionalFailureMessage(proof, context.businessId, selectedServices as DialogueService[], professionalId) : 'La preferencia de profesional anterior no es compatible con el pedido actual.'
    availabilityFailure = finish(explanation + ' Mantengo los servicios, la fecha y tu preferencia; no elijo otra persona por vos.\n' + (professionals.length ? rendered.text : 'No pude verificar otro profesional compatible. Podés cambiar el pedido o consultar con el equipo.'))
    return null
  }
  const queryAvailability = async (professionalId?: string): Promise<{ professionals: DialogueProfessional[]; slots: AvailabilitySlot[] } | null> => {
    const scope = professionalId ? 'preferred' : 'all_compatible'
    const acceptExplanation = (result: { professionals: DialogueProfessional[]; explanation?: AvailabilityExplanation }) => {
      availabilityExplanation = result.explanation === undefined ? undefined : parseAvailabilityExplanation(result.explanation, {
        date: state.date!, professionals: result.professionals, dbNow: context.dbNow, timezone: context.timezone, ...(professionalId ? { professionalId } : {})
      })
    }
    const temporal = {requestedTime:state.requestedTime,...(state.timePreference ? {preference:state.timePreference} : {})}
    const acceptTarget = (result: {professionals:DialogueProfessional[];requestedStartEvidence?:RequestedStartEvidence}, durationMinutes:number, customerDurationMinutes:number) => {
      targetExplanation = undefined
      const time = state.requestedTime ?? (state.timePreference?.kind === 'around' ? state.timePreference.time : null)
      if (!time || !result.requestedStartEvidence) return
      try {
        targetExplanation = parseRequestedStartExplanation(result.requestedStartEvidence,{
          businessId:context.businessId,serviceIds:basketServiceIds(state),date:state.date!,time,durationMinutes,customerDurationMinutes,
          professionals:result.professionals,dbNow:context.dbNow,timezone:context.timezone,...(professionalId ? {professionalId} : {})
        })
      } catch { /* Missing or mismatched target proof never invents a cause or invalidates independent real slots. */ }
    }
    if (selectedServices.length <= 1 && !needsVerifiedSelection && selectedServices.every(item => item?.bookingPolicy === undefined)) {
      const result = await port.availability(service!, state.date!, professionalId, temporal)
      if (result.preferredProfessionalIncompatible) return incompatiblePreference(professionalId!, result.professionals, result.professionalFailure)
      acceptExplanation(result)
      acceptTarget(result,service!.durationMinutes!,Math.max(service!.durationMinutes!,service!.customerDurationMinutes ?? service!.durationMinutes!))
      availability = { outcome: 'verified', phase: 'slots', reason: null, scope }
      return result
    }
    if (!port.availabilityBasket) { availabilityFailure = failedAvailability('PORT_UNAVAILABLE', 'preflight'); return null }
    const result = await port.availabilityBasket(selectedServices as DialogueService[], state.date!, professionalId, state.serviceEstimates, temporal)
    if (!result.ok) {
      if (result.reason === 'PREFERRED_PROFESSIONAL_INCOMPATIBLE') {
        return incompatiblePreference(professionalId!, result.professionals, result.professionalFailure)
      }
      if (result.reason === 'NO_COMMON_PROFESSIONAL' && !professionalId && state.professionalNameHint && port.professionalInformation) {
        const identities = professionalIdentities(await port.professionalInformation({ kind: 'professional', actions: [], mention: null, serviceIds: [], date: null, weekday: null, aspect: 'overview' }), context.businessId)
        const named = matches(state.professionalNameHint, identities, context.businessId, 'professional')
        if (named.length === 1) {
          state.professional = { kind: 'specific', id: named[0]!.id }
          state.professionalNameHint = null
          return queryAvailability(named[0]!.id)
        }
      }
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
      availabilityFailure = finish(guidanceQuestion(fresh.pending, context.businessId))
      return null
    }
    const freshNeedsVerifiedSelection = result.services.some(item => item.bookingPolicy?.attentionMode === 'GUIDED_ESTIMATE' || Number(item.customerDurationMinutes ?? item.durationMinutes) > Number(item.durationMinutes))
    if ((needsVerifiedSelection || freshNeedsVerifiedSelection) && result.customerDurationMinutes === undefined) { availabilityFailure = failedAvailability('CUSTOMER_DURATION_PROOF_MISSING', 'contract', scope); return null }
    const verifiedGuidance = validateBasketAvailability(result, basketServiceIds(state), state.serviceEstimates)
    acceptExplanation(result)
    acceptTarget(result,result.durationMinutes,result.customerDurationMinutes ?? result.durationMinutes)
    if (verifiedGuidance.changed) { clearSlot(state); state.serviceEstimates = verifiedGuidance.selections }
    needsVerifiedSelection = freshNeedsVerifiedSelection
    verifiedCustomerDuration = result.customerDurationMinutes
    availability = { outcome: 'verified', phase: 'slots', reason: null, scope }
    for (const slot of result.slots) validateCoordinatedSlot(slot,{businessId:context.businessId,serviceIds:basketServiceIds(state),timezone:context.timezone,services:result.services})
    selectedServices = [...result.services]
    service = { ...result.services[0]!, name: result.services.map(item => item.name).join(' + '), durationMinutes: result.durationMinutes, price: result.totalPrice }
    return result
  }
  const available = await queryAvailability(state.professional?.kind === 'specific' ? state.professional.id : undefined)
  if (!available) return availabilityFailure!
  const professionals = available.professionals
  const identityQuery = matching?.category === 'professional' ? matching.query ?? matching.confirmationId : state.professionalNameHint
  const identityAlreadyKnown = matching?.confirmationId ? professionals.some(p => p.id === matching.confirmationId) : Boolean(identityQuery && matches(identityQuery, professionals, context.businessId, 'professional').length)
  const identities = identityQuery && !identityAlreadyKnown && port.professionalInformation ? professionalIdentities(await port.professionalInformation({ kind:'professional', actions:[], mention:null, serviceIds:[], date:null, weekday:null, aspect:'overview' }), context.businessId) : []
  const namedProfessionals = [...professionals, ...identities.filter(p => !professionals.some(fresh => fresh.id === p.id))]
  const professionalOptions = professionals.map(item => ({ id: item.id, label: item.name }))
  if (matching?.category === 'professional') {
    const result = requestedNamedMatch(matching, { businessId: context.businessId, category: 'professional' }, namedProfessionals)
    const proposed = result?.kind === 'exact' && result.items.length === 1 ? namedProfessionals.find(item => item.id === result.items[0]!.id) : undefined
    const exact = matching.confirmationId ? namedProfessionals.find(item => item.id === matching!.confirmationId) : exactNamedAnswer(matching, proposed)
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
      ? professionals : matches(professionalText, namedProfessionals, context.businessId, 'professional')
    const hint = state.professionalNameHint
    const named = namedNow.length ? namedNow : hint ? matches(hint, namedProfessionals, context.businessId, 'professional') : []
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
  if (!slots.length) {
    invalidateAvailability(); state.pending = 'date'
    availability = { ...availability!, outcome: 'no_slots', reason: availabilityExplanation?.reasons[0] ?? null }
    const preferredName = state.professional?.kind === 'specific' ? professionals.find(p => p.id === (state.professional as { id: string }).id)?.name : undefined
    let reply = availabilityRecoveryMessage(service.name, dateLabel(state.date, context.timezone), availabilityExplanation?.reasons ?? [], preferredName)
    const others = availabilityExplanation?.otherProfessionals ?? []
    if (others.length) reply += '\nTambién verifiqué opciones ese día: ' + others.map(slot => slot.time + ' con ' + slot.professionalName).join('; ') + '. Si te sirve otra persona, indicame cuál; no cambio tu preferencia sin que la elijas.'
    const nextDates = availabilityExplanation?.nextDates ?? []
    if (nextDates.length) {
      const scope = { businessId: context.businessId, serviceIds: basketServiceIds(state), date: null, professionalId: state.professional?.kind === 'specific' ? state.professional.id : null }
      const dates = presentVerifiedDates({ scope, read: { fresh: true, scope, slots: nextDates }, timezone: context.timezone, now: context.dbNow })
      choicePresentation = adaptChoicePresentation(dates, 'dates', 0)
      questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
      reply += '\n' + dates.text.replace('¿Qué día y horario te vendrían bien?', '¿Qué otro día querés consultar?')
    } else reply += '\n¿Qué otro día querés consultar?'
    return finish(reply)
  }
  if (!state.professional && slots.some(slot => slot.coordination)) {
    // Any assignment is only a search scope; the customer still selects an entire offered option.
    state.professional = {kind:'any'}
  }
  if (!state.professional) {
    state.pending = resolveDialogueRoute(state, [], 'professional').pending
    const cursor = presentationPage?.kind === 'professionals' ? presentationPage.cursor : 0
    const rendered = presentProfessionals(professionals, cursor)
    choicePresentation = adaptChoicePresentation(rendered, 'professionals', cursor)
    questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
    return finish(prefix + rendered.text)
  }
  if (state.slot && !slots.some(s => s.startAt === state.slot!.startAt && s.professionalId === state.slot!.professionalId && s.coordination?.key === state.slot!.coordination?.key)) state.slot = null
  if (state.timePreference) {
    const unfiltered = slots
    slots = state.timePreference.kind === 'earliest' ? slots : filterTimePreference(slots, state.timePreference)
    if (!slots.length) {
      invalidateAvailability(); state.pending = 'time'
      availability = { ...availability!, outcome: 'no_slots', reason: 'PREFERENCE_NO_MATCH' }
      const scope = { businessId: context.businessId, serviceIds: basketServiceIds(state), date: state.date, professionalId: state.professional.kind === 'specific' ? state.professional.id : null }
      const rendered = presentAvailability({ scope, read: { fresh: true, scope, slots: unfiltered.slice(0, 3) }, timezone: context.timezone, now: context.dbNow, requestedTime: null })
      choicePresentation = adaptChoicePresentation(rendered, 'slots', 0)
      questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
      return finish('No hay horarios para ' + service.name + ' el ' + dateLabel(state.date, context.timezone) + ' que cumplan esa preferencia. Mantengo el día y el pedido.\nEstas opciones sí están disponibles en otro horario:\n' + rendered.text)
    }
  }
  if (state.requestedTime && state.requestedTimeMode !== 'inquiry' && !state.slot) {
    const selected = slots.filter(s => s.time === state.requestedTime)
    if (!selected.some(slot => slot.coordination) && (selected.length === 1 || selected.length > 1 && state.professional.kind === 'any' && new Set(selected.map(slot => Date.parse(slot.startAt))).size === 1)) state.slot = selected[0]!

  }
  if (!state.slot) {
    state.pending = resolveDialogueRoute(state, [], 'time').pending
    state.dialogueContext = { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: context.businessId, serviceId: service.id, date: state.date,
      professionalId: state.professional.kind === 'specific' ? state.professional.id : null, ...(selectedServices.length > 1 ? { serviceId: null, serviceIds: basketServiceIds(state), durationMinutes: service.durationMinutes! } : {}) } }
    const scope = { businessId: context.businessId, serviceIds: basketServiceIds(state), date: state.date, professionalId: state.professional.kind === 'specific' ? state.professional.id : null }
    const cursor = presentationPage?.kind === 'slots' ? presentationPage.cursor : 0
    const rendered = presentAvailability({ scope, read: { fresh: true, scope, slots }, timezone: context.timezone, now: context.dbNow,
      ...(state.timePreference ? { preference: state.timePreference } : {}), requestedTime: state.requestedTime, cursor })
    choicePresentation = adaptChoicePresentation(rendered, 'slots', cursor)
    questionOptions = (choicePresentation?.choices ?? []).map(choice => ({ id: choiceOptionId(choice.operation), label: choice.label }))
    const targetTime = state.requestedTime ?? (state.timePreference?.kind === 'around' ? state.timePreference.time : null)
    const absentTarget = targetTime && !slots.some(slot => slot.time === targetTime)
    const targetNote = absentTarget ? requestedTimeExplanation(targetTime,targetExplanation) + '\n' : ''
    return finish(prefix + targetNote + rendered.text.replace('Estos horarios están disponibles.', `Horarios disponibles para ${dateLabel(state.date,context.timezone)}:`).replace('¿Cuál te viene bien?', '¿Cuál elegís?')) }
  if (!state.customerName) { state.pending = resolveDialogueRoute(state, [], 'name').pending; return finish(`${prefix}¿A nombre de quién sería el turno?`) }
  state.pending = resolveDialogueRoute(state, [], 'proposal').pending
  const summary = selectionSummary(selectedServices as DialogueService[])
  const finalGuidance = resolveGuidance(selectedServices as DialogueService[],state.serviceEstimates)
  const proposal: BookingProposal = { ...(state.slot.coordination ? {segments:structuredClone(state.slot.coordination.segments)} : {}), kind: 'BOOKING_PROPOSAL', businessId: context.businessId, serviceId: service.id, professionalId: state.slot.professionalId, startAt: state.slot.startAt, customerName: state.customerName,
    ...(selectedServices.length > 1 || needsVerifiedSelection ? { serviceIds: basketServiceIds(state), services: selectedServices as DialogueService[], durationMinutes: summary.durationMinutes, totalPrice: summary.totalPrice } : {}), ...(verifiedCustomerDuration !== undefined ? {customerDurationMinutes:verifiedCustomerDuration} : {}), ...(Object.keys(finalGuidance.estimates).length ? {estimates:finalGuidance.estimates} : {}) }
  const details = selectedServices.length > 1 ? ' (' + summary.durationMinutes + ' min; ' + (summary.totalPrice === null ? 'precio total a consultar' : '$ ' + summary.totalPrice.toLocaleString('es-AR')) + ')' : ''
  const estimates = renderGuidedEstimates(selectedServices as DialogueService[],state.serviceEstimates ?? {},context.businessId)
  return finish(`${prefix}Propuesta: ${service.name}${details}, ${state.date.split('-').reverse().join('/')} a las ${state.slot.time} ${state.slot.coordination ? '· ' + coordinationLabel(state.slot,context.timezone) : 'con ' + state.slot.professionalName}, a nombre de ${state.customerName}. Todavía no está reservado.${estimates ? '\n' + estimates : ''}`, proposal)
}

/** Apply independent semantic updates in dependency order, then reuse the existing booking progression. */
async function respondTurnPlan(context: DialogueContext, state: DialogueState, message: string, port: DialoguePort, rawPlan: unknown, intent?: DialogueDecision['intent'], informationOnly = false, communicative?: CommunicativeAdmission, catalogInquiries: readonly CatalogInquiryScope[] = []): Promise<DialogueResponse> {
  // Validated AI admission already grounded and filtered these operations. Repeating
  // inference here would recreate a field that was rejected as historical/uncertain.
  // Direct and deterministic callers have no admission and retain their grounding.
  let raw = parseTurnPlan(communicative ? rawPlan : groundTemporalPlan(rawPlan, message, state, {businessId:context.businessId,timezone:context.timezone,businessDate:localDateKey(context.dbNow,context.timezone),...(port.businessTimeContext ? {read:port.businessTimeContext} : {})}), message)
  if (communicative?.timeMeaningRejected) {
    state.requestedTime = null; state.slot = null; delete state.requestedTimeMode
    delete state.timePreference; delete state.timeClarification
    delete state.dialogueContext; delete state.questionContext
    if (state.sandboxReservation && !state.sandboxReservation.receipt) delete state.sandboxReservation
    state.timeMeaningClarification = true
    state.pending = 'time'
  }
  if (communicative?.social && raw.operations.length === 0 && !communicative.blockedFields.length && !communicative.reference) {
    const next = hasActiveBooking(state) ? state.questionContext?.question ?? socialQuestion(state) : '¿En qué te puedo ayudar con el local?'
    return { state, reply: next, replyFacts: socialContinuationFacts(next), proposal: null, replyPrepared: true }
  }
  if (communicative?.continuity && raw.operations.length === 0 && communicative.plan.operations.length === 0 && !communicative.blockedFields.length && !communicative.reference) {
    // Notice, pause and repair retain the recoverable question/draft. Do not run
    // matching, implicit information, procedure progression or availability for them.
    return { state, reply: conversationalContinuityReply(communicative.continuity, state), proposal: null, replyPrepared: true }
  }
  const semanticPending = Boolean(communicative?.blockedFields.length || communicative?.reference || state.professionalReference)
  const possibleMatch = !semanticPending && !socialMessage(message) && (state.pending === 'professional' || state.pending === 'estimate' || state.pending === 'service') && !raw.operations.some(op => op.kind === 'information')
  const needsCatalog = Boolean(state.serviceRequest || state.referral || state.informationFocus) || possibleMatch || raw.operations.some(op => !['information', 'unsupported_action'].includes(op.kind) || op.kind === 'information' && (op.target.kind === 'service' || op.target.kind === 'professional' && op.target.serviceIds.length > 0 || op.target.kind === 'business' && op.target.actions.some(action => ['SERVICES', 'PRICES', 'SERVICE_DETAILS'].includes(action))))
  const services = needsCatalog ? await port.catalog() : []
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200) || s.price !== null && (!Number.isFinite(s.price) || s.price < 0)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  raw = parseTurnPlan(normalizeInformativeEstimates(raw, state, services), message, services.map(service => service.id))
  // The AI proposal is transient. Only current-catalog supported identities enter selected state.
  // Keep a candidate separately until the sanitized basket has a stable member ID for its question.
  const identityCandidates: { evidence: string; serviceIds: string[] }[] = []
  raw = { ...raw, operations: raw.operations.map(operation => {
    if (operation.kind !== 'basket') return operation
    return { ...operation, members: operation.members.map(member => {
      if (member.mode !== 'single') return member
      const retainedIds = operation.mutation === 'replace' && operation.scope === 'all' && operation.members.length === 1
        ? selectionBasket(state).members.filter(item => item.mode === 'single').flatMap(item => item.serviceIds) : []
      const proof = assessServiceIdentity(member.evidence, member.serviceIds[0]!, member.confidence, services, retainedIds)
      if (proof.kind === 'supported') return member
      if (proof.kind === 'alternatives') return { ...member, mode: 'alternatives' as const, serviceIds: proof.serviceIds }
      if (proof.kind === 'confirm') identityCandidates.push({ evidence: member.evidence, serviceIds: proof.serviceIds })
      return { ...member, mode: 'unresolved' as const, serviceIds: [] }
    }) }
  }) }
  // Composition is checked on a copy after identity grounding, before any draft effect.
  const admittedServiceReferences = communicative?.plan.operations.filter(operation => operation.kind === 'service_reference') ?? []
  const currentBindings = communicative ? remapInquiryBindings(communicative.inquiryBindings ?? [], communicative.plan, raw) : []
  const beforeProtection = raw
  const prospective = protectProspectiveBasket({ ...communicative, plan: raw, blockedFields: communicative?.blockedFields ?? [],
    ...(communicative?.reference ? { reference: communicative.reference } : {}),
    ...(communicative?.timeMeaningRejected ? { timeMeaningRejected: true as const } : {}) }, state)
  raw = prospective.plan
  prospective.inquiryBindings = remapInquiryBindings(currentBindings, beforeProtection, raw)
  if (communicative || prospective.blockedFields.length) communicative = prospective
  const procedureOp = raw.operations.find(operation => operation.kind === 'service_request')
  const inquiryTurn = procedureOp?.purpose === 'inquiry' || state.serviceRequest?.purpose === 'inquiry' &&
    !raw.operations.some(operation => ['service', 'basket'].includes(operation.kind) || operation.kind === 'service_request' && operation.purpose === 'booking')
  const suppressMatching = semanticPending || prospective.blockedFields.length > 0 || inquiryTurn
  let procedureQuestion = ''
  let localProcedureRequest: ServiceRequestContext | undefined
  const serviceReferenceOp = raw.operations.find(operation => operation.kind === 'service_reference')
  const referenceAdmitted = serviceReferenceOp?.kind === 'service_reference' && serviceReferenceOp.confidence >= .85 &&
    admittedServiceReferences.some(operation => operation.kind === 'service_reference' &&
      operation.action === serviceReferenceOp.action && operation.serviceId === serviceReferenceOp.serviceId &&
      operation.evidence === serviceReferenceOp.evidence && operation.confidence === serviceReferenceOp.confidence)
  const previousProcedureRequest = state.serviceRequest
  const referenceAnswer = referenceAdmitted && serviceReferenceOp.action === 'confirm' &&
    validServiceReferenceContext(state.serviceRequest, serviceReferenceOp.serviceId, context.businessId, services, state.questionContext)
  const candidateSelection = referenceAdmitted && serviceReferenceOp.action === 'select' &&
    state.serviceRequest?.serviceIds.length === 1 &&
    validServiceCandidateContext(state.serviceRequest, serviceReferenceOp.serviceId, context.businessId, services, state.questionContext)
  if (referenceAnswer && previousProcedureRequest?.purpose === 'inquiry' && raw.operations.length === 1) {
    return readServiceCandidate(context, state, previousProcedureRequest, serviceReferenceOp.serviceId, port, services)
  }
  if (referenceAnswer && state.serviceRequest) state.serviceRequest = { ...state.serviceRequest, referenceConfirmed: true }
  // Selection has separate semantic authority; confirm alone never mutates the booking draft.
  raw = { ...raw, operations: raw.operations.filter(operation => operation.kind !== 'service_reference') }
  if (candidateSelection && previousProcedureRequest) {
    mutateStateBasket(state, serviceCandidateMutation(state, previousProcedureRequest, serviceReferenceOp.serviceId,
      serviceReferenceOp.evidence, serviceReferenceOp.confidence))
    delete state.serviceRequest
    reconcileConversationalReferral(state, services)
  }
  const unverifiedReads = new Map<string, ServiceRequestContext>()
  if (state.serviceRequest) {
    const ids = state.serviceRequest.serviceIds.filter(id => services.some(service => service.id === id))
    if (ids.length !== state.serviceRequest.serviceIds.length || state.serviceRequest.candidateName !== undefined &&
        (ids.length !== 1 || services.find(service => service.id === ids[0])?.name !== state.serviceRequest.candidateName)) {
      delete state.serviceRequest.referenceConfirmed
      delete state.serviceRequest.candidateName
      state.serviceRequest = { ...state.serviceRequest, serviceIds: ids, disposition: 'unverified_variant' }
    }
    procedureQuestion = serviceRequestReply(state.serviceRequest, services)
  }
  if (procedureOp?.kind === 'service_request') {
    const request = resolveServiceRequest(procedureOp, procedureOp.evidence, procedureOp.confidence, services, state.serviceRequest)
    const previousRequest = state.serviceRequest
    const requestBase = referenceAnswer ? previousProcedureRequest!.request : retainServiceRequestBase(previousProcedureRequest, request, procedureOp.evidence, services, procedureOp.confidence >= .85)
    const requestContext: ServiceRequestContext = {
      ...request,
      businessId: context.businessId,
      ...(request.disposition !== 'clear' && request.serviceIds.length === 1
        ? { candidateName: services.find(service => service.id === request.serviceIds[0])!.name } : {}),
      request: requestBase,
      ...(previousProcedureRequest && requestBase === previousProcedureRequest.request && requestBase !== procedureOp.evidence
        ? { subject: previousProcedureRequest.subject ?? null, aspect: request.aspect ?? previousProcedureRequest.aspect ?? null } : {}),
      ...(previousProcedureRequest?.referenceConfirmed && requestBase === previousProcedureRequest.request &&
        request.basis === 'related_category' && request.serviceIds.length === 1 &&
        previousProcedureRequest.serviceIds[0] === request.serviceIds[0] &&
        previousProcedureRequest.candidateName === services.find(service => service.id === request.serviceIds[0])?.name
        ? { referenceConfirmed: true as const } : {}),
      ...(previousProcedureRequest && requestBase === previousProcedureRequest.request && requestBase !== procedureOp.evidence
        ? { detail: procedureOp.evidence } : {})
    }
    // A lateral read is local: the retained booking request still owns its continuation.
    const retainBooking = request.purpose === 'inquiry' && previousRequest?.purpose === 'booking'
    if (!retainBooking) delete state.serviceRequest
    procedureQuestion = ''
    const others = raw.operations.filter(operation => operation !== procedureOp)
    if (request.purpose === 'inquiry' && request.disposition === 'clear' && previousRequest?.purpose === 'inquiry' &&
        !others.length && validServiceCandidateContext(previousRequest, request.serviceIds[0]!, context.businessId, services, state.questionContext, false)) {
      return readServiceCandidate(context, state, { ...previousRequest, aspect: request.aspect ?? previousRequest.aspect ?? null }, request.serviceIds[0]!, port, services)
    }
    if (request.disposition === 'clear') {
      const resolvedOperation: TurnPlan['operations'][number] = request.purpose === 'inquiry'
        ? { kind: 'information', evidence: procedureOp.evidence, confidence: procedureOp.confidence,
            target: { kind: 'service', actions: [], serviceIds: [...request.serviceIds], aspect: request.aspect ?? informationAspect(message) ?? 'overview' } }
        : { kind: 'service', mode: 'single', serviceIds: request.serviceIds, correction: request.correction,
            evidence: procedureOp.evidence, confidence: procedureOp.confidence }
      raw = { ...raw, operations: [...others, resolvedOperation] }
    } else {
      if (!retainBooking) state.serviceRequest = requestContext
      else localProcedureRequest = requestContext
      procedureQuestion = serviceRequestReply(requestContext, services)
      for (const binding of prospective.inquiryBindings ?? []) {
        if (raw.operations[binding.requestOperationIndex] !== procedureOp) continue
        const information = raw.operations[binding.informationOperationIndex]
        if (information?.kind === 'information') unverifiedReads.set(JSON.stringify(information), requestContext)
      }
      raw = { ...raw, operations: others }
    }
  } else if (raw.operations.some(operation => operation.kind === 'basket' || operation.kind === 'service')) {
    delete state.serviceRequest
    procedureQuestion = ''
  }
  const implicitRead = inquiryTurn ? null : inferInformationTarget(state, message, services)
  const explicitBooking = /\b(reservar|agendar|turno)\b/.test(normalizeAnswer(message)) && !routeActions(message).information.length
  if (implicitRead && intent !== 'booking' && !explicitBooking && !raw.operations.some(op => op.kind === 'information') &&
      raw.operations.every(op => ['name', 'service', 'basket'].includes(op.kind))) {
    raw = parseTurnPlan({ version: 1, operations: [...raw.operations.filter(op => op.kind === 'name'),
      { kind: 'information', target: implicitRead, evidence: message, confidence: 1 }] }, message, services.map(service => service.id))
  }
  if (state.informationFocus && implicitRead?.kind === 'service' && !explicitBooking) {
    raw = { ...raw, operations: raw.operations.filter(op => op.kind !== 'name' || explicitIdentity(message, op.value)) }
  }
  // A validated semantic no-op is not an answer to a pending entity. Explicit
  // operations and information routes retain authority over this social route.
  const route = routeActions(message)
  if (!candidateSelection && !suppressMatching && !state.referral && !procedureQuestion && intent === 'other' && raw.operations.length === 0 && !route.information.length && !route.pendingAction) {
    return { state, proposal: null, reply: hasActiveBooking(state) ? socialQuestion(state) : '¿En qué te puedo ayudar con el local?' }
  }
  // A validated booking no-op requests progression, not a search for the whole utterance.
  // Stored clarification/correction scopes still own their answers; explicit operations run below.
  if (!suppressMatching && intent === 'booking' && raw.operations.length === 0 && !state.referral && !procedureQuestion &&
      !state.editRequest && !route.information.length && !route.pendingAction && !hasBasketSelection(state)) {
    const question = state.questionContext
    if (question?.field === 'service' && question.matchCandidateIds && !affirmativeMatchAnswer(message, [])) {
      return respondBooking(context, state, message, port, undefined, services,
        { category: 'service', candidateIds: question.matchCandidateIds })
    }
    if (!question?.matchCandidateIds) return respondBooking(context, state, message, port,
      { intent, serviceId: null, candidateIds: [], correction: false }, services)
  }
  const matched: ReturnType<typeof matchingTurn> = suppressMatching ? { plan: raw } : matchingTurn(state, message, raw, context, services)
  const firstUnresolved = raw.operations.flatMap(operation => operation.kind === 'basket' ? operation.members : []).find(member => member.mode === 'unresolved')
  const identityCandidate = identityCandidates.find(candidate => candidate.evidence === firstUnresolved?.evidence)
  if (identityCandidate) matched.matching = { category: 'service', candidateIds: identityCandidate.serviceIds, identityEvidence: identityCandidate.evidence }
  const contextual = contextualizeIdentity(matched.plan, state, message)
  const tentativeTemporal = contextual.plan.operations.some(op => (op.kind === 'time_preference' || op.kind === 'time' || op.kind === 'time_clarification') && op.confidence < 0.85)
  const plan = { ...contextual.plan, operations: contextual.plan.operations.filter(op => op.kind !== 'time_preference' && op.kind !== 'time' && op.kind !== 'time_clarification' || op.confidence >= 0.85) }
  const currentServiceInquiries = communicative ? remapCurrentServiceInquiries(communicative.currentServiceInquiries ?? [],
    communicative.plan, plan, message, context.businessId) : []
  const currentServiceReads = communicative ? remapCurrentServiceReads(communicative.currentServiceReads ?? [],
    communicative.plan, plan, message, context.businessId) : []
  const identityClarification = contextual.clarify && matched.matching?.category !== 'professional' ? '¿Ese nombre corresponde al cliente o al profesional? Indicame a quién te referís.' : ''
  const clarificationReply = [identityClarification, tentativeTemporal ? 'No pude confirmar esa elección o preferencia horaria. ¿Qué horario o franja preferís?' : ''].filter(Boolean).join('\n')
  const originalOffer = state.dialogueContext?.presentedOffer ? structuredClone(state.dialogueContext.presentedOffer) : null
  const updates = plan.operations.filter(op => !['information', 'unsupported_action', 'request_change', 'referral'].includes(op.kind))
  const bookingUpdates = updates.filter(op => op.kind !== 'name')
  if (candidateSelection) delete state.informationFocus
  if (bookingUpdates.length) delete state.informationFocus
  const invalidate = (clearTime: boolean) => { state.slot = null; if (clearTime) { state.requestedTime = null; delete state.requestedTimeMode } delete state.dialogueContext; delete state.questionContext }
  const serviceOp = plan.operations.find(op => op.kind === 'service')
  const basketOp = plan.operations.find(op => op.kind === 'basket')
  if (basketOp?.kind === 'basket') mutateStateBasket(state, basketOp)
  else if (serviceOp?.kind === 'service' && serviceOp.mode === 'single' && !serviceOp.correction &&
      validServiceCandidateContext(previousProcedureRequest, serviceOp.serviceIds[0]!, context.businessId, services, state.questionContext)) {
    mutateStateBasket(state, serviceCandidateMutation(state, previousProcedureRequest!, serviceOp.serviceIds[0]!,
      serviceOp.evidence, serviceOp.confidence))
  } else if (serviceOp?.kind === 'service' && (serviceOp.mode !== 'unresolved' || serviceOp.correction || !hasBasketSelection(state))) {
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
  const prioritiesOp = plan.operations.find(op => op.kind === 'date_preferences')
  let uncertainDate = false
  if (prioritiesOp?.kind === 'date_preferences') {
    const resolved = resolveDatePreferences(prioritiesOp.candidates, localDateKey(context.dbNow, context.timezone))
    const priorities = resolved && resolved.every(item => localDateTimeToInstants(item.value, 720, context.timezone).length) ? resolved : null
    uncertainDate = !priorities
    if (priorities) {
      if (state.date || state.slot || JSON.stringify(state.datePreferences) !== JSON.stringify(priorities)) invalidate(Boolean(state.slot))
      state.date = null; state.datePreferences = priorities
    }
  }
  if (dateOp?.kind === 'date') {
    const today = localDateKey(context.dbNow, context.timezone)
    const resolution = resolveDialogueDate(dateOp.expression, today)
    const resolved = resolution.kind === 'resolved' && (!dateOp.value || dateOp.value === resolution.date) ? resolution.date
      : resolution.kind === 'unsupported' ? dateOp.value ?? null : null
    const date = resolved && resolved >= today && localDateTimeToInstants(resolved, 720, context.timezone).length ? resolved : null
    uncertainDate = !date
    if (date !== state.date || !date) { invalidate(Boolean(state.date) && state.requestedTimeMode !== 'inquiry' || !date); state.date = date }
    if (date) delete state.datePreferences
  }
  const professionalOp = plan.operations.find(op => op.kind === 'professional')
  if (professionalOp?.kind === 'professional') {
    const mention = professionalOp.mode === 'specific' ? normalize(professionalOp.mention) || null : null
    // The current slot binds its name to the verified professional ID; aliases remain untrusted hints.
    const sameSpecific = professionalOp.mode === 'specific' && mention && state.professional?.kind === 'specific' &&
      state.slot?.professionalId === state.professional.id && normalize(state.slot.professionalName) === mention
    const sameAny = professionalOp.mode === 'any' && state.professional?.kind === 'any'
    if (!sameSpecific && !sameAny) invalidate(Boolean(state.professional) && state.requestedTimeMode !== 'inquiry')
    if (!sameSpecific) state.professional = professionalOp.mode === 'any' ? { kind: 'any' } : null
    state.professionalNameHint = mention
  }
  const referenceOp = plan.operations.find(op => op.kind === 'professional_reference')
  if (referenceOp?.kind === 'professional_reference' && referenceOp.confidence >= .85 && state.professionalReference &&
      referenceOp.evidence === message && state.professionalReference.scope === professionalReferenceScope(state) &&
      communicative && !communicative.blockedFields.includes('professional')) {
    // Only the previously scoped server reference supplies the name. No model ID or new name is accepted.
    const reference = parseProfessionalReference(state.professionalReference, state)
    if (referenceOp.action === 'prefer') {
      invalidate(Boolean(state.professional) && state.requestedTimeMode !== 'inquiry')
      state.professional = null
      state.professionalNameHint = normalize(reference.mention) || null
    }
    delete state.professionalReference
  }
  const timeOp = plan.operations.find(op => op.kind === 'time')
  if (timeOp?.kind === 'time') { delete state.timeMeaningClarification; delete state.timeClarification; delete state.timePreference; delete state.requestedTimeMode; invalidate(false); state.requestedTime = timeOp.value }
  const clarificationOp = plan.operations.find(op => op.kind === 'time_clarification')
  if (clarificationOp?.kind === 'time_clarification') { delete state.timeMeaningClarification; invalidate(true); delete state.timePreference; state.timeClarification = parseTimeClarification({candidateTimes:clarificationOp.candidateTimes}) }
  const preferenceOp = plan.operations.find(op => op.kind === 'time_preference')
  if (preferenceOp?.kind === 'time_preference') { delete state.timeMeaningClarification; delete state.timeClarification; invalidate(true); state.timePreference = parseTimePreference(preferenceOp.preference) }
  if (communicative?.temporalInquiry && state.requestedTime) { state.requestedTimeMode = 'inquiry'; state.slot = null }
  const nameOp = plan.operations.find(op => op.kind === 'name')
  if (nameOp?.kind === 'name') state.customerName = nameOp.value.trim()
  if (!procedureQuestion && communicative?.social && !communicative.blockedFields.length && !communicative.reference && plan.operations.every(op => op.kind === 'name') && state.pending !== 'name' && !contextual.clarify) {
    const next = hasActiveBooking(state) ? state.questionContext?.question ?? socialQuestion(state) : '¿En qué te puedo ayudar con el local?'
    return { state, reply: next, replyFacts: socialContinuationFacts(next), proposal: null, replyPrepared: true }
  }

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
  const appliedFields = new Set(updates.flatMap(op => op.kind === 'basket' ? ['service'] : op.kind === 'date_preferences' && !uncertainDate ? ['date'] : op.kind === 'time_preference' ? ['time'] : DRAFT_EDIT_FIELDS.includes(op.kind as DraftEditField) ? [op.kind] : []))
  const requests = plan.operations.flatMap(op => op.kind === 'request_change' ? [op.field] : [])
  const editing = [...new Set([...(state.editRequest?.fields ?? []).filter(field => !appliedFields.has(field)), ...requests])]
  if (editing.length) {
    state.editRequest = { fields: editing }
    state.pending = editing[0]!
    delete state.sandboxReservation
    if (requests.length) { delete state.questionContext; delete state.informationFocus }
  } else delete state.editRequest
  if (candidateSelection || bookingUpdates.length || nameOp && hasActiveBooking(state)) state.pending = resolveDialogueRoute(state, services).pending

  // A material independent edit invalidates the old reference; stamp a new one only after those edits.
  if (state.professionalReference && state.professionalReference.scope !== professionalReferenceScope(state)) delete state.professionalReference
  if (communicative?.reference) state.professionalReference = createProfessionalReference(state, communicative.reference.mention, communicative.reference.evidence)

  // Facts are read after applying fields, so an unavailable information read cannot roll back valid preferences.
  const answers: string[] = []
  const informationReads: InformationRead[] = []
  const informationAnswers = new Map<number, InformationRead>()
  for (const op of plan.operations) {
    if (op.kind === 'unsupported_action') answers.push('Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.')
    if (op.kind !== 'information') continue
    if (op.target.kind === 'presented_offer') {
      const offer = originalOffer
      answers.push(offer ? 'Los horarios que te mostré corresponden a ' + dateLabel(offer.date, context.timezone) + '.'
        : 'No tengo una oferta de horarios mostrada para identificar.')
      continue
    }
    const procedure = unverifiedReads.get(JSON.stringify(op))
    const currentServiceInquiry = currentServiceInquiries.find(scope => scope.operationIndex === plan.operations.indexOf(op))
    const currentServiceRead = currentServiceReads.find(scope => scope.operationIndex === plan.operations.indexOf(op))
    const catalogInquiry = catalogInquiries.find(scope => scope.operation === JSON.stringify(op) && validCatalogInquiry(scope, context.businessId, message, op.target, services))
    const read = await readInformation(context, state, catalogInquiry ? message : op.evidence, port, op.target, services,
      procedure || currentServiceInquiry || currentServiceRead || catalogInquiry ? { ...(catalogInquiry ? { catalogInquiry } : {}), ...(procedure ? { unverifiedProcedure: procedure } : {}),
        ...(currentServiceInquiry ? { currentServiceInquiry } : {}), ...(currentServiceRead ? { currentServiceRead } : {}) } : undefined)
    informationReads.push(read)
    if (read.focus) state.informationFocus = read.focus
    informationAnswers.set(answers.length, read)
    answers.push(read.reply)
  }
  const combinedAnswers = (next: DialogueResponse): string[] => {
    const pending = next.state.pending === 'estimate' ? resolveGuidance(services.filter(service => basketServiceIds(next.state).includes(service.id)), next.state.serviceEstimates).pending : null
    const coveredId = pending && next.reply === guidanceDelivery(pending, context.businessId).reply ? pending.id : null
    return answers.map((answer, index) => {
      const coverage = informationAnswers.get(index)?.guidanceCoverage
      return coverage && coverage.serviceId === coveredId ? coverage.remainder : answer
    })
  }
  // Only one validated explanatory read owns replacement copy. Every other
  // current answer remains a server fact in its original operation position.
  const catalogAnswers = [...informationAnswers.entries()].filter(([, read]) => read.catalogInformation)
  const catalogAnswer = catalogAnswers.length === 1 ? catalogAnswers[0] : undefined
  const answerFacts = () => answers.map((text, index) => ({ id: catalogAnswer?.[0] === index ? 'catalog' : 'answer' + index, text }))
  const finishWithoutAgenda = (reply: string): DialogueResponse => {
    const lastRead = informationReads.at(-1)
    const next = reply || (lastRead ? informationNext(lastRead, state, hasActiveBooking(state)) : '')
    if (!reply && lastRead) rememberInformationContinuation(state, lastRead, next)
    return { state, reply: [...answers, next, clarificationReply].filter(Boolean).join('\n'), proposal: null,
      ...(catalogAnswer && !reply && !clarificationReply ? { catalogInformation: catalogAnswer[1].catalogInformation!,
        replyFacts: [...answerFacts(), ...(next ? [{ id: 'next', text: next }] : [])] } : {}),
      ...(lastRead?.focus && !reply ? informationChoiceFields(state) : {}) }
  }
  if (state.timeMeaningClarification) {
    return { state, reply: [...answers, timeMeaningQuestion(state)].filter(Boolean).join('\n'), proposal: null, replyPrepared: true }
  }
  if (state.professionalReference) {
    return { state, reply: [...answers, state.professionalReference.question].filter(Boolean).join('\n'), proposal: null, replyPrepared: true }
  }
  if (communicative?.blockedFields.length) {
    return { state, reply: [...answers, communicativeClarification(communicative)].filter(Boolean).join('\n'), proposal: null, replyPrepared: true }
  }
  reconcileConversationalReferral(state, services)
  const referralOperation = plan.operations.find(operation => operation.kind === 'referral')
  if (referralOperation?.kind === 'referral' && referralOperation.confidence >= 0.85) {
    if (referralOperation.action === 'consult') {
      if (!state.referral) return finishWithoutAgenda('¿Qué pedido querés consultar con el equipo?')
      // A runtime capability is not consent. The whole current message must
      // independently select consultation; a model fragment or contextual yes cannot.
      if (context.humanHandoff && explicitReferralAction(message) !== 'consult') {
        return { ...finishWithoutAgenda('Para enviar esta consulta al equipo, escribí «consultar al equipo». Conservé tu borrador.'), replyPrepared: true }
      }
      state.referral = { ...state.referral, status: 'pending' }
      return { ...finishWithoutAgenda(referralPendingReply(state.referral)), replyPrepared: true,
        ...(context.humanHandoff ? { handoffCommand: { referral: structuredClone(state.referral), evidence: message } } : {}) }
    }
    delete state.referral
    if (state.serviceRequest) {
      state.serviceRequest = { ...state.serviceRequest, disposition: 'needs_detail', basis: 'related_category' }
      procedureQuestion = serviceRequestReply(state.serviceRequest, services)
    }
    const continued = procedureQuestion ? finishWithoutAgenda(procedureQuestion)
      : await respondBooking(context, state, message, port, undefined, services)
    return { ...continued, reply: 'Seguimos por acá.\n' + continued.reply, replyPrepared: true }
  }
  if (state.referral?.status === 'pending') {
    return { ...finishWithoutAgenda(referralPendingReply(state.referral)), replyPrepared: true }
  }
  if (informationReads.some(read => read.catalogInformation) && !bookingUpdates.length && !nameOp && !clarificationReply && !(procedureQuestion && procedureOp?.purpose === 'inquiry')) return { ...finishWithoutAgenda(''), replyPrepared: true }
  if (procedureQuestion) {
    if (state.serviceRequest) {
      const request = state.serviceRequest
      if (request.purpose === 'booking' && request.serviceIds.length) state.pending = 'service'
      const retainedDelivery = serviceRequestDelivery(request, services)
      const localBody = localProcedureRequest ? serviceRequestDelivery(localProcedureRequest, services).facts[0]!.text : null
      const delivery = localBody ? { reply: localBody + '\n' + serviceRequestQuestion(request),
        facts: [{ id: 'procedure', text: localBody }, { id: 'next', text: serviceRequestQuestion(request) }] } : retainedDelivery
      rememberDialogueQuestion(state, serviceRequestQuestion(request),
        services.filter(service => request.serviceIds.includes(service.id)).map(service => ({ id: service.id, label: service.name })))
      const presentation = request.purpose === 'booking' ? choicePresentationForQuestion(state, services)
        : request.serviceIds.length ? { kind: 'service' as const, title: 'Servicios relacionados',
            choices: services.filter(service => request.serviceIds.includes(service.id)).map(service =>
              ({ label: service.name, operation: { kind: 'service' as const, serviceId: service.id } })) } : undefined
      const catalogRead = catalogAnswer?.[1].catalogInformation
      return { ...finishWithoutAgenda(delivery.reply), replyPrepared: true,
        ...(catalogRead ? { catalogInformation: catalogRead } : {}), replyFacts: [
        ...answerFacts(), ...delivery.facts],
        ...(presentation ? { choicePresentation: presentation } : {}) }
    }
    return { ...finishWithoutAgenda(procedureQuestion), replyPrepared: true }
  }
  const estimateReadRequested = plan.operations.some(operation => operation.kind === 'information' && operation.target.kind === 'service' && operation.target.estimateOptionId !== undefined)
  if ((informationOnly || estimateReadRequested) && !plan.operations.some(operation => ['basket', 'service', 'service_request', 'estimate', 'confirm_proposal'].includes(operation.kind))) {
    return { ...finishWithoutAgenda(''), replyPrepared: true }
  }
  if (tentativeTemporal && approximateTimeRequest(message)) return { ...finishWithoutAgenda(''), replyPrepared: true }
  if (state.timeClarification) {
    state.pending = 'time'
    const question = temporalClarificationQuestion(state.timeClarification)
    rememberDialogueQuestion(state, question, [], null)
    return { ...finishWithoutAgenda(question), replyPrepared: true }
  }
  if (state.editRequest && !matched.matching) {
    const next = draftEditResponse(state, services)
    return { ...next, reply: [...combinedAnswers(next), next.reply, clarificationReply].filter(Boolean).join('\n') }
  }
  if (informationReads.length && !bookingUpdates.length && (!nameOp || !hasActiveBooking(state))) return finishWithoutAgenda('')
  if (!candidateSelection && !matched.matching && !plan.operations.length && hasActiveBooking(state)) {
    const clarification = state.pending === 'service' && !socialMessage(message) ? basketQuestion(state, services) : null
    if (clarification) {
      rememberBasketClarification(state, services, clarification)
      const choicePresentation = choicePresentationForQuestion(state, services)
      return { ...finishWithoutAgenda(clarification), replyPrepared: true, ...(choicePresentation ? { choicePresentation } : {}) }
    }
    return { ...finishWithoutAgenda(socialQuestion(state)), ...(intent === 'booking' ? { replyPrepared: true as const } : {}) }
  }
  if (!candidateSelection && !matched.matching && !updates.length) return finishWithoutAgenda(hasActiveBooking(state) ? pendingQuestion(state) : answers.length ? '' : '¿En qué te puedo ayudar con el local?')
  const clarification = basketQuestion(state, services)
  if (!matched.matching && (clarification || serviceOp?.kind === 'service' && serviceOp.mode === 'unresolved')) {
    state.pending = resolveDialogueRoute(state, [], 'service').pending
    if (clarification) rememberBasketClarification(state, services, clarification)
    const choicePresentation = clarification ? choicePresentationForQuestion(state, services) : undefined
    return { ...finishWithoutAgenda(clarification || 'No pude identificar ese servicio. ¿Qué servicio necesitás?\n' + serviceList(services)), replyPrepared: true, ...(choicePresentation ? { choicePresentation } : {}) }
  }
  if (uncertainDate) {
    state.pending = basketIsResolved(state) ? 'date' : 'service'
    return finishWithoutAgenda('No pude determinar una fecha válida y única. ¿Qué día querés consultar?' + (!basketIsResolved(state) ? '\n' + pendingQuestion(state) : ''))
  }
  if (!matched.matching && !bookingUpdates.length && nameOp && !hasActiveBooking(state) && standaloneIdentityMessage(message,nameOp.value)) return finishWithoutAgenda('¿En qué te puedo ayudar con el local?')
  const selectedCandidateIds = candidateSelection ? [serviceReferenceOp.serviceId] : serviceOp?.kind === 'service' && serviceOp.mode === 'single' && serviceOp.confidence >= .85
    ? serviceOp.serviceIds : basketOp?.kind === 'basket'
      ? basketOp.members.filter(member => member.mode === 'single' && member.confidence >= .85).flatMap(member => member.serviceIds) : []
  const chosenRelated = previousProcedureRequest?.businessId === context.businessId &&
    previousProcedureRequest.purpose === 'booking' && previousProcedureRequest.basis === 'related_category' &&
    !state.serviceRequest
    ? services.filter(service => previousProcedureRequest.serviceIds.includes(service.id) &&
        selectedCandidateIds.includes(service.id) && basketServiceIds(state).includes(service.id)) : []
  // Selecting the public service resolves the choice, not an undocumented technique.
  // Keep that distinction as brief information instead of another blocking procedure.
  const next = await respondBooking(context, state, message, port, undefined, services, matched.matching)
  const selectionNote = chosenRelated.length
    ? serviceSelectionNote(previousProcedureRequest!, chosenRelated.map(service => service.name), next.reply, services) : ''
  return { ...next, reply: [...combinedAnswers(next), selectionNote, next.reply, clarificationReply].filter(Boolean).join('\n'),
    ...(chosenRelated.length ? { replyPrepared: true as const, replyFacts: [...(selectionNote ? [{id:'acknowledgment',text:selectionNote}] : []), {id:'next',text:[...combinedAnswers(next),next.reply,clarificationReply].filter(Boolean).join('\n')}] } : {}) }
}

/** Route current-message reads before booking extraction; reads never publish a proposal. */
async function respondCore(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!isCustomerText(message, 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const referralAction = state.referral ? explicitReferralAction(message) : null
  if (referralAction && (!decision?.turnPlan || decision.turnPlan.operations.length === 0)) {
    return respondTurnPlan(context, state, message, port, { version: 1, operations: [{
      kind: 'referral', action: referralAction, evidence: message, confidence: 1
    }] }, 'other')
  }
  if (!decision && (hasBasketSelection(state) && approximateTimeRequest(message) || state.timeClarification)) {
    const services = await port.catalog()
    return respondTurnPlan(context, state, message, port, fallbackIndependentTurnPlan(context,state,message,services,port), 'booking')
  }
  if (!decision && state.professionalReference) {
    const actions = routeActions(message).information
    const operations: TurnOperation[] = actions.length ? [{ kind: 'information', target: { kind: 'business', actions }, evidence: message, confidence: 1 }] : []
    return respondTurnPlan(context, state, message, port, { version: 1, operations }, 'other')
  }
  if (decision && Object.hasOwn(decision, 'turnPlan')) return respondTurnPlan(context, state, message, port, decision.turnPlan, decision.intent, decision.informationOnly === true, decision.communicative, decision.catalogInquiries)
  if (state.referral?.status === 'pending' && !decision?.serviceId && !decision?.candidateIds.length &&
      !decision?.informationTarget && !routeActions(message).information.length) {
    const services = await port.catalog()
    return respondTurnPlan(context, state, message, port, fallbackIndependentTurnPlan(context, state, message, services,port), decision?.intent)
  }
  const delivered = (reply: string): DialogueResponse => {
    const question = pendingQuestion(state)
    if (state.dialogueContext) state.dialogueContext.lastQuestion = question.startsWith('¿') && question.endsWith('?') && reply.endsWith(question) ? question : null
    return { state, proposal: null, reply }
  }
  const lexicalRoute = routeActions(message)
  if (!lexicalRoute.information.length && !hasActiveBooking(state)) {
    if (socialMessage(message)) return delivered('¿En qué te puedo ayudar con el local?')
    if (/^(?:(?:hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches) )?(?:soy|me llamo|mi nombre es) /.test(normalizeAnswer(message))) {
      const identity = fallbackIdentity(message,state,await port.catalog())
      if (identity && explicitIdentity(message,identity) && standaloneIdentityMessage(message,identity)) { state.customerName = identity; return delivered('¿En qué te puedo ayudar con el local?') }
    }
  }
  const target = decision?.informationTarget
  const focusTarget = !target && state.informationFocus ? inferInformationTarget(state, message, await port.catalog()) : null
  if (target?.kind === 'service' || target?.kind === 'professional' || focusTarget && !lexicalRoute.bookingMessage?.match(/\b(reservar|agendar|turno)\b/)) {
    const read = await readInformation(context, state, message, port, target ?? focusTarget!)
    if (target?.kind === 'professional' && target.mention && basketIsResolved(state) && state.date && port.professionalInformation && port.availabilityBasket) {
      const identities = professionalIdentities(await port.professionalInformation({ ...target, serviceIds: [] }), context.businessId)
      const named = matches(target.mention, identities, context.businessId, 'professional')
      if (named.length === 1) {
        const catalog = await port.catalog()
        const selected = basketServiceIds(state).map(id => catalog.find(service => service.id === id))
        if (selected.every((service): service is DialogueService => Boolean(service))) {
          const professional = named[0]!
          const fresh = await port.availabilityBasket(selected, state.date, professional.id, state.serviceEstimates)
          let detail: string | null = null
          if (!fresh.ok && fresh.reason === 'PREFERRED_PROFESSIONAL_INCOMPATIBLE') {
            detail = fresh.professionalFailure ? professionalFailureMessage(fresh.professionalFailure, context.businessId, selected, professional.id)
              : 'No pude verificar todos los servicios del pedido con ' + professional.name + '. Podés consultarlo con el equipo.'
          } else if (fresh.ok) {
            validateBasketAvailability(fresh, basketServiceIds(state), state.serviceEstimates)
            if (!fresh.professionals.some(p => p.id === professional.id)) throw Error('invalid professional information eligibility')
            const explanation = fresh.explanation ? parseAvailabilityExplanation(fresh.explanation, { date: state.date, professionals: fresh.professionals, dbNow: context.dbNow, timezone: context.timezone, professionalId: professional.id }) : undefined
            if (fresh.slots.some(slot => slot.professionalId !== professional.id || slot.date !== state.date || Date.parse(slot.startAt) <= context.dbNow.getTime())) throw Error('invalid professional information slots scope')
            detail = fresh.slots.length ? 'Verifiqué horarios disponibles con ' + professional.name + ' para el pedido actual el ' + dateLabel(state.date, context.timezone) + '.'
              : availabilityRecoveryMessage(selected.map(s => s.name).join(' + '), dateLabel(state.date, context.timezone), explanation?.reasons ?? [], professional.name)
          }
          if (detail) read.reply += '\nPara tu pedido actual: ' + detail
        }
      }
    }
    if (read.focus) state.informationFocus = read.focus
    return { state, reply: renderInformationContinuation(read, state), proposal: null, ...(read.focus ? informationChoiceFields(state) : {}) }
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
  return { ...delivered(renderInformationContinuation(read, state)), ...(read.focus ? informationChoiceFields(state) : {}) }
}

const canonicalManagementIds = (ids: readonly string[]) => [...ids].sort().join('\u0000')
const MANAGEMENT_QUESTION = '¿Confirmás esta gestión del turno?'
function managementSummary(state: DialogueState): string {
  const m = state.appointmentManagement!, terms = state.bookingReservation!.presented.terms
  return m.context.snapshot.members.map(member => {
    const segment = terms.segments.find(item => item.professionalId === member.professionalId && member.serviceIds.includes(item.serviceId))!
    const move = m.context.proposal?.kind === 'GROUP_RESCHEDULE_PROPOSAL' ? m.context.proposal.moves.find(item => item.appointmentId === member.appointmentId) : undefined
    const at = new Date(move?.newStartAt ?? member.startAt)
    return segment.serviceName + ' con ' + segment.professionalName + ': ' + new Intl.DateTimeFormat('es-AR', { timeZone: terms.timezone, dateStyle: 'short', timeStyle: 'short' }).format(at) + ', ' + member.durationMinutes + ' minutos.'
  }).join('\n')
}
function managementOutcomeReply(state: DialogueState): string {
  return state.appointmentManagement?.outcome?.kind === 'CANCELLED' ? 'El grupo de turnos fue cancelado.' : 'El grupo de turnos fue reprogramado.\n' + managementSummary(state)
}
async function respondAppointmentManagement(context: DialogueContext, previous: DialogueState, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse | null> {
  if (!previous.bookingReservation?.receipt) return null
  const state = structuredClone(previous), current = context.serverManagementSnapshot, scope = context.serverRuntimeBookingScope
  const reply = (text: string): DialogueResponse => ({ state, proposal: null, reply: text, replyPrepared: true })
  if (state.appointmentManagement?.outcome?.kind === 'CANCELLED') return reply(managementOutcomeReply(state))
  const plan = decision?.turnPlan ? parseTurnPlan(decision.turnPlan, message) : null
  const requested = plan?.operations.find(op => op.kind === 'unsupported_action' && (op.action === 'CANCEL' || op.action === 'RESCHEDULE'))
  const lexical = routeActions(message).pendingAction
  const action = requested?.kind === 'unsupported_action' ? requested.action : !decision && (lexical === 'CANCEL' || lexical === 'RESCHEDULE') ? lexical : null
  if (!current || !scope || current.scope.businessId !== state.businessId || current.scope.sessionId !== scope.sessionId || current.groupId !== state.bookingReservation!.receipt!.coordinationGroupId) return null
  if (current.members.some(member => member.depositId !== null || member.manualDepositPaid || member.manualDepositAmount !== null)) return reply('Este grupo requiere revisión financiera del equipo; no modifiqué los turnos ni los pagos.')
  const normalized = normalize(message)
  const fullConsent = /^(confirmo|si confirmo|confirmo la cancelacion|confirmo cancelar todos los turnos|confirmo la reprogramacion|confirmo reprogramar todos los turnos)$/.test(normalized) && !/[?¿]/.test(message)
  let m = state.appointmentManagement
  if (action && (!fullConsent || !m || action !== m.context.action)) {
    m = { context: beginAppointmentManagement(action as 'CANCEL' | 'RESCHEDULE', current) }
    state.appointmentManagement = m
    if (action === 'CANCEL') {
      m.presentedScope = structuredClone(scope)
      return reply('Vas a cancelar todos estos turnos:\n' + managementSummary(state) + '\n' + MANAGEMENT_QUESTION)
    }
  }
  if (!m) return null
  if (m.outcome && !action) return reply(managementOutcomeReply(state))
  const shown = m.presentedScope
  if (fullConsent && m.context.proposal && shown && /^\d+$/.test(scope.revision) && BigInt(scope.revision) > 0n &&
    Object.entries({ ...scope, revision: String(BigInt(scope.revision) - 1n) }).every(([key, value]) => shown[key as keyof RuntimeShownScope] === value) &&
    cancellationFingerprint(current) === cancellationFingerprint(m.context.snapshot)) {
    return { ...reply('Voy a verificar esta gestión antes de completarla.'), managementCommand: confirmAppointmentManagement(m.context, { nonce: m.context.proposal.nonce, fingerprint: m.context.proposal.fingerprint }) }
  }
  // Every other turn consumes the old displayed-consent scope; no silent refresh.
  delete m.presentedScope
  if (m.context.action === 'CANCEL') {
    m.context = beginAppointmentManagement('CANCEL', current)
    m.presentedScope = structuredClone(scope)
    return reply('La cancelación todavía no se realizó.\n' + managementSummary(state) + '\n' + MANAGEMENT_QUESTION)
  }
  const dateOp = plan?.operations.find(op => op.kind === 'date'), timeOp = plan?.operations.find(op => op.kind === 'time')
  const date = dateOp?.kind === 'date' ? extractDate(normalize(dateOp.expression), context) : !decision ? extractDate(normalized, context) : null
  const temporal = !decision ? fallbackTemporalRequest(message, true) : null
  const time = timeOp?.kind === 'time' ? timeOp.value : temporal?.kind === 'exact' ? temporal.time : null
  if (date) { m.date = date; delete m.selectedTime; m.context = beginAppointmentManagement('RESCHEDULE', current) }
  if (!m.date) return reply('¿Para qué fecha querés reprogramar todos los turnos? Se conservan servicios y profesionales.')
  if (!port.managementRescheduleOffers) return reply('No puedo verificar horarios completos para este grupo; no modifiqué tus turnos.')
  const offers = await port.managementRescheduleOffers(current, m.date)
  m.context = attachManagementRescheduleOffers(beginAppointmentManagement('RESCHEDULE', current), offers)
  if (!offers.length) return reply('No encontré horarios completos compatibles para todos los turnos en esa fecha. No modifiqué tu reserva.')
  const timezone = state.bookingReservation!.presented.terms.timezone
  const label = (offer: ManagementRescheduleOffer) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date([...offer.moves].sort((a,b) => Date.parse(a.newStartAt) - Date.parse(b.newStartAt))[0]!.newStartAt))
  const matching = time ? offers.filter(offer => label(offer) === time) : []
  if (matching.length === 1) {
    m.selectedTime = time!
    m.context = selectManagementRescheduleOffer(m.context, matching[0]!.key)
    m.presentedScope = structuredClone(scope)
    return reply('Nueva propuesta para todos los turnos:\n' + managementSummary(state) + '\n' + MANAGEMENT_QUESTION)
  }
  return reply('Para reprogramar todos los turnos, elegí un horario de inicio: ' + [...new Set(offers.map(label))].join(', ') + '.')
}
export function finalizeAppointmentManagement(response: DialogueResponse, result: { appointmentIds: string[]; moves?: readonly { appointmentId: string; newStartAt: string }[] }): DialogueResponse {
  const command = response.managementCommand
  if (!command || !response.state.appointmentManagement || canonicalManagementIds(result.appointmentIds) !== canonicalManagementIds(command.snapshot.members.map(member => member.appointmentId))) throw new Error('complete management result required')
  if (command.kind === 'RESCHEDULE_APPOINTMENT_GROUP' && JSON.stringify(result.moves) !== JSON.stringify([...command.moves].sort((a,b) => a.appointmentId.localeCompare(b.appointmentId)))) throw new Error('management moves mismatch')
  const state = structuredClone(response.state), m = state.appointmentManagement!
  m.outcome = { kind: command.kind === 'CANCEL_APPOINTMENT_GROUP' ? 'CANCELLED' : 'RESCHEDULED', appointmentIds: [...result.appointmentIds], ...(command.kind === 'RESCHEDULE_APPOINTMENT_GROUP' ? { moves: command.moves } : {}) }
  delete m.presentedScope
  return { state, proposal: null, reply: managementOutcomeReply(state), replyPrepared: true }
}
const RUNTIME_CONFIRMATION_QUESTION='¿Confirmás este turno?'
function runtimeCurrentScope(context: DialogueContext,p:RuntimePresentedBooking):boolean {
  const scope=context.serverRuntimeBookingScope
  if(!scope || !/^\d+$/.test(scope.revision) || BigInt(scope.revision)<1n) return false
  return Object.entries({...scope,revision:String(BigInt(scope.revision)-1n)}).every(([key,value])=>p.scope[key as keyof RuntimeShownScope]===value) && Object.keys(scope).length===Object.keys(p.scope).length
}
async function respondRuntimeBookingEnvelope(context:DialogueContext,state:DialogueState,message:string,port:DialoguePort,decision?:DialogueDecision):Promise<DialogueResponse> {
  const prior=state.bookingReservation
  if(prior?.receipt) return {state,proposal:null,reply:runtimeBookingReceiptReply(prior)}
  const plan=decision?.turnPlan?parseTurnPlan(decision.turnPlan,message):null, lexical=routeActions(message), normalized=normalize(message)
  const veto=/[?¿]/.test(message) || /\b(no|pero|mejor|antes|depende|quizas|tal vez|cuando|sujeto)\b/.test(normalized) || /\bsi\b/.test(normalized) && !/^(si|si confirmo)$/.test(normalized)
  // This marker is projected by current speech-act admission, not model text or a phrase allowlist.
  const semantic=decision?.confirmationEvidence===message && !veto && plan?.operations.length===1 && plan.operations[0]?.kind==='confirm_proposal' && plan.operations[0].confidence>=0.85 && normalize(plan.operations[0].evidence)===normalized
  const literal=!veto && !plan && !lexical.information.length && !lexical.pendingAction && !decision?.serviceId && !decision?.candidateIds.length && !decision?.professionalMention && /^(si|confirmo|confirmar|confirmo el turno|quiero reservar|reservar|dale|si confirmo)$/.test(normalized)
  if (priceBookingChoice(state) && (semantic || literal)) return { state, proposal: null, replyPrepared: true,
    reply: 'Para agregar ese servicio al pedido, elegí Reservar.\n' + state.questionContext!.question, ...informationChoiceFields(state) }
  if(prior && port.prepareRuntimeBooking && runtimeCurrentScope(context,prior.presented) && state.questionContext?.role==='confirmation' && !state.questionContext.matchCandidateIds && runtimeProposalMatchesState(prior.presented,state) && (semantic||literal))
    return {state,proposal:null,reply:'Voy a verificar y confirmar el turno.',bookingCommand:{kind:'CONFIRM_BOOKING',presented:structuredClone(prior.presented)}}
  delete state.bookingReservation
  if(state.questionContext?.role==='confirmation')delete state.questionContext
  const nextDecision=plan?.operations.some(op=>op.kind==='confirm_proposal')?{...decision!,turnPlan:{...plan,operations:plan.operations.filter(op=>op.kind!=='confirm_proposal')}}:decision
  const response=await respondCore(context,state,message,port,nextDecision)
  const invitation = priceBookingChoice(response.state)
  if (invitation && prior && runtimeProposalMatchesState(prior.presented, { ...response.state, bookingReservation: prior })) {
    // A lateral price read retains the financial presentation; it cannot renew its scope or consent.
    response.state.bookingReservation = structuredClone(prior)
    rememberDialogueQuestion(response.state, '¿Querés agendar ' + invitation.label + '?', [invitation])
    return response
  }
  return prepareRuntimeBookingResponse(context,response,port,prior)
}
/** Native and textual progression share the same current server-owned financial presentation. */
async function prepareRuntimeBookingResponse(context:DialogueContext,response:DialogueResponse,port:DialoguePort,prior?:RuntimeBookingReservation):Promise<DialogueResponse> {
  if(context.sandboxBooking!==true && context.serverRuntimeBookingScope && port.prepareRuntimeBooking && !response.handoffCommand && !response.state.referral && !response.state.serviceRequest && !response.state.editRequest && response.state.pending==='proposal' && (response.proposal || prior)) {
    const prepared=await port.prepareRuntimeBooking(response.state,context.serverRuntimeBookingScope)
    if(!prepared || 'unavailable' in prepared){
      const reason=!prepared ? 'Todavía no está reservado: no pude preparar una confirmación segura de este turno.' : prepared.unavailable==='DEPOSIT_MULTISERVICE'?'Todavía no puedo coordinar de forma segura una seña para varios servicios.':prepared.unavailable==='DEPOSITS_DISABLED'?'La reserva de servicios con seña todavía no está habilitada en este canal.':'Faltan los medios de pago necesarios para mantener este horario con seña.'
      response.reply=reason+' Conservé todos tus servicios y datos. ¿Querés consultar la reserva con el equipo?'
      response.proposal=null;response.replyPrepared=true
      delete response.state.bookingReservation
      delete response.state.questionContext
      delete response.choicePresentation
      response.state.dialogueContext={lastQuestion:null,presentedOffer:response.state.dialogueContext?.presentedOffer??null}
    } else {
      response.state.slot=prepared.slot
      response.state.bookingReservation={presented:prepared.presented}
      if(!runtimeProposalMatchesState(prepared.presented,response.state))throw new Error('runtime preparation mismatch')
      const confirmationQuestion=prepared.presented.terms.deposit && prepared.presented.terms.segments.length>1
        ? '¿Confirmás la reserva de todos estos servicios con la seña conjunta?' : RUNTIME_CONFIRMATION_QUESTION
      response.reply=(response.proposal?'':response.reply+'\n')+runtimeBookingSummary(prepared.presented)+'\n'+confirmationQuestion
      response.state.dialogueContext={lastQuestion:confirmationQuestion,presentedOffer:response.state.dialogueContext?.presentedOffer??null}
      rememberDialogueQuestion(response.state,confirmationQuestion)
    }
  }
  return response
}
export function finalizeRuntimeBooking(response:DialogueResponse,result:RuntimeBookingResult):DialogueResponse {
  if(response.bookingCommand?.kind!=='CONFIRM_BOOKING')throw new Error('runtime command required')
  const state=structuredClone(response.state)
  delete state.questionContext
  if(state.dialogueContext)state.dialogueContext.lastQuestion=null
  if(result.kind==='COMMITTED' || result.kind==='HELD') {
    const reservation=parseRuntimeBookingReservation({presented:response.bookingCommand.presented,receipt:result},state.businessId)
    state.bookingReservation=reservation
    if(!runtimeProposalMatchesState(reservation.presented,state))throw new Error('runtime committed state mismatch')
    return {state,proposal:null,reply:runtimeBookingReceiptReply(reservation),replyPrepared:true}
  }
  delete state.bookingReservation
  state.slot=null;state.pending='time'
  return {state,proposal:null,reply:result.kind==='REQUOTE'?'La propuesta cambió. Necesitamos verificar una nueva propuesta antes de confirmar.':'No pude confirmar esta propuesta. Conservé tus servicios y datos; no hay una reserva confirmada.',replyPrepared:true}
}

/** Trusted sandbox capability changes only proposal delivery; effects remain an adapter responsibility. */
async function respondBookingEnvelope(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!isCustomerText(message, 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const reservation = state.sandboxReservation
  if (context.sandboxBooking !== true) {
    delete state.sandboxReservation
    if (!state.bookingReservation && state.questionContext?.role === 'confirmation') delete state.questionContext
    return respondRuntimeBookingEnvelope(context, state, message, port, decision)
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
  if (priceBookingChoice(state) && (semanticConfirmation || fallbackConfirmation)) return { state, proposal: null, replyPrepared: true,
    reply: 'Para agregar ese servicio al pedido, elegí Reservar.\n' + state.questionContext!.question, ...informationChoiceFields(state) }
  if (!state.professionalReference && !state.referral && !state.serviceRequest && !state.editRequest && reservation && !reservation.receipt && reservation.presented.conditionsPresented === true && sandboxProposalMatchesState(reservation.presented, state) && !state.questionContext?.matchCandidateIds && (semanticConfirmation || fallbackConfirmation)) {
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
  } else if (!response.state.referral && !response.state.serviceRequest && !response.state.editRequest && reservation && reservation.presented.conditionsPresented === true && sandboxProposalMatchesState(reservation.presented, response.state)) {
    const invitation = priceBookingChoice(response.state)
    response.state.sandboxReservation = structuredClone(reservation)
    if (invitation) rememberDialogueQuestion(response.state, '¿Querés agendar ' + invitation.label + '?', [invitation])
    else {
      response.reply = response.reply.replace('La propuesta sigue pendiente; todavía no está reservado.', SANDBOX_CONFIRMATION_QUESTION)
      rememberDialogueQuestion(response.state, SANDBOX_CONFIRMATION_QUESTION)
    }
  }
  return response
}

/** Introduction is server-owned and finalized after model copy validation when requested by the AI wrapper. */
export async function finalizeDialogueIntroduction<T extends DialogueResponse>(context: DialogueContext, response: T, port: DialoguePort): Promise<T> {
  if (response.state.introduced === true || !port.identity) return response
  const identity = await port.identity()
  if (identity.businessId !== context.businessId) throw new Error('invalid identity scope')
  // Only the exact canonical help body may use the identity's treatment-specific question.
  // A composed social answer is concrete content and must not be replaced.
  const social = !hasActiveBooking(response.state) && response.reply === '¿En qué te puedo ayudar con el local?'
  const intro = introduceDialogue({ identity, introduced: false, customerName: response.state.customerName,
    ...(social ? { kind: 'social' as const } : { kind: 'concrete' as const, reply: response.reply }) })
  response.state.introduced = intro.introduced
  return { ...response, reply: intro.reply }
}
export async function respond(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision,
  options: { deferIntroduction?: boolean } = {}): Promise<DialogueResponse> {
  const before = parseDialogueState(previous, context.businessId, context.timezone)
  const management = await respondAppointmentManagement(context, before, message, port, decision)
  if (management) return management
  if (decision?.communicative && decision.turnPlan && (decision.communicative.continuity && decision.turnPlan.operations.length === 0 && decision.communicative.plan.operations.length === 0 ||
      decision.communicative.social && decision.turnPlan.operations.length === 0 && decision.communicative.plan.operations.length === 0) &&
      !decision.communicative.blockedFields.length && !decision.communicative.reference) {
    // Nonoperative admission precedes the booking envelope, which otherwise
    // consumes consent scope and rebuilds procedure/referral choices as progression.
    const response = await respondTurnPlan(context, before, message, port, decision.turnPlan, decision.intent,
      decision.informationOnly === true, decision.communicative)
    response.turnOutcome = { changedFields: [], appliedFields: [], requestedChanges: [], rejectedProfessionalPreference: false }
    return options.deferIntroduction ? response : finalizeDialogueIntroduction(context, response, port)
  }
  let deliveryServices: DialogueService[] = []
  const captureFresh = (result: DialogueBasketAvailability) => {
    const fresh = result.ok || result.reason === 'GUIDANCE_REQUIRED' ? result.services : []
    if (fresh.length) deliveryServices = deliveryServices.map(service => fresh.find(item => item.id === service.id) ?? service)
    return result
  }
  const commercialRead = memoBusinessTimeContext(port.businessTimeContext)
  const deliveryPort: DialoguePort = { ...port, ...(commercialRead ? {businessTimeContext:commercialRead} : {}),
    catalog: async () => { deliveryServices = await port.catalog(); return deliveryServices },
    ...(port.availabilityBasket ? { availabilityBasket: async (...args: Parameters<NonNullable<DialoguePort['availabilityBasket']>>) => captureFresh(await port.availabilityBasket!(...args)) } : {}),
    ...(port.verifiedDateChoices ? { verifiedDateChoices: async (...args: Parameters<NonNullable<DialoguePort['verifiedDateChoices']>>) => captureFresh(await port.verifiedDateChoices!(...args)) } : {})
  }
  const response = await respondBookingEnvelope(context, previous, message, deliveryPort, decision)
  const basketValue = (state: DialogueState) => selectionBasket(state).members.map(member => [member.mode, member.serviceIds])
  const values = (state: DialogueState) => [basketValue(state), [state.date, state.datePreferences ?? null], [state.professional, state.professionalNameHint], [state.requestedTime, state.timePreference ?? null], state.customerName, state.serviceEstimates ?? {}]
  const oldValues = values(before), newValues = values(response.state)
  const fields: (DraftEditField | 'estimate')[] = [...DRAFT_EDIT_FIELDS, 'estimate']
  const changedFields = fields.filter((_field, index) => JSON.stringify(oldValues[index]) !== JSON.stringify(newValues[index]))
  const explicitFields = new Set<DraftEditField | 'estimate'>()
  for (const operation of decision?.turnPlan?.operations ?? []) {
    if (operation.kind === 'basket' || operation.kind === 'service' || operation.kind === 'service_reference' && operation.action === 'select') explicitFields.add('service')
    else if (operation.kind === 'date_preferences') explicitFields.add('date')
    else if (operation.kind === 'time_preference') explicitFields.add('time')
    else if (operation.kind === 'estimate' || DRAFT_EDIT_FIELDS.includes(operation.kind as DraftEditField)) explicitFields.add(operation.kind as DraftEditField | 'estimate')
  }
  if (!decision?.turnPlan && (decision?.serviceId || decision?.candidateIds.length)) explicitFields.add('service')
  response.turnOutcome = { changedFields, appliedFields: changedFields.filter(field => explicitFields.has(field)),
    requestedChanges: [...response.state.editRequest?.fields ?? []], rejectedProfessionalPreference: response.availability?.reason === 'PREFERRED_PROFESSIONAL_INCOMPATIBLE' }
  const acknowledgment = acknowledgmentContent(appliedChangeAcknowledgment(before, response.state, deliveryServices, response.turnOutcome))
  const resumingGuide = response.state.pending === 'estimate' && !response.state.editRequest &&
    (Boolean(response.state.questionContext?.targetServiceId) || response.reply === socialQuestion(response.state))
  if (resumingGuide && !deliveryServices.length) deliveryServices = await deliveryPort.catalog()
  const pendingGuide = resumingGuide ? deliveryServices.find(service => service.id ===
    (response.state.questionContext?.targetServiceId ?? resolveGuidance(deliveryServices.filter(service =>
      basketServiceIds(response.state).includes(service.id)), response.state.serviceEstimates).pending?.id)) : undefined
  if (pendingGuide) {
    const delivery = guidanceDelivery(pendingGuide, context.businessId)
    if (response.reply === delivery.reply || response.reply === socialQuestion(response.state)) {
      response.reply = delivery.reply
      response.replyFacts = delivery.facts
      response.replyPrepared = true
    }
  }
  if (acknowledgment) {
    response.reply = acknowledgment + '\n\n' + response.reply
    if (response.replyFacts) response.replyFacts = [{ id: 'acknowledgment', text: acknowledgment }, ...response.replyFacts]
  }
  if ((before.referral || response.state.referral) && !deliveryServices.length) deliveryServices = await deliveryPort.catalog()
  const resumedReferral = decision?.turnPlan?.operations.some(operation => operation.kind === 'referral' && operation.action === 'resume' && operation.confidence >= 0.85) ||
    Boolean(before.referral && explicitReferralAction(message) === 'resume')
  if (!decision?.turnPlan && decision?.serviceId &&
      selectionBasket(response.state).members.some(member => member.mode === 'single' && member.serviceIds.includes(decision.serviceId!))) {
    delete response.state.serviceRequest
    if (before.referral?.reason === 'UNVERIFIED_SERVICE' || before.referral?.serviceId !== decision.serviceId) delete response.state.referral
  }
  if (response.state.timeMeaningClarification) {
    const question = timeMeaningQuestion(response.state)
    if (!response.reply.includes(question)) response.reply += '\n' + question
    response.replyPrepared = true
  }
  attachReferralOffer(response, deliveryServices, resumedReferral)
  if (!priceBookingChoice(response.state) && !response.state.professionalReference && response.state.bookingReservation && !response.state.bookingReservation.receipt && response.state.questionContext?.role === 'confirmation') response.choicePresentation = {kind:'proposal',title:'Confirmar turno',choices:[{label:'Confirmar',operation:{kind:'confirm',nonce:response.state.bookingReservation.presented.nonce}}]}
  if (!priceBookingChoice(response.state) && !response.state.professionalReference && response.state.sandboxReservation && !response.state.sandboxReservation.receipt && response.state.sandboxReservation.presented.conditionsPresented === true && response.state.questionContext?.role === 'confirmation') response.choicePresentation = { kind: 'proposal', title: 'Confirmar turno', choices: [{ label: 'Confirmar', operation: { kind: 'confirm', nonce: response.state.sandboxReservation.presented.nonce } }] }
  return options.deferIntroduction ? response : finalizeDialogueIntroduction(context, response, port)
}
/** Typed choices are internal stored operations, never interpreted labels or direct client commands. */
export async function respondConversationChoice(context: DialogueContext, previous: unknown, value: unknown, port: DialoguePort): Promise<DialogueResponse> {
  const operation = parseConversationChoiceOperation(value)
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const question = state.questionContext ? parseDialogueQuestion(state.questionContext, state) : null
  const reject = (): never => { throw new ConversationChoiceUnavailableError() }
  const finish = async (response:DialogueResponse) => {
    const prepared=await prepareRuntimeBookingResponse(context,response,port)
    if (!priceBookingChoice(prepared.state) && !prepared.state.professionalReference && prepared.state.bookingReservation && !prepared.state.bookingReservation.receipt && prepared.state.questionContext?.role === 'confirmation')
      prepared.choicePresentation={kind:'proposal',title:'Confirmar turno',choices:[{label:'Confirmar',operation:{kind:'confirm',nonce:prepared.state.bookingReservation.presented.nonce}}]}
    return finalizeDialogueIntroduction(context,prepared,port)
  }
  if (!Number.isFinite(context.dbNow.getTime()) || state.professionalReference || state.timeMeaningClarification) return reject()
  const invitation = priceBookingChoice(state)
  if (invitation && operation.kind !== 'service') return reject()
  if (operation.kind === 'service' && invitation) {
    if (operation.targetMemberId !== undefined || operation.serviceId !== invitation.id) return reject()
    const services = await port.catalog()
    const service = services.find(service => service.id === invitation.id && service.name === invitation.label)
    if (!service || services.filter(item => item.id === invitation.id).length !== 1 || !validBookableService(service, true)) return reject()
    // Adding a service is not renewed consent to the previously proposed slot, even when deduplicated.
    if (state.pending === 'proposal' && (state.sandboxReservation || state.bookingReservation)) {
      state.slot = null; state.requestedTime = null; delete state.requestedTimeMode
      delete state.sandboxReservation; delete state.bookingReservation; delete state.dialogueContext
    }
    // The published click alone authorizes add; use the same cart reducer and its stable deduplication.
    mutateStateBasket(state, { kind: 'basket', mutation: 'add', scope: 'all', targetMemberIds: [],
      members: [{ mode: 'single', serviceIds: [service.id], evidence: 'stored choice', confidence: 1 }], evidence: 'stored choice', confidence: 1 })
    delete state.informationFocus
    delete state.questionContext
    delete state.sandboxReservation
    state.pending = state.editRequest?.fields[0] ?? resolveDialogueRoute(state, services).pending
    const response = state.serviceRequest || state.referral
      ? await respondTurnPlan(context, state, 'stored choice', { ...port, catalog: async () => services }, { version: 1, operations: [] }, 'booking')
      : state.editRequest ? draftEditResponse(state, services) : await respondBooking(context, state, 'stored choice', port, undefined, services)
    return finish(response)
  }
  if (operation.kind === 'service' && state.informationFocus?.awaitingChoice) {
    const focus = state.informationFocus
    if (operation.targetMemberId || !focus.options.some(option => option.id === operation.serviceId)) return reject()
    const services = await port.catalog()
    const eligible = services.filter(service => focus.options.some(option => option.id === service.id && option.label === service.name))
    if (eligible.length !== focus.options.length || !eligible.some(service => service.id === operation.serviceId)) return reject()
    // The stored ID is already an explicit selection. Do not compile its label into natural language.
    delete state.informationFocus
    // Selecting one service from a comparative pool asks about that service,
    // not automatically about its configured product/length variants.
    const aspect = focus.aspect === 'comparison' && focus.options.length > 1 ? 'overview' : focus.aspect
    const read = await readInformation(context, state, 'stored choice', port, { kind: 'service', actions: [], serviceIds: [operation.serviceId], aspect }, services)
    if (read.focus) state.informationFocus = read.focus
    return finalizeDialogueIntroduction(context, { state, proposal: null, reply: renderInformationContinuation(read, state),
      ...(read.focus ? informationChoiceFields(state) : {}) }, port)
  }
  const candidateRequest = state.serviceRequest
  if (operation.kind === 'service' && candidateRequest?.purpose === 'inquiry') {
    const services = await port.catalog()
    if (!validServiceCandidateContext(candidateRequest, operation.serviceId, context.businessId, services, question ?? undefined, false) ||
        operation.targetMemberId !== undefined) return reject()
    return finalizeDialogueIntroduction(context, await readServiceCandidate(context, state, candidateRequest, operation.serviceId, port, services), port)
  }
  if (operation.kind === 'confirm' && (state.referral || state.serviceRequest) ||
      state.referral?.status === 'pending' && operation.kind !== 'service') return reject()
  if (!question?.complete) return reject()
  if (operation.kind === 'confirm') {
    if(state.bookingReservation && port.prepareRuntimeBooking && runtimeCurrentScope(context,state.bookingReservation.presented) && question.role==='confirmation' && !question.matchCandidateIds && state.bookingReservation.presented.nonce===operation.nonce && !state.bookingReservation.receipt && runtimeProposalMatchesState(state.bookingReservation.presented,state))
      return {state,proposal:null,reply:'Voy a verificar y confirmar el turno.',bookingCommand:{kind:'CONFIRM_BOOKING',presented:structuredClone(state.bookingReservation.presented)}}
    const reservation = state.sandboxReservation
    if (state.editRequest || context.sandboxBooking !== true || question.role !== 'confirmation' || question.matchCandidateIds || !reservation || reservation.receipt || reservation.presented.conditionsPresented !== true ||
      reservation.presented.nonce !== operation.nonce || !sandboxProposalMatchesState(reservation.presented, state)) return reject()
    return finalizeDialogueIntroduction(context, { state, proposal: null, reply: 'Voy a verificar y confirmar el turno de prueba.',
      bookingCommand: { kind: 'CONFIRM_SANDBOX_BOOKING', presented: structuredClone(reservation.presented) } }, port)
  }
  const expectedRole = operation.kind === 'service' ? 'service' : operation.kind === 'estimate' ? 'estimate'
    : operation.kind === 'date' ? 'date' : operation.kind === 'professional' || operation.kind === 'any_professional' ? 'professional'
      : operation.kind === 'page' ? operation.questionKind === 'dates' ? 'date' : operation.questionKind === 'professionals' ? 'professional' : 'time' : 'time'
  if (question.role !== expectedRole || !question.options.some(option => option.id === choiceOptionId(operation))) return reject()
  const services = await port.catalog()
  if (services.length > 200 || services.some(service => !bounded(service.id,128) || !bounded(service.name,200)) || new Set(services.map(service => service.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  const selected = basketServiceIds(state).map(id => services.find(service => service.id === id))
  if (state.editRequest && operation.kind !== 'service') return reject()
  if (operation.kind !== 'service' && (!selected.length || selected.some(service => !service || !validBookableService(service,true)))) return reject()
  const clearDependent = (clearExact: boolean) => { state.slot = null; if (clearExact) { state.requestedTime = null; delete state.requestedTimeMode } delete state.sandboxReservation; delete state.bookingReservation; delete state.dialogueContext; delete state.questionContext }
  const freshAvailability = async () => {
    if (!state.date || !state.professional) return reject()
    const guidance = resolveGuidance(selected as DialogueService[], state.serviceEstimates)
    if (guidance.blocked || guidance.pending || guidance.changed) return reject()
    const professionalId = state.professional.kind === 'specific' ? state.professional.id : undefined
    const needsBasket = selected.length > 1 || selected.some(service => service!.bookingPolicy !== undefined || Number(service!.customerDurationMinutes ?? service!.durationMinutes) > Number(service!.durationMinutes))
    if (!needsBasket) return port.availability(selected[0]!,state.date,professionalId)
    if (!port.availabilityBasket) return reject()
    const result = await port.availabilityBasket(selected as DialogueService[],state.date,professionalId,state.serviceEstimates)
    if (!result.ok) return reject()
    if (validateBasketAvailability(result,basketServiceIds(state),state.serviceEstimates).changed) return reject()
    return result
  }
  if (operation.kind === 'service') {
    const service = services.find(service => service.id === operation.serviceId)
    if (!service) return reject()
    if (candidateRequest) {
      if (!validServiceCandidateContext(candidateRequest, service.id, context.businessId, services, question) ||
          operation.targetMemberId !== undefined) return reject()
      mutateStateBasket(state, serviceCandidateMutation(state, candidateRequest, service.id, 'stored choice', 1))
    } else {
      const pendingMember = selectionBasket(state).members.find(member => member.mode !== 'single')
      const targetMemberId = question.matchTargetMemberId ?? pendingMember?.memberId
      if (operation.targetMemberId !== undefined && operation.targetMemberId !== targetMemberId) return reject()
      mutateStateBasket(state, { kind: 'basket', mutation: targetMemberId ? 'replace' : 'set', scope: targetMemberId ? 'members' : 'all', targetMemberIds: targetMemberId ? [targetMemberId] : [],
        members: [{ mode: 'single', serviceIds: [service.id], evidence: 'stored choice', confidence: 1 }], evidence: 'stored choice', confidence: 1 })
    }
    delete state.informationFocus; delete state.sandboxReservation
    delete state.serviceRequest
    reconcileConversationalReferral(state, services)
  } else if (operation.kind === 'estimate') {
    const service = selected.find(service => service?.id === operation.serviceId)
    const guide = service ? serviceGuidance(service) : null
    if (question.targetServiceId !== operation.serviceId || !service || guide?.kind !== 'guided' || serviceConfigurationKey(guide.policy) !== operation.configurationKey || !resolveServiceEstimate(guide.policy,operation.optionId)) return reject()
    clearDependent(true)
    state.serviceEstimates = { ...state.serviceEstimates, [service.id]: { configurationKey: operation.configurationKey, optionId: operation.optionId } }
  } else if (operation.kind === 'date') {
    if (!port.verifiedDateChoices) return reject()
    const result = await port.verifiedDateChoices(selected as DialogueService[],state.professional?.kind === 'specific' ? state.professional.id : undefined,state.serviceEstimates,
      { requestedTime: state.requestedTime, ...(state.timePreference ? { preference: state.timePreference } : {}) })
    if (!result.ok || !result.slots.some(slot => slot.date === operation.date && Date.parse(slot.startAt) > context.dbNow.getTime())) return reject()
    validateBasketAvailability(result,basketServiceIds(state),state.serviceEstimates)
    clearDependent(Boolean(state.date) && state.requestedTimeMode !== 'inquiry'); state.date = operation.date; delete state.datePreferences
  } else if (operation.kind === 'professional' || operation.kind === 'any_professional') {
    clearDependent(Boolean(state.slot) || Boolean(state.professional) && state.requestedTimeMode !== 'inquiry')
    state.professionalNameHint = null
    if (operation.kind === 'professional') {
      state.professional = null // The explicit alternative replaces the rejected preference only after fresh validation.
      const result = await respondBooking(context,state,'stored choice',port,undefined,services,{ category: 'professional', confirmationId: operation.professionalId })
      if (result.state.professional?.kind !== 'specific' || result.state.professional.id !== operation.professionalId) return reject()
      return finish(result)
    }
    state.professional = { kind: 'any' }
  } else if (operation.kind === 'preference') {
    delete state.timeClarification; clearDependent(true); state.timePreference = parseTimePreference(operation.preference)
  } else if (operation.kind === 'slot') {
    if (state.date !== operation.date || state.professional?.kind === 'specific' && state.professional.id !== operation.professionalId) return reject()
    const available = await freshAvailability()
    const slot = available.slots.find(slot => slot.date === operation.date && slot.time === operation.time && slot.professionalId === operation.professionalId && slot.coordination?.key === operation.coordinationKey && Date.parse(slot.startAt) === Date.parse(operation.startAt) && Date.parse(slot.startAt) > context.dbNow.getTime())
    if (!slot || !available.professionals.some(professional => professional.id === slot.professionalId)) return reject()
    const scoped = parseDialogueState({ ...state, requestedTime: operation.time, requestedTimeMode: undefined, slot, timePreference: undefined },context.businessId,context.timezone)
    delete state.timeClarification; clearDependent(false); delete state.timePreference; delete state.requestedTimeMode; state.requestedTime = scoped.requestedTime; state.slot = scoped.slot
  }
  if (state.editRequest) return finalizeDialogueIntroduction(context, draftEditResponse(state, services), port)
  const response = await respondBooking(context,state,'stored choice',port,undefined,services,undefined,
    operation.kind === 'page' ? { kind: operation.questionKind, cursor: operation.cursor } : undefined)
  if (candidateRequest && operation.kind === 'service') {
    response.reply = [serviceSelectionNote(candidateRequest, [services.find(service => service.id === operation.serviceId)!.name], response.reply, services), response.reply].filter(Boolean).join('\n')
    response.replyPrepared = true
  }
  if (response.proposal && context.sandboxBooking === true) {
    response.reply = presentSandboxProposal(context,response.state,services,response.proposal)
    response.state.dialogueContext = { lastQuestion: SANDBOX_CONFIRMATION_QUESTION, presentedOffer: response.state.dialogueContext?.presentedOffer ?? null }
    rememberDialogueQuestion(response.state,SANDBOX_CONFIRMATION_QUESTION)
  }
  if (!priceBookingChoice(response.state) && !response.state.professionalReference && response.state.sandboxReservation && !response.state.sandboxReservation.receipt && response.state.sandboxReservation.presented.conditionsPresented === true && response.state.questionContext?.role === 'confirmation') {
    response.choicePresentation = { kind: 'proposal', title: 'Confirmar turno', choices: [{ label: 'Confirmar', operation: { kind: 'confirm', nonce: response.state.sandboxReservation.presented.nonce } }] }
  }
  return finish(response)
}

export class ConversationChoiceUnavailableError extends Error {
  readonly code = 'CONVERSATION_CHOICE_UNAVAILABLE'
  constructor() { super('conversation choice is no longer available'); this.name = 'ConversationChoiceUnavailableError' }
}
