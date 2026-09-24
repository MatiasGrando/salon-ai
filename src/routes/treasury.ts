import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'
import { assertIanaTimezone, summarizeCashRegister, type CashDomainEntry } from '../services/cash-domain.js'
import { PrismaCashRepository } from '../repositories/prisma-cash-repository.js'
import { ensureProfessionalSettlementCategory } from '../services/professional-settlement-category.js'
import { CashService, CashServiceError, normalizeCashPeriodRange } from '../services/cash-service.js'

const cashService = new CashService(new PrismaCashRepository(prisma))
const MAX_AMOUNT = 1_000_000_000
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT
}

function isAdmin(user: { role: string } | undefined): boolean {
  return !!user && ['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function scope(user: { role: string; businessId: string | null }, source?: { businessId?: string }): string | null {
  return ['ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(user.role) ? source?.businessId?.trim() || user.businessId : user.businessId
}

function balanceOf(movements: Array<{ direction: string; amount: number }>): number {
  return movements.reduce((total, item) => total + (item.direction === 'INFLOW' ? item.amount : -item.amount), 0)
}

export async function treasuryRoutes(app: FastifyInstance) {
  app.get('/treasury', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const businessId = scope(user!, request.query as { businessId?: string })
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    const accounts = await prisma.treasuryAccount.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } })
    const query = request.query as { expenseCategoryId?: string; expenseSubcategoryId?: string; kind?: string; search?: string; page?: string }
    const pagination = treasuryPage(query.page)
    if (!pagination) return reply.status(400).send({ message: 'La página solicitada es inválida' })
    const { page, pageSize, offset } = pagination
    if ((query.expenseCategoryId !== undefined && (typeof query.expenseCategoryId !== 'string' || query.expenseCategoryId.length > 200)) ||
        (query.expenseSubcategoryId !== undefined && (typeof query.expenseSubcategoryId !== 'string' || query.expenseSubcategoryId.length > 200)) ||
        (query.kind !== undefined && !['DAILY_TRANSFER', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE', 'EXPENSE', 'WITHDRAWAL'].includes(query.kind)) ||
        (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 100))) {
      return reply.status(400).send({ message: 'El filtro de gasto es inválido' })
    }
    const categoryFilter = query.expenseCategoryId?.trim() ? Prisma.sql`AND movement."expenseCategoryId" = ${query.expenseCategoryId.trim()}` : Prisma.empty
    const subcategoryFilter = query.expenseSubcategoryId?.trim() ? Prisma.sql`AND movement."expenseSubcategoryId" = ${query.expenseSubcategoryId.trim()}` : Prisma.empty
    const kindFilter = query.kind ? Prisma.sql`AND movement."kind" = ${query.kind}` : Prisma.empty
    const searchFilter = query.search?.trim() ? Prisma.sql`AND (movement."description" ILIKE ${'%' + query.search.trim() + '%'} OR movement."counterparty" ILIKE ${'%' + query.search.trim() + '%'})` : Prisma.empty
    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "total"
      FROM "TreasuryMovement" movement
      WHERE movement."businessId" = ${businessId} ${categoryFilter} ${subcategoryFilter} ${kindFilter} ${searchFilter}
    `)
    const total = Number(countRows[0]?.total ?? 0n)
    const movements = await prisma.$queryRaw<Array<{
      id: string; accountId: string; kind: string; direction: string; amount: number; description: string | null;
      counterparty: string | null; expenseCategoryId: string | null; expenseCategoryName: string | null;
      expenseSubcategoryId: string | null; expenseSubcategoryName: string | null; actorName: string; createdAt: Date
    }>>(Prisma.sql`
      SELECT movement."id", movement."accountId", movement."kind", movement."direction"::text AS "direction",
        movement."amount", movement."description", movement."counterparty", movement."expenseCategoryId",
        category."name" AS "expenseCategoryName", movement."expenseSubcategoryId",
        subcategory."name" AS "expenseSubcategoryName", movement."actorName", movement."createdAt"
      FROM "TreasuryMovement" movement
      LEFT JOIN "CashExpenseCategory" category
        ON category."businessId" = movement."businessId" AND category."id" = movement."expenseCategoryId"
      LEFT JOIN "CashExpenseSubcategory" subcategory
        ON subcategory."businessId" = movement."businessId" AND subcategory."categoryId" = movement."expenseCategoryId" AND subcategory."id" = movement."expenseSubcategoryId"
      WHERE movement."businessId" = ${businessId} ${categoryFilter} ${subcategoryFilter} ${kindFilter} ${searchFilter}
      ORDER BY movement."createdAt" DESC, movement."id" DESC LIMIT ${pageSize} OFFSET ${offset}
    `)
    const totals = await prisma.treasuryMovement.groupBy({
      by: ['accountId', 'direction'], where: { businessId }, _sum: { amount: true }
    })
    return {
      accounts: accounts.map((account) => ({
        id: account.id, method: account.method,
        balance: balanceOf(totals.filter((row) => row.accountId === account.id).map((row) => ({ direction: row.direction, amount: row._sum.amount || 0 })))
      })),
      movements,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  })

  app.get('/treasury/consolidated', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'El resultado global está reservado a administración' })
    const query = request.query as { businessId?: string; from?: string; to?: string }
    const businessId = scope(user!, query)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (typeof query.from !== 'string' || typeof query.to !== 'string') return reply.status(400).send({ message: 'Elegí un período válido' })
    try {
      const period = normalizeCashPeriodRange(query.from, query.to)
      const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
      const timezone = assertIanaTimezone(business?.timezone)
      const [cash, treasury] = await Promise.all([
        cashService.getCashPeriodSummary({ businessId, from: period.from, to: period.to }),
        prisma.$queryRaw<Array<{ amount: bigint }>>(Prisma.sql`
          SELECT COALESCE(SUM("amount"), 0)::bigint AS "amount"
          FROM "TreasuryMovement"
          WHERE "businessId" = ${businessId} AND "direction" = 'OUTFLOW'::"CashDirection"
            AND "kind" IN ('EXPENSE', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE')
            AND "createdAt" >= (${period.from}::date::timestamp AT TIME ZONE ${timezone})
            AND "createdAt" < ((${period.to}::date + 1)::timestamp AT TIME ZONE ${timezone})
        `)
      ])
      const outgoingTreasury = Number(treasury[0]?.amount ?? 0n)
      if (!Number.isSafeInteger(outgoingTreasury)) throw new Error('UNSAFE_TREASURY_TOTAL')
      return { period, summary: consolidateCashAndTreasury(cash.summary, outgoingTreasury) }
    } catch (error) {
      if (error instanceof CashServiceError && ['INVALID_CASH_PERIOD', 'CASH_PERIOD_TOO_LONG'].includes(error.code)) {
        return reply.status(400).send({ message: 'Elegí hasta 31 días válidos' })
      }
      request.log.error({ err: error }, 'treasury_consolidated_failed')
      return reply.status(500).send({ message: 'No pudimos calcular el resultado global' })
    }
  })

  app.post('/treasury/enable-cash', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const businessId = scope(user!, request.body as { businessId?: string })
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    return prisma.treasuryAccount.upsert({
      where: { businessId_method: { businessId, method: 'CASH' } },
      create: { businessId, method: 'CASH' },
      update: {},
      select: { id: true, method: true }
    })
  })

  app.post('/treasury/from-daily', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const body = (request.body || {}) as { businessId?: string; cashSessionId?: string; amount?: number; idempotencyKey?: string }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (!body.cashSessionId || !validAmount(body.amount) || !KEY.test(body.idempotencyKey || '')) {
      return reply.status(400).send({ message: 'Indicá sesión, importe válido e identificador de operación' })
    }
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${businessId} FOR UPDATE`)
        const existing = await tx.treasuryMovement.findUnique({ where: { id: body.idempotencyKey! }, include: { cashEntry: { select: { cashSessionId: true } } } })
        if (existing) {
          if (existing.businessId !== businessId || existing.kind !== 'DAILY_TRANSFER' || existing.amount !== body.amount || existing.cashEntry?.cashSessionId !== body.cashSessionId) throw new Error('KEY_CONFLICT')
          return { id: existing.id, amount: existing.amount }
        }
        const account = await tx.treasuryAccount.findUnique({ where: { businessId_method: { businessId, method: 'CASH' } } })
        if (!account) throw new Error('TREASURY_NOT_ENABLED')
        const sessions = await tx.$queryRaw<Array<{ id: string; registerDayId: string; openingCash: number }>>(Prisma.sql`
          SELECT session."id", session."registerDayId", day."openingCash"
          FROM "CashSession" session
          JOIN "CashRegisterDay" day ON day."id" = session."registerDayId" AND day."businessId" = session."businessId"
          WHERE session."businessId" = ${businessId} AND session."id" = ${body.cashSessionId}
            AND session."closedAt" IS NULL AND day."closedAt" IS NULL
          FOR UPDATE OF session, day
        `)
        const session = sessions[0]
        if (!session) throw new Error('CASH_CLOSED')
        const entries = await tx.cashEntry.findMany({
          where: { businessId, registerDayId: session.registerDayId },
          select: { type: true, direction: true, amount: true, paymentMethod: true, reversesEntry: { select: { type: true } } }
        })
        const expected = summarizeCashRegister({
          openingCash: session.openingCash,
          entries: entries.map((entry): CashDomainEntry => ({
            type: entry.type, direction: entry.direction, amount: entry.amount,
            method: entry.paymentMethod, ...(entry.reversesEntry ? { reversedEntryType: entry.reversesEntry.type } : {})
          }))
        }).expectedCash
        if (body.amount! > expected) throw new Error('INSUFFICIENT_CASH')
        const cashEntryId = randomUUID()
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "CashEntry" ("id", "businessId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin", "description", "counterparty", "effectiveAt")
          VALUES (${cashEntryId}, ${businessId}, ${session.registerDayId}, ${session.id}, 'WITHDRAWAL'::"CashEntryType", 'OUTFLOW'::"CashDirection", ${body.amount}, 'CASH'::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin", 'Traspaso interno a Tesorería', 'Tesorería', clock_timestamp())
        `)
        const movement = await tx.treasuryMovement.create({
          data: {
            id: body.idempotencyKey!, businessId, accountId: account.id, kind: 'DAILY_TRANSFER',
            direction: 'INFLOW', amount: body.amount!, description: 'Desde Caja diaria',
            actorUserId: user!.id, actorName: user!.name, cashEntryId
          }
        })
        return { id: movement.id, amount: movement.amount }
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_NOT_ENABLED') return reply.status(409).send({ message: 'Habilitá Tesorería antes de transferir' })
      if (code === 'CASH_CLOSED') return reply.status(409).send({ message: 'La sesión de Caja ya no está abierta' })
      if (code === 'INSUFFICIENT_CASH') return reply.status(409).send({ message: 'El importe supera el efectivo esperado de Caja' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_transfer_failed')
      return reply.status(500).send({ message: 'No pudimos transferir el efectivo' })
    }
  })

  app.post('/treasury/pay-professional', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Solo administración puede pagar desde Tesorería' })
    const body = (request.body || {}) as { businessId?: string; professionalId?: string; type?: 'PAYMENT' | 'ADVANCE'; amount?: number; observation?: string; idempotencyKey?: string }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (typeof body.professionalId !== 'string' || !body.professionalId.trim() || !['PAYMENT', 'ADVANCE'].includes(body.type || '') || !validAmount(body.amount) || !KEY.test(body.idempotencyKey || '') || (body.observation !== undefined && (typeof body.observation !== 'string' || body.observation.trim().length > 160))) {
      return reply.status(400).send({ message: 'Indicá profesional, tipo, importe e identificador válidos' })
    }
    try {
      return await prisma.$transaction((tx) => recordTreasuryProfessionalPayment(tx, {
        businessId, professionalId: body.professionalId!.trim(), type: body.type!, amount: body.amount!,
        observation: body.observation?.trim() || null, idempotencyKey: body.idempotencyKey!,
        actorUserId: user!.id, actorName: user!.name
      }))
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_NOT_ENABLED') return reply.status(409).send({ message: 'Habilitá la reserva de efectivo antes de pagar' })
      if (code === 'INSUFFICIENT_TREASURY') return reply.status(409).send({ message: 'El pago supera el saldo de Tesorería' })
      if (code === 'PROFESSIONAL_NOT_FOUND') return reply.status(404).send({ message: 'El profesional no existe en este local' })
      if (code === 'LIQUIDATION_CATEGORY_INACTIVE') return reply.status(409).send({ message: 'Activá la categoría Liquidaciones profesionales antes de pagar' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_professional_payment_failed')
      return reply.status(500).send({ message: 'No pudimos registrar el pago desde Tesorería' })
    }
  })

  app.post('/treasury/outflow', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const body = (request.body || {}) as {
      businessId?: string; amount?: number; kind?: 'EXPENSE' | 'WITHDRAWAL'; description?: string;
      counterparty?: string; expenseCategoryId?: string; expenseSubcategoryId?: string; idempotencyKey?: string
    }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const counterparty = typeof body.counterparty === 'string' ? body.counterparty.trim() || null : null
    const expenseCategoryId = typeof body.expenseCategoryId === 'string' ? body.expenseCategoryId.trim() || null : null
    const expenseSubcategoryId = typeof body.expenseSubcategoryId === 'string' ? body.expenseSubcategoryId.trim() || null : null
    if (!validAmount(body.amount) || !['EXPENSE', 'WITHDRAWAL'].includes(body.kind || '') || !description || description.length > 160 ||
        !KEY.test(body.idempotencyKey || '') || (body.counterparty !== undefined && (typeof body.counterparty !== 'string' || body.counterparty.trim().length > 100)) ||
        (body.expenseCategoryId !== undefined && (typeof body.expenseCategoryId !== 'string' || body.expenseCategoryId.length > 200)) ||
        (body.expenseSubcategoryId !== undefined && (typeof body.expenseSubcategoryId !== 'string' || body.expenseSubcategoryId.length > 200)) ||
        (expenseSubcategoryId && !expenseCategoryId) || (body.kind === 'WITHDRAWAL' && (counterparty || expenseCategoryId || expenseSubcategoryId))) {
      return reply.status(400).send({ message: 'Indicá tipo, detalle, importe y clasificación válidos' })
    }
    try {
      return await prisma.$transaction((tx) => recordTreasuryOutflow(tx, {
        businessId, kind: body.kind!, amount: body.amount!, description, counterparty, expenseCategoryId,
        expenseSubcategoryId, idempotencyKey: body.idempotencyKey!, actorUserId: user!.id, actorName: user!.name
      }))
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_NOT_ENABLED') return reply.status(409).send({ message: 'Habilitá Tesorería antes de registrar movimientos' })
      if (code === 'INSUFFICIENT_TREASURY') return reply.status(409).send({ message: 'El importe supera el saldo de Tesorería' })
      if (code === 'EXPENSE_CATEGORY_INVALID') return reply.status(400).send({ message: 'La categoría del gasto no existe o está inactiva' })
      if (code === 'EXPENSE_SUBCATEGORY_INVALID') return reply.status(400).send({ message: 'La subcategoría no pertenece a la categoría o está inactiva' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_outflow_failed')
      return reply.status(500).send({ message: 'No pudimos registrar la salida' })
    }
  })
}

export async function recordTreasuryProfessionalPayment(tx: Prisma.TransactionClient, input: {
  businessId: string
  professionalId: string
  type: 'PAYMENT' | 'ADVANCE'
  amount: number
  observation: string | null
  idempotencyKey: string
  actorUserId: string
  actorName: string
}) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${input.businessId} FOR UPDATE`)
  const existing = await tx.$queryRaw<Array<{
    id: string; businessId: string; kind: string; amount: number; entryId: string | null;
    professionalId: string | null; entryType: string | null; observation: string | null
  }>>(Prisma.sql`
    SELECT movement."id", movement."businessId", movement."kind", movement."amount", entry."id" AS "entryId",
      entry."professionalId", entry."type"::text AS "entryType", entry."description" AS "observation"
    FROM "TreasuryMovement" movement
    LEFT JOIN "ProfessionalAccountEntry" entry
      ON entry."businessId" = movement."businessId" AND entry."treasuryMovementId" = movement."id"
    WHERE movement."id" = ${input.idempotencyKey}
  `)
  const kind = input.type === 'ADVANCE' ? 'PROFESSIONAL_ADVANCE' : 'PROFESSIONAL_PAYMENT'
  if (existing[0]) {
    const row = existing[0]
    if (row.businessId !== input.businessId || row.kind !== kind || row.amount !== input.amount || row.professionalId !== input.professionalId || row.entryType !== input.type || row.observation !== input.observation || !row.entryId) throw new Error('KEY_CONFLICT')
    return { id: row.entryId, treasuryMovementId: row.id, amount: row.amount }
  }
  const accounts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "TreasuryAccount" WHERE "businessId" = ${input.businessId} AND "method" = 'CASH' FOR KEY SHARE
  `)
  const account = accounts[0]
  if (!account) throw new Error('TREASURY_NOT_ENABLED')
  const totals = await tx.$queryRaw<Array<{ balance: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM(CASE WHEN "direction" = 'INFLOW'::"CashDirection" THEN "amount" ELSE -"amount" END), 0)::bigint AS "balance"
    FROM "TreasuryMovement" WHERE "businessId" = ${input.businessId} AND "accountId" = ${account.id}
  `)
  if (BigInt(input.amount) > BigInt(totals[0]?.balance ?? 0)) throw new Error('INSUFFICIENT_TREASURY')
  const professionals = await tx.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT "name" FROM "Professional" WHERE "businessId" = ${input.businessId} AND "id" = ${input.professionalId} FOR KEY SHARE
  `)
  if (!professionals[0]) throw new Error('PROFESSIONAL_NOT_FOUND')
  const categoryId = await ensureProfessionalSettlementCategory(tx, input.businessId)
  const entryId = randomUUID()
  const description = input.type === 'ADVANCE' ? 'Adelanto a profesional: ' : 'Pago a profesional: '
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "TreasuryMovement" ("id", "businessId", "accountId", "kind", "direction", "amount", "description", "expenseCategoryId", "actorUserId", "actorName")
    VALUES (${input.idempotencyKey}, ${input.businessId}, ${account.id}, ${kind}, 'OUTFLOW'::"CashDirection", ${input.amount}, ${description + professionals[0].name}, ${categoryId}, ${input.actorUserId}, ${input.actorName})
  `)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ProfessionalAccountEntry" ("id", "businessId", "professionalId", "treasuryMovementId", "type", "direction", "amount", "description", "actorUserId", "actorName", "effectiveAt")
    VALUES (${entryId}, ${input.businessId}, ${input.professionalId}, ${input.idempotencyKey}, ${input.type}::"ProfessionalAccountEntryType", 'DEBIT'::"ProfessionalAccountDirection", ${input.amount}, ${input.observation}, ${input.actorUserId}, ${input.actorName}, clock_timestamp())
  `)
  return { id: entryId, treasuryMovementId: input.idempotencyKey, amount: input.amount }
}

export async function recordTreasuryOutflow(tx: Prisma.TransactionClient, input: {
  businessId: string
  kind: 'EXPENSE' | 'WITHDRAWAL'
  amount: number
  description: string
  counterparty: string | null
  expenseCategoryId: string | null
  expenseSubcategoryId: string | null
  idempotencyKey: string
  actorUserId: string
  actorName: string
}) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${input.businessId} FOR UPDATE`)
  const existing = await tx.$queryRaw<Array<{
    id: string; businessId: string; kind: string; amount: number; description: string | null;
    counterparty: string | null; expenseCategoryId: string | null; expenseSubcategoryId: string | null
  }>>(Prisma.sql`
    SELECT "id", "businessId", "kind", "amount", "description", "counterparty", "expenseCategoryId", "expenseSubcategoryId"
    FROM "TreasuryMovement" WHERE "id" = ${input.idempotencyKey}
  `)
  if (existing[0]) {
    const row = existing[0]
    if (row.businessId !== input.businessId || row.kind !== input.kind || row.amount !== input.amount ||
        row.description !== input.description || row.counterparty !== input.counterparty ||
        row.expenseCategoryId !== input.expenseCategoryId || row.expenseSubcategoryId !== input.expenseSubcategoryId) throw new Error('KEY_CONFLICT')
    return { id: row.id, amount: row.amount }
  }
  const account = await tx.treasuryAccount.findUnique({ where: { businessId_method: { businessId: input.businessId, method: 'CASH' } } })
  if (!account) throw new Error('TREASURY_NOT_ENABLED')
  const totals = await tx.treasuryMovement.groupBy({ by: ['direction'], where: { businessId: input.businessId, accountId: account.id }, _sum: { amount: true } })
  if (input.amount > balanceOf(totals.map((row) => ({ direction: row.direction, amount: row._sum.amount || 0 })))) throw new Error('INSUFFICIENT_TREASURY')
  if (input.expenseCategoryId) {
    const categories = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CashExpenseCategory" WHERE "businessId" = ${input.businessId} AND "id" = ${input.expenseCategoryId} AND "isActive" = true FOR KEY SHARE
    `)
    if (!categories[0]) throw new Error('EXPENSE_CATEGORY_INVALID')
  }
  if (input.expenseSubcategoryId) {
    const subcategories = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CashExpenseSubcategory" WHERE "businessId" = ${input.businessId} AND "categoryId" = ${input.expenseCategoryId} AND "id" = ${input.expenseSubcategoryId} AND "isActive" = true FOR KEY SHARE
    `)
    if (!subcategories[0]) throw new Error('EXPENSE_SUBCATEGORY_INVALID')
  }
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "TreasuryMovement" ("id", "businessId", "accountId", "kind", "direction", "amount", "description", "counterparty", "expenseCategoryId", "expenseSubcategoryId", "actorUserId", "actorName")
    VALUES (${input.idempotencyKey}, ${input.businessId}, ${account.id}, ${input.kind}, 'OUTFLOW'::"CashDirection", ${input.amount}, ${input.description}, ${input.counterparty}, ${input.expenseCategoryId}, ${input.expenseSubcategoryId}, ${input.actorUserId}, ${input.actorName})
  `)
  return { id: input.idempotencyKey, amount: input.amount }
}

export function consolidateCashAndTreasury(cash: {
  grossCollected: number
  refunds: number
  expenses: number
  collectedByMethod: { CASH: number; TRANSFER: number; CARD: number }
  outgoingByMethod: { CASH: number; TRANSFER: number; CARD: number; UNSPECIFIED: number }
}, outgoingTreasury: number) {
  const collectedByMethod = {
    ...cash.collectedByMethod,
    UNSPECIFIED: cash.grossCollected - cash.collectedByMethod.CASH - cash.collectedByMethod.TRANSFER - cash.collectedByMethod.CARD
  }
  const outgoingByMethod = {
    ...cash.outgoingByMethod,
    CASH: cash.outgoingByMethod.CASH + outgoingTreasury
  }
  return {
    collected: cash.grossCollected,
    outgoingCash: cash.expenses + cash.refunds,
    outgoingTreasury,
    outgoing: cash.expenses + cash.refunds + outgoingTreasury,
    total: cash.grossCollected - cash.expenses - cash.refunds - outgoingTreasury,
    collectedByMethod,
    outgoingByMethod,
    totalByMethod: {
      CASH: collectedByMethod.CASH - outgoingByMethod.CASH,
      TRANSFER: collectedByMethod.TRANSFER - outgoingByMethod.TRANSFER,
      CARD: collectedByMethod.CARD - outgoingByMethod.CARD,
      UNSPECIFIED: collectedByMethod.UNSPECIFIED - outgoingByMethod.UNSPECIFIED
    }
  }
}


export function treasuryPage(value: unknown): { page: number; pageSize: number; offset: number } | null {
  if (value !== undefined && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) return null
  const page = value === undefined ? 1 : Number(value)
  if (!Number.isSafeInteger(page) || page > 10_000) return null
  const pageSize = 20
  return { page, pageSize, offset: (page - 1) * pageSize }
}
