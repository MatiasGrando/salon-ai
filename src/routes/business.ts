import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function businessRoutes(app: FastifyInstance) {

  app.post('/businesses', async (request) => {

    const body = request.body as {
      name: string
    }

    const business = await prisma.business.create({
      data: {
        name: body.name
      }
    })

    return business
  })

}
