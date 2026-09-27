import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [schema, migration, routes, cashRoutes, ui] = await Promise.all([
  readFile(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8'),
  readFile(path.join(process.cwd(), 'prisma', 'migrations', '20260925010000_treasury_payment_methods_and_counterparties', 'migration.sql'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'treasury.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'cash-register.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'crm-ui', 'cash-register.ts'), 'utf8')
])

assert.match(schema, /model BusinessPaymentMethod/)
assert.match(schema, /model TreasuryCounterparty/)
assert.match(schema, /businessPaymentMethodId\s+String\?/)
assert.match(schema, /counterpartyId\s+String\?/)
assert.match(migration, /INSERT INTO "BusinessPaymentMethod"/)
assert.match(migration, /^\s*BEGIN;\s/i, 'migration must start an explicit transaction')
assert.match(migration, /\nCOMMIT;\s*$/i, 'migration must commit at the end')
const triggerDisabled = migration.indexOf('ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger"')
const cashEntryBackfill = migration.indexOf('UPDATE "CashEntry" entry')
const triggerEnabled = migration.indexOf('ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger"')
assert.ok(triggerDisabled >= 0 && triggerDisabled < cashEntryBackfill && cashEntryBackfill < triggerEnabled, 'append-only trigger must only be disabled around the backfill and re-enabled after')
for (const label of ['Efectivo', 'Mercado Pago', 'Tarjeta']) assert.ok(migration.includes(label), `falta plantilla ${label}`)
assert.match(routes, /\/treasury\/payment-methods/)
assert.match(routes, /\/treasury\/counterparties/)
assert.match(cashRoutes, /NOT EXISTS[\s\S]*method\."kind" = template\.kind[\s\S]*method\."isDefault" = true/, 'renombrar el medio predeterminado no debe recrear la plantilla')
assert.match(routes, /expenseCategoryId.*expenseSubcategoryId/s)
for (const id of [
  'cash-treasury-account-grid',
  'cash-treasury-payment-method-add',
  'cash-treasury-outflow-account',
  'cash-treasury-outflow-counterparty',
  'cash-treasury-counterparty-add'
]) assert.ok(ui.includes(id), `falta ${id}`)
assert.match(ui, /counterpartyId/)
assert.match(ui, /accountId/)
console.log('OK Tesorería: medios configurables, cuentas separadas, destinatarios y clasificación completa.')
