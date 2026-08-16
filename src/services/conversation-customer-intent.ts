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
  'que',
  'qué'
])
const nonNameWords = new Set([
  ...greetingWords,
  'quiero',
  'necesito',
  'busco',
  'quisiera',
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
  const marker = /\b(?:yo\s+)?(?:soy|me\s+llamo|mi\s+nombre\s+es)\s+/iu.exec(message)
  if (!marker) return null

  const tail = message.slice(marker.index + marker[0].length).trim()
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

  const remainingMessage = (match[2] ?? '')
    .replace(/^[,;:.!¡¿?\s-]+/gu, '')
    .trim()

  return {
    addressedName: formatCustomerName(addressedName) ?? addressedName,
    remainingMessage: remainingMessage || null
  }
}

export function isPureSocialGreeting(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  return [
    'hola',
    'holaa',
    'holaaa',
    'holi',
    'hola cami',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'hola como estas',
    'hola que tal',
    'hola todo bien',
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
