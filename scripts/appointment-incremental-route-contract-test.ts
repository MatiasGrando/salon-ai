import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/config/prisma.js'
import { AppointmentService } from '../src/services/appointment-service.js'
import { appointmentRoutes } from '../src/routes/appointment.js'

const prismaClient = prisma as any
const appointmentModel = prismaClient.appointment
const businessModel = prismaClient.business
const originalFindAll = AppointmentService.prototype.findAll
const originalUpdate = AppointmentService.prototype.update
const originalBusinessFindFirst = businessModel.findFirst
const originalAppointmentFindFirst = appointmentModel.findFirst
const calls: any[] = []

try {
  businessModel.findFirst = async () => ({ id: 'business-test' })
  appointmentModel.findFirst = async () => null
  AppointmentService.prototype.findAll = async function (input: any) {
    calls.push(input)
    return []
  }
  AppointmentService.prototype.update = async function (_input, _user, mark) {
    mark?.('precheck')
    return { ok: false, statusCode: 409, message: 'Conflicto de horario' }
  }

  const app = Fastify()
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request) => {
    ;(request as any).auth = {
      user: {
        id: 'user-test',
        role: 'SUPER_ADMIN',
        businessId: null,
        canCreateBusinesses: true
      }
    }
  })
  await app.register(appointmentRoutes, { cashService: {
    async recordAppointmentPayment(_input: unknown, mark?: (name: string) => void) {
      mark?.('cash-lock')
      return { entries: [] }
    }
  } as any })

  const moved = await app.inject({ method: 'PATCH', url: '/appointments/appointment-test', payload: {} })
  assert.equal(moved.statusCode, 409)
  assert.match(String(moved.headers['server-timing']), /^precheck;dur=\d+, server;dur=\d+$/)
  const paid = await app.inject({
    method: 'POST',
    url: '/appointments/appointment-test/payments',
    payload: { businessId: 'business-test', cashSessionId: 'session-test', lines: [] }
  })
  assert.equal(paid.statusCode, 200)
  assert.match(String(paid.headers['server-timing']), /^cash-lock;dur=\d+, server;dur=\d+$/)

  const valid = await app.inject({
    method: 'GET',
    url: '/appointments?businessId=business-test&appointmentId=appointment-test&from=2026-11-16T00%3A00%3A00.000Z&to=2026-11-17T00%3A00%3A00.000Z&professionalId=professional-test&includeFinance=false'
  })
  assert.equal(valid.statusCode, 200)
  assert.deepEqual(calls[0], {
    businessId: 'business-test',
    appointmentId: 'appointment-test',
    from: '2026-11-16T00:00:00.000Z',
    to: '2026-11-17T00:00:00.000Z',
    professionalId: 'professional-test',
    includeFinanceSummary: false
  })
  assert.deepEqual(valid.json(), [])

  for (const query of ['appointmentId=', 'appointmentId=%20', 'appointmentId=a&appointmentId=b']) {
    const before = calls.length
    const response = await app.inject({
      method: 'GET',
      url: `/appointments?businessId=business-test&${query}`
    })
    assert.equal(response.statusCode, 400, `${query} must be rejected`)
    assert.equal(calls.length, before, `${query} must not trigger a bulk lookup`)
  }

  await app.close()
  console.log('OK: GET /appointments supports a tenant-scoped incremental lookup without changing filters or response shape.')
} finally {
  AppointmentService.prototype.findAll = originalFindAll
  AppointmentService.prototype.update = originalUpdate
  businessModel.findFirst = originalBusinessFindFirst
  appointmentModel.findFirst = originalAppointmentFindFirst
  await prisma.$disconnect()
}
