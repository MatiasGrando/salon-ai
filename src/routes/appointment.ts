import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import { sendAuthorizationFailure } from '../services/authorization-response.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'
import { PrismaCashRepository } from '../repositories/prisma-cash-repository.js'
import { CashService, CashServiceError } from '../services/cash-service.js'
import { hasCashPermission, type CashPermission } from '../services/staff-permission-service.js'
import { sendCashError } from './cash-register.js'
import {
  buildAppointmentFinanceSummaries,
  type AppointmentFinanceSummarySource
} from '../services/appointment-finance-summary.js'

const service = new AppointmentService()
const defaultCashService = new CashService(new PrismaCashRepository(prisma))

export async function appointmentRoutes(app: FastifyInstance, options: { cashService?: CashService; cashRegisterEnabled?: boolean } = {}) {
  const cashService = options.cashService ?? defaultCashService

  app.post('/appointments/check-availability', async (request, reply) => {
    const body = request.body as {
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      appointmentId?: string
    }
    const permission = body.appointmentId ? 'canEditAppointments' : 'canCreateAppointments'
    if (!hasAgendaPermission(request.auth, permission)) {
      return reply.status(403).send({
        message: body.appointmentId ? 'No tenes permiso para editar turnos' : 'No tenes permiso para cargar turnos'
      })
    }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')

    const result = await service.checkManualAvailability(body, authUser)
    if (!result.ok) return reply.status(result.statusCode).send({ message: result.message })
    return { conflicts: result.conflicts }
  })

  app.post('/appointments', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCreateAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cargar turnos' })
    }

    const body = request.body as {
      customerId: string
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      force?: boolean
      manualDepositPaid?: boolean
      manualDepositAmount?: number | string | null
      notes?: string | null
      attentionColor?: 'NONE' | 'YELLOW' | 'ORANGE'
      payment?: {
        businessId?: string
        cashSessionId?: string
        lines?: Array<{ amount: number; method: 'CASH' | 'TRANSFER' | 'CARD' }>
        observation?: string | null
        agreedAmount?: number
        discountType?: 'AMOUNT' | 'PERCENTAGE'
        discountValue?: number
      }
    }
    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const payment = body.payment
    const hasPaymentLines = Boolean(payment && Array.isArray(payment.lines) && payment.lines.length > 0)
    const hasAgreedTotal = payment?.agreedAmount !== undefined
    const hasDiscount = payment?.discountType !== undefined || payment?.discountValue !== undefined
    const paymentBusinessId = payment ? financeBusinessId(authUser, payment.businessId) : null
    if (payment && options.cashRegisterEnabled === false) {
      return reply.status(409).send({ code: 'CASH_DISABLED', message: 'Caja no está habilitada' })
    }
    if ((hasPaymentLines || hasAgreedTotal) && !hasCashPermission(authUser, 'canRecordAppointmentPayments')) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para registrar pagos del turno' })
    }
    if (hasDiscount && !hasCashPermission(authUser, 'canApplyDiscounts')) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para aplicar descuentos' })
    }
    if (payment && !paymentBusinessId) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Negocio requerido para registrar datos financieros' })
    }
    if (hasPaymentLines && !payment?.cashSessionId?.trim()) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Sesión y líneas de pago son requeridas' })
    }
    if (payment && payment.lines !== undefined && !Array.isArray(payment.lines)) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Las líneas de pago son inválidas' })
    }
    if (hasDiscount) {
      if (!['AMOUNT', 'PERCENTAGE'].includes(payment?.discountType || '') || typeof payment?.discountValue !== 'number') {
        return reply.status(400).send({ code: 'VALIDATION', message: 'Tipo y valor de descuento requeridos' })
      }
      if (payment.discountType === 'PERCENTAGE' && (!Number.isFinite(payment.discountValue) || payment.discountValue <= 0 || payment.discountValue > 100)) {
        return reply.status(400).send({ code: 'VALIDATION', message: 'El porcentaje debe ser mayor a 0 y no superar 100' })
      }
      if (payment.discountType === 'AMOUNT' && (!Number.isSafeInteger(payment.discountValue) || payment.discountValue <= 0)) {
        return reply.status(400).send({ code: 'VALIDATION', message: 'El monto debe ser un entero mayor a 0' })
      }
    }

    let result
    try {
      result = await service.create({
        customerId: body.customerId,
        professionalId: body.professionalId,
        serviceId: body.serviceId,
        ...(body.serviceIds ? { serviceIds: body.serviceIds } : {}),
        startAt: body.startAt,
        origin: 'MANUAL',
        ...(body.manualDepositPaid === undefined ? {} : { manualDepositPaid: body.manualDepositPaid }),
        ...(body.manualDepositAmount === undefined ? {} : { manualDepositAmount: body.manualDepositAmount }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        ...(body.attentionColor === undefined ? {} : { attentionColor: body.attentionColor }),
        ...(body.force === undefined ? {} : { force: body.force })
      }, authUser, payment ? {
        afterCreateInTransaction: async ({ transaction, appointment, businessId }) => {
          if (businessId !== paymentBusinessId) throw new CashServiceError('BUSINESS_NOT_FOUND')
          const transactionalCashService = new CashService(new PrismaCashRepository(transaction, true))
          if (payment.agreedAmount !== undefined) {
            await transactionalCashService.setEstimatedAppointmentTotal({
              businessId,
              appointmentId: appointment.id,
              agreedAmount: payment.agreedAmount
            })
          }
          if (hasDiscount) {
            await transactionalCashService.setAppointmentDiscount({
              businessId,
              appointmentId: appointment.id,
              discountType: payment.discountType!,
              discountValue: payment.discountValue!
            })
          }
          if (hasPaymentLines) {
            await transactionalCashService.recordAppointmentPayment({
              businessId,
              appointmentId: appointment.id,
              cashSessionId: payment.cashSessionId!.trim(),
              origin: 'AGENDA',
              lines: payment.lines!,
              ...(payment.observation === undefined ? {} : { observation: payment.observation })
            })
          }
        }
      } : {})
    } catch (error) {
      return sendCashError(reply, error)
    }

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.forceable !== undefined ? { forceable: result.forceable } : {}),
        ...(result.conflicts ? { conflicts: result.conflicts } : {})
      })
    }

    return result.appointment
  })

  app.get('/appointments', async (request, reply) => {
    const query = request.query as {
      businessId?: string
      customerPhone?: string
      from?: string
      to?: string
      professionalId?: string
    }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!query.businessId) {
      return reply.status(400).send({ message: 'businessId es requerido para consultar turnos' })
    }
    const business = await requireAuthorizedBusiness(prisma, authUser, query.businessId)
    if (!business) return sendAuthorizationFailure(reply, 'notFound')

    const canViewFinance = options.cashRegisterEnabled !== false
      && hasAnyCashPermission(authUser, ['canRecordAppointmentPayments', 'canApplyDiscounts'])
    const appointments = await service.findAll({
      businessId: query.businessId,
      ...(query.customerPhone ? { customerPhone: query.customerPhone } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {}),
      includeFinanceSummary: canViewFinance
    })
    const linkedFinanceSummaries = canViewFinance
      ? await cashService.listAppointmentFinanceSummaries({
          businessId: query.businessId,
          appointmentIds: appointments.map((appointment) => appointment.id)
        })
      : []
    const financeSummaries = canViewFinance
      ? buildAppointmentFinanceSummaries(appointments as AppointmentFinanceSummarySource[], linkedFinanceSummaries)
      : new Map()
    return appointments.map((appointment) => {
      const { accountLink: _accountLink, visit: _visit, ...publicAppointment } = appointment as typeof appointment & {
        accountLink?: unknown
        visit?: unknown
      }
      return appointmentForAuthenticatedUser({
        ...publicAppointment,
        ...(canViewFinance ? { financeSummary: financeSummaries.get(appointment.id) ?? null } : {})
      }, authUser)
    })
  })

  if (options.cashRegisterEnabled !== false) app.get('/appointments/finance-summaries', async (request, reply) => {
    const query = request.query as { businessId?: string; from?: string; to?: string; professionalId?: string }
    const authUser = request.auth?.user
    const businessId = financeBusinessId(authUser, query.businessId)
    if (!businessId || !hasAnyCashPermission(authUser, ['canRecordAppointmentPayments', 'canApplyDiscounts'])) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para consultar pagos del turno' })
    }
    const business = await requireAuthorizedBusiness(prisma, authUser!, businessId)
    if (!business) return sendAuthorizationFailure(reply, 'notFound')
    const appointments = await service.findAll({
      businessId,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {}),
      includeFinanceSummary: true
    })
    const linkedFinanceSummaries = await cashService.listAppointmentFinanceSummaries({
      businessId,
      appointmentIds: appointments.map((appointment) => appointment.id)
    })
    const summaries = buildAppointmentFinanceSummaries(
      appointments as AppointmentFinanceSummarySource[],
      linkedFinanceSummaries
    )
    return appointments.map((appointment) => ({
      appointmentId: appointment.id,
      financeSummary: summaries.get(appointment.id) ?? null
    }))
  })

  app.patch('/appointments/:id/status', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCancelAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cancelar o cambiar el estado de turnos' })
    }

    const params = request.params as {
      id: string
    }

    const body = request.body as {
      status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
    }

    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']

    if (!allowedStatuses.includes(body.status)) {
      return reply.status(400).send({
        message: 'Estado de turno invalido'
      })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.updateStatus(params.id, body.status, authUser)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })

  app.patch('/appointments/:id', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canEditAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para editar turnos' })
    }

    const params = request.params as {
      id: string
    }

    const body = request.body as {
      customerId: string
      professionalId: string
      serviceId: string
      serviceIds?: string[]
      startAt: string
      force?: boolean
      manualDepositPaid?: boolean
      manualDepositAmount?: number | string | null
      notes?: string | null
      attentionColor?: 'NONE' | 'YELLOW' | 'ORANGE'
    }

    if (body.force && request.auth?.user.role === 'STAFF' && !request.auth.user.canForceAppointments) {
      return reply.status(403).send({ message: 'No tenes permiso para forzar turnos fuera de disponibilidad' })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.update({
      id: params.id,
      ...body
    }, authUser)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.forceable !== undefined ? { forceable: result.forceable } : {}),
        ...(result.conflicts ? { conflicts: result.conflicts } : {})
      })
    }

    return result.appointment
  })

  app.delete('/appointments/:id', async (request, reply) => {
    if (!hasAgendaPermission(request.auth, 'canCancelAppointments')) {
      return reply.status(403).send({ message: 'No tenes permiso para cancelar turnos' })
    }

    const params = request.params as {
      id: string
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const result = await service.cancel(params.id, authUser)

    if (!result.ok) {
      return reply.status(result.statusCode).send({
        message: result.message
      })
    }

    return result.appointment
  })

  if (options.cashRegisterEnabled !== false) app.get('/appointments/:id/finance', async (request, reply) => {
    const params = request.params as { id: string }
    const query = request.query as { businessId?: string }
    const businessId = financeBusinessId(request.auth?.user, query.businessId)
    if (!businessId || !hasAnyCashPermission(request.auth?.user, ['canRecordAppointmentPayments', 'canApplyDiscounts'])) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para consultar pagos del turno' })
    }
    try {
      return await cashService.getAppointmentFinance({ businessId, appointmentId: params.id })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  if (options.cashRegisterEnabled !== false) app.patch('/appointments/:id/estimated-total', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { businessId?: string; agreedAmount?: number }
    const businessId = financeBusinessId(request.auth?.user, body.businessId)
    if (!businessId || !hasAnyCashPermission(request.auth?.user, ['canRecordAppointmentPayments'])) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para definir el total del turno' })
    }
    if (body.agreedAmount === undefined) return reply.status(400).send({ code: 'VALIDATION', message: 'Total requerido' })
    try {
      return await cashService.setEstimatedAppointmentTotal({ businessId, appointmentId: params.id, agreedAmount: body.agreedAmount })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  if (options.cashRegisterEnabled !== false) app.patch('/appointments/:id/discount', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as {
      businessId?: string
      discountAmount?: number
      discountType?: 'AMOUNT' | 'PERCENTAGE'
      discountValue?: number
    }
    const businessId = financeBusinessId(request.auth?.user, body.businessId)
    if (!businessId || !hasAnyCashPermission(request.auth?.user, ['canApplyDiscounts'])) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para aplicar descuentos' })
    }
    const usesLegacyAmount = body.discountAmount !== undefined
    const usesTypedDiscount = body.discountType !== undefined || body.discountValue !== undefined
    if (usesLegacyAmount && usesTypedDiscount) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Indicá el descuento como monto o porcentaje, no ambos' })
    }
    if (!usesLegacyAmount && !usesTypedDiscount) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Descuento requerido' })
    }
    if (usesTypedDiscount) {
      if (!['AMOUNT', 'PERCENTAGE'].includes(body.discountType || '') || typeof body.discountValue !== 'number') {
        return reply.status(400).send({ code: 'VALIDATION', message: 'Tipo y valor de descuento requeridos' })
      }
      if (body.discountType === 'PERCENTAGE' && (!Number.isFinite(body.discountValue) || body.discountValue <= 0 || body.discountValue > 100)) {
        return reply.status(400).send({ code: 'VALIDATION', message: 'El porcentaje debe ser mayor a 0 y no superar 100' })
      }
      if (body.discountType === 'AMOUNT' && (!Number.isSafeInteger(body.discountValue) || body.discountValue < 0)) {
        return reply.status(400).send({ code: 'VALIDATION', message: 'El monto debe ser un entero mayor o igual a 0' })
      }
    }
    try {
      return await cashService.setAppointmentDiscount({
        businessId,
        appointmentId: params.id,
        ...(usesLegacyAmount
          ? { discountAmount: body.discountAmount }
          : { discountType: body.discountType, discountValue: body.discountValue })
      })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  if (options.cashRegisterEnabled !== false) app.post('/appointments/:id/payments', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as {
      businessId?: string
      cashSessionId?: string
      lines?: Array<{ amount: number; method: 'CASH' | 'TRANSFER' | 'CARD' }>
      observation?: string | null
    }
    const businessId = financeBusinessId(request.auth?.user, body.businessId)
    if (!businessId || !hasAnyCashPermission(request.auth?.user, ['canRecordAppointmentPayments'])) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'No tenés permiso para registrar pagos del turno' })
    }
    if (!body.cashSessionId?.trim() || !Array.isArray(body.lines)) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Sesión y líneas de pago son requeridas' })
    }
    try {
      return await cashService.recordAppointmentPayment({
        businessId,
        appointmentId: params.id,
        cashSessionId: body.cashSessionId.trim(),
        origin: 'AGENDA',
        lines: body.lines,
        ...(body.observation === undefined ? {} : { observation: body.observation })
      })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })
}

