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
  const services = snapshot.services.map(formatCartServiceLine).join('\n')
  const price = snapshot.totalPriceMinor === null
    ? '💰 Total: pendiente de confirmación'
    : `💰 Total: ${formatMoney(snapshot.totalPriceMinor)}`
  return `*Tu reserva*\n\n${services}\n\n⏱️ Total: ${snapshot.totalDurationMinutes} min\n${price}`
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function formatCartServicePrice(service: CartService): string | null {
  if (service.estimate) {
    const amount = service.estimate.priceMax === null
      ? `Desde ${formatMoney(service.estimate.priceMin)}`
      : `${formatMoney(service.estimate.priceMin)} a ${formatMoney(service.estimate.priceMax)}`
    return `${service.estimate.optionLabel ? `${service.estimate.optionLabel}: ` : ''}${amount} (estimado)`
  }
  if (service.priceMinor === null) return null
  const amount = formatMoney(service.priceMinor)
  return service.priceMode === 'STARTING_AT' ? `Desde ${amount}` : amount
}

function formatCartServiceLine(service: CartService): string {
  const details = [`${service.durationMinutes} min`, formatCartServicePrice(service)]
    .filter((value): value is string => value !== null)
  return `💇 ${service.name}${details.length > 0 ? ` — ${details.join(' · ')}` : ''}`
}

function formatLongDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' }).format(instant)
  const month = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(instant)
  const readable = `${weekday} ${Number(match[3])} de ${month}`
  return readable.charAt(0).toLocaleUpperCase('es-AR') + readable.slice(1)
}

export function formatBookingConfirmation(input: {
  snapshot: CartSnapshot
  customerName: string | null
  professionalName: string
  date: string
  time: string
}): string {
  const greeting = input.customerName?.trim()
    ? `¡Listo, ${input.customerName.trim()}! ✨ Tu turno quedó confirmado.`
    : '¡Listo! ✨ Tu turno quedó confirmado.'
  const serviceLines = input.snapshot.services.map(formatCartServiceLine).join('\n')
  const totals = input.snapshot.services.length > 1
    ? `\n\n⏱️ Duración total: ${input.snapshot.totalDurationMinutes} min\n${input.snapshot.totalPriceMinor === null
        ? '💰 Precio total: pendiente de confirmación'
        : `💰 Precio total: ${formatMoney(input.snapshot.totalPriceMinor)}`}`
    : ''
  return `${greeting}\n\n*Detalle de tu reserva*\n\n${serviceLines}${totals}\n\n👤 Profesional: ${input.professionalName}\n📅 ${formatLongDate(input.date)}\n🕒 ${input.time}\n\n¡Te esperamos! 😊`
}
