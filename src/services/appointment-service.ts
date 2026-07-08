import { prisma } from '../config/prisma.js'

const availabilitySlotInterval = 30

type CreateAppointmentInput = {
  customerId: string
  professionalId: string
  serviceId: string
  startAt: string
  force?: boolean
}

type AppointmentMutationResult =
  | {
      ok: true
      appointment: Awaited<ReturnType<typeof prisma.appointment.create>>
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

type UpdateAppointmentInput = CreateAppointmentInput & {
  id: string
}

type AppointmentStatusInput = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'

type FindAvailabilityInput = {
  professionalId: string
  serviceId: string
  date: string
}

type FindAppointmentsInput = {
  businessId?: string
  customerPhone?: string
  from?: string
  to?: string
  professionalId?: string
}

type FindAvailabilityResult =
  | {
      ok: true
      slots: string[]
      unavailableReason?: string | null
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

export class AppointmentService {
  async create(input: CreateAppointmentInput): Promise<AppointmentMutationResult> {
    const startAt = new Date(input.startAt)

    if (Number.isNaN(startAt.getTime())) {
      return {
        ok: false,
        statusCode: 400,
        message: 'La fecha de inicio no parece valida'
      }
    }

    const [professional, service] = await Promise.all([
      prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      }),
      prisma.service.findUnique({
        where: {
          id: input.serviceId
        }
      })
    ])

    if (!professional) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese profesional'
      }
    }

    if (!professional.isActive) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no esta activo'
      }
    }

    if (!service) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese servicio'
      }
    }

    if (professional.businessId !== service.businessId) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese profesional no corresponde a ese servicio'
      }
    }

    if (!(await this.professionalOffersService(input.professionalId, input.serviceId))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no realiza ese servicio'
      }
    }

    const endAt = addMinutes(startAt, service.duration)
    const isInsideBusinessHours = await this.isInsideBusinessHours({
      businessId: professional.businessId,
      startAt,
      endAt
    })

    if (!isInsideBusinessHours && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario esta fuera del horario de atencion'
      }
    }

    const isInsideProfessionalHours = await this.isInsideProfessionalHours({
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (!isInsideProfessionalHours && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no trabaja en ese horario'
      }
    }

    const hasScheduleBlock = await this.hasScheduleBlockOverlap({
      businessId: professional.businessId,
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (hasScheduleBlock && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario esta bloqueado en la agenda'
      }
    }

    const hasOverlap = await this.hasAppointmentOverlap({
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (hasOverlap && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario ya no esta disponible'
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        customerId: input.customerId,
        professionalId: input.professionalId,
        serviceId: input.serviceId,
        startAt
      }
    })

    return {
      ok: true,
      appointment
    }
  }

  async update(input: UpdateAppointmentInput): Promise<AppointmentMutationResult> {
    const existing = await prisma.appointment.findUnique({
      where: {
        id: input.id
      }
    })

    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese turno'
      }
    }

    const startAt = new Date(input.startAt)

    if (Number.isNaN(startAt.getTime())) {
      return {
        ok: false,
        statusCode: 400,
        message: 'La fecha de inicio no parece valida'
      }
    }

    const [professional, service] = await Promise.all([
      prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      }),
      prisma.service.findUnique({
        where: {
          id: input.serviceId
        }
      })
    ])

    if (!professional) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese profesional'
      }
    }

    if (!professional.isActive) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no esta activo'
      }
    }

    if (!service) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese servicio'
      }
    }

    if (professional.businessId !== service.businessId) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese profesional no corresponde a ese servicio'
      }
    }

    if (!(await this.professionalOffersService(input.professionalId, input.serviceId))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no realiza ese servicio'
      }
    }

    const endAt = addMinutes(startAt, service.duration)
    const isInsideBusinessHours = await this.isInsideBusinessHours({
      businessId: professional.businessId,
      startAt,
      endAt
    })

    if (!isInsideBusinessHours && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario esta fuera del horario de atencion'
      }
    }

    const isInsideProfessionalHours = await this.isInsideProfessionalHours({
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (!isInsideProfessionalHours && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no trabaja en ese horario'
      }
    }

    const hasScheduleBlock = await this.hasScheduleBlockOverlap({
      businessId: professional.businessId,
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (hasScheduleBlock && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario esta bloqueado en la agenda'
      }
    }

    const hasOverlap = await this.hasAppointmentOverlap({
      professionalId: input.professionalId,
      startAt,
      endAt,
      excludeAppointmentId: input.id
    })

    if (hasOverlap && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario ya no esta disponible'
      }
    }

    const appointment = await prisma.appointment.update({
      where: {
        id: input.id
      },
      data: {
        customerId: input.customerId,
        professionalId: input.professionalId,
        serviceId: input.serviceId,
        startAt,
        status: 'CONFIRMED'
      }
    })

    return {
      ok: true,
      appointment
    }
  }

  async cancel(appointmentId: string) {
    const appointment = await prisma.appointment.findUnique({
      where: {
        id: appointmentId
      }
    })

    if (!appointment) {
      return {
        ok: false as const,
        statusCode: 404,
        message: 'No encontre ese turno'
      }
    }

    return {
      ok: true as const,
      appointment: await prisma.appointment.update({
        where: {
          id: appointmentId
        },
        data: {
          status: 'CANCELLED'
        }
      })
    }
  }

  async updateStatus(appointmentId: string, status: AppointmentStatusInput) {
    const appointment = await prisma.appointment.findUnique({
      where: {
        id: appointmentId
      }
    })

    if (!appointment) {
      return {
        ok: false as const,
        statusCode: 404,
        message: 'No encontre ese turno'
      }
    }

    return {
      ok: true as const,
      appointment: await prisma.appointment.update({
        where: {
          id: appointmentId
        },
        data: {
          status
        },
        include: {
          customer: true,
          professional: true,
          service: true
        }
      })
    }
  }

  async findAll(input: FindAppointmentsInput = {}) {
    const from = parseOptionalDate(input.from)
    const to = parseOptionalDate(input.to)

    return prisma.appointment.findMany({
      where: {
        ...(input.businessId || input.professionalId
          ? {
              professional: {
                ...(input.businessId ? { businessId: input.businessId } : {}),
                ...(input.professionalId ? { id: input.professionalId } : {})
              }
            }
          : {}),
        ...(input.customerPhone ? { customer: { phone: input.customerPhone } } : {}),
        ...(from || to
          ? {
              startAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {})
              }
            }
          : {})
      },
      include: {
        customer: true,
        professional: true,
        service: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })
  }

  async findAvailability(input: FindAvailabilityInput): Promise<FindAvailabilityResult> {
    const dayStart = parseDate(input.date)

    if (!dayStart) {
      return {
        ok: false,
        statusCode: 400,
        message: 'La fecha no parece valida'
      }
    }

    const [professional, service] = await Promise.all([
      prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      }),
      prisma.service.findUnique({
        where: {
          id: input.serviceId
        }
      })
    ])

    if (!professional) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese profesional'
      }
    }

    if (!professional.isActive) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no esta activo'
      }
    }

    if (!service) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese servicio'
      }
    }

    if (professional.businessId !== service.businessId) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese profesional no corresponde a ese servicio'
      }
    }

    if (!(await this.professionalOffersService(input.professionalId, input.serviceId))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no realiza ese servicio'
      }
    }

    const dayOfWeek = dayStart.getDay()
    const dayEnd = addDays(dayStart, 1)
    const [businessHours, professionalHours, scheduleBlocks] = await Promise.all([
      prisma.businessHours.findMany({
        where: {
          businessId: professional.businessId,
          dayOfWeek
        }
      }),
      prisma.professionalHours.findMany({
        where: {
          professionalId: input.professionalId,
          dayOfWeek
        }
      }),
      prisma.scheduleBlock.findMany({
        where: {
          businessId: professional.businessId,
          startAt: {
            lt: dayEnd
          },
          endAt: {
            gt: dayStart
          },
          OR: [
            {
              professionalId: input.professionalId
            },
            {
              professionalId: null
            }
          ]
        }
      })
    ])

    const windows = getAvailabilityWindows(businessHours, professionalHours)
    const slots: string[] = []

    for (const window of windows) {
      for (
        let slotStartMinutes = window.start;
        slotStartMinutes + service.duration <= window.end;
        slotStartMinutes += availabilitySlotInterval
      ) {
        const startAt = setMinutesSinceMidnight(dayStart, slotStartMinutes)
        const endAt = addMinutes(startAt, service.duration)

        if (startAt <= new Date()) {
          continue
        }

        if (hasBlockedIntervalOverlap(scheduleBlocks, startAt, endAt)) {
          continue
        }

        const hasOverlap = await this.hasAppointmentOverlap({
          professionalId: input.professionalId,
          startAt,
          endAt
        })

        if (!hasOverlap) {
          slots.push(formatTime(startAt))
        }
      }
    }

    return {
      ok: true,
      slots,
      unavailableReason: slots.length === 0
        ? explainBlockedAvailability({
            blocks: scheduleBlocks,
            dayStart,
            dayEnd,
            professionalName: professional.name
          })
        : null
    }
  }

  private async isInsideBusinessHours(input: {
    businessId: string
    startAt: Date
    endAt: Date
  }) {
    if (input.startAt.toDateString() !== input.endAt.toDateString()) {
      return false
    }

    const businessHours = await prisma.businessHours.findMany({
      where: {
        businessId: input.businessId,
        dayOfWeek: input.startAt.getDay()
      }
    })

    const startMinutes = minutesSinceMidnight(input.startAt)
    const endMinutes = minutesSinceMidnight(input.endAt)

    return businessHours.some((hours) => {
      const businessStart = parseTimeToMinutes(hours.startTime)
      const businessEnd = parseTimeToMinutes(hours.endTime)

      return startMinutes >= businessStart && endMinutes <= businessEnd
    })
  }

  private async isInsideProfessionalHours(input: {
    professionalId: string
    startAt: Date
    endAt: Date
  }) {
    if (input.startAt.toDateString() !== input.endAt.toDateString()) {
      return false
    }

    const professionalHours = await prisma.professionalHours.findMany({
      where: {
        professionalId: input.professionalId,
        dayOfWeek: input.startAt.getDay()
      }
    })

    const startMinutes = minutesSinceMidnight(input.startAt)
    const endMinutes = minutesSinceMidnight(input.endAt)

    return professionalHours.some((hours) => {
      const professionalStart = parseTimeToMinutes(hours.startTime)
      const professionalEnd = parseTimeToMinutes(hours.endTime)

      return startMinutes >= professionalStart && endMinutes <= professionalEnd
    })
  }

  private async hasAppointmentOverlap(input: {
    professionalId: string
    startAt: Date
    endAt: Date
    excludeAppointmentId?: string
  }) {
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
        professionalId: input.professionalId,
        startAt: {
          lt: input.endAt
        },
        status: {
          notIn: ['CANCELLED', 'NO_SHOW']
        }
      },
      include: {
        service: true
      }
    })

    return appointments.some((appointment) => {
      const existingStart = appointment.startAt
      const existingEnd = addMinutes(existingStart, appointment.service.duration)

      return existingStart < input.endAt && existingEnd > input.startAt
    })
  }

  private async professionalOffersService(professionalId: string, serviceId: string) {
    const serviceCount = await prisma.professionalService.count({
      where: {
        professionalId,
        serviceId
      }
    })

    return serviceCount > 0
  }

  private async hasScheduleBlockOverlap(input: {
    businessId: string
    professionalId: string
    startAt: Date
    endAt: Date
  }) {
    const scheduleBlock = await prisma.scheduleBlock.findFirst({
      where: {
        businessId: input.businessId,
        startAt: {
          lt: input.endAt
        },
        endAt: {
          gt: input.startAt
        },
        OR: [
          {
            professionalId: input.professionalId
          },
          {
            professionalId: null
          }
        ]
      }
    })

    return scheduleBlock !== null
  }
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function minutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

