import { AVAILABILITY_CAUSES } from '../bot-options/application/availability-evidence.js'
import type { AvailabilityDiagnostic, DialogueState } from './engine.js'
import { TURN_PLAN_LIMITS, TurnPlanValidationError, type TurnPlanValidationCause, type TurnOperation } from './turn-plan.js'
import { BASKET_LIMITS, basketIsResolved } from './service-basket.js'

type RequestKind = TurnOperation['kind']
type BasketSummary = { mutation: 'set' | 'add' | 'remove' | 'replace' | 'unknown'; memberCount: number; targetCount: number; singleCount: number; alternativeCount: number; unresolvedCount: number }
export type TurnPlanSummary = { operationCount: number; kinds: RequestKind[]; basket?: BasketSummary; estimateCount?: number }

export type ProposalSummary = {
  intent: 'booking' | 'information' | 'other' | 'unknown'
  service: boolean
  serviceEvidence: boolean
  professional: boolean
  candidateCount: number
  correction: boolean
  firstReply: boolean
  intakeReply: boolean
  turnPlan?: TurnPlanSummary
}
export type ValidationReason = 'not_run' | 'shape' | 'keys' | 'intent' | 'field' | 'confidence' |
  'correction' | 'candidates' | 'candidate_evidence' | 'correction_evidence' |
  'service_evidence_missing' | 'service_evidence_not_in_message' | 'service_not_in_catalog' |
  'professional_evidence_not_in_message' | 'information_target' | 'information_target_conflict' | 'turn_plan'
