import { localDateTimeToInstants, parseMinutes } from '../bot-options/application/availability-queries.js'
import { validateBusinessWeeklyRow, type BusinessWeeklyHourRow } from '../bot-options/application/hours-queries.js'
import { resolveDialogueDate } from './dialogue-date.js'
export type BusinessTimeContext = {
  businessId: string; timezone: string; date: string; candidateTimes: string[]
  candidates: { time: string; status: 'open' | 'closed' | 'unknown' }[]
}
export type BusinessTimeContextReader = (date: string, candidateTimes: readonly string[]) => BusinessTimeContext | undefined
export type BusinessHoursContext = { businessId: string; timezone: string; date: string; known: boolean; openIntervals: { from: string; to: string }[] }
export type BusinessHoursContextReader = (date: string) => BusinessHoursContext | undefined
export type CommercialHoursSnapshot = {
  businessId: string; timezone: string; stamp: string; from: Date; to: Date
  weeklyHours: unknown; globalBlocks: unknown
}
const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** A single public day is context for interpretation, never a proof of free appointments. */
export function projectBusinessHoursContext(snapshot: CommercialHoursSnapshot | undefined, date: string): BusinessHoursContext | undefined {
  if (!snapshot || !projectBusinessTimeContext(snapshot, date, ['00:00', '23:59'])) return undefined
  try {
    const day = new Date(date + 'T12:00:00Z'), next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10)
    const starts = localDateTimeToInstants(date, 0, snapshot.timezone), ends = localDateTimeToInstants(next, 0, snapshot.timezone)
    const covered = starts.length === 1 && ends.length === 1 && ends[0]!.getTime() - starts[0]!.getTime() === 86400000 &&
      starts[0]!.getTime() >= snapshot.from.getTime() && ends[0]!.getTime() <= snapshot.to.getTime()
    const exception = covered && (snapshot.globalBlocks as { startAt: string; endAt: string }[]).some(block =>
      Date.parse(block.startAt) < ends[0]!.getTime() && Date.parse(block.endAt) > starts[0]!.getTime())
    const known = covered && !exception
    return { businessId: snapshot.businessId, timezone: snapshot.timezone, date, known,
      openIntervals: known ? (snapshot.weeklyHours as BusinessWeeklyHourRow[]).filter(hour => hour.dayOfWeek === day.getUTCDay()).map(hour => ({ from: hour.startTime, to: hour.endTime })) : [] }
  } catch { return undefined }
}
/** Strip untrusted callback keys and reject a different business, day or zone. */
export function scopedBusinessHoursContext(proof: BusinessHoursContext | undefined, scope: { businessId: string; timezone: string; date: string | null }): BusinessHoursContext | undefined {
  if (!proof || !scope.date || proof.businessId !== scope.businessId || proof.timezone !== scope.timezone || proof.date !== scope.date ||
      typeof proof.known !== 'boolean' || !Array.isArray(proof.openIntervals) || proof.openIntervals.length > 100 ||
      !proof.known && proof.openIntervals.length !== 0 || proof.openIntervals.some(interval => !row(interval) || typeof interval.from !== 'string' || typeof interval.to !== 'string' ||
        !validateBusinessWeeklyRow({ dayOfWeek: 0, startTime: interval.from, endTime: interval.to }).ok)) return undefined
  return { businessId: scope.businessId, timezone: scope.timezone, date: scope.date, known: proof.known, openIntervals: proof.openIntervals.map(interval => ({ from: interval.from, to: interval.to })) }
}
/** Public meaning only, never an availability/occupancy authorization. Unknown exceptions abstain. */
export function projectBusinessTimeContext(snapshot: CommercialHoursSnapshot | undefined, date: string, times: readonly string[]): BusinessTimeContext | undefined {
  if (!snapshot || times.length < 1 || times.length > 2 || new Set(times).size !== times.length ||
      times.some(time => parseMinutes(time) === null) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Array.isArray(snapshot.weeklyHours) || snapshot.weeklyHours.length > 100 || !Array.isArray(snapshot.globalBlocks) || snapshot.globalBlocks.length > 500) return undefined
  const day = new Date(date + 'T12:00:00Z')
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) return undefined
  const hours: BusinessWeeklyHourRow[] = []
  for (const value of snapshot.weeklyHours) {
    if (!row(value) || typeof value.dayOfWeek !== 'number' || typeof value.startTime !== 'string' || typeof value.endTime !== 'string') return undefined
    const hour = {dayOfWeek:value.dayOfWeek,startTime:value.startTime,endTime:value.endTime}
    // Includes overnight and unrepresentable 24h rows: do not invent their semantics.
    if (!validateBusinessWeeklyRow(hour).ok) return undefined
    hours.push(hour)
  }
  const blocks: {start:number;end:number}[] = []
  for (const value of snapshot.globalBlocks) {
    if (!row(value) || typeof value.startAt !== 'string' || typeof value.endAt !== 'string') return undefined
    // SQL emits explicit UTC ISO timestamps, never machine-local timestamp parsing.
    if (!value.startAt.endsWith('Z') || !value.endAt.endsWith('Z')) return undefined
    const start = Date.parse(value.startAt), end = Date.parse(value.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return undefined
    blocks.push({start,end})
  }
  try {
    const daily = hours.filter(hour => hour.dayOfWeek === day.getUTCDay())
    const candidates = times.map(time => {
      const instants = localDateTimeToInstants(date, parseMinutes(time)!, snapshot.timezone)
      const covered = instants.length === 1 && instants.every(instant => instant.getTime() >= snapshot.from.getTime() && instant.getTime() < snapshot.to.getTime())
      const possibleException = instants.some(instant => blocks.some(block => instant.getTime() >= block.start && instant.getTime() < block.end))
      const status = !covered || possibleException ? 'unknown' as const : daily.some(hour => time >= hour.startTime && time < hour.endTime) ? 'open' as const : 'closed' as const
      return {time,status}
    })
    return {businessId:snapshot.businessId,timezone:snapshot.timezone,date,candidateTimes:[...times],candidates}
  } catch { return undefined }
}
/** Re-project foreign callback data before exposing it to the model; no private or unbounded keys survive. */
export function scopedBusinessTimeContext(proof: BusinessTimeContext | undefined, scope: {businessId:string;timezone:string;date:string|null}, candidates: readonly string[]): BusinessTimeContext | undefined {
  if (!proof || !scope.date || proof.businessId !== scope.businessId || proof.timezone !== scope.timezone || proof.date !== scope.date ||
      !Array.isArray(proof.candidateTimes) || proof.candidateTimes.join(',') !== candidates.join(',') || candidates.length < 1 || candidates.length > 2 ||
      candidates.some(time => parseMinutes(time) === null) || !Array.isArray(proof.candidates) || proof.candidates.length !== candidates.length ||
      proof.candidates.some((candidate,index) => !row(candidate) || candidate.time !== candidates[index] || !['open','closed','unknown'].includes(String(candidate.status)))) return undefined
  return {businessId:scope.businessId,timezone:scope.timezone,date:scope.date,candidateTimes:[...candidates],
    candidates:proof.candidates.map(candidate => ({time:candidate.time,status:candidate.status}))}
}
export function commercialTimeCandidate(proof: BusinessTimeContext | undefined, scope: {businessId:string;timezone:string;date:string|null}, candidates: readonly string[]): string | null {
  const scoped = scopedBusinessTimeContext(proof,scope,candidates)
  if (!scoped || scoped.candidates.some(candidate => candidate.status === 'unknown')) return null
  const open = scoped.candidates.filter(candidate => candidate.status === 'open')
  return open.length === 1 ? open[0]!.time : null
}
/** A typed date operation must agree with the same central resolver used by the engine. */
export function temporalPlanDate(value: unknown, stateDate: string | null, businessDate: string): string | null {
  if (!row(value) || !Array.isArray(value.operations)) return stateDate
  if (value.operations.some(operation => row(operation) && operation.kind === 'date_preferences')) return null
  const dates = value.operations.filter(operation => row(operation) && operation.kind === 'date')
  if (!dates.length) return stateDate
  if (dates.length !== 1) return null
  const operation = dates[0]
  if (!row(operation) || typeof operation.expression !== 'string' || typeof operation.confidence !== 'number' || operation.confidence < .85) return null
  const resolved = resolveDialogueDate(operation.expression, businessDate)
  return resolved.kind === 'resolved' && (operation.value == null || operation.value === resolved.date) ? resolved.date : null
}
/** Unknown/no calendar expression can retain a selected date; contradictions never can. */
export function prospectiveMessageDate(message: string, stateDate: string | null, businessDate: string): string | null {
  const resolution = resolveDialogueDate(message, businessDate)
  return resolution.kind === 'resolved' ? resolution.date : resolution.kind === 'unsupported' ? stateDate : null
}
/** One pure, scoped proof per candidate set for the entire interpretation/engine turn. */
export function memoBusinessTimeContext(read: BusinessTimeContextReader | undefined): BusinessTimeContextReader | undefined {
  if (!read) return undefined
  const memo = new Map<string, BusinessTimeContext | undefined>()
  return (date,times) => {
    const key = JSON.stringify([date,times])
    if (!memo.has(key)) {
      try { memo.set(key,read(date,times)) } catch { memo.set(key,undefined) }
    }
    const proof = memo.get(key)
    return proof ? structuredClone(proof) : undefined
  }
}
