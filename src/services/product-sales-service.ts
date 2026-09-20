import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { calculateAccountTotals } from './cash-domain.js'
import { createCashTransactionRepository } from '../repositories/prisma-cash-repository.js'
import { ensureAppointmentAccountForPayment } from './cash-service.js'

export class ProductSalesError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ProductSalesError'
  }
}

export type ProductSaleActor = { userId: string | null; name: string }
export type ProductItemInput = { productId: string; quantity: number }

type ProductSnapshot = {
  id: string
  name: string
  sku: string | null
  cost: number | null
  salePrice: number
}

export function normalizeProductItems(items: ProductItemInput[]) {
  if (!Array.isArray(items) || items.length === 0) throw new ProductSalesError('PRODUCT_ITEMS_REQUIRED')
  const quantities = new Map<string, number>()
  for (const item of items) {
    const productId = item?.productId?.trim()
    if (!productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new ProductSalesError('INVALID_PRODUCT_ITEM')
    }
    const quantity = (quantities.get(productId) ?? 0) + item.quantity
    if (quantity > 999) throw new ProductSalesError('INVALID_PRODUCT_ITEM')
    quantities.set(productId, quantity)
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }))
}

export function snapshotProductLines(items: ProductItemInput[], products: ProductSnapshot[]) {
  const normalized = normalizeProductItems(items)
  const byId = new Map(products.map((product) => [product.id, product]))
  return normalized.map((item) => {
    const product = byId.get(item.productId)
    if (!product) throw new ProductSalesError('PRODUCT_NOT_AVAILABLE')
    if (!Number.isSafeInteger(product.salePrice) || product.salePrice < 0) throw new ProductSalesError('INVALID_PRODUCT_PRICE')
    const lineTotal = product.salePrice * item.quantity
    if (!Number.isSafeInteger(lineTotal)) throw new ProductSalesError('INVALID_PRODUCT_TOTAL')
    return {
      productId: product.id,
      productNameSnapshot: product.name,
      skuSnapshot: product.sku,
      unitCost: product.cost,
      unitPrice: product.salePrice,
      quantity: item.quantity,
      lineTotal
    }
  })
}

export class ProductSalesService {
  constructor(private readonly prisma: PrismaClient) {}

  listCategories(input: { businessId: string; includeInactive?: boolean }) {
    return this.prisma.productCategory.findMany({
      where: { businessId: input.businessId, ...(input.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }]
    })
  }

  async createCategory(input: { businessId: string; name: string; sortOrder?: number }) {
    const name = normalizeName(input.name, 'INVALID_PRODUCT_CATEGORY_NAME')
    return this.prisma.productCategory.create({
      data: {
        businessId: input.businessId,
        name,
        normalizedName: normalizedKey(name),
        sortOrder: normalizeSortOrder(input.sortOrder)
      }
    })
  }

  async updateCategory(input: { businessId: string; categoryId: string; name: string; sortOrder?: number; isActive?: boolean }) {
    const existing = await this.prisma.productCategory.findFirst({ where: { id: input.categoryId, businessId: input.businessId } })
    if (!existing) throw new ProductSalesError('PRODUCT_CATEGORY_NOT_FOUND')
    const name = normalizeName(input.name, 'INVALID_PRODUCT_CATEGORY_NAME')
    return this.prisma.productCategory.update({
      where: { id: existing.id },
      data: {
        name,
        normalizedName: normalizedKey(name),
        ...(input.sortOrder === undefined ? {} : { sortOrder: normalizeSortOrder(input.sortOrder) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive })
      }
    })
  }

