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
      description?: string | null
      businessId: string
      avatarUrl?: string | null
      isActive?: boolean
      workingHours?: WorkingHourInput[]
      serviceIds?: string[]
    }

    const name = body.name?.trim()
    const description = normalizeDescription(body.description)
    const avatarUrl = normalizeAvatarUrl(body.avatarUrl)
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

    const serviceIdsResult = await resolveServiceIdsForBusiness(businessId, body.serviceIds)
    if (!serviceIdsResult.ok) {
      return reply.status(serviceIdsResult.statusCode).send({
        message: serviceIdsResult.message
      })
    }

    const businessHoursValidation = await validateWorkingHoursWithinBusinessHours(businessId, workingHours)
    if (!businessHoursValidation.ok) {
      return reply.status(409).send({
        code: 'OUTSIDE_BUSINESS_HOURS',
        message: businessHoursValidation.message
      })
    }

    const professional = await prisma.professional.create({
      data: {
        name,
        description,
        avatarUrl,
        isActive: body.isActive === false ? false : true,
        deactivatedAt: body.isActive === false ? new Date() : null,
        businessId,
        ...(workingHours.length > 0
          ? {
              workingHours: {
                create: workingHours
              }
            }
          : {}),
        ...(serviceIdsResult.serviceIds.length > 0
          ? {
              serviceLinks: {
                create: serviceIdsResult.serviceIds.map((serviceId) => ({
                  serviceId
                }))
              }
            }
          : {})
      },
      include: professionalInclude
    })

    return serializeProfessional(professional)
  })

  app.get('/professionals', async (request) => {
    const query = request.query as {
      activeOnly?: string
      businessId?: string
    }

    const professionals = await prisma.professional.findMany({
      where: {
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.activeOnly === 'true' ? { isActive: true } : {})
      },
      include: professionalInclude,
      orderBy: {
        createdAt: 'asc'
      }
    })

    return professionals.map(serializeProfessional)
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
      description?: string | null
      avatarUrl?: string | null
      isActive?: boolean
      workingHours?: WorkingHourInput[]
      serviceIds?: string[]
      conflictStrategy?: 'KEEP_EXISTING'
    }
    const name = body.name?.trim()
    const description = normalizeDescription(body.description)
    const avatarUrl = normalizeAvatarUrl(body.avatarUrl)

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    const workingHours = body.workingHours
      ? normalizeWorkingHours(body.workingHours)
      : undefined

    const existing = await prisma.professional.findUnique({
      where: {
        id: params.id
      }
    })

    if (!existing) {
      return reply.status(404).send({
        message: 'No encontre ese profesional'
      })
    }

    const serviceIdsResult = body.serviceIds
      ? await resolveServiceIdsForBusiness(existing.businessId, body.serviceIds)
      : null

    if (serviceIdsResult && !serviceIdsResult.ok) {
      return reply.status(serviceIdsResult.statusCode).send({
        message: serviceIdsResult.message
      })
    }

    if (workingHours) {
      const businessHoursValidation = await validateWorkingHoursWithinBusinessHours(existing.businessId, workingHours)
      if (!businessHoursValidation.ok) {
        return reply.status(409).send({
          code: 'OUTSIDE_BUSINESS_HOURS',
          message: businessHoursValidation.message
        })
      }
    }

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
          description,
          avatarUrl,
          isActive: typeof body.isActive === 'boolean' ? body.isActive : existing.isActive,
          deactivatedAt: typeof body.isActive === 'boolean'
            ? body.isActive ? null : new Date()
            : existing.deactivatedAt
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

      if (serviceIdsResult) {
        await tx.professionalService.deleteMany({
          where: {
            professionalId: params.id
          }
        })

        if (serviceIdsResult.serviceIds.length > 0) {
          await tx.professionalService.createMany({
            data: serviceIdsResult.serviceIds.map((serviceId) => ({
              professionalId: params.id,
              serviceId
            })),
            skipDuplicates: true
          })
        }
      }

      const professional = await tx.professional.findUnique({
        where: {
          id: params.id
        },
        include: professionalInclude
      })

      return serializeProfessional(professional)
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

    const professional = await prisma.professional.update({
      where: {
        id: params.id
      },
      data: {
        isActive: body.isActive,
        deactivatedAt: body.isActive ? null : new Date()
      },
      include: professionalInclude
    })

    return serializeProfessional(professional)
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
          notIn: ['CANCELLED', 'NO_SHOW']
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
  serviceLinks: {
    include: {
      service: true
    },
    orderBy: {
      createdAt: 'asc' as const
    }
  },
  _count: {
    select: {
      appointments: true
    }
  }
}

