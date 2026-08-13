import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import { BusinessService } from '../services/business-service.js'
import { sendBookingConfirmationEmail } from '../services/booking-confirmation-email-service.js'
import { inferDefaultAreaCodeFromPhone, normalizePhone, phoneSearchVariants } from '../services/phone-normalization-service.js'
import { findOrCreateCustomerByPhone } from '../services/customer-identity-service.js'
import { customerDurationRange, formatCustomerDuration, reservationDurationLimits } from '../services/service-duration.js'
import { calculateBookingV2Deposit } from '../services/booking-v2-deposit.js'
import { bookingDepositService } from '../services/booking-deposit-service.js'
import { BookingAvailabilitySearchEngine } from '../services/booking-availability-search.js'
import {
  createGoogleCalendarEventForAppointment,
  getWeexAuthFromRequest,
  linkExistingCustomersByPhone,
  weexGoogleCalendarEnabled
} from '../services/weex-account-service.js'

const businessService = new BusinessService()
const appointmentService = new AppointmentService()

export async function publicBookingRoutes(app: FastifyInstance) {
  app.get('/public/booking/:slug/catalog', async (request, reply) => {
    const params = request.params as { slug: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })

    const [serviceLinks, combinationRules] = await Promise.all([
      prisma.professionalService.findMany({
        where: {
          service: { businessId: business.id },
          professional: { businessId: business.id, isActive: true }
        },
        select: { serviceId: true, professionalId: true }
      }),
      prisma.serviceCombinationRule.findMany({
        where: { businessId: business.id },
        select: { serviceAId: true, serviceBId: true, policy: true, note: true }
      })
    ])

    return {
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug
      },
      services: business.services
        .filter((service) => serviceCanBookFromWeb(service))
        .filter((service) => service.depositMode === 'NONE' || (
          webTransferEnabled(business) && Boolean(calculateBookingV2Deposit({
            mode: service.depositMode,
            value: service.depositValue,
            servicePrice: service.price,
            estimateMinimum: defaultEstimateMinimum(service)
          }))
        ))
        .map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        customerDurationMin: service.customerDurationMin,
        customerDurationMax: service.customerDurationMax,
        displayDuration: formatCustomerDuration(service),
        category: service.category,
        price: service.price,
        priceMode: service.priceMode,
        attentionMode: service.attentionMode,
        estimateExplanation: service.estimateExplanation,
        estimateQuestion: service.estimateQuestion,
        estimateOptions: publicEstimateOptions(service.estimateOptions),
        estimateDisclaimer: service.estimateDisclaimer,
        estimateAllowsBooking: service.estimateAllowsBooking,
        validationEnabled: service.validationEnabled,
        validationMessage: service.validationMessage,
        validationQuestion: service.validationQuestion,
        bookingOrderPriority: service.bookingOrderPriority,
        depositMode: service.depositMode,
        depositValue: service.depositValue,
        depositHoldMinutes: service.depositHoldMinutes,
        deposit: calculateBookingV2Deposit({
          mode: service.depositMode,
          value: service.depositValue,
          servicePrice: service.price,
          estimateMinimum: defaultEstimateMinimum(service)
        }),
        professionalIds: serviceLinks
          .filter((link) => link.serviceId === service.id)
          .map((link) => link.professionalId)
      })),
      professionals: business.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        avatarUrl: professional.avatarUrl
      })),
      combinationRules
    }
  })

  app.get('/public/booking/:slug/availability', async (request, reply) => {
    const params = request.params as { slug: string }
    const query = request.query as {
      serviceId?: string
      professionalId?: string
      date?: string
    }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    if (!query.serviceId || !query.professionalId || !query.date) return reply.status(400).send({ message: 'Servicio, profesional y fecha son requeridos' })
    const serviceId = query.serviceId
    const professionalId = query.professionalId
    const date = query.date

    const professionals = await professionalsForService(business.id, serviceId, professionalId)
    if (professionals.length === 0) return reply.status(404).send({ message: 'No hay profesionales para ese servicio' })

    const slots: Array<{ time: string; professionalId: string; professionalName: string }> = []
    const errors: string[] = []

    const results = await Promise.all(professionals.map(async (professional) => ({
      professional,
      result: await appointmentService.findAvailability({
        professionalId: professional.id,
        serviceId,
        date
      })
    })))

    for (const { professional, result } of results) {
      if (result.ok) {
        for (const time of result.slots) {
          slots.push({
            time,
            professionalId: professional.id,
            professionalName: professional.name
          })
        }
      } else {
        errors.push(result.message)
      }
    }

    slots.sort((left, right) => left.time.localeCompare(right.time) || left.professionalName.localeCompare(right.professionalName))

    return {
      slots,
      message: slots.length ? null : errors[0] || 'No hay horarios disponibles para esa fecha'
    }
  })

  app.post('/public/booking/:slug/itineraries', async (request, reply) => {
    const params = request.params as { slug: string }
    const body = request.body as { serviceIds?: string[]; date?: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const date = body.date?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ message: 'Selecciona una fecha valida' })
    }
    const selection = await preparePublicServiceSet(business, body.serviceIds)
    if (!selection.ok) return reply.status(selection.statusCode).send({ message: selection.message })
    const availability = await searchPublicCoordinatedAvailability({
      business,
      services: selection.services,
      date
    })
    return {
      options: availability.options,
      message: availability.options.length ? null : coordinatedAvailabilityMessage(availability.status),
      status: availability.status
    }
  })

  app.post('/public/booking/:slug/book', async (request, reply) => {
    const params = request.params as { slug: string }
    const body = request.body as {
      serviceId?: string
      professionalId?: string
      date?: string
      time?: string
      customerName?: string
      customerPhone?: string
      estimateOptionId?: string | null
      validationAccepted?: boolean
    }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })

    const serviceId = body.serviceId?.trim()
    const professionalId = body.professionalId?.trim()
    const date = body.date?.trim()
    const time = body.time?.trim()
    const weexAuth = await getWeexAuthFromRequest(request)
    const customerName = weexAuth?.account.name || body.customerName?.trim()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const customerPhone = normalizePhone(weexAuth?.account.phone || body.customerPhone, { defaultAreaCode })

    if (!serviceId || !professionalId || !date || !time || !customerName || !customerPhone) {
      return reply.status(400).send({ message: 'Completa servicio, profesional, fecha, horario y tus datos de contacto' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return reply.status(400).send({ message: 'La fecha u horario no parecen validos' })
    }
    if (customerPhone.length < 8) {
      return reply.status(400).send({ message: 'Ingresa un telefono valido para confirmar el turno' })
    }

    const professionals = await professionalsForService(business.id, serviceId, professionalId)
    if (!professionals.some((professional) => professional.id === professionalId)) {
      return reply.status(400).send({ message: 'Ese profesional no corresponde al servicio elegido' })
    }

    const customer = await findOrCreatePublicCustomer({
      businessId: business.id,
      name: customerName,
      phone: customerPhone,
      email: weexAuth?.account.emailVerified ? weexAuth.account.email : null
    })
    const service = business.services.find((item) => item.id === serviceId)
    if (!service || !serviceCanBookFromWeb(service)) {
      return reply.status(400).send({ message: 'Ese servicio no esta disponible para reserva online' })
    }
    if (service.validationEnabled && body.validationAccepted !== true) {
      return reply.status(400).send({ message: 'Confirma la validacion del servicio antes de reservar' })
    }
    const estimateSelection = resolvePublicEstimateSelection(service, body.estimateOptionId)
    if (!estimateSelection.ok) {
      return reply.status(400).send({ message: estimateSelection.message })
    }
    const depositCalculation = calculateBookingV2Deposit({
      mode: service.depositMode,
      value: service.depositValue,
      servicePrice: service.price,
      estimateMinimum: estimateSelection.priceMin
    })
    if (service.depositMode !== 'NONE' && !depositCalculation) {
      return reply.status(409).send({ message: 'La seña de este servicio necesita una configuracion valida' })
    }
    if (depositCalculation && !webTransferEnabled(business)) {
      return reply.status(409).send({ message: 'Este comercio todavia no habilito transferencias para recibir la seña' })
    }

    const result = await appointmentService.create({
      customerId: customer.id,
      professionalId,
      serviceId,
      startAt: `${date}T${time}:00`,
      status: depositCalculation ? 'PENDING' : 'CONFIRMED',
      quotedPrice: estimateSelection.priceMin
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({ message: result.message })
    }

    if (weexAuth?.account.phone) {
      await linkExistingCustomersByPhone(weexAuth.account.id, customerPhone, defaultAreaCode)
    }

    let deposit = null
    if (depositCalculation) {
      const expiresAt = new Date(Date.now() + service.depositHoldMinutes * 60_000)
      try {
        deposit = await prisma.bookingDeposit.create({
          data: {
            businessId: business.id,
            appointmentId: result.appointment.id,
            conversationId: null,
            source: 'WEB',
            mode: depositCalculation.mode,
            configuredValue: depositCalculation.configuredValue,
            baseAmount: depositCalculation.baseAmount,
            amount: depositCalculation.amount,
            expiresAt
          }
        })
      } catch (error) {
        await prisma.appointment.update({
          where: { id: result.appointment.id },
          data: { status: 'CANCELLED' }
        })
        throw error
      }
    }

    const appointment = await prisma.appointment.findUnique({
      where: {
        id: result.appointment.id
      },
      include: {
        service: true,
        professional: true,
        customer: true
      }
    })

    let calendarSync: { ok: true; eventId: string } | { ok: false; message: string } | null = null
    if (!deposit && weexAuth && weexGoogleCalendarEnabled()) {
      try {
        calendarSync = await createGoogleCalendarEventForAppointment({
          accountId: weexAuth.account.id,
          appointmentId: result.appointment.id
        })
      } catch (error) {
        calendarSync = {
          ok: false,
          message: error instanceof Error ? error.message : 'El turno se guardo, pero no pudimos cargarlo en Google Calendar.'
        }
      }
    }

    if (!deposit && weexAuth?.account.emailVerified && appointment) {
      void sendBookingConfirmationEmail({
        recipientEmail: weexAuth.account.email,
        recipientName: weexAuth.account.name,
        appointmentId: appointment.id,
        businessName: business.name,
        businessAddress: [business.publicAddress, business.publicAddressArea].filter(Boolean).join(', ') || null,
        businessAddressArea: business.publicAddressArea,
        serviceName: appointment.service.name,
        professionalName: appointment.professional.name,
        startAt: appointment.startAt,
        durationMinutes: customerDurationRange(appointment.service).max
      }).catch((error) => {
        request.log.error({ error, appointmentId: appointment.id }, 'No se pudo enviar el correo de confirmacion')
      })
    }

    return {
      appointment,
      calendarSync,
      deposit: deposit ? {
        id: deposit.id,
        amount: deposit.amount,
        expiresAt: deposit.expiresAt,
        status: deposit.status,
        payment: publicTransferSettings(business)
      } : null,
      estimate: estimateSelection.priceMin !== null ? {
        optionId: estimateSelection.optionId,
        optionLabel: estimateSelection.optionLabel,
        priceMin: estimateSelection.priceMin,
        priceMax: estimateSelection.priceMax
      } : null
    }
  })

  app.post('/public/booking/:slug/book-coordinated', async (request, reply) => {
    const params = request.params as { slug: string }
    const body = request.body as {
      serviceSelections?: Array<{
        serviceId?: string
        estimateOptionId?: string | null
        validationAccepted?: boolean
      }>
      date?: string
      itineraryId?: string
      customerName?: string
      customerPhone?: string
    }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const date = body.date?.trim()
    const itineraryId = body.itineraryId?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !itineraryId) {
      return reply.status(400).send({ message: 'Selecciona una fecha y un itinerario validos' })
    }
    const rawSelections = Array.isArray(body.serviceSelections) ? body.serviceSelections : []
    const selection = await preparePublicServiceSet(
      business,
      rawSelections.map((item) => item.serviceId || '')
    )
    if (!selection.ok) return reply.status(selection.statusCode).send({ message: selection.message })
    if (selection.services.length < 2) {
      return reply.status(400).send({ message: 'La reserva coordinada necesita al menos dos servicios' })
    }

    const resolvedSelections = []
    for (const service of selection.services) {
      const submitted = rawSelections.find((item) => item.serviceId === service.id)
      if (service.validationEnabled && submitted?.validationAccepted !== true) {
        return reply.status(400).send({ message: `Confirma la validacion de ${service.name} antes de reservar` })
      }
      const estimate = resolvePublicEstimateSelection(service, submitted?.estimateOptionId)
      if (!estimate.ok) return reply.status(400).send({ message: `${service.name}: ${estimate.message}` })
      const deposit = calculateBookingV2Deposit({
        mode: service.depositMode,
        value: service.depositValue,
        servicePrice: service.price,
        estimateMinimum: estimate.priceMin
      })
      if (service.depositMode !== 'NONE' && !deposit) {
        return reply.status(409).send({ message: `La seña de ${service.name} necesita una configuracion valida` })
      }
      resolvedSelections.push({ service, estimate, deposit })
    }
    const totalDeposit = resolvedSelections.reduce((total, item) => total + (item.deposit?.amount ?? 0), 0)
    if (totalDeposit > 0 && !webTransferEnabled(business)) {
      return reply.status(409).send({ message: 'Este comercio todavia no habilito transferencias para recibir la seña' })
    }

    const availability = await searchPublicCoordinatedAvailability({
      business,
      services: selection.services,
      date
    })
    const itinerary = availability.options.find((option) => option.id === itineraryId)
    if (!itinerary) {
      return reply.status(409).send({ message: 'Ese itinerario ya no esta disponible. Elegí otro horario.' })
    }

    const weexAuth = await getWeexAuthFromRequest(request)
    const customerName = weexAuth?.account.name || body.customerName?.trim()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const customerPhone = normalizePhone(weexAuth?.account.phone || body.customerPhone, { defaultAreaCode })
    if (!customerName || customerPhone.length < 8) {
      return reply.status(400).send({ message: 'Inicia sesion y completa un telefono valido para confirmar los turnos' })
    }
    const customer = await findOrCreatePublicCustomer({
      businessId: business.id,
      name: customerName,
      phone: customerPhone,
      email: weexAuth?.account.emailVerified ? weexAuth.account.email : null
    })

    const coordinationGroupId = randomUUID()
    const appointmentIds: string[] = []
    try {
      for (const segment of itinerary.segments) {
        const resolved = resolvedSelections.find((item) => item.service.id === segment.serviceId)
        if (!resolved) throw new Error('ITINERARY_SERVICE_MISMATCH')
        const created = await appointmentService.create({
          customerId: customer.id,
          professionalId: segment.professionalId,
          serviceId: segment.serviceId,
          startAt: `${date}T${segment.startTime}:00`,
          status: 'PENDING',
          quotedPrice: resolved.estimate.priceMin,
          coordinationGroupId
        })
        if (!created.ok) throw new Error(created.message)
        appointmentIds.push(created.appointment.id)
      }
    } catch (error) {
      await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      return reply.status(409).send({
        message: error instanceof Error && error.message !== 'ITINERARY_SERVICE_MISMATCH'
          ? error.message
          : 'Los horarios cambiaron mientras preparabamos la reserva. Elegí otra opción.'
      })
    }

    let deposit = null
    try {
      if (totalDeposit > 0) {
        const holdMinutes = Math.min(...resolvedSelections
          .filter((item) => item.deposit)
          .map((item) => item.service.depositHoldMinutes))
        deposit = await prisma.bookingDeposit.create({
          data: {
            businessId: business.id,
            appointmentId: appointmentIds[0]!,
            conversationId: null,
            source: 'WEB',
            mode: 'FIXED',
            configuredValue: totalDeposit,
            baseAmount: null,
            amount: totalDeposit,
            expiresAt: new Date(Date.now() + holdMinutes * 60_000)
          }
        })
      } else {
        const confirmed = await appointmentService.confirmPendingAppointments(appointmentIds)
        if (!confirmed) throw new Error('COORDINATED_CONFIRMATION_FAILED')
      }
    } catch (error) {
      await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      return reply.status(409).send({ message: 'No pudimos confirmar todos los horarios. Elegí otra opción.' })
    }

    if (weexAuth?.account.phone) {
      await linkExistingCustomersByPhone(weexAuth.account.id, customerPhone, defaultAreaCode)
    }
    const appointments = await prisma.appointment.findMany({
      where: { id: { in: appointmentIds } },
      include: { service: true, professional: true, customer: true },
      orderBy: { startAt: 'asc' }
    })
    if (!deposit && weexAuth) {
      for (const appointment of appointments) {
        if (weexGoogleCalendarEnabled()) {
          void createGoogleCalendarEventForAppointment({
            accountId: weexAuth.account.id,
            appointmentId: appointment.id
          }).catch((error) => request.log.error({ error, appointmentId: appointment.id }, 'No se pudo sincronizar Google Calendar'))
        }
        if (weexAuth.account.emailVerified) {
          void sendBookingConfirmationEmail({
            recipientEmail: weexAuth.account.email,
            recipientName: weexAuth.account.name,
            appointmentId: appointment.id,
            businessName: business.name,
            businessAddress: [business.publicAddress, business.publicAddressArea].filter(Boolean).join(', ') || null,
            businessAddressArea: business.publicAddressArea,
            serviceName: appointment.service.name,
            professionalName: appointment.professional.name,
            startAt: appointment.startAt,
            durationMinutes: customerDurationRange(appointment.service).max
          }).catch((error) => request.log.error({ error, appointmentId: appointment.id }, 'No se pudo enviar el correo de confirmacion'))
        }
      }
    }
    return {
      coordinationGroupId,
      appointments,
      itinerary,
      deposit: deposit ? {
        id: deposit.id,
        amount: deposit.amount,
        expiresAt: deposit.expiresAt,
        status: deposit.status,
        payment: publicTransferSettings(business)
      } : null
    }
  })

  app.post('/public/booking/:slug/deposits/:depositId/proof', async (request, reply) => {
    const params = request.params as { slug: string; depositId: string }
    const body = request.body as { dataUrl?: string; filename?: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const weexAuth = await getWeexAuthFromRequest(request)
    if (!weexAuth?.account.phone) return reply.status(401).send({ message: 'Inicia sesion para enviar el comprobante' })

    const deposit = await prisma.bookingDeposit.findFirst({
      where: {
        id: params.depositId,
        businessId: business.id,
        source: 'WEB'
      },
      include: { appointment: { include: { customer: true } } }
    })
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const accountPhone = normalizePhone(weexAuth.account.phone, { defaultAreaCode })
    const customerPhone = normalizePhone(deposit?.appointment.customer.phone, { defaultAreaCode })
    if (!deposit || accountPhone !== customerPhone) {
      return reply.status(404).send({ message: 'No encontre esa seña para tu cuenta' })
    }

    const received = await bookingDepositService.submitWebProof({
      depositId: deposit.id,
      ...(body.dataUrl !== undefined ? { dataUrl: body.dataUrl } : {}),
      ...(body.filename !== undefined ? { filename: body.filename } : {})
    })
    if (!received.ok) return reply.status(received.statusCode).send({ message: received.message })
    return { deposit: received.deposit }
  })

  app.get('/public/booking/:slug/pending-deposit', async (request, reply) => {
    const params = request.params as { slug: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const weexAuth = await getWeexAuthFromRequest(request)
    if (!weexAuth?.account.phone) return { deposit: null }
    await bookingDepositService.expireOverdue()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const phone = normalizePhone(weexAuth.account.phone, { defaultAreaCode })
    const deposit = await prisma.bookingDeposit.findFirst({
      where: {
        businessId: business.id,
        source: 'WEB',
        status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] },
        appointment: {
          customer: { phone: { in: phoneSearchVariants(phone, { defaultAreaCode }) } }
        }
      },
      include: {
        appointment: { include: { service: true, professional: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    if (!deposit) return { deposit: null }
    const coordinatedAppointments = deposit.appointment.coordinationGroupId
      ? await prisma.appointment.findMany({
          where: { coordinationGroupId: deposit.appointment.coordinationGroupId },
          include: { service: true, professional: true },
          orderBy: { startAt: 'asc' }
        })
      : [deposit.appointment]
    return {
      deposit: {
        id: deposit.id,
        amount: deposit.amount,
        expiresAt: deposit.expiresAt,
        status: deposit.status,
        serviceId: deposit.appointment.serviceId,
        professionalId: deposit.appointment.professionalId,
        professionalName: deposit.appointment.professional.name,
        date: formatPublicBookingDate(deposit.appointment.startAt),
        time: formatPublicBookingTime(deposit.appointment.startAt),
        payment: publicTransferSettings(business),
        serviceIds: coordinatedAppointments.map((appointment) => appointment.serviceId),
        segments: coordinatedAppointments.map((appointment) => ({
          serviceId: appointment.serviceId,
          serviceName: appointment.service.name,
          professionalId: appointment.professionalId,
          professionalName: appointment.professional.name,
          startTime: formatPublicBookingTime(appointment.startAt),
          endTime: formatPublicBookingTime(new Date(
            appointment.startAt.getTime() + customerDurationRange(appointment.service).max * 60_000
          ))
        }))
      }
    }
  })

  app.get('/public/booking/:slug/history', async (request, reply) => {
    const params = request.params as { slug: string }
    const query = request.query as { phone?: string }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled) return reply.status(404).send({ message: 'No encontre esta landing' })

    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const phone = normalizePhone(query.phone, { defaultAreaCode })
    if (phone.length < 8) return reply.status(400).send({ message: 'Ingresa un telefono valido para ver tus turnos' })
    const phoneVariants = phoneSearchVariants(phone, { defaultAreaCode })

    const appointments = await prisma.appointment.findMany({
      where: {
        customer: {
          phone: {
            in: phoneVariants
          }
        },
        professional: {
          businessId: business.id
        }
      },
      include: {
        service: true,
        professional: true,
        customer: true
      },
      orderBy: {
        startAt: 'desc'
      },
      take: 40
    })

    return {
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        startAt: appointment.startAt,
        status: appointment.status,
        service: {
          id: appointment.service.id,
          name: appointment.service.name,
          duration: appointment.service.duration,
          displayDuration: formatCustomerDuration(appointment.service),
          price: appointment.service.price
        },
        professional: {
          id: appointment.professional.id,
          name: appointment.professional.name
        },
        customer: {
          name: appointment.customer.name,
          phone: appointment.customer.phone
        }
      }))
    }
  })
}

