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

  app.patch('/services/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      duration?: number
      category?: string | null
      aliases?: string[]
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return reply.status(400).send({
        message: 'duration debe ser mayor a 0'
      })
    }

    const aliases = body.aliases
      ?.map((alias) => alias.trim())
      .filter(Boolean)

    return prisma.$transaction(async (tx) => {
      const service = await tx.service.update({
        where: {
          id: params.id
        },
        data: {
          name,
          duration,
          category: body.category?.trim() || null
        },
        include: {
          aliases: true
        }
      })

      if (aliases) {
        await tx.serviceAlias.deleteMany({
          where: {
            serviceId: params.id
          }
        })

        if (aliases.length > 0) {
          await tx.serviceAlias.createMany({
            data: aliases.map((alias) => ({
              name: alias,
              serviceId: params.id
            }))
          })
        }
      }

      return tx.service.findUnique({
        where: {
          id: service.id
        },
        include: {
          aliases: true
        }
      })
    })
  })

  app.delete('/services/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }

    const appointmentCount = await prisma.appointment.count({
      where: {
        serviceId: params.id
      }
    })

    if (appointmentCount > 0) {
      return reply.status(409).send({
        message: 'No se puede eliminar porque tiene turnos asociados. En el próximo paso podemos agregar desactivar.'
      })
    }

    await prisma.$transaction([
      prisma.serviceAlias.deleteMany({
        where: {
          serviceId: params.id
        }
      }),
      prisma.service.delete({
        where: {
          id: params.id
        }
      })
    ])

    return {
      deleted: true
    }
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
