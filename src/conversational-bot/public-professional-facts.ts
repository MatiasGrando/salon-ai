import { DAY_NAMES, formatDayHours, formatProfessionalWeeklySchedule, formatProfessionalExceptionLabel, computeExceptionWindow, calcularOffsetUtcMs, validateBusinessWeeklyRow, type ProfessionalWeeklyHourRow } from '../bot-options/application/hours-queries.js'
export type PublicProfessionalTarget = {
  kind: 'professional'; mention: string | null; serviceIds: readonly string[]
  date: string | null; weekday: number | null; aspect: 'overview' | 'services' | 'schedule'
}
export type PublicProfessional = {
  id: string; name: string; description: string | null; acceptsBotBookings: boolean
  services: readonly { id: string; name: string; description: string | null }[]
  weeklyHours: readonly ProfessionalWeeklyHourRow[]
  exceptions: readonly { startAt: string; endAt: string }[]
}
export type PublicProfessionalFacts = {
  businessId: string; timezone: string; exceptionWindow: { from: string; to: string }
  professionals: readonly PublicProfessional[]
  businessExceptions: readonly { startAt: string; endAt: string }[]
}
export type PublicProfessionalInformation = {
  businessId: string; professionals: readonly { id: string; name: string; description: string | null
    services: readonly { id: string; name: string; description: string | null }[]; schedule: string | null }[]
  complete: boolean
}
const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const disclaimer = 'Jornada habitual; no indica turnos libres. La disponibilidad exacta requiere consultar la agenda.'
function parseDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid professional date')
  const timestamp = Date.parse(date + 'T00:00:00Z')
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) throw new Error('invalid professional date')
  return timestamp
}
function localInstant(date: string, time: string, timezone: string): number {
  const guess = new Date(date + 'T' + time + ':00Z')
  return guess.getTime() - calcularOffsetUtcMs(guess, timezone)
}
function dateSchedule(facts: PublicProfessionalFacts, professional: PublicProfessional, date: string): string | null {
  const dateValue = parseDate(date)
  const nextDate = new Date(dateValue + 86_400_000).toISOString().slice(0, 10)
  const from = localInstant(date, '00:00', facts.timezone), to = localInstant(nextDate, '00:00', facts.timezone)
  if (from < Date.parse(facts.exceptionWindow.from) || to > Date.parse(facts.exceptionWindow.to) || !professional.weeklyHours.length) return null
  const hours = professional.weeklyHours.filter(row => row.dayOfWeek === new Date(dateValue).getUTCDay())
  let intervals = hours.map(row => [localInstant(date, row.startTime, facts.timezone), localInstant(date, row.endTime, facts.timezone)] as [number, number])
  for (const exception of [...facts.businessExceptions, ...professional.exceptions]) {
    const start = Date.parse(exception.startAt), end = Date.parse(exception.endAt)
    intervals = intervals.flatMap(([a, b]) => end <= a || start >= b ? [[a, b] as [number, number]] : [a < start ? [a, start] as [number, number] : null, b > end ? [end, b] as [number, number] : null].filter((item): item is [number, number] => item !== null))
  }
  const clock = (timestamp: number) => new Intl.DateTimeFormat('en-GB', { timeZone: facts.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp)
  return `${date}: ${intervals.map(([a, b]) => `${clock(a)} a ${clock(b)}`).join(', ') || 'No atiende según la jornada configurada'}.\n${disclaimer}`
}
/** Public work schedules are not booking availability, even after operational blocks are applied. */
export function queryPublicProfessionalFacts(facts: PublicProfessionalFacts, target: PublicProfessionalTarget): PublicProfessionalInformation {
  validatePublicProfessionalFacts(facts)
  if (target.date !== null) parseDate(target.date)
  if (target.weekday !== null && (!Number.isInteger(target.weekday) || target.weekday < 0 || target.weekday > 6)) throw new Error('invalid professional weekday')
  if (target.serviceIds.length > 10 || target.mention !== null && (target.mention.length > 200 || !normalized(target.mention))) throw new Error('invalid professional target')
  let candidates = [...facts.professionals]
  if (target.mention) {
    const mention = normalized(target.mention)
    const exact = candidates.filter(p => normalized(p.name) === mention)
    candidates = exact.length ? exact : candidates.filter(p => normalized(p.name).split(' ').some(word => mention.split(' ').includes(word)))
  }
  if (target.serviceIds.length) candidates = candidates.filter(p => target.serviceIds.every(id => p.services.some(s => s.id === id)))
  let complete = true
  const professionals = candidates.flatMap(professional => {
    const known = professional.weeklyHours.length > 0
    let schedule: string | null = null
    if (target.date) {
      schedule = dateSchedule(facts, professional, target.date)
      if (!schedule) { complete = false; return target.mention ? [{ ...professional, schedule }] : [] }
      if (!target.mention && schedule.includes('No atiende según')) return []
    } else if (target.weekday !== null) {
      if (!known) { complete = false; return target.mention ? [{ ...professional, schedule }] : [] }
      const hours = professional.weeklyHours.filter(row => row.dayOfWeek === target.weekday)
      if (!hours.length && !target.mention) return []
      schedule = `${DAY_NAMES[target.weekday]}: ${hours.length ? formatDayHours(hours) : 'No atiende según la jornada configurada'}.\n${disclaimer}`
    } else if (known) {
      schedule = formatProfessionalWeeklySchedule(professional.name, professional.weeklyHours,
        professional.exceptions.map(e => ({ startAt: new Date(e.startAt), endAt: new Date(e.endAt) })), new Date(facts.exceptionWindow.from), facts.timezone)
      const exceptions = [...facts.businessExceptions, ...professional.exceptions]
      if (exceptions.length) schedule += '\nExcepciones: ' + exceptions.map(e => formatProfessionalExceptionLabel({ startAt: new Date(e.startAt), endAt: new Date(e.endAt) }, facts.timezone)).join('\n')
      schedule += '\n' + disclaimer
    } else if (target.aspect === 'schedule') complete = false
    return [{ id: professional.id, name: professional.name, description: professional.description, services: professional.services, schedule }]
  })
  return { businessId: facts.businessId, professionals: professionals.map(p => ({ id: p.id, name: p.name, description: p.description, services: p.services, schedule: p.schedule })), complete }
}
/** Bound and validate all public fields before caching or interpreting them. */
export function validatePublicProfessionalFacts(facts: PublicProfessionalFacts): void {
  const text = (value: unknown, limit = 8000) => typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  if (!text(facts.businessId, 128) || !facts.businessId || facts.professionals.length > 50) throw new Error('invalid public professional scope')
  const window = computeExceptionWindow(new Date(facts.exceptionWindow.from), facts.timezone)
  if (!Number.isFinite(Date.parse(facts.exceptionWindow.to)) || window.to.toISOString() !== facts.exceptionWindow.to) throw new Error('invalid public exception window')
  if (new Set(facts.professionals.map(p => p.id)).size !== facts.professionals.length) throw new Error('duplicate public professional')
  const exceptions = (rows: readonly { startAt: string; endAt: string }[]) => {
    if (rows.length > 100) throw new Error('public exceptions exceed supported bound')
    for (const row of rows) if (!Number.isFinite(Date.parse(row.startAt)) || !Number.isFinite(Date.parse(row.endAt)) || row.startAt >= row.endAt) throw new Error('invalid public exception')
  }
  exceptions(facts.businessExceptions)
  for (const professional of facts.professionals) {
    if (!text(professional.id, 128) || !professional.id || !text(professional.name, 200) || !professional.name.trim() || typeof professional.acceptsBotBookings !== 'boolean' || professional.description !== null && !text(professional.description)) throw new Error('invalid public professional')
    if (professional.services.length > 100 || professional.weeklyHours.length > 100) throw new Error('public professional data exceeds supported bound')
    for (const service of professional.services) if (!text(service.id, 128) || !service.id || !text(service.name, 200) || service.description !== null && !text(service.description)) throw new Error('invalid public professional service')
    for (const row of professional.weeklyHours) if (!validateBusinessWeeklyRow(row).ok) throw new Error('invalid public professional hours')
    exceptions(professional.exceptions)
  }
}
