import type { FastifyInstance } from 'fastify'
import { AppointmentService } from '../services/appointment-service.js'

const service = new AppointmentService()

export async function appointmentRoutes(app: FastifyInstance) {

  app.post('/appointments', async (request, reply) => {

    const body = request.body as {
      customerId: string
      professionalId: string
      serviceId: string
      startAt: string
    }

    const result = await service.create(body)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })

  app.get('/appointments', async () => {
    return service.findAll()
  })
}
