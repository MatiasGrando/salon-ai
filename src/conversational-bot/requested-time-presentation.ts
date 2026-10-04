import type { RequestedStartExplanation } from '../bot-options/application/availability-evidence.js'
/** The missing target is not a missing day; only scoped fresh proof may supply its cause. */
export function requestedTimeExplanation(time: string, proof?: RequestedStartExplanation): string {
  const prefix = 'A las ' + time + ' no encontré un horario disponible para completar este pedido.'
  if (proof?.available) return 'No pude verificar una opción para completar este pedido a las ' + time + '.'
  if (!proof || proof.time !== time) return prefix
  const causes = {
    BUSINESS_CLOSED: 'El local no atiende ese día.',
    PROFESSIONAL_NOT_WORKING: 'El profesional solicitado no tiene jornada de atención ese día.',
    REQUESTED_START_OUTSIDE_BUSINESS_HOURS: 'Ese inicio queda fuera del horario de atención del local.',
    REQUESTED_START_OUTSIDE_PROFESSIONAL_HOURS: 'Ese inicio queda fuera de la jornada del profesional.',
    DURATION_DOES_NOT_FIT: 'Desde esa hora no entra la duración completa del pedido dentro de la atención del local y del profesional.',
    LEAD_TIME: 'Ese inicio no cumple la anticipación mínima para reservar.',
    BLOCKED: 'Un bloqueo de agenda impide completar el pedido desde esa hora.',
    BUSY: 'Ese inicio se superpone con un turno ocupado del profesional.'
  } as const
  const lines = proof.reasons.flatMap(reason => Object.hasOwn(causes,reason) ? [causes[reason as keyof typeof causes]] : [])
  return [prefix,...lines].join(' ')
}
