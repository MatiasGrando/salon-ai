import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [schema, migration, cashDomain, cashService, repository, treasury, ui] = await Promise.all([
  readFile(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8'),
  readFile(path.join(process.cwd(), 'prisma', 'migrations', '20260925030000_unify_cash_income', 'migration.sql'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'services', 'cash-domain.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'services', 'cash-service.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'repositories', 'prisma-cash-repository.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'treasury.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'crm-ui', 'cash-register.ts'), 'utf8')
])

assert.match(schema, /enum CashEntryType \{[\s\S]*\bINCOME\b[\s\S]*\bCASH_IN\b/)
assert.match(migration, /UPDATE "CashEntry"[\s\S]*"type" = 'INCOME'[\s\S]*"type" = 'CASH_IN'/)
assert.match(cashDomain, /effectiveType === 'PAYMENT' \|\| effectiveType === 'INCOME'/)
assert.match(cashService, /type: 'INCOME'[\s\S]*categoryId\?: string \| null[\s\S]*subcategoryId\?: string \| null/)
assert.match(cashService, /input\.type === 'EXPENSE' \|\| input\.type === 'INCOME'/)
assert.match(repository, /"paymentMethod", "businessPaymentMethodId", "origin"/)
assert.match(repository, /\$\{input\.paymentMethodId \?\? null\}/)
assert.match(ui, /type === 'EXPENSE' \|\| type === 'INCOME'/)
assert.match(ui, /\['EXPENSE', 'INCOME'\]\.includes\(type\)[\s\S]*payload\.categoryId/)
assert.match(ui, /value="INCOME">Ingreso/)
assert.doesNotMatch(ui, /value="CASH_IN">/)
assert.match(treasury, /kind\?: 'INCOME' \| 'EXPENSE' \| 'WITHDRAWAL'/)
assert.match(treasury, /input\.kind === 'INCOME' \? 'INFLOW' : 'OUTFLOW'/)
assert.match(treasury, /input\.kind !== 'INCOME'[\s\S]*INSUFFICIENT_TREASURY/)
assert.match(treasury, /incomingTreasuryByMethod/)
assert.match(treasury, /cash\.grossCollected \+ incomingTreasury/)
console.log('OK ingresos categorizados en Caja y Tesorería')