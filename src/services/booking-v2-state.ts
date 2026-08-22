import type { BookingV2Extraction } from './booking-v2-extractor.js'
import type { BookingV2PendingAvailabilityResolution } from './booking-availability-resolution.js'
import type { BookingAvailabilitySearchOption } from './booking-availability-search.js'

export const BOOKING_FIELDS = ['name', 'service', 'professional', 'date', 'time'] as const
export const ANY_PROFESSIONAL_ID = '__any_professional__'

export type BookingField = (typeof BOOKING_FIELDS)[number]
export type BookingFlowOrder = 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type BookingDraft = {
  name: string | null
  service: string | null
  professional: string | null
  date: string | null
  time: string | null
}

export type BookingProposal = {
  field: BookingField
  value: string | null
  confidence: number
  evidence: string
  kind: 'field' | 'correction'
}

export type BookingV2GuidedEstimate = {
  serviceId: string
  stage: 'awaiting_option' | 'awaiting_decision' | 'completed'
  optionId: string | null
  optionLabel: string | null
  priceMin: number | null
  priceMax: number | null
}

export type BookingV2PendingPhotoQuote = {
  serviceId: string
  requestedAt: string
  expiresAt: string
}

export type BookingV2ServiceValidation = {
  serviceId: string
  stage: 'awaiting_confirmation' | 'completed'
}

export type BookingV2CategoryAdvice = {
  categoryName: string
  stage: 'offered' | 'awaiting_confirmation' | 'requested'
}

export type BookingV2CatalogNavigation = {
  view: 'CATEGORY' | 'ALL_SERVICES'
  categoryKey: string | null
  categoryName: string | null
  pendingCategoryKey: string | null
  pendingCategoryName: string | null
}

export type BookingV2PendingRequest = {
  message: string
  intents: string[]
  extraction?: BookingV2Extraction | null
  createdAt: string
}

export type BookingV2PendingInformationSelection = {
  serviceIds: string[]
  requestedInformation: Array<'general' | 'price' | 'deposit' | 'duration' | 'professionals'>
  quoteOnly?: boolean
}

export type BookingV2ServiceDisambiguationGroup = {
  serviceIds: string[]
  evidence: string
  catalogFallback?: boolean
}

export type BookingV2PendingServiceDisambiguation = BookingV2ServiceDisambiguationGroup & {
  remainingGroups?: BookingV2ServiceDisambiguationGroup[]
}

export type BookingV2AgendaIntent = 'request_quote' | 'check_availability'
export type BookingV2AgendaStatus = 'pending' | 'blocked' | 'completed'

export type BookingV2AgendaItem = {
  intent: BookingV2AgendaIntent
  status: BookingV2AgendaStatus
  evidence: string
  serviceId: string | null
  serviceInformationProvided: boolean
  blockedBy: 'quote_pending' | null
  createdAt: string
}

export type BookingV2PreliminaryAvailability = {
  phase: 'AWAITING_BOOKING_DECISION' | 'BOOKING'
  professionalId: string
  professionalName: string
  date: string
  timeFrom: string | null
  referenceServiceId: string
}

export type BookingV2PendingDeposit = {
  depositId: string
  appointmentId: string
  relatedAppointmentIds?: string[]
  serviceId: string
  mode: 'FIXED' | 'PERCENTAGE'
  configuredValue: number
  baseAmount: number | null
  amount: number
  status: 'awaiting_proof'
  expiresAt: string
}

export type BookingV2AdvisorQuote = {
  serviceId: string
  amount: number
  note: string | null
  status: 'awaiting_acceptance' | 'accepted'
  quotedAt: string
}

export function pendingDepositAppointmentIds(pending: BookingV2PendingDeposit) {
  return Array.from(new Set([
    pending.appointmentId,
    ...(pending.relatedAppointmentIds ?? [])
  ].filter(Boolean)))
}

export type BookingV2QuoteOnly = ServiceConsultationQueue

export type BookingV2ContextPause = {
  pausedAt: string
  expiresAt: string
}

export type BookingV2UnsupportedServiceRequest = {
  normalizedRequest: string
  count: number
}

export type BookingV2QueuedService = {
  serviceId: string
  evidence: string
}

export type BookingV2CombinedService = BookingV2QueuedService

export type BookingV2AddonSuggestion = {
  sourceServiceId: string
  candidateServiceIds: string[]
}

export type BookingV2CombinedAvailabilityOption = {
  date: string
  time: string
  professionalId: string
  professionalName: string
}

export type BookingV2PendingCombinedAvailability = {
  requestedDate: string
  options: BookingV2CombinedAvailabilityOption[]
}

