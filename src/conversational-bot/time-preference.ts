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
type BoundarySpan = { start: number; end: number; preference: { kind: 'after' | 'before'; time: string } }
/** Operators own their complete clock span, regardless of whether they precede or follow it. */
function boundarySpans(text: string): BoundarySpan[] | null {
  const patterns = [
    /\b(despues de|desde|a partir de|antes de)\s+(?:las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g,
    /\b(?:(?:a\s+)?las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\s+en\s+adelante\b/g
  ]
  const spans: BoundarySpan[] = []
  for (const [index, pattern] of patterns.entries()) for (const match of text.matchAll(pattern)) {
    const time = index === 0 ? clock(match[2]!, match[3]) : clock(match[1]!, match[2])
    if (!time) return null
    spans.push({ start: match.index!, end: match.index! + match[0].length, preference: { kind: index === 0 && match[1] === 'antes de' ? 'before' : 'after', time } })
  }
  const merged: BoundarySpan[] = []
  for (const span of spans.sort((a,b) => a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous && span.start < previous.end && span.preference.kind === previous.preference.kind && span.preference.time === previous.preference.time) previous.end = Math.max(previous.end, span.end)
    else merged.push(span)
  }
  return merged
}
/** Recognizes preference shape even in questions; this classification alone never authorizes a mutation. */
export function classifyTemporalRequest(message: string, allowBare = false): TemporalRequest | null {
  const approximate = approximateTimeRequest(message)
  if (approximate) {
    const start = message.indexOf(approximate.evidence)
    const remainder = message.slice(0, start) + ' '.repeat(approximate.evidence.length) + message.slice(start + approximate.evidence.length)
    // An approximation is not permission to discard another bound, band or explicit choice.
    if (classifyTemporalRequest(remainder, true)) return { kind: 'ambiguous' }
    return approximate.candidateTimes.length === 1
      ? { kind: 'preference', preference: { kind: 'around', time: approximate.candidateTimes[0]! } }
      : { kind: 'ambiguous', candidateTimes: approximate.candidateTimes }
  }
  let text = normalize(message)
  const requests: TemporalRequest[] = []
  const pairs = [...text.matchAll(/\b(entre|desde)\s+(?:las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\s+(y|hasta)\s+(?:las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g)]
  if (pairs.length > 1) return { kind: 'ambiguous' }
  if (pairs.length === 1) {
    const pair = pairs[0]!, from = clock(pair[2]!, pair[3]), to = clock(pair[5]!, pair[6])
    if (!from || !to || parseMinutes(from)! >= parseMinutes(to)! || (pair[1] === 'entre' ? pair[4] !== 'y' : pair[4] !== 'hasta')) return { kind: 'ambiguous' }
    requests.push({ kind: 'preference', preference: { kind: 'range', from, to, fromInclusive: true, toInclusive: true } })
    text = text.slice(0, pair.index) + text.slice(pair.index! + pair[0].length)
  }
  const boundaries = boundarySpans(text)
  if (boundaries === null) return null
  for (const span of boundaries) requests.push({ kind: 'preference', preference: span.preference })
  if (/\bantes del mediodia\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'before', time: '12:00' } })
  const bands = [...text.matchAll(/\b(?:por|a)\s+la\s+(manana|tarde|noche)\b/g)]
  for (const match of bands) requests.push({ kind: 'preference', preference: { kind: 'band', band: match[1] === 'manana' ? 'MORNING' : match[1] === 'tarde' ? 'AFTERNOON' : 'EVENING' } })
  if (/\b(?:lo mas temprano(?: posible)?|primer horario|primero disponible|^(?:primero|temprano)$)\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'earliest' } })
  if (/\b(?:cualquier horario|cualquier hora|cualquierhora|cualquiera hora)\b/.test(text)) requests.push({ kind: 'preference', preference: { kind: 'any' } })
  // An exact clause alongside a preference is contradictory, not permission to pick its bound.
  let exactText = text
  for (const span of [...boundaries].reverse()) exactText = exactText.slice(0,span.start) + ' '.repeat(span.end-span.start) + exactText.slice(span.end)
  exactText = exactText.replace(/\bantes del mediodia\b/g, '')
  const explicit = [...exactText.matchAll(/\ba las?\s*(\d{1,2})(?::([0-5]\d))?(?:\s*(?:hs?|horas))?\b(?![:\d])/g)]
  for (const match of explicit) { const time = clock(match[1]!, match[2]); if (!time) return null; requests.push({ kind: 'exact', time }) }
  if (requests.length === 2) {
    const lower = requests.find(request => request.kind === 'preference' && request.preference.kind === 'after')
    const upper = requests.find(request => request.kind === 'preference' && request.preference.kind === 'before')
    const connector = boundaries.length === 2 ? text.slice(boundaries[0]!.end, boundaries[1]!.start).trim() : null
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
  const prefix = /\b(?:tipo|aproximadamente|alrededor de|cerca de|mas\s*o\s*menos a)\s+(?:a\s+)?(?:las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm|hs?|horas))?(?:\s+de la\s+(manana|tarde|noche))?\b(?![:\d])/g
  const suffix = /\b(?:a\s+las?\s*)?(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm|hs?|horas))?\s+(?:aprox\.?|aproximadamente)(?:\s+de la\s+(manana|tarde|noche))?\b(?![:\d])/g
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
  if (/^\s*(?:o|y)\s+(?:a\s+las?\s*)?\d{1,2}(?=\s|$|[?!.,])/.test(tail)) return null
  if (/\ba\s+las?\s*\d|\b\d{1,2}:[0-9]{2}\b|\b\d{1,2}\s*(?:am|pm|hs?|horas)\b/.test(remainder)) return null
  let hour = Number(match[1])
  const minute = match[2] ?? '00'
  if (hour > 23) return null
  const period = match[3] ?? match[4]
  const explicitPeriod = period === 'am' || period === 'pm' || period === 'manana' || period === 'tarde' || period === 'noche'
  if (explicitPeriod && hour > 12) return null
  if (period === 'pm' || period === 'tarde' || period === 'noche') hour = hour % 12 + 12
  if (period === 'am' || period === 'manana') hour %= 12
  // A two-digit HH:mm anchor is a precise 24-hour clock; explicit periods still take precedence.
  const explicitClock = match[1]!.length === 2 && match[2] !== undefined
  const candidates = explicitPeriod || explicitClock || hour === 0 || hour > 12 ? [clock(String(hour), minute)!]
    : hour === 12 ? ['00:' + minute, '12:' + minute] : [clock(String(hour), minute)!, clock(String(hour + 12), minute)!]
  return { evidence: message.slice(match.index!, match.index! + match[0].length), candidateTimes: candidates }
}

