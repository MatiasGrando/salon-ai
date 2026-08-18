import { prisma } from '../config/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import {
  markConversationOpportunityConverted,
  reopenConversationOpportunityForInvalidatedAppointment
} from './conversation-opportunity-service.js'
import { bookingDepositService } from './booking-deposit-service.js'
import { ensureDefaultMarketingPreference } from './marketing-preference-service.js'
import {
  reservationDurationLimits
} from './service-duration.js'

const availabilitySlotInterval = 30

type CreateAppointmentInput = {
  customerId: string
  professionalId: string
  serviceId: string
  serviceIds?: string[]
  startAt: string
  origin?: 'BOT' | 'WEB' | 'MANUAL' | 'UNKNOWN'
  force?: boolean
  status?: 'PENDING' | 'CONFIRMED'
  quotedPrice?: number | null
  manualDepositPaid?: boolean
  manualDepositAmount?: number | string | null
  coordinationGroupId?: string | null
}

export type AppointmentAvailabilityConflict = {
  code: 'OUTSIDE_BUSINESS_HOURS' | 'OUTSIDE_PROFESSIONAL_HOURS' | 'SCHEDULE_BLOCK' | 'APPOINTMENT_OVERLAP'
  message: string
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
      code?: 'PROFESSIONAL_SERVICE_MISMATCH' | 'APPOINTMENT_AVAILABILITY_CONFLICT'
      forceable?: boolean
      conflicts?: AppointmentAvailabilityConflict[]
    }

type UpdateAppointmentInput = CreateAppointmentInput & {
  id: string
}

type AppointmentStatusInput = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'

