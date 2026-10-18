import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { calculateCompletedServiceCorrection } from '../src/services/completed-service-correction.js'
import Fastify from 'fastify'
import { appointmentRoutes } from '../src/routes/appointment.js'
import { AppointmentService } from '../src/services/appointment-service.js'
import { prisma } from '../src/config/prisma.js'
import { CashServiceError } from '../src/services/cash-service.js'

const decrease = calculateCompletedServiceCorrection({ previousServiceAmount: 40, newServiceAmount: 20, paidAmount: 40 })
assert.deepEqual(decrease, {
  previousTotal: 40,
  newTotal: 20,
  refundAmount: 20,
  balanceAmount: 0
}, 'reemplazar un servicio cobrado de 40 por uno de 20 debe devolver 20 y dejar la cuenta saldada')

const increase = calculateCompletedServiceCorrection({ previousServiceAmount: 40, newServiceAmount: 60, paidAmount: 40 })
assert.deepEqual(increase, {
  previousTotal: 40,
  newTotal: 60,
  refundAmount: 0,
  balanceAmount: 20
}, 'reemplazar un servicio cobrado por uno más caro debe dejar saldo pendiente')

assert.throws(
  () => calculateCompletedServiceCorrection({ previousServiceAmount: 40, newServiceAmount: -20, paidAmount: 19 }),
  /INVALID_MONEY_AMOUNT/,
  'los importes de una corrección deben ser enteros no negativos'
)

const cashServiceSource = readFileSync('src/services/cash-service.ts', 'utf8')
const compensation = readFileSync('src/services/professional-compensation.ts', 'utf8')
const route = readFileSync('src/routes/appointment.ts', 'utf8')
const crmUi = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
const schema = readFileSync('prisma/schema.prisma', 'utf8')

