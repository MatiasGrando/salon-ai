import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { validateWeeklyHours } from '../services/weekly-hours.js'
import { refreshBusinessOnboarding } from '../services/business-onboarding-service.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'

export async function businessHoursRoutes(app: FastifyInstance) {

  app.post('/business-hours', async (request, reply) => {

    const body = request.body as {
      businessId: string
      dayOfWeek: number
      startTime: string
      endTime: string
    }

    const existingHours = await prisma.businessHours.findMany({
      where: {
        businessId: body.businessId,
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

    const created = await prisma.$transaction(async (tx) => {
      await acquireAgendaHierarchy(tx, { businessId: body.businessId })
      const lockedExistingHours = await tx.businessHours.findMany({
        where: { businessId: body.businessId, dayOfWeek: body.dayOfWeek },
        select: { dayOfWeek: true, startTime: true, endTime: true }
      })
      const lockedValidation = validateWeeklyHours([...lockedExistingHours, body])
      if (!lockedValidation.ok) return { conflict: lockedValidation.message } as const
      return { created: await tx.businessHours.create({
        data: {
          businessId: body.businessId,
          dayOfWeek: body.dayOfWeek,
          startTime: body.startTime,
          endTime: body.endTime
        }
      }) } as const
    })
    if ('conflict' in created) return reply.status(409).send({ message: created.conflict })
    await refreshBusinessOnboarding(body.businessId)
    return created.created
  })

  app.post('/business-hours/setup', async (request, reply) => {

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

    if (!body.businessId) {
      return reply.status(400).send({
        message: 'businessId es requerido'
      })
    }

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
      businessId: body.businessId,
      ...hour
    }))

    const professionals = await prisma.professional.findMany({
      where: {
        businessId: body.businessId,
        isActive: true
      },
      include: {
        workingHours: true
      }
    })

    const invalidProfessional = professionals.find((professional) => {
      return professional.workingHours.some((professionalHour) => {
        return !hours.some((businessHour) => {
          return businessHour.dayOfWeek === professionalHour.dayOfWeek &&
            professionalHour.startTime >= businessHour.startTime &&
            professionalHour.endTime <= businessHour.endTime
        })
      })
    })

    if (invalidProfessional) {
      return reply.status(409).send({
        code: 'PROFESSIONAL_OUTSIDE_BUSINESS_HOURS',
        message: `El horario de ${invalidProfessional.name} queda fuera del nuevo horario del local. Ajusta primero ese profesional.`
      })
    }

    const updated = await prisma.$transaction(async (tx) => {
      await acquireAgendaHierarchy(tx, { businessId: body.businessId })
      const lockedProfessionals = await tx.professional.findMany({
        where: { businessId: body.businessId, isActive: true },
        include: { workingHours: true }
      })
      const lockedInvalidProfessional = lockedProfessionals.find((professional) =>
        professional.workingHours.some((professionalHour) => !hours.some((businessHour) =>
          businessHour.dayOfWeek === professionalHour.dayOfWeek &&
          professionalHour.startTime >= businessHour.startTime &&
          professionalHour.endTime <= businessHour.endTime
        ))
      )
      if (lockedInvalidProfessional) throw new BusinessHoursConflictError(lockedInvalidProfessional.name)
      await tx.businessHours.deleteMany({
        where: {
          businessId: body.businessId
        }
      })
      await tx.businessHours.createMany({
        data: hours
      })
    }).catch((error: unknown) => {
      if (error instanceof BusinessHoursConflictError) return false
      throw error
    })
    if (updated === false) {
      return reply.status(409).send({
        code: 'PROFESSIONAL_OUTSIDE_BUSINESS_HOURS',
        message: 'Un horario profesional queda fuera del nuevo horario del local. Actualiza la agenda profesional e intenta de nuevo.'
      })
    }
    await refreshBusinessOnboarding(body.businessId)

    return prisma.businessHours.findMany({
      where: {
        businessId: body.businessId
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
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    })
  })

}

class BusinessHoursConflictError extends Error {}
