export const communicationSourceTypes = ['CAMPAIGN', 'REMINDER', 'POST_SALE'] as const
export const communicationPurposes = ['PROMOTIONAL', 'OPERATIONAL', 'FOLLOW_UP'] as const
export const communicationModes = ['WHATSAPP_API', 'WHATSAPP_MANUAL'] as const
export const communicationStatuses = ['PENDING', 'OPENED', 'SENT', 'DELIVERED', 'READ', 'RESPONDED', 'BOOKED', 'SKIPPED', 'FAILED', 'CANCELLED'] as const

export type CommunicationSourceType = typeof communicationSourceTypes[number]
export type CommunicationPurpose = typeof communicationPurposes[number]
export type CommunicationMode = typeof communicationModes[number]
export type CommunicationStatus = typeof communicationStatuses[number]

const transitions: Record<CommunicationStatus, readonly CommunicationStatus[]> = {
  PENDING: ['OPENED', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED'],
  OPENED: ['SENT', 'SKIPPED', 'FAILED', 'CANCELLED'],
  SENT: ['DELIVERED', 'READ', 'RESPONDED', 'BOOKED', 'FAILED', 'CANCELLED'],
  DELIVERED: ['READ', 'RESPONDED', 'BOOKED', 'CANCELLED'],
  READ: ['RESPONDED', 'BOOKED', 'CANCELLED'],
  RESPONDED: ['BOOKED', 'CANCELLED'],
  BOOKED: [],
  SKIPPED: [],
  FAILED: ['PENDING', 'CANCELLED'],
  CANCELLED: []
}

export function assertCommunicationTransition(from: string, to: string) {
  if (!communicationStatuses.includes(from as CommunicationStatus) || !communicationStatuses.includes(to as CommunicationStatus)) {
    throw new Error('Estado de comunicación inválido')
  }
  if (from === to) return
  if (!transitions[from as CommunicationStatus].includes(to as CommunicationStatus)) {
    throw new Error('No se puede cambiar la comunicación de ' + from + ' a ' + to)
  }
}

export function communicationTimestampField(status: CommunicationStatus) {
  const fields: Partial<Record<CommunicationStatus, string>> = {
    OPENED: 'openedAt',
    SENT: 'sentAt',
    DELIVERED: 'deliveredAt',
    READ: 'readAt',
    RESPONDED: 'respondedAt',
    BOOKED: 'bookedAt',
    SKIPPED: 'skippedAt',
    FAILED: 'failedAt'
  }
  return fields[status] ?? null
}

export function buildManualWhatsAppUrl(phone: string, message: string) {
  const normalizedPhone = phone.replace(/\D/g, '')
  if (normalizedPhone.length < 8) throw new Error('El teléfono no es válido para WhatsApp')
  return 'https://wa.me/' + normalizedPhone + '?text=' + encodeURIComponent(message)
}

export function isExecutionComplete(statuses: string[]) {
  return statuses.every((status) => !['PENDING', 'OPENED'].includes(status))
}

export function isWithinCommunicationCooldown(lastSentAt: Date | null, now: Date, cooldownDays: number) {
  if (!lastSentAt || cooldownDays <= 0) return false
  return now.getTime() - lastSentAt.getTime() < cooldownDays * 86_400_000
}
