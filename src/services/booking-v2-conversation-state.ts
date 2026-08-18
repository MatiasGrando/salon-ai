import {
  BOOKING_FIELDS,
  createEmptyBookingV2State,
  type BookingField,
  type BookingV2AdvisorQuote,
  type BookingV2QuoteOnly,
  type BookingV2ContextPause,
  type BookingV2AddonSuggestion,
  type BookingV2CombinedService,
  type BookingV2PendingCombinedAvailability,
  type BookingV2PendingServiceSeparation,
  type BookingV2PendingServiceReplacement,
  type BookingV2PendingCoordinatedAvailability,
  type BookingV2AgendaItem,
  type BookingV2CategoryAdvice,
  type BookingV2CatalogNavigation,
  type BookingV2GuidedEstimate,
  type BookingV2PendingPhotoQuote,
  type BookingV2PendingRequest,
  type BookingV2PendingInformationSelection,
  type BookingV2PendingServiceDisambiguation,
  type BookingV2ServiceDisambiguationGroup,
  type BookingV2QueuedService,
  type BookingV2ServiceValidation,
  type BookingV2UnsupportedServiceRequest,
  type BookingV2PendingDeposit,
  type BookingV2PreliminaryAvailability,
  type BookingProposal,
  type BookingV2State
} from './booking-v2-state.js'
import { parseBookingV2Extraction } from './booking-v2-extractor.js'
import {
  parsePendingAvailabilityResolution,
  type BookingV2PendingAvailabilityResolution
} from './booking-availability-resolution.js'
import { parseBookingAvailabilitySearchOption } from './booking-availability-search.js'

export type BookingV2ConversationSnapshot = {
  selectedCustomerName: string | null
  selectedServiceId: string | null
  selectedProfessionalId: string | null
  selectedDate: string | null
  selectedTime: string | null
  misunderstandingCount: number
  bookingV2State?: unknown
}

export type BookingV2ConversationPatch = {
  selectedCustomerName: string | null
  selectedServiceId: string | null
  selectedProfessionalId: string | null
  selectedDate: string | null
  selectedTime: string | null
  misunderstandingCount: number
  bookingV2State: BookingV2PersistedState | null
}

export type BookingV2PersistedState = {
  version: 1
  pendingProposal: BookingProposal | null
  pendingRequest?: BookingV2PendingRequest | null
  pendingInformationSelection?: BookingV2PendingInformationSelection | null
  lastInformationServiceId?: string | null
  pendingServiceDisambiguation?: BookingV2PendingServiceDisambiguation | null
  agenda?: BookingV2AgendaItem[]
  categoryAdvice?: BookingV2CategoryAdvice | null
  catalogNavigation?: BookingV2CatalogNavigation | null
  serviceValidation?: BookingV2ServiceValidation | null
  guidedEstimate?: BookingV2GuidedEstimate | null
  pendingPhotoQuote?: BookingV2PendingPhotoQuote | null
  combinedServiceDecisionQueue?: string[] | null
  advisorQuote?: BookingV2AdvisorQuote | null
  quoteOnly?: BookingV2QuoteOnly | null
  pendingDeposit?: BookingV2PendingDeposit | null
  contextPause?: BookingV2ContextPause | null
  optionalNamePrompt?: {
    promptedAt: string
    resumeMessage: string | null
  } | null
  unsupportedServiceRequest?: BookingV2UnsupportedServiceRequest | null
  queuedServices?: BookingV2QueuedService[]
  combinedServices?: BookingV2CombinedService[]
  addonSuggestion?: BookingV2AddonSuggestion | null
  addonOfferCompletedServiceId?: string | null
  pendingCombinedAvailability?: BookingV2PendingCombinedAvailability | null
  pendingAvailabilityResolution?: BookingV2PendingAvailabilityResolution | null
  pendingServiceSeparation?: BookingV2PendingServiceSeparation | null
  pendingServiceReplacement?: BookingV2PendingServiceReplacement | null
  pendingCoordinatedAvailability?: BookingV2PendingCoordinatedAvailability | null
  preliminaryAvailability?: BookingV2PreliminaryAvailability | null
}