async function professionalsForService(businessId: string, serviceId: string, professionalId?: string) {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      businessId,
      depositMode: { in: ['NONE', 'FIXED', 'PERCENTAGE'] }
    },
    select: { id: true, attentionMode: true, estimateAllowsBooking: true }
  })
  if (!service || !serviceCanBookFromWeb(service)) return []

  const links = await prisma.professionalService.findMany({
    where: {
      serviceId,
      professional: {
        businessId,
        isActive: true,
        ...(professionalId ? { id: professionalId } : {})
      }
    },
    select: {
      professional: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      professional: {
        name: 'asc'
      }
    }
  })

  return links.map((link) => link.professional)
}

async function findOrCreatePublicCustomer(input: {
  businessId: string
  name: string
  phone: string
  email?: string | null
}) {
  const result = await findOrCreateCustomerByPhone(input)
  return result.customer
}

type PublicBookingBusiness = NonNullable<Awaited<ReturnType<BusinessService['findPublicBySlug']>>>
type PublicBusinessService = PublicBookingBusiness['services'][number]
type WebBookableService = {
  attentionMode: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
  estimateAllowsBooking: boolean
}
type PublicEstimateOption = {
  id: string
  label: string
  priceMin: number
  priceMax: number | null
  note: string | null
}

function serviceCanBookFromWeb(service: WebBookableService) {
  return service.attentionMode === 'DIRECT_BOOKING' ||
    (service.attentionMode === 'GUIDED_ESTIMATE' && service.estimateAllowsBooking)
}

