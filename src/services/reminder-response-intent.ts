import { normalizeText } from './message-understanding-service.js'

export function isStandaloneReminderAcknowledgement(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return [
    'si',
    'si gracias',
    'dale',
    'dale gracias',
    'ok',
    'okay',
    'perfecto',
    'confirmo',
    'confirmado'
  ].includes(normalized)
}

export function isAppointmentReminderMessage(message: string) {
  const normalized = normalizeText(message)
    .replace(/[^\p{L}\p{N}:]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.includes('te recordamos tu turno') ||
    normalized.includes('te recuerdo tu turno') ||
    normalized.includes('recordatorio de tu turno')
}

export function reminderAcknowledgementReply(input: {
  serviceName: string
  startAt: Date
}) {
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(input.startAt)
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(input.startAt)

  return `Perfecto, tu turno de ${input.serviceName} del ${date} a las ${time} sigue confirmado. ¡Te esperamos!`
}
