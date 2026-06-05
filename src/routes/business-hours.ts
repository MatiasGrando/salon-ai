import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function businessHoursRoutes(app: FastifyInstance) {

  app.post('/business-hours', async (request) => {

    const body = request.body as {
      businessId: string
      dayOfWeek: number
      startTime: string
      endTime: string
    }

    return prisma.businessHours.create({
      data: {
        businessId: body.businessId,
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime
      }
    })
  })

  app.post('/business-hours/setup', async (request) => {

    const body = request.body as {
      businessId: string
      weekdays: {
        days: number[]
        startTime: string
        endTime: string
      }
      saturday: {
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
        businessId: body.businessId,
        dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    })

    await prisma.$transaction([
      prisma.businessHours.deleteMany({
        where: {
          businessId: body.businessId
        }
      }),
      prisma.businessHours.createMany({
        data: hours
      })
    ])

    return prisma.businessHours.findMany({
      where: {
        businessId: body.businessId
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

  app.get('/business-hours', async (request) => {

    const query = request.query as {
      businessId?: string
    }

    return prisma.businessHours.findMany({
      where: query.businessId
        ? {
            businessId: query.businessId
          }
        : {},
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
