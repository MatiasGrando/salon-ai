import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CashService, CashServiceError } from '../src/services/cash-service.js'

const [schema, migration, routes, service, repository, ui] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260919210000_add_cash_expense_categories/migration.sql', 'utf8'),
  readFile('src/routes/cash-register.ts', 'utf8'),
  readFile('src/services/cash-service.ts', 'utf8'),
  readFile('src/repositories/prisma-cash-repository.ts', 'utf8'),
  readFile('src/routes/crm-ui/cash-register.ts', 'utf8')
])

assert.match(schema, /model CashExpenseCategory \{[\s\S]*businessId\s+String[\s\S]*name\s+String[\s\S]*normalizedName\s+String[\s\S]*position\s+Int[\s\S]*isDefault\s+Boolean[\s\S]*isActive\s+Boolean/)
assert.match(schema, /model CashEntry \{[\s\S]*expenseCategoryId\s+String\?[\s\S]*expenseCategory\s+CashExpenseCategory\?/)
assert.match(migration, /INSERT INTO "CashExpenseCategory"[\s\S]*'Otros'/)
assert.match(migration, /UPDATE "CashEntry"[\s\S]*"expenseCategoryId"[\s\S]*"type" = 'EXPENSE'/)
assert.match(migration, /CREATE UNIQUE INDEX [\s\S]*ON "CashExpenseCategory"\("businessId", "normalizedName"\)/)
assert.match(migration, /CREATE UNIQUE INDEX "CashExpenseCategory_one_default_per_business"[\s\S]*WHERE "isDefault" = true/)
assert.match(migration, /CashEntry_expense_category_only_for_expense_check/)
assert.match(routes, /app\.get\('\/cash-register\/expense-categories'/)
assert.match(routes, /app\.post\('\/cash-register\/expense-categories'/)
assert.match(routes, /app\.patch\('\/cash-register\/expense-categories\/:id'/)
assert.match(routes, /canManageCashOperations/)
assert.match(service, /ensureDefaultExpenseCategory/)
assert.match(service, /EXPENSE_CATEGORY_NOT_FOUND|EXPENSE_CATEGORY_INACTIVE/)
assert.match(service, /DEFAULT_EXPENSE_CATEGORY_PROTECTED/)
assert.match(service, /findExpenseCategory\(input\.businessId, expenseCategoryId\)/)
assert.match(repository, /expenseCategoryId/)
assert.match(repository, /\$\{input\.expenseCategoryId\}/)
assert.match(repository, /category\."businessId" = entry\."businessId"/)
assert.match(ui, /id="cash-operation-category-field"/)
assert.match(ui, /id="cash-operation-category-field"[\s\S]*id="cash-expense-category-manage"[\s\S]*id="cash-operation-category"/)
assert.doesNotMatch(ui, /class="cash-filter-row"[\s\S]{0,1500}id="cash-expense-category-manage"/)
assert.match(ui, /id="cash-category-filter"/)
assert.match(ui, /id="cash-expense-category-dialog"/)
assert.match(ui, /Administrar categor&iacute;as/)
assert.match(ui, /if \(type === 'EXPENSE'\)[\s\S]*payload\.categoryId/)
assert.match(ui, /params\.set\('categoryId'/)
assert.match(ui, /entry\.expenseCategoryName/)
assert.match(ui, /loadCashExpenseCategories/)
assert.match(ui, /openCashExpenseCategoryDialog/)
assert.match(ui, /categoryFilter\.addEventListener\('change'/)
assert.match(ui, /operationCategoryField\.hidden = type !== 'EXPENSE'/)
assert.match(ui, /find\(\(category\) => category\.isDefault\)/)
assert.match(ui, /categoryManage\.hidden = !canUseCashPermission\('canManageCashOperations'\)/)
assert.doesNotMatch(ui, /\b(?:alert|confirm|prompt)\s*\(/)

const now = new Date('2026-09-19T12:00:00.000Z')
const defaultCategory = { id: 'cat-other', businessId: 'biz-1', name: 'Otros', normalizedName: 'otros', position: 0, isDefault: true, isActive: true, createdAt: now, updatedAt: now }
const activeCategory = { id: 'cat-light', businessId: 'biz-1', name: 'Luz', normalizedName: 'luz', position: 10, isDefault: false, isActive: true, createdAt: now, updatedAt: now }
const inactiveCategory = { ...activeCategory, id: 'cat-old', name: 'Vieja', normalizedName: 'vieja', isActive: false }
let insertedOperation: Record<string, unknown> | null = null
let listedInput: Record<string, unknown> | null = null
let createdInput: Record<string, unknown> | null = null
const transaction = {
  lockBusiness: async (businessId: string) => ({ businessId, timezone: 'UTC', dbNow: now }),
  findOpenDay: async (businessId: string) => ({ id: 'day-1', businessId, openedAt: now, closedAt: null, openingCash: 0, expectedClosingCash: null, countedClosingCash: null, closingDifference: null }),
  findOpenSession: async (businessId: string, registerDayId: string) => ({ id: 'session-1', businessId, registerDayId, responsibleUserId: 'user-1', responsibleName: 'User', openedAt: now, closedAt: null, expectedCash: null, countedCash: null, cashDifference: null }),
  ensureDefaultExpenseCategory: async () => defaultCategory,
  findExpenseCategory: async (businessId: string, categoryId: string) => businessId === 'biz-1' ? [defaultCategory, activeCategory, inactiveCategory].find((category) => category.id === categoryId) ?? null : null,
  insertCashOperation: async (input: Record<string, unknown>) => { insertedOperation = input; return input },
  findRegisterDay: async (_businessId: string, registerDayId: string) => registerDayId === 'day-1' ? { id: registerDayId } : null,
  listCashEntries: async (input: Record<string, unknown>) => { listedInput = input; return [] },
  createExpenseCategory: async (input: Record<string, unknown>) => { createdInput = input; return { ...activeCategory, ...input } },
  updateExpenseCategory: async (input: Record<string, unknown>) => ({ ...activeCategory, ...input })
}
const cashService = new CashService({ transaction: async (work: (value: unknown) => unknown) => work(transaction) } as never)

await cashService.recordCashOperation({ businessId: 'biz-1', cashSessionId: 'session-1', type: 'EXPENSE', amount: 1000, description: 'Insumos' })
assert.equal(insertedOperation?.expenseCategoryId, defaultCategory.id, 'un gasto sin categoría usa Otros')
await cashService.recordCashOperation({ businessId: 'biz-1', cashSessionId: 'session-1', type: 'EXPENSE', amount: 1200, description: 'Factura', categoryId: activeCategory.id })
assert.equal(insertedOperation?.expenseCategoryId, activeCategory.id, 'persiste la referencia estable elegida')
await assert.rejects(
  () => cashService.recordCashOperation({ businessId: 'biz-1', cashSessionId: 'session-1', type: 'EXPENSE', amount: 1200, description: 'Viejo', categoryId: inactiveCategory.id }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'EXPENSE_CATEGORY_INACTIVE'
)
await assert.rejects(
  () => cashService.recordCashOperation({ businessId: 'biz-2', cashSessionId: 'session-1', type: 'EXPENSE', amount: 1200, description: 'Ajeno', categoryId: activeCategory.id }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'EXPENSE_CATEGORY_NOT_FOUND'
)
await cashService.listCashEntries({ businessId: 'biz-1', registerDayId: 'day-1', type: 'EXPENSE', method: 'CASH', expenseCategoryId: activeCategory.id, query: 'factura' })
assert.equal(listedInput?.expenseCategoryId, activeCategory.id, 'el filtro llega al origen paginado')
assert.equal(listedInput?.type, 'EXPENSE')
assert.equal(listedInput?.method, 'CASH')
assert.equal(listedInput?.query, 'factura')
await assert.rejects(
  () => cashService.listCashEntries({ businessId: 'biz-2', registerDayId: 'day-1', expenseCategoryId: activeCategory.id }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'EXPENSE_CATEGORY_NOT_FOUND'
)
await cashService.createExpenseCategory({ businessId: 'biz-1', name: '  LUZ  ', position: 4 })
assert.equal(createdInput?.name, 'LUZ')
assert.equal(createdInput?.normalizedName, 'luz', 'la unicidad usa una clave normalizada case-insensitive')
await assert.rejects(
  () => cashService.updateExpenseCategory({ businessId: 'biz-1', categoryId: defaultCategory.id, name: 'General', isActive: true }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'DEFAULT_EXPENSE_CATEGORY_PROTECTED'
)
await assert.rejects(
  () => cashService.updateExpenseCategory({ businessId: 'biz-1', categoryId: defaultCategory.id, name: 'Otros', isActive: false }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'DEFAULT_EXPENSE_CATEGORY_PROTECTED'
)

console.log('OK categorías de gastos: modelo, backfill Otros, tenant, validaciones, CRUD, filtro e integración UI')