export function stateFromConversation(
  conversation: BookingV2ConversationSnapshot | null
): BookingV2State {
  if (!conversation) return createEmptyBookingV2State()

  return {
    draft: {
      name: conversation.selectedCustomerName,
      service: conversation.selectedServiceId,
      professional: conversation.selectedProfessionalId,
      date: conversation.selectedDate,
      time: conversation.selectedTime
    },
    pendingProposal: readPendingProposal(conversation.bookingV2State),
    pendingRequest: readPendingRequest(conversation.bookingV2State),
    pendingInformationSelection: readPendingInformationSelection(conversation.bookingV2State),
    lastInformationServiceId: readLastInformationServiceId(conversation.bookingV2State),
    pendingServiceDisambiguation: readPendingServiceDisambiguation(conversation.bookingV2State),
    agenda: readAgenda(conversation.bookingV2State),
    categoryAdvice: readCategoryAdvice(conversation.bookingV2State),
    catalogNavigation: readCatalogNavigation(conversation.bookingV2State),
    serviceValidation: readServiceValidation(conversation.bookingV2State),
    guidedEstimate: readGuidedEstimate(conversation.bookingV2State),
    pendingPhotoQuote: readPendingPhotoQuote(conversation.bookingV2State),
    combinedServiceDecisionQueue: readCombinedServiceDecisionQueue(conversation.bookingV2State),
    advisorQuote: readAdvisorQuote(conversation.bookingV2State),
    quoteOnly: readQuoteOnly(conversation.bookingV2State),
    pendingDeposit: readPendingDeposit(conversation.bookingV2State),
    contextPause: readContextPause(conversation.bookingV2State),
    optionalNamePrompt: readOptionalNamePrompt(conversation.bookingV2State),
    unsupportedServiceRequest: readUnsupportedServiceRequest(conversation.bookingV2State),
    queuedServices: readQueuedServices(conversation.bookingV2State),
    combinedServices: readCombinedServices(conversation.bookingV2State),
    addonSuggestion: readAddonSuggestion(conversation.bookingV2State),
    addonOfferCompletedServiceId: readAddonOfferCompletedServiceId(conversation.bookingV2State),
    pendingCombinedAvailability: readPendingCombinedAvailability(conversation.bookingV2State),
    pendingAvailabilityResolution: readPendingAvailabilityResolution(conversation.bookingV2State),
    pendingServiceSeparation: readPendingServiceSeparation(conversation.bookingV2State),
    pendingServiceReplacement: readPendingServiceReplacement(conversation.bookingV2State),
    pendingCoordinatedAvailability: readPendingCoordinatedAvailability(conversation.bookingV2State),
    preliminaryAvailability: readPreliminaryAvailability(conversation.bookingV2State),
    misunderstandingCount: conversation.misunderstandingCount
  }
}

export function conversationPatchFromState(state: BookingV2State): BookingV2ConversationPatch {
  return {
    selectedCustomerName: state.draft.name,
    selectedServiceId: state.draft.service,
    selectedProfessionalId: state.draft.professional,
    selectedDate: state.draft.date,
    selectedTime: state.draft.time,
    misunderstandingCount: state.misunderstandingCount,
    bookingV2State: state.pendingProposal || state.pendingRequest || state.pendingInformationSelection || state.lastInformationServiceId || state.pendingServiceDisambiguation || state.agenda.length || state.categoryAdvice || state.catalogNavigation || state.serviceValidation || state.guidedEstimate || state.pendingPhotoQuote || state.combinedServiceDecisionQueue !== null || state.advisorQuote || state.quoteOnly || state.pendingDeposit || state.contextPause || state.optionalNamePrompt || state.unsupportedServiceRequest || state.queuedServices.length || state.combinedServices.length || state.addonSuggestion || state.addonOfferCompletedServiceId || state.pendingCombinedAvailability || state.pendingAvailabilityResolution || state.pendingServiceSeparation || state.pendingServiceReplacement || state.pendingCoordinatedAvailability || state.preliminaryAvailability
      ? {
          version: 1,
          pendingProposal: state.pendingProposal,
          ...(state.pendingRequest ? { pendingRequest: state.pendingRequest } : {}),
          ...(state.pendingInformationSelection
            ? { pendingInformationSelection: state.pendingInformationSelection }
            : {}),
          ...(state.lastInformationServiceId ? { lastInformationServiceId: state.lastInformationServiceId } : {}),
          ...(state.pendingServiceDisambiguation
            ? { pendingServiceDisambiguation: state.pendingServiceDisambiguation }
            : {}),
          ...(state.agenda.length ? { agenda: state.agenda } : {}),
          ...(state.categoryAdvice ? { categoryAdvice: state.categoryAdvice } : {}),
          ...(state.catalogNavigation ? { catalogNavigation: state.catalogNavigation } : {}),
          ...(state.serviceValidation ? { serviceValidation: state.serviceValidation } : {}),
          ...(state.guidedEstimate ? { guidedEstimate: state.guidedEstimate } : {}),
          ...(state.pendingPhotoQuote ? { pendingPhotoQuote: state.pendingPhotoQuote } : {}),
          ...(state.combinedServiceDecisionQueue !== null
            ? { combinedServiceDecisionQueue: state.combinedServiceDecisionQueue }
            : {}),
          ...(state.advisorQuote ? { advisorQuote: state.advisorQuote } : {}),
          ...(state.quoteOnly ? { quoteOnly: state.quoteOnly } : {}),
          ...(state.pendingDeposit ? { pendingDeposit: state.pendingDeposit } : {}),
          ...(state.contextPause ? { contextPause: state.contextPause } : {}),
          ...(state.optionalNamePrompt ? { optionalNamePrompt: state.optionalNamePrompt } : {}),
          ...(state.unsupportedServiceRequest
            ? { unsupportedServiceRequest: state.unsupportedServiceRequest }
            : {}),
          ...(state.queuedServices.length ? { queuedServices: state.queuedServices } : {}),
          ...(state.combinedServices.length ? { combinedServices: state.combinedServices } : {}),
          ...(state.addonSuggestion ? { addonSuggestion: state.addonSuggestion } : {}),
          ...(state.addonOfferCompletedServiceId
            ? { addonOfferCompletedServiceId: state.addonOfferCompletedServiceId }
            : {}),
          ...(state.pendingCombinedAvailability
            ? { pendingCombinedAvailability: state.pendingCombinedAvailability }
            : {}),
          ...(state.pendingAvailabilityResolution
            ? { pendingAvailabilityResolution: state.pendingAvailabilityResolution }
            : {}),
          ...(state.pendingServiceSeparation
            ? { pendingServiceSeparation: state.pendingServiceSeparation }
            : {}),
          ...(state.pendingServiceReplacement
            ? { pendingServiceReplacement: state.pendingServiceReplacement }
            : {}),
          ...(state.pendingCoordinatedAvailability
            ? { pendingCoordinatedAvailability: state.pendingCoordinatedAvailability }
            : {}),
          ...(state.preliminaryAvailability
            ? { preliminaryAvailability: state.preliminaryAvailability }
            : {})
        }
      : null
  }
}

