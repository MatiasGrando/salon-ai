import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [cashRouteSource, appointmentSource, serverSource] = await Promise.all([
  readFile(path.join(process.cwd(), 'src', 'routes', 'cash-register.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'appointment.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'server.ts'), 'utf8')
])
for (const route of ['/cash-register/current', '/cash-register/payment-context', '/cash-register/days', '/cash-register/open', '/cash-register/new-session', '/cash-register/close', '/cash-register/entries']) {
  assert.ok(cashRouteSource.includes(`'${route}'`), `falta ruta ${route}`)
}
for (const suffix of ['/finance', '/estimated-total', '/discount', '/payments']) assert.ok(appointmentSource.includes(suffix), `falta endpoint Agenda ${suffix}`)
assert.match(serverSource, /register\(cashRegisterRoutes\)/)
assert.match(cashRouteSource, /nextCursor/)
assert.match(cashRouteSource, /CASH_PERMISSION_REQUIRED/)

const { cashRegisterRoutes } = await import('../src/routes/cash-register.js')
const { CashServiceError } = await import('../src/services/cash-service.js')
const calls: string[] = []
const callInputs: Array<{ property: string; input: Record<string, unknown> }> = []
const fakeService = new Proxy({}, {
  get: (_target, property) => async (input: Record<string, unknown>) => {
    calls.push(`${String(property)}:${input.businessId}`)
    callInputs.push({ property: String(property), input })
    if (input.businessId === 'missing') throw new CashServiceError('BUSINESS_NOT_FOUND')
    if (property === 'recordCashOperation' && input.description === 'closed') throw new CashServiceError('CASH_CLOSED')
    if (property === 'listCashEntries') return { entries: [{ id: 'entry-1' }], nextCursor: 'cursor-2' }
    return { ok: true }
  }
})
const app = Fastify()
app.addHook('preHandler', async (request) => {
  request.auth = { user: fakeAuthUser(request.headers) }
})
await app.register(cashRegisterRoutes, { cashService: fakeService as never })

assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current' })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current', headers: { 'x-view': 'yes' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current', headers: { 'x-view': 'yes', 'x-business': 'missing' } })).statusCode, 404)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context' })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context', headers: { 'x-view': 'yes' } })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context', headers: { 'x-payments': 'yes' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/open', headers: { 'x-sessions': 'yes' }, payload: {} })).statusCode, 400)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-operate': 'yes' }, payload: { cashSessionId: 'session', type: 'EXPENSE', amount: 10, description: 'closed' } })).statusCode, 409)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-adjust': 'yes' }, payload: { cashSessionId: 'session', type: 'EXPENSE', amount: 10, description: 'x' } })).statusCode, 403)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-operate': 'yes' }, payload: { businessId: 'foreign-business', cashSessionId: 'session', type: 'CASH_IN', amount: 10, description: 'x' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/days/day/entries?type=UNKNOWN', headers: { 'x-view': 'yes' } })).statusCode, 400)
const page = await app.inject({ method: 'GET', url: '/cash-register/days/day/entries?cursor=abc&type=EXPENSE&method=CASH&q=cliente', headers: { 'x-view': 'yes' } })
assert.equal(page.statusCode, 200)
assert.equal(page.json().nextCursor, 'cursor-2')
assert.equal(calls.some((call) => call.endsWith(':foreign-business')), false, 'ninguna operación debe usar un tenant arbitrario')
await app.close()

const { appointmentRoutes } = await import('../src/routes/appointment.js')
const agenda = Fastify()
agenda.addHook('preHandler', async (request) => {
  request.auth = { user: fakeAuthUser(request.headers) }
})
await agenda.register(appointmentRoutes, { cashService: fakeService as never })
assert.equal((await agenda.inject({ method: 'GET', url: '/appointments/a/finance' })).statusCode, 403)
assert.equal((await agenda.inject({ method: 'GET', url: '/appointments/a/finance', headers: { 'x-payments': 'yes' } })).statusCode, 200)
assert.equal((await agenda.inject({ method: 'POST', url: '/appointments/a/payments', headers: { 'x-view': 'yes' }, payload: { cashSessionId: 'session', lines: [{ amount: 1, method: 'CASH' }] } })).statusCode, 403)
assert.equal((await agenda.inject({ method: 'PATCH', url: '/appointments/a/discount', headers: { 'x-discounts': 'yes' }, payload: { discountAmount: 1 } })).statusCode, 200)
assert.equal((await agenda.inject({ method: 'PATCH', url: '/appointments/a/discount', headers: { 'x-discounts': 'yes' }, payload: { discountType: 'AMOUNT', discountValue: 2_500 } })).statusCode, 200)
assert.equal((await agenda.inject({ method: 'PATCH', url: '/appointments/a/discount', headers: { 'x-payments': 'yes' }, payload: { discountType: 'PERCENTAGE', discountValue: 10 } })).statusCode, 403)
assert.equal((await agenda.inject({ method: 'PATCH', url: '/appointments/a/discount', headers: { 'x-discounts': 'yes' }, payload: { discountType: 'PERCENTAGE', discountValue: 12.5 } })).statusCode, 200)
assert.deepEqual(
  callInputs.findLast((call) => call.property === 'setAppointmentDiscount')?.input,
  { businessId: 'business-a', appointmentId: 'a', discountType: 'PERCENTAGE', discountValue: 12.5 }
)
assert.equal((await agenda.inject({ method: 'PATCH', url: '/appointments/a/discount', headers: { 'x-discounts': 'yes' }, payload: { discountType: 'PERCENTAGE', discountValue: 0 } })).statusCode, 400)
await agenda.close()

console.log('OK Caja routes: permisos, validación, errores, tenant y cursor/filtros.')

function fakeAuthUser(headers: Record<string, string | string[] | undefined>) {
  const role = String(headers['x-role'] ?? 'STAFF')
  return {
    id: 'user', email: 'user@example.test', name: 'User', role: role as 'STAFF', businessId: String(headers['x-business'] ?? 'business-a'),
    professionalId: null, staffProfile: 'SECRETARY', permissionPreset: 'CUSTOM', agendaScope: 'ALL' as const,
    canCreateAppointments: false, canEditAppointments: false, canCancelAppointments: false, canManageScheduleBlocks: false,
    canForceAppointments: false, canViewCustomers: false, canCreateCustomers: false, canEditCustomers: false,
    canManageCustomerNotes: false, canManageCustomerMarketing: false, canViewConversations: false, canReplyConversations: false,
    canManageDeposits: false, canViewOperationalReports: false, canViewFinancialAmounts: false, canCreateBusinesses: false,
    canViewCashRegister: headers['x-view'] === 'yes', canRecordAppointmentPayments: headers['x-payments'] === 'yes',
    canApplyDiscounts: headers['x-discounts'] === 'yes', canManageCashOperations: headers['x-operate'] === 'yes',
    canAdjustCash: headers['x-adjust'] === 'yes', canManageCashSessions: headers['x-sessions'] === 'yes', businessAccountStatus: 'ACTIVE' as const
  }
}
