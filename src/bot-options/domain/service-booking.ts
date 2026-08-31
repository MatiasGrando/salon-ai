/** Service policy shared by the options resolver and its tenant-scoped repositories. */
export type ServiceEstimate = { optionId: string | null; optionLabel: string | null; priceMin: number; priceMax: number | null }
export type EstimateOption = { id: string; label: string; priceMin: number; priceMax: number | null; note: string | null }
export type ServiceBookingPolicy = {
  id: string; name: string; attentionMode: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
  price: number | null; priceMode: 'FIXED' | 'STARTING_AT'; estimateAllowsBooking: boolean
  estimateQuestion: string | null; estimateOptions: EstimateOption[] | null
  estimateExplanation: string | null; estimateDisclaimer: string | null; requiresPhoto: boolean
  validationEnabled: boolean; validationMessage: string | null; validationQuestion: string | null
}
export type ServiceBookingDecision = { configurationKey: string; estimate?: ServiceEstimate; validationAccepted?: boolean }

export function parseEstimateOptions(raw: unknown): EstimateOption[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 12) return null
  const seen = new Set<string>()
  const result: EstimateOption[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id) ||
        typeof row.label !== 'string' || !row.label.trim() || !Number.isSafeInteger(row.priceMin) || row.priceMin < 0 ||
        (row.priceMax != null && (!Number.isSafeInteger(row.priceMax) || row.priceMax < row.priceMin))) return null
    seen.add(row.id)
    result.push({ id: row.id, label: row.label, priceMin: row.priceMin, priceMax: row.priceMax ?? null, note: typeof row.note === 'string' ? row.note : null })
  }
  return result
}

/** Stable fingerprint: changed questions, prices, permissions or validation must be resolved again. */
export function serviceConfigurationKey(service: ServiceBookingPolicy): string {
  return JSON.stringify([service.attentionMode, service.price, service.priceMode, service.estimateAllowsBooking,
    service.estimateQuestion, service.estimateOptions, service.estimateExplanation, service.estimateDisclaimer,
    service.requiresPhoto, service.validationEnabled, service.validationMessage, service.validationQuestion])
}

export function resolveServiceEstimate(service: Pick<ServiceBookingPolicy, 'estimateOptions' | 'price' | 'priceMode'>, optionId: string | null): ServiceEstimate | null {
  if (service.estimateOptions === null) return null
  if (service.estimateOptions.length) {
    const option = service.estimateOptions.find(option => option.id === optionId)
    return option ? { optionId: option.id, optionLabel: option.label, priceMin: option.priceMin, priceMax: option.priceMax } : null
  }
  return optionId === null && service.priceMode === 'STARTING_AT' && service.price !== null && Number.isSafeInteger(service.price) && service.price > 0
    ? { optionId: null, optionLabel: null, priceMin: service.price, priceMax: null } : null
}

export function serviceAllowsAutomaticBooking(service: Pick<ServiceBookingPolicy, 'attentionMode' | 'estimateAllowsBooking'>): boolean {
  return service.attentionMode === 'DIRECT_BOOKING' || (service.attentionMode === 'GUIDED_ESTIMATE' && service.estimateAllowsBooking)
}

export function formatServiceEstimate(estimate: ServiceEstimate): string {
  const money = (n: number) => `$ ${n.toLocaleString('es-AR')}`
  return estimate.priceMax === null ? `Desde ${money(estimate.priceMin)}` : `${money(estimate.priceMin)} a ${money(estimate.priceMax)}`
}
