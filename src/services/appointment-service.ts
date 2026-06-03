import { prisma } from '../config/prisma.js'

const availabilitySlotInterval = 15

type CreateAppointmentInput = {
  customerId: string
  professionalId: string
  serviceId: string
  startAt: string
}

type CreateAppointmentResult =
  | {
      ok: true
      appointment: Awaited<ReturnType<typeof prisma.appointment.create>>
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

type FindAvailabilityInput = {
  professionalId: string
  serviceId: string
  date: string
}

type FindAvailabilityResult =
  | {
      ok: true
      slots: string[]
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

export class AppointmentService {
  async create(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
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

    const endAt = addMinutes(startAt, service.duration)
    const isInsideBusinessHours = await this.isInsideBusinessHours({
      businessId: professional.businessId,
      startAt,
      endAt
    })

    if (!isInsideBusinessHours) {
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

    if (!isInsideProfessionalHours) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no trabaja en ese horario'
      }
    }

    const hasOverlap = await this.hasAppointmentOverlap({
      professionalId: input.professionalId,
      startAt,
      endAt
    })

    if (hasOverlap) {
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

  async findAll() {
    return prisma.appointment.findMany({
      include: {
        customer: true,
        professional: true,
        service: true
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

    const dayOfWeek = dayStart.getDay()
    const [businessHours, professionalHours] = await Promise.all([
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
      slots
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
  }) {
    const appointments = await prisma.appointment.findMany({
      where: {
        professionalId: input.professionalId,
        startAt: {
          lt: input.endAt
        },
        status: {
          not: 'CANCELLED'
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
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
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
