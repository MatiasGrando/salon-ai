import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function professionalRoutes(app: FastifyInstance) {

  app.post('/professionals', async (request) => {

    const body = request.body as {
      name: string
      businessId: string
    }

    const professional = await prisma.professional.create({
      data: {
        name: body.name,
        businessId: body.businessId
      }
    })

    return professional
  })

  app.get('/professionals', async () => {
    return prisma.professional.findMany()
  })

}
