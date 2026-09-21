import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { requireAuthorizedBusiness } from '../services/business-authorization.js'
import { normalizeProfessionalCompensationRule, type ProfessionalCompensationRuleInput } from '../services/professional-compensation.js'

function canViewProfessionalSettlements(user: any) {
  return user && (user.role !== 'STAFF' || user.canViewProfessionalSettlements === true)
}

function canManageProfessionalSettlements(user: any) {
  return user && (user.role !== 'STAFF' || user.canManageProfessionalSettlements === true)
}

function requestedBusinessId(user: any, value?: string) {
  return user?.role === 'SUPER_ADMIN' || user?.role === 'ACCOUNT_ADMIN'
    ? value?.trim() || user.businessId
    : user?.businessId
}

type ServiceRuleBody = ProfessionalCompensationRuleInput & { serviceId?: string }

type SettlementRange = { from: Date; toExclusive: Date }

function parseSettlementRange(from?: string, to?: string): SettlementRange | null {
  if (!from && !to) return null
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Elegí un período válido')
  }
  const start = new Date(from + 'T00:00:00.000Z')
  const end = new Date(to + 'T00:00:00.000Z')
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (!Number.isFinite(days) || days < 1) throw new Error('La fecha hasta no puede ser anterior a la fecha desde')
  if (days > 31) throw new Error('El período no puede superar 31 días')
  return { from: start, toExclusive: new Date(end.getTime() + 86_400_000) }
}

async function settlementRangeForBusiness(businessId: string, from?: string, to?: string): Promise<SettlementRange | null> {
  const validated = parseSettlementRange(from, to)
  if (!validated || !from || !to) return null
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const timezone = business?.timezone || 'America/Argentina/Buenos_Aires'
  const rows = await prisma.$queryRaw<Array<{ from: Date; toExclusive: Date }>>(Prisma.sql`
    SELECT (${from}::date::timestamp AT TIME ZONE ${timezone}) AS "from",
      ((${to}::date + 1)::timestamp AT TIME ZONE ${timezone}) AS "toExclusive"
  `)
  return rows[0] || validated
}

