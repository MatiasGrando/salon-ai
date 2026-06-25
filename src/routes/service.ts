import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function serviceRoutes(app: FastifyInstance) {

  app.post('/services', async (request, reply) => {

    const body = request.body as {
      name: string
      duration: number
      businessId: string
      category?: string
      price?: number | string | null
      aliases?: string[]
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)
    const businessId = body.businessId?.trim()
    const category = body.category?.trim()
    const price = body.price === null || body.price === undefined || body.price === ''
      ? null
      : Number(body.price)
    const aliases = body.aliases
      ?.map((alias) => alias.trim())
      .filter(Boolean)

    if (!businessId) {
      return reply.status(400).send({
        message: 'businessId es requerido'
      })
    }

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

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return reply.status(400).send({
        message: 'price debe ser mayor o igual a 0'
      })
    }

    const data = {
      name,
      duration,
      businessId,
      price,
      ...(category ? { category } : {}),
      ...(aliases?.length
        ? {
            aliases: {
              create: aliases.map((alias) => ({
                name: alias
              }))
            }
          }
        : {})
    }

    return prisma.service.create({
      data: data as any,
      include: {
        aliases: true
      }
    })
  })

  app.get('/services', async (request) => {
    const query = request.query as {
      businessId?: string
    }

    return prisma.service.findMany({
      where: query.businessId
        ? {
            businessId: query.businessId
          }
        : {},
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
      price?: number | string | null
      aliases?: string[]
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)
    const price = body.price === null || body.price === undefined || body.price === ''
      ? null
      : Number(body.price)

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

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return reply.status(400).send({
        message: 'price debe ser mayor o igual a 0'
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
          category: body.category?.trim() || null,
          price
        } as any,
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