export type ValidationSummary = {
  outcome: 'accepted' | 'rejected' | 'not_run'
  reason: ValidationReason | null
  service: 'accepted' | 'rejected' | 'absent'
  professional: 'accepted' | 'rejected' | 'absent'
  candidates: 'accepted' | 'rejected' | 'absent'
  correction: 'accepted' | 'rejected' | 'absent'
  /** Contract acceptance only; motor outcomes remain stateBefore/stateAfter and server facts. */
  turnPlan?: { outcome: ValidationSummary['outcome']; validationAcceptedKinds: RequestKind[]; reason: 'turn_plan' | 'not_run' | null; cause?: TurnPlanValidationCause }
}
export type StateSummary = {
  pending: DialogueState['pending']
  service: boolean
  date: boolean
  professional: boolean
  professionalHint: boolean
  slot: boolean
  name: boolean
  basketMembers?: number
  basketAlternatives?: number
  basketUnresolved?: number
  basketResolved?: boolean
  editRequestedFields?: import('./turn-plan.js').DraftEditField[]
  estimateSelections?: number
}
const dataField = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
export function summarizeProposal(raw: unknown): ProposalSummary {
  const intent = dataField(raw, 'intent')
  const candidates = dataField(raw, 'serviceCandidateIds')
  const rawPlan = dataField(raw, 'turnPlan')
  const operations = dataField(rawPlan, 'operations')
  const planOperations = Array.isArray(operations) ? operations.slice(0, TURN_PLAN_LIMITS.operations + 1) : []
  const requestKinds: readonly RequestKind[] = ['confirm_proposal', 'request_change', 'service', 'basket', 'estimate', 'professional', 'date', 'time', 'time_preference', 'time_clarification', 'name', 'information', 'unsupported_action']
  const kinds = [...new Set(planOperations.map(operation => dataField(operation, 'kind')).filter((kind): kind is RequestKind => requestKinds.includes(kind as RequestKind)))]
  const serviceOperation = planOperations.find(operation => dataField(operation, 'kind') === 'service')
  const planCandidates = dataField(serviceOperation, 'serviceIds')
  const basketOperation = planOperations.find(operation => dataField(operation, 'kind') === 'basket')
  const rawMembers = dataField(basketOperation, 'members')
  const rawTargets = dataField(basketOperation, 'targetMemberIds')
  const members = Array.isArray(rawMembers) ? rawMembers.slice(0, BASKET_LIMITS.members + 1) : []
  const rawMutation = dataField(basketOperation, 'mutation')
  const mutation: BasketSummary['mutation'] = rawMutation === 'set' || rawMutation === 'add' || rawMutation === 'remove' || rawMutation === 'replace' ? rawMutation : 'unknown'
  const basket = basketOperation ? {
    mutation, memberCount: members.length, targetCount: Array.isArray(rawTargets) ? Math.min(rawTargets.length, BASKET_LIMITS.members + 1) : 0,
    singleCount: members.filter(member => dataField(member, 'mode') === 'single').length,
    alternativeCount: members.filter(member => dataField(member, 'mode') === 'alternatives').length,
    unresolvedCount: members.filter(member => dataField(member, 'mode') === 'unresolved').length
  } : undefined
  const basketCandidateCount = members.reduce((sum, member) => {
    const ids = dataField(member, 'serviceIds')
    return sum + (Array.isArray(ids) ? Math.min(ids.length, BASKET_LIMITS.candidates + 1) : 0)
  }, 0)
  return {
    intent: intent === 'booking' || intent === 'information' || intent === 'other' ? intent : 'unknown',
    service: dataField(raw, 'serviceId') != null || kinds.includes('service') || kinds.includes('basket'),
    serviceEvidence: dataField(raw, 'serviceEvidence') != null || kinds.includes('service') || kinds.includes('basket'),
    professional: dataField(raw, 'professionalMention') != null || kinds.includes('professional'),
    candidateCount: basket ? Math.min(basketCandidateCount, BASKET_LIMITS.members * BASKET_LIMITS.candidates + 1) : Array.isArray(planCandidates) ? Math.min(planCandidates.length, TURN_PLAN_LIMITS.candidates + 1) : Array.isArray(candidates) ? Math.min(candidates.length, 11) : 0,
    correction: dataField(raw, 'serviceCorrection') === true || dataField(serviceOperation, 'correction') === true || mutation === 'replace' || mutation === 'remove',
    firstReply: dataField(raw, 'firstReply') != null,
    intakeReply: dataField(raw, 'intakeReply') != null,
    ...(rawPlan != null ? { turnPlan: { operationCount: Array.isArray(operations) ? Math.min(operations.length, TURN_PLAN_LIMITS.operations + 1) : 0, kinds, ...(basket ? { basket } : {}), ...(kinds.includes('estimate') ? { estimateCount: planOperations.filter(operation => dataField(operation, 'kind') === 'estimate').length } : {}) } } : {})
  }
}
const reasonByMessage: Record<string, ValidationReason> = {
  'invalid AI output': 'shape',
  'invalid AI output keys': 'keys',
  'invalid AI intent': 'intent',
  'invalid AI field': 'field',
  'invalid AI confidence': 'confidence',
  'invalid AI correction': 'correction',
  'invalid AI candidates': 'candidates',
  'invalid AI candidate evidence': 'candidate_evidence',
  'invalid AI correction evidence': 'correction_evidence',
  'missing service evidence': 'service_evidence_missing',
  'ungrounded service evidence': 'service_evidence_not_in_message',
  'service not in catalog': 'service_not_in_catalog',
  'ungrounded AI service': 'service_evidence_not_in_message',
  'ungrounded AI professional': 'professional_evidence_not_in_message',
  'invalid AI information target': 'information_target',
  'conflicting AI information target': 'information_target_conflict',
  'invalid AI turn plan': 'turn_plan'
}
export function summarizeValidation(proposal: ProposalSummary, accepted: boolean, error?: unknown, ran = true): ValidationSummary {
  const outcome = !ran ? 'not_run' : accepted ? 'accepted' : 'rejected'
  const field = (present: boolean): 'accepted' | 'rejected' | 'absent' =>
    !present ? 'absent' : accepted ? 'accepted' : 'rejected'
  return {
    outcome,
    reason: !ran ? 'not_run' : accepted ? null :
      error instanceof Error ? reasonByMessage[error.message] ?? 'shape' : 'shape',
    service: field(proposal.service), professional: field(proposal.professional),
    candidates: field(proposal.candidateCount > 0), correction: field(proposal.correction),
    ...(proposal.turnPlan ? { turnPlan: { outcome, validationAcceptedKinds: accepted && ran ? proposal.turnPlan.kinds : [], reason: !ran ? 'not_run' as const : accepted ? null : 'turn_plan' as const, ...(!accepted && ran && error instanceof TurnPlanValidationError ? { cause: error.validationCause } : {}) } } : {})
  }
}
export function summarizeState(state: DialogueState): StateSummary {
  return {
    pending: state.pending,
    service: basketIsResolved(state),
    date: state.date !== null,
    professional: state.professional !== null,
    professionalHint: state.professionalNameHint !== null,
    slot: state.slot !== null,
    name: state.customerName !== null,
    ...(state.editRequest ? { editRequestedFields: [...state.editRequest.fields] } : {}),
    ...(state.serviceEstimates ? { estimateSelections: Math.min(Object.keys(state.serviceEstimates).length, BASKET_LIMITS.members) } : {}),
    ...(state.basket ? { basketMembers: state.basket.members.length,
      basketAlternatives: state.basket.members.filter(member => member.mode === 'alternatives').length,
      basketUnresolved: state.basket.members.filter(member => member.mode === 'unresolved').length,
      basketResolved: basketIsResolved(state) } : {})
  }
}

