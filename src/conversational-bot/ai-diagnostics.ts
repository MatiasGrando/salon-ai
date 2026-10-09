import { AVAILABILITY_CAUSES } from '../bot-options/application/availability-evidence.js'
import type { AvailabilityDiagnostic, DialogueState } from './engine.js'
import { TURN_PLAN_LIMITS, TurnPlanValidationError, type TurnPlanValidationCause, type TurnOperation } from './turn-plan.js'
import { BASKET_LIMITS, basketIsResolved } from './service-basket.js'

type RequestKind = TurnOperation['kind']
const requestKinds: readonly RequestKind[] = ['confirm_proposal', 'request_change', 'service', 'basket', 'estimate', 'professional', 'date', 'time', 'time_preference', 'time_clarification', 'name', 'information', 'unsupported_action']
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
export type InterpretationRepairFeedback = { reason: ValidationReason; cause?: TurnPlanValidationCause }
export type InterpretationAttemptDiagnostic = {
  reason: 'invalid_output' | 'timeout' | 'provider_error' | null
  providerMs: number; validationMs: number; validation: ValidationSummary
}
/** Model repair receives validator codes only, never a rejected model body or arbitrary exception. */
export function summarizeInterpretationRepairFeedback(value: unknown): InterpretationRepairFeedback | undefined {
  const reason = dataField(value, 'reason'), cause = dataField(value, 'cause')
  if (!Object.values(reasonByMessage).includes(reason as ValidationReason)) return undefined
  if (cause !== undefined && (reason !== 'turn_plan' || !['evidence','shape','catalog','conflict','estimate'].includes(cause as string))) return undefined
  return { reason: reason as ValidationReason, ...(cause === undefined ? {} : { cause: cause as TurnPlanValidationCause }) }
}
/** Bounded own-data projection for at most two actual interpretations. */
export function summarizeInterpretationAttemptsDiagnostic(value: unknown): InterpretationAttemptDiagnostic[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return undefined
  const result: InterpretationAttemptDiagnostic[] = []
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index))?.value
    const reason = dataField(item, 'reason'), providerMs = dataField(item, 'providerMs'), validationMs = dataField(item, 'validationMs')
    const validation = summarizeValidationDiagnostic(dataField(item, 'validation'))
    if (![null,'invalid_output','timeout','provider_error'].includes(reason as string | null) || !validation ||
        typeof providerMs !== 'number' || !Number.isFinite(providerMs) || providerMs < 0 ||
        typeof validationMs !== 'number' || !Number.isFinite(validationMs) || validationMs < 0 ||
        validation.outcome !== (reason === null ? 'accepted' : reason === 'invalid_output' ? 'rejected' : 'not_run')) return undefined
    result.push({ reason: reason as InterpretationAttemptDiagnostic['reason'], providerMs: Math.min(providerMs, 60000),
      validationMs: Math.min(validationMs, 60000), validation })
  }
  return result
}

/** Public diagnostic boundary: copy only closed own data, never model text, IDs or accessors. */
export function summarizeValidationDiagnostic(value: unknown): ValidationSummary | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const outcome = dataField(value, 'outcome')
    const reason = dataField(value, 'reason')
    if (!['accepted', 'rejected', 'not_run'].includes(outcome as string) ||
        (outcome === 'accepted' ? reason !== null : outcome === 'not_run' ? reason !== 'not_run'
          : !Object.values(reasonByMessage).includes(reason as ValidationReason))) return undefined
    const fields = Object.fromEntries(['service', 'professional', 'candidates', 'correction'].map(key => [key, dataField(value, key)]))
    if (Object.values(fields).some(field => !['accepted', 'rejected', 'absent'].includes(field as string))) return undefined
    const result = { outcome, reason, ...fields } as ValidationSummary
    if (Object.hasOwn(value, 'turnPlan')) {
      const rawPlan = dataField(value, 'turnPlan')
      const planOutcome = dataField(rawPlan, 'outcome'), planReason = dataField(rawPlan, 'reason')
      const rawKinds = dataField(rawPlan, 'validationAcceptedKinds')
      if (planOutcome !== outcome || planReason !== (outcome === 'accepted' ? null : outcome === 'not_run' ? 'not_run' : 'turn_plan') ||
          !Array.isArray(rawKinds) || rawKinds.length > TURN_PLAN_LIMITS.operations) return undefined
      const kinds: RequestKind[] = []
      for (let index = 0; index < rawKinds.length; index++) {
        const kind = Object.getOwnPropertyDescriptor(rawKinds, String(index))?.value
        if (!requestKinds.includes(kind as RequestKind)) return undefined
        kinds.push(kind as RequestKind)
      }
      const cause = dataField(rawPlan, 'cause')
      if (rawPlan && Object.hasOwn(rawPlan as object, 'cause') &&
          !['evidence', 'shape', 'catalog', 'conflict', 'estimate'].includes(cause as string)) return undefined
      result.turnPlan = { outcome: planOutcome as ValidationSummary['outcome'], validationAcceptedKinds: kinds,
        reason: planReason as NonNullable<ValidationSummary['turnPlan']>['reason'],
        ...(cause === undefined ? {} : { cause: cause as TurnPlanValidationCause }) }
    }
    return result
  } catch { return undefined }
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
