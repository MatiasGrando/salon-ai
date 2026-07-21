export const postSaleModes = ['PAUSED', 'MANUAL_ASSISTED', 'AUTOMATIC_API'] as const
export type PostSaleMode = typeof postSaleModes[number]

export const postSaleManualStatuses = ['OPENED', 'SENT', 'SKIPPED', 'RESPONDED', 'RESOLVED', 'PENDING'] as const
export type PostSaleManualStatus = typeof postSaleManualStatuses[number]

const manualTransitions: Record<string, readonly PostSaleManualStatus[]> = {
  PENDING: ['OPENED', 'SENT', 'SKIPPED'],
  OPENED: ['PENDING', 'SENT', 'SKIPPED'],
  SENT: ['RESPONDED', 'RESOLVED'],
  RESPONDED: ['RESOLVED'],
  FAILED: ['PENDING', 'OPENED', 'SENT', 'SKIPPED'],
  SKIPPED: [],
  RESOLVED: [],
  EXPIRED: []
}

export function normalizePostSaleMode(value: unknown, legacyEnabled = false): PostSaleMode {
  return postSaleModes.includes(value as PostSaleMode)
    ? value as PostSaleMode
    : legacyEnabled ? 'AUTOMATIC_API' : 'PAUSED'
}

export function assertPostSaleManualTransition(from: string, to: string): asserts to is PostSaleManualStatus {
  if (!postSaleManualStatuses.includes(to as PostSaleManualStatus)) {
    throw new Error('Estado de postventa inv\u00e1lido')
  }
  if (from === to) return
  if (!manualTransitions[from]?.includes(to as PostSaleManualStatus)) {
    throw new Error('No se puede cambiar la postventa de ' + from + ' a ' + to)
  }
}

export function canAutomaticPostSaleSend(status: string) {
  return status === 'PENDING' || status === 'FAILED'
}

export function isPostSaleTemplateEligible(
  mode: PostSaleMode,
  template: { status: string; category: string }
) {
  return mode !== 'AUTOMATIC_API' || (template.status === 'APPROVED' && template.category === 'UTILITY')
}