function readPreliminaryAvailability(value: unknown): BookingV2PreliminaryAvailability | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { preliminaryAvailability?: unknown }).preliminaryAvailability
  if (!candidate || typeof candidate !== 'object') return null
  const pending = candidate as Partial<BookingV2PreliminaryAvailability>
  if (
    pending.phase !== 'AWAITING_BOOKING_DECISION' &&
    pending.phase !== 'BOOKING'
  ) return null
  if (
    typeof pending.professionalId !== 'string' || !pending.professionalId.trim() ||
    typeof pending.professionalName !== 'string' || !pending.professionalName.trim() ||
    typeof pending.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pending.date) ||
    typeof pending.referenceServiceId !== 'string' || !pending.referenceServiceId.trim() ||
    !(pending.timeFrom === null || (
      typeof pending.timeFrom === 'string' && /^\d{2}:\d{2}$/.test(pending.timeFrom)
    ))
  ) return null
  return {
    phase: pending.phase,
    professionalId: pending.professionalId.trim(),
    professionalName: pending.professionalName.trim(),
    date: pending.date,
    timeFrom: pending.timeFrom ?? null,
    referenceServiceId: pending.referenceServiceId.trim()
  }
}

function readOptionalNamePrompt(value: unknown): NonNullable<BookingV2State['optionalNamePrompt']> | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { optionalNamePrompt?: unknown }).optionalNamePrompt
  if (!candidate || typeof candidate !== 'object') return null
  const prompt = candidate as { promptedAt?: unknown; resumeMessage?: unknown }
  if (typeof prompt.promptedAt !== 'string' || Number.isNaN(new Date(prompt.promptedAt).getTime())) {
    return null
  }
  if (prompt.resumeMessage !== null && typeof prompt.resumeMessage !== 'string') return null
  return {
    promptedAt: prompt.promptedAt,
    resumeMessage: typeof prompt.resumeMessage === 'string' && prompt.resumeMessage.trim()
      ? prompt.resumeMessage.trim()
      : null
  }
}

function readLastInformationServiceId(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const serviceId = (value as { lastInformationServiceId?: unknown }).lastInformationServiceId
  return typeof serviceId === 'string' && serviceId.trim() ? serviceId : null
}

function readPendingServiceDisambiguation(value: unknown): BookingV2PendingServiceDisambiguation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingServiceDisambiguation?: unknown }).pendingServiceDisambiguation
  if (!candidate || typeof candidate !== 'object') return null
  const pending = readServiceDisambiguationGroup(candidate)
  if (!pending) return null
  const rawRemainingGroups = (candidate as { remainingGroups?: unknown }).remainingGroups
  const remainingGroups = Array.isArray(rawRemainingGroups)
    ? rawRemainingGroups
        .map(readServiceDisambiguationGroup)
        .filter((group): group is BookingV2ServiceDisambiguationGroup => Boolean(group))
        .slice(0, 4)
    : []
  return {
    ...pending,
    ...(remainingGroups.length ? { remainingGroups } : {})
  }
}

