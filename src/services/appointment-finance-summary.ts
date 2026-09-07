import { calculateAccountTotals } from './cash-domain.js'

type PriceMode = 'FIXED' | 'STARTING_AT'

export type AppointmentFinanceSummary = {
  accountId: string | null
  pricingMode: 'FIXED' | 'ESTIMATED'
  agreedAmount: number
  discountAmount: number
  finalAmount: number
  paidAmount: number
  balanceAmount: number
}

export type LinkedAppointmentFinanceSummary = AppointmentFinanceSummary & {
  appointmentId: string
}

export type AppointmentFinanceSummarySource = {
  id: string
  visitId: string | null
  coordinationGroupId: string | null
  quotedPrice: number | null
  manualDepositPaid: boolean
  manualDepositAmount: number | null
  visit: { totalPrice: number | null } | null
  service: { price: number | null; priceMode: PriceMode }
  serviceItems: Array<{
    price?: number | null
    service: { price?: number | null; priceMode: PriceMode }
  }>
  accountLink?: unknown
}

export function buildAppointmentFinanceSummaries(
  appointments: AppointmentFinanceSummarySource[],
  linkedSummaries: LinkedAppointmentFinanceSummary[] = []
) {
  const summaries = new Map<string, AppointmentFinanceSummary>(
    linkedSummaries.map(({ appointmentId, ...summary }) => [appointmentId, summary])
  )
  const fallbackGroups = new Map<string, AppointmentFinanceSummarySource[]>()

  for (const appointment of appointments) {
    if (summaries.has(appointment.id)) continue

    const groupKey = fallbackGroupKey(appointment)
    const group = fallbackGroups.get(groupKey) ?? []
    group.push(appointment)
    fallbackGroups.set(groupKey, group)
  }

  for (const group of fallbackGroups.values()) {
    const agreedAmount = fallbackGroupAmount(group)
    if (agreedAmount === null) continue
    const paidAmount = group.reduce((total, appointment) => (
      total + (appointment.manualDepositPaid && Number.isSafeInteger(appointment.manualDepositAmount)
        ? Math.max(0, appointment.manualDepositAmount ?? 0)
        : 0)
    ), 0)
    if (paidAmount > agreedAmount) continue
    const pricingMode = group.some(isEstimatedAppointment) ? 'ESTIMATED' as const : 'FIXED' as const
    const summary: AppointmentFinanceSummary = {
      accountId: null,
      pricingMode,
      ...calculateAccountTotals({
        agreedAmount,
        discountAmount: 0,
        entries: paidAmount > 0
          ? [{ type: 'LEGACY_PAYMENT', direction: 'INFLOW', amount: paidAmount }]
          : []
      })
    }
    for (const appointment of group) summaries.set(appointment.id, summary)
  }

  return summaries
}

function fallbackGroupKey(appointment: AppointmentFinanceSummarySource) {
  if (appointment.visitId) return `visit:${appointment.visitId}`
  if (appointment.coordinationGroupId) return `coordination:${appointment.coordinationGroupId}`
  return `appointment:${appointment.id}`
}

function fallbackGroupAmount(group: AppointmentFinanceSummarySource[]) {
  const visitTotal = group.find((appointment) => appointment.visitId)?.visit?.totalPrice
  if (visitTotal !== null && visitTotal !== undefined) return visitTotal
  const amounts = group.map(fallbackAppointmentAmount)
  return amounts.every((amount): amount is number => amount !== null)
    ? amounts.reduce((total, amount) => total + amount, 0)
    : null
}

function fallbackAppointmentAmount(appointment: AppointmentFinanceSummarySource) {
  if (appointment.quotedPrice !== null) return appointment.quotedPrice
  if (appointment.serviceItems.length > 0) {
    const prices = appointment.serviceItems.map((item) => item.price ?? item.service.price ?? null)
    return prices.every((price): price is number => price !== null)
      ? prices.reduce((total, price) => total + price, 0)
      : null
  }
  return appointment.service.price
}

function isEstimatedAppointment(appointment: AppointmentFinanceSummarySource) {
  return appointment.service.priceMode === 'STARTING_AT'
    || appointment.serviceItems.some((item) => item.service.priceMode === 'STARTING_AT')
}
