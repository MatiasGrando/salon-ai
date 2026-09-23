import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [cashRouteSource, appointmentSource, serverSource] = await Promise.all([
  readFile(path.join(process.cwd(), 'src', 'routes', 'cash-register.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'appointment.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'server.ts'), 'utf8')
])
for (const route of ['/cash-register/current', '/cash-register/payment-context', '/cash-register/period/summary', '/cash-register/period/expenses', '/cash-register/days', '/cash-register/open', '/cash-register/new-session', '/cash-register/close', '/cash-register/entries']) {
  assert.ok(cashRouteSource.includes(`'${route}'`), `falta ruta ${route}`)
}
for (const suffix of ['/finance', '/estimated-total', '/discount', '/payments']) assert.ok(appointmentSource.includes(suffix), `falta endpoint Agenda ${suffix}`)
assert.ok(appointmentSource.includes("'/appointments/finance-summaries'"), 'falta refresco liviano de resumenes de Agenda')
assert.match(appointmentSource, /includeFinanceSummary:\s*canViewFinance/, 'el listado de Agenda debe precargar resumenes cuando el usuario puede ver pagos')
assert.match(serverSource, /register\(cashRegisterRoutes\)/)
assert.match(cashRouteSource, /nextCursor/)
assert.match(cashRouteSource, /CASH_PERMISSION_REQUIRED/)
assert.match(cashRouteSource, /role: \{ in: \['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'STAFF'\] \}/, 'responsables debe incluir al administrador de cuenta vinculado al local')
assert.match(cashRouteSource, /select: \{ id: true, name: true, role: true \}/, 'responsables debe informar el rol para distinguir al administrador en la interfaz')

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
    if (property === 'listCashPeriodExpenses') return { entries: [], page: 2, pageSize: 10, total: 0, totalPages: 1 }
    return { ok: true }
  }
})
const app = Fastify()
app.addHook('preHandler', async (request) => {
  request.auth = { user: fakeAuthUser(request.headers) }
})
await app.register(cashRegisterRoutes, { cashService: fakeService as never, authorizeBusiness: async (user: { role: string }, businessId: string) => user.role !== 'ACCOUNT_ADMIN' || businessId === 'managed-business' })

assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current' })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current', headers: { 'x-view': 'yes' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current?businessId=managed-business', headers: { 'x-role': 'ACCOUNT_ADMIN' } })).statusCode, 200)
assert.equal(calls.some((call) => call.endsWith(':managed-business')), true, 'ACCOUNT_ADMIN debe operar sobre el comercio activo ya validado por el auth guard')
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current?businessId=foreign-business', headers: { 'x-role': 'ACCOUNT_ADMIN' } })).statusCode, 404)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/current', headers: { 'x-view': 'yes', 'x-business': 'missing' } })).statusCode, 404)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context' })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context', headers: { 'x-view': 'yes' } })).statusCode, 403)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/payment-context', headers: { 'x-payments': 'yes' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/open', headers: { 'x-sessions': 'yes' }, payload: {} })).statusCode, 400)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/new-session', headers: { 'x-sessions': 'yes' }, payload: { currentSessionId: 'session', responsibleUserId: 'next-user', countedCash: 90, acknowledgeDifference: true } })).statusCode, 200)
assert.equal(callInputs.findLast((call) => call.property === 'startNewSession')?.input.acknowledgeDifference, true)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/close', headers: { 'x-sessions': 'yes' }, payload: { currentSessionId: 'session', countedCash: 120_000, cashToLeave: 20_000 } })).statusCode, 403, 'el personal no puede mover fondos a Tesoreria')
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/close', headers: { 'x-role': 'BUSINESS_ADMIN' }, payload: { currentSessionId: 'session', countedCash: 120_000, cashToLeave: 20_000 } })).statusCode, 200)
assert.deepEqual(callInputs.findLast((call) => call.property === 'closeRegisterDay')?.input, { businessId: 'business-a', currentSessionId: 'session', countedCash: 120_000, cashToLeave: 20_000, actorUserId: 'user', actorName: 'User', acknowledgeDifference: false })
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/close', headers: { 'x-role': 'BUSINESS_ADMIN' }, payload: { currentSessionId: 'session', countedCash: 100, cashToLeave: '20' } })).statusCode, 400)

assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-operate': 'yes' }, payload: { cashSessionId: 'session', type: 'EXPENSE', amount: 10, description: 'closed' } })).statusCode, 409)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-adjust': 'yes' }, payload: { cashSessionId: 'session', type: 'EXPENSE', amount: 10, description: 'x' } })).statusCode, 403)
assert.equal((await app.inject({ method: 'POST', url: '/cash-register/entries', headers: { 'x-operate': 'yes' }, payload: { businessId: 'foreign-business', cashSessionId: 'session', type: 'CASH_IN', amount: 10, description: 'x' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/days/day/entries?type=UNKNOWN', headers: { 'x-view': 'yes' } })).statusCode, 400)
const page = await app.inject({ method: 'GET', url: '/cash-register/days/day/entries?cursor=abc&type=EXPENSE&method=CASH&sessionId=session-1&q=cliente', headers: { 'x-view': 'yes' } })
assert.equal(page.statusCode, 200)
assert.equal(page.json().nextCursor, 'cursor-2')
assert.equal(callInputs.findLast((call) => call.property === 'listCashEntries')?.input.cashSessionId, 'session-1')
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/period/summary', headers: { 'x-view': 'yes' } })).statusCode, 400)
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/period/summary?from=2026-09-01&to=2026-09-30', headers: { 'x-view': 'yes' } })).statusCode, 200)
assert.deepEqual(callInputs.findLast((call) => call.property === 'getCashPeriodSummary')?.input, { businessId: 'business-a', from: '2026-09-01', to: '2026-09-30', registerOnly: true })
assert.equal((await app.inject({ method: 'GET', url: '/cash-register/period/expenses?from=2026-09-01&to=2026-09-30&page=2&pageSize=10&method=CASH&categoryId=category-1&q=luz', headers: { 'x-view': 'yes' } })).statusCode, 200)
assert.deepEqual(callInputs.findLast((call) => call.property === 'listCashPeriodExpenses')?.input, { businessId: 'business-a', registerOnly: true, from: '2026-09-01', to: '2026-09-30', page: 2, pageSize: 10, method: 'CASH', expenseCategoryId: 'category-1', query: 'luz' })
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
assert.equal((await agenda.inject({ method: 'GET', url: '/appointments/a/finance?businessId=managed-business', headers: { 'x-role': 'ACCOUNT_ADMIN' } })).statusCode, 200)
assert.equal(calls.some((call) => call === 'getAppointmentFinance:managed-business'), true, 'ACCOUNT_ADMIN debe consultar pagos del comercio activo')
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
    canAdjustCash: headers['x-adjust'] === 'yes', canManageCashSessions: headers['x-sessions'] === 'yes',
    canViewProfessionalSettlements: false, canManageProfessionalSettlements: false, canViewTodayProfessionalProduction: false, businessAccountStatus: 'ACTIVE' as const
  }
}
