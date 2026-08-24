import { prisma } from '../config/prisma.js'
import { AppointmentService } from './appointment-service.js'
import { calculateBookingV2Deposit, renderBookingV2DepositRequest } from './booking-v2-deposit.js'
import { findOrCreateCustomerByPhone } from './customer-identity-service.js'
import { phoneSearchVariants } from './phone-normalization-service.js'
import type {
  TamaraBotAvailableDate,
  TamaraOptionsBotGateway
} from './tamara-options-bot.js'

const TIME_ZONE = 'America/Argentina/Buenos_Aires'
const appointmentService = new AppointmentService()

export class PrismaTamaraOptionsBotGateway implements TamaraOptionsBotGateway {
  constructor(
    private readonly conversationId: string,
    private readonly configuredProfessionalId?: string
  ) {}

  async getContact(input: { businessId: string }) {
    const business = await prisma.business.findUnique({
      where: { id: input.businessId },
      select: {
        slug: true,
        contactEmail: true,
        instagramUrl: true,
        facebookUrl: true,
        tiktokUrl: true
      }
    })
    return {
      email: business?.contactEmail ?? null,
      website: business?.slug ? `https://weex.com.ar/${business.slug}` : null,
      instagram: business?.instagramUrl ?? null,
      facebook: business?.facebookUrl ?? null,
      tiktok: business?.tiktokUrl ?? null
    }
  }