async function preparePublicServiceSet(
  business: PublicBookingBusiness,
  values?: string[]
): Promise<
  | { ok: true; services: PublicBusinessService[] }
  | { ok: false; statusCode: number; message: string }
> {
  const serviceIds = Array.from(new Set((values ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)))
  if (!serviceIds.length || serviceIds.length > 5) {
    return { ok: false, statusCode: 400, message: 'Selecciona entre uno y cinco servicios' }
  }
  const services = serviceIds.flatMap((serviceId) => {
    const service = business.services.find((candidate) => candidate.id === serviceId)
    return service && serviceCanBookFromWeb(service) ? [service] : []
  })
  if (services.length !== serviceIds.length) {
    return { ok: false, statusCode: 400, message: 'Uno de los servicios no esta disponible para reserva online' }
  }
  const rules = await prisma.serviceCombinationRule.findMany({
    where: {
      businessId: business.id,
      OR: serviceIds.flatMap((serviceAId, index) => serviceIds.slice(index + 1).flatMap((serviceBId) => [
        { serviceAId, serviceBId },
        { serviceAId: serviceBId, serviceBId: serviceAId }
      ]))
    },
    select: { policy: true, note: true }
  })
  const blocked = rules.find((rule) => rule.policy === 'BLOCKED')
  if (blocked) {
    return {
      ok: false,
      statusCode: 409,
      message: blocked.note || 'Estos servicios no se pueden reservar juntos'
    }
  }
  const review = rules.find((rule) => rule.policy === 'REVIEW_REQUIRED')
  if (review) {
    return {
      ok: false,
      statusCode: 409,
      message: review.note || 'Esta combinacion necesita revision del comercio antes de reservar'
    }
  }
  services.sort((left, right) =>
    left.bookingOrderPriority - right.bookingOrderPriority ||
    serviceIds.indexOf(left.id) - serviceIds.indexOf(right.id)
  )
  return { ok: true, services }
}