assert.match(schema, /model AppointmentServiceCorrection[\s\S]*previousServiceId\s+String[\s\S]*newServiceId\s+String[\s\S]*reason\s+String/, 'la corrección debe conservar la evidencia de ambos servicios y el motivo')
assert.match(schema, /model Appointment[\s\S]*serviceCorrections\s+AppointmentServiceCorrection\[\]/, 'el turno debe exponer su historial de correcciones')
assert.match(cashServiceSource, /async correctCompletedAppointmentService\(/, 'la Agenda necesita una operación dedicada para corregir un servicio realizado')
assert.match(cashServiceSource, /lockCompletedAppointmentForServiceCorrection/, 'la corrección debe quedar limitada a turnos realizados')
assert.match(cashServiceSource, /updateCompletedAppointmentService/, 'la corrección debe actualizar el snapshot de servicio del turno')
assert.match(cashServiceSource, /createServiceCorrectionRefund/, 'la corrección con menor total debe registrar una devolución ligada a la cuenta')
assert.match(cashServiceSource, /replaceProfessionalEarningForCompletedAppointment/, 'la liquidación debe recalcularse con la regla del nuevo servicio')
assert.match(compensation, /export async function replaceProfessionalEarningForCompletedAppointment/, 'la liquidación necesita una corrección de devengado, sin borrar pagos al profesional')
assert.match(route, /app\.post\('\/appointments\/:id\/correct-completed-service'/, 'debe existir una ruta explícita para la corrección financiera')
assert.match(route, /correct-completed-service/, 'la operación conserva su endpoint explícito')
assert.match(route, /cashSessionId\?: string[\s\S]*paymentMethodId\?: string/, 'la devolución debe requerir una sesión y un medio de pago elegidos')
assert.match(crmUi, /id="appointment-correction-toggle"/, 'el detalle del turno debe ofrecer la acción administrativa')
assert.match(crmUi, /id="appointment-service-correction"/, 'el formulario debe tener un contenedor propio')
assert.match(crmUi, /id="appointment-correction-reason"/, 'el formulario debe pedir el motivo de la corrección')
assert.match(crmUi, /appointment-service-correction[\s\S]*@media/, 'el formulario debe incluir reglas responsive propias')
assert.doesNotMatch(crmUi, /\b(?:alert|confirm|prompt)\s*\(/, 'la interfaz no debe usar cuadros nativos')

const migration = 'prisma/migrations/20261015010000_add_completed_service_corrections/migration.sql'
assert.ok(existsSync(migration), 'la auditoría financiera requiere una migración de esquema')
assert.match(readFileSync(migration, 'utf8'), /CREATE TABLE "AppointmentServiceCorrection"/, 'la migración debe crear el registro de auditoría')

const calls: Record<string, unknown>[] = []
const sensitiveFinance = { serviceCorrections: [{ id: 'history', previousServiceName: 'A', newServiceName: 'B', previousCompensation: { amount: 20000 }, newCompensation: { amount: 5000 }, requestFingerprint: 'private', requestId: 'private' }] }
const cashService = {
  correctCompletedAppointmentService: async (input: Record<string, unknown>) => {
    calls.push(input)
    if (input.reason === 'stale') throw new CashServiceError('SERVICE_CORRECTION_STALE')
    return { finance: sensitiveFinance, correction: { id: 'corrected' } }
  },
  getAppointmentFinance: async () => sensitiveFinance
}
const app = Fastify()
const originalAuthorization = { user: prisma.user.findFirst, business: prisma.business.findFirst }
let activeAdministrator = true
let databaseRole: string | null = null
;(prisma.user as any).findFirst = async ({ where }: any) => activeAdministrator && where.isActive === true && (!databaseRole || where.role === databaseRole) ? { id: where.id, name: 'Admin', role: where.role, businessId: where.role === 'BUSINESS_ADMIN' ? 'local' : null } : null
;(prisma.business as any).findFirst = async ({ where }: any) => {
  if (where.accountAdminId && (where.accountAdminId !== 'admin' || where.id !== 'local')) return null
  if (where.AND && !where.AND.every((item: any) => item.id === 'local')) return null
  return where.id === 'foreign' ? null : { id: 'local' }
}
app.addHook('preHandler', async request => {
  request.auth = { user: {
    id: 'admin', name: 'Admin', role: request.headers['x-role'] || 'BUSINESS_ADMIN',
    businessId: ['SUPER_ADMIN', 'ACCOUNT_ADMIN'].includes(String(request.headers['x-role'])) ? null : 'local', canRecordAppointmentPayments: true
  } } as never
})
await app.register(appointmentRoutes, { cashService: cashService as never })
const url = '/appointments/a/correct-completed-service'
const payload = { serviceId: 'b', expectedServiceId: 'a', requestId: 'request', reason: 'Servicio incorrecto', expectedServicePrice: 20000, expectedAgreedAmount: 40000, expectedPaidAmount: 40000, expectedDiscountAmount: 0, expectedProductSubtotal: 0, businessId: 'foreign' }
try {
  for (const role of ['STAFF']) {
    assert.equal((await app.inject({ method: 'POST', url, headers: { 'x-role': role }, payload })).statusCode, 403)
  }
  assert.equal(calls.length, 0)
  for (const invalid of [null, {}, { ...payload, expectedPaidAmount: '40000' }, { ...payload, cashSessionId: 4 }]) {
    assert.equal((await app.inject({ method: 'POST', url, payload: invalid as never })).statusCode, 400)
  }
  const corrected = await app.inject({ method: 'POST', url, payload })
  assert.equal(corrected.statusCode, 200)
  assert.equal(calls[0]!.businessId, 'local', 'el cliente no puede seleccionar otro local en el body')
  for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
    const response = await app.inject({ method: 'POST', url: url + '?businessId=local', headers: { 'x-role': role }, payload })
    assert.equal(response.statusCode, 200, role + ' puede corregir en el local autorizado seleccionado')
    assert.equal(calls.at(-1)!.businessId, 'local')
    assert.equal(calls.at(-1)!.actorUserId, 'admin')
    assert.equal((await app.inject({ method: 'POST', url: url + '?businessId=foreign', headers: { 'x-role': role }, payload })).statusCode, 404, 'rechazo antes de mutar local no autorizado')
  }
  activeAdministrator = false
  assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 403, 'administrador desactivado no alcanza el motor')
  activeAdministrator = true
  databaseRole = 'STAFF'
  assert.equal((await app.inject({ method: 'POST', url: url + '?businessId=local', headers: { 'x-role': 'SUPER_ADMIN' }, payload })).statusCode, 403, 'sesión administrativa antigua no prevalece sobre el rol vigente')
  databaseRole = null
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, reason: 'stale' } })).statusCode, 409)
  const staffFinance = (await app.inject({ method: 'GET', url: '/appointments/a/finance', headers: { 'x-role': 'STAFF' } })).json()
  assert.equal(staffFinance.serviceCorrections[0].previousCompensation, undefined)
  assert.equal(staffFinance.serviceCorrections[0].newCompensation, undefined)
  assert.equal(staffFinance.serviceCorrections[0].requestFingerprint, undefined)
  const adminFinance = (await app.inject({ method: 'GET', url: '/appointments/a/finance' })).json()
  assert.equal(adminFinance.serviceCorrections[0].newCompensation.amount, 5000)
} finally {
  await app.close()
  ;(prisma.user as any).findFirst = originalAuthorization.user
  ;(prisma.business as any).findFirst = originalAuthorization.business
}

// The common agenda service rejects completed records before availability,
// customer writes or financial mutations, including callers outside HTTP.
const db = prisma as any
const originalFindUnique = db.appointment.findUnique
const originalTransaction = db.$transaction
let transactions = 0
try {
  db.appointment.findUnique = async () => ({ id: 'a', businessId: 'local', professionalId: 'p', serviceId: 'a', status: 'COMPLETED', professional: { businessId: 'local' }, serviceItems: [], startAt: new Date('2026-10-01T12:00:00Z') })
  db.$transaction = async () => { transactions += 1; throw new Error('completed common edit must never write') }
  const appointments = new AppointmentService()
  const outcomes = [
    await appointments.update({ id: 'a', customerId: 'c', professionalId: 'p', serviceId: 'b', startAt: '2026-10-01T12:00:00Z' }),
    await appointments.cancel('a'),
    await appointments.updateStatus('a', 'CONFIRMED')
  ]
  for (const outcome of outcomes) assert.equal('code' in outcome ? outcome.code : undefined, 'COMPLETED_APPOINTMENT_IMMUTABLE')
  assert.equal(transactions, 0)
} finally {
  db.appointment.findUnique = originalFindUnique
  db.$transaction = originalTransaction
}

console.log('Completed service correction contracts OK')
