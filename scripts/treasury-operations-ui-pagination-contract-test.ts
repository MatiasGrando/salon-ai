import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { treasuryPage } from '../src/routes/treasury.js'

assert.deepEqual(treasuryPage(undefined), { page: 1, pageSize: 20, offset: 0 })
assert.deepEqual(treasuryPage('3'), { page: 3, pageSize: 20, offset: 40 })
for (const value of ['0', '-1', '1.5', 'abc', '10001']) assert.equal(treasuryPage(value), null)

const route = readFileSync(new URL('../src/routes/treasury.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.ok(route.includes('LIMIT ${pageSize} OFFSET ${offset}'))
assert.ok(route.includes('SELECT COUNT(*)::bigint AS "total"'))
assert.ok(route.includes('totalPages: Math.max(1, Math.ceil(total / pageSize))'))
assert.match(ui, /cash-treasury-reserve-card/)
assert.match(ui, /cash-treasury-transfer-section/)
assert.match(ui, /Transferir a Tesorer&iacute;a/)
assert.match(ui, /cash-treasury-outflow-section/)
assert.match(ui, /cash-treasury-page-info/)
assert.match(ui, /cash-treasury-previous/)
assert.match(ui, /cash-treasury-next/)
assert.match(ui, /loadTreasury\(\{ page: 1 \}\)/)
console.log('OK Tesorería: saldo destacado, operaciones separadas y paginación de 20')
