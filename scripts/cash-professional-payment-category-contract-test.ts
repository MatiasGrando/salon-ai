import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordCashProfessionalPayment } from '../src/routes/professional-settlements.js'

const migration = readFileSync(new URL('../prisma/migrations/20260919210000_add_cash_expense_categories/migration.sql', import.meta.url), 'utf8')
assert.match(migration, /"type" = 'EXPENSE' AND "expenseCategoryId" IS NOT NULL/)

const input = {
  businessId: 'shop', professionalId: 'pro', cashSessionId: 'session',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
  amount: 3000, method: 'CASH' as const, type: 'PAYMENT' as const,
  observation: 'Prueba', actorUserId: 'admin', actorName: 'Dueña'
}
function fake(options: { treasuryEnabled?: boolean; expectedCash?: number; existing?: boolean } = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  const tx = {
    $queryRaw: async (query: { sql: string }) => {
      if (query.sql.includes('FROM "Business"')) return [{ id: 'shop' }]
      if (query.sql.includes('FROM "TreasuryMovement"')) return options.existing ? [{
        id: input.idempotencyKey, businessId: 'shop', kind: 'PROFESSIONAL_PAYMENT', amount: 3000,
        entryId: 'entry', professionalId: 'pro', entryType: 'PAYMENT', observation: 'Prueba', cashSessionId: 'session'
      }] : []
      if (query.sql.includes('FROM "TreasuryAccount"')) return options.treasuryEnabled === false ? [] : [{ id: 'reserve' }]
      if (query.sql.includes('FROM "CashSession"')) return [{ id: 'session', registerDayId: 'day', openingCash: options.expectedCash ?? 5000 }]
      if (query.sql.includes('FROM "Professional"')) return [{ name: 'Gaspar' }]
      if (query.sql.includes('FROM "CashExpenseCategory"')) return [{ id: 'liquidaciones', isActive: true }]
      throw new Error('Consulta inesperada: ' + query.sql)
    },
    cashEntry: { findMany: async () => [] },
    $executeRaw: async (query: { sql: string; values: unknown[] }) => { writes.push(query); return 1 }
  }
  return { tx, writes }
}
const happy = fake()
const result = await recordCashProfessionalPayment(happy.tx as never, input)
assert.ok(result.cashEntryId)
assert.equal(happy.writes.length, 5, 'categoría, retiro, ingreso interno, pago y débito deben ser atómicos')
assert.match(happy.writes[0]!.sql, /"CashExpenseCategory"/)
assert.match(happy.writes[1]!.sql, /"CashEntry"/)
assert.match(happy.writes[1]!.sql, /'WITHDRAWAL'/)
assert.ok(!happy.writes[1]!.sql.includes('expenseCategoryId'), 'el traspaso no es gasto de Caja')
assert.match(happy.writes[1]!.sql, /'Tesorería'/)
assert.match(happy.writes[2]!.sql, /'DAILY_TRANSFER'/)
assert.ok(happy.writes[3]!.values.includes('PROFESSIONAL_PAYMENT'))
assert.ok(happy.writes[3]!.values.includes('liquidaciones'))
assert.match(happy.writes[4]!.sql, /"ProfessionalAccountEntry"/)
assert.ok(happy.writes[4]!.values.includes(result.treasuryMovementId))
assert.ok(!happy.writes.some((write) => write.values.includes('Otros')))

const retry = fake({ existing: true })
const repeated = await recordCashProfessionalPayment(retry.tx as never, input)
assert.equal(repeated.id, 'entry')
assert.equal(retry.writes.length, 0, 'el reintento no debe duplicar dinero')
const noReserve = fake({ treasuryEnabled: false })
await assert.rejects(recordCashProfessionalPayment(noReserve.tx as never, input), /TREASURY_NOT_ENABLED/)
assert.equal(noReserve.writes.length, 0)
const noCash = fake({ expectedCash: 1000 })
await assert.rejects(recordCashProfessionalPayment(noCash.tx as never, input), /INSUFFICIENT_CASH/)
assert.equal(noCash.writes.length, 0)

const digitalWrites: Array<{ sql: string; values: unknown[] }> = []
let digitalExisting = false
const digitalTx = {
  $queryRaw: async (query: { sql: string }) => {
    if (query.sql.includes('FROM "Business"')) return [{ id: 'shop' }]
    if (query.sql.includes('FROM "CashEntry" cash')) return digitalExisting ? [{ id: input.idempotencyKey, businessId: 'shop', cashSessionId: 'session', amount: 3000, paymentMethod: 'TRANSFER', entryId: 'digital-entry', professionalId: 'pro', entryType: 'PAYMENT', observation: 'Prueba' }] : []
    if (query.sql.includes('FROM "CashSession"')) return [{ registerDayId: 'day' }]
    if (query.sql.includes('FROM "Professional"')) return [{ name: 'Gaspar' }]
    if (query.sql.includes('FROM "CashExpenseCategory"')) return [{ id: 'liquidaciones', isActive: true }]
    throw new Error('Consulta inesperada: ' + query.sql)
  },
  $executeRaw: async (query: { sql: string; values: unknown[] }) => { digitalWrites.push(query); return 1 }
}
await recordCashProfessionalPayment(digitalTx as never, { ...input, method: 'TRANSFER' })
assert.equal(digitalWrites.length, 3)
assert.match(digitalWrites[0]!.sql, /"CashExpenseCategory"/)
assert.match(digitalWrites[1]!.sql, /"expenseCategoryId"/)
assert.ok(digitalWrites[1]!.values.includes('liquidaciones'))
assert.ok(!digitalWrites.some((write) => write.sql.includes('"TreasuryMovement"')), 'transferencia no es efectivo reservado')
digitalExisting = true
const digitalRetry = await recordCashProfessionalPayment(digitalTx as never, { ...input, method: 'TRANSFER' })
assert.equal(digitalRetry.id, 'digital-entry')
assert.equal(digitalWrites.length, 3, 'el reintento digital tampoco debe duplicar el pago')
const treasuryRoute = readFileSync(new URL('../src/routes/treasury.ts', import.meta.url), 'utf8')
const cashUi = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(treasuryRoute, /query\.kind[\s\S]*movement\."kind"/)
assert.match(treasuryRoute, /query\.search[\s\S]*movement\."description" ILIKE/)
assert.match(cashUi, /cash-treasury-filter-kind/)
assert.match(cashUi, /cash-treasury-filter-search/)
assert.match(cashUi, /idempotencyKey: form\.dataset\.key, cashSessionId/)
console.log('OK pago profesional desde Caja: transferencia interna y egreso privado, categoría digital e idempotencia')
