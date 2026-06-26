import {
  BOOKING_FIELDS,
  acceptField,
  confidenceLevel,
  nextMissingField,
  proposeCorrection,
  proposeField,
  recordLowConfidence,
  type BookingField,
  type BookingV2State
} from './booking-v2-state.js'
import type { BookingV2Extraction, ExtractedBookingField } from './booking-v2-extractor.js'

export type BookingV2Catalog = {
  serviceIds: ReadonlySet<string>
  professionalIds: ReadonlySet<string>
  professionalServiceIds?: ReadonlyMap<string, ReadonlySet<string>>
}

export type BookingV2Interpretation = {
  state: BookingV2State
  nextField: BookingField | 'confirmation'
  outcome: 'accepted' | 'confirmation_required' | 'not_understood' | 'no_change'
  affectedField: BookingField | null
}

export function applyBookingV2Extraction(
  initialState: BookingV2State,
  extraction: BookingV2Extraction,
  catalog: BookingV2Catalog
): BookingV2Interpretation {
  if (extraction.correction.field && extraction.correction.confidence >= 0.55) {
    const state = proposeCorrection(
      initialState,
      extraction.correction.field,
      extraction.correction.evidence,
      validValue(extraction.correction.field, extraction.correction.newValue, catalog, initialState),
      extraction.correction.confidence
    )
    return result(state, 'confirmation_required', extraction.correction.field)
  }

  let state = initialState
  let acceptedField: BookingField | null = null
  const missingBefore = nextMissingField(initialState.draft)

  for (const field of BOOKING_FIELDS) {
    const extracted = extraction[field]
    if (!extracted.value || !extracted.evidence) continue
    const value = validValue(field, extracted.value, catalog, state)
    if (!value) continue

    const level = confidenceLevel(extracted.confidence)
    if (level === 'high') {
      state = acceptField(state, field, value)
      acceptedField = field
    }
  }

  for (const field of BOOKING_FIELDS) {
    const extracted = extraction[field]
    if (!extracted.value || !extracted.evidence) continue
    const value = validValue(field, extracted.value, catalog, state)
    if (!value || confidenceLevel(extracted.confidence) !== 'medium') continue

    state = proposeField(state, {
      field,
      value,
      confidence: extracted.confidence,
      evidence: extracted.evidence
    })
    return result(state, 'confirmation_required', field)
  }

  if (acceptedField) return result(state, 'accepted', acceptedField)

  if (missingBefore !== 'confirmation') {
    const currentExtraction = extraction[missingBefore]
    if (hasLowConfidenceEvidence(currentExtraction)) {
      state = recordLowConfidence(state)
      return result(state, 'not_understood', missingBefore)
    }
  }

  return result(state, 'no_change', null)
}

function result(
  state: BookingV2State,
  outcome: BookingV2Interpretation['outcome'],
  affectedField: BookingField | null
): BookingV2Interpretation {
  return {
    state,
    nextField: nextMissingField(state.draft),
    outcome,
    affectedField
  }
}

function validValue(
  field: BookingField,
  value: string | null,
  catalog: BookingV2Catalog,
  state: BookingV2State
) {
  if (!value) return null
  if (field === 'service') return catalog.serviceIds.has(value) ? value : null
  if (field === 'professional') {
    if (!catalog.professionalIds.has(value)) return null
    const selectedService = state.draft.service
    if (!selectedService || !catalog.professionalServiceIds) return value
    return catalog.professionalServiceIds.get(value)?.has(selectedService) ? value : null
  }
  return value
}

function hasLowConfidenceEvidence(field: ExtractedBookingField) {
  return Boolean(field.evidence) && confidenceLevel(field.confidence) === 'low'
}
