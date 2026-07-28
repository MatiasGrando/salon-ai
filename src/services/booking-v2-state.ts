export const BOOKING_FIELDS = ['name', 'service', 'professional', 'date', 'time'] as const
export const ANY_PROFESSIONAL_ID = '__any_professional__'

export type BookingField = (typeof BOOKING_FIELDS)[number]
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

export type BookingV2PendingDeposit = {
  serviceId: string
  mode: 'FIXED' | 'PERCENTAGE'
  configuredValue: number
  baseAmount: number | null
  amount: number
  status: 'awaiting_proof'
}

export type BookingV2State = {
  draft: BookingDraft
  pendingProposal: BookingProposal | null
  guidedEstimate: BookingV2GuidedEstimate | null
  pendingDeposit: BookingV2PendingDeposit | null
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
    guidedEstimate: null,
    pendingDeposit: null,
    misunderstandingCount: 0
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

export function nextMissingField(draft: BookingDraft): BookingField | 'confirmation' {
  for (const field of BOOKING_FIELDS) {
    if (!draft[field]) return field
  }
  return 'confirmation'
}

export function acceptField(
  state: BookingV2State,
  field: BookingField,
  value: string
): BookingV2State {
  const draft = invalidateDependents(
    {
      ...state.draft,
      [field]: value
    },
    field,
    state.draft[field] !== value
  )

  return {
    ...state,
    draft,
    pendingProposal: null,
    guidedEstimate: field === 'service' && state.draft[field] !== value
      ? null
      : state.guidedEstimate,
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
      guidedEstimate: proposal.field === 'service' ? null : state.guidedEstimate,
      pendingDeposit: null,
      misunderstandingCount: 0
    }
  }

  if (proposal.value === null) return rejectProposal(state)
  return acceptField(state, proposal.field, proposal.value)
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
