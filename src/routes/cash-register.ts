import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '../config/prisma.js'
import { PrismaCashRepository } from '../repositories/prisma-cash-repository.js'
import { CashDomainError } from '../services/cash-domain.js'
import { CashService, CashServiceError, type CashOperationInput } from '../services/cash-service.js'
import { hasCashPermission, type CashPermission, type StaffAuthorizationUser } from '../services/staff-permission-service.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'
import type { AuthUser } from '../services/auth-service.js'

type CashRegisterRoutesOptions = {
  cashService?: CashService
  authorizeBusiness?: (user: AuthUser, businessId: string) => Promise<boolean>
}

const defaultCashService = new CashService(new PrismaCashRepository(prisma))

export async function cashRegisterRoutes(app: FastifyInstance, options: CashRegisterRoutesOptions = {}) {
  const service = options.cashService ?? defaultCashService
  const authorizeBusiness = options.authorizeBusiness ?? (async (user: AuthUser, businessId: string) => Boolean(await requireAuthorizedBusiness(prisma, user, businessId)))
  const cashAccess = (user: AuthUser | undefined, permission: CashPermission, source: unknown) => cashAccessForUser(user, permission, source, authorizeBusiness)
  const cashAnyAccess = (user: AuthUser | undefined, permissions: CashPermission[], source: unknown) => cashAnyAccessForUser(user, permissions, source, authorizeBusiness)

  app.get('/cash-register/responsibles', async (request, reply) => {
    const access = await cashAccess(request.auth?.user, 'canManageCashSessions', request.query)
    if (!access.ok) return cashAccessFailure(reply, access)
    return prisma.user.findMany({
      where: {
        businessId: access.businessId,
        isActive: true,
        role: { in: ['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'STAFF'] }
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, role: true }
    })
  })

  app.get('/cash-register/current', async (request, reply) => {
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', request.query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      return { ...await service.getCurrentCashRegister({ businessId: access.businessId }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/payment-context', async (request, reply) => {
    const access = await cashAccess(request.auth?.user, 'canRecordAppointmentPayments', request.query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      return await service.getCurrentPaymentContext({ businessId: access.businessId })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/period/summary', async (request, reply) => {
    const query = request.query as { businessId?: string; from?: string; to?: string }
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (request.auth!.user.role === 'STAFF') return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'Solo administración puede consultar períodos anteriores' })
    if (typeof query.from !== 'string' || typeof query.to !== 'string') return validation(reply, 'Elegí un período válido')
    try {
      return { ...await service.getCashPeriodSummary({ businessId: access.businessId, from: query.from, to: query.to }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/period/expenses', async (request, reply) => {
    const query = request.query as { businessId?: string; from?: string; to?: string; page?: string; pageSize?: string; method?: string; categoryId?: string; subcategoryId?: string; q?: string }
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (request.auth!.user.role === 'STAFF') return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'Solo administración puede consultar períodos anteriores' })
    const methods = ['CASH', 'TRANSFER', 'CARD', 'UNSPECIFIED'] as const
    if (typeof query.from !== 'string' || typeof query.to !== 'string') return validation(reply, 'Elegí un período válido')
    if (query.method && !methods.includes(query.method as typeof methods[number])) return validation(reply, 'Medio de pago inválido')
    try {
      const page = optionalInteger(query.page)
      const pageSize = optionalInteger(query.pageSize)
      return await service.listCashPeriodExpenses({
        businessId: access.businessId,
        from: query.from,
        to: query.to,
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
        ...(query.method === undefined ? {} : { method: query.method as typeof methods[number] }),
        ...(query.categoryId === undefined ? {} : { expenseCategoryId: query.categoryId }),
        ...(query.subcategoryId === undefined ? {} : { expenseSubcategoryId: query.subcategoryId }),
        ...(query.q === undefined ? {} : { query: query.q })
      })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days', async (request, reply) => {
    const query = request.query as { businessId?: string; limit?: string }
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      const limit = optionalInteger(query.limit)
      if (request.auth!.user.role === 'STAFF') {
        const current = await service.getCurrentCashRegister({ businessId: access.businessId })
        return { days: current.day ? [current.day] : [], permissions: cashPermissionSnapshot(request.auth!.user) }
      }
      return { days: await service.listCashRegisterDays({ businessId: access.businessId, ...(limit === undefined ? {} : { limit }) }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days/:id/summary', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const params = request.params as { id: string }
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      if (request.auth!.user.role === 'STAFF') {
        const current = await service.getCurrentCashRegister({ businessId: access.businessId })
        if (current.day?.id !== params.id) return reply.status(404).send({ code: 'NOT_FOUND', message: 'La jornada no está disponible' })
      }
      return { ...await service.getCashRegisterDaySummary({ businessId: access.businessId, registerDayId: params.id }), permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/days/:id/entries', async (request, reply) => {
    const params = request.params as { id: string }
    const query = request.query as { businessId?: string; cursor?: string; limit?: string; type?: string; method?: string; categoryId?: string; subcategoryId?: string; sessionId?: string; q?: string }
    const access = await cashAccess(request.auth?.user, 'canViewCashRegister', query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      if (request.auth!.user.role === 'STAFF') {
        const current = await service.getCurrentCashRegister({ businessId: access.businessId })
        if (current.day?.id !== params.id) return reply.status(404).send({ code: 'NOT_FOUND', message: 'La jornada no está disponible' })
      }
    } catch (error) {
      return sendCashError(reply, error)
    }
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
        ...(query.categoryId === undefined ? {} : { expenseCategoryId: query.categoryId }),
        ...(query.subcategoryId === undefined ? {} : { expenseSubcategoryId: query.subcategoryId }),
        ...(query.sessionId === undefined ? {} : { cashSessionId: query.sessionId }),
        ...(query.q === undefined ? {} : { query: query.q })
      })
      return { entries: page.entries, nextCursor: page.nextCursor, permissions: cashPermissionSnapshot(request.auth!.user) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/expense-categories', async (request, reply) => {
    const query = request.query as { businessId?: string; includeInactive?: string }
    const access = await cashAnyAccess(request.auth?.user, ['canViewCashRegister', 'canManageCashOperations'], query)
    if (!access.ok) return cashAccessFailure(reply, access)
    try {
      return {
        categories: await service.listExpenseCategories({
          businessId: access.businessId,
          includeInactive: query.includeInactive === 'true'
        })
      }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/expense-categories', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá el nombre y el orden de la categoría')
    const body = request.body
    const access = await cashAccess(request.auth?.user, 'canManageCashOperations', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (typeof body.name !== 'string' || (body.position !== undefined && typeof body.position !== 'number')) {
      return validation(reply, 'Revisá el nombre y el orden de la categoría')
    }
    try {
      return await service.createExpenseCategory({ businessId: access.businessId, name: body.name, ...(body.position === undefined ? {} : { position: body.position }) })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.patch('/cash-register/expense-categories/:id', async (request, reply) => {
    const params = request.params as { id?: unknown }
    if (!isRecord(request.body)) return validation(reply, 'Revisá los datos de la categoría')
    const body = request.body
    const access = await cashAccess(request.auth?.user, 'canManageCashOperations', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (typeof params.id !== 'string' || !params.id.trim() || typeof body.name !== 'string' || (body.position !== undefined && typeof body.position !== 'number') || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) {
      return validation(reply, 'Revisá los datos de la categoría')
    }
    try {
      return await service.updateExpenseCategory({
        businessId: access.businessId,
        categoryId: params.id.trim(),
        name: body.name,
        ...(body.position === undefined ? {} : { position: body.position }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive })
      })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.get('/cash-register/expense-subcategories', async (request, reply) => {
    const query = request.query as { businessId?: string; categoryId?: string; includeInactive?: string }
    const access = await cashAnyAccess(request.auth?.user, ['canViewCashRegister', 'canManageCashOperations'], query)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (query.categoryId !== undefined && typeof query.categoryId !== 'string') return validation(reply, 'La categoría es inválida')
    try {
      return { subcategories: await service.listExpenseSubcategories({ businessId: access.businessId, categoryId: query.categoryId, includeInactive: query.includeInactive === 'true' }) }
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/expense-subcategories', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá la subcategoría')
    const body = request.body
    const access = await cashAccess(request.auth?.user, 'canManageCashOperations', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (typeof body.categoryId !== 'string' || typeof body.name !== 'string' || (body.position !== undefined && typeof body.position !== 'number')) return validation(reply, 'Revisá categoría, nombre y orden')
    try {
      return await service.createExpenseSubcategory({ businessId: access.businessId, categoryId: body.categoryId, name: body.name, ...(body.position === undefined ? {} : { position: body.position }) })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.patch('/cash-register/expense-subcategories/:id', async (request, reply) => {
    const params = request.params as { id?: unknown }
    if (!isRecord(request.body)) return validation(reply, 'Revisá la subcategoría')
    const body = request.body
    const access = await cashAccess(request.auth?.user, 'canManageCashOperations', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (typeof params.id !== 'string' || !params.id.trim() || typeof body.name !== 'string' || (body.position !== undefined && typeof body.position !== 'number') || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) return validation(reply, 'Revisá los datos de la subcategoría')
    try {
      return await service.updateExpenseSubcategory({ businessId: access.businessId, subcategoryId: params.id.trim(), name: body.name, ...(body.position === undefined ? {} : { position: body.position }), ...(body.isActive === undefined ? {} : { isActive: body.isActive }) })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/open', async (request, reply) => {
    const body = request.body as { businessId?: string; responsibleUserId?: string; openingCash?: number | null }
    const access = await cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.responsibleUserId?.trim()) return validation(reply, 'Responsable requerido')
    try {
      return await service.openRegisterDay({ businessId: access.businessId, responsibleUserId: body.responsibleUserId.trim(), ...administratorResponsible(request.auth!.user, body.responsibleUserId.trim()), ...(body.openingCash === undefined ? {} : { openingCash: body.openingCash }) })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/new-session', async (request, reply) => {
    const body = request.body as { businessId?: string; currentSessionId?: string; responsibleUserId?: string; countedCash?: number; acknowledgeDifference?: boolean }
    const access = await cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.currentSessionId?.trim() || !body.responsibleUserId?.trim() || body.countedCash === undefined) return validation(reply, 'Sesión, responsable y efectivo contado son requeridos')
    try {
      return await service.startNewSession({ businessId: access.businessId, currentSessionId: body.currentSessionId.trim(), responsibleUserId: body.responsibleUserId.trim(), ...administratorResponsible(request.auth!.user, body.responsibleUserId.trim()), countedCash: body.countedCash, acknowledgeDifference: body.acknowledgeDifference === true })
    } catch (error) {
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/close', async (request, reply) => {
    const body = request.body as { businessId?: string; currentSessionId?: string; countedCash?: number; cashToLeave?: unknown; acknowledgeDifference?: boolean }
    const access = await cashAccess(request.auth?.user, 'canManageCashSessions', body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (!body.currentSessionId?.trim() || body.countedCash === undefined) return validation(reply, 'Sesión y efectivo contado son requeridos')
    if (body.cashToLeave !== undefined && !['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(request.auth!.user.role)) {
      return reply.status(403).send({ code: 'CASH_PERMISSION_REQUIRED', message: 'Solo administración puede transferir fondos a Tesorería' })
    }
    if (body.cashToLeave !== undefined && (typeof body.cashToLeave !== 'number' || !Number.isSafeInteger(body.cashToLeave) || body.cashToLeave < 0 || body.cashToLeave > body.countedCash)) {
      return validation(reply, 'Indicá un monto a dejar entre cero y el efectivo contado')
    }
    try {
      return await service.closeRegisterDay({ businessId: access.businessId, currentSessionId: body.currentSessionId.trim(), countedCash: body.countedCash, acknowledgeDifference: body.acknowledgeDifference === true, ...(body.cashToLeave === undefined ? {} : { cashToLeave: body.cashToLeave as number, actorUserId: request.auth!.user.id, actorName: request.auth!.user.name }) })
    } catch (error) {
      if (!(error instanceof CashServiceError || error instanceof CashDomainError)) {
        request.log.error({ err: error }, 'cash_close_failed')
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'No pudimos cerrar la caja. Actualizá la jornada antes de reintentar.' })
      }
      return sendCashError(reply, error)
    }
  })

  app.post('/cash-register/entries', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Sesión y tipo de operación válidos son requeridos')
    const body = request.body
    const permission: CashPermission = body.type === 'ADJUSTMENT' ? 'canAdjustCash' : 'canManageCashOperations'
    const access = await cashAccess(request.auth?.user, permission, body)
    if (!access.ok) return cashAccessFailure(reply, access)
    if (typeof body.cashSessionId !== 'string' || !body.cashSessionId.trim() || typeof body.type !== 'string' || !['EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND'].includes(body.type)) {
      return validation(reply, 'Sesión y tipo de operación válidos son requeridos')
    }
    if (body.categoryId !== undefined && body.categoryId !== null && typeof body.categoryId !== 'string') {
      return validation(reply, 'La categoría de gasto es inválida')
    }
    if (body.type !== 'EXPENSE' && typeof body.categoryId === 'string' && body.categoryId.trim()) {
      return validation(reply, 'La categoría solo corresponde a gastos')
    }
    if (body.subcategoryId !== undefined && body.subcategoryId !== null && typeof body.subcategoryId !== 'string') return validation(reply, 'La subcategoría es inválida')
    if (body.type !== 'EXPENSE' && typeof body.subcategoryId === 'string' && body.subcategoryId.trim()) return validation(reply, 'La subcategoría solo corresponde a gastos')
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
    const access = await cashAccess(user, cashReversalPermission(user), body)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function cashAccessForUser(user: AuthUser | undefined, permission: CashPermission, source: unknown, authorizeBusiness: (user: AuthUser, businessId: string) => Promise<boolean>) {
  if (!user || !hasCashPermission(user, permission)) return { ok: false as const, code: 'CASH_PERMISSION_REQUIRED' as const }
  const requested = source && typeof source === 'object' ? (source as { businessId?: unknown }).businessId : undefined
  const canSelectBusiness = user.role === 'SUPER_ADMIN' || user.role === 'ACCOUNT_ADMIN'
  const businessId = canSelectBusiness && typeof requested === 'string' ? requested.trim() : user.businessId?.trim()
  if (!businessId) return { ok: false as const, code: 'BUSINESS_ID_REQUIRED' as const }
  if (!await authorizeBusiness(user, businessId)) return { ok: false as const, code: 'BUSINESS_NOT_FOUND' as const }
  return { ok: true as const, businessId }
}

async function cashAnyAccessForUser(user: AuthUser | undefined, permissions: CashPermission[], source: unknown, authorizeBusiness: (user: AuthUser, businessId: string) => Promise<boolean>) {
  if (!user || !permissions.some((permission) => hasCashPermission(user, permission))) {
    return { ok: false as const, code: 'CASH_PERMISSION_REQUIRED' as const }
  }
  const requested = source && typeof source === 'object' ? (source as { businessId?: unknown }).businessId : undefined
  const canSelectBusiness = user.role === 'SUPER_ADMIN' || user.role === 'ACCOUNT_ADMIN'
  const businessId = canSelectBusiness && typeof requested === 'string' ? requested.trim() : user.businessId?.trim()
  if (!businessId) return { ok: false as const, code: 'BUSINESS_ID_REQUIRED' as const }
  if (!await authorizeBusiness(user, businessId)) return { ok: false as const, code: 'BUSINESS_NOT_FOUND' as const }
  return { ok: true as const, businessId }
}

function cashAccessFailure(reply: FastifyReply, access: { code: 'CASH_PERMISSION_REQUIRED' | 'BUSINESS_ID_REQUIRED' | 'BUSINESS_NOT_FOUND' }) {
  if (access.code === 'BUSINESS_NOT_FOUND') return reply.status(404).send({ message: 'Recurso no encontrado' })
  return access.code === 'CASH_PERMISSION_REQUIRED'
    ? reply.status(403).send({ code: access.code, message: 'No tenés permiso para realizar esta operación de Caja' })
    : validation(reply, 'Seleccioná un comercio')
}

function cashReversalTypes(user: StaffAuthorizationUser | undefined): Array<'PAYMENT' | 'LEGACY_PAYMENT' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'> {
  if (!user) return []
  if (['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role)) return ['PAYMENT', 'LEGACY_PAYMENT', 'EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND']
  const types: Array<'PAYMENT' | 'LEGACY_PAYMENT' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_IN' | 'ADJUSTMENT' | 'REFUND'> = []
  if (user.canRecordAppointmentPayments) types.push('PAYMENT', 'LEGACY_PAYMENT')
  if (user.canManageCashOperations) types.push('EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'REFUND')
  if (user.canAdjustCash) types.push('ADJUSTMENT')
  return types
}

function cashReversalPermission(user: StaffAuthorizationUser | undefined): CashPermission {
  if (user && (['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role) || user.canManageCashOperations)) return 'canManageCashOperations'
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
    if (code === 'OVERPAYMENT') {
    return reply.status(409).send({ code, message: 'El importe supera el saldo pendiente o el descuento deja el total por debajo de lo ya pagado' })
    }
    if (code === 'TOTAL_BELOW_PAID') {
      return reply.status(409).send({ code, message: 'El total final no puede quedar por debajo de lo ya cobrado' })
    }
    if (code === 'TOTAL_BELOW_MINIMUM') {
      return reply.status(409).send({ code, message: 'El total final no puede quedar por debajo del precio base del servicio' })
    }
    if (code === 'TOTAL_UNCHANGED') {
      return reply.status(409).send({ code, message: 'El total ingresado es igual al total actual' })
    }
  if (code === 'TOTAL_ADJUSTMENT_REASON_REQUIRED') {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Ingresá un motivo breve para el ajuste' })
    }
  if (code === 'EXPENSE_CATEGORY_NOT_FOUND') {
    return reply.status(404).send({ code: 'NOT_FOUND', message: 'La categoría de gasto no existe en este negocio' })
  }
  if (code === 'EXPENSE_CATEGORY_INACTIVE') {
    return reply.status(409).send({ code, message: 'La categoría está inactiva; elegí otra para registrar el gasto' })
  }
  if (code === 'EXPENSE_SUBCATEGORY_NOT_FOUND') return reply.status(404).send({ code: 'NOT_FOUND', message: 'La subcategoría no existe en este negocio' })
  if (code === 'EXPENSE_SUBCATEGORY_INACTIVE') return reply.status(409).send({ code, message: 'La subcategoría está inactiva; elegí otra' })
  if (code === 'EXPENSE_SUBCATEGORY_CATEGORY_MISMATCH') return reply.status(400).send({ code: 'VALIDATION', message: 'La subcategoría no pertenece a la categoría seleccionada' })
  if (code === 'EXPENSE_SUBCATEGORY_DUPLICATE') return reply.status(409).send({ code, message: 'Ya existe esa subcategoría en esta categoría' })
  if (code === 'DEFAULT_EXPENSE_CATEGORY_PROTECTED') {
    return reply.status(409).send({ code, message: 'La categoría Otros es obligatoria y no puede renombrarse ni desactivarse' })
  }
  if (code === 'EXPENSE_CATEGORY_DUPLICATE') {
    return reply.status(409).send({ code, message: 'Ya existe una categoría con ese nombre' })
  }
  if (['INVALID_EXPENSE_CATEGORY_NAME', 'INVALID_EXPENSE_CATEGORY_POSITION'].includes(code)) {
    return reply.status(400).send({ code: 'VALIDATION', message: 'Ingresá un nombre de hasta 60 caracteres y un orden válido' })
  }
  if (code === 'INVALID_CASH_PERIOD') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'Elegí un período válido' })
  }
  if (code === 'CASH_PERIOD_TOO_LONG') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'El período no puede superar 31 días' })
  }
  if (code === 'INVALID_PAGE' || code === 'INVALID_PAGE_SIZE') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'Revisá la página y la cantidad de resultados' })
  }
  if (code === 'APPOINTMENT_COMPLETION_REQUIRES_FULL_PAYMENT') {
    return reply.status(409).send({ code, message: 'Para marcarlo realizado, el pago debe completar todo el saldo pendiente' })
  }
  if (code === 'APPOINTMENT_COMPLETION_NOT_ALLOWED') {
    return reply.status(409).send({ code, message: 'El turno no puede marcarse realizado antes de comenzar ni si está cancelado o ausente' })
  }
  if (code === 'APPOINTMENT_COMPLETION_ACTOR_REQUIRED') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'No se pudo identificar quién completa el turno' })
  }
  if (code === 'TREASURY_NOT_ENABLED') {
    return reply.status(409).send({ code, message: 'Habilitá Tesorería antes de dejar cambio y transferir el excedente' })
  }
  if (code === 'INVALID_CASH_TO_LEAVE') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'El monto a dejar no puede superar el efectivo contado' })
  }
  if (code === 'CASH_TRANSFER_ACTOR_REQUIRED') {
    return reply.status(403).send({ code, message: 'No se pudo identificar quién transfiere el dinero' })
  }
  if (code === 'CASH_DIFFERENCE_CONFIRMATION_REQUIRED') {
    return reply.status(409).send({ code, message: 'Confirmá la diferencia de efectivo antes de continuar' })
  }
  if (code === 'INVALID_DISCOUNT_PERCENTAGE') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'El porcentaje debe ser mayor a 0 y no superar 100' })
  }
  if (code === 'INVALID_DISCOUNT_AMOUNT' || code === 'INVALID_DISCOUNT_TYPE') {
    return reply.status(400).send({ code: 'VALIDATION', message: 'Revisá el tipo y el valor del descuento' })
  }
  if (['CASH_CLOSED', 'STALE_SESSION', 'OVERPAYMENT', 'OPEN_DAY_EXISTS', 'ENTRY_NOT_REVERSIBLE', 'FIXED_PRICE_IMMUTABLE', 'ESTIMATED_TOTAL_REQUIRED'].includes(code)) {
    return reply.status(409).send({ code, message: 'La operación no puede completarse en el estado actual' })
  }
  if (code === 'INTERNAL_ERROR') throw error
  return reply.status(400).send({ code: 'VALIDATION', message: 'Revisá los datos ingresados' })
}

function administratorResponsible(user: AuthUser, selectedUserId: string) {
  if (!['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role) || user.id !== selectedUserId) return {}
  return { actingAdministrator: { id: user.id, name: user.name?.trim() || user.email || 'Administrador' } }
}
