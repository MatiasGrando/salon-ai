import { normalizeText } from './message-understanding-service.js'

export function isDeterministicServiceDetailQuestion(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false

  const mentionsWashing = /\b(?:me|te|lo|la|el|se)?\s*(?:lavan|lavarian|lavar|lava|lavado|lavada|lavarme)\b/.test(normalized)
  const asksAboutWashing = mentionsWashing && (
    message.includes('?') ||
    /\b(?:cabello|pelo|cabeza|ahi|alli|lugar|local|salon|incluye|incluido|antes|durante)\b/.test(normalized)
  )
  const asksAboutProcess = /\b(?:procedimiento|proceso|preparacion|pasos?|como se hace|como lo hacen|que hacen|que incluye|incluye|en que consiste|de que se trata)\b/.test(normalized)
  const asksForMoreDetail = /\b(?:quiero|quisiera|necesito|me gustaria)\s+(?:saber|conocer)\s+(?:algo\s+|un poco\s+)?mas\b/.test(normalized) ||
    /\b(?:contame|explicame|decime)\s+(?:algo\s+|un poco\s+)?mas\b/.test(normalized)
  const asksAppointmentProcedure = /\b(?:si|cuando|para)\s+(?:solicito|pido|reservo|saco|agendo)\s+(?:un\s+)?turno\b/.test(normalized) &&
    /\b(?:pasos?|procedimiento|proceso|que sigue|como es|que tengo que hacer|preparar)\b/.test(normalized)

  return asksAboutWashing || asksAboutProcess || asksForMoreDetail || asksAppointmentProcedure
}
