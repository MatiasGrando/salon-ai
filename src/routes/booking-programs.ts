import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { BookingProgramService, type RecurringInput } from '../services/booking-program-service.js'
import { CustomerBenefitsService, reserveBenefit, type BenefitPlanInput } from '../services/customer-benefits.js'
import { BookingProgramError } from '../services/booking-program-domain.js'
import { loadAuthorizedBusiness, loadAuthorizedCustomer } from '../services/tenant-resource-authorization.js'
import { staffCanUseProfessional } from '../services/staff-permission-service.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'

export async function bookingProgramRoutes(app: FastifyInstance) {
  const programs = new BookingProgramService(prisma), benefits = new CustomerBenefitsService(prisma)
  async function scope(request: FastifyRequest, reply: FastifyReply) {
    const input = { ...(request.query as object || {}), ...(request.body as object || {}) } as { businessId?: string; professionalId?: string }
    const user = request.auth?.user
    if (!user) { reply.status(401).send({ message: 'Inicia sesion para continuar.' }); return null }
    if (!input.businessId || !await loadAuthorizedBusiness(prisma, user, input.businessId)) { reply.status(404).send({ message: 'No encontre ese comercio.' }); return null }
    if (input.professionalId && (!staffCanUseProfessional(user, input.professionalId) || !await prisma.professional.findFirst({ where: { businessId: input.businessId, id: input.professionalId } }))) { reply.status(404).send({ message: 'No encontre ese profesional.' }); return null }
    return { businessId: input.businessId, user }
  }
  const handle = (handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply) } catch (error) {
      if (error instanceof BookingProgramError) return reply.status(error.statusCode).send({ code: error.code, message: error.message })
      throw error
    }
  }
  app.get('/availability-weeks', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const q = request.query as { professionalId: string; weekStart: string }
    return programs.getWeek(auth.businessId, q.professionalId, q.weekStart)
  }))
  app.put('/availability-weeks/mode', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const b = request.body as { professionalId: string; mode: string }
    await programs.setMode(auth.businessId, b.professionalId, b.mode)
    await programs.refresh(auth.businessId)
    return { ok: true }
  }))
  app.put('/availability-weeks', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const b = request.body as Parameters<BookingProgramService['saveWeek']>[0]
    if (!['DRAFT', 'PREVIEW', 'PUBLISH'].includes(b.action)) return reply.status(400).send({ message: 'Accion invalida.' })
    return programs.saveWeek({ ...b, businessId: auth.businessId })
  }))
  app.get('/recurring-bookings', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const q = request.query as { professionalId?: string; customerId?: string }
    return prisma.recurringBooking.findMany({ where: { businessId: auth.businessId, ...(q.customerId ? { customerId: q.customerId } : {}), ...(auth.user.role === 'STAFF' && auth.user.agendaScope === 'OWN' ? { professionalId: auth.user.professionalId || '' } : q.professionalId ? { professionalId: q.professionalId } : {}) }, include: { customer: { select: { id: true, name: true } }, professional: { select: { name: true } }, service: { select: { name: true } }, occurrences: { where: { status: 'CONFLICT' }, orderBy: { date: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 500 })
  }))
  app.post('/recurring-bookings', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    return programs.createRule(auth.businessId, request.body as RecurringInput)
  }))
  app.patch('/recurring-bookings/:id', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const { id } = request.params as { id: string }
    const rule = await prisma.recurringBooking.findFirst({ where: { businessId: auth.businessId, id } })
    if (!rule || !staffCanUseProfessional(auth.user, rule.professionalId)) return reply.status(404).send({ message: 'No encontre esa repeticion.' })
    return programs.changeRule(auth.businessId, id, request.body as { status: string; revision: number })
  }))
  app.post('/recurring-bookings/:id/skip', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const { id } = request.params as { id: string }, b = request.body as { date: string }
    const rule = await prisma.recurringBooking.findFirst({ where: { businessId: auth.businessId, id } })
    if (!rule || !staffCanUseProfessional(auth.user, rule.professionalId)) return reply.status(404).send({ message: 'No encontre esa repeticion.' })
    return programs.skip(auth.businessId, id, b.date)
  }))
  app.post('/recurring-bookings/refresh', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    await programs.refresh(auth.businessId)
    return { ok: true }
  }))
  app.get('/benefit-plans', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    return prisma.benefitPlan.findMany({ where: { businessId: auth.businessId }, orderBy: { name: 'asc' } })
  }))
  app.post('/benefit-plans', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    return benefits.savePlan(auth.businessId, request.body as BenefitPlanInput)
  }))
  app.put('/benefit-plans/:id', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    return benefits.savePlan(auth.businessId, request.body as BenefitPlanInput, (request.params as { id: string }).id)
  }))
  app.get('/customers/:id/benefits', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const { id } = request.params as { id: string }
    if (!await loadAuthorizedCustomer(prisma, auth.user, id)) return reply.status(404).send({ message: 'No encontre ese cliente.' })
    return benefits.list(auth.businessId, id)
  }))
  app.post('/customer-benefits', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    return benefits.purchase({ ...(request.body as Parameters<CustomerBenefitsService['purchase']>[0]), businessId: auth.businessId })
  }))
  app.post('/customer-benefits/quote', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const b = request.body as { customerId: string; date: string; serviceIds: string[] }
    const customer = await loadAuthorizedCustomer(prisma, auth.user, b.customerId)
    if (!customer || customer.businessId !== auth.businessId) return reply.status(404).send({ message: 'No encontre ese cliente.' })
    return benefits.quote(auth.businessId, b.customerId, b.date, b.serviceIds)
  }))
  app.post('/customer-benefits/apply', handle(async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return
    const b = request.body as { customerId: string; appointmentId: string; benefitId: string }
    if (!b.benefitId || !await loadAuthorizedCustomer(prisma, auth.user, b.customerId)) return reply.status(404).send({ message: 'No encontre ese beneficio.' })
    const appointment = await prisma.appointment.findFirst({ where: { businessId: auth.businessId, customerId: b.customerId, id: b.appointmentId } })
    if (!appointment || !staffCanUseProfessional(auth.user, appointment.professionalId)) return reply.status(404).send({ message: 'No encontre ese turno.' })
    return prisma.$transaction(async tx => {
      await acquireAgendaHierarchy(tx, { businessId: auth.businessId, professionalIds: [appointment.professionalId] })
      return reserveBenefit(tx, { businessId: auth.businessId, ...b })
    })
  }))
}
