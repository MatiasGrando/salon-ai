import type { FastifyInstance } from 'fastify'
import { AppointmentService } from '../services/appointment-service.js'
import { prisma } from '../config/prisma.js'
import { staffCanUseProfessional } from '../services/staff-permission-service.js'

const service = new AppointmentService()

export async function appointmentRoutes(app: FastifyInstance) {

  app.post('/appointments', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCreateAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cargar turnos' })
    }

    const body = request.body as {
      customerId: string
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      force?: boolean
    }
    if (!await canUseProfessional(request.auth?.user, body.professionalId)) {
      return reply.status(403).send({ message: 'Tu perfil solo puede gestionar la agenda profesional asignada' })
    }
    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const result = await service.create({
      customerId: body.customerId,
      professionalId: body.professionalId,
      serviceId: body.serviceId,
      ...(body.serviceIds ? { serviceIds: body.serviceIds } : {}),
      startAt: body.startAt,
      ...(body.force === undefined ? {} : { force: body.force })
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.forceable !== undefined ? { forceable: result.forceable } : {}),
        ...(result.conflicts ? { conflicts: result.conflicts } : {})
      })
    }

    return result.appointment
  })

  app.get('/appointments', async (request) => {
    const query = request.query as {
      businessId?: string
      customerPhone?: string
      from?: string
      to?: string
      professionalId?: string
    }
    const appointments = await service.findAll({
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.customerPhone ? { customerPhone: query.customerPhone } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {})
    })
    return appointments.map((appointment) => appointmentForAuthenticatedUser(appointment, request.auth?.user))
  })

  app.patch('/appointments/:id/status', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCancelAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cancelar o cambiar el estado de turnos' })
    }

    const params = request.params as {
      id: string
    }

    const body = request.body as {
      status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
    }

    if (!await canAccessAppointment(request.auth?.user, params.id)) {
      return reply.status(403).send({ message: 'Tu perfil no puede modificar ese turno' })
    }

    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']

    if (!allowedStatuses.includes(body.status)) {
      return reply.status(400).send({
        message: 'Estado de turno invalido'
      })
    }

    const result = await service.updateStatus(params.id, body.status)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })

  app.patch('/appointments/:id', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canEditAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para editar turnos' })
    }

    const params = request.params as {
      id: string
    }

    const body = request.body as {
      customerId: string
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      force?: boolean
    }

    if (!await canAccessAppointment(request.auth?.user, params.id)) {
      return reply.status(403).send({ message: 'Tu perfil no puede modificar ese turno' })
    }
    if (!await canUseProfessional(request.auth?.user, body.professionalId)) {
      return reply.status(403).send({ message: 'Tu perfil solo puede gestionar la agenda profesional asignada' })
    }
    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const result = await service.update({
      id: params.id,
      ...body
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.forceable !== undefined ? { forceable: result.forceable } : {}),
        ...(result.conflicts ? { conflicts: result.conflicts } : {})
      })
    }

    return result.appointment
  })

  app.delete('/appointments/:id', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCancelAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cancelar turnos' })
    }

    const params = request.params as {
      id: string
    }

    if (!await canAccessAppointment(request.auth?.user, params.id)) {
      return reply.status(403).send({ message: 'Tu perfil no puede cancelar ese turno' })
    }

    const result = await service.cancel(params.id)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })
}

function appointmentForAuthenticatedUser<T extends {
  quotedPrice: number | null
  customer: { phone: string }
  service: { price: number | null }
  serviceItems: Array<{ service: { price: number | null } }>
}>(appointment: T, user: { role: string; canViewCustomers?: boolean; canViewFinancialAmounts?: boolean } | undefined) {
  if (!user || user.role !== 'STAFF') return appointment

  const customer = user.canViewCustomers
    ? appointment.customer
    : omitKey(appointment.customer, 'phone')
  const service = user.canViewFinancialAmounts
    ? appointment.service
    : omitKey(appointment.service, 'price')
  const serviceItems = user.canViewFinancialAmounts
    ? appointment.serviceItems
    : appointment.serviceItems.map((item) => ({
        ...item,
        service: omitKey(item.service, 'price')
      }))

  const protectedAppointment = {
    ...appointment,
    customer,
    service,
    serviceItems
  }
  return user.canViewFinancialAmounts
    ? protectedAppointment
    : omitKey(protectedAppointment, 'quotedPrice')
}

function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const result = { ...value }
  delete result[key]
  return result
}

async function canAccessAppointment(user: (Parameters<typeof staffCanUseProfessional>[0] & { businessId?: string | null }) | undefined, appointmentId: string) {
  if (!user) return false
  if (user.role !== 'STAFF') return true
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { professionalId: true, professional: { select: { businessId: true } } }
  })
  return Boolean(appointment && appointment.professional.businessId === user.businessId && staffCanUseProfessional(user, appointment.professionalId))
}

async function canUseProfessional(user: Parameters<typeof staffCanUseProfessional>[0] & { businessId?: string | null } | undefined, professionalId: string) {
  if (!user) return false
  if (user.role !== 'STAFF') return true
  const professional = await prisma.professional.findUnique({ where: { id: professionalId }, select: { businessId: true } })
  return professional?.businessId === user.businessId && staffCanUseProfessional(user, professionalId)
}

function hasAgendaPermission(
  auth: { user: { role: string; canCreateAppointments?: boolean; canEditAppointments?: boolean; canCancelAppointments?: boolean } } | undefined,
  permission: 'canCreateAppointments' | 'canEditAppointments' | 'canCancelAppointments'
) {
  if (!auth) return false
  if (auth.user.role !== 'STAFF') return true
  return auth.user[permission] !== false
}
