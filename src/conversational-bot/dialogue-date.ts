/** This module handles calendar days only. The caller supplies the business-local date, not a UTC instant. */
export type DialogueDateResolution =
  | { kind: 'resolved'; date: string; source: 'relative' | 'weekday' | 'numeric' | 'iso' | 'mixed' }
  | { kind: 'ambiguous'; reason: 'missing_reference' | 'past_week' | 'week_modifier' | 'contradictory_dates' }
  | { kind: 'invalid'; reason: 'invalid_reference' | 'invalid_calendar_date' | 'past_date' }
  | { kind: 'unsupported'; reason: 'unsupported_expression' }

type DateSource = Extract<DialogueDateResolution, { kind: 'resolved' }>['source']
type Candidate = { date: string; source: DateSource }
const weekdays: Readonly<Record<string, number>> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6
}
const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
function validCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}
function parseIso(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  return validCalendarDate(year, month, day) ? { year, month, day } : null
}
function addDays(reference: string, days: number): string {
  const parts = parseIso(reference)!
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}
function weekday(reference: string): number {
  const parts = parseIso(reference)!
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}
function nextYearlessDate(day: number, month: number, reference: string): string | null {
  const year = parseIso(reference)!.year
  // Eight years covers leap days even across a century year such as 2100.
  for (let offset = 0; offset <= 8 && year + offset <= 2200; offset++) {
    if (!validCalendarDate(year + offset, month, day)) continue
    const date = iso(year + offset, month, day)
    if (date >= reference) return date
  }
  return null
}

/** Resolve a typed Spanish date expression without guessing unsupported phrases or a timezone. */
export function resolveDialogueDate(expression: string, referenceDate: string | null): DialogueDateResolution {
  if (referenceDate != null && !parseIso(referenceDate)) return { kind: 'invalid', reason: 'invalid_reference' }
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 300) return { kind: 'unsupported', reason: 'unsupported_expression' }
  const text = expression.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (/\b(?:semana pasada|la semana anterior|(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo) pasado)\b/.test(text))
    return { kind: 'ambiguous', reason: 'past_week' }
  if (/\b(?:semana que viene|proxima semana|(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo) (?:que viene|proximo)|proximo (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/.test(text))
    return { kind: 'ambiguous', reason: 'week_modifier' }

  const candidates: Candidate[] = []
  const relative = /\b(pasado\s+manana|manana|hoy)\b/g
  for (const match of text.matchAll(relative)) {
    if (!referenceDate) return { kind: 'ambiguous', reason: 'missing_reference' }
    const days = match[1] === 'hoy' ? 0 : match[1] === 'manana' ? 1 : 2
    candidates.push({ date: addDays(referenceDate, days), source: 'relative' })
  }
  const weekdayPattern = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g
  const weekdayMentions = [...text.matchAll(weekdayPattern)]
  const isoPattern = /(?<![\d/-])(\d{4})-(\d{2})-(\d{2})(?![\d/-])/g
  for (const match of text.matchAll(isoPattern)) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    if (!validCalendarDate(year, month, day)) return { kind: 'invalid', reason: 'invalid_calendar_date' }
    const date = iso(year, month, day)
    if (referenceDate && date < referenceDate) return { kind: 'invalid', reason: 'past_date' }
    candidates.push({ date, source: 'iso' })
  }
  const numericPattern = /(?<![\d/-])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?(?![\d/-])/g
  for (const match of text.matchAll(numericPattern)) {
    const day = Number(match[1]), month = Number(match[2])
    if (!match[3] && !referenceDate) return { kind: 'ambiguous', reason: 'missing_reference' }
    const date = match[3] ? (validCalendarDate(Number(match[3]), month, day) ? iso(Number(match[3]), month, day) : null)
      : nextYearlessDate(day, month, referenceDate!)
    if (!date) return { kind: 'invalid', reason: 'invalid_calendar_date' }
    if (referenceDate && date < referenceDate) return { kind: 'invalid', reason: 'past_date' }
    candidates.push({ date, source: 'numeric' })
  }
  const explicitDates = candidates.filter(candidate => candidate.source === 'iso' || candidate.source === 'numeric')
  for (const mention of weekdayMentions) {
    const day = weekdays[mention[1]!]!
    if (explicitDates.length) {
      // An explicit calendar date owns its weekday qualifier; do not invent the nearest week.
      if (explicitDates.some(candidate => weekday(candidate.date) !== day))
        return { kind: 'ambiguous', reason: 'contradictory_dates' }
    } else {
      if (!referenceDate) return { kind: 'ambiguous', reason: 'missing_reference' }
      candidates.push({ date: addDays(referenceDate, (day - weekday(referenceDate) + 7) % 7), source: 'weekday' })
    }
  }
  if (!candidates.length) return { kind: 'unsupported', reason: 'unsupported_expression' }
  if (new Set(candidates.map(candidate => candidate.date)).size !== 1) return { kind: 'ambiguous', reason: 'contradictory_dates' }
  return { kind: 'resolved', date: candidates[0]!.date,
    source: explicitDates.length && weekdayMentions.length ? 'mixed' : new Set(candidates.map(candidate => candidate.source)).size === 1 ? candidates[0]!.source : 'mixed' }
}
