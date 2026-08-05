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
  createdAt: string
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

export type BookingV2PendingDeposit = {
  depositId: string
  appointmentId: string
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
  reason: 'blocked_combination' | 'no_common_professional'
}

export type BookingV2State = {
  draft: BookingDraft
  pendingProposal: BookingProposal | null
  pendingRequest: BookingV2PendingRequest | null
  agenda: BookingV2AgendaItem[]
  categoryAdvice: BookingV2CategoryAdvice | null
  catalogNavigation: BookingV2CatalogNavigation | null
  serviceValidation: BookingV2ServiceValidation | null
  guidedEstimate: BookingV2GuidedEstimate | null
  advisorQuote: BookingV2AdvisorQuote | null
  pendingDeposit: BookingV2PendingDeposit | null
  contextPause?: BookingV2ContextPause | null
  unsupportedServiceRequest?: BookingV2UnsupportedServiceRequest | null
  queuedServices: BookingV2QueuedService[]
  combinedServices: BookingV2CombinedService[]
  addonSuggestion: BookingV2AddonSuggestion | null
  addonOfferCompletedServiceId: string | null
  pendingCombinedAvailability: BookingV2PendingCombinedAvailability | null
  pendingServiceSeparation: BookingV2PendingServiceSeparation | null
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
    agenda: [],
    categoryAdvice: null,
    catalogNavigation: null,
    serviceValidation: null,
    guidedEstimate: null,
    advisorQuote: null,
    pendingDeposit: null,
    contextPause: null,
    unsupportedServiceRequest: null,
    queuedServices: [],
    combinedServices: [],
    addonSuggestion: null,
    addonOfferCompletedServiceId: null,
    pendingCombinedAvailability: null,
    pendingServiceSeparation: null,
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
    addonOfferCompletedServiceId: state.draft.service,
    pendingCombinedAvailability: null,
    pendingServiceSeparation: null
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
  const timeBeforeProfessionalSelection = field === 'professional' ? state.draft.time : null
  let draft = invalidateDependents(
    {
      ...state.draft,
      [field]: value
    },
    field,
    state.draft[field] !== value
  )
  if (timeBeforeProfessionalSelection) {
    draft = { ...draft, time: timeBeforeProfessionalSelection }
  }

  return {
    ...state,
    draft,
    pendingProposal: null,
    categoryAdvice: field === 'service' ? null : state.categoryAdvice,
    catalogNavigation: field === 'service' ? null : state.catalogNavigation,
    serviceValidation: field === 'service' && state.draft[field] !== value
      ? null
      : state.serviceValidation,
    guidedEstimate: field === 'service' && state.draft[field] !== value
      ? null
      : state.guidedEstimate,
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
    pendingServiceSeparation: state.draft[field] !== value
      ? null
      : state.pendingServiceSeparation,
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