function financeBusinessId(user: { role: string; businessId: string | null } | undefined, requested: string | undefined) {
  if (!user) return null
  if (user.role === 'SUPER_ADMIN' || user.role === 'ACCOUNT_ADMIN') return requested?.trim() || user.businessId?.trim() || null
  return user.businessId?.trim() || null
}

function hasAnyCashPermission(
  user: Parameters<typeof hasCashPermission>[0] | undefined,
  permissions: CashPermission[]
) {
  return Boolean(user && permissions.some((permission) => hasCashPermission(user, permission)))
}

function appointmentForAuthenticatedUser<T extends {
  quotedPrice: number | null
  manualDepositAmount: number | null
  customer: { phone: string }
  service: { price: number | null }
  serviceItems: Array<{ service: { price: number | null } }>
}>(appointment: T, user: { role: string; canViewCustomers?: boolean; canViewFinancialAmounts?: boolean } | undefined) {
  if (!user || user.role !== 'STAFF') return appointment

  const customer = user.canViewCustomers
    ? appointment.customer
    : omitKey(appointment.customer, 'phone')
  const service = user.canViewFinancialAmounts
    ? appointment.service
    : omitKey(appointment.service, 'price')
  const serviceItems = user.canViewFinancialAmounts
    ? appointment.serviceItems
    : appointment.serviceItems.map((item) => ({
        ...item,
        service: omitKey(item.service, 'price')
      }))

  const protectedAppointment = {
    ...appointment,
    customer,
    service,
    serviceItems
  }
  if (user.canViewFinancialAmounts) return protectedAppointment

  const {
    quotedPrice: _quotedPrice,
    manualDepositAmount: _manualDepositAmount,
    ...appointmentWithoutFinancialAmounts
  } = protectedAppointment
  return appointmentWithoutFinancialAmounts
}

function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const result = { ...value }
  delete result[key]
  return result
}

function hasAgendaPermission(
  auth: { user: { role: string; canCreateAppointments?: boolean; canEditAppointments?: boolean; canCancelAppointments?: boolean } } | undefined,
  permission: 'canCreateAppointments' | 'canEditAppointments' | 'canCancelAppointments'
) {
  if (!auth) return false
  if (auth.user.role !== 'STAFF') return true
  return auth.user[permission] !== false
}
