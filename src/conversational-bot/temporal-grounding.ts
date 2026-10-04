import { TurnPlanValidationError } from './turn-plan.js'
import { approximateTimeRequest, parseTimePreference, type TimePreference } from './time-preference.js'
import type { DialogueState } from './engine.js'
import { parseMinutes } from '../bot-options/application/availability-queries.js'
type Context = Pick<DialogueState, 'timePreference'> & { timeClarification?: { candidateTimes: string[] } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function parseTimeClarification(value: unknown): { candidateTimes: string[] } {
  if (!record(value) || Object.keys(value).join(',') !== 'candidateTimes' || !Array.isArray(value.candidateTimes) || value.candidateTimes.length !== 2 ||
      value.candidateTimes.some(time => typeof time !== 'string' || parseMinutes(time) === null) ||
      parseMinutes(value.candidateTimes[1])! - parseMinutes(value.candidateTimes[0])! !== 720) throw new Error('invalid temporal clarification')
  return { candidateTimes: [...value.candidateTimes] }
}
function contextTime(candidates: readonly string[], preference: TimePreference | undefined): string | null {
  if (candidates.length === 1) return candidates[0]!
  if (preference?.kind === 'around' && candidates.includes(preference.time)) return preference.time
  if (preference?.kind === 'band') {
    const selected = candidates.filter(time => preference.band === 'MORNING' ? parseMinutes(time)! < 720 : parseMinutes(time)! >= 720)
    if (selected.length === 1) return selected[0]!
  }
  return null
}
function wellShapedTemporal(op: Record<string, unknown>): boolean {
  const keys = Object.keys(op).sort().join(',')
  if (op.kind === 'time') return keys === 'confidence,evidence,kind,value' && typeof op.value === 'string' && parseMinutes(op.value) !== null
  if (op.kind === 'time_clarification') {
    try { return keys === 'candidateTimes,confidence,evidence,kind' && !!parseTimeClarification({ candidateTimes: op.candidateTimes }) } catch { return false }
  }
  if (op.kind === 'time_preference') {
    try { return keys === 'confidence,evidence,kind,preference' && !!parseTimePreference(op.preference) } catch { return false }
  }
  return false
}
/** Reconcile a model proposal with a verified numeric approximation, without losing independent operations. */
export function groundTemporalPlan(value: unknown, message: string, state: Context): unknown {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.operations) || value.operations.length > 12) return value
  let constraint = approximateTimeRequest(message)
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  if (!constraint && state.timeClarification && /^(?:por |de |a )?(?:la )?(manana|tarde|noche)$/.test(text)) {
    const preference: TimePreference = {kind:'band',band: text.endsWith('manana') ? 'MORNING' : text.endsWith('tarde') ? 'AFTERNOON' : 'EVENING'}
    const target = contextTime(state.timeClarification.candidateTimes, preference)
    if (target) constraint = { evidence: message, candidateTimes: [target] }
  }
  if (!constraint) {
    if (value.operations.some(op => record(op) && (op.kind === 'time_clarification' || op.kind === 'time_preference' && record(op.preference) && op.preference.kind === 'around'))) {
      throw new TurnPlanValidationError('evidence')
    }
    return value
  }
  const temporal = value.operations.filter(op => record(op) && ['time','time_preference','time_clarification'].includes(String(op.kind)))
  if (temporal.length > 1 || temporal.some(op => !wellShapedTemporal(op))) return value
  const normalized = (text: string) => ' ' + text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() + ' '
  if (temporal.some(op => typeof op.evidence !== 'string' || !op.evidence.trim() || op.evidence.length > 300 || !normalized(message).includes(normalized(op.evidence)))) return value
  const target = contextTime(constraint.candidateTimes, state.timePreference)
  const confidence = temporal.length ? temporal[0].confidence : 1
  const operation = target ? {kind:'time_preference',preference:{kind:'around',time:target},evidence:constraint.evidence,confidence}
    : {kind:'time_clarification',candidateTimes:constraint.candidateTimes,evidence:constraint.evidence,confidence}
  return { ...value, operations: [...value.operations.filter(op => !temporal.includes(op)), operation] }
}
export function temporalClarificationQuestion(value: {candidateTimes: readonly string[]}): string {
  const hour = Number(value.candidateTimes[1]!.slice(0,2)) % 12 || 12
  const minutes = value.candidateTimes[1]!.slice(3) === '00' ? '' : ':' + value.candidateTimes[1]!.slice(3)
  return '¿Te referís a las ' + hour + minutes + ' de la mañana o de la tarde?'
}
