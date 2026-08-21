import { normalizeText } from './message-understanding-service.js'
import type { BookingV2CoordinatedTimeBand } from './booking-v2-state.js'

export type BookingCoordinationChoice =
  | { type: 'COORDINATE' }
  | { type: 'MODIFY_SERVICES' }
  | { type: 'REQUEST_HUMAN' }
  | { type: 'SHOW_MORE' }
  | { type: 'SHOW_SEARCH_MENU' }
  | { type: 'SHOW_NEXT_DAYS' }
  | { type: 'SEARCH_TIME' }
  | { type: 'SEARCH_WITHOUT_PROFESSIONAL' }
  | { type: 'CHOOSE_OTHER_DATE' }
  | { type: 'TIME_BAND'; band: BookingV2CoordinatedTimeBand }
  | { type: 'EXACT_TIME'; time: string }
  | { type: 'AFTER_TIME'; time: string; inclusive: boolean }
  | { type: 'BEFORE_TIME'; time: string; inclusive: boolean }
  | { type: 'TIME_WINDOW'; startTime: string; endTime: string }
  | { type: 'OPTION'; index: number }

export function bookingCoordinationActionableReply(message: string) {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return message
  const tail = lines.at(-1)!
  if (tail.length > 80) return message
  const quotedContext = normalizeText(lines.slice(0, -1).join(' '))
  const looksLikeBotPrompt = [
    'voy a coordinar los servicios',
    'que dia te gustaria venir',
    'en que franja horaria preferis',
    'en que momento del dia preferis',
    'a que hora te gustaria',
    'cual preferis',
    'como queres continuar',
    'que queres modificar',
    'cual de los servicios elegidos',
    'no encontre disponibilidad',
    'no encontre una combinacion',
    'tambien puedo buscar otra fecha',
    'estas son las opciones',
    'elegiste el bloque',
    'confirmas estas dos reservas',
    'confirmas la reserva'
  ].some((phrase) => quotedContext.includes(phrase))
  return looksLikeBotPrompt ? tail : message
}

