import { orderWebBookingProfessionals } from '../services/web-booking-professional-priority.js'
import { CashDomainError } from '../services/cash-domain.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isBusinessAccountUnavailable } from '../services/business-account-access.js'
import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import { BusinessService } from '../services/business-service.js'
import { sendBookingConfirmationEmail } from '../services/booking-confirmation-email-service.js'
import { inferDefaultAreaCodeFromPhone, normalizeCustomerPhone, phoneSearchVariants } from '../services/phone-normalization-service.js'
import { findOrCreateCustomerByPhone } from '../services/customer-identity-service.js'
import { customerDurationRange, formatCustomerDuration, reservationDurationLimits } from '../services/service-duration.js'
import { calculateBookingV2Deposit } from '../services/booking-v2-deposit.js'
import { bookingDepositService } from '../services/booking-deposit-service.js'
import { publishDepositUpdated } from '../services/crm-realtime-events.js'
import { ensureGuestBookingCapacity, prepareGuestBookingAccess, persistGuestBookingAccess, resolveGuestBookingAccesses, setGuestBookingCookie } from '../services/guest-booking-access.js'
import { persistWebBookingOwner, webSelfServiceSummary, webAppointmentManagement, webAppointmentRescheduleOptions,
  mutateWebAppointment, WebAppointmentSelfServiceError } from '../services/web-appointment-self-service.js'
import { BookingAvailabilitySearchEngine } from '../services/booking-availability-search.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import {
  createGoogleCalendarEventForAppointment,
  getWeexAuthFromRequest,
  linkExistingCustomersByPhone,
  weexGoogleCalendarEnabled
} from '../services/weex-account-service.js'

const businessService = new BusinessService()
const appointmentService = new AppointmentService()
const availabilityProvider = new InternalBookingProvider()

