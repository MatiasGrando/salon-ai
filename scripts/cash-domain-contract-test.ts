import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CashDomainError,
  assertEntryAmount,
  assertMoney,
  assertIanaTimezone,
  calculateAccountTotals,
  createReversal,
  isInstantWithinRegisterDay,
  localDateKey,
  resolveRegisterOpeningCash,
  signedAmount,
  summarizeCashRegister
} from '../src/services/cash-domain.js'

function expectDomainError(code: string, action: () => unknown) {
  assert.throws(action, (error: unknown) => error instanceof CashDomainError && error.code === code)
}

assert.equal(assertMoney(0), 0)
assert.equal(assertMoney(125_000), 125_000)
expectDomainError('INVALID_MONEY_AMOUNT', () => assertMoney(-1))
expectDomainError('INVALID_MONEY_AMOUNT', () => assertMoney(10.5))
assert.equal(assertEntryAmount(1), 1)
expectDomainError('INVALID_ENTRY_AMOUNT', () => assertEntryAmount(0))
expectDomainError('INVALID_ENTRY_AMOUNT', () => signedAmount({ amount: 0, direction: 'INFLOW' }))

assert.deepEqual(calculateAccountTotals({
  agreedAmount: 100_000,
  discountAmount: 10_000,
  entries: [
    { type: 'PAYMENT', direction: 'INFLOW', amount: 20_000 },
    { type: 'LEGACY_PAYMENT', direction: 'INFLOW', amount: 5_000 }
  ]
}), {
  agreedAmount: 100_000,
  discountAmount: 10_000,
  finalAmount: 90_000,
  paidAmount: 25_000,
  balanceAmount: 65_000
})
assert.deepEqual(calculateAccountTotals({
  agreedAmount: 25_000,
  discountAmount: 0,
  entries: [
    { type: 'PAYMENT', direction: 'INFLOW', amount: 25_000 },
    { type: 'REVERSAL', direction: 'OUTFLOW', amount: 5_000, reversedEntryType: 'PAYMENT' }
  ]
}), {
  agreedAmount: 25_000,
  discountAmount: 0,
  finalAmount: 25_000,
  paidAmount: 20_000,
  balanceAmount: 5_000
})
expectDomainError('DISCOUNT_EXCEEDS_AGREED_AMOUNT', () => calculateAccountTotals({
  agreedAmount: 10_000,
  discountAmount: 10_001,
  entries: []
}))
expectDomainError('OVERPAYMENT', () => calculateAccountTotals({
  agreedAmount: 100_000,
  discountAmount: 15_000,
  entries: [{ type: 'PAYMENT', direction: 'INFLOW', amount: 90_000 }]
}))

assert.equal(signedAmount({ amount: 8_000, direction: 'INFLOW' }), 8_000)
assert.equal(signedAmount({ amount: 8_000, direction: 'OUTFLOW' }), -8_000)
assert.deepEqual(createReversal({
  id: 'payment-1',
  type: 'PAYMENT',
  direction: 'INFLOW',
  amount: 12_000,
  method: 'CASH'
}), {
  type: 'REVERSAL',
  direction: 'OUTFLOW',
  amount: 12_000,
  method: 'CASH',
  reversesEntryId: 'payment-1',
  reversedEntryType: 'PAYMENT'
})

const summary = summarizeCashRegister({
  openingCash: 75_000,
  entries: [
    { type: 'PAYMENT', direction: 'INFLOW', amount: 60_000, method: 'CASH' },
    { type: 'PAYMENT', direction: 'INFLOW', amount: 48_500, method: 'TRANSFER' },
    { type: 'PAYMENT', direction: 'INFLOW', amount: 33_000, method: 'CARD' },
    { type: 'REFUND', direction: 'OUTFLOW', amount: 5_000, method: 'TRANSFER' },
    { type: 'EXPENSE', direction: 'OUTFLOW', amount: 8_200, method: 'CASH' },
    { type: 'WITHDRAWAL', direction: 'OUTFLOW', amount: 15_000, method: 'CASH' },
    { type: 'CASH_IN', direction: 'INFLOW', amount: 1_000, method: 'CASH' },
    { type: 'ADJUSTMENT', direction: 'OUTFLOW', amount: 300, method: 'CASH' },
    {
      type: 'REVERSAL',
      direction: 'OUTFLOW',
      amount: 1_000,
      method: 'CASH',
      reversedEntryType: 'PAYMENT'
    },
    {
      type: 'REVERSAL',
      direction: 'INFLOW',
      amount: 1_200,
      method: 'CASH',
      reversedEntryType: 'EXPENSE'
    }
  ]
})

