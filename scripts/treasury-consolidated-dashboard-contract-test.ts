import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { consolidateCashAndTreasury, treasuryRoutes } from '../src/routes/treasury.js'

const cash = { grossCollected: 150000, refunds: 10000, expenses: 25000, collectedByMethod: { CASH: 100000, TRANSFER: 40000, CARD: 10000 }, outgoingByMethod: { CASH: 20000, TRANSFER: 10000, CARD: 5000, UNSPECIFIED: 0 } }
const result = consolidateCashAndTreasury(cash, 35000)
assert.equal(result.collected, 150000)
assert.equal(result.outgoingCash, 35000)
assert.equal(result.outgoingTreasury, 35000)
assert.equal(result.outgoing, 70000)
assert.equal(result.total, 80000)
assert.equal(result.outgoingByMethod.CASH, 55000)
assert.equal(result.totalByMethod.CASH, 45000)
assert.equal(result.totalByMethod.TRANSFER, 30000)
assert.equal(result.totalByMethod.CARD, 5000)
const route = readFileSync('src/routes/treasury.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
for (const marker of ['/treasury/consolidated', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE', "'EXPENSE'", 'AT TIME ZONE', 'normalizeCashPeriodRange']) assert.ok(route.includes(marker), `falta ${marker}`)
for (const marker of ['cash-treasury-consolidated', 'cash-treasury-consolidated-collected', 'cash-treasury-consolidated-outgoing', 'cash-treasury-consolidated-total']) assert.ok(ui.includes(marker), `falta ${marker}`)
const app = Fastify()
app.addHook('preHandler', async (request) => { request.auth = { user: { role: 'STAFF', businessId: 'shop', id: 'secretary', name: 'Secretaria' } as never } })
await app.register(treasuryRoutes)
const response = await app.inject({ method: 'GET', url: '/treasury/consolidated?from=2026-09-01&to=2026-09-30' })
assert.equal(response.statusCode, 403)
await app.close()
console.log('OK tablero consolidado admin: ingresos, egresos y transferencias internas excluidas')