async function searchPublicCoordinatedAvailability(input: {
  business: PublicBookingBusiness
  services: PublicBusinessService[]
  date: string
}) {
  const [links, professionals] = await Promise.all([
    prisma.professionalService.findMany({
      where: {
        serviceId: { in: input.services.map((service) => service.id) },
        professional: { businessId: input.business.id, isActive: true }
      },
      select: { serviceId: true, professionalId: true }
    }),
    prisma.professional.findMany({
      where: { businessId: input.business.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    })
  ])
  const searchEngine = new BookingAvailabilitySearchEngine(async (request) => {
    const result = await appointmentService.findAvailability({
      professionalId: request.professionalId,
      serviceId: request.serviceIds[0]!,
      serviceIds: request.serviceIds,
      date: request.date
    })
    return result.ok
      ? { ok: true as const, slots: result.slots }
      : { ok: false as const, message: result.message }
  })
  const services = input.services.map((service) => {
    const duration = reservationDurationLimits(service)
    return {
      id: service.id,
      name: service.name,
      durationMinutes: duration.professional,
      customerDurationMinutes: duration.business,
      professionalIds: links
        .filter((link) => link.serviceId === service.id)
        .map((link) => link.professionalId)
    }
  })
  const commonProfessionals = services[0]?.professionalIds.filter((professionalId) =>
    services.every((service) => service.professionalIds.includes(professionalId))
  ) ?? []
  return searchEngine.search({
    mode: { type: 'DATE', date: input.date },
    services,
    professionals,
    assignmentMode: commonProfessionals.length ? 'SINGLE_PROFESSIONAL' : 'MULTIPLE_PROFESSIONALS',
    maxResults: 15
  })
}

function coordinatedAvailabilityMessage(status: string) {
  if (status === 'NO_COMPATIBLE_PROFESSIONAL') return 'No hay profesionales configurados para todos los servicios seleccionados'
  if (status === 'NO_CONTINUOUS_COMBINATION') return 'Hay horarios individuales, pero no encontramos una combinacion consecutiva para ese dia'
  if (status === 'PROVIDER_ERROR') return 'No pudimos consultar la agenda en este momento'
  return 'No hay horarios coordinados disponibles para esa fecha'
}

function publicEstimateOptions(value: unknown): PublicEstimateOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const option = entry as Record<string, unknown>
    const id = typeof option.id === 'string' ? option.id.trim() : ''
    const label = typeof option.label === 'string' ? option.label.trim() : ''
    const priceMin = Number(option.priceMin)
    const priceMax = option.priceMax === null || option.priceMax === undefined
      ? null
      : Number(option.priceMax)
    if (!id || !label || !Number.isFinite(priceMin) || priceMin < 0) return []
    if (priceMax !== null && (!Number.isFinite(priceMax) || priceMax < priceMin)) return []
    return [{
      id,
      label,
      priceMin,
      priceMax,
      note: typeof option.note === 'string' && option.note.trim() ? option.note.trim() : null
    }]
  })
}