function readServiceDisambiguationGroup(value: unknown): BookingV2ServiceDisambiguationGroup | null {
  if (!value || typeof value !== 'object') return null
  const pending = value as { serviceIds?: unknown; evidence?: unknown; catalogFallback?: unknown }
  if (!Array.isArray(pending.serviceIds)) return null
  const serviceIds = Array.from(new Set(
    pending.serviceIds
      .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
      .map((serviceId) => serviceId.trim())
  )).slice(0, 5)
  if (serviceIds.length < 1) return null
  return {
    serviceIds,
    evidence: typeof pending.evidence === 'string' ? pending.evidence.trim().slice(0, 500) : '',
    ...(pending.catalogFallback === true ? { catalogFallback: true } : {})
  }
}

function readCombinedServices(value: unknown): BookingV2CombinedService[] {
  if (!value || typeof value !== 'object') return []
  const persisted = value as { version?: unknown; combinedServices?: unknown }
  if (persisted.version !== 1 || !Array.isArray(persisted.combinedServices)) return []
  const seen = new Set<string>()
  return persisted.combinedServices.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<BookingV2CombinedService>
    const serviceId = candidate.serviceId?.trim()
    if (!serviceId || seen.has(serviceId)) return []
    seen.add(serviceId)
    return [{ serviceId, evidence: candidate.evidence?.trim() || '' }]
  }).slice(0, 4)
}

function readAddonSuggestion(value: unknown): BookingV2AddonSuggestion | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { addonSuggestion?: unknown }).addonSuggestion
  if (!candidate || typeof candidate !== 'object') return null
  const suggestion = candidate as Partial<BookingV2AddonSuggestion>
  if (typeof suggestion.sourceServiceId !== 'string' || !Array.isArray(suggestion.candidateServiceIds)) {
    return null
  }
  const candidateServiceIds = suggestion.candidateServiceIds
    .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
    .map((serviceId) => serviceId.trim())
    .slice(0, 4)
  return candidateServiceIds.length
    ? { sourceServiceId: suggestion.sourceServiceId, candidateServiceIds }
    : null
}

function readAddonOfferCompletedServiceId(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { addonOfferCompletedServiceId?: unknown }).addonOfferCompletedServiceId
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function readPendingCombinedAvailability(value: unknown): BookingV2PendingCombinedAvailability | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingCombinedAvailability?: unknown }).pendingCombinedAvailability
  if (!candidate || typeof candidate !== 'object') return null
  const pending = candidate as Partial<BookingV2PendingCombinedAvailability>
  if (typeof pending.requestedDate !== 'string' || !Array.isArray(pending.options)) return null
  const options = pending.options.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const option = item as Record<string, unknown>
    if (
      typeof option.date !== 'string' ||
      typeof option.time !== 'string' ||
      typeof option.professionalId !== 'string' ||
      typeof option.professionalName !== 'string'
    ) return []
    return [{
      date: option.date,
      time: option.time,
      professionalId: option.professionalId,
      professionalName: option.professionalName
    }]
  }).slice(0, 9)
  return options.length ? { requestedDate: pending.requestedDate, options } : null
}

function readPendingAvailabilityResolution(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingAvailabilityResolution?: unknown }).pendingAvailabilityResolution
  return parsePendingAvailabilityResolution(candidate)
}

function readPendingServiceSeparation(value: unknown): BookingV2PendingServiceSeparation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingServiceSeparation?: unknown }).pendingServiceSeparation
  if (!candidate || typeof candidate !== 'object') return null
  const pending = candidate as { reason?: unknown; edit?: unknown }
  const reason = pending.reason
  if (reason !== 'blocked_combination' && reason !== 'no_common_professional') return null
  if (!pending.edit || typeof pending.edit !== 'object') return { reason }
  const edit = pending.edit as { action?: unknown; serviceIds?: unknown }
  if (edit.action !== 'menu' && edit.action !== 'change' && edit.action !== 'remove') return { reason }
  const serviceIds = edit.serviceIds === null
    ? null
    : Array.isArray(edit.serviceIds)
      ? edit.serviceIds
          .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
          .map((serviceId) => serviceId.trim())
          .slice(0, 5)
      : null
  return { reason, edit: { action: edit.action, serviceIds } }
}

function readPendingServiceReplacement(value: unknown): BookingV2PendingServiceReplacement | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingServiceReplacement?: unknown }).pendingServiceReplacement
  if (!candidate || typeof candidate !== 'object') return null
  const removedServiceIds = (candidate as { removedServiceIds?: unknown }).removedServiceIds
  if (!Array.isArray(removedServiceIds)) return null
  const validIds = removedServiceIds
    .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
    .map((serviceId) => serviceId.trim())
    .slice(0, 5)
  return validIds.length ? { removedServiceIds: validIds } : null
}

