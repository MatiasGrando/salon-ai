import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function professionalRoutes(app: FastifyInstance) {

  app.post('/professionals', async (request, reply) => {

    const body = request.body as {
      name: string
      businessId: string
      workingHours?: Array<{
        dayOfWeek: number
        startTime: string
        endTime: string
      }>
    }

    const name = body.name?.trim()
    const workingHours = body.workingHours
      ? normalizeWorkingHours(body.workingHours)
      : []

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    return prisma.professional.create({
      data: {
        name,
        businessId: body.businessId,
        ...(workingHours.length > 0
          ? {
              workingHours: {
                create: workingHours
              }
            }
          : {})
      },
      include: {
        workingHours: {
          orderBy: {
            dayOfWeek: 'asc'
          }
        }
      }
    })
  })

  app.get('/professionals', async () => {
    return prisma.professional.findMany({
      include: {
        workingHours: {
          orderBy: {
            dayOfWeek: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    })
  })

  app.patch('/professionals/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      workingHours?: Array<{
        dayOfWeek: number
        startTime: string
        endTime: string
      }>
    }
    const name = body.name?.trim()

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    return prisma.$transaction(async (tx) => {
      await tx.professional.update({
        where: {
          id: params.id
        },
        data: {
          name
        }
      })

      if (body.workingHours) {
        await tx.professionalHours.deleteMany({
          where: {
            professionalId: params.id
          }
        })

        const workingHours = normalizeWorkingHours(body.workingHours)

        if (workingHours.length > 0) {
          await tx.professionalHours.createMany({
            data: workingHours.map((hour) => ({
              ...hour,
              professionalId: params.id
            }))
          })
        }
      }

      return tx.professional.findUnique({
        where: {
          id: params.id
        },
        include: {
          workingHours: {
            orderBy: {
              dayOfWeek: 'asc'
            }
          }
        }
      })
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

function normalizeWorkingHours(hours: Array<{
  dayOfWeek: number
  startTime: string
  endTime: string
}>) {
  const validHours = hours
    .filter((hour) => {
      return Number.isInteger(hour.dayOfWeek) &&
        hour.dayOfWeek >= 0 &&
        hour.dayOfWeek <= 6 &&
        /^\d{2}:\d{2}$/.test(hour.startTime) &&
        /^\d{2}:\d{2}$/.test(hour.endTime) &&
        hour.startTime < hour.endTime
    })

  return Array.from(
    new Map(validHours.map((hour) => [hour.dayOfWeek, hour])).values()
  )
}