function defaultEstimateMinimum(service: {
  attentionMode: WebBookableService['attentionMode']
  price: number | null
  estimateOptions: unknown
}) {
  if (service.attentionMode !== 'GUIDED_ESTIMATE') return null
  const minimums = publicEstimateOptions(service.estimateOptions)
    .map((option) => option.priceMin)
    .filter((value) => value > 0)
  return minimums.length ? Math.min(...minimums) : service.price
}

function resolvePublicEstimateSelection(service: {
  attentionMode: WebBookableService['attentionMode']
  price: number | null
  estimateOptions: unknown
}, optionId?: string | null) {
  if (service.attentionMode !== 'GUIDED_ESTIMATE') {
    return {
      ok: true as const,
      optionId: null,
      optionLabel: null,
      priceMin: null,
      priceMax: null
    }
  }
  const options = publicEstimateOptions(service.estimateOptions)
  if (options.length) {
    const selected = options.find((option) => option.id === optionId)
    if (!selected) {
      return { ok: false as const, message: 'Selecciona una opcion para calcular el precio estimado' }
    }
    return {
      ok: true as const,
      optionId: selected.id,
      optionLabel: selected.label,
      priceMin: selected.priceMin,
      priceMax: selected.priceMax
    }
  }
  if (typeof service.price === 'number' && service.price > 0) {
    return {
      ok: true as const,
      optionId: null,
      optionLabel: null,
      priceMin: service.price,
      priceMax: null
    }
  }
  return { ok: false as const, message: 'Este servicio necesita una estimacion valida antes de reservar' }
}

