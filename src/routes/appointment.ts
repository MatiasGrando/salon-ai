import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import { sendAuthorizationFailure } from '../services/authorization-response.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'

const service = new AppointmentService()

export async function appointmentRoutes(app: FastifyInstance) {

  app.post('/appointments/check-availability', async (request, reply) => {
    const body = request.body as {
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      appointmentId?: string
    }
    const permission = body.appointmentId ? 'canEditAppointments' : 'canCreateAppointments'
    if (!hasAgendaPermission(request.auth, permission)) {
      return reply.status(403).send({
        message: body.appointmentId ? 'No tenes permiso para editar turnos' : 'No tenes permiso para cargar turnos'
      })
    }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')

    const result = await service.checkManualAvailability(body, authUser)
    if (!result.ok) return reply.status(result.statusCode).send({ message: result.message })
    return { conflicts: result.conflicts }
  })

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
      manualDepositPaid?: boolean
      manualDepositAmount?: number | string | null
      notes?: string | null
    }
    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.create({
      customerId: body.customerId,
      professionalId: body.professionalId,
      serviceId: body.serviceId,
      ...(body.serviceIds ? { serviceIds: body.serviceIds } : {}),
      startAt: body.startAt,
      origin: 'MANUAL',
      ...(body.manualDepositPaid === undefined ? {} : { manualDepositPaid: body.manualDepositPaid }),
      ...(body.manualDepositAmount === undefined ? {} : { manualDepositAmount: body.manualDepositAmount }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
      ...(body.force === undefined ? {} : { force: body.force })
    }, authUser)

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

  app.get('/appointments', async (request, reply) => {
    const query = request.query as {
      businessId?: string
      customerPhone?: string
      from?: string
      to?: string
      professionalId?: string
    }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!query.businessId) {
      return reply.status(400).send({ message: 'businessId es requerido para consultar turnos' })
    }
    const business = await requireAuthorizedBusiness(prisma, authUser, query.businessId)
    if (!business) return sendAuthorizationFailure(reply, 'notFound')

    const appointments = await service.findAll({
      businessId: query.businessId,
      ...(query.customerPhone ? { customerPhone: query.customerPhone } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {})
    })
    return appointments.map((appointment) => appointmentForAuthenticatedUser(appointment, authUser))
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

    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']

    if (!allowedStatuses.includes(body.status)) {
      return reply.status(400).send({
        message: 'Estado de turno invalido'
      })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.updateStatus(params.id, body.status, authUser)

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
      manualDepositPaid?: boolean
      manualDepositAmount?: number | string | null
      notes?: string | null
    }

    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.update({
      id: params.id,
      ...body
    }, authUser)

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

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.cancel(params.id, authUser)

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
  manualDepositAmount: number | null
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
  if (user.canViewFinancialAmounts) return protectedAppointment

  const {
    quotedPrice: _quotedPrice,
    manualDepositAmount: _manualDepositAmount,
    ...appointmentWithoutFinancialAmounts
  } = protectedAppointment
  return appointmentWithoutFinancialAmounts
}

function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const result = { ...value }
  delete result[key]
  return result
}

function hasAgendaPermission(
  auth: { user: { role: string; canCreateAppointments?: boolean; canEditAppointments?: boolean; canCancelAppointments?: boolean } } | undefined,
  permission: 'canCreateAppointments' | 'canEditAppointments' | 'canCancelAppointments'
) {
  if (!auth) return false
  if (auth.user.role !== 'STAFF') return true
  return auth.user[permission] !== false
}
