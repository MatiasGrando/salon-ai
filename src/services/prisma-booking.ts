import type { Prisma } from '../generated/prisma/client.js'

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
}) {
  if (!sameLocalDate(input.startAt, input.endAt)) return false
  const hours = await tx.businessHours.findMany({
    where: { businessId: input.businessId, dayOfWeek: input.startAt.getDay() }
  })
  return containsInterval(hours, input.startAt, input.endAt)
}

export async function isInsideProfessionalHours(tx: BookingRepositoryClient, input: {
  professionalId: string
  startAt: Date
  endAt: Date
}) {
  if (!sameLocalDate(input.startAt, input.endAt)) return false
  const hours = await tx.professionalHours.findMany({
    where: { professionalId: input.professionalId, dayOfWeek: input.startAt.getDay() }
  })
  return containsInterval(hours, input.startAt, input.endAt)
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
}) {
  const appointments = await tx.appointment.findMany({
    where: {
      ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
      professionalId: input.professionalId,
      startAt: { lt: input.endAt },
      status: { notIn: ['CANCELLED', 'NO_SHOW'] }
    },
    select: { startAt: true, totalDurationMinutes: true }
  })
  return appointments.some((appointment) =>
    appointment.startAt < input.endAt &&
    addMinutes(appointment.startAt, appointment.totalDurationMinutes) > input.startAt
  )
}

function containsInterval(
  hours: Array<{ startTime: string; endTime: string }>,
  startAt: Date,
  endAt: Date
) {
  const start = minutesSinceMidnight(startAt)
  const end = minutesSinceMidnight(endAt)
  return hours.some((item) => start >= parseTime(item.startTime) && end <= parseTime(item.endTime))
}

function sameLocalDate(left: Date, right: Date) {
  return left.toDateString() === right.toDateString()
}

function minutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

function parseTime(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}