/** Closed, own-data-only diagnostics: no arbitrary strings, IDs, provider text or exceptions. */
export function summarizeAvailability(value: unknown): AvailabilityDiagnostic | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const keys = Object.keys(value).sort().join(',')
    if (keys !== 'outcome,phase,reason' && keys !== 'outcome,phase,reason,scope') return undefined
    const outcome = dataField(value, 'outcome')
    const phase = dataField(value, 'phase')
    const reason = dataField(value, 'reason')
    const scope = dataField(value, 'scope')
    const blocked = ['SERVICE_UNAVAILABLE', 'INVALID_CONFIGURATION', 'DOMAIN_REVIEW', 'PHOTO_REQUIRED', 'VALIDATION_REQUIRED', 'ESTIMATE_NOT_BOOKABLE', 'INVALID_DURATION', 'COMBINATION_BLOCKED', 'COMBINATION_REVIEW', 'NO_COMMON_PROFESSIONAL', 'PREFERRED_PROFESSIONAL_INCOMPATIBLE']
    const unsupported = ['UNSUPPORTED_OCCUPANCY', 'PORT_UNAVAILABLE', 'CUSTOMER_DURATION_PROOF_MISSING', 'GUIDANCE_RESULT_NOT_PENDING']
    if (!['verified', 'no_slots', 'guidance_required', 'blocked', 'unsupported'].includes(outcome as string) ||
        !['preflight', 'query', 'fresh_guidance', 'contract', 'slots'].includes(phase as string) ||
        (scope !== undefined && scope !== 'all_compatible' && scope !== 'preferred') ||
        (keys.includes('scope') && scope === undefined) ||
        (phase === 'preflight' || outcome === 'no_slots' && reason === 'DATE_PAST' ? scope !== undefined : scope === undefined)) return undefined
    if (outcome === 'verified' || outcome === 'no_slots') {
      if (phase !== 'slots' || outcome === 'verified' && reason !== null ||
          outcome === 'no_slots' && reason !== null && !(AVAILABILITY_CAUSES as readonly unknown[]).includes(reason)) return undefined
    } else if (phase === 'slots' ||
      (outcome === 'guidance_required' ? reason !== 'GUIDANCE_REQUIRED' || (phase !== 'preflight' && phase !== 'fresh_guidance')
        : outcome === 'blocked' ? !blocked.includes(reason as string) || phase === 'contract'
        : !unsupported.includes(reason as string))) return undefined
    if (reason === 'PORT_UNAVAILABLE' && phase !== 'preflight' ||
        reason === 'CUSTOMER_DURATION_PROOF_MISSING' && phase !== 'contract' ||
        reason === 'GUIDANCE_RESULT_NOT_PENDING' && phase !== 'fresh_guidance' ||
        phase === 'contract' && reason !== 'CUSTOMER_DURATION_PROOF_MISSING') return undefined
    return { outcome, phase, reason, ...(scope ? { scope } : {}) } as AvailabilityDiagnostic
  } catch { return undefined }
}