export async function professionalSettlementRoutes(app: FastifyInstance) {
  app.get('/professional-settlements/summary', async (request, reply) => {
    const user = request.auth?.user
    const query = request.query as { businessId?: string; from?: string; to?: string }
    if (!canViewProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para ver liquidaciones' })
    const businessId = requestedBusinessId(user, query.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })

    let range: SettlementRange | null
    try {
      range = await settlementRangeForBusiness(businessId, query.from, query.to)
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'Elegí un período válido' })
    }
    const periodFilter = range
      ? Prisma.sql`AND (
          (
            entry."type" = 'EARNING'::"ProfessionalAccountEntryType"
            AND EXISTS (
              SELECT 1
              FROM "Appointment" appointment
              WHERE appointment."businessId" = entry."businessId"
                AND appointment."id" = entry."appointmentId"
                AND appointment."startAt" >= ${range.from}
                AND appointment."startAt" < ${range.toExclusive}
            )
          )
          OR (
            entry."type" <> 'EARNING'::"ProfessionalAccountEntryType"
            AND entry."effectiveAt" >= ${range.from}
            AND entry."effectiveAt" < ${range.toExclusive}
          )
        )`
      : Prisma.empty
    const rows = await prisma.$queryRaw<Array<{
      id: string
      name: string
      completedServices: number
      periodEarned: number
      periodPaid: number
      periodBalance: number
      currentBalance: number
    }>>(Prisma.sql`
      SELECT professional."id", professional."name",
        coalesce(period_account."completedServices", 0)::integer AS "completedServices",
        coalesce(period_account."periodEarned", 0)::integer AS "periodEarned",
        coalesce(period_account."periodPaid", 0)::integer AS "periodPaid",
        coalesce(period_account."periodBalance", 0)::integer AS "periodBalance",
        coalesce(current_account."currentBalance", 0)::integer AS "currentBalance"
      FROM "Professional" professional
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE entry."type" = 'EARNING'::"ProfessionalAccountEntryType")::integer AS "completedServices",
          coalesce(sum(entry."amount") FILTER (WHERE entry."direction" = 'CREDIT'::"ProfessionalAccountDirection"), 0)::integer AS "periodEarned",
          coalesce(sum(entry."amount") FILTER (WHERE entry."direction" = 'DEBIT'::"ProfessionalAccountDirection"), 0)::integer AS "periodPaid",
          coalesce(sum(CASE WHEN entry."direction" = 'CREDIT'::"ProfessionalAccountDirection" THEN entry."amount" ELSE -entry."amount" END), 0)::integer AS "periodBalance"
        FROM "ProfessionalAccountEntry" entry
        WHERE entry."businessId" = professional."businessId"
          AND entry."professionalId" = professional."id"
          ${periodFilter}
      ) period_account ON true
      LEFT JOIN LATERAL (
        SELECT coalesce(sum(CASE WHEN entry."direction" = 'CREDIT'::"ProfessionalAccountDirection" THEN entry."amount" ELSE -entry."amount" END), 0)::integer AS "currentBalance"
        FROM "ProfessionalAccountEntry" entry
        WHERE entry."businessId" = professional."businessId"
          AND entry."professionalId" = professional."id"
      ) current_account ON true
      WHERE professional."businessId" = ${businessId}
      ORDER BY professional."name"
    `)

    const services = await prisma.professionalAccountEntry.findMany({
      where: {
        businessId,
        type: 'EARNING',
        ...(range ? { appointment: { is: { startAt: { gte: range.from, lt: range.toExclusive } } } } : {})
      },
      select: {
        id: true,
        professionalId: true,
        amount: true,
        baseAmount: true,
        ruleMode: true,
        rulePercentage: true,
        ruleFixedAmount: true,
        description: true,
        effectiveAt: true,
        appointment: {
          select: {
            startAt: true,
            customer: { select: { name: true } },
            service: { select: { name: true } }
          }
        }
      },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }]
    })
    const servicesByProfessional = new Map<string, typeof services>()
    for (const service of services) {
      const current = servicesByProfessional.get(service.professionalId) || []
      current.push(service)
      servicesByProfessional.set(service.professionalId, current)
    }
    return {
      items: rows.map((row) => ({ ...row, services: servicesByProfessional.get(row.id) || [] })),
      period: range ? { from: query.from, to: query.to } : null
    }
  })

  app.get('/professional-settlements/entries', async (request, reply) => {
    const user = request.auth?.user
    const query = request.query as { businessId?: string; professionalId?: string; from?: string; to?: string; page?: string; pageSize?: string }
    if (!canViewProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para ver liquidaciones' })
    const businessId = requestedBusinessId(user, query.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    let range: SettlementRange | null
    try {
      range = await settlementRangeForBusiness(businessId, query.from, query.to)
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'Elegí un período válido' })
    }
    const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1)
    const pageSize = Math.min(50, Math.max(5, Number.parseInt(query.pageSize || '10', 10) || 10))
    const where: Prisma.ProfessionalAccountEntryWhereInput = {
      businessId,
      ...(query.professionalId ? { professionalId: query.professionalId } : {}),
      ...(range ? {
        OR: [
          { type: 'EARNING', appointment: { is: { startAt: { gte: range.from, lt: range.toExclusive } } } },
          { type: { not: 'EARNING' }, effectiveAt: { gte: range.from, lt: range.toExclusive } }
        ]
      } : {})
    }
    const [total, items] = await prisma.$transaction([
      prisma.professionalAccountEntry.count({ where }),
      prisma.professionalAccountEntry.findMany({
        where,
        include: {
          professional: { select: { name: true } },
          appointment: {
            select: {
              startAt: true,
              customer: { select: { name: true } },
              service: { select: { name: true } }
            }
          }
        },
        orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  })

  app.post('/professional-settlements/payments', async (request, reply) => {
    const user = request.auth?.user
    const body = request.body as { businessId?: string; professionalId?: string; cashSessionId?: string; amount?: number; method?: 'CASH' | 'TRANSFER' | 'CARD'; type?: 'PAYMENT' | 'ADVANCE'; observation?: string }
    if (!canManageProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para pagar liquidaciones' })
    const businessId = requestedBusinessId(user, body.businessId)
    const amount = Number(body.amount)
    if (!businessId || !body.professionalId || !body.cashSessionId || !Number.isSafeInteger(amount) || amount <= 0 || !['CASH', 'TRANSFER', 'CARD'].includes(body.method || '') || !['PAYMENT', 'ADVANCE'].includes(body.type || '')) {
      return reply.status(400).send({ message: 'Completá profesional, tipo, sesión, medio e importe válido' })
    }
    if (!await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })

    try {
      return await prisma.$transaction(async (tx) => {
        const sessions = await tx.$queryRaw<Array<{ registerDayId: string }>>(Prisma.sql`
          SELECT "registerDayId" FROM "CashSession"
          WHERE "businessId" = ${businessId} AND "id" = ${body.cashSessionId} AND "closedAt" IS NULL
          FOR UPDATE
        `)
        if (!sessions[0]) throw new Error('CASH_SESSION_REQUIRED')
        const professionals = await tx.$queryRaw<Array<{ name: string }>>(Prisma.sql`
          SELECT "name" FROM "Professional"
          WHERE "businessId" = ${businessId} AND "id" = ${body.professionalId}
          FOR UPDATE
        `)
        if (!professionals[0]) throw new Error('PROFESSIONAL_NOT_FOUND')

        const cashEntryId = randomUUID()
        const entryId = randomUUID()
        const kind = body.type === 'ADVANCE' ? 'ADVANCE' : 'PAYMENT'
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "CashEntry" ("id", "businessId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin", "description", "counterparty", "observation", "effectiveAt")
          VALUES (${cashEntryId}, ${businessId}, ${sessions[0].registerDayId}, ${body.cashSessionId}, 'EXPENSE'::"CashEntryType", 'OUTFLOW'::"CashDirection", ${amount}, ${body.method}::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin", ${kind === 'ADVANCE' ? 'Adelanto a profesional' : 'Pago a profesional'}, ${professionals[0].name}, ${body.observation?.trim() || null}, clock_timestamp())
        `)
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ProfessionalAccountEntry" ("id", "businessId", "professionalId", "cashEntryId", "type", "direction", "amount", "description", "actorUserId", "actorName", "effectiveAt")
          VALUES (${entryId}, ${businessId}, ${body.professionalId}, ${cashEntryId}, ${kind}::"ProfessionalAccountEntryType", 'DEBIT'::"ProfessionalAccountDirection", ${amount}, ${body.observation?.trim() || null}, ${user!.id}, ${user!.name}, clock_timestamp())
        `)
        return { id: entryId, cashEntryId }
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return reply.status(code === 'PROFESSIONAL_NOT_FOUND' ? 404 : 409).send({
        message: code === 'CASH_SESSION_REQUIRED' ? 'Abrí una sesión de Caja para registrar el pago' : 'No pudimos registrar el pago'
      })
    }
  })

  app.get('/professional-settlements/configuration', async (request, reply) => {
    const user = request.auth?.user
    const query = request.query as { businessId?: string }
    if (!canViewProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para ver liquidaciones' })
    const businessId = requestedBusinessId(user, query.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    return prisma.professional.findMany({
      where: { businessId },
      select: {
        id: true,
        name: true,
        commissionMode: true,
        commissionPercentage: true,
        commissionFixedAmount: true,
        serviceLinks: {
          select: {
            id: true,
            serviceId: true,
            commissionMode: true,
            commissionPercentage: true,
            commissionFixedAmount: true,
            service: { select: { name: true } }
          }
        }
      },
      orderBy: { name: 'asc' }
    })
  })

  app.put('/professional-settlements/configuration/:professionalId', async (request, reply) => {
    const user = request.auth?.user
    const params = request.params as { professionalId: string }
    const body = request.body as ProfessionalCompensationRuleInput & { businessId?: string; serviceRules?: ServiceRuleBody[] }
    if (!canManageProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para configurar liquidaciones' })
    const businessId = requestedBusinessId(user, body.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })

    let generalRule
    let serviceRules: Array<{ serviceId: string; rule: ReturnType<typeof normalizeProfessionalCompensationRule> }>
    try {
      generalRule = normalizeProfessionalCompensationRule(body)
      const seen = new Set<string>()
      serviceRules = (body.serviceRules || []).map((item) => {
        const serviceId = item.serviceId?.trim()
        if (!serviceId || seen.has(serviceId)) throw new Error('Las excepciones por servicio son inválidas')
        seen.add(serviceId)
        return { serviceId, rule: normalizeProfessionalCompensationRule(item) }
      })
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'La regla de liquidación es inválida' })
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const professional = await tx.professional.findFirst({ where: { businessId, id: params.professionalId }, select: { id: true } })
        if (!professional) throw new Error('PROFESSIONAL_NOT_FOUND')
        const links = await tx.professionalService.findMany({ where: { professionalId: params.professionalId }, select: { serviceId: true } })
        const assigned = new Set(links.map((link) => link.serviceId))
        if (serviceRules.some((item) => !assigned.has(item.serviceId))) throw new Error('SERVICE_NOT_ASSIGNED')

        await tx.professional.update({
          where: { id: params.professionalId },
          data: {
            commissionMode: generalRule.mode,
            commissionPercentage: generalRule.percentage,
            commissionFixedAmount: generalRule.fixedAmount
          }
        })
        await tx.professionalService.updateMany({
          where: { professionalId: params.professionalId },
          data: { commissionMode: null, commissionPercentage: null, commissionFixedAmount: null }
        })
        for (const item of serviceRules) {
          if (item.rule.mode === 'NONE') continue
          await tx.professionalService.updateMany({
            where: { professionalId: params.professionalId, serviceId: item.serviceId },
            data: {
              commissionMode: item.rule.mode,
              commissionPercentage: item.rule.percentage,
              commissionFixedAmount: item.rule.fixedAmount
            }
          })
        }
        return tx.professional.findFirst({
          where: { businessId, id: params.professionalId },
          select: {
            id: true,
            name: true,
            commissionMode: true,
            commissionPercentage: true,
            commissionFixedAmount: true,
            serviceLinks: { select: { serviceId: true, commissionMode: true, commissionPercentage: true, commissionFixedAmount: true } }
          }
        })
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'PROFESSIONAL_NOT_FOUND') return reply.status(404).send({ message: 'Profesional no encontrado' })
      if (code === 'SERVICE_NOT_ASSIGNED') return reply.status(400).send({ message: 'Una excepción corresponde a un servicio no asignado' })
      throw error
    }
  })
}