type FindAvailabilityInput = {
  professionalId: string
  serviceId: string
  serviceIds?: string[]
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
    await bookingDepositService.expireOverdue()
    const startAt = new Date(input.startAt)
    const manualDeposit = normalizeManualDeposit(
      input.manualDepositPaid === true,
      input.manualDepositAmount
    )

    if (Number.isNaN(startAt.getTime())) {
      return {
        ok: false,
        statusCode: 400,
        message: 'La fecha de inicio no parece valida'
      }
    }

    if (!manualDeposit.ok) {
      return {
        ok: false,
        statusCode: 400,
        message: manualDeposit.message
      }
    }

    const serviceIds = normalizedServiceIds(input.serviceId, input.serviceIds)
    const [professional, services, customer] = await Promise.all([
      prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      }),
      prisma.service.findMany({
        where: { id: { in: serviceIds } }
      }),
      prisma.customer.findUnique({ where: { id: input.customerId } })
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

    if (services.length !== serviceIds.length) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese servicio'
      }
    }

    if (!customer) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese cliente'
      }
    }

    if (services.some((service) => professional.businessId !== service.businessId)) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese profesional no corresponde a ese servicio'
      }
    }

    if (customer.businessId !== professional.businessId) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese cliente no pertenece al comercio del turno'
      }
    }

    if (!(await this.professionalOffersServices(input.professionalId, serviceIds))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no realiza todos los servicios seleccionados'
      }
    }

    const servicesById = new Map(services.map((service) => [service.id, service]))
    const orderedServices = serviceIds.map((serviceId) => servicesById.get(serviceId)!)
    const professionalDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).professional,
      0
    )
    const customerDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).business,
      0
    )
    const professionalEndAt = addMinutes(startAt, professionalDuration)
    const customerEndAt = addMinutes(startAt, customerDuration)
    const isInsideBusinessHours = await this.isInsideBusinessHours({
      businessId: professional.businessId,
      startAt,
      endAt: customerEndAt
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
      endAt: professionalEndAt
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
      endAt: professionalEndAt
    })

    if (hasScheduleBlock && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario esta bloqueado en la agenda'
      }
    }

    await ensureDefaultMarketingPreference({
      businessId: professional.businessId,
      customerId: input.customerId
    })

    const appointment = await prisma.$transaction(async (transaction) => {
      await this.lockProfessionalAgenda(transaction, input.professionalId)

      if (!input.force && await this.hasAppointmentOverlap({
        professionalId: input.professionalId,
        startAt,
        endAt: professionalEndAt
      }, transaction)) {
        return null
      }

      return transaction.appointment.create({
        data: {
          customerId: input.customerId,
          professionalId: input.professionalId,
          serviceId: input.serviceId,
          startAt,
          origin: input.origin ?? 'UNKNOWN',
          totalDurationMinutes: professionalDuration,
          status: input.status ?? 'CONFIRMED',
          quotedPrice: normalizeQuotedPrice(input.quotedPrice),
          manualDepositPaid: manualDeposit.paid,
          manualDepositAmount: manualDeposit.amount,
          coordinationGroupId: input.coordinationGroupId ?? null,
          serviceItems: {
            create: orderedServices.map((service, sortOrder) => ({
              serviceId: service.id,
              sortOrder,
              durationMinutes: service.duration,
              price: service.price
            }))
          }
        },
        include: { serviceItems: { include: { service: true }, orderBy: { sortOrder: 'asc' } } }
      })
    })

    if (!appointment) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese horario ya no esta disponible'
      }
    }

    if (appointment.status === 'CONFIRMED') {
      try {
        await markConversationOpportunityConverted({
          businessId: professional.businessId,
          customerPhone: customer.phone,
          appointmentId: appointment.id,
          completeConversation: true
        })
      } catch (error) {
        console.error('No pude vincular el turno con la oportunidad de chat', error)
      }
    }

    return {
      ok: true,
      appointment
    }
  }

  async replacePendingDepositServices(input: {
    appointmentId: string
    serviceIds: string[]
  }): Promise<AppointmentMutationResult> {
    await bookingDepositService.expireOverdue()
    const appointment = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      include: {
        professional: true,
        bookingDeposit: true
      }
    })
    if (!appointment || appointment.status !== 'PENDING') {
      return { ok: false, statusCode: 404, message: 'No encontre una reserva pendiente para modificar' }
    }
    if (appointment.bookingDeposit?.status !== 'PENDING_PROOF') {
      return {
        ok: false,
        statusCode: 409,
        message: 'El comprobante ya fue recibido; el equipo debe revisar cualquier cambio'
      }
    }

    const serviceIds = normalizedServiceIds(appointment.serviceId, input.serviceIds)
    const services = await prisma.service.findMany({ where: { id: { in: serviceIds } } })
    if (
      services.length !== serviceIds.length ||
      services.some((service) => service.businessId !== appointment.professional.businessId)
    ) {
      return { ok: false, statusCode: 400, message: 'No pude validar todos los servicios seleccionados' }
    }
    if (!(await this.professionalOffersServices(appointment.professionalId, serviceIds))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'El profesional elegido no realiza todos esos servicios'
      }
    }

    const servicesById = new Map(services.map((service) => [service.id, service]))
    const orderedServices = serviceIds.map((serviceId) => servicesById.get(serviceId)!)
    const professionalDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).professional,
      0
    )
    const customerDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).business,
      0
    )
    const professionalEndAt = addMinutes(appointment.startAt, professionalDuration)
    const customerEndAt = addMinutes(appointment.startAt, customerDuration)
    const [insideBusinessHours, insideProfessionalHours, hasBlock, hasOverlap] = await Promise.all([
      this.isInsideBusinessHours({
        businessId: appointment.professional.businessId,
        startAt: appointment.startAt,
        endAt: customerEndAt
      }),
      this.isInsideProfessionalHours({
        professionalId: appointment.professionalId,
        startAt: appointment.startAt,
        endAt: professionalEndAt
      }),
      this.hasScheduleBlockOverlap({
        businessId: appointment.professional.businessId,
        professionalId: appointment.professionalId,
        startAt: appointment.startAt,
        endAt: professionalEndAt
      }),
      this.hasAppointmentOverlap({
        professionalId: appointment.professionalId,
        startAt: appointment.startAt,
        endAt: professionalEndAt,
        excludeAppointmentId: appointment.id
      })
    ])
    if (!insideBusinessHours || !insideProfessionalHours || hasBlock || hasOverlap) {
      return {
        ok: false,
        statusCode: 409,
        message: 'El horario retenido no tiene tiempo suficiente para sumar esos servicios'
      }
    }

    const updated = await prisma.$transaction(async (transaction) => {
      await this.lockProfessionalAgenda(transaction, appointment.professionalId)
      if (await this.hasAppointmentOverlap({
        professionalId: appointment.professionalId,
        startAt: appointment.startAt,
        endAt: professionalEndAt,
        excludeAppointmentId: appointment.id
      }, transaction)) {
        return null
      }
      return transaction.appointment.update({
        where: { id: appointment.id },
        data: {
          totalDurationMinutes: professionalDuration,
          serviceItems: {
            deleteMany: {},
            create: orderedServices.map((service, sortOrder) => ({
              serviceId: service.id,
              sortOrder,
              durationMinutes: service.duration,
              price: service.price
            }))
          }
        },
        include: { serviceItems: { include: { service: true }, orderBy: { sortOrder: 'asc' } } }
      })
    })
    if (!updated) {
      return {
        ok: false,
        statusCode: 409,
        message: 'El horario retenido ya no tiene tiempo suficiente para sumar esos servicios'
      }
    }
    return { ok: true, appointment: updated }
  }

  async update(input: UpdateAppointmentInput): Promise<AppointmentMutationResult> {
    const existing = await prisma.appointment.findUnique({
      where: {
        id: input.id
      },
      include: {
        serviceItems: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    })

    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese turno'
      }
    }
    const updatesManualDeposit = input.manualDepositPaid !== undefined ||
      input.manualDepositAmount !== undefined
    const manualDeposit = updatesManualDeposit
      ? normalizeManualDeposit(
          input.manualDepositPaid ?? existing.manualDepositPaid,
          input.manualDepositAmount === undefined
            ? existing.manualDepositAmount
            : input.manualDepositAmount
        )
      : null
    if (manualDeposit && !manualDeposit.ok) {
      return {
        ok: false,
        statusCode: 400,
        message: manualDeposit.message
      }
    }
    if (
      existing.status === 'PENDING' &&
      await prisma.bookingDeposit.count({
        where: {
          appointmentId: existing.id,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        }
      })
    ) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Resolve la seña pendiente antes de modificar este turno'
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

    const serviceIds = normalizedServiceIds(input.serviceId, input.serviceIds)
    const [professional, services, customer] = await Promise.all([
      prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      }),
      prisma.service.findMany({
        where: { id: { in: serviceIds } }
      }),
      prisma.customer.findUnique({ where: { id: input.customerId } })
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

    if (services.length !== serviceIds.length) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre todos los servicios del turno'
      }
    }

    if (!customer) {
      return {
        ok: false,
        statusCode: 404,
        message: 'No encontre ese cliente'
      }
    }

    if (services.some((service) => professional.businessId !== service.businessId)) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese profesional no corresponde a los servicios del turno'
      }
    }

    if (customer.businessId !== professional.businessId) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Ese cliente no pertenece al comercio del turno'
      }
    }

    if (!(await this.professionalOffersServices(input.professionalId, serviceIds))) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Ese profesional no realiza todos los servicios del turno',
        code: 'PROFESSIONAL_SERVICE_MISMATCH',
        forceable: false
      }
    }

    const servicesById = new Map(services.map((service) => [service.id, service]))
    const orderedServices = serviceIds.map((serviceId) => servicesById.get(serviceId)!)
    const professionalDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).professional,
      0
    )
    const customerDuration = orderedServices.reduce(
      (total, service) => total + reservationDurationLimits(service).business,
      0
    )
    const professionalEndAt = addMinutes(startAt, professionalDuration)
    const customerEndAt = addMinutes(startAt, customerDuration)
    const [isInsideBusinessHours, isInsideProfessionalHours, hasScheduleBlock, hasOverlap] = await Promise.all([
      this.isInsideBusinessHours({
        businessId: professional.businessId,
        startAt,
        endAt: customerEndAt
      }),
      this.isInsideProfessionalHours({
        professionalId: input.professionalId,
        startAt,
        endAt: professionalEndAt
      }),
      this.hasScheduleBlockOverlap({
        businessId: professional.businessId,
        professionalId: input.professionalId,
        startAt,
        endAt: professionalEndAt
      }),
      this.hasAppointmentOverlap({
        professionalId: input.professionalId,
        startAt,
        endAt: professionalEndAt,
        excludeAppointmentId: input.id
      })
    ])
    const conflicts: AppointmentAvailabilityConflict[] = [
      ...(!isInsideBusinessHours
        ? [{ code: 'OUTSIDE_BUSINESS_HOURS' as const, message: 'El turno queda fuera del horario de atencion del local' }]
        : []),
      ...(!isInsideProfessionalHours
        ? [{ code: 'OUTSIDE_PROFESSIONAL_HOURS' as const, message: 'El profesional no trabaja durante todo ese horario' }]
        : []),
      ...(hasScheduleBlock
        ? [{ code: 'SCHEDULE_BLOCK' as const, message: 'El horario esta bloqueado en la agenda' }]
        : []),
      ...(hasOverlap
        ? [{ code: 'APPOINTMENT_OVERLAP' as const, message: 'El profesional ya tiene otro turno en ese horario' }]
        : [])
    ]

    if (conflicts.length && !input.force) {
      return {
        ok: false,
        statusCode: 409,
        message: conflicts[0]!.message,
        code: 'APPOINTMENT_AVAILABILITY_CONFLICT',
        forceable: true,
        conflicts
      }
    }

    const appointment = await prisma.$transaction(async (transaction) => {
      await this.lockProfessionalAgenda(transaction, input.professionalId)
      if (!input.force && await this.hasAppointmentOverlap({
        professionalId: input.professionalId,
        startAt,
        endAt: professionalEndAt,
        excludeAppointmentId: input.id
      }, transaction)) {
        return null
      }
      return transaction.appointment.update({
        where: {
          id: input.id
        },
        data: {
          customerId: input.customerId,
          professionalId: input.professionalId,
          serviceId: input.serviceId,
          startAt,
          totalDurationMinutes: professionalDuration,
          ...(manualDeposit?.ok
            ? {
                manualDepositPaid: manualDeposit.paid,
                manualDepositAmount: manualDeposit.amount
              }
            : {}),
          serviceItems: {
            deleteMany: {},
            create: orderedServices.map((service, sortOrder) => ({
              serviceId: service.id,
              sortOrder,
              durationMinutes: service.duration,
              price: service.price
            }))
          },
          status: 'CONFIRMED'
        },
        include: {
          customer: {
            select: { id: true, name: true, phone: true }
          },
          professional: {
            select: { id: true, name: true, businessId: true, isActive: true }
          },
          service: {
            select: { id: true, name: true, duration: true, price: true }
          },
          serviceItems: {
            include: {
              service: {
                select: { id: true, name: true, duration: true, price: true }
              }
            },
            orderBy: { sortOrder: 'asc' }
          },
          bookingDeposit: {
            select: { status: true, expiresAt: true }
          }
        }
      })
    })

    if (!appointment) {
      return {
        ok: false,
        statusCode: 409,
        message: 'El profesional ya tiene otro turno en ese horario',
        code: 'APPOINTMENT_AVAILABILITY_CONFLICT',
        forceable: true,
        conflicts: [{
          code: 'APPOINTMENT_OVERLAP',
          message: 'El profesional ya tiene otro turno en ese horario'
        }]
      }
    }

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
    const cancelledAppointment = await prisma.appointment.update({
        where: {
          id: appointmentId
        },
        data: {
          status: 'CANCELLED'
        }
      })
    await prisma.bookingDeposit.updateMany({
      where: {
        appointmentId,
        status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
      },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        rejectionReason: 'Turno cancelado'
      }
    })
    try {
      await reopenConversationOpportunityForInvalidatedAppointment(appointmentId)
    } catch (error) {
      console.error('No pude reabrir la oportunidad del turno cancelado', error)
    }
    return {
      ok: true as const,
      appointment: cancelledAppointment
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
    if (
      status === 'CONFIRMED' &&
      await prisma.bookingDeposit.count({
        where: {
          appointmentId,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        }
      })
    ) {
      return {
        ok: false as const,
        statusCode: 409,
        message: 'Aproba el comprobante desde la conversacion antes de confirmar el turno'
      }
    }

    const updatedAppointment = status === 'CONFIRMED'
      ? await prisma.$transaction(async (transaction) => {
          await this.lockProfessionalAgenda(transaction, appointment.professionalId)
          if (await this.hasAppointmentOverlap({
            professionalId: appointment.professionalId,
            startAt: appointment.startAt,
            endAt: addMinutes(appointment.startAt, appointment.totalDurationMinutes),
            excludeAppointmentId: appointment.id
          }, transaction)) {
            return null
          }
          return transaction.appointment.update({
            where: { id: appointmentId },
            data: { status },
            include: {
              customer: true,
              professional: true,
              service: true
            }
          })
        })
      : await prisma.appointment.update({
          where: { id: appointmentId },
          data: { status },
          include: {
            customer: true,
            professional: true,
            service: true
          }
        })
    if (!updatedAppointment) {
      return {
        ok: false as const,
        statusCode: 409,
        message: 'Ese horario ya no esta disponible'
      }
    }
    if (status === 'CANCELLED' || status === 'NO_SHOW') {
      await prisma.bookingDeposit.updateMany({
        where: {
          appointmentId,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          rejectionReason: status === 'CANCELLED' ? 'Turno cancelado' : 'Turno marcado como ausente'
        }
      })
      try {
        await reopenConversationOpportunityForInvalidatedAppointment(appointmentId)
      } catch (error) {
        console.error('No pude reabrir la oportunidad del turno invalidado', error)
      }
    }
    return {
      ok: true as const,
      appointment: updatedAppointment
    }
  }

  async confirmPendingAppointments(appointmentIds: string[]) {
    const ids = Array.from(new Set(appointmentIds.filter(Boolean)))
    if (!ids.length) return false
    return prisma.$transaction(async (tx) => {
      const pending = await tx.appointment.count({
        where: { id: { in: ids }, status: 'PENDING' }
      })
      if (pending !== ids.length) return false
      const confirmed = await tx.appointment.updateMany({
        where: { id: { in: ids }, status: 'PENDING' },
        data: { status: 'CONFIRMED' }
      })
      return confirmed.count === ids.length
    })
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
        customer: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        professional: {
          select: {
            id: true,
            name: true,
            businessId: true,
            isActive: true
          }
        },
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true
          }
        },
        serviceItems: {
          include: {
            service: {
              select: { id: true, name: true, duration: true, price: true }
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        bookingDeposit: {
          select: { status: true, expiresAt: true }
        }
      },
      orderBy: {
        startAt: 'asc'
      }
    })
  }

  async findAvailability(input: FindAvailabilityInput): Promise<FindAvailabilityResult> {
    return (await this.findAvailabilityMany([input]))[0]!
  }

  async findAvailabilityMany(inputs: FindAvailabilityInput[]): Promise<FindAvailabilityResult[]> {
    if (!inputs.length) return []
    const now = new Date()
    const prepared = inputs.map((input) => ({
      input,
      dayStart: parseDate(input.date),
      serviceIds: normalizedServiceIds(input.serviceId, input.serviceIds)
    }))
    const professionalIds = Array.from(new Set(prepared.map((item) => item.input.professionalId)))
    const serviceIds = Array.from(new Set(prepared.flatMap((item) => item.serviceIds)))
    const [professionals, services] = await Promise.all([
      prisma.professional.findMany({
        where: { id: { in: professionalIds } },
        select: {
          id: true,
          name: true,
          businessId: true,
          isActive: true,
          serviceLinks: {
            where: { serviceId: { in: serviceIds } },
            select: { serviceId: true }
          }
        }
      }),
      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          businessId: true,
          duration: true,
          customerDurationMin: true,
          customerDurationMax: true
        }
      })
    ])
    const professionalsById = new Map(professionals.map((professional) => [professional.id, professional]))
    const servicesById = new Map(services.map((service) => [service.id, service]))
    const validPrepared = prepared.flatMap((item, index) => {
      if (!item.dayStart) return []
      const professional = professionalsById.get(item.input.professionalId)
      if (!professional?.isActive) return []
      const selectedServices = item.serviceIds.map((serviceId) => servicesById.get(serviceId))
      if (selectedServices.some((service) => !service)) return []
      if (selectedServices.some((service) => service!.businessId !== professional.businessId)) return []
      const offeredServiceIds = new Set(professional.serviceLinks.map((link) => link.serviceId))
      if (item.serviceIds.some((serviceId) => !offeredServiceIds.has(serviceId))) return []
      return [{
        index,
        item,
        professional,
        services: selectedServices.map((service) => service!),
        dayStart: item.dayStart,
        dayEnd: addDays(item.dayStart, 1)
      }]
    })

    const resultByIndex = new Map<number, FindAvailabilityResult>()
    for (const [index, item] of prepared.entries()) {
      const professional = professionalsById.get(item.input.professionalId)
      if (!item.dayStart) {
        resultByIndex.set(index, { ok: false, statusCode: 400, message: 'La fecha no parece valida' })
      } else if (!professional) {
        resultByIndex.set(index, { ok: false, statusCode: 404, message: 'No encontre ese profesional' })
      } else if (!professional.isActive) {
        resultByIndex.set(index, { ok: false, statusCode: 409, message: 'Ese profesional no esta activo' })
      } else {
        const selectedServices = item.serviceIds.map((serviceId) => servicesById.get(serviceId))
        if (selectedServices.some((service) => !service)) {
          resultByIndex.set(index, { ok: false, statusCode: 404, message: 'No encontre ese servicio' })
        } else if (selectedServices.some((service) => service!.businessId !== professional.businessId)) {
          resultByIndex.set(index, { ok: false, statusCode: 400, message: 'Ese profesional no corresponde a ese servicio' })
        } else {
          const offeredServiceIds = new Set(professional.serviceLinks.map((link) => link.serviceId))
          if (item.serviceIds.some((serviceId) => !offeredServiceIds.has(serviceId))) {
            resultByIndex.set(index, {
              ok: false,
              statusCode: 409,
              message: 'Ese profesional no realiza todos los servicios seleccionados'
            })
          }
        }
      }
    }
    if (!validPrepared.length) return prepared.map((_, index) => resultByIndex.get(index)!)

    const earliestDay = new Date(Math.min(...validPrepared.map((item) => item.dayStart.getTime())))
    const latestDay = new Date(Math.max(...validPrepared.map((item) => item.dayEnd.getTime())))
    const businessIds = Array.from(new Set(validPrepared.map((item) => item.professional.businessId)))
    const dayOfWeeks = Array.from(new Set(validPrepared.map((item) => item.dayStart.getDay())))
    const validProfessionalIds = Array.from(new Set(validPrepared.map((item) => item.professional.id)))
    const [businessHours, professionalHours, scheduleBlocks, appointments] = await Promise.all([
      prisma.businessHours.findMany({
        where: { businessId: { in: businessIds }, dayOfWeek: { in: dayOfWeeks } },
        select: { businessId: true, dayOfWeek: true, startTime: true, endTime: true }
      }),
      prisma.professionalHours.findMany({
        where: { professionalId: { in: validProfessionalIds }, dayOfWeek: { in: dayOfWeeks } },
        select: { professionalId: true, dayOfWeek: true, startTime: true, endTime: true }
      }),
      prisma.scheduleBlock.findMany({
        where: {
          businessId: { in: businessIds },
          startAt: { lt: latestDay },
          endAt: { gt: earliestDay },
          OR: [{ professionalId: { in: validProfessionalIds } }, { professionalId: null }]
        },
        select: {
          businessId: true,
          professionalId: true,
          reason: true,
          title: true,
          startAt: true,
          endAt: true
        }
      }),
      prisma.appointment.findMany({
        where: {
          professionalId: { in: validProfessionalIds },
          startAt: { gte: earliestDay, lt: latestDay },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          NOT: {
            status: 'PENDING',
            bookingDeposit: {
              is: { status: 'PENDING_PROOF', expiresAt: { lte: now } }
            }
          }
        },
        select: { professionalId: true, startAt: true, totalDurationMinutes: true }
      })
    ])

    for (const current of validPrepared) {
      const dayOfWeek = current.dayStart.getDay()
      const relevantBusinessHours = businessHours.filter((hours) =>
        hours.businessId === current.professional.businessId && hours.dayOfWeek === dayOfWeek
      )
      const relevantProfessionalHours = professionalHours.filter((hours) =>
        hours.professionalId === current.professional.id && hours.dayOfWeek === dayOfWeek
      )
      const relevantBlocks = scheduleBlocks.filter((block) =>
        block.businessId === current.professional.businessId &&
        (block.professionalId === null || block.professionalId === current.professional.id) &&
        block.startAt < current.dayEnd && block.endAt > current.dayStart
      )
      const relevantAppointments = appointments.filter((appointment) =>
        appointment.professionalId === current.professional.id &&
        appointment.startAt >= current.dayStart && appointment.startAt < current.dayEnd
      )
      const professionalDuration = current.services.reduce(
        (total, service) => total + reservationDurationLimits(service).professional,
        0
      )
      const customerDuration = current.services.reduce(
        (total, service) => total + reservationDurationLimits(service).business,
        0
      )
      const windows = getAvailabilityWindows(relevantBusinessHours, relevantProfessionalHours)
      const slots: string[] = []
      for (const window of windows) {
        for (
          let slotStartMinutes = window.start;
          slotStartMinutes + professionalDuration <= window.professionalEnd &&
            slotStartMinutes + customerDuration <= window.businessEnd;
          slotStartMinutes += availabilitySlotInterval
        ) {
          const startAt = setMinutesSinceMidnight(current.dayStart, slotStartMinutes)
          const endAt = addMinutes(startAt, professionalDuration)
          if (startAt <= now || hasBlockedIntervalOverlap(relevantBlocks, startAt, endAt)) continue
          if (!hasAppointmentIntervalOverlap(relevantAppointments, startAt, endAt)) {
            slots.push(formatTime(startAt))
          }
        }
      }
      resultByIndex.set(current.index, {
        ok: true,
        slots,
        unavailableReason: slots.length === 0
          ? explainBlockedAvailability({
              blocks: relevantBlocks,
              dayStart: current.dayStart,
              dayEnd: current.dayEnd,
              professionalName: current.professional.name
            })
          : null
      })
    }
    return prepared.map((_, index) => resultByIndex.get(index)!)
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
  }, client: Pick<Prisma.TransactionClient, 'appointment'> = prisma) {
    const appointments = await client.appointment.findMany({
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
      select: { startAt: true, totalDurationMinutes: true }
    })

    return appointments.some((appointment) => {
      const existingStart = appointment.startAt
      const existingEnd = addMinutes(existingStart, appointment.totalDurationMinutes)

      return existingStart < input.endAt && existingEnd > input.startAt
    })
  }

  private async lockProfessionalAgenda(
    transaction: Prisma.TransactionClient,
    professionalId: string
  ) {
    const lockKey = `appointment-agenda:${professionalId}`
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${lockKey}))
    `
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

  private async professionalOffersServices(professionalId: string, serviceIds: string[]) {
    const serviceCount = await prisma.professionalService.count({
      where: {
        professionalId,
        serviceId: { in: serviceIds }
      }
    })
    return serviceCount === serviceIds.length
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
      if (start >= businessEnd || start >= professionalEnd) {
        return []
      }

      return [{ start, businessEnd, professionalEnd }]
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

function hasAppointmentIntervalOverlap(
  appointments: Array<{
    startAt: Date
    totalDurationMinutes: number
  }>,
  startAt: Date,
  endAt: Date
) {
  return appointments.some((appointment) => {
    const existingStart = appointment.startAt
    const existingEnd = addMinutes(existingStart, appointment.totalDurationMinutes)

    return existingStart < endAt && existingEnd > startAt
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

export function normalizeManualDeposit(
  paid: boolean,
  amount: number | string | null | undefined
) {
  if (!paid) {
    return { ok: true as const, paid: false, amount: null }
  }
  if (amount === null || amount === undefined || amount === '') {
    return { ok: true as const, paid: true, amount: null }
  }

  const parsedAmount = typeof amount === 'number' ? amount : Number(amount.trim())
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return {
      ok: false as const,
      message: 'El monto de la seña debe ser un numero entero mayor a 0'
    }
  }
  return { ok: true as const, paid: true, amount: parsedAmount }
}

function normalizeQuotedPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  return Number.isInteger(value) && value > 0 ? value : null
}

function normalizedServiceIds(primaryServiceId: string, serviceIds?: string[]) {
  return Array.from(new Set([
    primaryServiceId,
    ...(serviceIds ?? [])
  ].map((serviceId) => serviceId.trim()).filter(Boolean))).slice(0, 5)
}
