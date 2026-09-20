import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CashService, CashServiceError } from '../src/services/cash-service.js'

const [schema, serviceSource, repositorySource, routeSource, uiSource, crmUiSource, appointmentServiceSource] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/cash-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
])
assert.match(schema, /enum AppointmentCompletionSource[\s\S]*MANUAL[\s\S]*FULL_PAYMENT/)
for (const field of ['completedAt', 'completedByUserId', 'completedByName', 'completionSource']) assert.match(schema, new RegExp(field))
assert.match(repositorySource, /completeAppointmentFromPayment/)
assert.match(serviceSource, /APPOINTMENT_COMPLETION_REQUIRES_FULL_PAYMENT/)
assert.match(routeSource, /completeAppointment\?: boolean/)
assert.match(routeSource, /canEditAppointments/)
assert.match(uiSource, /appointment-payment-complete/)
assert.match(uiSource, /Marcar este turno como realizado/)
assert.match(crmUiSource, /id="appointment-complete"/)
assert.match(crmUiSource, /async function completeManualAppointment/)
assert.match(crmUiSource, /function isAttendedAppointment\(appointment\) \{\s*return appointment\.status === 'COMPLETED'/)
assert.match(appointmentServiceSource, /status === 'COMPLETED' && appointment\.startAt\.getTime\(\) > Date\.now\(\)/)
assert.match(appointmentServiceSource, /if \(status !== 'COMPLETED'\) \{\s*await persistAppointmentCompletionMetadata/)

let completionCalls = 0
let insertedPayments = 0
const transaction = {
  lockBusiness: async () => ({ businessId: 'business-1', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-20T15:00:00Z') }),
  findOpenDay: async () => ({ id: 'day-1', businessId: 'business-1', openedAt: new Date(), closedAt: null, openingCash: 0, expectedClosingCash: null, countedClosingCash: null, closingDifference: null }),
  findOpenSession: async () => ({ id: 'session-1', businessId: 'business-1', registerDayId: 'day-1', responsibleUserId: 'user-1', responsibleName: 'Admin', openedAt: new Date(), closedAt: null, expectedCash: null, countedCash: null, cashDifference: null }),
  lockAppointmentAccount: async () => ({ id: 'account-1', businessId: 'business-1', pricingMode: 'FIXED', agreedAmount: 10_000, originalAmount: 10_000, minimumAmount: 10_000, discountAmount: 0 }),
  listAccountEntries: async () => [],
  insertManualPayments: async ({ lines }: any) => { insertedPayments += 1; return lines.map((line: any, index: number) => ({ id: 'payment-' + index, ...line })) },
  completeAppointmentFromPayment: async (input: any) => { completionCalls += 1; return { appointmentId: input.appointmentId, previousStatus: 'CONFIRMED', status: 'COMPLETED', completedAt: input.completedAt } }
}
const service = new CashService({ transaction: async (work: any) => work(transaction) } as any)
const completed = await service.recordAppointmentPayment({
  businessId: 'business-1', appointmentId: 'appointment-1', cashSessionId: 'session-1', origin: 'AGENDA',
  lines: [{ amount: 10_000, method: 'CASH' }], completeAppointment: true,
  actorUserId: 'user-1', actorName: 'Admin'
})
assert.equal(completionCalls, 1)
assert.equal(insertedPayments, 1)
assert.equal(completed.completion?.status, 'COMPLETED')

await assert.rejects(
  () => service.recordAppointmentPayment({
    businessId: 'business-1', appointmentId: 'appointment-1', cashSessionId: 'session-1', origin: 'AGENDA',
    lines: [{ amount: 5_000, method: 'CASH' }], completeAppointment: true,
    actorUserId: 'user-1', actorName: 'Admin'
  }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'APPOINTMENT_COMPLETION_REQUIRES_FULL_PAYMENT'
)
assert.equal(insertedPayments, 1, 'el pago parcial inválido debe rechazarse antes de insertar movimientos')
console.log('appointment completion on payment contract: OK')