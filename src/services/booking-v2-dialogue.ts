import type { BookingField, BookingV2State } from './booking-v2-state.js'
import type { BookingV2Interpretation } from './booking-v2-interpreter.js'

export type BookingV2MessagePlan =
  | {
      type: 'ask_field'
      field: BookingField
      reason: 'missing' | 'not_understood'
      misunderstandingCount: number
    }
  | {
      type: 'confirm_field'
      field: BookingField
      value: string
      evidence: string
    }
  | {
      type: 'confirm_correction'
      field: BookingField
      value: string | null
      evidence: string
    }
  | {
      type: 'confirm_booking'
    }
  | {
      type: 'ask_estimate_option'
      reason: 'missing' | 'not_understood'
    }
  | {
      type: 'show_estimate'
      optionLabel: string
      priceMin: number
      priceMax: number | null
      note: string | null
      allowsBooking: boolean
    }
  | {
      type: 'ask_estimate_decision'
      allowsBooking: boolean
    }
  | {
      type: 'ask_service_validation'
      reason: 'missing' | 'not_understood'
    }
  | {
      type: 'handoff'
      reason:
        | 'repeated_misunderstanding'
        | 'no_compatible_professional'
        | 'quote_required'
        | 'advisor_required'
        | 'photo_required'
        | 'estimate_quote_requested'
        | 'service_validation_uncertain'
    }

export function buildBookingV2MessagePlan(
  interpretation: BookingV2Interpretation
): BookingV2MessagePlan {
  const state = interpretation.state

  if (interpretation.outcome === 'not_understood') {
    if (state.misunderstandingCount >= 3) {
      return {
        type: 'handoff',
        reason: 'repeated_misunderstanding'
      }
    }

    return {
      type: 'ask_field',
      field: interpretation.affectedField ?? firstMissingField(state),
      reason: 'not_understood',
      misunderstandingCount: state.misunderstandingCount
    }
  }

  if (state.pendingProposal?.kind === 'correction') {
    return {
      type: 'confirm_correction',
      field: state.pendingProposal.field,
      value: state.pendingProposal.value,
      evidence: state.pendingProposal.evidence
    }
  }

  if (state.pendingProposal?.kind === 'field' && state.pendingProposal.value) {
    return {
      type: 'confirm_field',
      field: state.pendingProposal.field,
      value: state.pendingProposal.value,
      evidence: state.pendingProposal.evidence
    }
  }

  if (interpretation.nextField === 'confirmation') {
    return { type: 'confirm_booking' }
  }

  return {
    type: 'ask_field',
    field: interpretation.nextField,
    reason: 'missing',
    misunderstandingCount: state.misunderstandingCount
  }
}

function firstMissingField(state: BookingV2State): BookingField {
  if (!state.draft.name) return 'name'
  if (!state.draft.service) return 'service'
  if (!state.draft.professional) return 'professional'
  if (!state.draft.date) return 'date'
  return 'time'
}
