import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const route = await readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
const appointmentService = await readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
const cashRepository = await readFile(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
const cashService = await readFile(new URL('../src/services/cash-service.ts', import.meta.url), 'utf8')
const cashRoutes = await readFile(new URL('../src/routes/cash-register.ts', import.meta.url), 'utf8')
const staffPermissions = await readFile(new URL('../src/services/staff-permission-service.ts', import.meta.url), 'utf8')
const crmUi = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const cashUi = await readFile(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')

assert.match(route, /payment\?:\s*\{[\s\S]*cashSessionId\?: string[\s\S]*lines\?: Array<\{ amount: number; method: 'CASH' \| 'TRANSFER' \| 'CARD' \}>/)
assert.match(route, /hasCashPermission\(authUser, 'canRecordAppointmentPayments'\)/)
assert.match(route, /new CashService\(new PrismaCashRepository\(transaction, true\)\)/)
assert.match(route, /afterCreateInTransaction:/)
assert.match(route, /origin: 'AGENDA'/)
assert.match(appointmentService, /afterCreateInTransaction\?\.\(\{[\s\S]*transaction,[\s\S]*appointment: createdAppointment,[\s\S]*businessId: professional\.businessId/)
assert.match(cashRepository, /constructor\([\s\S]*private readonly prisma: PrismaTransactionRunner \| Prisma\.TransactionClient,[\s\S]*private readonly alreadyInTransaction = false/)
assert.match(cashRepository, /if \(this\.alreadyInTransaction\)/)
assert.match(cashService, /async getCurrentPaymentContext[\s\S]*findOpenDay[\s\S]*findOpenSession/)
assert.match(cashRoutes, /app\.get\('\/cash-register\/payment-context'[\s\S]*canRecordAppointmentPayments[\s\S]*getCurrentPaymentContext/)
assert.match(staffPermissions, /path === '\/cash-register\/payment-context'[\s\S]*canRecordAppointmentPayments/)

for (const marker of [
  'appointment-create-payment',
  'appointment-create-payment-enabled',
  'appointment-create-payment-amount',
  'appointment-create-payment-method',
  'appointment-create-payment-line-two',
  'appointment-create-payment-observation'
]) assert.ok(cashUi.includes(marker), `falta control UI ${marker}`)
assert.match(cashUi, /createPaymentMethod\.value = 'CASH'/, 'Efectivo debe ser el medio predeterminado')
assert.match(cashUi, /if \(!state\.cashRegister\.current\?\.session\?\.id\) throw new Error/, 'no se puede cobrar sin sesión activa')
assert.match(cashUi, /if \(paymentTotal > price\.total\) throw new Error/, 'el cliente debe rechazar pagos superiores al saldo')
assert.match(cashUi, /method: 'CASH' \| 'TRANSFER' \| 'CARD'|value="CASH"[\s\S]*value="TRANSFER"[\s\S]*value="CARD"/)

assert.match(crmUi, /\$\{cashRegisterEnabled \? 'hidden' : ''\}[\s\S]*appointment-deposit-paid/)
assert.match(crmUi, /payment: createPayment/)
assert.doesNotMatch(crmUi, /await submitAppointment\([\s\S]{0,500}\/payments/)
assert.match(cashUi, /cashScoped\('\/cash-register\/payment-context'\)/)
assert.doesNotMatch(cashUi, /loadCreateAppointmentCashState\(\)[\s\S]{0,250}cashScoped\('\/cash-register\/current'\)/)

console.log('manual appointment payment contract: ok')