export function detectBookingCoordinationChoice(input: {
  message: string
  phase?: 'DECISION' | 'DATE' | 'TIME_PREFERENCE' | 'OPTION'
}): BookingCoordinationChoice | null {
  const normalized = normalizeText(input.message)
  if (!normalized) return null

  if (/\b(?:hablar|atencion|persona|equipo|asesor)\b/.test(normalized)) {
    return { type: 'REQUEST_HUMAN' }
  }
  if (/\b(?:modificar|cambiar|quitar|sacar)\b.*\bservicios?\b|\bservicios?\b.*\b(?:modificar|cambiar|quitar|sacar)\b/.test(normalized)) {
    return { type: 'MODIFY_SERVICES' }
  }
  if (
    (input.phase === undefined || input.phase === 'DECISION') &&
    (/\b(?:coordinar|combinar)\b/.test(normalized) || /\bhorarios?\s+(?:seguidos|continuos)\b/.test(normalized))
  ) {
    return { type: 'COORDINATE' }
  }
  if (/\b(?:proximos dias|proximas fechas|siguientes dias)\b/.test(normalized)) {
    return { type: 'SHOW_NEXT_DAYS' }
  }
  if (
    /\b(?:buscar|ver|mostrar|probar)\b.*\bsin\b.*\b(?:profesional|persona|el|la)\b/.test(normalized) ||
    /\b(?:sin|cambiar|otro|otra)\b.*\bprofesional\b/.test(normalized) ||
    /\b(?:buscar|ver|mostrar|probar)\b.*\bsin\b\s+\S+/.test(normalized)
  ) {
    return { type: 'SEARCH_WITHOUT_PROFESSIONAL' }
  }
  if (/\b(?:buscar|encontrar|probar)\b.*\b(?:horario|hora)\b|\bhorario (?:especifico|exacto)\b/.test(normalized)) {
    return { type: 'SEARCH_TIME' }
  }
  if (
    /\b(?:otra fecha|otro dia|elegir fecha|fecha especifica)\b/.test(normalized) ||
    /\b(?:cambiar|cambio|modificar|volver a elegir)\s+(?:la\s+|de\s+)?(?:fecha|dia)\b/.test(normalized)
  ) {
    return { type: 'CHOOSE_OTHER_DATE' }
  }
  if (/\b(?:otras busquedas|otra busqueda|opciones de busqueda|buscar de otra forma)\b/.test(normalized)) {
    return { type: 'SHOW_SEARCH_MENU' }
  }
  if (/\b(?:mas opciones|mas horarios|otros horarios|ver todos|todos los horarios|mostrame todos)\b/.test(normalized)) {
    return { type: 'SHOW_MORE' }
  }

  if (input.phase === 'OPTION') {
    const explicitOption = /^opcion\s*([1-9]|1\d|20)$/.exec(normalized)
    if (explicitOption?.[1]) {
      return { type: 'OPTION', index: Number(explicitOption[1]) - 1 }
    }
    if (normalized === '1' || normalized === '2') {
      return { type: 'OPTION', index: Number(normalized) - 1 }
    }
    const ordinal = normalized === 'la primera' || normalized === 'primera'
      ? 0
      : normalized === 'la segunda' || normalized === 'segunda'
        ? 1
        : null
    if (ordinal !== null) return { type: 'OPTION', index: ordinal }
  }

  if (input.phase === 'OPTION' || input.phase === 'TIME_PREFERENCE') {
    const bareHour = /^(0?[8-9]|1\d|2[0-3])$/.exec(normalized)?.[1]
    if (bareHour) {
      return { type: 'EXACT_TIME', time: `${String(Number(bareHour)).padStart(2, '0')}:00` }
    }
  }

  const relativeTime = parseRelativeTimePreference(normalized)
  if (relativeTime) return relativeTime
  const timeWindow = parseTimeWindow(normalized)
  if (timeWindow) return { type: 'TIME_WINDOW', ...timeWindow }
  const exactTime = parseExactTime(normalized)
  if (exactTime) return { type: 'EXACT_TIME', time: exactTime }

  if (/\b(?:por la manana|a la manana|temprano|primera hora)\b/.test(normalized) || (
    input.phase === 'TIME_PREFERENCE' && normalized === 'manana'
  )) {
    return { type: 'TIME_BAND', band: 'MORNING' }
  }
  if (/\b(?:al mediodia|medio dia|cerca del mediodia)\b/.test(normalized)) {
    return { type: 'TIME_BAND', band: 'MIDDAY' }
  }
  if (/\b(?:por la tarde|a la tarde|despues del mediodia)\b/.test(normalized)) {
    return { type: 'TIME_BAND', band: 'AFTERNOON' }
  }
  return null
}

export function timeBelongsToBand(time: string, band: BookingV2CoordinatedTimeBand) {
  const minutes = timeToMinutes(time)
  if (minutes === null) return false
  if (band === 'MORNING') return minutes < 12 * 60
  if (band === 'MIDDAY') return minutes >= 12 * 60 && minutes < 15 * 60
  return minutes >= 15 * 60
}

export function optionFitsTimeWindow(
  option: { startTime: string; endTime: string },
  window: { startTime: string; endTime: string }
) {
  const optionStart = timeToMinutes(option.startTime)
  const optionEnd = timeToMinutes(option.endTime)
  const windowStart = timeToMinutes(window.startTime)
  const windowEnd = timeToMinutes(window.endTime)
  return optionStart !== null && optionEnd !== null && windowStart !== null && windowEnd !== null &&
    optionStart >= windowStart && optionEnd <= windowEnd
}

