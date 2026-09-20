import type { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { ProductSalesError, ProductSalesService, type ProductItemInput } from '../services/product-sales-service.js'
import type { AuthUser } from '../services/auth-service.js'

const productSalesService = new ProductSalesService(prisma)

type ProductPermission = 'canViewProducts' | 'canManageProducts' | 'canSellProducts'

export async function productSalesRoutes(app: FastifyInstance) {
  app.get('/product-categories', async (request, reply) => {
    const query = request.query as { businessId?: string; includeInactive?: string }
    const access = productAccess(request.auth?.user, 'canViewProducts', query)
    if (!access.ok) return productAccessFailure(reply, access)
    return { categories: await productSalesService.listCategories({ businessId: access.businessId, includeInactive: query.includeInactive === 'true' }) }
  })

  app.post('/product-categories', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá los datos de la categoría')
    const access = productAccess(request.auth?.user, 'canManageProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const body = request.body
    if (typeof body.name !== 'string' || (body.sortOrder !== undefined && typeof body.sortOrder !== 'number')) return validation(reply, 'Revisá los datos de la categoría')
    try {
      return await productSalesService.createCategory({ businessId: access.businessId, name: body.name, ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}) })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.patch('/product-categories/:id', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá los datos de la categoría')
    const access = productAccess(request.auth?.user, 'canManageProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const body = request.body
    const params = request.params as { id: string }
    if (typeof body.name !== 'string' || (body.sortOrder !== undefined && typeof body.sortOrder !== 'number') || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) return validation(reply, 'Revisá los datos de la categoría')
    try {
      return await productSalesService.updateCategory({ businessId: access.businessId, categoryId: params.id, name: body.name, ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}), ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}) })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.get('/products', async (request, reply) => {
    const query = request.query as { businessId?: string; includeInactive?: string; categoryId?: string; q?: string }
    const access = productAccess(request.auth?.user, 'canViewProducts', query)
    if (!access.ok) return productAccessFailure(reply, access)
    return { products: await productSalesService.listProducts({ businessId: access.businessId, includeInactive: query.includeInactive === 'true', ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }), ...(query.q === undefined ? {} : { query: query.q }) }) }
  })

  app.post('/products', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá los datos del producto')
    const access = productAccess(request.auth?.user, 'canManageProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const body = request.body
    if (!validProductBody(body)) return validation(reply, 'Revisá nombre, precio y categoría del producto')
    try {
      return await productSalesService.createProduct({ businessId: access.businessId, ...productWrite(body) })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.patch('/products/:id', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá los datos del producto')
    const access = productAccess(request.auth?.user, 'canManageProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const body = request.body
    const params = request.params as { id: string }
    if (!validProductBody(body) || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) return validation(reply, 'Revisá nombre, precio y categoría del producto')
    try {
      return await productSalesService.updateProduct({ businessId: access.businessId, productId: params.id, ...productWrite(body), ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}) })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.post('/product-sales', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Revisá los productos y el medio de pago')
    const access = productSaleAccess(request.auth?.user, request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const body = request.body
    const idempotencyHeader = request.headers['idempotency-key']
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader : typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
    if (body.appointmentId !== undefined && body.appointmentId !== null) return validation(reply, 'Las compras de un turno se cobran desde el pago del turno')
    if (typeof body.cashSessionId !== 'string' || typeof body.paymentMethod !== 'string' || !Array.isArray(body.items) || (body.discountAmount !== undefined && typeof body.discountAmount !== 'number')) return validation(reply, 'Revisá los productos, la caja y el medio de pago')
    try {
      return await productSalesService.completeProductSale({
        businessId: access.businessId,
        cashSessionId: body.cashSessionId,
        customerId: optionalString(body.customerId),
        paymentMethod: body.paymentMethod as 'CASH' | 'TRANSFER' | 'CARD',
        discountAmount: typeof body.discountAmount === 'number' ? body.discountAmount : 0,
        items: body.items as ProductItemInput[],
        observation: optionalString(body.observation),
        idempotencyKey,
        actor: actor(request.auth!.user)
      })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.get('/appointments/:id/product-items', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const params = request.params as { id: string }
    const access = productAccess(request.auth?.user, 'canViewProducts', query)
    if (!access.ok) return productAccessFailure(reply, access)
    try { return await productSalesService.getAppointmentProducts({ businessId: access.businessId, appointmentId: params.id }) }
    catch (error) { return sendProductSalesError(reply, error) }
  })

  app.post('/appointments/:id/product-items', async (request, reply) => {
    if (!isRecord(request.body)) return validation(reply, 'Elegí un producto y una cantidad válida')
    const access = productAccess(request.auth?.user, 'canSellProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const params = request.params as { id: string }
    const body = request.body
    try {
      if (Array.isArray(body.items)) {
        return await productSalesService.replaceAppointmentProducts({ businessId: access.businessId, appointmentId: params.id, items: body.items as ProductItemInput[], actor: actor(request.auth!.user) })
      }
      if (typeof body.productId !== 'string' || typeof body.quantity !== 'number') return validation(reply, 'Elegí un producto y una cantidad válida')
      return await productSalesService.addAppointmentProduct({ businessId: access.businessId, appointmentId: params.id, productId: body.productId, quantity: body.quantity, actor: actor(request.auth!.user) })
    } catch (error) { return sendProductSalesError(reply, error) }
  })

  app.patch('/appointments/:appointmentId/product-items/:itemId', async (request, reply) => {
    if (!isRecord(request.body) || typeof request.body.quantity !== 'number') return validation(reply, 'Ingresá una cantidad válida')
    const access = productAccess(request.auth?.user, 'canSellProducts', request.body)
    if (!access.ok) return productAccessFailure(reply, access)
    const params = request.params as { appointmentId: string; itemId: string }
    try { return await productSalesService.setAppointmentProductQuantity({ businessId: access.businessId, appointmentId: params.appointmentId, itemId: params.itemId, quantity: request.body.quantity, actor: actor(request.auth!.user) }) }
    catch (error) { return sendProductSalesError(reply, error) }
  })

  app.delete('/appointments/:appointmentId/product-items/:itemId', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const access = productAccess(request.auth?.user, 'canSellProducts', body)
    if (!access.ok) return productAccessFailure(reply, access)
    const params = request.params as { appointmentId: string; itemId: string }
    try { return await productSalesService.removeAppointmentProduct({ businessId: access.businessId, appointmentId: params.appointmentId, itemId: params.itemId, actor: actor(request.auth!.user) }) }
    catch (error) { return sendProductSalesError(reply, error) }
  })
}

function productAccess(user: AuthUser | undefined, permission: ProductPermission, source: unknown) {
  if (!user || !hasProductPermission(user, permission)) return { ok: false as const, code: 'PRODUCT_PERMISSION_REQUIRED' as const }
  const requested = isRecord(source) ? source.businessId : undefined
  const canSelectBusiness = user.role === 'SUPER_ADMIN' || user.role === 'ACCOUNT_ADMIN'
  const businessId = canSelectBusiness && typeof requested === 'string' ? requested.trim() : user.businessId?.trim()
  if (!businessId) return { ok: false as const, code: 'BUSINESS_ID_REQUIRED' as const }
  return { ok: true as const, businessId }
}

function productSaleAccess(user: AuthUser | undefined, source: unknown) {
  const access = productAccess(user, 'canSellProducts', source)
  if (!access.ok || !user) return access
  if (user.role === 'STAFF' && !user.canRecordAppointmentPayments) return { ok: false as const, code: 'PRODUCT_PERMISSION_REQUIRED' as const }
  return access
}

function hasProductPermission(user: AuthUser, permission: ProductPermission) {
  if (['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role)) return true
  return user.role === 'STAFF' && user[permission] === true
}

function actor(user: AuthUser) { return { userId: user.id, name: user.name } }
function optionalString(value: unknown) { return typeof value === 'string' ? value.trim() || null : null }
function productAccessFailure(reply: FastifyReply, access: { code: 'PRODUCT_PERMISSION_REQUIRED' | 'BUSINESS_ID_REQUIRED' }) {
  return access.code === 'PRODUCT_PERMISSION_REQUIRED'
    ? reply.status(403).send({ code: access.code, message: 'No tenés permiso para realizar esta operación con productos' })
    : validation(reply, 'Seleccioná un comercio')
}
function validProductBody(body: Record<string, unknown>) {
  return typeof body.name === 'string' && typeof body.salePrice === 'number'
    && (body.description === undefined || body.description === null || typeof body.description === 'string')
    && (body.sku === undefined || body.sku === null || typeof body.sku === 'string')
    && (body.categoryId === undefined || body.categoryId === null || typeof body.categoryId === 'string')
    && (body.cost === undefined || body.cost === null || typeof body.cost === 'number')
    && (body.sortOrder === undefined || typeof body.sortOrder === 'number')
}
function productWrite(body: Record<string, unknown>) {
  return {
    name: body.name as string,
    description: optionalString(body.description),
    sku: optionalString(body.sku),
    categoryId: optionalString(body.categoryId),
    salePrice: body.salePrice as number,
    cost: body.cost === null || body.cost === undefined ? null : body.cost as number,
    ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {})
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function validation(reply: FastifyReply, message: string) { return reply.status(400).send({ code: 'VALIDATION', message }) }

export function sendProductSalesError(reply: FastifyReply, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.status(409).send({ code: 'DUPLICATE', message: 'Ya existe un registro con ese nombre, código o clave de operación' })
  const code = error instanceof ProductSalesError ? error.code : 'INTERNAL_ERROR'
  if (['PRODUCT_CATEGORY_NOT_FOUND', 'PRODUCT_NOT_FOUND', 'PRODUCT_NOT_AVAILABLE', 'CUSTOMER_NOT_FOUND', 'APPOINTMENT_NOT_FOUND', 'PRODUCT_SALE_ITEM_NOT_FOUND', 'APPOINTMENT_ACCOUNT_NOT_FOUND'].includes(code)) return reply.status(404).send({ code: 'NOT_FOUND', message: 'El recurso no está disponible en este negocio' })
  if (code === 'IDEMPOTENCY_CONFLICT') return reply.status(409).send({ code, message: 'La clave de operación ya fue usada con otra venta' })
  if (code === 'DIRECT_SALE_CANNOT_REFERENCE_APPOINTMENT') return reply.status(409).send({ code, message: 'Las compras de un turno se cobran desde el pago del turno' })
  if (['CASH_CLOSED', 'PRODUCT_SALE_ALREADY_COMPLETED', 'APPOINTMENT_CUSTOMER_MISMATCH', 'ESTIMATED_TOTAL_REQUIRED'].includes(code)) return reply.status(409).send({ code, message: 'La operación no puede completarse en el estado actual' })
  if (code === 'OVERPAYMENT') return reply.status(409).send({ code: 'PRODUCT_TOTAL_BELOW_PAID', message: 'No podés quitar productos porque el total quedaría por debajo de lo ya cobrado' })
  if (code === 'IDEMPOTENCY_KEY_REQUIRED') return reply.status(400).send({ code: 'VALIDATION', message: 'Falta la clave de operación para evitar cobros duplicados' })
  if (code === 'INTERNAL_ERROR') throw error
  return validation(reply, 'Revisá los datos de productos ingresados')
}