  listProducts(input: { businessId: string; includeInactive?: boolean; categoryId?: string | null; query?: string | null }) {
    const query = input.query?.trim()
    return this.prisma.product.findMany({
      where: {
        businessId: input.businessId,
        ...(input.includeInactive ? {} : { isActive: true }),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { sku: { contains: query, mode: 'insensitive' } }] } : {})
      },
      include: { category: { select: { id: true, name: true, isActive: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }]
    })
  }

  async createProduct(input: { businessId: string; categoryId?: string | null; name: string; description?: string | null; sku?: string | null; salePrice: number; cost?: number | null; sortOrder?: number }) {
    const data = await this.normalizeProductWrite(input)
    return this.prisma.product.create({ data: { businessId: input.businessId, ...data } })
  }

  async updateProduct(input: { businessId: string; productId: string; categoryId?: string | null; name: string; description?: string | null; sku?: string | null; salePrice: number; cost?: number | null; sortOrder?: number; isActive?: boolean }) {
    const existing = await this.prisma.product.findFirst({ where: { id: input.productId, businessId: input.businessId } })
    if (!existing) throw new ProductSalesError('PRODUCT_NOT_FOUND')
    const data = await this.normalizeProductWrite(input)
    return this.prisma.product.update({
      where: { id: existing.id },
      data: { ...data, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) }
    })
  }

  async getAppointmentProducts(input: { businessId: string; appointmentId: string }) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id: input.appointmentId, businessId: input.businessId }, select: { id: true } })
    if (!appointment) throw new ProductSalesError('APPOINTMENT_NOT_FOUND')
    const sale = await this.prisma.productSale.findFirst({
      where: { businessId: input.businessId, appointmentId: input.appointmentId },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, audits: { orderBy: { createdAt: 'desc' } } }
    })
    return sale
      ? { ...sale, items: sale.lines }
      : { appointmentId: input.appointmentId, status: 'DRAFT' as const, serviceSubtotal: null, productSubtotal: 0, discountAmount: 0, total: null, lines: [], items: [], audits: [] }
  }

  addAppointmentProduct(input: { businessId: string; appointmentId: string; productId: string; quantity: number; actor: ProductSaleActor }) {
    return this.mutateAppointmentProducts({ ...input, action: 'ADD', items: [{ productId: input.productId, quantity: input.quantity }] })
  }

  replaceAppointmentProducts(input: { businessId: string; appointmentId: string; items: ProductItemInput[]; actor: ProductSaleActor }) {
    return this.mutateAppointmentProducts({ ...input, action: 'REPLACE' })
  }

  removeAppointmentProduct(input: { businessId: string; appointmentId: string; itemId: string; actor: ProductSaleActor }) {
    return this.mutateAppointmentProducts({ ...input, action: 'REMOVE', items: [] })
  }

  setAppointmentProductQuantity(input: { businessId: string; appointmentId: string; itemId: string; quantity: number; actor: ProductSaleActor }) {
    return this.mutateAppointmentProducts({ ...input, action: 'SET_QUANTITY', items: [] })
  }

  async completeProductSale(input: {
    businessId: string
    cashSessionId: string
    customerId?: string | null
    appointmentId?: string | null
    paymentMethod: 'CASH' | 'TRANSFER' | 'CARD'
    discountAmount?: number
    items: ProductItemInput[]
    observation?: string | null
    idempotencyKey: string
    actor: ProductSaleActor
  }) {
    const items = normalizeProductItems(input.items)
    const key = normalizeIdempotencyKey(input.idempotencyKey)
    if (input.appointmentId) throw new ProductSalesError('DIRECT_SALE_CANNOT_REFERENCE_APPOINTMENT')
    const discountAmount = money(input.discountAmount ?? 0, 'INVALID_PRODUCT_DISCOUNT')
    const fingerprint = saleRequestFingerprint({ ...input, discountAmount, items })
    if (!['CASH', 'TRANSFER', 'CARD'].includes(input.paymentMethod)) throw new ProductSalesError('INVALID_PAYMENT_METHOD')
    return this.prisma.$transaction(async (tx) => {
      await lockProductSales(tx, input.businessId, input.appointmentId ?? key)
      const replay = await tx.productSale.findFirst({
        where: { businessId: input.businessId, idempotencyKey: key },
        include: { lines: true, cashEntry: true }
      })
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) throw new ProductSalesError('IDEMPOTENCY_CONFLICT')
        return replay
      }

      const session = await tx.cashSession.findFirst({
        where: { id: input.cashSessionId, businessId: input.businessId, closedAt: null },
        include: { registerDay: { select: { id: true, closedAt: true } } }
      })
      if (!session || session.registerDay.closedAt) throw new ProductSalesError('CASH_CLOSED')
      if (input.customerId && !await tx.customer.findFirst({ where: { id: input.customerId, businessId: input.businessId }, select: { id: true } })) {
        throw new ProductSalesError('CUSTOMER_NOT_FOUND')
      }
      let appointment: { id: string; customerId: string } | null = null
      if (input.appointmentId) {
        appointment = await tx.appointment.findFirst({ where: { id: input.appointmentId, businessId: input.businessId }, select: { id: true, customerId: true } })
        if (!appointment) throw new ProductSalesError('APPOINTMENT_NOT_FOUND')
        if (input.customerId && appointment.customerId !== input.customerId) throw new ProductSalesError('APPOINTMENT_CUSTOMER_MISMATCH')
      }
      const products = await activeProducts(tx, input.businessId, items.map((item) => item.productId))
      const lines = snapshotProductLines(items, products)
      const productSubtotal = sumLines(lines)
      if (productSubtotal <= 0) throw new ProductSalesError('INVALID_PRODUCT_TOTAL')
      if (discountAmount < 0 || discountAmount >= productSubtotal) throw new ProductSalesError('INVALID_PRODUCT_DISCOUNT')
      const productTotal = productSubtotal - discountAmount

      let sale = appointment
        ? await upsertAppointmentDraft(tx, {
            businessId: input.businessId,
            appointmentId: appointment.id,
            customerId: input.customerId ?? appointment.customerId,
            items: lines,
            actor: input.actor,
            action: 'CHECKOUT'
          })
        : await tx.productSale.create({
            data: {
              businessId: input.businessId,
              customerId: input.customerId ?? null,
              actorUserId: input.actor.userId,
              actorName: normalizeActorName(input.actor.name),
              status: 'DRAFT',
              productSubtotal,
              discountAmount,
              total: productTotal,
              lines: { create: lines.map((line) => ({ businessId: input.businessId, ...line })) }
            }
          })
      if (sale.status !== 'DRAFT') throw new ProductSalesError('PRODUCT_SALE_ALREADY_COMPLETED')
      const accountId = appointment ? await appointmentAccountId(tx, input.businessId, appointment.id) : null
      sale = await tx.productSale.update({
        where: { id: sale.id },
        data: {
          status: 'COMPLETED',
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          discountAmount,
          total: productTotal,
          paymentMethod: input.paymentMethod,
          observation: optionalText(input.observation),
          completedAt: new Date()
        }
      })
      await tx.productSaleAudit.create({
        data: {
          businessId: input.businessId,
          saleId: sale.id,
          actorUserId: input.actor.userId,
          actorName: normalizeActorName(input.actor.name),
          action: 'COMPLETED',
          previousSubtotal: productSubtotal,
          newSubtotal: productSubtotal,
          detail: { paymentMethod: input.paymentMethod, discountAmount, idempotencyKey: key }
        }
      })
      await tx.cashEntry.create({
        data: {
          businessId: input.businessId,
          accountId,
          registerDayId: session.registerDayId,
          cashSessionId: session.id,
          type: 'PAYMENT',
          direction: 'INFLOW',
          amount: productTotal,
          paymentMethod: input.paymentMethod,
          origin: 'PRODUCT_SALE',
          description: `Venta de productos · ${lines.map((line) => `${line.quantity}× ${line.productNameSnapshot}`).join(', ')}`,
          observation: optionalText(input.observation),
          productSaleId: sale.id
        }
      })
      return tx.productSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: true, cashEntry: true } })
    }, { isolationLevel: 'Serializable' })
  }

  private async normalizeProductWrite(input: { businessId: string; categoryId?: string | null; name: string; description?: string | null; sku?: string | null; salePrice: number; cost?: number | null; sortOrder?: number }) {
    const categoryId = input.categoryId?.trim() || null
    if (categoryId && !await this.prisma.productCategory.findFirst({ where: { id: categoryId, businessId: input.businessId, isActive: true }, select: { id: true } })) {
      throw new ProductSalesError('PRODUCT_CATEGORY_NOT_FOUND')
    }
    const name = normalizeName(input.name, 'INVALID_PRODUCT_NAME')
    return {
      categoryId,
      name,
      normalizedName: normalizedKey(name),
      description: optionalText(input.description),
      sku: optionalText(input.sku)?.toLocaleUpperCase('es-AR') ?? null,
      salePrice: money(input.salePrice, 'INVALID_PRODUCT_PRICE'),
      cost: input.cost === undefined || input.cost === null ? null : money(input.cost, 'INVALID_PRODUCT_COST'),
      sortOrder: normalizeSortOrder(input.sortOrder)
    }
  }

  private async mutateAppointmentProducts(input: {
    businessId: string
    appointmentId: string
    actor: ProductSaleActor
    action: 'ADD' | 'REPLACE' | 'REMOVE' | 'SET_QUANTITY'
    items: ProductItemInput[]
    productId?: string
    quantity?: number
    itemId?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      await lockProductSales(tx, input.businessId, input.appointmentId)
      const appointment = await tx.appointment.findFirst({ where: { id: input.appointmentId, businessId: input.businessId }, select: { id: true, customerId: true } })
      if (!appointment) throw new ProductSalesError('APPOINTMENT_NOT_FOUND')
      const existing = await tx.productSale.findFirst({
        where: { businessId: input.businessId, appointmentId: input.appointmentId },
        include: { lines: true }
      })
      if (existing && existing.status !== 'DRAFT') throw new ProductSalesError('PRODUCT_SALE_ALREADY_COMPLETED')
      let requested: ProductItemInput[]
      if (input.action === 'REPLACE') requested = normalizeProductItems(input.items)
      else if (input.action === 'ADD') {
        const quantity = input.quantity ?? 0
        requested = [...(existing?.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })) ?? []), { productId: input.productId ?? '', quantity }]
        requested = normalizeProductItems(requested)
      } else {
        const item = existing?.lines.find((line) => line.id === input.itemId)
        if (!item) throw new ProductSalesError('PRODUCT_SALE_ITEM_NOT_FOUND')
        requested = existing!.lines
          .filter((line) => input.action !== 'REMOVE' || line.id !== item.id)
          .map((line) => ({ productId: line.productId, quantity: line.id === item.id ? input.quantity ?? 0 : line.quantity }))
        if (requested.length) requested = normalizeProductItems(requested)
      }
      const products = requested.length ? await activeProducts(tx, input.businessId, requested.map((item) => item.productId)) : []
      const lines = requested.length ? snapshotProductLines(requested, products) : []
      return upsertAppointmentDraft(tx, {
        businessId: input.businessId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        items: lines,
        actor: input.actor,
        action: input.action
      })
    }, { isolationLevel: 'Serializable' })
  }
}