function parseTimeToMinutes(time: string) {
  const [hours = '0', minutes = '0'] = time.split(':')

  return Number(hours) * 60 + Number(minutes)
}

function parseDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate
}

function parseOptionalDate(value?: string) {
  if (!value) return null
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function setMinutesSinceMidnight(date: Date, minutes: number) {
  const nextDate = new Date(date)

  nextDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)

  return nextDate
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

function getAvailabilityWindows(
  businessHours: Array<{ startTime: string; endTime: string }>,
  professionalHours: Array<{ startTime: string; endTime: string }>
) {
  return businessHours.flatMap((businessSchedule) => {
    const businessStart = parseTimeToMinutes(businessSchedule.startTime)
    const businessEnd = parseTimeToMinutes(businessSchedule.endTime)

    return professionalHours.flatMap((professionalSchedule) => {
      const professionalStart = parseTimeToMinutes(professionalSchedule.startTime)
      const professionalEnd = parseTimeToMinutes(professionalSchedule.endTime)

      const start = Math.max(businessStart, professionalStart)
      const end = Math.min(businessEnd, professionalEnd)

      if (start >= end) {
        return []
      }

      return [{ start, end }]
    })
  })
}

function hasBlockedIntervalOverlap(
  scheduleBlocks: Array<{ startAt: Date; endAt: Date }>,
  startAt: Date,
  endAt: Date
) {
  return scheduleBlocks.some((scheduleBlock) => {
    return scheduleBlock.startAt < endAt && scheduleBlock.endAt > startAt
  })
}

function explainBlockedAvailability(input: {
  blocks: Array<{
    professionalId: string | null
    reason: string
    title: string | null
    startAt: Date
    endAt: Date
  }>
  dayStart: Date
  dayEnd: Date
  professionalName: string
}) {
  const fullDayBlock = input.blocks.find((block) => {
    return block.startAt <= input.dayStart &&
      block.endAt >= input.dayEnd &&
      ['HOLIDAY', 'VACATION'].includes(block.reason)
  })

  if (!fullDayBlock) {
    return null
  }

  const reopenText = fullDayBlock.endAt > input.dayEnd
    ? ` Volvemos a abrir el ${formatDisplayDate(fullDayBlock.endAt)}.`
    : ''

  if (fullDayBlock.professionalId) {
    const professionalReturnText = fullDayBlock.endAt > input.dayEnd
      ? ` ${input.professionalName} vuelve el ${formatDisplayDate(fullDayBlock.endAt)}.`
      : ''

    if (fullDayBlock.reason === 'VACATION') {
      return `${input.professionalName} esta de vacaciones ese dia.${professionalReturnText} Si queres, buscamos otro profesional u otra fecha.`
    }

    return `${input.professionalName} no atiende ese dia.${professionalReturnText} Si queres, buscamos otro profesional u otra fecha.`
  }

  if (fullDayBlock.reason === 'HOLIDAY') {
    return `Ese dia el salon va a estar cerrado por feriado.${reopenText} Podemos buscar otro dia.`
  }

  return `Ese dia el salon va a estar cerrado por vacaciones.${reopenText} Podemos buscar otra fecha.`
}

function formatDisplayDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  return `${day}/${month}/${year}`
}
