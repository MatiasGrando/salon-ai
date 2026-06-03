import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function professionalHoursRoutes(app: FastifyInstance) {

  app.post('/professional-hours', async (request) => {

    const body = request.body as {
      professionalId: string
      dayOfWeek: number
      startTime: string
      endTime: string
    }

    return prisma.professionalHours.create({
      data: {
        professionalId: body.professionalId,
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime
      }
    })
  })

  app.post('/professional-hours/setup', async (request) => {

    const body = request.body as {
      professionalId: string
      weekdays: {
        days: number[]
        startTime: string
        endTime: string
      }
      saturday?: {
        days: number[]
        startTime: string
        endTime: string
      }
      sunday?: {
        days: number[]
        startTime: string
        endTime: string
      }
    }

    const schedules = [
      body.weekdays,
      body.saturday,
      body.sunday
    ].filter((schedule) => schedule !== undefined)

    const hours = schedules.flatMap((schedule) => {
      return schedule.days.map((dayOfWeek) => ({
        professionalId: body.professionalId,
        dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    })

    await prisma.$transaction([
      prisma.professionalHours.deleteMany({
        where: {
          professionalId: body.professionalId
        }
      }),
      prisma.professionalHours.createMany({
        data: hours
      })
    ])

    return prisma.professionalHours.findMany({
      where: {
        professionalId: body.professionalId
      },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true
      },
      orderBy: {
        dayOfWeek: 'asc'
      }
    })
  })

  app.get('/professional-hours', async (request) => {

    const query = request.query as {
      professionalId?: string
    }

    return prisma.professionalHours.findMany({
      where: {
        professionalId: query.professionalId
      },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true
      },
      orderBy: {
        dayOfWeek: 'asc'
      }
    })
  })

}