/** A disjoint bare clock is not proof that a unique approximation quote became an exact request.
 * This parser-only compatibility check grants no authority and never hides compound constraints.
 * Contextual grounding still requires a unique approximation in the complete current message.
 */
function disjointApproximationConstraint(message: string, evidence: string, exact: string): TemporalRequest | null {
  const text = normalize(message), quote = normalize(evidence)
  const start = text.indexOf(quote)
  if (!quote || start < 0 || text.indexOf(quote, start + 1) >= 0) return null
  const quoted = approximateTimeRequest(quote)
  if (!quoted || !quoted.candidateTimes.includes(exact)) return null
  const remainder = text.slice(0, start) + ' '.repeat(quote.length) + text.slice(start + quote.length)
  // Negation, alternatives, a bound or a separately explicit choice cannot be discarded as unrelated.
  if (/\b(?:no|ni|nunca|sin|entre|desde|antes de|despues de|a partir de|en adelante|a las?)\b|\//.test(remainder)) return null
  const clocks = [...remainder.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)]
  if (clocks.length !== 1 || clock(clocks[0]![1]!, clocks[0]![2]) !== exact) return null
  const external = clocks[0]!
  const externalEnd = external.index! + external[0].length
  const bridge = externalEnd <= start ? text.slice(externalEnd, start) : text.slice(start + quote.length, external.index)
  if (/\b(?:o|y)\b|\//.test(bridge)) return null
  return classifyTemporalRequest(quote, true)
}
/** Semantic projection only: a literal affirmative period and its rhetorical opposite are not two requests.
 * No pair or authority is created here. Grounding must still validate the real active clarification.
 */
function contextualPeriodMeaning(message: string, evidence: string, selectedTime: string): string {
  const quote = normalize(evidence)
  const period = /^(?:(?:por|de|a)\s+)?(?:la\s+)?(manana|tarde|noche)$/.exec(quote)
  const minute = parseMinutes(selectedTime)
  const text = normalize(message)
  if (!period || minute === null || !text.startsWith(quote) || text.indexOf(quote, quote.length) >= 0 ||
      (period[1] === 'manana' ? minute >= 720 : minute < 720)) return message
  const clause = message.split(/[,;.!]/)[0]!
  const tail = message.slice(clause.length)
  const normalizedTail = normalize(tail)
  if (!/^[,;.!]\s*(?:[¿?]\s*)?(?:quien|que persona|nadie)\b/.test(normalizedTail) ||
      /\b(?:no|ni|nunca|sin)\b/.test(normalizedTail) ||
      [...normalizedTail.matchAll(/\b(?:manana|tarde|noche)\b/g)].length !== 1) return message
  const clocks = [...tail.matchAll(/\ba\s+las?\s*\d{1,2}(?::[0-5]\d)?\s+(?:am|pm|de la\s+(?:mañana|tarde|noche))\b/gi)]
  const rhetorical = clocks.filter(match => {
    const meaning = literalClockMeaning(tail, match[0])
    return meaning.kind === 'single' && Math.abs(parseMinutes(meaning.time)! - minute) === 720
  })
  if (rhetorical.length !== 1) return message
  const match = rhetorical[0]!
  return clause + tail.slice(0, match.index) + ' '.repeat(match[0].length) + tail.slice(match.index! + match[0].length)
}
/** Reject loss or invention of an explicit compound constraint; classification does not grant authority. */
export function timePreferenceMatchesEvidence(preference: TimePreference, message: string, evidence = message): boolean {
  const semanticMessage = preference.kind === 'around' ? contextualPeriodMeaning(message, evidence, preference.time) : message
  let constraint = classifyTemporalRequest(semanticMessage, true)
  if (constraint?.kind === 'exact') constraint = disjointApproximationConstraint(message, evidence, constraint.time) ?? constraint
  if (!constraint) return true // Unknown grammar is not proof of a contradiction or of authority.
  if (constraint.kind === 'exact') return false
  if (constraint.kind === 'ambiguous') return preference.kind === 'around' && !!constraint.candidateTimes?.includes(preference.time)
  const actual = constraint.preference
  if (preference.kind !== actual.kind) return false
  if (preference.kind === 'range' && actual.kind === 'range') return preference.from === actual.from && preference.to === actual.to && preference.fromInclusive === actual.fromInclusive && preference.toInclusive === actual.toInclusive
  if (preference.kind === 'band' && actual.kind === 'band') return preference.band === actual.band
  if ('time' in preference && 'time' in actual) return preference.time === actual.time
  return true
}
export type CanonicalTimeOperation = { kind: 'time'; value: string } | { kind: 'time_preference'; preference: TimePreference }
/** Same deny-only semantic check for public parsing and the server's grounded canonical operation. */
export function timeOperationMatchesEvidence(operation: CanonicalTimeOperation, message: string, evidence: string): boolean {
  if (operation.kind === 'time_preference') return timePreferenceMatchesEvidence(operation.preference, message, evidence)
  const meaning = literalClockMeaning(message, evidence)
  if (meaning.kind === 'alternatives' || meaning.kind === 'single' && meaning.time !== operation.value) return false
  const temporal = classifyTemporalRequest(message, true) ?? classifyTemporalRequest(evidence, true)
  const disjointClock = temporal?.kind === 'ambiguous' && !temporal.candidateTimes && meaning.kind === 'single' &&
    !/\b(?:tipo|aproximadamente|alrededor|cerca|antes de|despues de|desde|entre|a partir de|en adelante)\b/.test(normalize(message))
  return !temporal || temporal.kind === 'exact' || disjointClock
}

export type LiteralClockMeaning = { kind: 'single'; time: string } | { kind: 'alternatives' } | { kind: 'unknown'; candidateTimes?: string[] }
/** Deny-only value proof from current quoted clock spans; never infer an owner or choose a branch. */
export function literalClockMeaning(message: string, ownedEvidence: string): LiteralClockMeaning {
  const text = normalize(message), quote = normalize(ownedEvidence)
  if (!quote || !text.includes(quote)) return { kind: 'unknown' }
  const ownedSpans: { start: number; end: number }[] = []
  for (let from = 0; from < text.length;) {
    const start = text.indexOf(quote, from)
    if (start < 0) break
    ownedSpans.push({ start, end: start + quote.length }); from = start + 1
  }
  const clocks: { start: number; end: number; time: string | null; candidateTimes?: string[] }[] = []
  const pattern = /\b(?:(?:a\s+)?las?\s*)?(?:(\d{1,2}):([0-5]\d)|(\d{2})([0-5]\d)|(\d{1,2}))(?:\s*(am|pm|hs?|horas))?(?:\s+de la\s+(manana|tarde|noche))?\b(?![:\d])/g
  for (const match of text.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length
    const explicit = match[1] !== undefined || /^(?:a\s+)?las?/.test(match[0]) || match[6] !== undefined || match[7] !== undefined
    // Unqualified integers/compact clocks are answers only, not calendar dates, years or prices.
    const quotedWhole = quote === match[0] && ownedSpans.some(span => span.start === start && span.end === end)
    if (!explicit && !quotedWhole) continue
    let hour = Number(match[1] ?? match[3] ?? match[5])
    const period = match[6] === 'am' || match[6] === 'pm' ? match[6] : match[7]
    if (period === 'am' || period === 'manana') { if (hour === 12) hour = 0 }
    else if (period && hour < 12) hour += 12
    const precise = !!period || match[3] !== undefined || hour === 0 || hour > 12 || match[1]?.length === 2
    // One-digit twelve-hour clocks need existing contextual grounding, not a fabricated morning value.
    const minute = match[2] ?? match[4] ?? '00'
    clocks.push({ start, end, time: precise ? clock(String(hour), minute) : null,
      ...(!precise && explicit && hour >= 1 && hour <= 12 ? { candidateTimes: hour === 12 ? ['00:' + minute, '12:' + minute] : [clock(String(hour), minute)!, clock(String(hour + 12), minute)!] } : {}) })
  }
  const owned = clocks.filter(item => ownedSpans.some(span => span.start < item.end && span.end > item.start))
  if (!owned.length) return { kind: 'unknown' }
  for (let index = 1; index < clocks.length; index++) {
    const left = clocks[index - 1]!, right = clocks[index]!
    const connector = text.slice(left.end, right.start).trim()
    if (/^(?:\/|o|y)$/.test(connector) && (owned.includes(left) || owned.includes(right))) {
      const preceding = text.slice(0, left.start)
      // Known ranges and explicitly negated/history clauses are not positive alternative choices.
      if (!/\b(?:entre|desde|antes de|despues de|a partir de)\s*(?:las?\s*)?$/.test(preceding) &&
          !/\b(?:no|ni|nunca|antes|anteriormente)\s*(?:(?:a\s+)?las?\s*)?$/.test(preceding)) return { kind: 'alternatives' }
    }
  }
  if (owned.some(item => item.time === null)) return { kind: 'unknown', ...(owned.length === 1 && owned[0]!.candidateTimes ? { candidateTimes: owned[0]!.candidateTimes } : {}) }
  const values = [...new Set(owned.map(item => item.time!))]
  return values.length === 1 ? { kind: 'single', time: values[0]! } : { kind: 'alternatives' }
}
