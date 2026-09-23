import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summarizeCashRegister } from '../src/services/cash-domain.js'

const summary = summarizeCashRegister({ openingCash: 20_000, entries: [
  { type: 'PAYMENT', direction: 'INFLOW', amount: 100_000, method: 'CASH' },
  { type: 'PAYMENT', direction: 'INFLOW', amount: 50_000, method: 'TRANSFER' },
  { type: 'REFUND', direction: 'OUTFLOW', amount: 10_000, method: 'CASH' },
  { type: 'EXPENSE', direction: 'OUTFLOW', amount: 20_000, method: 'CASH' },
  { type: 'EXPENSE', direction: 'OUTFLOW', amount: 5_000, method: 'TRANSFER' },
  { type: 'WITHDRAWAL', direction: 'OUTFLOW', amount: 30_000, method: 'CASH' },
  { type: 'CASH_IN', direction: 'INFLOW', amount: 3_000, method: 'CASH' }
] })
assert.equal(summary.grossCollected, 150_000)
assert.equal(summary.outgoingByMethod.CASH, 30_000)
assert.equal(summary.outgoingByMethod.TRANSFER, 5_000)
assert.equal(summary.expenses + summary.refunds, 35_000)
assert.equal(summary.net, 115_000)
assert.equal(summary.expectedCash, 63_000)
const source = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
for (const marker of ['Cobrado', 'Egresos', 'Total', 'cash-outgoing-cash', 'cash-total-cash', 'cash-period-outgoing-cash', 'cash-period-total-cash', 'cash-unknown-collected-row', 'cash-period-unknown-total-row']) assert.ok(source.includes(marker), `falta ${marker}`)
assert.ok(source.includes('summary.outgoingByMethod'), 'la UI debe usar egresos por medio')
console.log('OK tablero: cobrado, egresos, total y efectivo sin mezclar movimientos internos.')
