import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function customerRoutes(app: FastifyInstance) {

  app.post('/customers', async (request) => {

    const body = request.body as {
      name: string
      phone: string
    }

    return prisma.customer.create({
      data: {
        name: body.name,
        phone: body.phone
      }
    })
  })

  app.get('/customers', async () => {
    return prisma.customer.findMany()
  })

}
