import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

type WorkingHourInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
}

export async function professionalRoutes(app: FastifyInstance) {
  app.post('/professionals', async (request, reply) => {
    const body = request.body as {
      name: string
      businessId: string
      workingHours?: WorkingHourInput[]
    }

    const name = body.name?.trim()
    const businessId = body.businessId?.trim()
    const workingHours = body.workingHours
      ? normalizeWorkingHours(body.workingHours)
      : []

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

    return prisma.professional.create({
      data: {
        name,
        businessId,
        ...(workingHours.length > 0
          ? {
              workingHours: {
                create: workingHours
              }
            }
          : {})
      },
      include: professionalInclude
    })
  })

  app.get('/professionals', async (request) => {
    const query = request.query as {
      activeOnly?: string
    }

    return prisma.professional.findMany({
      where: query.activeOnly === 'true'
        ? {
            isActive: true
          }
        : {},
      include: professionalInclude,
      orderBy: {
        createdAt: 'asc'
      }
    })
  })

  app.get('/professionals/:id/appointments-impact', async (request) => {
    const params = request.params as {
      id: string
    }
    const query = request.query as {
      workingHours?: string
    }
    const workingHours = query.workingHours
      ? normalizeWorkingHours(JSON.parse(query.workingHours) as WorkingHourInput[])
      : undefined

    return getProfessionalAppointmentImpact(params.id, workingHours)
  })

  app.patch('/professionals/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      workingHours?: WorkingHourInput[]
      conflictStrategy?: 'KEEP_EXISTING'
    }
    const name = body.name?.trim()

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    const workingHours = body.workingHours
      ? normalizeWorkingHours(body.workingHours)
      : undefined

    if (workingHours) {
      const impact = await getProfessionalAppointmentImpact(params.id, workingHours)
      if (impact.outsideWorkingHours.length > 0 && body.conflictStrategy !== 'KEEP_EXISTING') {
        return reply.status(409).send({
          code: 'WORKING_HOURS_CONFLICT',
          message: 'Hay turnos futuros que quedan fuera del nuevo horario.',
          impact
        })
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.professional.update({
        where: {
          id: params.id
        },
        data: {
          name,
          isActive: true,
          deactivatedAt: null
        }
      })

      if (workingHours) {
        await tx.professionalHours.deleteMany({
          where: {
            professionalId: params.id
          }
        })

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
        include: professionalInclude
      })
    })
  })

  app.patch('/professionals/:id/status', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      isActive?: boolean
    }

    if (typeof body.isActive !== 'boolean') {
      return reply.status(400).send({
        message: 'isActive es requerido'
      })
    }

    return prisma.professional.update({
      where: {
        id: params.id
      },
      data: {
        isActive: body.isActive,
        deactivatedAt: body.isActive ? null : new Date()
      },
      include: professionalInclude
    })
  })

  app.delete('/professionals/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }

    const futureAppointmentCount = await prisma.appointment.count({
      where: {
        professionalId: params.id,
        startAt: {
          gte: new Date()
        },
        status: {
          not: 'CANCELLED'
        }
      }
    })

    if (futureAppointmentCount > 0) {
      return reply.status(409).send({
        code: 'PROFESSIONAL_HAS_FUTURE_APPOINTMENTS',
        message: 'Este profesional tiene turnos futuros. Desactivalo, reasigna o cancela esos turnos antes de eliminarlo.',
        impact: await getProfessionalAppointmentImpact(params.id)
      })
    }

    const appointmentCount = await prisma.appointment.count({
      where: {
        professionalId: params.id
      }
    })

    if (appointmentCount > 0) {
      await prisma.professional.update({
        where: {
          id: params.id
        },
        data: {
          isActive: false,
          deactivatedAt: new Date()
        }
      })

      return {
        deleted: false,
        deactivated: true
      }
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

const professionalInclude = {
  workingHours: {
    orderBy: {
      dayOfWeek: 'asc' as const
    }
  },
  _count: {
    select: {
      appointments: true
    }
  }
}

async function getProfessionalAppointmentImpact(professionalId: string, workingHours?: WorkingHourInput[]) {
  const appointments = await prisma.appointment.findMany({
    where: {
      professionalId,
      startAt: {
        gte: new Date()
      },
      status: {
        not: 'CANCELLED'
      }
    },
    include: {
      customer: true,
      service: true,
      professional: true
    },
    orderBy: {
      startAt: 'asc'
    }
  })

  const outsideWorkingHours = workingHours
    ? appointments.filter((appointment) => {
        const startAt = appointment.startAt
        const duration = appointment.service?.duration || 0
        const endAt = new Date(startAt.getTime() + duration * 60_000)

        return !isInsideWorkingHours(startAt, endAt, workingHours)
      })
    : []

  return {
    futureAppointments: appointments,
    outsideWorkingHours
  }
}

function isInsideWorkingHours(startAt: Date, endAt: Date, hours: WorkingHourInput[]) {
  if (startAt.toDateString() !== endAt.toDateString()) {
    return false
  }

  const startMinutes = minutesSinceMidnight(startAt)
  const endMinutes = minutesSinceMidnight(endAt)

  return hours.some((hour) => {
    if (hour.dayOfWeek !== startAt.getDay()) {
      return false
    }

    return startMinutes >= timeToMinutes(hour.startTime) &&
      endMinutes <= timeToMinutes(hour.endTime)
  })
}

function normalizeWorkingHours(hours: WorkingHourInput[]) {
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

function minutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

function timeToMinutes(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')

  return Number(hours) * 60 + Number(minutes)
}
