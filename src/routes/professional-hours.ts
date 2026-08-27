import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { validateWeeklyHours } from '../services/weekly-hours.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'

export async function professionalHoursRoutes(app: FastifyInstance) {

  app.post('/professional-hours', async (request, reply) => {

    const body = request.body as {
      professionalId: string
      dayOfWeek: number
      startTime: string
      endTime: string
    }

    const existingHours = await prisma.professionalHours.findMany({
      where: {
        professionalId: body.professionalId,
        dayOfWeek: body.dayOfWeek
      },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true
      }
    })
    const validation = validateWeeklyHours([...existingHours, body])
    if (!validation.ok) {
      return reply.status(400).send({
        message: validation.message
      })
    }

    const professional = await prisma.professional.findUnique({
      where: { id: body.professionalId },
      select: { businessId: true }
    })
    if (!professional) return reply.status(404).send({ message: 'No encontre ese profesional' })
    return prisma.$transaction(async (tx) => {
      await acquireAgendaHierarchy(tx, {
        businessId: professional.businessId,
        professionalIds: [body.professionalId]
      })
      const lockedExistingHours = await tx.professionalHours.findMany({
        where: { professionalId: body.professionalId, dayOfWeek: body.dayOfWeek },
        select: { dayOfWeek: true, startTime: true, endTime: true }
      })
      const lockedValidation = validateWeeklyHours([...lockedExistingHours, body])
      if (!lockedValidation.ok) return reply.status(409).send({ message: lockedValidation.message })
      return tx.professionalHours.create({
        data: {
          professionalId: body.professionalId,
          dayOfWeek: body.dayOfWeek,
          startTime: body.startTime,
          endTime: body.endTime
        }
      })
    })
  })

  app.post('/professional-hours/setup', async (request, reply) => {

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
      schedules?: {
        days: number[]
        startTime: string
        endTime: string
      }[]
    }

    const schedules = body.schedules?.length
      ? body.schedules
      : [
          body.weekdays,
          body.saturday,
          body.sunday
        ].filter((schedule) => schedule !== undefined)

    const requestedHours = schedules.flatMap((schedule) => {
      return schedule.days.map((dayOfWeek) => ({
        dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    })
    const validation = validateWeeklyHours(requestedHours)
    if (!validation.ok) {
      return reply.status(400).send({
        message: validation.message
      })
    }
    const hours = validation.hours.map((hour) => ({
      professionalId: body.professionalId,
      ...hour
    }))

    const professional = await prisma.professional.findUnique({
      where: { id: body.professionalId },
      select: { businessId: true }
    })
    if (!professional) return reply.status(404).send({ message: 'No encontre ese profesional' })
    await prisma.$transaction(async (tx) => {
      await acquireAgendaHierarchy(tx, {
        businessId: professional.businessId,
        professionalIds: [body.professionalId]
      })
      await tx.professionalHours.deleteMany({
        where: {
          professionalId: body.professionalId
        }
      })
      await tx.professionalHours.createMany({
        data: hours
      })
    })

    return prisma.professionalHours.findMany({
      where: {
        professionalId: body.professionalId
      },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    })
  })

  app.get('/professional-hours', async (request) => {

    const query = request.query as {
      professionalId?: string
    }

    return prisma.professionalHours.findMany({
      where: query.professionalId
        ? {
            professionalId: query.professionalId
          }
        : {},
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    })
  })

}