export type BookingV2PendingServiceSeparation = {
  reason: 'blocked_combination' | 'no_common_professional' | 'service_set_change'
  edit?: {
    action: 'menu' | 'change' | 'remove'
    serviceIds: string[] | null
    addServiceIds?: string[] | null
  } | null
}

export type BookingV2PendingServiceReplacement = {
  removedServiceIds: string[]
}

export type BookingV2CoordinatedTimeBand = 'MORNING' | 'MIDDAY' | 'AFTERNOON'

export type BookingV2PendingCoordinatedAvailability = {
  serviceIds: string[]
  assignmentMode: 'SINGLE_PROFESSIONAL' | 'MULTIPLE_PROFESSIONALS'
  requestedProfessionalId: string | null
  requireRequestedProfessional: boolean
  phase: 'AWAITING_DATE' | 'AWAITING_SEARCH_TIME' | 'AWAITING_TIME_PREFERENCE' | 'AWAITING_OPTION' | 'AWAITING_SEARCH_MENU' | 'OPTION_SELECTED'
  date: string | null
  quickDates: string[]
  options: BookingAvailabilitySearchOption[]
  filteredOptionIds: string[]
  page: number
  timeBand: BookingV2CoordinatedTimeBand | null
  requestedTime: string | null
  requestedWindow: { startTime: string; endTime: string } | null
  selectedOptionId: string | null
}

export type BookingV2State = {
  draft: BookingDraft
  pendingProposal: BookingProposal | null
  pendingRequest: BookingV2PendingRequest | null
  pendingInformationSelection: BookingV2PendingInformationSelection | null
  pendingProfessionalScheduleSelection?: boolean
  lastInformationServiceId?: string | null
  pendingServiceDisambiguation: BookingV2PendingServiceDisambiguation | null
  agenda: BookingV2AgendaItem[]
  categoryAdvice: BookingV2CategoryAdvice | null
  catalogNavigation: BookingV2CatalogNavigation | null
  serviceValidation: BookingV2ServiceValidation | null
  guidedEstimate: BookingV2GuidedEstimate | null
  pendingPhotoQuote: BookingV2PendingPhotoQuote | null
  combinedServiceDecisionQueue: string[] | null
  advisorQuote: BookingV2AdvisorQuote | null
  quoteOnly: BookingV2QuoteOnly | null
  pendingDeposit: BookingV2PendingDeposit | null
  contextPause?: BookingV2ContextPause | null
  optionalNamePrompt: {
    promptedAt: string
    resumeMessage: string | null
  } | null
  unsupportedServiceRequest?: BookingV2UnsupportedServiceRequest | null
  queuedServices: BookingV2QueuedService[]
  combinedServices: BookingV2CombinedService[]
  addonSuggestion: BookingV2AddonSuggestion | null
  addonOfferCompletedServiceId: string | null
  pendingCombinedAvailability: BookingV2PendingCombinedAvailability | null
  pendingAvailabilityResolution: BookingV2PendingAvailabilityResolution | null
  pendingServiceSeparation: BookingV2PendingServiceSeparation | null
  pendingServiceReplacement: BookingV2PendingServiceReplacement | null
  pendingCoordinatedAvailability: BookingV2PendingCoordinatedAvailability | null
  requestedTimeWindow: { startTime: string; endTime: string } | null
  preliminaryAvailability: BookingV2PreliminaryAvailability | null
  misunderstandingCount: number
}

export type ConfidenceThresholds = {
  high: number
  medium: number
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.85,
  medium: 0.55
}

export function createEmptyBookingV2State(): BookingV2State {
  return {
    draft: {
      name: null,
      service: null,
      professional: null,
      date: null,
      time: null
    },
    pendingProposal: null,
    pendingRequest: null,
    pendingInformationSelection: null,
    pendingProfessionalScheduleSelection: false,
    lastInformationServiceId: null,
    pendingServiceDisambiguation: null,
    agenda: [],
    categoryAdvice: null,
    catalogNavigation: null,
    serviceValidation: null,
    guidedEstimate: null,
    pendingPhotoQuote: null,
    combinedServiceDecisionQueue: null,
    advisorQuote: null,
    quoteOnly: null,
    pendingDeposit: null,
    contextPause: null,
    optionalNamePrompt: null,
    unsupportedServiceRequest: null,
    queuedServices: [],
    combinedServices: [],
    addonSuggestion: null,
    addonOfferCompletedServiceId: null,
    pendingCombinedAvailability: null,
    pendingAvailabilityResolution: null,
    pendingServiceSeparation: null,
    pendingServiceReplacement: null,
    pendingCoordinatedAvailability: null,
    requestedTimeWindow: null,
    preliminaryAvailability: null,
    misunderstandingCount: 0
  }
}

