import { parseMinutes, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'
import type { SlotBand } from '../bot-options/domain/actions.js'

/** A preference narrows an offer; only a separate explicit exact choice may select a slot. */
export type TimePreference =
  | { kind: 'after' | 'before' | 'around'; time: string }
  | { kind: 'range'; from: string; to: string; fromInclusive: boolean; toInclusive: boolean }
  | { kind: 'band'; band: SlotBand }
  | { kind: 'any' | 'earliest' }
export type ApproximateTimeRequest = { evidence: string; candidateTimes: string[] }
export type TemporalRequest = { kind: 'exact'; time: string } | { kind: 'preference'; preference: TimePreference } | { kind: 'ambiguous'; candidateTimes?: string[] }
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const clockSchema = { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' }
export const TIME_PREFERENCE_JSON_SCHEMA = { anyOf: [
  objectSchema({ kind: { type: 'string', enum: ['after', 'before', 'around'] }, time: clockSchema }),
  objectSchema({ kind: { type: 'string', enum: ['range'] }, from: clockSchema, to: clockSchema, fromInclusive: { type: 'boolean' }, toInclusive: { type: 'boolean' } }),
  objectSchema({ kind: { type: 'string', enum: ['band'] }, band: { type: 'string', enum: ['MORNING', 'AFTERNOON', 'EVENING'] } }),
  objectSchema({ kind: { type: 'string', enum: ['any', 'earliest'] } })
] }
export function parseTimePreference(value: unknown): TimePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 100) throw new Error('invalid time preference')
  const row = value as Record<string, unknown>
  const keys = Object.keys(row).sort().join(',')
  if (row.kind === 'after' || row.kind === 'before' || row.kind === 'around') {
    if (keys !== 'kind,time' || typeof row.time !== 'string' || parseMinutes(row.time) === null) throw new Error('invalid time boundary')
    return { kind: row.kind, time: row.time }
  }
  if (row.kind === 'range') {
    if (keys !== 'from,fromInclusive,kind,to,toInclusive' || typeof row.from !== 'string' || typeof row.to !== 'string' ||
        parseMinutes(row.from) === null || parseMinutes(row.to) === null || parseMinutes(row.from)! >= parseMinutes(row.to)! ||
        typeof row.fromInclusive !== 'boolean' || typeof row.toInclusive !== 'boolean') throw new Error('invalid time range')
    return { kind: 'range', from: row.from, to: row.to, fromInclusive: row.fromInclusive, toInclusive: row.toInclusive }
  }
  if (row.kind === 'band' && keys === 'band,kind' && ['MORNING', 'AFTERNOON', 'EVENING'].includes(String(row.band))) return { kind: 'band', band: row.band as SlotBand }
  if ((row.kind === 'any' || row.kind === 'earliest') && keys === 'kind') return { kind: row.kind }
  throw new Error('invalid time preference')
}
/** Uses fresh domain slots/bands; lower bound inclusive, upper bound exclusive. No synthetic time. */
export function filterTimePreference(slots: readonly AvailabilitySlot[], preference: TimePreference): AvailabilitySlot[] {
  const pref = parseTimePreference(preference)
  if (pref.kind === 'after' || pref.kind === 'before') {
    const boundary = parseMinutes(pref.time)!
    return slots.filter(slot => { const minute = parseMinutes(slot.time); return minute !== null && (pref.kind === 'after' ? minute >= boundary : minute < boundary) })
  }
  if (pref.kind === 'range') {
    const from = parseMinutes(pref.from)!, to = parseMinutes(pref.to)!
    return slots.filter(slot => {
      const minute = parseMinutes(slot.time)
      return minute !== null && (pref.fromInclusive ? minute >= from : minute > from) && (pref.toInclusive ? minute <= to : minute < to)
    })
  }
  if (pref.kind === 'band') return slots.filter(slot => slot.band === pref.band)
  if (pref.kind === 'earliest') {
    const earliest = Math.min(...slots.map(slot => Date.parse(slot.startAt)))
    return slots.filter(slot => Date.parse(slot.startAt) === earliest)
  }
  return [...slots]
}
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
function clock(hour: string, minute = '00'): string | null {
  const time = hour.padStart(2, '0') + ':' + minute
  return parseMinutes(time) === null ? null : time
}
/** Fallback action admission is deliberately narrower than classification for semantic validation. */
export function fallbackTemporalRequest(message: string, allowBare = false): TemporalRequest | null {
  const text = normalize(message)
  if (/[?¿]/.test(text) || /\b(no|nunca|quizas|tal vez)\b/.test(text)) return null
  return classifyTemporalRequest(message, allowBare)
}
/** Recognizes preference shape even in questions; this classification alone never authorizes a mutation. */
export function classifyTemporalRequest(message: string, allowBare = false): TemporalRequest | null {
  const approximate = approximateTimeRequest(message)
  if (approximate) return approximate.candidateTimes.length === 1 ? { kind: 'preference', preference: { kind: 'around', time: approximate.candidateTimes[0]! } } : { kind: 'ambiguous', candidateTimes: approximate.candidateTimes }
  let text = normalize(message)
  const requests: TemporalRequest[] = []
  const pairs = [...text.matchAll(/\b(entre|desde)\s+(?:las?\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\s+(y|hasta)\s+(?:las?\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g)]
  if (pairs.length > 1) return { kind: 'ambiguous' }
  if (pairs.length === 1) {
    const pair = pairs[0]!, from = clock(pair[2]!, pair[3]), to = clock(pair[5]!, pair[6])
    if (!from || !to || parseMinutes(from)! >= parseMinutes(to)! || (pair[1] === 'entre' ? pair[4] !== 'y' : pair[4] !== 'hasta')) return { kind: 'ambiguous' }
    requests.push({ kind: 'preference', preference: { kind: 'range', from, to, fromInclusive: true, toInclusive: true } })
    text = text.slice(0, pair.index) + text.slice(pair.index! + pair[0].length)
  }
  const boundary = /\b(despues de|desde|a partir de|antes de)\s+(?:las?\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g
  const boundaries = [...text.matchAll(boundary)]
  for (const match of boundaries) {
    const time = clock(match[2]!, match[3]); if (!time) return null
    requests.push({ kind: 'preference', preference: { kind: match[1] === 'antes de' ? 'before' : 'after', time } })
  }
  if (/\bantes del mediodia\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'before', time: '12:00' } })
  const bands = [...text.matchAll(/\b(?:por|a)\s+la\s+(manana|tarde|noche)\b/g)]
  for (const match of bands) requests.push({ kind: 'preference', preference: { kind: 'band', band: match[1] === 'manana' ? 'MORNING' : match[1] === 'tarde' ? 'AFTERNOON' : 'EVENING' } })
  if (/\b(?:lo mas temprano(?: posible)?|primer horario|primero disponible|^(?:primero|temprano)$)\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'earliest' } })
  if (/\b(?:cualquier horario|cualquier hora|cualquierhora|cualquiera hora)\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'any' } })
  // An exact clause alongside a preference is contradictory, not permission to pick its bound.
  const exactText = text.replace(boundary, '').replace(/\bantes del mediodia\b/g, '')
  const explicit = [...exactText.matchAll(/\ba las?\s+(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g)]
  for (const match of explicit) { const time = clock(match[1]!, match[2]); if (!time) return null; requests.push({ kind: 'exact', time }) }
  if (requests.length === 2) {
    const lower = requests.find(request => request.kind === 'preference' && request.preference.kind === 'after')
    const upper = requests.find(request => request.kind === 'preference' && request.preference.kind === 'before')
    const connector = boundaries.length === 2 ? text.slice(boundaries[0]!.index! + boundaries[0]![0].length, boundaries[1]!.index).trim() : null
    if (lower?.kind === 'preference' && lower.preference.kind === 'after' && upper?.kind === 'preference' && upper.preference.kind === 'before' &&
        connector !== null && /^(?:y|pero|,)?$/.test(connector)) {
      if (parseMinutes(lower.preference.time)! >= parseMinutes(upper.preference.time)!) return { kind: 'ambiguous' }
      return { kind: 'preference', preference: { kind: 'range', from: lower.preference.time, to: upper.preference.time, fromInclusive: true, toInclusive: false } }
    }
  }
  if (requests.length) return requests.length === 1 ? requests[0]! : { kind: 'ambiguous' }
  const colon = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (colon) return { kind: 'exact', time: clock(colon[1]!, colon[2])! }
  if (allowBare) {
    const bare = /^(?:el de las?\s+)?(\d{1,2})(?::([0-5]\d)|([0-5]\d))?(?:\s*(?:hs?|horas))?$/.exec(text)
    const time = bare && clock(bare[1]!, bare[2] ?? bare[3]); if (time) return { kind: 'exact', time }
  }
  return null
}

