import type { FastifyInstance } from 'fastify'
import { AppointmentService } from '../services/appointment-service.js'

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
      startAt: string
      force?: boolean
    }

    const result = await service.create(body)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
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
    return service.findAll({
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.customerPhone ? { customerPhone: query.customerPhone } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {})
    })
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
      startAt: string
      force?: boolean
    }

    const result = await service.update({
      id: params.id,
      ...body
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
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

    const result = await service.cancel(params.id)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })
}

function hasAgendaPermission(
  auth: { user: { role: string; canCreateAppointments?: boolean; canEditAppointments?: boolean; canCancelAppointments?: boolean } } | undefined,
  permission: 'canCreateAppointments' | 'canEditAppointments' | 'canCancelAppointments'
) {
  if (!auth) return false
  if (auth.user.role !== 'STAFF') return true
  return auth.user[permission] !== false
}
