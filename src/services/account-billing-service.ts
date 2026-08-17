import { prisma } from '../config/prisma.js'

export type AccountDiscountInput = {
  type: 'PERCENTAGE' | 'FIXED'
  value: number
  until: Date
  reason?: string | null
} | null

export function nextAccountBillingDate(after: Date, billingDay: 1 | 15) {
  const candidate = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), billingDay, 0))
  if (candidate.getTime() <= after.getTime()) {
    return new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, billingDay, 0))
  }
  return candidate
}

export async function initializeAccountBilling(businessId: string, billingDay: 1 | 15, activatedAt = new Date()) {
  const existing = await prisma.businessBillingSettings.findUnique({ where: { businessId }, select: { activatedAt: true } })
  return prisma.businessBillingSettings.upsert({
    where: { businessId },
    create: {
      businessId,
      billingDay,
      activatedAt,
      nextBillingAt: nextAccountBillingDate(activatedAt, billingDay)
    },
    update: {
      billingDay,
      activatedAt: existing?.activatedAt || activatedAt,
      nextBillingAt: nextAccountBillingDate(activatedAt, billingDay)
    }
  })
}

export async function ensureAccountCharges(now = new Date()) {
  const accounts = await prisma.business.findMany({
    where: {
      isDemo: false,
      accountStatus: 'ACTIVE',
      billingSettings: { is: { activatedAt: { not: null }, nextBillingAt: { lte: now } } }
    },
    select: {
      id: true,
      plan: { select: { name: true, price: true } },
      billingSettings: true
    }
  })

  for (const account of accounts) {
    const settings = account.billingSettings
    if (!settings?.nextBillingAt || !account.plan) continue
    let dueAt = settings.nextBillingAt
    let generated = 0
    while (dueAt.getTime() <= now.getTime() && generated < 120) {
      const grossAmount = money(Number(account.plan.price))
      const discountAmount = calculateDiscount(grossAmount, dueAt, settings)
      const period = accountChargePeriod(dueAt)
      await prisma.businessAccountCharge.upsert({
        where: { businessId_period: { businessId: account.id, period } },
        create: {
          businessId: account.id,
          period,
          planName: account.plan.name,
          grossAmount,
          discountAmount,
          netAmount: money(grossAmount - discountAmount),
          dueAt,
          originalDueAt: dueAt
        },
        update: {}
      })
      dueAt = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth() + 1, settings.billingDay, 0))
      generated += 1
    }
    await prisma.businessBillingSettings.update({
      where: { businessId: account.id },
      data: { nextBillingAt: dueAt }
    })
  }
}

export function accountChargePeriod(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function parseBillingMonth(value?: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '')
  const now = new Date()
  const year = match ? Number(match[1]) : now.getUTCFullYear()
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1
  if (month < 1 || month > 12) return parseBillingMonth()
  return {
    value: `${year}-${String(month).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month - 1, 1, 0)),
    end: new Date(Date.UTC(year, month, 1, 0))
  }
}

export function serializeAccountCharge(charge: {
  id: string
  period: string
  planName: string
  grossAmount: unknown
  discountAmount: unknown
  netAmount: unknown
  dueAt: Date
  originalDueAt: Date
  status: string
  paidAt: Date | null
  paymentMethod: string | null
  paymentReference: string | null
  paymentNote: string | null
  paymentRecordedBy: string | null
  bonifiedAt: Date | null
  bonificationReason: string | null
  bonifiedBy: string | null
  dueDateChangedBy: string | null
  dueDateChangeReason: string | null
}) {
  const dueDayEnd = Date.UTC(charge.dueAt.getUTCFullYear(), charge.dueAt.getUTCMonth(), charge.dueAt.getUTCDate() + 1, 0)
  const effectiveStatus = charge.status === 'PENDING' && dueDayEnd <= Date.now()
    ? 'OVERDUE'
    : charge.status
  return {
    ...charge,
    grossAmount: Number(charge.grossAmount),
    discountAmount: Number(charge.discountAmount),
    netAmount: Number(charge.netAmount),
    effectiveStatus
  }
}

function calculateDiscount(grossAmount: number, dueAt: Date, settings: {
  discountType: string | null
  discountValue: unknown
  discountUntil: Date | null
}) {
  if (!settings.discountType || settings.discountValue == null || !settings.discountUntil) return 0
  if (dueAt.getTime() > settings.discountUntil.getTime()) return 0
  const value = Number(settings.discountValue)
  if (settings.discountType === 'PERCENTAGE') return money(Math.min(grossAmount, grossAmount * value / 100))
  return money(Math.min(grossAmount, value))
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
