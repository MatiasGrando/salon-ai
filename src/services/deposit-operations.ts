export type DepositTermService = {
  id: string
  name: string
  price: number | null
  priceMode: 'FIXED' | 'STARTING_AT'
  depositMode: 'NONE' | 'FIXED' | 'PERCENTAGE'
  depositValue: number | null
}

export type BookingDepositTerms = {
  lines: Array<{
    serviceId: string
    sortOrder: number
    serviceName: string
    mode: 'FIXED' | 'PERCENTAGE'
    configuredValue: number
    baseAmount: number | null
    amount: number
  }>
  amount: number
  ttlMinutes: number
  ttlProvenance: 'BUSINESS_POLICY' | 'DEFAULT_120'
}

/** F8.2: calcula un snapshot financiero; jamás consulta ni interpreta TTL legado. */
export function calculateBookingDepositTerms(input: {
  services: readonly DepositTermService[]
  businessDepositHoldMinutes: number | null
}): BookingDepositTerms {
  if (!input.services.length || new Set(input.services.map((service) => service.id)).size !== input.services.length) {
    throw new Error('deposit terms require unique services')
  }
  const ttlMinutes = input.businessDepositHoldMinutes ?? 120
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) throw new Error('deposit TTL policy is invalid')

  const lines = input.services.flatMap((service, sortOrder) => {
    if (service.depositMode === 'NONE') return []
    const configuredValue = service.depositValue
    if (!Number.isInteger(configuredValue) || configuredValue <= 0) {
      throw new Error(`deposit rule is invalid for service ${service.id}`)
    }
    if (service.depositMode === 'FIXED') {
      return [{ serviceId: service.id, sortOrder, serviceName: service.name, mode: 'FIXED' as const, configuredValue, baseAmount: null, amount: configuredValue }]
    }
    if (configuredValue > 100 || service.priceMode !== 'FIXED' || !Number.isInteger(service.price) || service.price <= 0) {
      throw new Error(`percentage deposit requires a fixed positive price for service ${service.id}`)
    }
    return [{ serviceId: service.id, sortOrder, serviceName: service.name, mode: 'PERCENTAGE' as const, configuredValue, baseAmount: service.price, amount: Math.round(service.price * configuredValue / 100) }]
  })
  if (!lines.length) throw new Error('deposit hold requires at least one deposit rule')
  const amount = lines.reduce((total, line) => total + line.amount, 0)
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('deposit amount is invalid')
  return { lines, amount, ttlMinutes, ttlProvenance: input.businessDepositHoldMinutes === null ? 'DEFAULT_120' : 'BUSINESS_POLICY' }
}

export function hasCompleteDepositPaymentConfiguration(settings: {
  transferEnabled: boolean
  alias: string | null
  cbu: string | null
  cvu: string | null
  paymentLinkEnabled: boolean
  paymentLink: string | null
}) {
  return (settings.transferEnabled && Boolean(settings.alias || settings.cbu || settings.cvu)) ||
    (settings.paymentLinkEnabled && Boolean(settings.paymentLink))
}
