export const DEFAULT_BOOKING_TIMEZONE = 'America/Argentina/Buenos_Aires'
export type DatedHour = { date: string; startTime: string; endTime: string }
export type RecurrenceFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY'

export class BookingProgramError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message) }
}
export function dateKey(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BookingProgramError('INVALID_DATE', 'Revisa la fecha.', 400)
  return value
}
export function addDateDays(date: string, days: number) { return new Date(Date.parse(dateKey(date)) + days * 86400000).toISOString().slice(0, 10) }
export function weekStart(date: string) {
  const weekday = new Date(dateKey(date)).getUTCDay()
  return addDateDays(date, -(weekday === 0 ? 6 : weekday - 1))
}
export function monthDate(anchor: string, months: number) {
  const source = new Date(dateKey(anchor))
  const last = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months + 1, 0))
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(source.getUTCDate(), last.getUTCDate()))).toISOString().slice(0, 10)
}
export function validTime(time: string) { return typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) }
export function localParts(value: Date, timezone = DEFAULT_BOOKING_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value)
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}
// Reject daylight-saving gaps instead of moving the appointment silently.
export function zonedInstant(date: string, time: string, timezone = DEFAULT_BOOKING_TIMEZONE) {
  dateKey(date)
  if (!validTime(time)) throw new BookingProgramError('INVALID_TIME', 'Revisa el horario.', 400)
  const target = Date.parse(`${date}T${time}:00Z`)
  let result = target
  for (let i = 0; i < 4; i++) {
    const local = localParts(new Date(result), timezone)
    const correction = target - Date.parse(`${local.date}T${local.time}:00Z`)
    if (!correction) return new Date(result)
    result += correction
  }
  throw new BookingProgramError('INVALID_LOCAL_TIME', 'Ese horario no existe en la zona horaria del comercio.', 400)
}
export function validateDatedHours(week: string, input: unknown): DatedHour[] {
  if (weekStart(week) !== week || !Array.isArray(input) || input.length > 56) throw new BookingProgramError('INVALID_HOURS', 'Selecciona una semana y sus franjas horarias.', 400)
  const end = addDateDays(week, 7)
  const hours = input.map((row: DatedHour) => {
    if (!row || dateKey(row.date) < week || row.date >= end || !validTime(row.startTime) || !validTime(row.endTime) || row.startTime >= row.endTime) throw new BookingProgramError('INVALID_HOURS', 'Hay una franja horaria invalida.', 400)
    return { date: row.date, startTime: row.startTime, endTime: row.endTime }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
  for (let i = 1; i < hours.length; i++) {
    if (hours[i]!.date === hours[i - 1]!.date && hours[i]!.startTime < hours[i - 1]!.endTime) throw new BookingProgramError('OVERLAPPING_HOURS', 'Las franjas de un dia se superponen.', 400)
  }
  return hours
}
export function containsDatedInterval(hours: DatedHour[], start: Date, end: Date, timezone = DEFAULT_BOOKING_TIMEZONE) {
  const a = localParts(start, timezone), b = localParts(end, timezone)
  return a.date === b.date && hours.some(h => h.date === a.date && h.startTime <= a.time && h.endTime >= b.time)
}
export function recurrenceDates(rule: { startsOn: string; endsOn: string | null; frequency: string }, from: string, to: string) {
  dateKey(rule.startsOn); dateKey(from); dateKey(to)
  if (!['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(rule.frequency)) throw new BookingProgramError('INVALID_FREQUENCY', 'Frecuencia invalida.', 400)
  const dates: string[] = []
  const limit = rule.endsOn && rule.endsOn < to ? dateKey(rule.endsOn) : to
  if (rule.frequency === 'MONTHLY') {
    const a = new Date(rule.startsOn), b = new Date(from)
    let index = Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth())
    for (let date = monthDate(rule.startsOn, index); date <= limit; date = monthDate(rule.startsOn, ++index)) {
      if (date >= from) dates.push(date)
      if (dates.length > 400) throw new BookingProgramError('RANGE_TOO_LONG', 'Selecciona un periodo mas corto.', 400)
    }
  } else {
    const step = rule.frequency === 'WEEKLY' ? 7 : 14
    const offset = Math.max(0, Math.ceil((Date.parse(from) - Date.parse(rule.startsOn)) / (step * 86400000)))
    for (let date = addDateDays(rule.startsOn, offset * step); date <= limit; date = addDateDays(date, step)) {
      dates.push(date)
      if (dates.length > 400) throw new BookingProgramError('RANGE_TOO_LONG', 'Selecciona un periodo mas corto.', 400)
    }
  }
  return dates
}
export function benefitSummary(grant: { totalUses: number | null; endsOn: string }, states: string[], today: string) {
  const used = states.filter(s => s === 'CONSUMED').length
  const reserved = states.filter(s => s === 'RESERVED').length
  const remaining = grant.totalUses === null ? null : Math.max(0, grant.totalUses - used - reserved)
  return { used, reserved, available: today > grant.endsOn ? 0 : remaining, expired: today > grant.endsOn, expiredUses: today > grant.endsOn ? remaining : 0 }
}
