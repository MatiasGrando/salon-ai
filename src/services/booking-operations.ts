import type { Prisma } from '../generated/prisma/client.js'
import { reservationDurationLimits } from './service-duration.js'
import { acquireAgendaHierarchy, lockAppointmentRows } from './agenda-locks.js'
import {
  hasAppointmentOverlap,
  hasScheduleBlockOverlap,
  isInsideBusinessHours,
  isInsideProfessionalHours,
  professionalOffersServices
} from './prisma-booking.js'

export type BookingWriteConflict =
  | 'PROFESSIONAL_INACTIVE'
  | 'PROFESSIONAL_SERVICE_MISMATCH'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'OUTSIDE_PROFESSIONAL_HOURS'
  | 'SCHEDULE_BLOCK'
  | 'APPOINTMENT_OVERLAP'

export async function revalidateBookingWrite(tx: Prisma.TransactionClient, input: {
  businessId: string
  professionalId: string
  professionalIdsToLock?: readonly string[]
  serviceIds: readonly string[]
  startAt: Date
  excludeAppointmentId?: string
}) {
  await acquireAgendaHierarchy(tx, {
    businessId: input.businessId,
    professionalIds: input.professionalIdsToLock ?? [input.professionalId]
  })
  if (input.excludeAppointmentId) {
    await lockAppointmentRows(tx, {
      businessId: input.businessId,
      appointmentIds: [input.excludeAppointmentId]
    })
  }

  const professional = await tx.professional.findFirst({
    where: { id: input.professionalId, businessId: input.businessId }
  })
  const services = await tx.service.findMany({
    where: { id: { in: [...input.serviceIds] }, businessId: input.businessId }
  })
  if (!professional) throw new Error('Professional no longer belongs to the locked business')
  if (services.length !== input.serviceIds.length) throw new Error('Services no longer belong to the locked business')

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const orderedServices = input.serviceIds.map((serviceId) => servicesById.get(serviceId)!)
  const professionalDuration = orderedServices.reduce(
    (total, service) => total + reservationDurationLimits(service).professional,
    0
  )
  const customerDuration = orderedServices.reduce(
    (total, service) => total + reservationDurationLimits(service).business,
    0
  )
  const professionalEndAt = addMinutes(input.startAt, professionalDuration)
  const customerEndAt = addMinutes(input.startAt, customerDuration)

  const offersServices = await professionalOffersServices(tx, input.professionalId, input.serviceIds)
  const insideBusinessHours = await isInsideBusinessHours(tx, {
    businessId: input.businessId,
    startAt: input.startAt,
    endAt: customerEndAt
  })
  const insideProfessionalHours = await isInsideProfessionalHours(tx, {
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt
  })
  const scheduleBlock = await hasScheduleBlockOverlap(tx, {
    businessId: input.businessId,
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt
  })
  const appointmentOverlap = await hasAppointmentOverlap(tx, {
    professionalId: input.professionalId,
    startAt: input.startAt,
    endAt: professionalEndAt,
    ...(input.excludeAppointmentId ? { excludeAppointmentId: input.excludeAppointmentId } : {})
  })

  const conflicts: BookingWriteConflict[] = [
    ...(!professional.isActive ? ['PROFESSIONAL_INACTIVE' as const] : []),
    ...(!offersServices ? ['PROFESSIONAL_SERVICE_MISMATCH' as const] : []),
    ...(!insideBusinessHours ? ['OUTSIDE_BUSINESS_HOURS' as const] : []),
    ...(!insideProfessionalHours ? ['OUTSIDE_PROFESSIONAL_HOURS' as const] : []),
    ...(scheduleBlock ? ['SCHEDULE_BLOCK' as const] : []),
    ...(appointmentOverlap ? ['APPOINTMENT_OVERLAP' as const] : [])
  ]
  return {
    professional,
    orderedServices,
    professionalDuration,
    customerDuration,
    professionalEndAt,
    customerEndAt,
    conflicts
  }
}

export async function revalidateAppointmentsForConfirmation(
  tx: Prisma.TransactionClient,
  input: { businessId: string; appointmentIds: readonly string[] }
) {
  const ids = Array.from(new Set(input.appointmentIds.filter(Boolean))).sort()
  const appointments = await tx.appointment.findMany({
    where: { id: { in: ids }, professional: { businessId: input.businessId } },
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
      startAt: true,
      serviceItems: { select: { serviceId: true }, orderBy: { sortOrder: 'asc' } }
    }
  })
  if (appointments.length !== ids.length) return false
  const professionalIds = appointments.map((appointment) => appointment.professionalId)
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds })
  await lockAppointmentRows(tx, { businessId: input.businessId, appointmentIds: ids })
  for (const appointment of appointments) {
    const validation = await revalidateBookingWrite(tx, {
      businessId: input.businessId,
      professionalId: appointment.professionalId,
      professionalIdsToLock: professionalIds,
      serviceIds: appointment.serviceItems.length
        ? appointment.serviceItems.map((item) => item.serviceId)
        : [appointment.serviceId],
      startAt: appointment.startAt,
      excludeAppointmentId: appointment.id
    })
    if (validation.conflicts.length) return false
  }
  return true
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}
