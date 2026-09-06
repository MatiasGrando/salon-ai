export type CashDirection = 'INFLOW' | 'OUTFLOW'
export type CashPaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'UNSPECIFIED'
export type CashEntryType =
  | 'PAYMENT'
  | 'LEGACY_PAYMENT'
  | 'EXPENSE'
  | 'WITHDRAWAL'
  | 'CASH_IN'
  | 'ADJUSTMENT'
  | 'REFUND'
  | 'REVERSAL'

export type CashDomainEntry = {
  type: CashEntryType
  direction: CashDirection
  amount: number
  method?: CashPaymentMethod
  reversedEntryType?: CashEntryType
}

export class CashDomainError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'CashDomainError'
  }
}

export function assertMoney(value: number, code = 'INVALID_MONEY_AMOUNT') {
  if (!Number.isSafeInteger(value) || value < 0) throw new CashDomainError(code)
  return value
}

export function assertEntryAmount(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CashDomainError('INVALID_ENTRY_AMOUNT')
  }
  return value
}

export function assertIanaTimezone(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CashDomainError('BUSINESS_TIMEZONE_REQUIRED')
  }
  const timezone = value.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0))
  } catch {
    throw new CashDomainError('INVALID_BUSINESS_TIMEZONE')
  }
  return timezone
}

export function localDateKey(instant: Date, timezone: string) {
  const canonicalTimezone = assertIanaTimezone(timezone)
  if (Number.isNaN(instant.getTime())) throw new CashDomainError('INVALID_INSTANT')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: canonicalTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new CashDomainError('INVALID_INSTANT')
  return `${year}-${month}-${day}`
}

export function isInstantWithinRegisterDay(
  instant: Date,
  registerDay: { openedAt: Date; closedAt: Date | null }
) {
  const timestamp = instant.getTime()
  const openedAt = registerDay.openedAt.getTime()
  const closedAt = registerDay.closedAt?.getTime()
  if ([timestamp, openedAt, closedAt].some((value) => value !== undefined && Number.isNaN(value))) {
    throw new CashDomainError('INVALID_INSTANT')
  }
  return timestamp >= openedAt && (closedAt === undefined || timestamp < closedAt)
}

export function resolveRegisterOpeningCash(input: {
  previousExpectedCash: number | null
  firstOpeningCash: number | null
}) {
  if (input.previousExpectedCash !== null) return assertMoney(input.previousExpectedCash)
  if (input.firstOpeningCash !== null) return assertMoney(input.firstOpeningCash)
  throw new CashDomainError('OPENING_CASH_REQUIRED')
}

export function signedAmount(entry: Pick<CashDomainEntry, 'amount' | 'direction'>) {
  const amount = assertEntryAmount(entry.amount)
  return entry.direction === 'INFLOW' ? amount : -amount
}

export function calculateAccountTotals(input: {
  agreedAmount: number
  discountAmount: number
  entries: CashDomainEntry[]
}) {
  const agreedAmount = assertMoney(input.agreedAmount)
  const discountAmount = assertMoney(input.discountAmount)
  if (discountAmount > agreedAmount) throw new CashDomainError('DISCOUNT_EXCEEDS_AGREED_AMOUNT')

  const finalAmount = agreedAmount - discountAmount
  const paidAmount = input.entries.reduce((total, entry) => {
    const appliesToPayment = entry.type === 'PAYMENT'
      || entry.type === 'LEGACY_PAYMENT'
      || (entry.type === 'REVERSAL'
        && (entry.reversedEntryType === 'PAYMENT' || entry.reversedEntryType === 'LEGACY_PAYMENT'))
    return appliesToPayment ? total + signedAmount(entry) : total
  }, 0)

  if (paidAmount < 0) throw new CashDomainError('PAYMENT_TOTAL_BELOW_ZERO')
  if (paidAmount > finalAmount) throw new CashDomainError('OVERPAYMENT')

  return {
    agreedAmount,
    discountAmount,
    finalAmount,
    paidAmount,
    balanceAmount: finalAmount - paidAmount
  }
}

export function createReversal(entry: CashDomainEntry & { id: string }) {
  return {
    type: 'REVERSAL' as const,
    direction: entry.direction === 'INFLOW' ? 'OUTFLOW' as const : 'INFLOW' as const,
    amount: assertEntryAmount(entry.amount),
    ...(entry.method ? { method: entry.method } : {}),
    reversesEntryId: entry.id,
    reversedEntryType: entry.type
  }
}

export function summarizeCashRegister(input: {
  openingCash: number
  entries: CashDomainEntry[]
}) {
  const openingCash = assertMoney(input.openingCash)
  const collectedByMethod = { CASH: 0, TRANSFER: 0, CARD: 0 }
  let grossCollected = 0
  let refunds = 0
  let expenses = 0
  let withdrawals = 0
  let cashIn = 0
  let adjustments = 0
  let cashDelta = 0

  for (const entry of input.entries) {
    const signed = signedAmount(entry)
    const reversedType = entry.type === 'REVERSAL' ? entry.reversedEntryType : undefined
    const effectiveType = reversedType ?? entry.type

    if (effectiveType === 'PAYMENT') {
      grossCollected += signed
      if (entry.method && entry.method !== 'UNSPECIFIED') collectedByMethod[entry.method] += signed
    }
    if (effectiveType === 'REFUND') refunds -= signed
    if (effectiveType === 'EXPENSE') expenses -= signed
    if (effectiveType === 'WITHDRAWAL') withdrawals -= signed
    if (effectiveType === 'CASH_IN') cashIn += signed
    if (effectiveType === 'ADJUSTMENT') adjustments += signed

    if (entry.method === 'CASH' && [
      'PAYMENT',
      'REFUND',
      'EXPENSE',
      'WITHDRAWAL',
      'CASH_IN',
      'ADJUSTMENT'
    ].includes(effectiveType)) {
      cashDelta += signed
    }
  }

  return {
    grossCollected,
    collectedByMethod,
    refunds,
    expenses,
    withdrawals,
    cashIn,
    adjustments,
    net: grossCollected - refunds - expenses,
    expectedCash: openingCash + cashDelta
  }
}