export async function publicBookingRoutes(app: FastifyInstance) {
  app.get('/public/booking/:slug/appointments/:appointmentId/manage', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const params = request.params as { slug: string; appointmentId: string }
    const business = await findAvailablePublicBookingBusinessAccess(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const query = request.query as { view?: unknown }
    if (query.view !== undefined && query.view !== 'actions') return reply.status(400).send({ message: 'Elegí una vista válida de la reserva.' })
    try { return await webAppointmentManagement(prisma, { request, businessId: business.id, appointmentId: params.appointmentId,
      ...(query.view === 'actions' ? { view: 'actions' as const } : {}) }) }
    catch (error) {
      if (error instanceof WebAppointmentSelfServiceError) return reply.status(error.statusCode).send({ message: error.message })
      throw error
    }
  })
  app.get('/public/booking/:slug/appointments/:appointmentId/reschedule-options', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const params = request.params as { slug: string; appointmentId: string }
    const query = request.query as { date?: string; professionalIds?: string }
    const business = await findAvailablePublicBookingBusinessAccess(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    try { return await webAppointmentRescheduleOptions(prisma, { request, businessId: business.id,
      appointmentId: params.appointmentId, date: query.date || '',
      professionalIds: typeof query.professionalIds === 'string' ? query.professionalIds.split(',') : undefined }) }
    catch (error) {
      if (error instanceof WebAppointmentSelfServiceError) return reply.status(error.statusCode).send({ message: error.message })
      throw error
    }
  })
  for (const action of ['reschedule', 'cancel'] as const) {
    app.post('/public/booking/:slug/appointments/:appointmentId/' + action, async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const params = request.params as { slug: string; appointmentId: string }
      const business = await findAvailablePublicBookingBusinessAccess(request, params.slug)
      if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
      const startedAt = performance.now()
      try {
        const result = await prisma.$transaction(transaction => mutateWebAppointment(transaction, { request,
          businessId: business.id, appointmentId: params.appointmentId,
          action: action === 'cancel' ? 'CANCEL' : 'RESCHEDULE', body: request.body }), { maxWait: 5000, timeout: 15000 })
        request.log.info({ event: 'web_appointment_management', businessId: business.id, action, outcome: 'completed',
          transactionDurationMs: Math.round(performance.now() - startedAt) }, 'Gestión web del turno completada')
        return result
      } catch (error) {
        const transactionDurationMs = Math.round(performance.now() - startedAt)
        if (error instanceof WebAppointmentSelfServiceError) {
          request.log.info({ event: 'web_appointment_management', businessId: business.id, action, outcome: 'rejected', transactionDurationMs,
            statusCode: error.statusCode }, 'Gestión web del turno rechazada')
          return reply.status(error.statusCode).send({ message: error.message })
        }
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null
        const errorCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : 'UNEXPECTED'
        // Do not serialize the exception: Prisma messages can contain SQL/values.
        request.log.error({ event: 'web_appointment_management', businessId: business.id, action, outcome: 'error', transactionDurationMs, errorCode },
          'No se completó la gestión web del turno')
        return reply.status(409).send({ message: 'No se modificó la reserva. Actualizá los datos e intentá nuevamente.' })
      }
    })
  }
  app.get('/public/booking/:slug/catalog', async (request, reply) => {
    const params = request.params as { slug: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    let professionals: typeof business.professionals | readonly (typeof business.professionals)[number][]
    try {
      professionals = await orderWebBookingProfessionals(prisma, business, business.professionals)
    } catch (error) {
      if (!(error instanceof CashDomainError)) throw error
      return reply.status(409).send({ message: 'La configuración de reservas necesita una zona horaria válida. Contactá al comercio.' })
    }

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
        slug: business.slug,
        allowGuestWebBooking: business.allowGuestWebBooking === true
      },
      services: business.services
        .filter((service) => service.isActive)
        .filter((service) => serviceCanBookFromWeb(service))
        .filter((service) => service.depositMode === 'NONE' || (
          webTransferEnabled(business) && Boolean(calculateBookingV2Deposit({
            mode: service.depositMode,
            value: service.depositValue,
            servicePrice: service.price,
            estimateMinimum: defaultEstimateMinimum(service)
          }))
        ))
        .filter((service) => serviceLinks.some((link) => link.serviceId === service.id))
        .map((service) => ({
        id: service.id,
        name: service.name,
        imageUrl: publicServiceImageUrl(service.imageUrl),
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
      professionals: professionals.map((professional) => ({
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
    if (!query.serviceId || !query.professionalId || !query.date) return reply.status(400).send({ message: 'Servicio, profesional y fecha son requeridos' })
    const serviceId = query.serviceId
    const professionalId = query.professionalId
    const date = query.date

    const [business, professionals, availability] = await Promise.all([
      findAvailablePublicBookingBusinessAccess(request, params.slug),
      professionalsForServiceSlug(params.slug, serviceId, professionalId),
      appointmentService.findAvailability({ professionalId, serviceId, date })
    ])
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    if (professionals.length === 0) return reply.status(404).send({ message: 'No hay profesionales para ese servicio' })

    const slots: Array<{ time: string; professionalId: string; professionalName: string }> = []
    const errors: string[] = []
    const unavailableReasons: string[] = []
    const results = [{ professional: professionals[0]!, result: availability }]

    for (const { professional, result } of results) {
      if (result.ok) {
        if (result.slots.length === 0 && result.unavailableReason) {
          unavailableReasons.push(result.unavailableReason)
        }
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
      message: slots.length
        ? null
        : unavailableReasons[0] || errors[0] || 'No quedan turnos disponibles para ese día.'
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
      message: availability.options.length
        ? null
        : availability.unavailable?.message || coordinatedAvailabilityMessage(availability.status),
      status: availability.status
    }
  })

  app.post('/public/booking/:slug/book', async (request, reply) => {
    const confirmationStartedAt = performance.now()
    let timingCheckpoint = confirmationStartedAt
    const confirmationTiming: Record<string, number> = {}
    const markConfirmationTiming = (stage: string) => {
      const now = performance.now()
      confirmationTiming[stage] = Math.round(now - timingCheckpoint)
      timingCheckpoint = now
    }
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
    const [business, weexAuth] = await Promise.all([
      findAvailablePublicBookingBusiness(request, params.slug),
      getWeexAuthFromRequest(request)
    ])
    markConfirmationTiming('businessAndAuthMs')
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    if (!weexAuth && business.allowGuestWebBooking !== true) {
      return reply.status(401).send({ message: 'Inicia sesion con Google para reservar en este negocio' })
    }
    if (!weexAuth && !validGuestContact(body.customerName, body.customerPhone)) {
      return reply.status(400).send({ message: 'Completa tu nombre y un telefono de contacto valido' })
    }
    if (!weexAuth) await ensureGuestBookingCapacity(request, business.id)

    const serviceId = body.serviceId?.trim()
    const professionalId = body.professionalId?.trim()
    const date = body.date?.trim()
    const time = body.time?.trim()
    const customerName = weexAuth?.account.name || body.customerName?.trim()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const normalizedPhone = normalizeCustomerPhone(weexAuth?.account.phone ? `+${weexAuth.account.phone}` : body.customerPhone, { defaultAreaCode })
    const customerPhone = normalizedPhone.ok ? normalizedPhone.phone : ''

    if (!serviceId || !professionalId || !date || !time || !customerName) {
      return reply.status(400).send({ message: 'Completa servicio, profesional, fecha, horario y tus datos de contacto' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return reply.status(400).send({ message: 'La fecha u horario no parecen validos' })
    }
    if (!normalizedPhone.ok) {
      return reply.status(400).send({ message: 'Ingresa un telefono valido para confirmar el turno' })
    }

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

    const [professionals, customer] = await Promise.all([
      professionalsForService(business.id, serviceId, professionalId),
      findOrCreatePublicCustomer({
        businessId: business.id,
        name: customerName,
        phone: `+${customerPhone}`,
        registerMarketingPreference: Boolean(weexAuth),
        email: weexAuth?.account.emailVerified ? weexAuth.account.email : null
      })
    ])
    markConfirmationTiming('professionalAndCustomerMs')
    const offeredProfessional = professionals.find((item) => item.id === professionalId)
    if (!offeredProfessional) {
      return reply.status(400).send({ message: 'Ese profesional no corresponde al servicio elegido' })
    }
    const professional = business.professionals.find((item) => item.id === professionalId) || offeredProfessional

    const depositExpiresAt = depositCalculation
      ? new Date(Date.now() + service.depositHoldMinutes * 60_000)
      : null
    const guestAccess = !weexAuth ? prepareGuestBookingAccess() : null
    let guestBookingId: string | undefined
    let result
    try {
      result = await appointmentService.createPublicBooking({
      businessId: business.id,
      customerId: customer.id,
      customerPhone,
      professionalId,
      serviceId,
      startAt: `${date}T${time}:00`,
      origin: 'WEB',
      status: depositCalculation ? 'PENDING' : 'CONFIRMED',
      quotedPrice: estimateSelection.priceMin,
      deposit: depositCalculation && depositExpiresAt ? {
        mode: depositCalculation.mode,
        configuredValue: depositCalculation.configuredValue,
        baseAmount: depositCalculation.baseAmount,
        amount: depositCalculation.amount,
        expiresAt: depositExpiresAt
      } : null
      }, { afterCreateInTransaction: async ({ transaction, appointment }) => {
        if (weexAuth) await persistWebBookingOwner(transaction, {
          businessId: business.id, appointmentId: appointment.id, accountId: weexAuth.account.id
        })
        if (!guestAccess) return
        const created = appointment as typeof appointment & { bookingDeposit?: { id: string } | null }
        const grant = await persistGuestBookingAccess(transaction, {
          tokenHash: guestAccess.tokenHash, expiresAt: guestAccess.expiresAt, businessId: business.id,
          appointmentIds: [appointment.id], depositId: created.bookingDeposit?.id ?? null
        })
        guestBookingId = grant.id
      } })
    } catch (error) {
      request.log.error({ error, businessId: business.id }, 'No se pudo guardar la reserva web completa')
      return reply.status(409).send({ message: 'No pudimos completar la reserva. Tus horarios no fueron confirmados; intenta nuevamente.' })
    }
    markConfirmationTiming('appointmentAndDepositWriteMs')

    if (!result.ok) {
      return reply.status(result.statusCode).send({ message: result.message })
    }
    if (guestAccess) setGuestBookingCookie(request, reply, { ...guestAccess, businessId: business.id, slug: params.slug })

    const deposit = result.appointment.bookingDeposit
    if (deposit) {
      publishDepositUpdated({
        businessId: business.id,
        depositId: deposit.id,
        updatedAt: deposit.updatedAt.toISOString()
      })
    }

    const appointment = {
      ...result.appointment,
      service,
      professional,
      customer
    }

    if (weexAuth?.account.phone) {
      if (deposit) {
        void linkExistingCustomersByPhone(weexAuth.account.id, `+${customerPhone}`, defaultAreaCode).catch((error) => {
          request.log.error({ error, appointmentId: appointment.id }, 'No se pudo vincular la cuenta con el cliente web')
        })
      } else {
        await linkExistingCustomersByPhone(weexAuth.account.id, `+${customerPhone}`, defaultAreaCode)
      }
    }

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

    confirmationTiming.totalMs = Math.round(performance.now() - confirmationStartedAt)
    request.log.info({
      event: 'public_booking_confirmation_timing',
      hasDeposit: Boolean(deposit),
      ...confirmationTiming
    }, 'Tiempos de confirmacion de reserva web')

    return {
      ...(guestAccess ? { guest: true, bookingId: guestBookingId, appointment: publicGuestAppointment(appointment) } : { appointment }),
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
    const [business, weexAuth] = await Promise.all([
      findAvailablePublicBookingBusiness(request, params.slug),
      getWeexAuthFromRequest(request)
    ])
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    if (!weexAuth && business.allowGuestWebBooking !== true) {
      return reply.status(401).send({ message: 'Inicia sesion con Google para reservar en este negocio' })
    }
    if (!weexAuth && !validGuestContact(body.customerName, body.customerPhone)) {
      return reply.status(400).send({ message: 'Completa tu nombre y un telefono de contacto valido' })
    }
    if (!weexAuth) await ensureGuestBookingCapacity(request, business.id)
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

    const customerName = weexAuth?.account.name || body.customerName?.trim()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const normalizedPhone = normalizeCustomerPhone(weexAuth?.account.phone ? `+${weexAuth.account.phone}` : body.customerPhone, { defaultAreaCode })
    const customerPhone = normalizedPhone.ok ? normalizedPhone.phone : ''
    if (!customerName || !normalizedPhone.ok) {
      return reply.status(400).send({ message: 'Inicia sesion y completa un telefono valido para confirmar los turnos' })
    }
    const customer = await findOrCreatePublicCustomer({
      businessId: business.id,
      name: customerName,
      phone: `+${customerPhone}`,
      registerMarketingPreference: Boolean(weexAuth),
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
          origin: 'WEB',
          status: 'PENDING',
          quotedPrice: resolved.estimate.priceMin,
          coordinationGroupId
        }, undefined, { skipDefaultMarketingPreference: !weexAuth,
          afterCreateInTransaction: async ({ transaction, appointment }) => {
            if (weexAuth) await persistWebBookingOwner(transaction, {
              businessId: business.id, appointmentId: appointment.id, accountId: weexAuth.account.id
            })
          }
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
    let guestAppointments: GuestAppointmentSummary[] | null = null
    const guestAccess = !weexAuth ? prepareGuestBookingAccess() : null
    let guestBookingId: string | undefined
    const grantAccess = async (transaction: Parameters<typeof persistGuestBookingAccess>[0], depositId: string | null) => {
      if (!guestAccess) return
      const createdAppointments = await transaction.appointment.findMany({
        where: { id: { in: appointmentIds }, businessId: business.id, origin: 'WEB' },
        include: { service: true, professional: true }, orderBy: { startAt: 'asc' }
      })
      if (createdAppointments.length !== appointmentIds.length) throw new Error('GUEST_BOOKING_GROUP_INCOMPLETE')
      const grant = await persistGuestBookingAccess(transaction, {
        tokenHash: guestAccess.tokenHash, expiresAt: guestAccess.expiresAt, businessId: business.id, appointmentIds, depositId
      })
      guestBookingId = grant.id
      guestAppointments = createdAppointments
    }
    try {
      if (totalDeposit > 0) {
        const holdMinutes = Math.min(...resolvedSelections
          .filter((item) => item.deposit)
          .map((item) => item.service.depositHoldMinutes))
        deposit = await prisma.$transaction(async transaction => {
          const created = await transaction.bookingDeposit.create({ data: {
            businessId: business.id,
            appointmentId: appointmentIds[0]!,
            conversationId: null,
            source: 'WEB',
            mode: 'FIXED',
            configuredValue: totalDeposit,
            baseAmount: null,
            amount: totalDeposit,
            expiresAt: new Date(Date.now() + holdMinutes * 60_000)
          } })
          await grantAccess(transaction, created.id)
          return created
        })
      } else {
        const confirmed = await appointmentService.confirmPendingAppointments(appointmentIds,
          guestAccess ? { afterConfirmInTransaction: transaction => grantAccess(transaction, null) } : {})
        if (!confirmed) throw new Error('COORDINATED_CONFIRMATION_FAILED')
      }
    } catch (error) {
      await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      return reply.status(409).send({ message: 'No pudimos confirmar todos los horarios. Elegí otra opción.' })
    }
    if (deposit) {
      publishDepositUpdated({
        businessId: business.id,
        depositId: deposit.id,
        updatedAt: deposit.updatedAt.toISOString()
      })
    }

    if (weexAuth?.account.phone) {
      if (deposit) {
        void linkExistingCustomersByPhone(weexAuth.account.id, `+${customerPhone}`, defaultAreaCode).catch((error) => {
          request.log.error({ error, coordinationGroupId }, 'No se pudo vincular la cuenta con los clientes web')
        })
      } else {
        await linkExistingCustomersByPhone(weexAuth.account.id, `+${customerPhone}`, defaultAreaCode)
      }
    }
    const appointments = guestAppointments ?? await prisma.appointment.findMany({
      where: { id: { in: appointmentIds } },
      include: { service: true, professional: true, customer: true },
      orderBy: { startAt: 'asc' }
    })
    if (guestAccess) setGuestBookingCookie(request, reply, { ...guestAccess, businessId: business.id, slug: params.slug })
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
      ...(guestAccess ? { guest: true, bookingId: guestBookingId, appointments: appointments.map(publicGuestAppointment) } : { appointments }),
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
    reply.header('Cache-Control', 'no-store')
    const weexAuth = await getWeexAuthFromRequest(request)
    const guestScopes = !weexAuth ? await resolveGuestBookingAccesses(request, business.id) : []
    const guestAccess = guestScopes.find(scope => scope.access.depositId === params.depositId) ?? null
    if (!weexAuth?.account.phone && !guestScopes.length) return reply.status(401).send({ message: 'Necesitas el acceso de esta reserva o iniciar sesion para enviar el comprobante' })
    if (!weexAuth && !guestAccess) {
      return reply.status(404).send({ message: 'No encontre esa seña para esta reserva' })
    }

    const deposit = await prisma.bookingDeposit.findFirst({
      where: {
        id: params.depositId,
        businessId: business.id,
        source: 'WEB'
      },
      include: { appointment: { include: { customer: true } } }
    })
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const accountPhone = normalizeCustomerPhone(weexAuth?.account.phone ? `+${weexAuth.account.phone}` : undefined, { defaultAreaCode })
    const customerPhone = normalizeCustomerPhone(deposit?.appointment.customer.normalizedPhone
      ? `+${deposit.appointment.customer.normalizedPhone}`
      : deposit?.appointment.customer.phone, { defaultAreaCode })
    const ownsGuestDeposit = guestAccess && deposit && guestAccess.access.appointmentIds.includes(deposit.appointmentId) &&
      guestAccess.appointments.every(appointment => appointment.status === 'PENDING' || appointment.status === 'CONFIRMED')
    if (!deposit || (guestAccess ? !ownsGuestDeposit : (!accountPhone.ok || !customerPhone.ok || accountPhone.phone !== customerPhone.phone))) {
      return reply.status(404).send({ message: 'No encontre esa seña para tu cuenta' })
    }

    const received = await bookingDepositService.submitWebProof({
      depositId: deposit.id,
      ...(body.dataUrl !== undefined ? { dataUrl: body.dataUrl } : {}),
      ...(body.filename !== undefined ? { filename: body.filename } : {})
    })
    if (!received.ok) return reply.status(received.statusCode).send({ message: received.message })
    publishDepositUpdated({
      businessId: business.id,
      depositId: deposit.id,
      updatedAt: new Date().toISOString()
    })
    return { deposit: guestAccess ? publicGuestDeposit(received.deposit, guestAccess.appointments, business) : received.deposit }
  })

  app.get('/public/booking/:slug/guest-booking', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const params = request.params as { slug: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const scopes = await resolveGuestBookingAccesses(request, business.id)
    const summaries = await Promise.all(scopes.map(async scope => {
      const deposit = scope.access.depositId ? await prisma.bookingDeposit.findFirst({
        where: { id: scope.access.depositId, businessId: business.id, source: 'WEB', appointmentId: { in: scope.access.appointmentIds } }
      }) : null
      if (scope.access.depositId && (!deposit || !scope.access.appointmentIds.includes(deposit.appointmentId))) return null
        const selfService = scope.appointments.map(a => webSelfServiceSummary({ ...a,
          bookingDeposit: deposit?.appointmentId === a.id ? deposit : null }, true))
        const canManage = selfService.every(p => p.mode === 'direct')
        return { bookingId: scope.access.id, expiresAt: scope.access.expiresAt,
          appointments: scope.appointments.map(a => ({ ...publicGuestAppointment(a),
            selfService: canManage ? selfService[0] : { mode: 'contact', canReschedule: false, canCancel: false,
              reason: 'Esta reserva requiere la gestión del local. La seña y los pagos se conservan.' } })),
          deposit: publicGuestDeposit(deposit, scope.appointments, business) }
    }))
    const bookings = summaries.filter((summary): summary is NonNullable<typeof summary> => summary !== null)
    const bookingId = (request.query as { bookingId?: string }).bookingId
    const selected = bookingId === undefined ? bookings[0] : bookings.find(booking => booking.bookingId === bookingId)
    if (!selected) return reply.status(401).send({ message: 'No hay un acceso vigente a esta reserva' })
    return { guest: true, ...selected, bookings }
  })

  app.get('/public/booking/:slug/pending-deposit', async (request, reply) => {
    const params = request.params as { slug: string }
    const business = await findAvailablePublicBookingBusiness(request, params.slug)
    if (!business) return reply.status(404).send({ message: 'No encontre esta landing' })
    const weexAuth = await getWeexAuthFromRequest(request)
    if (!weexAuth?.account.phone) return { deposit: null }
    await bookingDepositService.expireOverdue()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const normalizedPhone = normalizeCustomerPhone(`+${weexAuth.account.phone}`, { defaultAreaCode })
    if (!normalizedPhone.ok) return { deposit: null }
    const phone = `+${normalizedPhone.phone}`
    const deposit = await prisma.bookingDeposit.findFirst({
      where: {
        businessId: business.id,
        source: 'WEB',
        status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] },
        appointment: {
          customer: normalizedPhone.local.startsWith('+') ? {
            OR: [
              { normalizedPhone: normalizedPhone.phone },
              { normalizedPhone: null, phone: { in: [phone, normalizedPhone.display, `00${normalizedPhone.phone}`] } }
            ]
          } : { phone: { in: phoneSearchVariants(phone, { defaultAreaCode }) } }
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
    reply.header('Cache-Control', 'no-store')
    const params = request.params as { slug: string }
    const query = request.query as { phone?: string }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled || isBusinessAccountUnavailable(business.accountStatus)) {
      return reply.status(404).send({ message: 'No encontre esta landing' })
    }

    const defaultAreaCode = inferDefaultAreaCodeFromPhone(publicWhatsappNumber(business))
    const weexAuth = await getWeexAuthFromRequest(request)
    if (!weexAuth?.account.phone) return reply.status(401).send({ message: 'Inicia sesion para ver tus turnos anteriores' })
    const phone = normalizeCustomerPhone(query.phone, { defaultAreaCode })
    if (!phone.ok) return reply.status(400).send({ message: 'Ingresa un telefono valido para ver tus turnos' })
    const accountPhone = normalizeCustomerPhone(`+${weexAuth.account.phone}`, { defaultAreaCode })
    if (!accountPhone.ok || accountPhone.phone !== phone.phone) {
      return reply.status(403).send({ message: 'Ese telefono no corresponde a tu cuenta' })
    }
    const internationalPhone = phone.local.startsWith('+')
    const phoneVariants = internationalPhone
      ? [String(query.phone || '').trim(), `+${phone.phone}`, phone.display, `00${phone.phone}`]
      : phoneSearchVariants(`+${phone.phone}`, { defaultAreaCode })

    const appointments = await prisma.appointment.findMany({
      where: {
        customer: internationalPhone ? {
          OR: [
            { normalizedPhone: phone.phone },
            { normalizedPhone: null, phone: { in: phoneVariants } }
          ]
        } : { phone: { in: phoneVariants } },
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
      isActive: true,
      depositMode: { in: ['NONE', 'FIXED', 'PERCENTAGE'] }
    },
    select: {
      id: true,
      attentionMode: true,
      estimateAllowsBooking: true,
      professionalLinks: {
        where: {
          professional: {
            businessId,
            isActive: true,
            ...(professionalId ? { id: professionalId } : {})
          }
        },
        select: {
          professional: { select: { id: true, name: true } }
        },
        orderBy: { professional: { name: 'asc' } }
      }
    }
  })
  if (!service || !serviceCanBookFromWeb(service)) return []
  return service.professionalLinks.map((link) => link.professional)
}

async function professionalsForServiceSlug(slug: string, serviceId: string, professionalId: string) {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      business: { slug },
      isActive: true,
      depositMode: { in: ['NONE', 'FIXED', 'PERCENTAGE'] }
    },
    select: {
      attentionMode: true,
      estimateAllowsBooking: true,
      professionalLinks: {
        where: { professional: { id: professionalId, isActive: true } },
        select: { professional: { select: { id: true, name: true } } }
      }
    }
  })
  if (!service || !serviceCanBookFromWeb(service)) return []
  return service.professionalLinks.map((link) => link.professional)
}

async function findOrCreatePublicCustomer(input: {
  businessId: string
  name: string
  phone: string
  email?: string | null
  registerMarketingPreference?: boolean
}) {
  const result = await findOrCreateCustomerByPhone(input)
  return result.customer
}

type PublicBookingBusiness = NonNullable<Awaited<ReturnType<BusinessService['findPublicBySlug']>>>
type PublicBusinessService = PublicBookingBusiness['services'][number]

function validGuestContact(name: unknown, phone: unknown) {
  return typeof name === 'string' && Boolean(name.trim()) && name.length <= 100 &&
    !/[\u0000-\u001f]/.test(name) && typeof phone === 'string' && phone.length <= 100
}

type GuestAppointmentSummary = {
  id: string; startAt: Date; status: string; serviceId: string; professionalId: string;
  quotedPrice?: number | null; totalDurationMinutes?: number | null;
  service: { id: string; name: string; duration: number; price: number | null;
    customerDurationMin?: number | null; customerDurationMax?: number | null };
  professional: { id: string; name: string }
}

function publicGuestAppointment(appointment: GuestAppointmentSummary) {
  return {
    id: appointment.id, startAt: appointment.startAt, status: appointment.status,
    serviceId: appointment.serviceId, professionalId: appointment.professionalId,
    quotedPrice: appointment.quotedPrice ?? null, totalDurationMinutes: appointment.totalDurationMinutes ?? null,
    service: { id: appointment.service.id, name: appointment.service.name, duration: appointment.service.duration,
      displayDuration: formatCustomerDuration(appointment.service), price: appointment.quotedPrice ?? appointment.service.price },
    professional: { id: appointment.professional.id, name: appointment.professional.name }
  }
}

function publicGuestDeposit(deposit: { id: string; amount: number; expiresAt: Date; status: string } | null,
  appointments: GuestAppointmentSummary[], business: PublicBookingBusiness) {
  const first = appointments[0]
  if (!deposit || !first) return null
  return {
    id: deposit.id, amount: deposit.amount, expiresAt: deposit.expiresAt, status: deposit.status,
    serviceId: first.serviceId, professionalId: first.professionalId, professionalName: first.professional.name,
    date: formatPublicBookingDate(first.startAt), time: formatPublicBookingTime(first.startAt),
    payment: publicTransferSettings(business), serviceIds: appointments.map(appointment => appointment.serviceId),
    segments: appointments.map(appointment => ({
      serviceId: appointment.serviceId, serviceName: appointment.service.name,
      professionalId: appointment.professionalId, professionalName: appointment.professional.name,
      startTime: formatPublicBookingTime(appointment.startAt),
      endTime: formatPublicBookingTime(new Date(appointment.startAt.getTime() + (
        typeof appointment.totalDurationMinutes === 'number' && appointment.totalDurationMinutes > 0
          ? appointment.totalDurationMinutes : customerDurationRange(appointment.service).max
      ) * 60_000))
    }))
  }
}
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
    const result = await availabilityProvider.getAvailability({
      professionalId: request.professionalId,
      serviceId: request.serviceIds[0]!,
      serviceIds: request.serviceIds,
      date: request.date
    })
    return result.ok
      ? { ok: true as const, slots: result.slots, unavailable: result.unavailable }
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

// Preserve uploaded raster data and existing public URLs without exposing active
// schemes, credential-bearing URLs or unsupported relative paths to the catalog.
function publicServiceImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const image = value.trim()
  if (!image || /[\u0000-\u0020\u007f\\]/.test(image)) return null
  if (/^\/landing-assets\/[a-z0-9-]+\.png$/i.test(image)) return image
  if (/^data:/i.test(image)) {
    // Legacy service media migration supports raster payloads up to 4 MiB.
    if (image.length > Math.ceil(4 * 1024 * 1024 / 3) * 4 + 64) return null
    const data = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/]+={0,2})$/i.exec(image)
    if (!data || data[2]!.length % 4 === 1 || data[2]!.includes('=') && data[2]!.length % 4 !== 0) return null
    return Buffer.byteLength(data[2]!, 'base64') <= 4 * 1024 * 1024 ? image : null
  }
  try {
    const url = new URL(image)
    return /^https?:\/\//i.test(image) && ['http:', 'https:'].includes(url.protocol) &&
      !url.username && !url.password ? image : null
  } catch { return null }
}
async function findAvailablePublicBookingBusiness(request: FastifyRequest, slug: string) {
  const business = await businessService.findPublicBySlug(slug)
  if (!business) return null
  if (isBusinessAccountUnavailable(business.accountStatus)) return null
  if (business.landingEnabled) return business
  const query = request.query as { preview?: string }
  const rawHost = request.headers['x-forwarded-host'] || request.headers.host
  const host = (Array.isArray(rawHost) ? rawHost[0] : rawHost)?.split(':')[0]?.toLowerCase()
  const localDemoPreview = (host === 'localhost' || host === '127.0.0.1') && business.isDemo && query.preview === '1'
  return localDemoPreview ? business : null
}

async function findAvailablePublicBookingBusinessAccess(request: FastifyRequest, slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      accountStatus: true,
      landingEnabled: true,
      isDemo: true
    }
  })
  if (!business || isBusinessAccountUnavailable(business.accountStatus)) return null
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
