import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordTreasuryOutflow } from '../src/routes/treasury.js'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = readFileSync('prisma/migrations/20260923070000_treasury_expense_classification/migration.sql', 'utf8')
const route = readFileSync('src/routes/treasury.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
for (const name of ['expenseCategoryId', 'expenseSubcategoryId', 'counterparty']) {
  assert.ok(schema.includes(name), `falta ${name} en modelo`)
  assert.ok(migration.includes(name), `falta ${name} en migración`)
  assert.ok(route.includes(name), `falta ${name} en ruta`)
}
assert.match(migration, /FOREIGN KEY \(\"businessId\", \"expenseCategoryId\", \"expenseSubcategoryId\"\)/)
assert.ok(route.includes("typeof body.description === 'string' ? body.description.trim()"), 'un JSON malformado no debe lanzar TypeError antes del 400')
for (const name of ['cash-treasury-outflow-category', 'cash-treasury-outflow-subcategory', 'cash-treasury-outflow-counterparty', 'cash-treasury-filter-category']) assert.ok(ui.includes(name), `falta ${name} en UI`)
const input = { businessId: 'shop', accountId: 'reserve', kind: 'EXPENSE' as const, amount: 5000, description: 'Factura septiembre', counterpartyId: 'provider', expenseCategoryId: 'services', expenseSubcategoryId: 'light', effectiveAt: new Date('2026-09-25T15:00:00.000Z'), effectiveDate: '2026-09-25', idempotencyKey: '12345678-1234-1234-1234-123456789abc', actorUserId: 'owner', actorName: 'Dueña' }
function fake(existing: Record<string, unknown> | null = null, categoryActive = true, subcategoryActive = true, balance = 6000n) {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  const tx = {
    $queryRaw: async (query: { sql: string }) => {
      if (query.sql.includes('FROM "Business"')) return [{ id: 'shop' }]
      if (query.sql.includes('FROM "TreasuryMovement" movement JOIN "Business" business')) return existing ? [existing] : []
      if (query.sql.includes('FROM "TreasuryAccount"')) return [{ id: 'reserve', kind: 'CASH', movementBalance: balance, entryBalance: 0n }]
      if (query.sql.includes('FROM "TreasuryCounterparty"')) return [{ name: 'Proveedor' }]
      if (query.sql.includes('FROM "CashExpenseCategory"')) return categoryActive ? [{ id: 'services' }] : []
      if (query.sql.includes('FROM "CashExpenseSubcategory"')) return subcategoryActive ? [{ id: 'light' }] : []
      throw new Error('unexpected query: ' + query.sql)
    },
    $executeRaw: async (query: { sql: string; values: unknown[] }) => { writes.push(query); return 1 }
  }
  return { tx, writes }
}
const happy = fake()
const created = await recordTreasuryOutflow(happy.tx as never, input)
assert.equal(created.id, input.idempotencyKey)
assert.equal(happy.writes.length, 1)
assert.ok(happy.writes[0]?.sql.includes('"TreasuryMovement"'))
for (const value of ['services', 'light', 'Proveedor']) assert.ok(happy.writes[0]?.values.includes(value))
assert.ok(!happy.writes[0]?.sql.includes('"CashEntry"'), 'no escribir en Caja diaria')
const incomeInput = { ...input, kind: 'INCOME' as const, amount: 9000, description: 'Aporte del propietario', counterpartyId: null, expenseSubcategoryId: null, idempotencyKey: '22345678-1234-1234-1234-123456789abc' }
const income = fake(null, true, true, 0n)
await recordTreasuryOutflow(income.tx as never, incomeInput)
assert.equal(income.writes.length, 1)
assert.ok(income.writes[0]?.values.includes('INFLOW'), 'el ingreso debe aumentar el saldo aunque la cuenta comience en cero')

const retry = fake({ id: input.idempotencyKey, businessId: 'shop', kind: 'EXPENSE', amount: 5000, description: input.description, accountId: input.accountId, counterpartyId: input.counterpartyId, expenseCategoryId: 'services', expenseSubcategoryId: 'light', effectiveDate: input.effectiveDate })
assert.deepEqual(await recordTreasuryOutflow(retry.tx as never, input), created)
assert.equal(retry.writes.length, 0)
await assert.rejects(recordTreasuryOutflow(fake({ id: input.idempotencyKey, businessId: 'shop', kind: 'EXPENSE', amount: 5000, description: input.description, accountId: input.accountId, counterpartyId: input.counterpartyId, expenseCategoryId: 'services', expenseSubcategoryId: 'light', effectiveDate: input.effectiveDate }).tx as never, { ...input, effectiveDate: '2026-09-24' }), /KEY_CONFLICT/)
await assert.rejects(recordTreasuryOutflow(fake(null, false).tx as never, input), /EXPENSE_CATEGORY_INVALID/)
await assert.rejects(recordTreasuryOutflow(fake(null, true, false).tx as never, input), /EXPENSE_SUBCATEGORY_INVALID/)
const conflict = fake({ id: input.idempotencyKey, businessId: 'shop', kind: 'EXPENSE', amount: 5000, description: input.description, accountId: input.accountId, counterpartyId: input.counterpartyId, expenseCategoryId: 'services', expenseSubcategoryId: 'gas' })
await assert.rejects(recordTreasuryOutflow(conflict.tx as never, input), /KEY_CONFLICT/)
assert.equal(conflict.writes.length, 0)
console.log('OK gastos de Tesorería clasificados, privados e idempotentes')