function readPendingCoordinatedAvailability(
  value: unknown
): BookingV2PendingCoordinatedAvailability | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { pendingCoordinatedAvailability?: unknown })
    .pendingCoordinatedAvailability
  if (!candidate || typeof candidate !== 'object') return null
  const pending = candidate as Partial<BookingV2PendingCoordinatedAvailability>
  if (
    !Array.isArray(pending.serviceIds) ||
    !['AWAITING_DATE', 'AWAITING_SEARCH_TIME', 'AWAITING_TIME_PREFERENCE', 'AWAITING_OPTION', 'AWAITING_SEARCH_MENU', 'OPTION_SELECTED'].includes(pending.phase ?? '') ||
    !Array.isArray(pending.quickDates) ||
    !Array.isArray(pending.options) ||
    !Array.isArray(pending.filteredOptionIds)
  ) return null
  const serviceIds = pending.serviceIds.filter((item): item is string =>
    typeof item === 'string' && Boolean(item.trim())
  ).slice(0, 5)
  if (!serviceIds.length) return null
  const options = pending.options.flatMap((item) => {
    const option = parseBookingAvailabilitySearchOption(item)
    return option ? [option] : []
  }).slice(0, 25)
  const optionIds = new Set(options.map((option) => option.id))
  const filteredOptionIds = pending.filteredOptionIds.filter((item): item is string =>
    typeof item === 'string' && optionIds.has(item)
  )
  const timeBand = ['MORNING', 'MIDDAY', 'AFTERNOON'].includes(pending.timeBand ?? '')
    ? pending.timeBand as BookingV2PendingCoordinatedAvailability['timeBand']
    : null
  const requestedWindow = pending.requestedWindow &&
    typeof pending.requestedWindow.startTime === 'string' &&
    typeof pending.requestedWindow.endTime === 'string'
    ? {
        startTime: pending.requestedWindow.startTime,
        endTime: pending.requestedWindow.endTime
      }
    : null
  return {
    serviceIds,
    assignmentMode: pending.assignmentMode === 'SINGLE_PROFESSIONAL'
      ? 'SINGLE_PROFESSIONAL'
      : 'MULTIPLE_PROFESSIONALS',
    requestedProfessionalId: typeof pending.requestedProfessionalId === 'string'
      ? pending.requestedProfessionalId
      : null,
    requireRequestedProfessional: pending.requireRequestedProfessional === true,
    phase: pending.phase as BookingV2PendingCoordinatedAvailability['phase'],
    date: typeof pending.date === 'string' ? pending.date : null,
    quickDates: pending.quickDates.filter((item): item is string => typeof item === 'string').slice(0, 5),
    options,
    filteredOptionIds,
    page: Number.isInteger(pending.page) && Number(pending.page) >= 0 ? Number(pending.page) : 0,
    timeBand,
    requestedTime: typeof pending.requestedTime === 'string' ? pending.requestedTime : null,
    requestedWindow,
    selectedOptionId: typeof pending.selectedOptionId === 'string' && optionIds.has(pending.selectedOptionId)
      ? pending.selectedOptionId
      : null
  }
}

function readQueuedServices(value: unknown): BookingV2QueuedService[] {
  if (!value || typeof value !== 'object') return []
  const persisted = value as { version?: unknown; queuedServices?: unknown }
  if (persisted.version !== 1 || !Array.isArray(persisted.queuedServices)) return []
  const seen = new Set<string>()
  const services: BookingV2QueuedService[] = []
  for (const item of persisted.queuedServices) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<BookingV2QueuedService>
    const serviceId = candidate.serviceId?.trim()
    if (!serviceId || seen.has(serviceId)) continue
    seen.add(serviceId)
    services.push({
      serviceId,
      evidence: candidate.evidence?.trim() || ''
    })
  }
  return services.slice(0, 5)
}

function readUnsupportedServiceRequest(value: unknown): BookingV2UnsupportedServiceRequest | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { unsupportedServiceRequest?: unknown }
  const request = persisted.unsupportedServiceRequest
  if (!request || typeof request !== 'object') return null
  const candidate = request as { normalizedRequest?: unknown; count?: unknown }
  if (
    typeof candidate.normalizedRequest !== 'string' ||
    !candidate.normalizedRequest.trim() ||
    typeof candidate.count !== 'number' ||
    !Number.isInteger(candidate.count) ||
    candidate.count < 1
  ) {
    return null
  }
  return {
    normalizedRequest: candidate.normalizedRequest,
    count: candidate.count
  }
}

function readContextPause(value: unknown): BookingV2ContextPause | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; contextPause?: unknown }
  if (persisted.version !== 1 || !persisted.contextPause || typeof persisted.contextPause !== 'object') return null
  const candidate = persisted.contextPause as Partial<BookingV2ContextPause>
  if (typeof candidate.pausedAt !== 'string' || Number.isNaN(new Date(candidate.pausedAt).getTime())) return null
  if (typeof candidate.expiresAt !== 'string' || Number.isNaN(new Date(candidate.expiresAt).getTime())) return null
  return { pausedAt: candidate.pausedAt, expiresAt: candidate.expiresAt }
}

