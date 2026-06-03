import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function serviceRoutes(app: FastifyInstance) {

  app.post('/services', async (request) => {

    const body = request.body as {
      name: string
      duration: number
      businessId: string
      category?: string
      aliases?: string[]
    }

    const data = {
      name: body.name,
      duration: body.duration,
      businessId: body.businessId,
      ...(body.category ? { category: body.category } : {}),
      ...(body.aliases
        ? {
            aliases: {
              create: body.aliases.map((alias) => ({
                name: alias
              }))
            }
          }
        : {})
    }

    return prisma.service.create({
      data
    })
  })

  app.get('/services', async () => {
    return prisma.service.findMany({
      include: {
        aliases: true
      }
    })
  })

  app.post('/services/:serviceId/aliases', async (request) => {

    const params = request.params as {
      serviceId: string
    }

    const body = request.body as {
      aliases: string[]
    }

    return prisma.serviceAlias.createMany({
      data: body.aliases.map((alias) => ({
        name: alias,
        serviceId: params.serviceId
      }))
    })
  })

}
