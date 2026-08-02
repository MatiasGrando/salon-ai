import {
  BOOKING_FIELDS,
  createEmptyBookingV2State,
  type BookingField,
  type BookingV2AdvisorQuote,
  type BookingV2CategoryAdvice,
  type BookingV2GuidedEstimate,
  type BookingV2PendingRequest,
  type BookingV2ServiceValidation,
  type BookingV2PendingDeposit,
  type BookingProposal,
  type BookingV2State
} from './booking-v2-state.js'

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
  categoryAdvice?: BookingV2CategoryAdvice | null
  serviceValidation?: BookingV2ServiceValidation | null
  guidedEstimate?: BookingV2GuidedEstimate | null
  advisorQuote?: BookingV2AdvisorQuote | null
  pendingDeposit?: BookingV2PendingDeposit | null
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
    categoryAdvice: readCategoryAdvice(conversation.bookingV2State),
    serviceValidation: readServiceValidation(conversation.bookingV2State),
    guidedEstimate: readGuidedEstimate(conversation.bookingV2State),
    advisorQuote: readAdvisorQuote(conversation.bookingV2State),
    pendingDeposit: readPendingDeposit(conversation.bookingV2State),
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
    bookingV2State: state.pendingProposal || state.pendingRequest || state.categoryAdvice || state.serviceValidation || state.guidedEstimate || state.advisorQuote || state.pendingDeposit
      ? {
          version: 1,
          pendingProposal: state.pendingProposal,
          ...(state.pendingRequest ? { pendingRequest: state.pendingRequest } : {}),
          ...(state.categoryAdvice ? { categoryAdvice: state.categoryAdvice } : {}),
          ...(state.serviceValidation ? { serviceValidation: state.serviceValidation } : {}),
          ...(state.guidedEstimate ? { guidedEstimate: state.guidedEstimate } : {}),
          ...(state.advisorQuote ? { advisorQuote: state.advisorQuote } : {}),
          ...(state.pendingDeposit ? { pendingDeposit: state.pendingDeposit } : {})
        }
      : null
  }
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
    createdAt: candidate.createdAt
  }
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
  return {
    depositId: candidate.depositId,
    appointmentId: candidate.appointmentId,
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
