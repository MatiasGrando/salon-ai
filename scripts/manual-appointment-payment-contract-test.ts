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

assert.match(route, /payment\?:\s*\{[\s\S]*cashSessionId\?: string[\s\S]*lines\?: Array<\{ amount: number; method: 'CASH' \| 'TRANSFER' \| 'CARD' \}>[\s\S]*discountType\?: 'AMOUNT' \| 'PERCENTAGE'[\s\S]*discountValue\?: number/)
assert.match(route, /hasPaymentLines[\s\S]*hasCashPermission\(authUser, 'canRecordAppointmentPayments'\)/)
assert.match(route, /hasDiscount[\s\S]*hasCashPermission\(authUser, 'canApplyDiscounts'\)/)
assert.match(route, /if \(hasPaymentLines && !payment\?\.cashSessionId\?\.trim\(\)\)/, 'un descuento sin cobro no debe exigir sesión de Caja')
assert.match(route, /new CashService\(new PrismaCashRepository\(transaction, true\)\)/)
assert.match(route, /afterCreateInTransaction:/)
assert.match(route, /origin: 'AGENDA'/)
assert.match(route, /setAppointmentDiscount\([\s\S]*recordAppointmentPayment\(/, 'el descuento debe aplicarse antes de registrar los pagos')
assert.match(appointmentService, /afterCreateInTransaction\?\.\(\{[\s\S]*transaction,[\s\S]*appointment: createdAppointment,[\s\S]*businessId: professional\.businessId/)
assert.match(cashRepository, /constructor\([\s\S]*private readonly prisma: PrismaTransactionRunner \| Prisma\.TransactionClient,[\s\S]*private readonly alreadyInTransaction = false/)
assert.match(cashRepository, /if \(this\.alreadyInTransaction\)/)
assert.match(cashService, /async getCurrentPaymentContext[\s\S]*findOpenDay[\s\S]*findOpenSession/)
assert.match(cashRoutes, /app\.get\('\/cash-register\/payment-context'[\s\S]*canRecordAppointmentPayments[\s\S]*getCurrentPaymentContext/)
assert.match(staffPermissions, /path === '\/cash-register\/payment-context'[\s\S]*canRecordAppointmentPayments/)

for (const marker of [
  'appointment-create-payment',
  'appointment-create-collect-total',
  'appointment-create-deposit',
  'appointment-create-discount-toggle',
  'appointment-create-discount-type',
  'appointment-create-discount-value',
  'appointment-create-payment-amount',
  'appointment-create-payment-method',
  'appointment-create-payment-line-two',
  'appointment-create-deposit-amount',
  'appointment-create-deposit-method',
  'appointment-create-payment-observation',
  'appointment-create-summary-price',
  'appointment-create-summary-discount',
  'appointment-create-summary-total',
  'appointment-create-summary-paid',
  'appointment-create-summary-due'
]) assert.ok(cashUi.includes(marker), `falta control UI ${marker}`)
assert.doesNotMatch(cashUi, /appointment-create-payment-enabled/, 'el acordeón no debe pedir una confirmación visual adicional')
assert.doesNotMatch(cashUi, /if \(!cashUi\.createPayment\.open\) return null/, 'abrir el acordeón no debe implicar un pago')
assert.match(cashUi, /createFinance:\s*\{[\s\S]*collectTotal:\s*false[\s\S]*deposit:\s*false[\s\S]*discount:\s*false/)
assert.match(cashUi, /createPaymentMethod\.value = 'CASH'/, 'Efectivo debe ser el medio predeterminado')
assert.match(cashUi, /createDepositMethod\.value = 'CASH'/, 'Efectivo debe ser el medio predeterminado para la seña')
assert.match(cashUi, /const payableAfterDeposit = Math\.max\(0, totals\.final - totals\.depositAmount\)/, 'Cobrar total debe descontar la seña del total con descuento')
assert.match(cashUi, /if \(hasPaymentLines && !state\.cashRegister\.current\?\.session\?\.id\) throw new Error/, 'solo los cobros requieren sesión activa')
assert.match(cashUi, /if \(paymentTotal > totals\.final\) throw new Error/, 'el cliente debe rechazar pagos superiores al saldo')
assert.match(cashUi, /method: 'CASH' \| 'TRANSFER' \| 'CARD'|value="CASH"[\s\S]*value="TRANSFER"[\s\S]*value="CARD"/)

assert.match(crmUi, /\$\{cashRegisterEnabled \? 'hidden' : ''\}[\s\S]*appointment-deposit-paid/)
assert.match(crmUi, /payment: createPayment/)
assert.doesNotMatch(crmUi, /await submitAppointment\([\s\S]{0,500}\/payments/)
assert.match(cashUi, /cashScoped\('\/cash-register\/payment-context'\)/)
assert.doesNotMatch(cashUi, /loadCreateAppointmentCashState\(\)[\s\S]{0,250}cashScoped\('\/cash-register\/current'\)/)

console.log('manual appointment payment contract: ok')
