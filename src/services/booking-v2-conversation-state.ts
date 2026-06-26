import {
  BOOKING_FIELDS,
  createEmptyBookingV2State,
  type BookingField,
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
    bookingV2State: state.pendingProposal
      ? {
          version: 1,
          pendingProposal: state.pendingProposal
        }
      : null
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

function isBookingField(value: unknown): value is BookingField {
  return typeof value === 'string' && BOOKING_FIELDS.includes(value as BookingField)
}
