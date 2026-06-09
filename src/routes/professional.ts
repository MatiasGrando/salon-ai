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

  app.patch('/professionals/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
    }
    const name = body.name?.trim()

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    return prisma.professional.update({
      where: {
        id: params.id
      },
      data: {
        name
      }
    })
  })

  app.delete('/professionals/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }

    const appointmentCount = await prisma.appointment.count({
      where: {
        professionalId: params.id
      }
    })

    if (appointmentCount > 0) {
      return reply.status(409).send({
        message: 'No se puede eliminar porque tiene turnos asociados. En el próximo paso podemos agregar desactivar.'
      })
    }

    await prisma.$transaction([
      prisma.professionalHours.deleteMany({
        where: {
          professionalId: params.id
        }
      }),
      prisma.scheduleBlock.deleteMany({
        where: {
          professionalId: params.id
        }
      }),
      prisma.professional.delete({
        where: {
          id: params.id
        }
      })
    ])

    return {
      deleted: true
    }
  })

}
