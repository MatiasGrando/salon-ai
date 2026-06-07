import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

const scheduleBlockReasons = [
  'ABSENCE',
  'VACATION',
  'LATE_ARRIVAL',
  'SICK_LEAVE',
  'PERSONAL',
  'TRAINING',
  'MAINTENANCE',
  'HOLIDAY',
  'OTHER'
] as const

type ScheduleBlockReason = typeof scheduleBlockReasons[number]

export async function scheduleBlockRoutes(app: FastifyInstance) {
  app.post('/schedule-blocks', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      professionalId?: string
      reason?: string
      title?: string
      note?: string
      startAt?: string
      endAt?: string
    }

    if (!body.businessId || !body.reason || !body.startAt || !body.endAt) {
      return reply.status(400).send({
        message: 'businessId, reason, startAt y endAt son requeridos'
      })
    }

    if (!isScheduleBlockReason(body.reason)) {
      return reply.status(400).send({
        message: `reason debe ser uno de: ${scheduleBlockReasons.join(', ')}`
      })
    }

    const startAt = new Date(body.startAt)
    const endAt = new Date(body.endAt)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return reply.status(400).send({
        message: 'startAt o endAt no parecen fechas validas'
      })
    }

    if (startAt >= endAt) {
      return reply.status(400).send({
        message: 'endAt debe ser posterior a startAt'
      })
    }

    const business = await prisma.business.findUnique({
      where: {
        id: body.businessId
      }
    })

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre ese negocio'
      })
    }

    if (body.professionalId) {
      const professional = await prisma.professional.findUnique({
        where: {
          id: body.professionalId
        }
      })

      if (!professional) {
        return reply.status(404).send({
          message: 'No encontre ese profesional'
        })
      }

      if (professional.businessId !== body.businessId) {
        return reply.status(400).send({
          message: 'Ese profesional no corresponde a ese negocio'
        })
      }
    }

    return prisma.scheduleBlock.create({
      data: {
        businessId: body.businessId,
        professionalId: body.professionalId ?? null,
        reason: body.reason,
        title: body.title ?? null,
        note: body.note ?? null,
        startAt,
        endAt
      },
      include: {
        professional: true
      }
    })
  })

  app.get('/schedule-blocks', async (request) => {
    const query = request.query as {
      businessId?: string
      professionalId?: string
      from?: string
      to?: string
    }

    const from = query.from ? new Date(query.from) : null
    const to = query.to ? new Date(query.to) : null

    return prisma.scheduleBlock.findMany({
      where: {
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        ...(from && !Number.isNaN(from.getTime()) ? { endAt: { gt: from } } : {}),
        ...(to && !Number.isNaN(to.getTime()) ? { startAt: { lt: to } } : {})
      },
      include: {
        professional: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })
  })

  app.delete('/schedule-blocks/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }

    const existingBlock = await prisma.scheduleBlock.findUnique({
      where: {
        id: params.id
      }
    })

    if (!existingBlock) {
      return reply.status(404).send({
        message: 'No encontre ese bloqueo'
      })
    }

    await prisma.scheduleBlock.delete({
      where: {
        id: params.id
      }
    })

    return {
      deleted: true
    }
  })
}

function isScheduleBlockReason(reason: string): reason is ScheduleBlockReason {
  return scheduleBlockReasons.includes(reason as ScheduleBlockReason)
}
