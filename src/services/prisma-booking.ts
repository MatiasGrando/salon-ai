import { Prisma } from '../generated/prisma/client.js'

export type BookingRepositoryClient = Prisma.TransactionClient

export function createAppointmentRecord(
  tx: BookingRepositoryClient,
  args: Prisma.AppointmentCreateArgs
) {
  return tx.appointment.create(args)
}

export function updateAppointmentRecord(
  tx: BookingRepositoryClient,
  args: Prisma.AppointmentUpdateArgs
) {
  return tx.appointment.update(args)
}

export async function professionalOffersServices(
  tx: BookingRepositoryClient,
  professionalId: string,
  serviceIds: readonly string[]
) {
  const count = await tx.professionalService.count({
    where: { professionalId, serviceId: { in: [...serviceIds] } }
  })
  return count === serviceIds.length
}

export async function isInsideBusinessHours(tx: BookingRepositoryClient, input: {
  businessId: string
  startAt: Date
  endAt: Date
  timezone?: string
}) {
  const interval = localInterval(input.startAt, input.endAt, input.timezone)
  if (!interval) return false
  const hours = await tx.businessHours.findMany({
    where: { businessId: input.businessId, dayOfWeek: interval.weekday }
  })
  return containsMinuteInterval(hours, interval.startMinute, interval.endMinute)
}

export async function isInsideProfessionalHours(tx: BookingRepositoryClient, input: {
  professionalId: string
  startAt: Date
  endAt: Date
  timezone?: string
}) {
  const interval = localInterval(input.startAt, input.endAt, input.timezone)
  if (!interval) return false
  const hours = await tx.professionalHours.findMany({
    where: { professionalId: input.professionalId, dayOfWeek: interval.weekday }
  })
  return containsMinuteInterval(hours, interval.startMinute, interval.endMinute)
}

export async function hasScheduleBlockOverlap(tx: BookingRepositoryClient, input: {
  businessId: string
  professionalId: string
  startAt: Date
  endAt: Date
}) {
  return (await tx.scheduleBlock.findFirst({
    where: {
      businessId: input.businessId,
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
      OR: [{ professionalId: input.professionalId }, { professionalId: null }]
    },
    select: { id: true }
  })) !== null
}

export async function hasAppointmentOverlap(tx: BookingRepositoryClient, input: {
  professionalId: string
  startAt: Date
  endAt: Date
  excludeAppointmentId?: string
  dbNow?: Date
}) {
  const excluded = input.excludeAppointmentId
    ? Prisma.sql`AND a."id" <> ${input.excludeAppointmentId}`
    : Prisma.empty
  const now = input.dbNow ? Prisma.sql`${input.dbNow}` : Prisma.sql`clock_timestamp()`
  const rows = await tx.$queryRaw<Array<{ overlaps: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM "Appointment" a
      LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
      WHERE a."professionalId" = ${input.professionalId}
        ${excluded}
        AND a."startAt" < ${input.endAt}
        AND a."startAt" + make_interval(mins => a."totalDurationMinutes") > ${input.startAt}
        AND (
          a."status" = 'CONFIRMED'::"AppointmentStatus"
          OR (
            a."status" = 'PENDING'::"AppointmentStatus"
            AND NOT (
              d."status" = 'PENDING_PROOF'::"BookingDepositStatus"
              AND d."expiresAt" <= ${now}
            )
          )
        )
    ) AS "overlaps"
  `)
  return rows[0]?.overlaps === true
}

function containsMinuteInterval(
  hours: Array<{ startTime: string; endTime: string }>,
  start: number,
  end: number
) {
  return hours.some((item) => start >= parseTime(item.startTime) && end <= parseTime(item.endTime))
}

function localInterval(startAt: Date, endAt: Date, timezone?: string) {
  if (!timezone) {
    if (startAt.toDateString() !== endAt.toDateString()) return null
    return {
      weekday: startAt.getDay(),
      startMinute: startAt.getHours() * 60 + startAt.getMinutes(),
      endMinute: endAt.getHours() * 60 + endAt.getMinutes()
    }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, hourCycle: 'h23'
  })
  const decompose = (value: Date) => {
    const parts = formatter.formatToParts(value)
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'))
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      weekday,
      minute: (Number(part('hour')) % 24) * 60 + Number(part('minute'))
    }
  }
  const start = decompose(startAt)
  const end = decompose(endAt)
  if (start.weekday < 0 || start.date !== end.date) return null
  return { weekday: start.weekday, startMinute: start.minute, endMinute: end.minute }
}

function parseTime(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}