function parseTimeWindow(normalized: string) {
  const match = /(?:^|\b)(?:de|entre)?\s*(?:las?\s*)?(\d{1,4})(?::?(\d{2}))?\s*(?:a|y|hasta)\s*(?:las?\s*)?(\d{1,4})(?::?(\d{2}))?(?:\b|$)/.exec(normalized)
  if (!match?.[1] || !match[3]) return null
  const startTime = normalizeFlexibleTime(match[1], match[2], true)
  const endTime = normalizeFlexibleTime(match[3], match[4], true)
  if (!startTime || !endTime) return null
  const startMinutes = timeToMinutes(startTime)
  const endMinutes = timeToMinutes(endTime)
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null
  return { startTime, endTime }
}

function parseRelativeTimePreference(normalized: string): BookingCoordinationChoice | null {
  const match = /\b(desde|a\s+partir\s+de|despues\s+de|antes\s+de|hasta)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:h|hs|hrs|horas)?(?:\b|$)/.exec(normalized)
  if (!match?.[1] || !match[2]) return null
  const time = normalizeFlexibleTime(match[2], match[3], true)
  if (!time) return null
  const direction = match[1]
  if (direction === 'desde' || direction === 'a partir de') {
    return { type: 'AFTER_TIME', time, inclusive: true }
  }
  if (direction === 'despues de') {
    return { type: 'AFTER_TIME', time, inclusive: false }
  }
  return { type: 'BEFORE_TIME', time, inclusive: direction === 'hasta' }
}

function parseExactTime(normalized: string) {
  const timeText = normalized
    .replace(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/g, ' ')
    .replace(/\b(\d{1,2})\s*[.,]\s*(\d{2})(?!:)\b/g, '$1:$2')
  const colonTime = /(?:^|\b)([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:h|hs|hrs|horas))?(?:\b|$)/.exec(timeText)
  if (colonTime?.[1] && colonTime[2]) {
    return normalizeFlexibleTime(colonTime[1], colonTime[2], true)
  }
  const spacedTime = /^(?:a\s+las?\s+)?([01]?\d|2[0-3])\s+([0-5]\d)(?:\s*(?:h|hs|hrs|horas))?$/.exec(timeText.trim())
  if (spacedTime?.[1] && spacedTime[2]) {
    return normalizeFlexibleTime(spacedTime[1], spacedTime[2], true)
  }
  const compact = /(?:^|\b)(?:a\s+las?\s+|la\s+de\s+las?\s+)?(\d{3,4})(?:\s*(?:h|hs|hrs|horas))?(?:\b|$)/.exec(timeText)
  if (compact?.[1]) return normalizeFlexibleTime(compact[1], undefined, true)
  const suffixedHour = /(?:^|\b)(?:a\s+las?\s+|cerca\s+de\s+las?\s+|la\s+de\s+las?\s+)?(\d{1,2})\s*(?:h|hs|hrs|horas)(?:\b|$)/.exec(timeText)
  if (suffixedHour?.[1]) return normalizeFlexibleTime(suffixedHour[1], undefined, true)
  const explicit = /(?:^|\b)(?:a\s+las?\s+|cerca\s+de\s+las?\s+|la\s+de\s+las?\s+)(\d{1,2})(?::(\d{2}))?(?:\b|$)/.exec(timeText)
  if (!explicit?.[1]) return null
  return normalizeFlexibleTime(explicit[1], explicit[2], true)
}

function normalizeFlexibleTime(hourValue: string, minuteValue?: string, preferDaytime = false) {
  let hour: number
  let minute: number
  if (hourValue.length >= 3 && minuteValue === undefined) {
    const padded = hourValue.padStart(4, '0')
    hour = Number(padded.slice(0, 2))
    minute = Number(padded.slice(2))
  } else {
    hour = Number(hourValue)
    minute = Number(minuteValue ?? '0')
  }
  if (preferDaytime && hour >= 1 && hour <= 7) hour += 12
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 24 && minute <= 59 ? hour * 60 + minute : null
}
