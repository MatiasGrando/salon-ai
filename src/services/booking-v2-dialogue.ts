import { nextMissingField, type BookingField, type BookingFlowOrder, type BookingV2State } from './booking-v2-state.js'
import type { BookingV2Interpretation } from './booking-v2-interpreter.js'
import type { BookingV2CombinedAvailabilityOption } from './booking-v2-state.js'

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
      type: 'clarify_professional'
      professionalIds: string[]
    }
  | {
      type: 'confirm_booking'
    }
  | {
      type: 'ask_service_addons'
      serviceIds: string[]
    }
  | {
      type: 'offer_combined_availability'
      requestedDate: string
      options: BookingV2CombinedAvailabilityOption[]
    }
  | {
      type: 'offer_separate_services'
      reason: 'blocked_combination' | 'no_common_professional'
    }
  | {
      type: 'ask_service_edit_target'
      action: 'change' | 'remove'
      serviceIds: string[]
    }
  | {
      type: 'confirm_service_edit'
      action: 'change' | 'remove'
      serviceIds: string[]
    }
  | {
      type: 'ask_service_replacement'
      selectedServiceIds: string[]
    }
  | {
      type: 'show_service_preview_and_ask_name'
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
      type: 'show_base_estimate'
      priceMin: number
      allowsBooking: boolean
    }
  | {
      type: 'ask_estimate_decision'
      allowsBooking: boolean
    }
  | {
      type: 'quote_complete'
    }
  | {
      type: 'ask_service_validation'
      reason: 'missing' | 'not_understood'
    }
  | {
      type: 'ask_category_advice_confirmation'
      categoryName: string
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
        | 'category_advice_requested'
        | 'service_selection_uncertain'
        | 'service_validation_uncertain'
        | 'combination_review_required'
      categoryName?: string
    }

export function buildBookingV2MessagePlan(
  interpretation: BookingV2Interpretation,
  bookingFlowOrder: BookingFlowOrder = 'PROFESSIONAL_FIRST'
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
      field: interpretation.affectedField ?? firstMissingField(state, bookingFlowOrder),
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

function firstMissingField(state: BookingV2State, bookingFlowOrder: BookingFlowOrder): BookingField {
  const field = nextMissingField(state.draft, bookingFlowOrder)
  return field === 'confirmation' ? 'time' : field
}