type Transaction = Prisma.TransactionClient
type SnapshotLine = ReturnType<typeof snapshotProductLines>[number]

async function activeProducts(tx: Transaction, businessId: string, productIds: string[]) {
  const products = await tx.product.findMany({
    where: { businessId, id: { in: productIds }, isActive: true },
    select: { id: true, name: true, sku: true, cost: true, salePrice: true }
  })
  if (products.length !== new Set(productIds).size) throw new ProductSalesError('PRODUCT_NOT_AVAILABLE')
  return products
}

async function upsertAppointmentDraft(tx: Transaction, input: {
  businessId: string
  appointmentId: string
  customerId: string
  items: SnapshotLine[]
  actor: ProductSaleActor
  action: string
}) {
  const account = await ensureAppointmentAccountForPayment(createCashTransactionRepository(tx), input.businessId, input.appointmentId)
  const existing = await tx.productSale.findFirst({ where: { businessId: input.businessId, appointmentId: input.appointmentId }, include: { lines: true } })
  if (existing && existing.status !== 'DRAFT') throw new ProductSalesError('PRODUCT_SALE_ALREADY_COMPLETED')
  const previousSubtotal = existing?.productSubtotal ?? 0
  const newSubtotal = sumLines(input.items)
  if (account.agreedAmount === null) throw new ProductSalesError('ESTIMATED_TOTAL_REQUIRED')
  const serviceSubtotal = account.agreedAmount - previousSubtotal
  const serviceBaseMinimum = Math.max(0, account.minimumAmount - previousSubtotal)
  const newAgreedAmount = serviceSubtotal + newSubtotal
  const newMinimumAmount = serviceBaseMinimum + newSubtotal
  const entries = await accountEntries(tx, input.businessId, account.id)
  calculateAccountTotals({ agreedAmount: newAgreedAmount, discountAmount: account.discountAmount, entries })

  const sale = existing
    ? await tx.productSale.update({
        where: { id: existing.id },
        data: {
          actorUserId: input.actor.userId,
          actorName: normalizeActorName(input.actor.name),
          serviceSubtotal,
          productSubtotal: newSubtotal,
          total: newAgreedAmount,
          lines: {
            deleteMany: {},
            create: input.items.map((line) => ({ businessId: input.businessId, ...line }))
          }
        }
      })
    : await tx.productSale.create({
        data: {
          businessId: input.businessId,
          appointmentId: input.appointmentId,
          customerId: input.customerId,
          actorUserId: input.actor.userId,
          actorName: normalizeActorName(input.actor.name),
          serviceSubtotal,
          productSubtotal: newSubtotal,
          total: newAgreedAmount,
          lines: { create: input.items.map((line) => ({ businessId: input.businessId, ...line })) }
        }
      })
  if (newAgreedAmount !== account.agreedAmount) {
    await tx.appointmentTotalAdjustment.create({
      data: {
        id: randomUUID(),
        businessId: input.businessId,
        accountId: account.id,
        actorUserId: input.actor.userId,
        actorName: normalizeActorName(input.actor.name),
        reason: 'Actualización de productos del turno',
        previousAmount: account.agreedAmount,
        newAmount: newAgreedAmount
      }
    })
  }
  await tx.appointmentAccount.update({
    where: { id: account.id },
    data: { agreedAmount: newAgreedAmount, minimumAmount: newMinimumAmount }
  })
  await tx.productSaleAudit.create({
    data: {
      businessId: input.businessId,
      saleId: sale.id,
      actorUserId: input.actor.userId,
      actorName: normalizeActorName(input.actor.name),
      action: input.action,
      previousSubtotal,
      newSubtotal,
      detail: { items: input.items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice })) }
    }
  })
  return tx.productSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, audits: { orderBy: { createdAt: 'desc' } } } })
}

