export type BookingV2DepositMode = 'NONE' | 'FIXED' | 'PERCENTAGE'
export type BookingV2ServiceAttentionMode = 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'

export type BookingV2DepositCalculation = {
  mode: Exclude<BookingV2DepositMode, 'NONE'>
  configuredValue: number
  baseAmount: number | null
  amount: number
}

export type BookingV2PaymentSettings = {
  transferEnabled: boolean
  alias: string | null
  cbu: string | null
  cvu: string | null
  accountHolder: string | null
  paymentLinkEnabled: boolean
  paymentLink: string | null
  instructions: string | null
}

export function serviceCanContinueToBooking(input: {
  attentionMode: BookingV2ServiceAttentionMode
  requiresPhoto: boolean
  estimateAllowsBooking: boolean
}) {
  return input.attentionMode === 'DIRECT_BOOKING' ||
    input.attentionMode === 'QUOTE' ||
    input.requiresPhoto ||
    (input.attentionMode === 'GUIDED_ESTIMATE' && input.estimateAllowsBooking)
}

export function calculateBookingV2Deposit(input: {
  mode: BookingV2DepositMode
  value: number | null
  servicePrice: number | null
  estimateMinimum: number | null
}): BookingV2DepositCalculation | null {
  if (input.mode === 'NONE' || !Number.isFinite(input.value) || Number(input.value) <= 0) {
    return null
  }

  const configuredValue = Number(input.value)
  if (input.mode === 'FIXED') {
    return {
      mode: 'FIXED',
      configuredValue,
      baseAmount: null,
      amount: Math.round(configuredValue)
    }
  }

  if (configuredValue > 100) return null
  const baseAmount = firstPositiveAmount(input.estimateMinimum, input.servicePrice)
  if (baseAmount === null) return null

  return {
    mode: 'PERCENTAGE',
    configuredValue,
    baseAmount,
    amount: Math.round(baseAmount * configuredValue / 100)
  }
}

export function renderBookingV2DepositRequest(input: {
  serviceName: string
  calculation: BookingV2DepositCalculation
  paymentSettings?: BookingV2PaymentSettings | null
  expiresAt?: Date | null
}) {
  const formattedAmount = formatCurrency(input.calculation.amount)
  const calculationDetail = input.calculation.mode === 'PERCENTAGE' && input.calculation.baseAmount !== null
    ? ` Es el ${formatPercentage(input.calculation.configuredValue)} de ${formatCurrency(input.calculation.baseAmount)}, tomando el valor mínimo estimado.`
    : ''

  const paymentInstructions = renderBookingV2PaymentInstructions(input.paymentSettings)
  const expiration = input.expiresAt
    ? `\n\nEl horario queda reservado hasta las ${formatTime(input.expiresAt)}.`
    : ''

  return `Para finalizar la reserva de ${input.serviceName}, necesitamos una seña de ${formattedAmount}.${calculationDetail}\n\n${paymentInstructions}${expiration}\n\nEnviá el comprobante de pago por acá. Después el equipo lo revisará y te confirmará el turno.`
}

export function renderBookingV2PaymentInstructions(
  settings?: BookingV2PaymentSettings | null
) {
  if (!settings) {
    return 'El equipo te compartirá los datos de pago por acá.'
  }
  const sections: string[] = []
  if (settings.transferEnabled) {
    const transferLines = [
      'Podés transferir con estos datos:',
      ...(settings.alias ? [`• Alias: ${settings.alias}`] : []),
      ...(settings.cbu ? [`• CBU: ${settings.cbu}`] : []),
      ...(settings.cvu ? [`• CVU: ${settings.cvu}`] : []),
      ...(settings.accountHolder ? [`• Titular: ${settings.accountHolder}`] : [])
    ]
    if (transferLines.length > 1) sections.push(transferLines.join('\n'))
  }
  if (settings.paymentLinkEnabled && settings.paymentLink) {
    sections.push(`También podés pagar desde este enlace:\n${settings.paymentLink}`)
  }
  if (settings.instructions) sections.push(settings.instructions)
  return sections.length
    ? sections.join('\n\n')
    : 'El equipo te compartirá los datos de pago por acá.'
}

function firstPositiveAmount(...values: Array<number | null>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return null
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}

function formatPercentage(value: number) {
  return `${new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 2
  }).format(value)}%`
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires'
  }).format(value)
}