assert.deepEqual(summary, {
  grossCollected: 140_500,
  collectedByMethod: { CASH: 59_000, TRANSFER: 48_500, CARD: 33_000 },
  refunds: 5_000,
  expenses: 7_000,
  withdrawals: 15_000,
  cashIn: 1_000,
  adjustments: -300,
  net: 128_500,
  expectedCash: 112_700
})

const electronicOnly = summarizeCashRegister({
  openingCash: 20_000,
  entries: [
    { type: 'PAYMENT', direction: 'INFLOW', amount: 12_000, method: 'TRANSFER' },
    { type: 'EXPENSE', direction: 'OUTFLOW', amount: 2_000, method: 'CARD' }
  ]
})
assert.equal(electronicOnly.expectedCash, 20_000)
assert.equal(electronicOnly.net, 10_000)

assert.equal(assertIanaTimezone(' America/Argentina/Buenos_Aires '), 'America/Argentina/Buenos_Aires')
assert.equal(assertIanaTimezone('UTC'), 'UTC')
expectDomainError('BUSINESS_TIMEZONE_REQUIRED', () => assertIanaTimezone(null))
expectDomainError('INVALID_BUSINESS_TIMEZONE', () => assertIanaTimezone('Buenos Aires'))

const saturdayLate = new Date('2026-09-06T02:30:00.000Z')
assert.equal(localDateKey(saturdayLate, 'America/Argentina/Buenos_Aires'), '2026-09-05')
assert.equal(localDateKey(saturdayLate, 'Europe/Madrid'), '2026-09-06')

const openedAt = new Date('2026-09-05T12:00:00.000Z')
const closedAt = new Date('2026-09-06T05:30:00.000Z')
assert.equal(isInstantWithinRegisterDay(new Date('2026-09-06T03:00:00.000Z'), { openedAt, closedAt }), true)
assert.equal(isInstantWithinRegisterDay(new Date('2026-09-06T06:00:00.000Z'), { openedAt, closedAt }), false)
assert.equal(isInstantWithinRegisterDay(new Date('2026-09-07T03:00:00.000Z'), { openedAt, closedAt: null }), true)

assert.equal(resolveRegisterOpeningCash({ previousExpectedCash: 75_000, firstOpeningCash: null }), 75_000)
assert.equal(resolveRegisterOpeningCash({ previousExpectedCash: null, firstOpeningCash: 12_000 }), 12_000)
expectDomainError('OPENING_CASH_REQUIRED', () => resolveRegisterOpeningCash({
  previousExpectedCash: null,
  firstOpeningCash: null
}))

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schema, /model Business \{[\s\S]*?timezone\s+String\?/)
const migration = readFileSync(new URL('../prisma/migrations/20260905190000_add_business_timezone/migration.sql', import.meta.url), 'utf8')
assert.match(migration, /ADD COLUMN "timezone" TEXT/)
assert.match(migration, /BusinessBotOptionsSettings/)
assert.doesNotMatch(migration, /DEFAULT\s+'America\//)

const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
assert.match(businessRoute, /timezone\?: string \| null/)
assert.match(businessRoute, /assertIanaTimezone\(body\.timezone\)/)
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.match(crmUi, /id="business-timezone"/)
assert.match(crmUi, /timezoneChanged/)

console.log('cash domain contract tests passed')
