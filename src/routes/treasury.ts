import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'
import { assertIanaTimezone, summarizeCashRegister, type CashDomainEntry } from '../services/cash-domain.js'
import { PrismaCashRepository } from '../repositories/prisma-cash-repository.js'
import { ensureProfessionalSettlementCategory } from '../services/professional-settlement-category.js'
import { CashService, CashServiceError, normalizeCashPeriodRange } from '../services/cash-service.js'
import { financialCorrectionDirections, isFinancialEffectiveDate, resolveFinancialEffectiveAt } from '../services/financial-effective-date.js'

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

function normalizeCatalogName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR')
}

function validCatalogName(value: unknown, max = 80): value is string {
  return typeof value === 'string' && value.trim().replace(/\s+/g, ' ').length >= 2 && value.trim().replace(/\s+/g, ' ').length <= max
}

export async function treasuryRoutes(app: FastifyInstance) {
  app.get('/treasury', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const businessId = scope(user!, request.query as { businessId?: string })
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    const accounts = await prisma.$queryRaw<Array<{ id: string; paymentMethodId: string | null; name: string; kind: string; isActive: boolean; movementBalance: bigint; entryBalance: bigint }>>(Prisma.sql`
      SELECT account."id", account."paymentMethodId", COALESCE(method."name", account."method") AS "name",
        COALESCE(method."kind"::text, 'CASH') AS "kind", COALESCE(method."isActive", true) AS "isActive",
        COALESCE((SELECT SUM(CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END)
          FROM "TreasuryMovement" movement WHERE movement."businessId" = account."businessId" AND movement."accountId" = account."id"), 0)::bigint AS "movementBalance",
        CASE WHEN COALESCE(method."kind"::text, 'CASH') = 'CASH' THEN 0::bigint ELSE COALESCE((SELECT SUM(CASE WHEN entry."direction" = 'INFLOW'::"CashDirection" THEN entry."amount" ELSE -entry."amount" END)
          FROM "CashEntry" entry WHERE entry."businessId" = account."businessId" AND entry."businessPaymentMethodId" = account."paymentMethodId"), 0)::bigint END AS "entryBalance"
      FROM "TreasuryAccount" account
      LEFT JOIN "BusinessPaymentMethod" method ON method."businessId" = account."businessId" AND method."id" = account."paymentMethodId"
      WHERE account."businessId" = ${businessId}
      ORDER BY method."position" NULLS FIRST, account."createdAt", account."id"
    `)
    const counterparties = await prisma.$queryRaw<Array<{ id: string; name: string; isActive: boolean }>>(Prisma.sql`
      SELECT "id", "name", "isActive" FROM "TreasuryCounterparty"
      WHERE "businessId" = ${businessId} ORDER BY "isActive" DESC, "name", "id"
    `)
    const query = request.query as { expenseCategoryId?: string; expenseSubcategoryId?: string; kind?: string; search?: string; page?: string }
    const pagination = treasuryPage(query.page)
    if (!pagination) return reply.status(400).send({ message: 'La página solicitada es inválida' })
    const { page, pageSize, offset } = pagination
    if ((query.expenseCategoryId !== undefined && (typeof query.expenseCategoryId !== 'string' || query.expenseCategoryId.length > 200)) ||
        (query.expenseSubcategoryId !== undefined && (typeof query.expenseSubcategoryId !== 'string' || query.expenseSubcategoryId.length > 200)) ||
        (query.kind !== undefined && !['DAILY_TRANSFER', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE', 'INCOME', 'EXPENSE', 'WITHDRAWAL'].includes(query.kind)) ||
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
      counterparty: string | null; counterpartyId: string | null; accountName: string; expenseCategoryId: string | null; expenseCategoryName: string | null;
      expenseSubcategoryId: string | null; expenseSubcategoryName: string | null; actorName: string; effectiveAt: Date; createdAt: Date;
      correctionSourceId: string | null; correctionRole: string | null; correctionReason: string | null; dateCorrected: boolean
    }>>(Prisma.sql`
      SELECT movement."id", movement."accountId", movement."kind", movement."direction"::text AS "direction",
        movement."amount", movement."description", movement."counterparty", movement."counterpartyId",
        COALESCE(method."name", account."method") AS "accountName", movement."expenseCategoryId",
        category."name" AS "expenseCategoryName", movement."expenseSubcategoryId",
        subcategory."name" AS "expenseSubcategoryName", movement."actorName", movement."effectiveAt", movement."createdAt",
        movement."correctionSourceId", movement."correctionRole", movement."correctionReason",
        EXISTS (SELECT 1 FROM "TreasuryMovement" correction WHERE correction."businessId" = movement."businessId" AND correction."correctionSourceId" = movement."id") AS "dateCorrected"
      FROM "TreasuryMovement" movement
      JOIN "TreasuryAccount" account ON account."businessId" = movement."businessId" AND account."id" = movement."accountId"
      LEFT JOIN "BusinessPaymentMethod" method ON method."businessId" = account."businessId" AND method."id" = account."paymentMethodId"
      LEFT JOIN "CashExpenseCategory" category
        ON category."businessId" = movement."businessId" AND category."id" = movement."expenseCategoryId"
      LEFT JOIN "CashExpenseSubcategory" subcategory
        ON subcategory."businessId" = movement."businessId" AND subcategory."categoryId" = movement."expenseCategoryId" AND subcategory."id" = movement."expenseSubcategoryId"
      WHERE movement."businessId" = ${businessId} ${categoryFilter} ${subcategoryFilter} ${kindFilter} ${searchFilter}
      ORDER BY movement."effectiveAt" DESC, movement."id" DESC LIMIT ${pageSize} OFFSET ${offset}
    `)
    return {
      accounts: accounts.map((account) => ({
        id: account.id, paymentMethodId: account.paymentMethodId, name: account.name, kind: account.kind, isActive: account.isActive,
        balance: Number(account.movementBalance) + Number(account.entryBalance)
      })),
      counterparties,
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
        prisma.$queryRaw<Array<{
          incomingCash: bigint; incomingTransfer: bigint; incomingCard: bigint; incomingUnspecified: bigint;
          outgoingCash: bigint; outgoingTransfer: bigint; outgoingCard: bigint; outgoingUnspecified: bigint
        }>>(Prisma.sql`
          SELECT
            COALESCE(SUM(CASE WHEN movement."kind" = 'INCOME' AND method."kind" = 'CASH'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "incomingCash",
            COALESCE(SUM(CASE WHEN movement."kind" = 'INCOME' AND method."kind" = 'TRANSFER'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "incomingTransfer",
            COALESCE(SUM(CASE WHEN movement."kind" = 'INCOME' AND method."kind" = 'CARD'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "incomingCard",
            COALESCE(SUM(CASE WHEN movement."kind" = 'INCOME' AND method."kind" IS NULL THEN CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "incomingUnspecified",
            COALESCE(SUM(CASE WHEN movement."kind" IN ('EXPENSE', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE') AND method."kind" = 'CASH'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'OUTFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "outgoingCash",
            COALESCE(SUM(CASE WHEN movement."kind" IN ('EXPENSE', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE') AND method."kind" = 'TRANSFER'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'OUTFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "outgoingTransfer",
            COALESCE(SUM(CASE WHEN movement."kind" IN ('EXPENSE', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE') AND method."kind" = 'CARD'::"CashPaymentMethod" THEN CASE WHEN movement."direction" = 'OUTFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "outgoingCard",
            COALESCE(SUM(CASE WHEN movement."kind" IN ('EXPENSE', 'PROFESSIONAL_PAYMENT', 'PROFESSIONAL_ADVANCE') AND method."kind" IS NULL THEN CASE WHEN movement."direction" = 'OUTFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END ELSE 0 END), 0)::bigint AS "outgoingUnspecified"
          FROM "TreasuryMovement" movement
          JOIN "TreasuryAccount" account ON account."businessId" = movement."businessId" AND account."id" = movement."accountId"
          LEFT JOIN "BusinessPaymentMethod" method ON method."businessId" = account."businessId" AND method."id" = account."paymentMethodId"
          WHERE movement."businessId" = ${businessId}
            AND movement."effectiveAt" >= (${period.from}::date::timestamp AT TIME ZONE ${timezone})
            AND movement."effectiveAt" < ((${period.to}::date + 1)::timestamp AT TIME ZONE ${timezone})
        `)
      ])
      const totals = treasury[0]
      const incomingTreasuryByMethod = {
        CASH: Number(totals?.incomingCash ?? 0n),
        TRANSFER: Number(totals?.incomingTransfer ?? 0n),
        CARD: Number(totals?.incomingCard ?? 0n),
        UNSPECIFIED: Number(totals?.incomingUnspecified ?? 0n)
      }
      const outgoingTreasuryByMethod = {
        CASH: Number(totals?.outgoingCash ?? 0n),
        TRANSFER: Number(totals?.outgoingTransfer ?? 0n),
        CARD: Number(totals?.outgoingCard ?? 0n),
        UNSPECIFIED: Number(totals?.outgoingUnspecified ?? 0n)
      }
      if (![...Object.values(incomingTreasuryByMethod), ...Object.values(outgoingTreasuryByMethod)].every(Number.isSafeInteger)) {
        throw new Error('UNSAFE_TREASURY_TOTAL')
      }
      return { period, summary: consolidateCashAndTreasury(cash.summary, outgoingTreasuryByMethod, incomingTreasuryByMethod) }
    } catch (error) {
      if (error instanceof CashServiceError && ['INVALID_CASH_PERIOD', 'CASH_PERIOD_TOO_LONG'].includes(error.code)) {
        return reply.status(400).send({ message: 'Elegí hasta 31 días válidos' })
      }
      request.log.error({ err: error }, 'treasury_consolidated_failed')
      return reply.status(500).send({ message: 'No pudimos calcular el resultado global' })
    }
  })

  app.get('/treasury/payment-methods', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const businessId = scope(user!, request.query as { businessId?: string })
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    return prisma.$queryRaw(Prisma.sql`
      SELECT method."id", method."name", method."kind"::text AS "kind", method."position", method."isDefault", method."isActive", account."id" AS "accountId"
      FROM "BusinessPaymentMethod" method
      JOIN "TreasuryAccount" account ON account."businessId" = method."businessId" AND account."paymentMethodId" = method."id"
      WHERE method."businessId" = ${businessId}
      ORDER BY method."position", method."name", method."id"
    `)
  })

  app.post('/treasury/payment-methods', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const body = (request.body || {}) as { businessId?: string; name?: string; kind?: string; position?: number }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (!validCatalogName(body.name) || !['TRANSFER', 'CARD'].includes(body.kind || '') || (body.position !== undefined && (!Number.isInteger(body.position) || body.position < 0 || body.position > 10000))) {
      return reply.status(400).send({ message: 'Indicá nombre, tipo y orden válidos' })
    }
    const id = randomUUID()
    const name = body.name!.trim().replace(/\s+/g, ' ')
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "BusinessPaymentMethod" ("id", "businessId", "name", "normalizedName", "kind", "position", "isDefault", "isActive", "updatedAt")
          VALUES (${id}, ${businessId}, ${name}, ${normalizeCatalogName(name)}, ${body.kind}::"CashPaymentMethod", ${body.position ?? 100}, false, true, clock_timestamp())
        `)
        const accountId = randomUUID()
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "TreasuryAccount" ("id", "businessId", "method", "paymentMethodId") VALUES (${accountId}, ${businessId}, ${id}, ${id})
        `)
        return { id, accountId, name, kind: body.kind, position: body.position ?? 100, isDefault: false, isActive: true }
      })
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') return reply.status(409).send({ message: 'Ya existe un medio de pago con ese nombre' })
      request.log.error({ err: error }, 'treasury_payment_method_create_failed')
      return reply.status(500).send({ message: 'No pudimos crear el medio de pago' })
    }
  })

  app.patch('/treasury/payment-methods/:id', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const params = request.params as { id?: string }
    const body = (request.body || {}) as { businessId?: string; name?: string; position?: number; isActive?: boolean }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (!params.id?.trim() || !validCatalogName(body.name) || (body.position !== undefined && (!Number.isInteger(body.position) || body.position < 0 || body.position > 10000)) || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) {
      return reply.status(400).send({ message: 'Revisá los datos del medio de pago' })
    }
    const name = body.name!.trim().replace(/\s+/g, ' ')
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; name: string; kind: string; position: number; isDefault: boolean; isActive: boolean }>>(Prisma.sql`
        UPDATE "BusinessPaymentMethod" SET "name" = ${name}, "normalizedName" = ${normalizeCatalogName(name)},
          "position" = COALESCE(${body.position ?? null}, "position"), "isActive" = COALESCE(${body.isActive ?? null}, "isActive"), "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${businessId} AND "id" = ${params.id.trim()}
        RETURNING "id", "name", "kind"::text AS "kind", "position", "isDefault", "isActive"
      `)
      if (!rows[0]) return reply.status(404).send({ message: 'Medio de pago no encontrado' })
      return rows[0]
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') return reply.status(409).send({ message: 'Ya existe un medio de pago con ese nombre' })
      request.log.error({ err: error }, 'treasury_payment_method_update_failed')
      return reply.status(500).send({ message: 'No pudimos actualizar el medio de pago' })
    }
  })

  app.post('/treasury/counterparties', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const body = (request.body || {}) as { businessId?: string; name?: string }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (!validCatalogName(body.name, 100)) return reply.status(400).send({ message: 'Ingresá un destinatario válido' })
    const id = randomUUID()
    const name = body.name!.trim().replace(/\s+/g, ' ')
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; name: string; isActive: boolean }>>(Prisma.sql`
        INSERT INTO "TreasuryCounterparty" ("id", "businessId", "name", "normalizedName", "isActive", "updatedAt")
        VALUES (${id}, ${businessId}, ${name}, ${normalizeCatalogName(name)}, true, clock_timestamp())
        RETURNING "id", "name", "isActive"
      `)
      return rows[0]
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') return reply.status(409).send({ message: 'Ese destinatario ya existe' })
      request.log.error({ err: error }, 'treasury_counterparty_create_failed')
      return reply.status(500).send({ message: 'No pudimos crear el destinatario' })
    }
  })

  app.post('/treasury/enable-cash', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const businessId = scope(user!, request.body as { businessId?: string })
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${businessId} FOR UPDATE`)
      const templates = [
        { id: `pm_cash_${businessId}`, name: 'Efectivo', normalizedName: 'efectivo', kind: 'CASH', position: 10 },
        { id: `pm_transfer_${businessId}`, name: 'Mercado Pago', normalizedName: 'mercado pago', kind: 'TRANSFER', position: 20 },
        { id: `pm_card_${businessId}`, name: 'Tarjeta', normalizedName: 'tarjeta', kind: 'CARD', position: 30 }
      ]
      for (const template of templates) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "BusinessPaymentMethod" ("id", "businessId", "name", "normalizedName", "kind", "position", "isDefault", "isActive", "updatedAt")
          SELECT ${template.id}, ${businessId}, ${template.name}, ${template.normalizedName}, ${template.kind}::"CashPaymentMethod", ${template.position}, true, true, clock_timestamp()
          WHERE NOT EXISTS (
            SELECT 1 FROM "BusinessPaymentMethod" method
            WHERE method."businessId" = ${businessId} AND method."kind" = ${template.kind}::"CashPaymentMethod" AND method."isDefault" = true
          )
        `)
        const methods = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "BusinessPaymentMethod"
          WHERE "businessId" = ${businessId} AND "kind" = ${template.kind}::"CashPaymentMethod" AND "isDefault" = true
        `)
        const methodId = methods[0]!.id
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "TreasuryAccount" ("id", "businessId", "method", "paymentMethodId")
          VALUES (${randomUUID()}, ${businessId}, ${template.kind === 'CASH' ? 'CASH' : methodId}, ${methodId})
          ON CONFLICT ("businessId", "paymentMethodId") DO NOTHING
        `)
      }
      const rows = await tx.$queryRaw<Array<{ id: string; method: string }>>(Prisma.sql`
        SELECT account."id", account."method" FROM "TreasuryAccount" account
        JOIN "BusinessPaymentMethod" method ON method."businessId" = account."businessId" AND method."id" = account."paymentMethodId"
        WHERE account."businessId" = ${businessId} AND method."kind" = 'CASH'::"CashPaymentMethod" AND method."isDefault" = true
      `)
      return rows[0]
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
      if (code === 'FINANCIAL_EFFECTIVE_DATE_FUTURE') return reply.status(400).send({ message: 'La fecha no puede ser futura' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_transfer_failed')
      return reply.status(500).send({ message: 'No pudimos transferir el efectivo' })
    }
  })

  app.post('/treasury/pay-professional', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Solo administración puede pagar desde Tesorería' })
    const body = (request.body || {}) as { businessId?: string; professionalId?: string; type?: 'PAYMENT' | 'ADVANCE'; amount?: number; observation?: string; effectiveDate?: string; idempotencyKey?: string }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (typeof body.professionalId !== 'string' || !body.professionalId.trim() || !['PAYMENT', 'ADVANCE'].includes(body.type || '') || !validAmount(body.amount) || !isFinancialEffectiveDate(body.effectiveDate) || !KEY.test(body.idempotencyKey || '') || (body.observation !== undefined && (typeof body.observation !== 'string' || body.observation.trim().length > 160))) {
      return reply.status(400).send({ message: 'Indicá profesional, tipo, importe e identificador válidos' })
    }
    try {
      return await prisma.$transaction(async (tx) => {
        const effectiveAt = await resolveFinancialEffectiveAt(tx, businessId, body.effectiveDate!)
        return recordTreasuryProfessionalPayment(tx, {
          businessId, professionalId: body.professionalId!.trim(), type: body.type!, amount: body.amount!,
          observation: body.observation?.trim() || null, effectiveAt, effectiveDate: body.effectiveDate!, idempotencyKey: body.idempotencyKey!,
          actorUserId: user!.id, actorName: user!.name
        })
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_NOT_ENABLED') return reply.status(409).send({ message: 'Habilitá la reserva de efectivo antes de pagar' })
      if (code === 'INSUFFICIENT_TREASURY') return reply.status(409).send({ message: 'El pago supera el saldo de Tesorería' })
      if (code === 'PROFESSIONAL_NOT_FOUND') return reply.status(404).send({ message: 'El profesional no existe en este local' })
      if (code === 'LIQUIDATION_CATEGORY_INACTIVE') return reply.status(409).send({ message: 'Activá la categoría Liquidaciones profesionales antes de pagar' })
      if (code === 'FINANCIAL_EFFECTIVE_DATE_FUTURE') return reply.status(400).send({ message: 'La fecha no puede ser futura' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_professional_payment_failed')
      return reply.status(500).send({ message: 'No pudimos registrar el pago desde Tesorería' })
    }
  })

  app.post('/treasury/outflow', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Tesorería está reservada a administración' })
    const body = (request.body || {}) as {
      businessId?: string; accountId?: string; amount?: number; kind?: 'INCOME' | 'EXPENSE' | 'WITHDRAWAL'; description?: string;
      counterpartyId?: string; expenseCategoryId?: string; expenseSubcategoryId?: string; effectiveDate?: string; idempotencyKey?: string
    }
    const businessId = scope(user!, body)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    const counterpartyId = typeof body.counterpartyId === 'string' ? body.counterpartyId.trim() || null : null
    const expenseCategoryId = typeof body.expenseCategoryId === 'string' ? body.expenseCategoryId.trim() || null : null
    const expenseSubcategoryId = typeof body.expenseSubcategoryId === 'string' ? body.expenseSubcategoryId.trim() || null : null
    if (!accountId || !validAmount(body.amount) || !['INCOME', 'EXPENSE', 'WITHDRAWAL'].includes(body.kind || '') || !description || description.length > 160 ||
        !isFinancialEffectiveDate(body.effectiveDate) || !KEY.test(body.idempotencyKey || '') || (body.counterpartyId !== undefined && typeof body.counterpartyId !== 'string') ||
        !expenseCategoryId || body.expenseCategoryId!.length > 200 ||
        (body.expenseSubcategoryId !== undefined && (typeof body.expenseSubcategoryId !== 'string' || body.expenseSubcategoryId.length > 200)) ||
        (expenseSubcategoryId && !expenseCategoryId)) {
      return reply.status(400).send({ message: 'Indicá tipo, detalle, importe y clasificación válidos' })
    }
    try {
      return await prisma.$transaction(async (tx) => {
        const effectiveAt = await resolveFinancialEffectiveAt(tx, businessId, body.effectiveDate!)
        return recordTreasuryOutflow(tx, {
          businessId, accountId, kind: body.kind!, amount: body.amount!, description, counterpartyId, expenseCategoryId,
          expenseSubcategoryId, effectiveAt, effectiveDate: body.effectiveDate!, idempotencyKey: body.idempotencyKey!, actorUserId: user!.id, actorName: user!.name
        })
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_ACCOUNT_INVALID') return reply.status(400).send({ message: 'La cuenta seleccionada no existe o está inactiva' })
      if (code === 'TREASURY_COUNTERPARTY_INVALID') return reply.status(400).send({ message: 'El destinatario no existe o está inactivo' })
      if (code === 'INSUFFICIENT_TREASURY') return reply.status(409).send({ message: 'El importe supera el saldo de Tesorería' })
      if (code === 'EXPENSE_CATEGORY_INVALID') return reply.status(400).send({ message: 'La categoría no existe o está inactiva' })
      if (code === 'EXPENSE_SUBCATEGORY_INVALID') return reply.status(400).send({ message: 'La subcategoría no pertenece a la categoría o está inactiva' })
      if (code === 'FINANCIAL_EFFECTIVE_DATE_FUTURE') return reply.status(400).send({ message: 'La fecha no puede ser futura' })
      if (code === 'KEY_CONFLICT') return reply.status(409).send({ message: 'La operación ya existe con otros datos' })
      request.log.error({ err: error }, 'treasury_outflow_failed')
      return reply.status(500).send({ message: 'No pudimos registrar el movimiento' })
    }
  })

  app.post('/treasury/movements/:id/correct-date', async (request, reply) => {
    const user = request.auth?.user
    if (!isAdmin(user)) return reply.status(403).send({ message: 'Solo administración puede corregir fechas' })
    const params = request.params as { id?: string }
    const body = (request.body || {}) as { businessId?: string; effectiveDate?: string; reason?: string }
    const businessId = scope(user!, body)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    if (!params.id?.trim() || !isFinancialEffectiveDate(body.effectiveDate) || reason.length < 3 || reason.length > 200) {
      return reply.status(400).send({ message: 'Indicá una fecha válida y el motivo de la corrección' })
    }
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${businessId} FOR UPDATE`)
        const sources = await tx.$queryRaw<Array<{
          id: string; accountId: string; kind: string; direction: 'INFLOW' | 'OUTFLOW'; amount: number;
          description: string | null; counterparty: string | null; counterpartyId: string | null;
          expenseCategoryId: string | null; expenseSubcategoryId: string | null; effectiveAt: Date; effectiveDate: string;
          correctionRole: string | null; cashEntryId: string | null
        }>>(Prisma.sql`
          SELECT movement."id", movement."accountId", movement."kind", movement."direction"::text AS "direction",
            movement."amount", movement."description", movement."counterparty", movement."counterpartyId",
            movement."expenseCategoryId", movement."expenseSubcategoryId", movement."effectiveAt",
            (movement."effectiveAt" AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires'))::date::text AS "effectiveDate",
            movement."correctionRole", movement."cashEntryId"
          FROM "TreasuryMovement" movement
          JOIN "Business" business ON business."id" = movement."businessId"
          WHERE movement."businessId" = ${businessId} AND movement."id" = ${params.id.trim()}
          FOR UPDATE OF movement
        `)
        const source = sources[0]
        if (!source) throw new Error('TREASURY_MOVEMENT_NOT_FOUND')
        if (source.kind === 'DAILY_TRANSFER' || source.cashEntryId || source.correctionRole) throw new Error('TREASURY_DATE_NOT_CORRECTABLE')
        const prior = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "TreasuryMovement"
          WHERE "businessId" = ${businessId} AND "correctionSourceId" = ${source.id}
          LIMIT 1 FOR UPDATE
        `)
        if (prior[0]) throw new Error('TREASURY_DATE_ALREADY_CORRECTED')
        if (source.effectiveDate === body.effectiveDate) throw new Error('FINANCIAL_EFFECTIVE_DATE_UNCHANGED')
        const replacementEffectiveAt = await resolveFinancialEffectiveAt(tx, businessId, body.effectiveDate!)
        const directions = financialCorrectionDirections(source.direction)
        const reversalId = randomUUID()
        const replacementId = randomUUID()
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "TreasuryMovement" (
            "id", "businessId", "accountId", "kind", "direction", "amount", "description", "counterparty", "counterpartyId",
            "expenseCategoryId", "expenseSubcategoryId", "actorUserId", "actorName", "effectiveAt", "correctionSourceId", "correctionRole", "correctionReason"
          ) VALUES (
            ${reversalId}, ${businessId}, ${source.accountId}, ${source.kind}, ${directions.reversal}::"CashDirection", ${source.amount},
            ${source.description}, ${source.counterparty}, ${source.counterpartyId}, ${source.expenseCategoryId}, ${source.expenseSubcategoryId},
            ${user!.id}, ${user!.name}, ${source.effectiveAt}, ${source.id}, 'REVERSAL', ${reason}
          ), (
            ${replacementId}, ${businessId}, ${source.accountId}, ${source.kind}, ${directions.replacement}::"CashDirection", ${source.amount},
            ${source.description}, ${source.counterparty}, ${source.counterpartyId}, ${source.expenseCategoryId}, ${source.expenseSubcategoryId},
            ${user!.id}, ${user!.name}, ${replacementEffectiveAt}, ${source.id}, 'REPLACEMENT', ${reason}
          )
        `)
        const professionalEntries = await tx.$queryRaw<Array<{
          professionalId: string; type: string; direction: 'CREDIT' | 'DEBIT'; amount: number; description: string | null
        }>>(Prisma.sql`
          SELECT "professionalId", "type"::text AS "type", "direction"::text AS "direction", "amount", "description"
          FROM "ProfessionalAccountEntry"
          WHERE "businessId" = ${businessId} AND "treasuryMovementId" = ${source.id}
          FOR UPDATE
        `)
        const professional = professionalEntries[0]
        if (professional) {
          const reversalDirection = professional.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT'
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "ProfessionalAccountEntry" (
              "id", "businessId", "professionalId", "treasuryMovementId", "type", "direction", "amount", "description", "actorUserId", "actorName", "effectiveAt"
            ) VALUES (
              ${randomUUID()}, ${businessId}, ${professional.professionalId}, ${reversalId}, 'REVERSAL'::"ProfessionalAccountEntryType",
              ${reversalDirection}::"ProfessionalAccountDirection", ${professional.amount}, ${reason}, ${user!.id}, ${user!.name}, ${source.effectiveAt}
            ), (
              ${randomUUID()}, ${businessId}, ${professional.professionalId}, ${replacementId}, ${professional.type}::"ProfessionalAccountEntryType",
              ${professional.direction}::"ProfessionalAccountDirection", ${professional.amount}, ${professional.description}, ${user!.id}, ${user!.name}, ${replacementEffectiveAt}
            )
          `)
        }
        return { sourceId: source.id, reversalId, replacementId, effectiveAt: replacementEffectiveAt }
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'TREASURY_MOVEMENT_NOT_FOUND') return reply.status(404).send({ message: 'Movimiento no encontrado' })
      if (code === 'TREASURY_DATE_NOT_CORRECTABLE') return reply.status(409).send({ message: 'Este movimiento no admite corrección de fecha' })
      if (code === 'TREASURY_DATE_ALREADY_CORRECTED') return reply.status(409).send({ message: 'La fecha de este movimiento ya fue corregida' })
      if (code === 'FINANCIAL_EFFECTIVE_DATE_UNCHANGED') return reply.status(400).send({ message: 'La nueva fecha debe ser diferente' })
      if (code === 'FINANCIAL_EFFECTIVE_DATE_FUTURE') return reply.status(400).send({ message: 'La fecha no puede ser futura' })
      request.log.error({ err: error, businessId, movementId: params.id }, 'treasury_date_correction_failed')
      return reply.status(500).send({ message: 'No pudimos corregir la fecha' })
    }
  })
}