function readAgenda(value: unknown): BookingV2AgendaItem[] {
  if (!value || typeof value !== 'object') return []
  const persisted = value as { version?: unknown; agenda?: unknown }
  if (persisted.version !== 1 || !Array.isArray(persisted.agenda)) return []

  const items: BookingV2AgendaItem[] = []
  for (const rawItem of persisted.agenda.slice(0, 8)) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Partial<BookingV2AgendaItem>
    if (item.intent !== 'request_quote' && item.intent !== 'check_availability') continue
    if (!['pending', 'blocked', 'completed'].includes(item.status ?? '')) continue
    if (typeof item.evidence !== 'string') continue
    if (item.blockedBy !== null && item.blockedBy !== 'quote_pending') continue
    if (typeof item.createdAt !== 'string' || Number.isNaN(new Date(item.createdAt).getTime())) continue
    if (items.some((existing) => existing.intent === item.intent)) continue
    items.push({
      intent: item.intent,
      status: item.status as BookingV2AgendaItem['status'],
      evidence: item.evidence.trim().slice(0, 500),
      serviceId: typeof item.serviceId === 'string' && item.serviceId.trim()
        ? item.serviceId.trim()
        : null,
      serviceInformationProvided: item.serviceInformationProvided === true,
      blockedBy: item.blockedBy,
      createdAt: item.createdAt
    })
  }
  return items
}

function readPendingRequest(value: unknown): BookingV2PendingRequest | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; pendingRequest?: unknown }
  if (persisted.version !== 1 || !persisted.pendingRequest || typeof persisted.pendingRequest !== 'object') {
    return null
  }
  const candidate = persisted.pendingRequest as Partial<BookingV2PendingRequest>
  if (typeof candidate.message !== 'string' || !candidate.message.trim()) return null
  if (!Array.isArray(candidate.intents) || !candidate.intents.every((intent) => typeof intent === 'string')) {
    return null
  }
  if (typeof candidate.createdAt !== 'string' || Number.isNaN(new Date(candidate.createdAt).getTime())) {
    return null
  }
  return {
    message: candidate.message.trim().slice(0, 1200),
    intents: Array.from(new Set(candidate.intents.map((intent) => intent.trim()).filter(Boolean))).slice(0, 8),
    extraction: parseBookingV2Extraction(candidate.extraction),
    createdAt: candidate.createdAt
  }
}

function readPendingInformationSelection(value: unknown): BookingV2PendingInformationSelection | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; pendingInformationSelection?: unknown }
  if (
    persisted.version !== 1 ||
    !persisted.pendingInformationSelection ||
    typeof persisted.pendingInformationSelection !== 'object'
  ) {
    return null
  }
  const candidate = persisted.pendingInformationSelection as Partial<BookingV2PendingInformationSelection>
  if (!Array.isArray(candidate.serviceIds) || !Array.isArray(candidate.requestedInformation)) return null
  const serviceIds = Array.from(new Set(
    candidate.serviceIds
      .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
      .map((serviceId) => serviceId.trim())
  )).slice(0, 5)
  const requestedInformation = Array.from(new Set(
    candidate.requestedInformation.filter((item): item is BookingV2PendingInformationSelection['requestedInformation'][number] =>
      ['general', 'price', 'deposit', 'duration', 'professionals'].includes(item)
    )
  ))
  return serviceIds.length > 1 && requestedInformation.length
    ? { serviceIds, requestedInformation, ...(candidate.quoteOnly === true ? { quoteOnly: true } : {}) }
    : null
}

function readCategoryAdvice(value: unknown): BookingV2CategoryAdvice | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; categoryAdvice?: unknown }
  if (
    persisted.version !== 1 ||
    !persisted.categoryAdvice ||
    typeof persisted.categoryAdvice !== 'object'
  ) {
    return null
  }
  const candidate = persisted.categoryAdvice as Partial<BookingV2CategoryAdvice>
  if (typeof candidate.categoryName !== 'string' || !candidate.categoryName.trim()) return null
  if (!['offered', 'awaiting_confirmation', 'requested'].includes(candidate.stage ?? '')) {
    return null
  }
  return {
    categoryName: candidate.categoryName.trim(),
    stage: candidate.stage as BookingV2CategoryAdvice['stage']
  }
}

