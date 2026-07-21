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

export function partitionLatestPostSales(deliveries: Array<{
  id: string
  businessId: string
  customerId: string
  scheduledFor: Date
  status?: string
}>) {
  const activeIds: string[] = []
  const supersededIds: string[] = []
  const seen = new Set<string>()
  const reserved = new Set<string>()
  const ordered = [...deliveries].sort((left, right) => {
    const leftReserved = ['OPENED', 'PROCESSING'].includes(left.status || '')
    const rightReserved = ['OPENED', 'PROCESSING'].includes(right.status || '')
    if (leftReserved && !rightReserved) return -1
    if (rightReserved && !leftReserved) return 1
    return right.scheduledFor.getTime() - left.scheduledFor.getTime()
  })
  for (const delivery of ordered) {
    const key = delivery.businessId + ':' + delivery.customerId
    if (seen.has(key)) {
      if (!reserved.has(key)) supersededIds.push(delivery.id)
    } else {
      seen.add(key)
      if (['OPENED', 'PROCESSING'].includes(delivery.status || '')) reserved.add(key)
      activeIds.push(delivery.id)
    }
  }
  return { activeIds, supersededIds }
}
