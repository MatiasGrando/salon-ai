import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAppointmentFinanceSummaries } from '../src/services/appointment-finance-summary.js'
import { CashService } from '../src/services/cash-service.js'

const appointments = [
  {
    id: 'linked-a',
    visitId: null,
    coordinationGroupId: null,
    quotedPrice: 50_000,
    manualDepositPaid: false,
    manualDepositAmount: null,
    visit: null,
    service: { price: 50_000, priceMode: 'FIXED' as const },
    serviceItems: [],
    accountLink: null
  },
  {
    id: 'manual-unlinked',
    visitId: null,
    coordinationGroupId: null,
    quotedPrice: null,
    manualDepositPaid: true,
    manualDepositAmount: 10_000,
    visit: null,
    service: { price: 40_000, priceMode: 'FIXED' as const },
    serviceItems: [],
    accountLink: null
  },
  {
    id: 'group-one',
    visitId: null,
    coordinationGroupId: 'web-group',
    quotedPrice: 30_000,
    manualDepositPaid: false,
    manualDepositAmount: null,
    visit: null,
    service: { price: 30_000, priceMode: 'FIXED' as const },
    serviceItems: [],
    accountLink: null
  },
  {
    id: 'group-two',
    visitId: null,
    coordinationGroupId: 'web-group',
    quotedPrice: 20_000,
    manualDepositPaid: false,
    manualDepositAmount: null,
    visit: null,
    service: { price: 20_000, priceMode: 'FIXED' as const },
    serviceItems: [],
    accountLink: null
  }
]

const summaries = buildAppointmentFinanceSummaries(appointments, [{
  appointmentId: 'linked-a',
  accountId: 'account-a',
  pricingMode: 'FIXED',
  agreedAmount: 50_000,
  discountAmount: 5_000,
  finalAmount: 45_000,
  paidAmount: 20_000,
  balanceAmount: 25_000
}])
assert.deepEqual(summaries.get('linked-a'), {
  accountId: 'account-a',
  pricingMode: 'FIXED',
  agreedAmount: 50_000,
  discountAmount: 5_000,
  finalAmount: 45_000,
  paidAmount: 20_000,
  balanceAmount: 25_000
})
assert.deepEqual(summaries.get('manual-unlinked'), {
  accountId: null,
  pricingMode: 'FIXED',
  agreedAmount: 40_000,
  discountAmount: 0,
  finalAmount: 40_000,
  paidAmount: 10_000,
  balanceAmount: 30_000
})
assert.equal(summaries.get('group-one')?.agreedAmount, 50_000)
assert.equal(summaries.get('group-two')?.agreedAmount, 50_000)

const cashService = new CashService({
  transaction: async (work) => work({
    listAppointmentFinanceSummaryRows: async () => [{
      appointmentId: 'linked-a',
      accountId: 'account-a',
      pricingMode: 'FIXED',
      agreedAmount: 50_000,
      discountAmount: 5_000,
      paidAmount: 20_000
    }]
  } as never)
})
assert.deepEqual(await cashService.listAppointmentFinanceSummaries({
  businessId: 'business-a',
  appointmentIds: ['linked-a']
}), [{
  appointmentId: 'linked-a',
  accountId: 'account-a',
  pricingMode: 'FIXED',
  agreedAmount: 50_000,
  discountAmount: 5_000,
  finalAmount: 45_000,
  paidAmount: 20_000,
  balanceAmount: 25_000
}])

const repositorySource = readFileSync(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
const appointmentServiceSource = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
assert.match(repositorySource, /listAppointmentFinanceSummaryRows[\s\S]*?coalesce\(sum\(/, 'el resumen debe agregarse en PostgreSQL')
assert.doesNotMatch(appointmentServiceSource, /includeFinanceSummary[\s\S]{0,1800}cashEntries/, 'Agenda no debe descargar el historial de movimientos')

console.log('OK resumen financiero de Agenda: cuentas, señas legacy y grupos.')