export async function recordTreasuryProfessionalPayment(tx: Prisma.TransactionClient, input: {
  businessId: string
  professionalId: string
  type: 'PAYMENT' | 'ADVANCE'
  amount: number
  observation: string | null
  effectiveAt: Date
  effectiveDate: string
  idempotencyKey: string
  actorUserId: string
  actorName: string
}) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${input.businessId} FOR UPDATE`)
  const existing = await tx.$queryRaw<Array<{
    id: string; businessId: string; kind: string; amount: number; entryId: string | null;
    professionalId: string | null; entryType: string | null; observation: string | null; effectiveDate: string
  }>>(Prisma.sql`
    SELECT movement."id", movement."businessId", movement."kind", movement."amount", entry."id" AS "entryId",
      entry."professionalId", entry."type"::text AS "entryType", entry."description" AS "observation",
      (movement."effectiveAt" AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires'))::date::text AS "effectiveDate"
    FROM "TreasuryMovement" movement
    JOIN "Business" business ON business."id" = movement."businessId"
    LEFT JOIN "ProfessionalAccountEntry" entry
      ON entry."businessId" = movement."businessId" AND entry."treasuryMovementId" = movement."id"
    WHERE movement."id" = ${input.idempotencyKey}
  `)
  const kind = input.type === 'ADVANCE' ? 'PROFESSIONAL_ADVANCE' : 'PROFESSIONAL_PAYMENT'
  if (existing[0]) {
    const row = existing[0]
    if (row.businessId !== input.businessId || row.kind !== kind || row.amount !== input.amount || row.professionalId !== input.professionalId || row.entryType !== input.type || row.observation !== input.observation || row.effectiveDate !== input.effectiveDate || !row.entryId) throw new Error('KEY_CONFLICT')
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
    INSERT INTO "TreasuryMovement" ("id", "businessId", "accountId", "kind", "direction", "amount", "description", "expenseCategoryId", "actorUserId", "actorName", "effectiveAt")
    VALUES (${input.idempotencyKey}, ${input.businessId}, ${account.id}, ${kind}, 'OUTFLOW'::"CashDirection", ${input.amount}, ${description + professionals[0].name}, ${categoryId}, ${input.actorUserId}, ${input.actorName}, ${input.effectiveAt})
  `)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ProfessionalAccountEntry" ("id", "businessId", "professionalId", "treasuryMovementId", "type", "direction", "amount", "description", "actorUserId", "actorName", "effectiveAt")
    VALUES (${entryId}, ${input.businessId}, ${input.professionalId}, ${input.idempotencyKey}, ${input.type}::"ProfessionalAccountEntryType", 'DEBIT'::"ProfessionalAccountDirection", ${input.amount}, ${input.observation}, ${input.actorUserId}, ${input.actorName}, ${input.effectiveAt})
  `)
  return { id: entryId, treasuryMovementId: input.idempotencyKey, amount: input.amount }
}

export async function recordTreasuryOutflow(tx: Prisma.TransactionClient, input: {
  businessId: string
  accountId: string
  kind: 'INCOME' | 'EXPENSE' | 'WITHDRAWAL'
  amount: number
  description: string
  counterpartyId: string | null
  expenseCategoryId: string
  expenseSubcategoryId: string | null
  effectiveAt: Date
  effectiveDate: string
  idempotencyKey: string
  actorUserId: string
  actorName: string
}) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Business" WHERE "id" = ${input.businessId} FOR UPDATE`)
  const existing = await tx.$queryRaw<Array<{
    id: string; businessId: string; kind: string; amount: number; description: string | null;
    accountId: string; counterpartyId: string | null; expenseCategoryId: string | null; expenseSubcategoryId: string | null; effectiveDate: string
  }>>(Prisma.sql`
    SELECT movement."id", movement."businessId", movement."accountId", movement."kind", movement."amount", movement."description", movement."counterpartyId", movement."expenseCategoryId", movement."expenseSubcategoryId",
      (movement."effectiveAt" AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires'))::date::text AS "effectiveDate"
    FROM "TreasuryMovement" movement JOIN "Business" business ON business."id" = movement."businessId" WHERE movement."id" = ${input.idempotencyKey}
  `)
  if (existing[0]) {
    const row = existing[0]
    if (row.businessId !== input.businessId || row.accountId !== input.accountId || row.kind !== input.kind || row.amount !== input.amount ||
        row.description !== input.description || row.counterpartyId !== input.counterpartyId ||
        row.expenseCategoryId !== input.expenseCategoryId || row.expenseSubcategoryId !== input.expenseSubcategoryId || row.effectiveDate !== input.effectiveDate) throw new Error('KEY_CONFLICT')
    return { id: row.id, amount: row.amount }
  }
  const accounts = await tx.$queryRaw<Array<{ id: string; kind: string; movementBalance: bigint; entryBalance: bigint }>>(Prisma.sql`
    SELECT account."id", method."kind"::text AS "kind",
      COALESCE((SELECT SUM(CASE WHEN movement."direction" = 'INFLOW'::"CashDirection" THEN movement."amount" ELSE -movement."amount" END) FROM "TreasuryMovement" movement WHERE movement."businessId" = account."businessId" AND movement."accountId" = account."id"), 0)::bigint AS "movementBalance",
      CASE WHEN method."kind" = 'CASH'::"CashPaymentMethod" THEN 0::bigint ELSE COALESCE((SELECT SUM(CASE WHEN entry."direction" = 'INFLOW'::"CashDirection" THEN entry."amount" ELSE -entry."amount" END) FROM "CashEntry" entry WHERE entry."businessId" = account."businessId" AND entry."businessPaymentMethodId" = account."paymentMethodId"), 0)::bigint END AS "entryBalance"
    FROM "TreasuryAccount" account JOIN "BusinessPaymentMethod" method ON method."businessId" = account."businessId" AND method."id" = account."paymentMethodId"
    WHERE account."businessId" = ${input.businessId} AND account."id" = ${input.accountId} AND method."isActive" = true FOR KEY SHARE OF account, method
  `)
  const account = accounts[0]
  if (!account) throw new Error('TREASURY_ACCOUNT_INVALID')
  if (input.kind !== 'INCOME' && BigInt(input.amount) > account.movementBalance + account.entryBalance) throw new Error('INSUFFICIENT_TREASURY')
  let counterparty: string | null = null
  if (input.counterpartyId) {
    const counterparties = await tx.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT "name" FROM "TreasuryCounterparty" WHERE "businessId" = ${input.businessId} AND "id" = ${input.counterpartyId} AND "isActive" = true FOR KEY SHARE
    `)
    if (!counterparties[0]) throw new Error('TREASURY_COUNTERPARTY_INVALID')
    counterparty = counterparties[0].name
  }
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
    INSERT INTO "TreasuryMovement" ("id", "businessId", "accountId", "kind", "direction", "amount", "description", "counterparty", "counterpartyId", "expenseCategoryId", "expenseSubcategoryId", "actorUserId", "actorName", "effectiveAt")
    VALUES (${input.idempotencyKey}, ${input.businessId}, ${account.id}, ${input.kind}, ${input.kind === 'INCOME' ? 'INFLOW' : 'OUTFLOW'}::"CashDirection", ${input.amount}, ${input.description}, ${counterparty}, ${input.counterpartyId}, ${input.expenseCategoryId}, ${input.expenseSubcategoryId}, ${input.actorUserId}, ${input.actorName}, ${input.effectiveAt})
  `)
  return { id: input.idempotencyKey, amount: input.amount }
}