async function appointmentAccountId(tx: Transaction, businessId: string, appointmentId: string) {
  const link = await tx.appointmentAccountLink.findFirst({ where: { businessId, appointmentId }, select: { accountId: true } })
  if (!link) throw new ProductSalesError('APPOINTMENT_ACCOUNT_NOT_FOUND')
  return link.accountId
}

async function accountEntries(tx: Transaction, businessId: string, accountId: string) {
  const rows = await tx.cashEntry.findMany({
    where: { businessId, accountId },
    select: { type: true, direction: true, amount: true, paymentMethod: true, reversesEntry: { select: { type: true } } }
  })
  return rows.map((entry) => ({
    type: entry.type,
    direction: entry.direction,
    amount: entry.amount,
    method: entry.paymentMethod,
    ...(entry.reversesEntry?.type ? { reversedEntryType: entry.reversesEntry.type } : {})
  }))
}

function sumLines(lines: Array<{ lineTotal: number }>) {
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  if (!Number.isSafeInteger(total) || total < 0) throw new ProductSalesError('INVALID_PRODUCT_TOTAL')
  return total
}

async function lockProductSales(tx: Transaction, businessId: string, resource: string) {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`product-sales:${businessId}:${resource}`}, 0))`)
}

function normalizeName(value: string, code: string) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 100) throw new ProductSalesError(code)
  return normalized
}
function normalizedKey(value: string) { return value.toLocaleLowerCase('es-AR') }
function optionalText(value: string | null | undefined) { return value?.trim() || null }
function money(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ProductSalesError(code)
  return value
}
function normalizeSortOrder(value?: number) {
  const result = value ?? 0
  if (!Number.isSafeInteger(result) || result < 0 || result > 10_000) throw new ProductSalesError('INVALID_PRODUCT_SORT_ORDER')
  return result
}
function normalizeIdempotencyKey(value: string) {
  const key = value?.trim()
  if (!key || key.length > 120) throw new ProductSalesError('IDEMPOTENCY_KEY_REQUIRED')
  return key
}
function normalizeActorName(value: string) {
  const name = value?.trim()
  if (!name) throw new ProductSalesError('ACTOR_REQUIRED')
  return name
}
function saleRequestFingerprint(input: {
  businessId: string
  cashSessionId: string
  customerId?: string | null
  appointmentId?: string | null
  paymentMethod: string
  discountAmount?: number
  items: ProductItemInput[]
  observation?: string | null
}) {
  const canonical = JSON.stringify({
    businessId: input.businessId,
    cashSessionId: input.cashSessionId,
    customerId: input.customerId ?? null,
    appointmentId: input.appointmentId ?? null,
    paymentMethod: input.paymentMethod,
    discountAmount: input.discountAmount ?? 0,
    items: [...input.items].sort((left, right) => left.productId.localeCompare(right.productId)),
    observation: optionalText(input.observation)
  })
  return createHash('sha256').update(canonical).digest('hex')
}
