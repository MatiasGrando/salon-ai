import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { summarizeCashRegister } from '../src/services/cash-domain.js'
import { treasuryRoutes } from '../src/routes/treasury.js'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260923040000_treasury_foundation/migration.sql', import.meta.url), 'utf8')
const cashLedgerMigration = readFileSync(new URL('../prisma/migrations/20260906120000_add_cash_financial_ledger/migration.sql', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/routes/treasury.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(schema, /model TreasuryAccount/)
assert.match(schema, /model TreasuryMovement/)
assert.match(migration, /CREATE TABLE "TreasuryAccount"/)
assert.match(migration, /CREATE TABLE "TreasuryMovement"/)
assert.match(route, /FOR UPDATE/)
assert.match(route, /idempotencyKey/)
assert.match(route, /requireAuthorizedBusiness/)
assert.match(route, /app.post\('\/treasury\/from-daily'/)
assert.match(cashLedgerMigration, /WHEN 'WITHDRAWAL'[\s\S]*?btrim\(coalesce\("counterparty", ''\)\) <> ''/)
const manualTransferInsert = route.split('const cashEntryId = randomUUID()')[1]?.split('const movement =')[0]
assert.ok(manualTransferInsert, 'Falta el INSERT del traspaso manual')
assert.match(manualTransferInsert, /INSERT INTO "CashEntry" \([^)]*"counterparty"/, 'El retiro manual debe tener destinatario')
assert.match(manualTransferInsert, /'Traspaso interno a Tesorería', 'Tesorería'/, 'El destinatario interno no puede estar vacío')

assert.match(ui, /cash-view-treasury/)
assert.match(ui, /state.currentUser\?\.role === 'STAFF'/)

const initial = summarizeCashRegister({ openingCash: 50_000, entries: [] })
const transferred = summarizeCashRegister({
  openingCash: 50_000,
  entries: [{ type: 'WITHDRAWAL', direction: 'OUTFLOW', amount: 10_000, method: 'CASH' }]
})
assert.equal(initial.net, 0)
assert.equal(transferred.net, 0, 'un traspaso no es gasto ni reduce el resultado')
assert.equal(transferred.expectedCash, 40_000, 'el traspaso sí reduce el efectivo esperado de Caja')

const app = Fastify()
app.addHook('preHandler', async (request) => {
  request.auth = { user: { role: 'STAFF', businessId: 'business-a', id: 'secretary', name: 'Secretaria' } as never }
})
await app.register(treasuryRoutes)
for (const path of ['/treasury', '/treasury/enable-cash', '/treasury/from-daily', '/treasury/outflow', '/treasury/pay-professional', '/treasury/consolidated']) {
  const response = await app.inject({ method: ['/treasury', '/treasury/consolidated'].includes(path) ? 'GET' : 'POST', url: path, ...(['/treasury', '/treasury/consolidated'].includes(path) ? {} : { payload: {} }) })
  assert.equal(response.statusCode, 403, path + ' debe negar acceso a personal')
}
await app.close()
console.log('OK Tesorería: ledger separado, traspaso neutro y acceso denegado a personal')