function readCatalogNavigation(value: unknown): BookingV2CatalogNavigation | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; catalogNavigation?: unknown }
  if (
    persisted.version !== 1 ||
    !persisted.catalogNavigation ||
    typeof persisted.catalogNavigation !== 'object'
  ) {
    return null
  }
  const candidate = persisted.catalogNavigation as Partial<BookingV2CatalogNavigation>
  if (candidate.view !== 'CATEGORY' && candidate.view !== 'ALL_SERVICES') return null
  if (candidate.categoryKey !== null && typeof candidate.categoryKey !== 'string') return null
  if (candidate.categoryName !== null && typeof candidate.categoryName !== 'string') return null
  if (candidate.pendingCategoryKey !== null && typeof candidate.pendingCategoryKey !== 'string') return null
  if (candidate.pendingCategoryName !== null && typeof candidate.pendingCategoryName !== 'string') return null
  return {
    view: candidate.view,
    categoryKey: candidate.categoryKey?.trim() || null,
    categoryName: candidate.categoryName?.trim() || null,
    pendingCategoryKey: candidate.pendingCategoryKey?.trim() || null,
    pendingCategoryName: candidate.pendingCategoryName?.trim() || null
  }
}

function readServiceValidation(value: unknown): BookingV2ServiceValidation | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; serviceValidation?: unknown }
  if (
    persisted.version !== 1 ||
    !persisted.serviceValidation ||
    typeof persisted.serviceValidation !== 'object'
  ) {
    return null
  }
  const candidate = persisted.serviceValidation as Partial<BookingV2ServiceValidation>
  if (typeof candidate.serviceId !== 'string') return null
  if (candidate.stage !== 'awaiting_confirmation' && candidate.stage !== 'completed') return null
  return {
    serviceId: candidate.serviceId,
    stage: candidate.stage
  }
}

function readPendingProposal(value: unknown): BookingProposal | null {
  if (!value || typeof value !== 'object') return null

  const persisted = value as {
    version?: unknown
    pendingProposal?: unknown
  }
  if (persisted.version !== 1) return null

  const proposal = persisted.pendingProposal
  if (!proposal || typeof proposal !== 'object') return null

  const candidate = proposal as Partial<BookingProposal>
  if (!isBookingField(candidate.field)) return null
  if (candidate.value !== null && typeof candidate.value !== 'string') return null
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) return null
  if (typeof candidate.evidence !== 'string') return null
  if (candidate.kind !== 'field' && candidate.kind !== 'correction') return null

  return {
    field: candidate.field,
    value: candidate.value,
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    evidence: candidate.evidence,
    kind: candidate.kind
  }
}

function readGuidedEstimate(value: unknown): BookingV2GuidedEstimate | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; guidedEstimate?: unknown }
  if (persisted.version !== 1 || !persisted.guidedEstimate || typeof persisted.guidedEstimate !== 'object') {
    return null
  }
  const candidate = persisted.guidedEstimate as Partial<BookingV2GuidedEstimate>
  if (typeof candidate.serviceId !== 'string') return null
  if (!['awaiting_option', 'awaiting_decision', 'completed'].includes(candidate.stage ?? '')) return null
  if (candidate.optionId !== null && typeof candidate.optionId !== 'string') return null
  if (candidate.optionLabel !== null && typeof candidate.optionLabel !== 'string') return null
  if (candidate.priceMin !== null && (typeof candidate.priceMin !== 'number' || !Number.isFinite(candidate.priceMin))) return null
  if (candidate.priceMax !== null && (typeof candidate.priceMax !== 'number' || !Number.isFinite(candidate.priceMax))) return null
  return {
    serviceId: candidate.serviceId,
    stage: candidate.stage as BookingV2GuidedEstimate['stage'],
    optionId: candidate.optionId ?? null,
    optionLabel: candidate.optionLabel ?? null,
    priceMin: candidate.priceMin ?? null,
    priceMax: candidate.priceMax ?? null
  }
}

function readPendingPhotoQuote(value: unknown): BookingV2PendingPhotoQuote | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; pendingPhotoQuote?: unknown }
  if (
    persisted.version !== 1 ||
    !persisted.pendingPhotoQuote ||
    typeof persisted.pendingPhotoQuote !== 'object'
  ) {
    return null
  }
  const candidate = persisted.pendingPhotoQuote as Partial<BookingV2PendingPhotoQuote>
  if (
    typeof candidate.serviceId !== 'string' ||
    typeof candidate.requestedAt !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.requestedAt)) ||
    !Number.isFinite(Date.parse(candidate.expiresAt))
  ) {
    return null
  }
  return {
    serviceId: candidate.serviceId,
    requestedAt: candidate.requestedAt,
    expiresAt: candidate.expiresAt
  }
}

function readCombinedServiceDecisionQueue(value: unknown): string[] | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; combinedServiceDecisionQueue?: unknown }
  if (persisted.version !== 1 || !Array.isArray(persisted.combinedServiceDecisionQueue)) return null
  return Array.from(new Set(
    persisted.combinedServiceDecisionQueue
      .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
      .map((serviceId) => serviceId.trim())
  )).slice(0, 4)
}

