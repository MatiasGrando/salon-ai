import type { DialogueState } from './engine.js'

export type ProposalSummary = {
  intent: 'booking' | 'information' | 'other' | 'unknown'
  service: boolean
  serviceEvidence: boolean
  professional: boolean
  candidateCount: number
  correction: boolean
  firstReply: boolean
  intakeReply: boolean
}
export type ValidationReason = 'not_run' | 'shape' | 'keys' | 'intent' | 'field' | 'confidence' |
  'correction' | 'candidates' | 'candidate_evidence' | 'correction_evidence' |
  'service_evidence_missing' | 'service_evidence_not_in_message' | 'service_not_in_catalog' |
  'professional_evidence_not_in_message' | 'information_target' | 'information_target_conflict'
export type ValidationSummary = {
  outcome: 'accepted' | 'rejected' | 'not_run'
  reason: ValidationReason | null
  service: 'accepted' | 'rejected' | 'absent'
  professional: 'accepted' | 'rejected' | 'absent'
  candidates: 'accepted' | 'rejected' | 'absent'
  correction: 'accepted' | 'rejected' | 'absent'
}
export type StateSummary = {
  pending: DialogueState['pending']
  service: boolean
  date: boolean
  professional: boolean
  professionalHint: boolean
  slot: boolean
  name: boolean
}
const dataField = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
export function summarizeProposal(raw: unknown): ProposalSummary {
  const intent = dataField(raw, 'intent')
  const candidates = dataField(raw, 'serviceCandidateIds')
  return {
    intent: intent === 'booking' || intent === 'information' || intent === 'other' ? intent : 'unknown',
    service: dataField(raw, 'serviceId') != null,
    serviceEvidence: dataField(raw, 'serviceEvidence') != null,
    professional: dataField(raw, 'professionalMention') != null,
    candidateCount: Array.isArray(candidates) ? Math.min(candidates.length, 11) : 0,
    correction: dataField(raw, 'serviceCorrection') === true,
    firstReply: dataField(raw, 'firstReply') != null,
    intakeReply: dataField(raw, 'intakeReply') != null
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
  'conflicting AI information target': 'information_target_conflict'
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
    candidates: field(proposal.candidateCount > 0), correction: field(proposal.correction)
  }
}
export function summarizeState(state: DialogueState): StateSummary {
  return {
    pending: state.pending,
    service: state.serviceId !== null,
    date: state.date !== null,
    professional: state.professional !== null,
    professionalHint: state.professionalNameHint !== null,
    slot: state.slot !== null,
    name: state.customerName !== null
  }
}
