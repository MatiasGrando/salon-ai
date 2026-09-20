import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CashService, CashServiceError, normalizeCashPeriodRange } from '../src/services/cash-service.js'

const routesSource = await readFile(new URL('../src/routes/cash-register.ts', import.meta.url), 'utf8')
const repositorySource = await readFile(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
const uiSource = await readFile(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')

assert.match(routesSource, /\/cash-register\/period\/summary/)
assert.match(routesSource, /\/cash-register\/period\/expenses/)
assert.match(repositorySource, /listPeriodEntries/)
assert.match(repositorySource, /listPeriodExpenses/)
assert.match(uiSource, /Jornada y sesiones/)
assert.match(uiSource, /Consultar per(?:&iacute;|í)odo/)
assert.match(uiSource, /M(?:&aacute;|á)ximo 31 d(?:&iacute;|í)as/)
assert.match(uiSource, /Gastos del per(?:&iacute;|í)odo/)
assert.match(uiSource, /cash-period-page-size/)
assert.match(uiSource, /cash-period-previous/)
assert.match(uiSource, /cash-period-next/)

assert.deepEqual(normalizeCashPeriodRange('2026-09-01', '2026-10-01'), {
  from: '2026-09-01', to: '2026-10-01', days: 31
})
for (const [from, to, code] of [
  ['2026-09-01', '2026-10-02', 'CASH_PERIOD_TOO_LONG'],
  ['2026-02-30', '2026-03-01', 'INVALID_CASH_PERIOD'],
  ['2026-09-20', '2026-09-19', 'INVALID_CASH_PERIOD']
] as const) {
  assert.throws(
    () => normalizeCashPeriodRange(from, to),
    (error: unknown) => error instanceof CashServiceError && error.code === code
  )
}

let periodExpenseInput: any = null
const transaction = {
  lockBusiness: async () => ({ businessId: 'business-1', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-20T12:00:00Z') }),
  listPeriodEntries: async () => [
    { type: 'PAYMENT', direction: 'INFLOW', amount: 100_000, method: 'CASH' },
    { type: 'PAYMENT', direction: 'INFLOW', amount: 50_000, method: 'TRANSFER' },
    { type: 'REFUND', direction: 'OUTFLOW', amount: 10_000, method: 'CASH' },
    { type: 'EXPENSE', direction: 'OUTFLOW', amount: 20_000, method: 'CASH', expenseCategoryName: 'Alquiler' },
    { type: 'WITHDRAWAL', direction: 'OUTFLOW', amount: 5_000, method: 'CASH' },
    { type: 'CASH_IN', direction: 'INFLOW', amount: 3_000, method: 'CASH' }
  ],
  findExpenseCategory: async () => ({ id: 'category-1' }),
  listPeriodExpenses: async (input: any) => {
    periodExpenseInput = input
    return [{
      id: 'expense-1', businessId: 'business-1', accountId: null, registerDayId: 'day-1', cashSessionId: 'session-1',
      type: 'EXPENSE', direction: 'OUTFLOW', amount: 20_000, method: 'CASH', origin: 'CASH_REGISTER',
      description: 'Alquiler', counterparty: null, observation: null, reversesEntryId: null,
      effectiveAt: new Date('2026-09-10T12:00:00Z'), expenseCategoryId: 'category-1', expenseCategoryName: 'Alquiler',
      totalCount: 21
    }]
  }
}
const service = new CashService({ transaction: async (work: any) => work(transaction) } as any)
const summary = await service.getCashPeriodSummary({ businessId: 'business-1', from: '2026-09-01', to: '2026-09-30' })
assert.equal(summary.summary.grossCollected, 150_000)
assert.equal(summary.summary.netSales, 140_000)
assert.equal(summary.summary.expenses, 20_000)
assert.equal(summary.summary.operatingResult, 120_000)
assert.equal(summary.summary.withdrawals, 5_000)
assert.equal(summary.summary.cashIn, 3_000)
assert.deepEqual(summary.summary.expenseByCategory, [{ name: 'Alquiler', amount: 20_000 }])

const expenses = await service.listCashPeriodExpenses({
  businessId: 'business-1', from: '2026-09-01', to: '2026-09-30', page: 2, pageSize: 10,
  method: 'CASH', expenseCategoryId: 'category-1', query: 'alquiler'
})
assert.equal(expenses.total, 21)
assert.equal(expenses.totalPages, 3)
assert.equal(expenses.page, 2)
assert.equal(periodExpenseInput.offset, 10)
assert.equal(periodExpenseInput.limit, 10)
assert.equal(periodExpenseInput.timezone, 'America/Argentina/Buenos_Aires')
assert.equal('totalCount' in expenses.entries[0]!, false)

console.log('cash period report contract: OK')