/** Numeric approximation preserves its anchor; twelve-hour ambiguity is never resolved from free slots. */
export function approximateTimeRequest(message: string): ApproximateTimeRequest | null {
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (/\b(no|ni|nunca|sin)\b/.test(text)) return null
  const prefix = /\b(?:tipo|aproximadamente|alrededor de|cerca de|mas o menos a)\s+(?:a\s+)?(?:las?\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm|hs?|horas))?(?:\s+de la\s+(manana|tarde|noche))?\b(?![:\d])/g
  const suffix = /\b(?:a\s+las?\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm|hs?|horas))?\s+(?:aprox\.?|aproximadamente)(?:\s+de la\s+(manana|tarde|noche))?\b(?![:\d])/g
  // Merge overlapping prefix/suffix forms of the same anchor, never two separate requests.
  const spans = [...text.matchAll(prefix), ...text.matchAll(suffix)].sort((a,b)=>a.index-b.index)
  const matches: RegExpMatchArray[] = []
  for (const span of spans) {
    const previous = matches.at(-1)
    if (previous && span.index < previous.index! + previous[0].length) {
      const end = Math.max(previous.index! + previous[0].length, span.index + span[0].length)
      previous[0] = text.slice(previous.index!, end)
      if (!previous[3] && span[3]) previous[3] = span[3]
      if (!previous[4] && span[4]) previous[4] = span[4]
    } else matches.push(span)
  }
  if (matches.length !== 1) return null
  const match = matches[0]!
  // An independent numeric clock contradicts a single approximation; calendar numbers do not.
  const remainder = text.slice(0,match.index) + text.slice(match.index! + match[0].length)
  const tail = text.slice(match.index! + match[0].length)
  if (/^\s*(?:o|y)\s+(?:a\s+las?\s+)?\d{1,2}(?=\s|$|[?!.,])/.test(tail)) return null
  if (/\ba\s+las?\s+\d|\b\d{1,2}:[0-9]{2}\b|\b\d{1,2}\s*(?:am|pm|hs?|horas)\b/.test(remainder)) return null
  let hour = Number(match[1])
  const minute = match[2] ?? '00'
  if (hour > 23) return null
  const period = match[3] ?? match[4]
  const explicitPeriod = period === 'am' || period === 'pm' || period === 'manana' || period === 'tarde' || period === 'noche'
  if (explicitPeriod && hour > 12) return null
  if (period === 'pm' || period === 'tarde' || period === 'noche') hour = hour % 12 + 12
  if (period === 'am' || period === 'manana') hour %= 12
  const candidates = explicitPeriod || hour === 0 || hour > 12 ? [clock(String(hour), minute)!]
    : hour === 12 ? ['00:' + minute, '12:' + minute] : [clock(String(hour), minute)!, clock(String(hour + 12), minute)!]
  return { evidence: message.slice(match.index!, match.index! + match[0].length), candidateTimes: candidates }
}

/** Reject loss or invention of an explicit compound constraint; classification does not grant authority. */
export function timePreferenceMatchesEvidence(preference: TimePreference, message: string): boolean {
  const constraint = classifyTemporalRequest(message, true)
  // Alternative clauses cannot lose a branch; AM/PM candidates still need contextual grounding.
  if (constraint?.kind === 'ambiguous' && !constraint.candidateTimes) return false
  if (constraint?.kind !== 'preference' || constraint.preference.kind !== 'range') return preference.kind !== 'range' || constraint === null
  if (preference.kind !== 'range') return false
  const range = constraint.preference
  return preference.from === range.from && preference.to === range.to && preference.fromInclusive === range.fromInclusive && preference.toInclusive === range.toInclusive
}