  async getWorkingHours(input: { businessId: string }) {
    const professional = this.configuredProfessionalId
      ? null
      : await this.resolveProfessional(input.businessId)
    if (!this.configuredProfessionalId && !professional) return []
    const rows = await prisma.professionalHours.findMany({
      where: this.configuredProfessionalId
        ? {
            professionalId: this.configuredProfessionalId,
            professional: {
              businessId: input.businessId,
              isActive: true,
              acceptsBotBookings: true
            }
          }
        : { professionalId: professional!.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })
    const grouped = new Map<number, string[]>()
    for (const row of rows) grouped.set(row.dayOfWeek, [...(grouped.get(row.dayOfWeek) || []), `${row.startTime} a ${row.endTime}`])
    return [...grouped.entries()].map(([day, ranges]) => ({ dayLabel: dayLabel(day), ranges }))
  }

  async getCategories(input: { businessId: string }) {
    const professional = await this.resolveProfessional(input.businessId)
    if (!professional) return []
    const services = await prisma.service.findMany({
      where: {
        businessId: input.businessId,
        isBookable: true,
        attentionMode: 'DIRECT_BOOKING',
        professionalLinks: { some: { professionalId: professional.id } }
      },
      select: { category: true, catalogCategory: { select: { id: true, name: true, isActive: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })
    const categories = new Map<string, string>()
    for (const service of services) {
      if (service.catalogCategory?.isActive) categories.set(service.catalogCategory.id, service.catalogCategory.name)
      else {
        const name = service.category?.trim() || 'Consultas'
        categories.set(`legacy:${encodeURIComponent(name)}`, name)
      }
    }
    return [...categories].map(([id, name]) => ({ id, name }))
  }

  async getServices(input: { businessId: string; categoryId: string }) {
    const professional = await this.resolveProfessional(input.businessId)
    if (!professional) return []
    const legacyCategory = input.categoryId.startsWith('legacy:')
      ? decodeURIComponent(input.categoryId.slice('legacy:'.length))
      : null
    const rows = await prisma.service.findMany({
      where: {
        businessId: input.businessId,
        isBookable: true,
        attentionMode: 'DIRECT_BOOKING',
        professionalLinks: { some: { professionalId: professional.id } },
        ...(legacyCategory
          ? legacyCategory === 'Consultas'
            ? { catalogCategoryId: null, OR: [{ category: null }, { category: '' }, { category: legacyCategory }] }
            : { catalogCategoryId: null, category: legacyCategory }
          : { catalogCategoryId: input.categoryId })
      },
      select: { id: true, name: true, duration: true },
      orderBy: [{ bookingOrderPriority: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
    })
    return rows.map((service) => ({ id: service.id, name: service.name, durationMinutes: service.duration }))
  }

  async getAvailableDates(input: {
    businessId: string
    serviceId: string
    serviceIds?: string[]
    weekOffset: number
    exactTime?: string
    onlyWithAvailability?: boolean
    appointmentId?: string
  }) {
    const professional = await this.resolveProfessional(input.businessId, input.serviceId)
    if (!professional) return []
    const today = localToday()
    const days = input.exactTime || input.onlyWithAvailability ? 30 : 7
    const offset = input.exactTime ? 0 : Math.max(0, input.weekOffset) * 7
    const candidates = Array.from({ length: days }, (_, index) => addLocalDays(today, offset + index))
    if (!input.exactTime && !input.onlyWithAvailability) {
      return candidates.map((date) => ({ date, label: formatDateLabel(date) }))
    }
    const results = await appointmentService.findAvailabilityMany(candidates.map((date) => ({
        professionalId: professional.id,
        serviceId: input.serviceId,
        ...(input.serviceIds ? { serviceIds: input.serviceIds } : {}),
        date
    })))
    const availability = candidates.map((date, index) => ({ date, result: results[index]! }))
    return availability.flatMap<TamaraBotAvailableDate>(({ date, result }) => {
      if (!result.ok || !result.slots.length) return []
      if (input.exactTime && !result.slots.includes(input.exactTime)) return []
      return [{ date, label: formatDateLabel(date) }]
    })
  }

  async getAvailableTimes(input: { businessId: string; serviceId: string; serviceIds?: string[]; date: string; appointmentId?: string }) {
    const professional = await this.resolveProfessional(input.businessId, input.serviceId)
    if (!professional) return []
    const result = await appointmentService.findAvailability({
      professionalId: professional.id,
      serviceId: input.serviceId,
      ...(input.serviceIds ? { serviceIds: input.serviceIds } : {}),
      date: input.date
    })
    return result.ok ? result.slots : []
  }

  async getUpcomingAppointments(input: { businessId: string; phone: string }) {
    const variants = phoneSearchVariants(input.phone)
    const customers = await prisma.customer.findMany({
      where: {
        businessId: input.businessId,
        OR: [
          { normalizedPhone: { in: variants } },
          { phone: { in: [...new Set([input.phone, ...variants, ...variants.map((phone) => `+${phone}`)])] } }
        ]
      },
      select: { id: true }
    })
    if (!customers.length) return []
    const appointments = await prisma.appointment.findMany({
      where: {
        customerId: { in: customers.map((customer) => customer.id) },
        professional: { businessId: input.businessId },
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { gt: new Date() }
      },
      include: {
        service: { select: { id: true, name: true } },
        serviceItems: {
          select: { serviceId: true, service: { select: { name: true } } },
          orderBy: { sortOrder: 'asc' }
        },
        bookingDeposit: { select: { status: true } }
      },
      orderBy: { startAt: 'asc' },
      take: 30
    })
    return appointments.map((appointment) => ({
      id: appointment.id,
      date: formatDateKey(appointment.startAt),
      dateLabel: formatAppointmentDate(appointment.startAt),
      time: formatAppointmentTime(appointment.startAt),
      serviceName: appointment.serviceItems.length
        ? appointment.serviceItems.map((item) => item.service.name).join(' + ')
        : appointment.service.name,
      serviceId: appointment.service.id,
      serviceIds: appointment.serviceItems.length
        ? appointment.serviceItems.map((item) => item.serviceId)
        : [appointment.service.id],
      depositStatus: appointment.bookingDeposit?.status ?? null
    }))
  }

  async getCustomerName(input: { businessId: string; phone: string }) {
    const variants = phoneSearchVariants(input.phone)
    const customer = await prisma.customer.findFirst({
      where: {
        businessId: input.businessId,
        OR: [{ normalizedPhone: { in: variants } }, { phone: { in: [input.phone, ...variants] } }]
      },
      select: { name: true },
      orderBy: { createdAt: 'asc' }
    })
    return customer?.name ?? null
  }

  async reserve(input: {
    businessId: string
    phone: string
    customerName: string
    serviceId: string
    date: string
    time: string
  }) {
    const [professional, service] = await Promise.all([
      this.resolveProfessional(input.businessId, input.serviceId),
      prisma.service.findFirst({
        where: { id: input.serviceId, businessId: input.businessId, isBookable: true, attentionMode: 'DIRECT_BOOKING' },
        select: {
          id: true,
          name: true,
          price: true,
          depositMode: true,
          depositValue: true,
          depositHoldMinutes: true,
          business: { select: { paymentSettings: true } }
        }
      })
    ])
    if (!professional || !service) return { ok: false as const, reason: 'El servicio ya no está disponible para reserva.' }
    const customer = await findOrCreateCustomerByPhone({
      businessId: input.businessId,
      phone: input.phone,
      name: input.customerName
    })
    const deposit = calculateBookingV2Deposit({
      mode: service.depositMode,
      value: service.depositValue,
      servicePrice: service.price,
      estimateMinimum: null
    })
    const created = await appointmentService.create({
      customerId: customer.customer.id,
      professionalId: professional.id,
      serviceId: service.id,
      startAt: `${input.date}T${input.time}:00`,
      origin: 'BOT',
      status: deposit ? 'PENDING' : 'CONFIRMED'
    })
    if (!created.ok) return { ok: false as const, reason: created.message }
    if (!deposit) return { ok: true as const, appointmentId: created.appointment.id, requiresDeposit: false }

    const expiresAt = new Date(Date.now() + service.depositHoldMinutes * 60_000)
    try {
      const bookingDeposit = await prisma.bookingDeposit.create({
        data: {
          businessId: input.businessId,
          appointmentId: created.appointment.id,
          conversationId: this.conversationId,
          mode: deposit.mode,
          configuredValue: deposit.configuredValue,
          baseAmount: deposit.baseAmount,
          amount: deposit.amount,
          expiresAt
        }
      })
      return {
        ok: true as const,
        appointmentId: created.appointment.id,
        requiresDeposit: true,
        depositRequestId: bookingDeposit.id,
        depositMessage: renderBookingV2DepositRequest({
          serviceName: service.name,
          calculation: deposit,
          paymentSettings: service.business.paymentSettings,
          expiresAt
        })
      }
    } catch (error) {
      await appointmentService.cancel(created.appointment.id)
      throw error
    }
  }

  async reschedule(input: {
    businessId: string
    phone: string
    appointmentId: string
    serviceId: string
    serviceIds?: string[]
    date: string
    time: string
  }) {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: input.appointmentId,
        professional: { businessId: input.businessId },
        customer: { OR: [{ normalizedPhone: { in: phoneSearchVariants(input.phone) } }, { phone: input.phone }] },
        status: { in: ['PENDING', 'CONFIRMED'] }
      },
      select: {
        id: true,
        customerId: true,
        professionalId: true,
        serviceId: true,
        serviceItems: { select: { serviceId: true }, orderBy: { sortOrder: 'asc' } }
      }
    })
    if (!appointment) return { ok: false as const, reason: 'No encontré esa reserva o ya no puede modificarse.' }
    const result = await appointmentService.update({
      id: appointment.id,
      customerId: appointment.customerId,
      professionalId: appointment.professionalId,
      serviceId: appointment.serviceId,
      serviceIds: appointment.serviceItems.length
        ? appointment.serviceItems.map((item) => item.serviceId)
        : [appointment.serviceId],
      startAt: `${input.date}T${input.time}:00`
    })
    if (result.ok) return { ok: true as const }
    const requiresHandoff = /seña pendiente/i.test(result.message)
    return { ok: false as const, reason: result.message, ...(requiresHandoff ? { requiresHandoff: true } : {}) }
  }

  private async resolveProfessional(businessId: string, serviceId?: string) {
    if (this.configuredProfessionalId) {
      const configured = await prisma.professional.findFirst({
        where: {
          id: this.configuredProfessionalId,
          businessId,
          isActive: true,
          acceptsBotBookings: true,
          ...(serviceId ? { serviceLinks: { some: { serviceId } } } : {})
        },
        select: { id: true, name: true }
      })
      if (configured) return configured
    }
    return prisma.professional.findFirst({
      where: {
        businessId,
        isActive: true,
        acceptsBotBookings: true,
        ...(serviceId ? { serviceLinks: { some: { serviceId } } } : {})
      },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  }
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year!, month! - 1, day! + days, 12))
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function formatDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year!, month! - 1, day!, 12)))
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function formatAppointmentDate(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TIME_ZONE, weekday: 'long', day: '2-digit', month: '2-digit' })
    .format(date)
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatAppointmentTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function dayLabel(day: number) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][day] || `Día ${day}`
}
