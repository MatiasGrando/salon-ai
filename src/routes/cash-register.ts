import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '../config/prisma.js'
import { PrismaCashRepository } from '../repositories/prisma-cash-repository.js'
import { CashDomainError } from '../services/cash-domain.js'
import { CashService, CashServiceError, type CashOperationInput } from '../services/cash-service.js'
import { hasCashPermission, type CashPermission, type StaffAuthorizationUser } from '../services/staff-permission-service.js'

type CashRegisterRoutesOptions = {
  cashService?: CashService
}

const defaultCashService = new CashService(new PrismaCashRepository(prisma))

export async function cashRegisterRoutes(app: FastifyInstance, options: CashRegisterRoutesOptions = {}) {
  const service = options.cashService ?? defaultCashService

  app.get('/cash-register/responsibles', async (request, reply) => {
    const access = cashAccess(request.auth?.user, 'canManageCashSessions', request.query)
    if (!access.ok) return cashAccessFailure(reply, access)
    return prisma.user.findMany({
      where: {
        businessId: access.businessId,
        isActive: true,
        role: { in: ['BUSINESS_ADMIN', 'STAFF'] }
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true }
    })
  })

  app.get('/cash-register/current', async (request, reply) => {
    const access = cashAccess(request.auth?.user, 'canViewCashRegister', request.query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      return { ...await service.getCurrentCashRegister({ businessId: access.businessId }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days', async (request, reply) => {
    const query = request.query as { businessId?: string; limit?: string }
    const access = cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      const limit = optionalInteger(query.limit)
      return { days: await service.listCashRegisterDays({ businessId: access.businessId, ...(limit === undefined ? {} : { limit }) }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days/:id/summary', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const params = request.params as { id: string }
    const access = cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      return { ...await service.getCashRegisterDaySummary({ businessId: access.businessId, registerDayId: params.id }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days/:id/entries', async (request, reply) => {
    const params = request.params as { id: string }
    const query = request.query as { businessId?: string; cursor?: string; limit?: string; type?: string; method?: string; q?: string }
    const access = cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    const types = ['PAYMENT', 'LEGACY_PAYMENT', 'EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND', 'REVERSAL'] as const
    const methods = ['CASH', 'TRANSFER', 'CARD', 'UNSPECIFIED'] as const
    if (query.type && !types.includes(query.type as typeof types[number])) return validation(reply, 'Tipo de movimiento inválido')
    if (query.method && !methods.includes(query.method as typeof methods[number])) return validation(reply, 'Medio de pago inválido')
    try {
      const limit = optionalInteger(query.limit)
      const page = await service.listCashEntries({
        businessId: access.businessId,
        registerDayId: params.id,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(limit === undefined ? {} : { limit }),
        ...(query.type === undefined ? {} : { type: query.type as typeof types[number] }),
        ...(query.method === undefined ? {} : { method: query.method as typeof methods[number] }),
        ...(query.q === undefined ? {} : { query: query.q })
      })
      return { entries: page.entries, nextCursor: page.nextCursor, permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/open', async (request, reply) => {
    const body = request.body as { businessId?: string; responsibleUserId?: string; openingCash?: number | null }
    const access = cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.responsibleUserId?.trim()) return validation(reply, 'Responsable requerido')
    try {
      return await service.openRegisterDay({ businessId: access.businessId, responsibleUserId: body.responsibleUserId.trim(), ...(body.openingCash === undefined ? {} : { openingCash: body.openingCash }) })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/new-session', async (request, reply) => {
    const body = request.body as { businessId?: string; currentSessionId?: string; responsibleUserId?: string; countedCash?: number }
    const access = cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.currentSessionId?.trim() || !body.responsibleUserId?.trim() || body.countedCash === undefined) return validation(reply, 'Sesión, responsable y efectivo contado son requeridos')
    try {
      return await service.startNewSession({ businessId: access.businessId, currentSessionId: body.currentSessionId.trim(), responsibleUserId: body.responsibleUserId.trim(), countedCash: body.countedCash })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/close', async (request, reply) => {
    const body = request.body as { businessId?: string; currentSessionId?: string; countedCash?: number }
    const access = cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.currentSessionId?.trim() || body.countedCash === undefined) return validation(reply, 'Sesión y efectivo contado son requeridos')
    try {
      return await service.closeRegisterDay({ businessId: access.businessId, currentSessionId: body.currentSessionId.trim(), countedCash: body.countedCash })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/entries', async (request, reply) => {
    const body = request.body as Record<string, unknown> & { businessId?: string; type?: string; cashSessionId?: string }
    const permission: CashPermission = body.type === 'ADJUSTMENT' ? 'canAdjustCash' : 'canManageCashOperations'
    const access = cashAccess(request.auth?.user, permission, body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.cashSessionId?.trim() || !['EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND'].includes(body.type ?? '')) {
      return validation(reply, 'Sesión y tipo de operación válidos son requeridos')
    }
    try {
      return await service.recordCashOperation({ ...body, businessId: access.businessId, cashSessionId: body.cashSessionId.trim() } as CashOperationInput)
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/entries/:id/reverse', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { businessId?: string; cashSessionId?: string; observation?: string | null }
    const user = request.auth?.user
    const allowedTypes = cashReversalTypes(user)
    const access = cashAccess(user, cashReversalPermission(user), body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.cashSessionId?.trim()) return validation(reply, 'Sesión requerida')
    try {
      return await service.reverseCashEntry({
        businessId: access.businessId,
        cashSessionId: body.cashSessionId.trim(),
        entryId: params.id,
        ...(body.observation === undefined ? {} : { observation: body.observation }),
        allowedSourceTypes: allowedTypes
      })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })
}

function cashAccess(user: StaffAuthorizationUser | undefined, permission: CashPermission, source: unknown) {
  if (!user || !hasCashPermission(user, permission)) return { ok: false as const, code: 'CASH_PERMISSION_REQUIRED' as const }
  const requested = source && typeof source === 'object' ? (source as { businessId?: unknown }).businessId : undefined
  const businessId = user.role === 'SUPER_ADMIN' && typeof requested === 'string' ? requested.trim() : user.businessId?.trim()
  if (!businessId) return { ok: false as const, code: 'BUSINESS_ID_REQUIRED' as const }
  return { ok: true as const, businessId }
}

function cashAccessFailure(reply: FastifyReply, access: { code: 'CASH_PERMISSION_REQUIRED' | 'BUSINESS_ID_REQUIRED' }) {
  return access.code === 'CASH_PERMISSION_REQUIRED'
    ? reply.status(403).send({ code: access.code, message: 'No tenés permiso para realizar esta operación de Caja' })
    : validation(reply, 'Seleccioná un comercio')
}

function cashReversalTypes(user: StaffAuthorizationUser | undefined): Array<'PAYMENT' | 'LEGACY_PAYMENT' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'> {
  if (!user) return []
  if (user.role === 'BUSINESS_ADMIN' || user.role === 'SUPER_ADMIN') return ['PAYMENT', 'LEGACY_PAYMENT', 'EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND']
  const types: Array<'PAYMENT' | 'LEGACY_PAYMENT' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'> = []
  if (user.canRecordAppointmentPayments) types.push('PAYMENT', 'LEGACY_PAYMENT')
  if (user.canManageCashOperations) types.push('EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'REFUND')
  if (user.canAdjustCash) types.push('ADJUSTMENT')
  return types
}

function cashReversalPermission(user: StaffAuthorizationUser | undefined): CashPermission {
  if (user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.canManageCashOperations) return 'canManageCashOperations'
  if (user?.canAdjustCash) return 'canAdjustCash'
  return 'canRecordAppointmentPayments'
}

function cashPermissionSnapshot(user: StaffAuthorizationUser) {
  return {
    canViewCashRegister: hasCashPermission(user, 'canViewCashRegister'),
    canRecordAppointmentPayments: hasCashPermission(user, 'canRecordAppointmentPayments'),
    canApplyDiscounts: hasCashPermission(user, 'canApplyDiscounts'),
    canManageCashOperations: hasCashPermission(user, 'canManageCashOperations'),
    canAdjustCash: hasCashPermission(user, 'canAdjustCash'),
    canManageCashSessions: hasCashPermission(user, 'canManageCashSessions')
  }
}

function optionalInteger(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new CashServiceError('INVALID_LIMIT')
  return parsed
}

function validation(reply: FastifyReply, message: string) {
  return reply.status(400).send({ code: 'VALIDATION', message })
}

export function sendCashError(reply: FastifyReply, error: unknown) {
  const code = error instanceof CashServiceError || error instanceof CashDomainError ? error.code : 'INTERNAL_ERROR'
  if (code === 'CASH_PERMISSION_REQUIRED') {
    return reply.status(403).send({ code, message: 'No tenés permiso para corregir este movimiento' })
  }
  if (['BUSINESS_NOT_FOUND', 'REGISTER_DAY_NOT_FOUND', 'ENTRY_NOT_FOUND', 'APPOINTMENT_ACCOUNT_NOT_FOUND', 'MISSING_APPOINTMENT_EVIDENCE'].includes(code)) {
    return reply.status(404).send({ code: 'NOT_FOUND', message: 'El recurso no está disponible' })
  }
  if (['CASH_CLOSED', 'STALE_SESSION', 'OVERPAYMENT', 'OPEN_DAY_EXISTS', 'ENTRY_NOT_REVERSIBLE', 'FIXED_PRICE_IMMUTABLE', 'ESTIMATED_TOTAL_REQUIRED'].includes(code)) {
    return reply.status(409).send({ code, message: 'La operación no puede completarse en el estado actual' })
  }
  if (code === 'INTERNAL_ERROR') throw error
  return reply.status(400).send({ code: 'VALIDATION', message: 'Revisá los datos ingresados' })
}
