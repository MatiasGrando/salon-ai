export type BookingV2DepositMode = 'NONE' | 'FIXED' | 'PERCENTAGE'

export type BookingV2DepositCalculation = {
  mode: Exclude<BookingV2DepositMode, 'NONE'>
  configuredValue: number
  baseAmount: number | null
  amount: number
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
}) {
  const formattedAmount = formatCurrency(input.calculation.amount)
  const calculationDetail = input.calculation.mode === 'PERCENTAGE' && input.calculation.baseAmount !== null
    ? ` Es el ${formatPercentage(input.calculation.configuredValue)} de ${formatCurrency(input.calculation.baseAmount)}, tomando el valor mínimo estimado.`
    : ''

  return `Para finalizar la reserva de ${input.serviceName}, necesitamos una seña de ${formattedAmount}.${calculationDetail}\n\nEnviá el comprobante de pago por acá. Si todavía no tenés los datos de pago, el equipo te los compartirá. Después revisará el comprobante y te confirmará el turno.`
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