export function queueAdditionalServices(
  state: BookingV2State,
  services: BookingV2QueuedService[]
): BookingV2State {
  const seen = new Set([
    state.draft.service,
    ...state.queuedServices.map((service) => service.serviceId)
  ].filter((serviceId): serviceId is string => Boolean(serviceId)))
  const queuedServices = [...state.queuedServices]
  for (const service of services) {
    if (!service.serviceId || seen.has(service.serviceId)) continue
    seen.add(service.serviceId)
    queuedServices.push(service)
  }
  return { ...state, queuedServices }
}

export function addCombinedServices(
  state: BookingV2State,
  services: BookingV2CombinedService[]
): BookingV2State {
  const seen = new Set([
    state.draft.service,
    ...state.combinedServices.map((service) => service.serviceId)
  ].filter((serviceId): serviceId is string => Boolean(serviceId)))
  const combinedServices = [...state.combinedServices]
  for (const service of services) {
    if (!service.serviceId || seen.has(service.serviceId)) continue
    seen.add(service.serviceId)
    combinedServices.push(service)
  }
  return {
    ...state,
    combinedServices: combinedServices.slice(0, 4),
    addonSuggestion: null,
    // Solo cerramos la etapa cuando el servicio agregado provino de una
    // oferta de extras. Los servicios del pedido inicial todavía deben pasar
    // por esa etapa una vez que se resuelva toda la lista.
    addonOfferCompletedServiceId: state.addonSuggestion
      ? Array.from(seen).sort().join('|') || null
      : state.addonOfferCompletedServiceId,
    pendingCombinedAvailability: null,
    pendingAvailabilityResolution: null,
    pendingServiceSeparation: null,
    pendingServiceReplacement: null,
    pendingCoordinatedAvailability: null
  }
}

export function combinedServiceIds(state: BookingV2State) {
  return [
    state.draft.service,
    ...state.combinedServices.map((service) => service.serviceId)
  ].filter((serviceId): serviceId is string => Boolean(serviceId))
}

export function advanceToNextQueuedService(state: BookingV2State) {
  const [nextService, ...remainingServices] = state.queuedServices
  if (!nextService) return null
  let nextState = createEmptyBookingV2State()
  if (state.draft.name) nextState = acceptField(nextState, 'name', state.draft.name)
  nextState = acceptField(nextState, 'service', nextService.serviceId)
  return {
    nextService,
    state: {
      ...nextState,
      queuedServices: remainingServices
    }
  }
}

export function confidenceLevel(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS
): ConfidenceLevel {
  if (confidence >= thresholds.high) return 'high'
  if (confidence >= thresholds.medium) return 'medium'
  return 'low'
}

export function bookingFieldsForOrder(order: BookingFlowOrder = 'PROFESSIONAL_FIRST') {
  return order === 'DATE_TIME_FIRST'
    ? ['name', 'service', 'date', 'time', 'professional'] as const
    : BOOKING_FIELDS
}

export function nextMissingField(
  draft: BookingDraft,
  order: BookingFlowOrder = 'PROFESSIONAL_FIRST'
): BookingField | 'confirmation' {
  for (const field of bookingFieldsForOrder(order)) {
    if (!draft[field]) return field
  }
  return 'confirmation'
}

