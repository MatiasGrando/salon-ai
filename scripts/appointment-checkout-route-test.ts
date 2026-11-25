import assert from 'node:assert/strict'
import Fastify from 'fastify'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_appointment_test'
process.env.DOTENV_CONFIG_PATH = 'C:/__appointment_offline_no_env__'
const [{ prisma }, { appointmentRoutes }, { CashServiceError }, { AppointmentMutationRequestError }, { AppointmentService }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/appointment.js'), import('../src/services/cash-service.js'),
  import('../src/services/appointment-mutation-request.js'), import('../src/services/appointment-service.js')
])
const db = prisma as any
const before = { business: db.business.findFirst, appointment: db.appointment.findFirst, create: AppointmentService.prototype.create }
let user: any = { id: 'actor', name: 'Admin', role: 'ACCOUNT_ADMIN', businessId: null, canCreateBusinesses: false }
let authorized = false, summaryCalls = 0, legacyCalls = 0, paymentInput: any, createOptions: any
const fakeCash: any = {
  getAppointmentFinanceSummary: async (input: any) => { summaryCalls++; return { ...input, accountId: null, appointmentIds: [input.appointmentId], agreedAmount: 10000, paidAmount: 0, balanceAmount: 10000 } },
  getAppointmentFinance: async () => { legacyCalls++; return { entries: [], serviceCorrections: [] } },
  recordAppointmentPayment: async (input: any) => { paymentInput = input; if (input.requestId === 'conflict') throw new AppointmentMutationRequestError('APPOINTMENT_REQUEST_CONFLICT'); if (input.expectedBalance === 1) throw new CashServiceError('APPOINTMENT_BALANCE_CHANGED'); return { entries: [], completion: null, finance: { balanceAmount: 0 } } }
}
const app = Fastify()
try {
  db.business.findFirst = async () => authorized ? { id: 'b' } : null
  db.appointment.findFirst = async () => ({ professionalId: 'p', professional: { businessId: 'b' } })
  AppointmentService.prototype.create = async function (_input, _user, options) { createOptions = options; return { ok: true, appointment: { id: 'created' } as any } }
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request: any) => { request.auth = { user } })
  await app.register(appointmentRoutes, { cashService: fakeCash })
  const denied = await app.inject({ method: 'GET', url: '/appointments/turn/finance?businessId=b&view=summary' })
  assert.equal(denied.statusCode, 404, 'summary must revalidate an account administrator assignment')
  assert.equal(summaryCalls, 0)
  authorized = true
  const summary = await app.inject({ method: 'GET', url: '/appointments/turn/finance?businessId=b&view=summary' })
  assert.equal(summary.statusCode, 200, summary.body)
  assert.equal(summary.json().accountId, null)
  assert.equal(summaryCalls, 1)
  assert.equal(legacyCalls, 0, 'summary endpoint must not fall through to account-initializing legacy read')
  user = { ...user, role: 'STAFF', staffProfile: 'PROFESSIONAL', agendaScope: 'OWN', professionalId: 'p', businessId: 'b', canCreateAppointments: true, canRecordAppointmentPayments: true, canCompleteAppointments: false }
  const own = await app.inject({ method: 'GET', url: '/appointments/turn/finance?view=summary' })
  assert.equal(own.statusCode, 200)
  assert.equal(own.json().allowedProfessionalId, 'p')
  const payload = { cashSessionId: 'session', lines: [{ amount: 10000, method: 'CASH' }], requestId: 'intent', expectedBalance: 10000 }
  const pay = await app.inject({ method: 'POST', url: '/appointments/turn/payments', payload })
  assert.equal(pay.statusCode, 200, pay.body)
  assert.equal(paymentInput.actorUserId, 'actor')
  assert.equal(paymentInput.requestId, 'intent')
  assert.equal(paymentInput.expectedBalance, 10000)
  assert.equal(paymentInput.allowedProfessionalId, 'p')
  const completeDenied = await app.inject({ method: 'POST', url: '/appointments/turn/payments', payload: { ...payload, completeAppointment: true } })
  assert.equal(completeDenied.statusCode, 403)
  for (const [patch, expectedCode] of [[{ requestId: 'conflict' }, 'APPOINTMENT_REQUEST_CONFLICT'], [{ expectedBalance: 1 }, 'APPOINTMENT_BALANCE_CHANGED']] as const) {
    const response = await app.inject({ method: 'POST', url: '/appointments/turn/payments', payload: { ...payload, ...patch } })
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, expectedCode)
  }
  const create = await app.inject({ method: 'POST', url: '/appointments', payload: { requestId: 'create-intent', customerId: 'c', professionalId: 'p', serviceId: 's', startAt: '2026-11-24T15:00:00Z' } })
  assert.equal(create.statusCode, 200, create.body)
  assert.equal(createOptions.mutationRequest.requestId, 'create-intent')
  assert.match(createOptions.mutationRequest.requestFingerprint, /^[a-f0-9]{64}$/)
  const invalid = await app.inject({ method: 'POST', url: '/appointments', payload: { requestId: '', customerId: 'c', professionalId: 'p', serviceId: 's', startAt: '2026-11-24T15:00:00Z' } })
  assert.equal(invalid.statusCode, 400)
  const { authGuard } = await import('../src/plugins/auth-guard.js')
  const hooks: Record<string, any> = {}
  await authGuard({ addHook: (name: string, hook: any) => { hooks[name] = hook } } as any)
  const originalAudit = db.staffAuditLog.create
  let auditWrites = 0
  db.staffAuditLog.create = async () => { auditWrites++; return {} }
  try {
    const request = { auth: { user }, method: 'POST', url: '/appointments/turn/payments', params: { id: 'turn' }, appointmentMutationReplayed: true, log: { error: () => {} } }
    await hooks.onResponse(request, { statusCode: 200 })
    assert.equal(auditWrites, 0, 'replaying an appointment mutation must not duplicate staff audit')
    request.appointmentMutationReplayed = false
    await hooks.onResponse(request, { statusCode: 200 })
    assert.equal(auditWrites, 1, 'normal successful staff mutations remain audited')
  } finally { db.staffAuditLog.create = originalAudit }
  console.log('appointment checkout routes: pure summary, account tenant, OWN scope, request metadata, independent completion permission and409 errors OK')
} finally { db.business.findFirst = before.business; db.appointment.findFirst = before.appointment; AppointmentService.prototype.create = before.create; await app.close(); await prisma.$disconnect() }
