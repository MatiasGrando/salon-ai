import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CashService, CashServiceError } from '../src/services/cash-service.js'

const service = readFileSync(new URL('../src/services/cash-service.ts', import.meta.url), 'utf8')
const repository = readFileSync(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260919170000_add_appointment_total_adjustments/migration.sql', import.meta.url), 'utf8')

assert.match(service, /async adjustAppointmentTotal\(/)
assert.match(service, /reason\.trim\(\)/)
assert.match(service, /newAmount < account\.minimumAmount/)
assert.match(service, /newAmount < totals\.paidAmount/)
assert.match(repository, /insertTotalAdjustment/)
assert.match(routes, /\/appointments\/:id\/adjust-total/)
assert.match(routes, /canRecordAppointmentPayments/)
assert.match(ui, /Ajustar total/)
assert.match(ui, /Precio original/)
assert.match(ui, /Motivo del ajuste/)
assert.match(schema, /model AppointmentTotalAdjustment/)
assert.match(schema, /previousAmount\s+Int\?/)
assert.match(schema, /newAmount\s+Int/)
assert.match(schema, /actorName\s+String/)
assert.match(migration, /cash_account_require_total_adjustment_audit/)
assert.match(migration, /"appliedAt" IS NULL/)
assert.match(migration, /estimated appointment total is below service minimum/)

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-a', businessId: 'business-a', pricingMode: 'ESTIMATED' as const,
    agreedAmount: 40_000, originalAmount: 40_000, minimumAmount: 15_000, discountAmount: 0,
    ...overrides
  }
}

function serviceFor(current: ReturnType<typeof account>, paidAmount = 0) {
  const calls: string[] = []
  let stored = current
  const transaction = {
    lockBusiness: async () => ({ businessId: 'business-a', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date() }),
    lockAppointmentAccount: async () => stored,
    listAccountEntries: async () => paidAmount > 0 ? [{ type: 'PAYMENT', direction: 'INFLOW', amount: paidAmount }] : [],
    insertTotalAdjustment: async (input: Record<string, unknown>) => {
      calls.push('audit')
      assert.equal(input.previousAmount, current.agreedAmount)
      return { ...input, id: 'adjustment-a', createdAt: new Date() }
    },
    updateAdjustedTotal: async (_businessId: string, _accountId: string, agreedAmount: number) => {
      calls.push('update')
      stored = { ...stored, agreedAmount }
      return stored
    }
  }
  return { cash: new CashService({ transaction: async (work: (tx: unknown) => unknown) => work(transaction) } as never), calls }
}

const allowed = serviceFor(account())
const adjusted = await allowed.cash.adjustAppointmentTotal({
  businessId: 'business-a', appointmentId: 'appointment-a', newAmount: 15_000,
  reason: 'El cliente eligió la opción básica', actorUserId: 'user-a', actorName: 'Ana'
})
assert.equal(adjusted.agreedAmount, 15_000)
assert.deepEqual(allowed.calls, ['audit', 'update'])

const unchangedAtCreation = serviceFor(account())
const unchangedEstimated = await unchangedAtCreation.cash.setEstimatedAppointmentTotal({
  businessId: 'business-a', appointmentId: 'appointment-a', agreedAmount: 40_000,
  reason: 'Total acordado al crear el turno', actorUserId: 'user-a', actorName: 'Ana'
})
assert.equal(unchangedEstimated.agreedAmount, 40_000)
assert.deepEqual(unchangedAtCreation.calls, [], 'repetir el total inicial no debe crear una auditoría falsa ni impedir el alta')

const fixedAllowed = serviceFor(account({ pricingMode: 'FIXED', agreedAmount: 20_000, originalAmount: 20_000, minimumAmount: 0 }))
assert.equal((await fixedAllowed.cash.adjustAppointmentTotal({
  businessId: 'business-a', appointmentId: 'appointment-a', newAmount: 10_000,
  reason: 'Acuerdo excepcional con el cliente', actorUserId: 'user-a', actorName: 'Ana'
})).agreedAmount, 10_000)
assert.deepEqual(fixedAllowed.calls, ['audit', 'update'])

await assert.rejects(
  () => serviceFor(account()).cash.adjustAppointmentTotal({
    businessId: 'business-a', appointmentId: 'appointment-a', newAmount: 14_999,
    reason: 'Cambio de opción', actorUserId: 'user-a', actorName: 'Ana'
  }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'TOTAL_BELOW_MINIMUM'
)

await assert.rejects(
  () => serviceFor(account({ pricingMode: 'FIXED', agreedAmount: 20_000, originalAmount: 20_000, minimumAmount: 0 }), 12_000).cash.adjustAppointmentTotal({
    businessId: 'business-a', appointmentId: 'appointment-a', newAmount: 11_999,
    reason: 'Corrección excepcional', actorUserId: 'user-a', actorName: 'Ana'
  }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'TOTAL_BELOW_PAID'
)

await assert.rejects(
  () => serviceFor(account()).cash.adjustAppointmentTotal({
    businessId: 'business-a', appointmentId: 'appointment-a', newAmount: 30_000,
    reason: '   ', actorUserId: 'user-a', actorName: 'Ana'
  }),
  (error: unknown) => error instanceof CashServiceError && error.code === 'TOTAL_ADJUSTMENT_REASON_REQUIRED'
)

console.log('appointment total adjustment contract: ok')