export function consolidateCashAndTreasury(cash: {
  grossCollected: number
  refunds: number
  expenses: number
  collectedByMethod: { CASH: number; TRANSFER: number; CARD: number }
  outgoingByMethod: { CASH: number; TRANSFER: number; CARD: number; UNSPECIFIED: number }
}, outgoingTreasuryInput: number | { CASH: number; TRANSFER: number; CARD: number; UNSPECIFIED: number }, incomingTreasuryByMethod = {
  CASH: 0,
  TRANSFER: 0,
  CARD: 0,
  UNSPECIFIED: 0
}) {
  const outgoingTreasuryByMethod = typeof outgoingTreasuryInput === 'number'
    ? { CASH: outgoingTreasuryInput, TRANSFER: 0, CARD: 0, UNSPECIFIED: 0 }
    : outgoingTreasuryInput
  const incomingTreasury = Object.values(incomingTreasuryByMethod).reduce((sum, amount) => sum + amount, 0)
  const outgoingTreasury = Object.values(outgoingTreasuryByMethod).reduce((sum, amount) => sum + amount, 0)
  const collected = cash.grossCollected + incomingTreasury
  const collectedByMethod = {
    CASH: cash.collectedByMethod.CASH + incomingTreasuryByMethod.CASH,
    TRANSFER: cash.collectedByMethod.TRANSFER + incomingTreasuryByMethod.TRANSFER,
    CARD: cash.collectedByMethod.CARD + incomingTreasuryByMethod.CARD,
    UNSPECIFIED: cash.grossCollected - cash.collectedByMethod.CASH - cash.collectedByMethod.TRANSFER - cash.collectedByMethod.CARD + incomingTreasuryByMethod.UNSPECIFIED
  }
  const outgoingByMethod = {
    CASH: cash.outgoingByMethod.CASH + outgoingTreasuryByMethod.CASH,
    TRANSFER: cash.outgoingByMethod.TRANSFER + outgoingTreasuryByMethod.TRANSFER,
    CARD: cash.outgoingByMethod.CARD + outgoingTreasuryByMethod.CARD,
    UNSPECIFIED: cash.outgoingByMethod.UNSPECIFIED + outgoingTreasuryByMethod.UNSPECIFIED
  }
  const outgoing = cash.expenses + cash.refunds + outgoingTreasury
  return {
    collected,
    incomingTreasury,
    outgoingCash: cash.expenses + cash.refunds,
    outgoingTreasury,
    outgoing,
    total: collected - outgoing,
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

function prismaErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
}