export function acceptField(
  state: BookingV2State,
  field: BookingField,
  value: string
): BookingV2State {
  const timeBeforeDependencySelection = (
    (field === 'service' && state.draft.service === null) ||
    field === 'professional' ||
    (field === 'date' && state.draft.date === null)
  )
    ? state.draft.time
    : null
  let draft = invalidateDependents(
    {
      ...state.draft,
      [field]: value
    },
    field,
    state.draft[field] !== value
  )
  if (timeBeforeDependencySelection) {
    draft = { ...draft, time: timeBeforeDependencySelection }
  }
  if (field === 'service' && state.preliminaryAvailability?.phase === 'BOOKING') {
    draft = {
      ...draft,
      professional: state.preliminaryAvailability.professionalId,
      date: state.preliminaryAvailability.date,
      time: null
    }
  }

  return {
    ...state,
    draft,
    pendingProposal: null,
    pendingServiceDisambiguation: field === 'service'
      ? null
      : state.pendingServiceDisambiguation,
    categoryAdvice: field === 'service' ? null : state.categoryAdvice,
    catalogNavigation: field === 'service' ? null : state.catalogNavigation,
    serviceValidation: field === 'service' && state.draft[field] !== value
      ? null
      : state.serviceValidation,
    guidedEstimate: field === 'service' && state.draft[field] !== value
      ? null
      : state.guidedEstimate,
    pendingPhotoQuote: field === 'service' && state.draft[field] !== value
      ? null
      : state.pendingPhotoQuote,
    combinedServiceDecisionQueue: field === 'service' && state.draft[field] !== value
      ? null
      : state.combinedServiceDecisionQueue,
    advisorQuote: field === 'service' && state.draft[field] !== value
      ? null
      : state.advisorQuote,
    queuedServices: field === 'service'
      ? state.queuedServices.filter((service) => service.serviceId !== value)
      : state.queuedServices,
    combinedServices: field === 'service' && state.draft[field] !== value
      ? []
      : state.combinedServices,
    addonSuggestion: field === 'service' && state.draft[field] !== value
      ? null
      : state.addonSuggestion,
    addonOfferCompletedServiceId: field === 'service' && state.draft[field] !== value
      ? null
      : state.addonOfferCompletedServiceId,
    pendingCombinedAvailability: state.draft[field] !== value
      ? null
      : state.pendingCombinedAvailability,
    pendingAvailabilityResolution: state.draft[field] !== value
      ? null
      : state.pendingAvailabilityResolution,
    pendingServiceSeparation: state.draft[field] !== value
      ? null
      : state.pendingServiceSeparation,
    pendingServiceReplacement: state.draft[field] !== value
      ? null
      : state.pendingServiceReplacement,
    pendingCoordinatedAvailability: state.draft[field] !== value
      ? null
      : state.pendingCoordinatedAvailability,
    pendingDeposit: state.draft[field] !== value ? null : state.pendingDeposit,
    misunderstandingCount: 0
  }
}

export function proposeField(
  state: BookingV2State,
  proposal: Omit<BookingProposal, 'kind'>
): BookingV2State {
  return {
    ...state,
    pendingProposal: {
      ...proposal,
      kind: 'field'
    }
  }
}

export function proposeCorrection(
  state: BookingV2State,
  field: BookingField,
  evidence: string,
  value: string | null = null,
  confidence = 1
): BookingV2State {
  return {
    ...state,
    pendingProposal: {
      field,
      value,
      confidence,
      evidence,
      kind: 'correction'
    }
  }
}

export function confirmProposal(state: BookingV2State): BookingV2State {
  const proposal = state.pendingProposal
  if (!proposal) return state

  if (proposal.kind === 'correction' && proposal.value === null) {
    return {
      ...state,
      draft: clearFieldAndDependents(state.draft, proposal.field),
      pendingProposal: null,
      categoryAdvice: proposal.field === 'service' ? null : state.categoryAdvice,
      catalogNavigation: proposal.field === 'service' ? null : state.catalogNavigation,
      serviceValidation: proposal.field === 'service' ? null : state.serviceValidation,
      guidedEstimate: proposal.field === 'service' ? null : state.guidedEstimate,
      pendingPhotoQuote: proposal.field === 'service' ? null : state.pendingPhotoQuote,
      advisorQuote: proposal.field === 'service' ? null : state.advisorQuote,
      pendingDeposit: null,
      misunderstandingCount: 0
    }
  }

  if (proposal.value === null) return rejectProposal(state)
  const aheadTime = proposal.kind === 'field' &&
    proposal.field === 'date' &&
    state.draft.date === null
    ? state.draft.time
    : null
  const acceptedState = acceptField(state, proposal.field, proposal.value)
  return aheadTime
    ? {
        ...acceptedState,
        draft: {
          ...acceptedState.draft,
          time: aheadTime
        }
      }
    : acceptedState
}

export function rejectProposal(state: BookingV2State): BookingV2State {
  return {
    ...state,
    pendingProposal: null
  }
}

export function recordLowConfidence(state: BookingV2State): BookingV2State {
  return {
    ...state,
    pendingProposal: null,
    misunderstandingCount: state.misunderstandingCount + 1
  }
}

export function clearFieldAndDependents(draft: BookingDraft, field: BookingField): BookingDraft {
  return invalidateDependents(
    {
      ...draft,
      [field]: null
    },
    field,
    true
  )
}

function invalidateDependents(
  draft: BookingDraft,
  changedField: BookingField,
  changed: boolean
): BookingDraft {
  if (!changed) return draft

  if (changedField === 'service') {
    return {
      ...draft,
      professional: null,
      time: null
    }
  }

  if (changedField === 'professional' || changedField === 'date') {
    return {
      ...draft,
      time: null
    }
  }

  return draft
}
import type { ServiceConsultationQueue } from './service-consultation-queue.js'
