import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeManualDeposit } from '../src/services/appointment-service.js'

const [schema, migration, route, ui, appointmentService] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260816190000_add_manual_appointment_deposit/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
])

assert.match(schema, /manualDepositPaid\s+Boolean\s+@default\(false\)/)
assert.match(schema, /manualDepositAmount\s+Int\?/)
assert.match(migration, /ADD COLUMN "manualDepositPaid" BOOLEAN NOT NULL DEFAULT false/)
assert.match(migration, /ADD COLUMN "manualDepositAmount" INTEGER/)

assert.match(route, /manualDepositPaid: body\.manualDepositPaid/)
assert.match(route, /manualDepositAmount: body\.manualDepositAmount/)
assert.match(route, /manualDepositAmount: _manualDepositAmount/)
assert.match(appointmentService, /manualDepositPaid: manualDeposit\.paid/)
assert.match(appointmentService, /manualDepositAmount: manualDeposit\.amount/)

assert.match(ui, /id="appointment-deposit-paid" type="checkbox"/)
assert.match(ui, /Dej&oacute; se&ntilde;a/)
assert.match(ui, /id="appointment-deposit-amount" type="number"/)
assert.match(ui, /manualDepositPaid,/)
assert.match(ui, /manualDepositAmount,/)
assert.match(ui, /appointment\.manualDepositPaid === true/)
assert.match(ui, /Seña registrada/)

assert.deepEqual(normalizeManualDeposit(false, 25_000), {
  ok: true,
  paid: false,
  amount: null
})
assert.deepEqual(normalizeManualDeposit(true, null), {
  ok: true,
  paid: true,
  amount: null
})
assert.deepEqual(normalizeManualDeposit(true, '25000'), {
  ok: true,
  paid: true,
  amount: 25_000
})
assert.equal(normalizeManualDeposit(true, 0).ok, false)
assert.equal(normalizeManualDeposit(true, 20.5).ok, false)

console.log('Manual appointment deposit contract: OK')
