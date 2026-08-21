import { normalizeText } from './message-understanding-service.js'

export type ExplicitCustomerIntroduction = {
  name: string
  remainingMessage: string | null
}

export type MisaddressedAssistantGreeting = {
  addressedName: string
  remainingMessage: string | null
}

const assistantNames = new Set(['cami', 'camila'])
const greetingWords = new Set([
  'como',
  'estas',
  'esta',
  'tal',
  'todo',
  'bien',
  'va',
  'andas',
  'andás',
  'soy',
  'me',
  'mi',
  'con',
  'por',
  'para',
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'cliente',
  'que',
  'qué'
])
const nonNameWords = new Set([
  ...greetingWords,
  'quiero',
  'queria',
  'quería',
  'necesito',
  'busco',
  'quisiera',
  'vengo',
  'podria',
  'podría',
  'puedo',
  'reservar',
  'agendar',
  'sacar',
  'turno',
  'turnos',
  'horario',
  'horarios',
  'precio',
  'precios',
  'servicio',
  'servicios',
  'ubicacion',
  'ubicación',
  'cancelar',
  'cambiar'
])

export function extractExplicitCustomerIntroduction(
  message: string
): ExplicitCustomerIntroduction | null {
  const marker = /\b(?:yo\s+)?(?:soy|me\s+llamo|mi\s+nombre\s+es|te\s+habla)\s+/iu.exec(message) ??
    /^(?:(?:hola+|holi+|buenas|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches)[,;:.!¡¿?\s-]+)?habla\s+/iu.exec(message.trim())
  if (marker) {
    return introductionFromMarker(message, marker.index, marker[0])
  }

  return extractColloquialCustomerIntroduction(message)
}

function introductionFromMarker(message: string, markerIndex: number, markerText: string) {
  const tail = message.slice(markerIndex + markerText.length).trim()
  if (!tail) return null

  const boundary = findIntroductionBoundary(tail)
  const rawName = (boundary === -1 ? tail : tail.slice(0, boundary))
    .replace(/^[,;:.!¡¿?\s-]+|[,;:.!¡¿?\s-]+$/gu, '')
    .trim()
  const name = formatCustomerName(rawName)
  if (!name || !looksLikeCustomerName(name)) return null

  const rawRemaining = boundary === -1 ? '' : tail.slice(boundary)
  const remainingMessage = rawRemaining
    .replace(/^[,;:.!¡¿?\s-]+/gu, '')
    .replace(/^y\s+(?=(?:quiero|necesito|busco|quisiera|vengo|queria|quería)\b)/iu, '')
    .trim()

  return {
    name,
    remainingMessage: remainingMessage || null
  }
}

function extractColloquialCustomerIntroduction(message: string): ExplicitCustomerIntroduction | null {
  const trimmed = message.trim()
  const match = /^(?:(?:hola+|holi+|buenas|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches)[,;:.!¡¿?\s-]+)?([\p{Letter}][\p{Letter}'’\-]{1,39}(?:\s+[\p{Letter}][\p{Letter}'’\-]{1,39}){0,3})\s+(?:por\s+ac[aá]|de\s+este\s+lado)(?=$|[,;:.!¡¿?\s-])/iu.exec(trimmed)
  if (!match?.[1]) return null

  const name = formatCustomerName(match[1])
  if (!name || !looksLikeCustomerName(name)) return null

  const remainingMessage = trimmed.slice(match[0].length)
    .replace(/^[,;:.!¡¿?\s-]+/gu, '')
    .replace(/^y\s+(?=(?:quiero|necesito|busco|quisiera|vengo|queria|quería)\b)/iu, '')
    .trim()

  return { name, remainingMessage: remainingMessage || null }
}

export function extractMisaddressedAssistantGreeting(
  message: string
): MisaddressedAssistantGreeting | null {
  const match = /^(?:hola+|holi+|buenas|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches)[,;:.!¡¿?\s-]+([\p{Letter}][\p{Letter}'’-]{1,39})(.*)$/iu.exec(message.trim())
  if (!match) return null

  const addressedName = match[1]?.trim() ?? ''
  const normalizedName = normalizeText(addressedName)
  if (!addressedName || assistantNames.has(normalizedName) || nonNameWords.has(normalizedName)) {
    return null
  }

  const rawRemainingMessage = match[2] ?? ''
  if (!looksLikeAddressedNameContinuation(rawRemainingMessage)) return null

  const remainingMessage = rawRemainingMessage
    .replace(/^[,;:.!¡¿?\s-]+/gu, '')
    .trim()

  return {
    addressedName: formatCustomerName(addressedName) ?? addressedName,
    remainingMessage: remainingMessage || null
  }
}

function looksLikeAddressedNameContinuation(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/^[,;:.!¡¿?\-]/u.test(trimmed)) return true

  const normalized = normalizeText(trimmed)
  return /^(?:como\s+estas|como\s+va|que\s+tal|todo\s+bien|buen\s+dia|buenas|quiero|queria|quisiera|necesito|busco|vengo|reservar|agendar|sacar|consultar|saber|ver|cancelar|cambiar|modificar)\b/.test(normalized)
}

export function isPureSocialGreeting(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const greetingSequence = /^(?:(?:hola+|holi+|buenos dias|buen dia|buenas tardes|buenas noches|buenas)(?:\s+|$))+(?:(?:como estas|como va|que tal|todo bien))?$/
  if (greetingSequence.test(normalized)) return true

  return [
    'hola cami',
    'como estas',
    'como va',
    'que tal',
    'todo bien'
  ].includes(normalized)
}

export function extractPlainCustomerName(message: string) {
  const cleaned = message
    .replace(/^[,;:.!¡¿?\s-]+|[,;:.!¡¿?\s-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  const name = formatCustomerName(cleaned)
  return name && looksLikeCustomerName(name) ? name : null
}

function findIntroductionBoundary(value: string) {
  const punctuationIndex = value.search(/[,;.!?]/u)
  const intentIndex = value.search(/\s+(?:y\s+)?(?=(?:quiero|necesito|busco|quisiera|vengo|queria|quería|reservar|agendar|sacar|consultar|saber|ver|cancelar|cambiar|modificar)\b)/iu)
  if (punctuationIndex === -1) return intentIndex
  if (intentIndex === -1) return punctuationIndex
  return Math.min(punctuationIndex, intentIndex)
}

function looksLikeCustomerName(value: string) {
  const words = value.split(/\s+/u).filter(Boolean)
  if (words.length < 1 || words.length > 4) return false
  if (!words.every((word) => /^[\p{Letter}][\p{Letter}'’-]{1,39}$/u.test(word))) return false
  return words.every((word) => !nonNameWords.has(normalizeText(word)))
}

function formatCustomerName(value: string) {
  const words = value.split(/\s+/u).filter(Boolean)
  if (!words.length) return null
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase('es-AR') + word.slice(1).toLocaleLowerCase('es-AR'))
    .join(' ')
}
