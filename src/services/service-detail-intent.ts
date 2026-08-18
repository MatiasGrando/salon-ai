import { normalizeText } from './message-understanding-service.js'

export const DETERMINISTIC_SERVICE_INFORMATION = [
  'general',
  'price',
  'duration',
  'professionals'
] as const

export type DeterministicServiceInformation =
  (typeof DETERMINISTIC_SERVICE_INFORMATION)[number]

function normalizedInformationMessage(message: string) {
  return normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isDeterministicServiceDetailQuestion(message: string) {
  const normalized = normalizedInformationMessage(message)
  if (!normalized) return false

  const mentionsWashing = /\b(?:me|te|lo|la|el|se)?\s*(?:lavan|lavarian|lavar|lava|lavado|lavada|lavarme)\b/.test(normalized)
  const asksAboutWashing = mentionsWashing && (
    message.includes('?') ||
    /\b(?:cabello|pelo|cabeza|ahi|alli|lugar|local|salon|incluye|incluido|antes|durante)\b/.test(normalized)
  )
  const asksAboutProcess = /\b(?:procedimiento|proceso|preparacion|pasos?|como se hace|como lo hacen|como funciona|que hacen|que incluye|incluye|incluyen|incluido|incluidos|incluida|incluidas|esta incluido|esta incluida|viene con|trae|en que consiste|de que se trata)\b/.test(normalized)
  const asksAboutRequirements = /\b(?:requisitos?|indicaciones?|contraindicaciones?|cuidados?|mantenimiento|frecuencia|cada cuanto|productos?|materiales?|riesgos?|duele|dolor|antes del servicio|despues del servicio)\b/.test(normalized) ||
    /\b(?:que|cual|como)\s+(?:resultado|resultados|efecto|efectos)\b/.test(normalized) ||
    /\b(?:resultado|resultados|efecto|efectos)\s+(?:da|deja|logra|tiene)\b/.test(normalized)
  const asksForMoreDetail = /\b(?:quiero|quisiera|necesito|me gustaria)\s+(?:saber|conocer)\s+(?:algo\s+|un poco\s+)?mas\b/.test(normalized) ||
    /\b(?:contame|explicame|decime)\s+(?:algo\s+|un poco\s+)?mas\b/.test(normalized)
  const asksAppointmentProcedure = /\b(?:si|cuando|para)\s+(?:solicito|pido|reservo|saco|agendo)\s+(?:un\s+)?turno\b/.test(normalized) &&
    /\b(?:pasos?|procedimiento|proceso|que sigue|como es|que tengo que hacer|preparar)\b/.test(normalized)

  return asksAboutWashing || asksAboutProcess || asksAboutRequirements || asksForMoreDetail || asksAppointmentProcedure
}

/**
 * Reconoce preguntas informativas que nombran un servicio sin convertirlas en
 * una selección para reservar. El orden coincide con el que usa el catálogo
 * cuando una frase solicita más de un dato.
 */
export function deterministicServiceInformationRequest(
  message: string
): DeterministicServiceInformation[] {
  const normalized = normalizedInformationMessage(message)
  if (!normalized) return []

  const requested: DeterministicServiceInformation[] = []
  if (/\b(?:precio|precios|costo|costos|valor|valores|tarifa|tarifas|cuanto cuesta|cuanto sale|cuanto esta|cuanto saldria|cuanto estaria|cuanto me cuesta|cuanto me sale|cuanto me saldria|cuanto me estaria|cuanto vale|en cuanto estaria|que sale)\b/.test(normalized)) {
    requested.push('price')
  }
  if (/\b(?:duracion|demora|cuanto dura|cuanto tiempo dura|cuanto tarda|cuanto tiempo tarda|cuanto demora|cuanto tiempo demora|que demora|tiempo lleva|tiempo tarda|tiempo demora|tiempo del servicio)\b/.test(normalized)) {
    requested.push('duration')
  }
  if (/\b(?:quien lo hace|quien la hace|quienes lo hacen|quienes la hacen|quien hace|quienes hacen|quien realiza|quienes realizan|quien lo realiza|quien la realiza|quienes lo realizan|quienes la realizan|quien atiende|quienes atienden|con quien puedo hacerlo|con quien puedo hacermelo|con quien me puedo atender|que profesional|cual profesional|con que profesional|profesionales?)\b/.test(normalized)) {
    requested.push('professionals')
  }
  if (isDeterministicServiceDetailQuestion(message)) {
    requested.push('general')
  }

  return Array.from(new Set(requested))
}

export function isDeterministicServiceInformationQuestion(message: string) {
  return deterministicServiceInformationRequest(message).length > 0
}