function readAdvisorQuote(value: unknown): BookingV2AdvisorQuote | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; advisorQuote?: unknown }
  if (persisted.version !== 1 || !persisted.advisorQuote || typeof persisted.advisorQuote !== 'object') {
    return null
  }
  const candidate = persisted.advisorQuote as Partial<BookingV2AdvisorQuote>
  if (typeof candidate.serviceId !== 'string') return null
  if (typeof candidate.amount !== 'number' || !Number.isInteger(candidate.amount) || candidate.amount <= 0) return null
  if (candidate.note !== null && typeof candidate.note !== 'string') return null
  if (candidate.status !== 'awaiting_acceptance' && candidate.status !== 'accepted') return null
  if (typeof candidate.quotedAt !== 'string' || Number.isNaN(new Date(candidate.quotedAt).getTime())) return null
  return {
    serviceId: candidate.serviceId,
    amount: candidate.amount,
    note: candidate.note?.trim() || null,
    status: candidate.status,
    quotedAt: candidate.quotedAt
  }
}

function readQuoteOnly(value: unknown): BookingV2QuoteOnly | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; quoteOnly?: unknown }
  if (persisted.version !== 1 || !persisted.quoteOnly || typeof persisted.quoteOnly !== 'object') return null
  const remainingServiceIds = Array.from(new Set(
    Array.isArray((persisted.quoteOnly as { remainingServiceIds?: unknown }).remainingServiceIds)
      ? (persisted.quoteOnly as { remainingServiceIds: unknown[] }).remainingServiceIds
          .filter((serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim()))
          .map((serviceId) => serviceId.trim())
      : []
  )).slice(0, 4)
  const estimates = Array.isArray((persisted.quoteOnly as { estimates?: unknown }).estimates)
    ? (persisted.quoteOnly as { estimates: unknown[] }).estimates.flatMap((estimate) => {
        if (!estimate || typeof estimate !== 'object') return []
        const candidate = estimate as { serviceId?: unknown; priceMin?: unknown; priceMax?: unknown }
        if (typeof candidate.serviceId !== 'string' || !candidate.serviceId.trim()) return []
        if (typeof candidate.priceMin !== 'number' || !Number.isFinite(candidate.priceMin) || candidate.priceMin < 0) return []
        if (candidate.priceMax !== null && (typeof candidate.priceMax !== 'number' || !Number.isFinite(candidate.priceMax))) return []
        return [{
          serviceId: candidate.serviceId.trim(),
          priceMin: candidate.priceMin,
          priceMax: candidate.priceMax ?? null
        }]
      }).slice(0, 4)
    : []
  const mode = (persisted.quoteOnly as { mode?: unknown }).mode === 'price'
    ? 'price' as const
    : 'quote' as const
  return { mode, remainingServiceIds, estimates }
}

function readPendingDeposit(value: unknown): BookingV2PendingDeposit | null {
  if (!value || typeof value !== 'object') return null
  const persisted = value as { version?: unknown; pendingDeposit?: unknown }
  if (persisted.version !== 1 || !persisted.pendingDeposit || typeof persisted.pendingDeposit !== 'object') {
    return null
  }
  const candidate = persisted.pendingDeposit as Partial<BookingV2PendingDeposit>
  if (typeof candidate.depositId !== 'string') return null
  if (typeof candidate.appointmentId !== 'string') return null
  if (typeof candidate.serviceId !== 'string') return null
  if (candidate.mode !== 'FIXED' && candidate.mode !== 'PERCENTAGE') return null
  if (typeof candidate.configuredValue !== 'number' || !Number.isFinite(candidate.configuredValue)) return null
  if (candidate.baseAmount !== null && (typeof candidate.baseAmount !== 'number' || !Number.isFinite(candidate.baseAmount))) {
    return null
  }
  if (typeof candidate.amount !== 'number' || !Number.isFinite(candidate.amount)) return null
  if (candidate.status !== 'awaiting_proof') return null
  if (typeof candidate.expiresAt !== 'string' || Number.isNaN(new Date(candidate.expiresAt).getTime())) return null
  const relatedAppointmentIds = Array.isArray(candidate.relatedAppointmentIds)
    ? Array.from(new Set(candidate.relatedAppointmentIds.filter((id): id is string =>
        typeof id === 'string' && Boolean(id.trim())
      ))).slice(0, 5)
    : []
  return {
    depositId: candidate.depositId,
    appointmentId: candidate.appointmentId,
    ...(relatedAppointmentIds.length ? { relatedAppointmentIds } : {}),
    serviceId: candidate.serviceId,
    mode: candidate.mode,
    configuredValue: candidate.configuredValue,
    baseAmount: candidate.baseAmount ?? null,
    amount: candidate.amount,
    status: candidate.status,
    expiresAt: candidate.expiresAt
  }
}

function isBookingField(value: unknown): value is BookingField {
  return typeof value === 'string' && BOOKING_FIELDS.includes(value as BookingField)
}