function serializeProfessional(professional: any) {
  if (!professional) {
    return professional
  }

  const { serviceLinks, ...rest } = professional

  return {
    ...rest,
    avatarUrl: normalizeAvatarUrl(rest.avatarUrl),
    services: (serviceLinks || []).map((link: { service: unknown }) => link.service)
  }
}

function normalizeAvatarUrl(avatarUrl?: string | null) {
  const normalizedAvatarUrl = avatarUrl?.trim()

  if (!normalizedAvatarUrl || normalizedAvatarUrl.startsWith('/landing-assets/')) return null
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(normalizedAvatarUrl)) return normalizedAvatarUrl
  if (/^https?:\/\//i.test(normalizedAvatarUrl)) return normalizedAvatarUrl
  return null
}

function normalizeDescription(description?: string | null) {
  const normalizedDescription = description?.trim()
  return normalizedDescription || null
}

async function resolveServiceIdsForBusiness(businessId: string, serviceIds?: string[]) {
  const normalizedServiceIds = serviceIds === undefined
    ? null
    : Array.from(new Set(
        serviceIds
          .map((serviceId) => serviceId?.trim())
          .filter(Boolean)
      ))

  const services = await prisma.service.findMany({
    where: {
      businessId,
      ...(normalizedServiceIds ? { id: { in: normalizedServiceIds } } : {})
    },
    select: {
      id: true
    }
  })

  if (normalizedServiceIds && services.length !== normalizedServiceIds.length) {
    return {
      ok: false as const,
      statusCode: 400,
      message: 'Uno o mas servicios no corresponden a ese negocio'
    }
  }

  return {
    ok: true as const,
    serviceIds: normalizedServiceIds ?? services.map((service) => service.id)
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
        notIn: ['CANCELLED', 'NO_SHOW']
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

async function validateWorkingHoursWithinBusinessHours(businessId: string, workingHours: WorkingHourInput[]) {
  if (workingHours.length === 0) {
    return {
      ok: true as const
    }
  }

  const businessHours = await prisma.businessHours.findMany({
    where: {
      businessId
    }
  })

  const hoursByDay = new Map<number, Array<{ startTime: string; endTime: string }>>()
  for (const hour of businessHours) {
    const dayHours = hoursByDay.get(hour.dayOfWeek) || []
    dayHours.push(hour)
    hoursByDay.set(hour.dayOfWeek, dayHours)
  }

  const invalidHour = workingHours.find((workingHour) => {
    const localHours = hoursByDay.get(workingHour.dayOfWeek) || []
    return !localHours.some((localHour) => {
      return workingHour.startTime >= localHour.startTime &&
        workingHour.endTime <= localHour.endTime
    })
  })

  if (!invalidHour) {
    return {
      ok: true as const
    }
  }

  const localHours = hoursByDay.get(invalidHour.dayOfWeek) || []
  const localRange = localHours.length
    ? localHours.map((hour) => `${hour.startTime} a ${hour.endTime}`).join(', ')
    : 'cerrado'

  return {
    ok: false as const,
    message: `El horario de ${dayLabel(invalidHour.dayOfWeek)} debe estar dentro del horario del local (${localRange}).`
  }
}

function dayLabel(dayOfWeek: number) {
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][dayOfWeek] || 'ese dia'
}

function minutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

function timeToMinutes(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')

  return Number(hours) * 60 + Number(minutes)
}
