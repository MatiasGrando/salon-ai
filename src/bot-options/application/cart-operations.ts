export type CartService = {
  id: string
  name: string
  durationMinutes: number
  priceMinor: number | null
  priceMode: 'FIXED' | 'STARTING_AT'
  professionalIds: readonly string[]
  estimate?: import('../domain/service-booking.js').ServiceEstimate
}

export type CartCombinationPolicy = 'ALLOWED' | 'REVIEW_REQUIRED' | 'BLOCKED'

export type CartSnapshot = {
  services: CartService[]
  totalDurationMinutes: number
  totalPriceMinor: number | null
  hasEstimatedOrPrivatePrice: boolean
  commonProfessionalIds: string[]
}

export function buildCartSnapshot(services: readonly CartService[]): CartSnapshot {
  const unique = new Map(services.map((service) => [service.id, service]))
  const ordered = [...unique.values()]
  const common = ordered.length === 0
    ? []
    : ordered[0]!.professionalIds.filter((id) => ordered.every((service) => service.professionalIds.includes(id)))
  const exact = ordered.every((service) => service.priceMinor !== null && service.priceMode === 'FIXED')
  return {
    services: ordered,
    totalDurationMinutes: ordered.reduce((sum, service) => sum + service.durationMinutes, 0),
    totalPriceMinor: exact ? ordered.reduce((sum, service) => sum + service.priceMinor!, 0) : null,
    hasEstimatedOrPrivatePrice: !exact,
    commonProfessionalIds: [...new Set(common)].sort()
  }
}

export function cartChangeInvalidatesAvailability(previousIds: readonly string[], nextIds: readonly string[]): boolean {
  return previousIds.length !== nextIds.length || previousIds.some((id, index) => id !== nextIds[index])
}

export function canAddService(input: {
  current: CartSnapshot
  proposed: CartService
  pairPolicies?: ReadonlyMap<string, CartCombinationPolicy>
}): { ok: true; snapshot: CartSnapshot } | { ok: false; reason: 'DUPLICATE' | 'NO_COMMON_PROFESSIONAL' | 'REVIEW_REQUIRED' | 'BLOCKED' } {
  if (input.current.services.some((service) => service.id === input.proposed.id)) return { ok: false, reason: 'DUPLICATE' }
  for (const existing of input.current.services) {
    const key = [existing.id, input.proposed.id].sort().join(':')
    const policy = input.pairPolicies?.get(key)
    if (policy === 'BLOCKED') return { ok: false, reason: 'BLOCKED' }
    if (policy === 'REVIEW_REQUIRED') return { ok: false, reason: 'REVIEW_REQUIRED' }
  }
  const snapshot = buildCartSnapshot([...input.current.services, input.proposed])
  return snapshot.commonProfessionalIds.length > 0
    ? { ok: true, snapshot }
    : { ok: false, reason: 'NO_COMMON_PROFESSIONAL' }
}

export function formatCartSummary(snapshot: CartSnapshot): string {
  const money = (n: number) => `$ ${n.toLocaleString('es-AR')}`
  const services = snapshot.services.map((service) => `• ${service.name}${service.estimate
    ? ` — ${service.estimate.optionLabel ? service.estimate.optionLabel + ': ' : ''}${service.estimate.priceMax === null ? 'Desde ' + money(service.estimate.priceMin) : money(service.estimate.priceMin) + ' a ' + money(service.estimate.priceMax)} (estimado)`
    : ''}`).join('\n')
  const price = snapshot.totalPriceMinor === null
    ? 'Precio: pendiente de confirmación'
    : `Precio total: $${snapshot.totalPriceMinor.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
  return `Tu reserva\n${services}\nDuración total: ${snapshot.totalDurationMinutes} min\n${price}`
}
