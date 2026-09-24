import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CashService } from '../src/services/cash-service.js'
const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = readFileSync('prisma/migrations/20260923050000_cash_expense_subcategories/migration.sql', 'utf8')
const routes = readFileSync('src/routes/cash-register.ts', 'utf8')
const serviceSource = readFileSync('src/services/cash-service.ts', 'utf8')
const repo = readFileSync('src/repositories/prisma-cash-repository.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
for (const token of ['model CashExpenseSubcategory', 'expenseSubcategoryId']) assert.ok(schema.includes(token), `esquema sin ${token}`)
for (const token of ['CREATE TABLE "CashExpenseSubcategory"', '"expenseSubcategoryId"', 'FOREIGN KEY ("businessId", "expenseCategoryId", "expenseSubcategoryId")']) assert.ok(migration.includes(token), `migracion sin ${token}`)
for (const token of ['/cash-register/expense-subcategories', 'subcategoryId']) assert.ok(routes.includes(token), `ruta sin ${token}`)
for (const token of ['listExpenseSubcategories', 'createExpenseSubcategory', 'EXPENSE_SUBCATEGORY_CATEGORY_MISMATCH']) assert.ok(serviceSource.includes(token), `servicio sin ${token}`)
for (const token of ['findExpenseSubcategory', 'expenseSubcategoryId', 'expenseSubcategoryName']) assert.ok(repo.includes(token), `repo sin ${token}`)
for (const token of ['cash-operation-subcategory', 'cash-period-subcategory-filter', 'cash-expense-subcategory-new']) assert.ok(ui.includes(token), `UI sin ${token}`)
const writes: Array<Record<string, unknown>> = []
const tx = {
  lockBusiness: async () => ({ businessId: 'shop', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date() }),
  findOpenDay: async () => ({ id: 'day', businessId: 'shop' }),
  findOpenSession: async () => ({ id: 'session', businessId: 'shop' }),
  ensureDefaultExpenseCategory: async () => ({ id: 'other', isActive: true }),
  findExpenseCategory: async () => ({ id: 'services', isActive: true }),
  findExpenseSubcategory: async (_businessId: string, subcategoryId: string) => subcategoryId === 'unknown' ? null : ({ id: subcategoryId, categoryId: subcategoryId === 'foreign-category' ? 'other' : 'services', isActive: subcategoryId !== 'paused' }),
  insertCashOperation: async (input: Record<string, unknown>) => { writes.push(input); return input }
}
const service = new CashService({ transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx) } as never)
const expense = { businessId: 'shop', cashSessionId: 'session', type: 'EXPENSE' as const, amount: 1000, method: 'CASH' as const, description: 'Luz', categoryId: 'services' }
await service.recordCashOperation({ ...expense, subcategoryId: 'electricity' })
assert.equal(writes.at(-1)?.expenseCategoryId, 'services')
assert.equal(writes.at(-1)?.expenseSubcategoryId, 'electricity')
for (const [subcategoryId, code] of [['foreign-category', 'EXPENSE_SUBCATEGORY_CATEGORY_MISMATCH'], ['paused', 'EXPENSE_SUBCATEGORY_INACTIVE'], ['unknown', 'EXPENSE_SUBCATEGORY_NOT_FOUND']] as const) {
  await assert.rejects(service.recordCashOperation({ ...expense, subcategoryId }), { code })
}
assert.equal(writes.length, 1, 'las subcategorias invalidas no deben registrar gastos')
console.log('OK subcategorias: esquema, API, validacion, filtros e interfaz.')
