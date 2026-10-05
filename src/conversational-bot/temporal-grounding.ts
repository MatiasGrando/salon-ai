import { commercialTimeCandidate, temporalPlanDate, type BusinessTimeContextReader } from './business-time-context.js'
import { TurnPlanValidationError } from './turn-plan.js'
import { approximateTimeRequest, fallbackTemporalRequest, parseTimePreference, timePreferenceMatchesEvidence, type TimePreference } from './time-preference.js'
import type { DialogueState } from './engine.js'
import { parseMinutes } from '../bot-options/application/availability-queries.js'
type Context = Pick<DialogueState, 'timePreference'> & Partial<Pick<DialogueState, 'date' | 'businessId'>> & { timeClarification?: { candidateTimes: string[] } }
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
/** Affirmative period clause answers the current pair; trailing commentary is not a new date/time request. */
export function contextualTimeAnswer(message: string, candidates: readonly string[]): {evidence:string;candidateTimes:string[]} | null {
  const text = message.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()
  const clause = text.split(/[,;.!]/)[0]!
  if (/[?¿]/.test(clause) || /\b(no|ni|nunca|sin|quizas|tal vez)\b/.test(clause)) return null
  const match = /^(?:(?:por|de|a)\s+)?(?:la\s+)?(manana|tarde|noche)\b/.exec(clause)
  if (!match || [...clause.matchAll(/\b(manana|tarde|noche)\b/g)].length !== 1) return null
  const tail = text.slice(clause.length)
  if (tail && new RegExp('\\b' + match[1] + '\\b').test(tail)) return null
  const otherPeriods = [...tail.matchAll(/\b(manana|tarde|noche)\b/g)]
  const rhetorical = /^[,;.!]\s*(?:[¿?]\s*)?(?:quien|que persona|nadie)\b/.test(tail)
  const negativeComplement = /^[,;.!]\s*(?:no|nunca)\s+(?:(?:de|por|a)\s+)?(?:la\s+)?(?:manana|tarde|noche)\b/.test(tail)
  if (otherPeriods.length && (otherPeriods.length !== 1 || !rhetorical && !negativeComplement)) return null
  const selected = candidates.filter(time => match[1] === 'manana' ? parseMinutes(time)! < 720 : parseMinutes(time)! >= 720)
  return selected.length === 1 ? {evidence:message.slice(0,match[0].length),candidateTimes:[selected[0]!]} : null
}
/** Reconcile a model proposal with a verified numeric approximation, without losing independent operations. */
export function groundTemporalPlan(value: unknown, message: string, state: Context, commercial?: {businessId:string;timezone:string;businessDate:string;read?:BusinessTimeContextReader}): unknown {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.operations) || value.operations.length > 12) return value
  // This guard runs before semantic admission, never in the engine after an operation was blocked.
  for (const operation of value.operations) {
    if (record(operation) && operation.kind === 'time_preference' && wellShapedTemporal(operation) &&
        !timePreferenceMatchesEvidence(parseTimePreference(operation.preference), message)) throw new TurnPlanValidationError('evidence')
  }
  let constraint = state.timeClarification ? contextualTimeAnswer(message,state.timeClarification.candidateTimes) : null
  constraint ??= approximateTimeRequest(message)
  if (!constraint) {
    const explicitRequest = fallbackTemporalRequest(message,true)
    if (state.timeClarification && (!explicitRequest || explicitRequest.kind === 'ambiguous') &&
        value.operations.some(op => record(op) && ['time','time_preference','time_clarification'].includes(String(op.kind)))) throw new TurnPlanValidationError('evidence')
    if (value.operations.some(op => record(op) && (op.kind === 'time_clarification' || op.kind === 'time_preference' && record(op.preference) && op.preference.kind === 'around'))) {
      throw new TurnPlanValidationError('evidence')
    }
    return value
  }
  const temporal = value.operations.filter(op => record(op) && ['time','time_preference','time_clarification'].includes(String(op.kind)))
  if (temporal.length > 1 || temporal.some(op => !wellShapedTemporal(op))) return value
  const normalized = (text: string) => ' ' + text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() + ' '
  if (temporal.some(op => typeof op.evidence !== 'string' || !op.evidence.trim() || op.evidence.length > 300 || !normalized(message).includes(normalized(op.evidence)))) return value
  let target = contextTime(constraint.candidateTimes, state.timePreference)
  if (!target && commercial && constraint.candidateTimes.length === 2) {
    const date = temporalPlanDate(value,state.date ?? null,commercial.businessDate)
    target = commercialTimeCandidate(date ? commercial.read?.(date,constraint.candidateTimes) : undefined,
      {businessId:commercial.businessId,timezone:commercial.timezone,date},constraint.candidateTimes)
  }
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
