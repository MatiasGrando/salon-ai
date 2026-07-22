export const reminderModes = ['PAUSED', 'MANUAL_ASSISTED', 'AUTOMATIC_API'] as const
export type ReminderMode = typeof reminderModes[number]

export const reminderManualStatuses = ['PENDING', 'OPENED', 'SENT', 'SKIPPED'] as const
export type ReminderManualStatus = typeof reminderManualStatuses[number]

const manualTransitions: Record<string, readonly ReminderManualStatus[]> = {
  PENDING: ['OPENED', 'SENT', 'SKIPPED'],
  OPENED: ['PENDING', 'SENT', 'SKIPPED'],
  FAILED: ['PENDING', 'OPENED', 'SENT', 'SKIPPED'],
  SENT: [],
  SKIPPED: [],
  DELIVERED: [],
  READ: [],
  CANCELLED: [],
  EXPIRED: [],
  PROCESSING: []
}

export function normalizeReminderMode(value: unknown, legacyEnabled = false): ReminderMode {
  return reminderModes.includes(value as ReminderMode)
    ? value as ReminderMode
    : legacyEnabled ? 'AUTOMATIC_API' : 'PAUSED'
}

export function isReminderTemplateEligible(
  mode: ReminderMode,
  template: { status: string; category: string }
) {
  return template.category === 'UTILITY' && (mode !== 'AUTOMATIC_API' || template.status === 'APPROVED')
}

export function assertReminderManualTransition(from: string, to: string): asserts to is ReminderManualStatus {
  if (!reminderManualStatuses.includes(to as ReminderManualStatus)) throw new Error('Estado de recordatorio inv\u00e1lido')
  if (from === to) return
  if (!manualTransitions[from]?.includes(to as ReminderManualStatus)) {
    throw new Error('No se puede cambiar el recordatorio de ' + from + ' a ' + to)
  }
}

export function canAutomaticReminderSend(status: string) {
  return status === 'PENDING' || status === 'FAILED'
}