async function findAvailablePublicBookingBusiness(request: FastifyRequest, slug: string) {
  const business = await businessService.findPublicBySlug(slug)
  if (!business) return null
  if (business.landingEnabled) return business
  const query = request.query as { preview?: string }
  const rawHost = request.headers['x-forwarded-host'] || request.headers.host
  const host = (Array.isArray(rawHost) ? rawHost[0] : rawHost)?.split(':')[0]?.toLowerCase()
  const localDemoPreview = (host === 'localhost' || host === '127.0.0.1') && business.isDemo && query.preview === '1'
  return localDemoPreview ? business : null
}

function publicWhatsappNumber(business: PublicBookingBusiness) {
  return business.whatsappConfig?.displayPhoneNumber || business.publicWhatsapp
}

function webTransferEnabled(business: PublicBookingBusiness) {
  const payment = business.paymentSettings
  return Boolean(payment?.transferEnabled && (payment.alias || payment.cbu || payment.cvu))
}

function publicTransferSettings(business: PublicBookingBusiness) {
  const payment = business.paymentSettings
  return {
    alias: payment?.alias || null,
    cbu: payment?.cbu || null,
    cvu: payment?.cvu || null,
    accountHolder: payment?.accountHolder || null,
    instructions: payment?.instructions || null
  }
}

function formatPublicBookingDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires'
  }).format(value)
}

function formatPublicBookingTime(value: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires'
  }).format(value)
}
