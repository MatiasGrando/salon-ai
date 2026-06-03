import type { FastifyInstance } from 'fastify'
import { AppointmentService } from '../services/appointment-service.js'

const service = new AppointmentService()

export async function availabilityRoutes(app: FastifyInstance) {

  app.get('/availability', async (request, reply) => {

    const query = request.query as {
      professionalId?: string
      serviceId?: string
      date?: string
    }

    if (!query.professionalId || !query.serviceId || !query.date) {
      return reply.status(400).send({
        message: 'professionalId, serviceId y date son requeridos'
      })
    }

    const result = await service.findAvailability({
      professionalId: query.professionalId,
      serviceId: query.serviceId,
      date: query.date
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.slots
  })
}
