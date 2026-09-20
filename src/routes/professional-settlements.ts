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

export async function professionalSettlementRoutes(app: FastifyInstance) {
  app.get('/professional-settlements/summary', async (request, reply) => {
    const user = request.auth?.user
    const query = request.query as { businessId?: string }
    if (!canViewProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para ver liquidaciones' })
    const businessId = requestedBusinessId(user, query.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })

    const rows = await prisma.$queryRaw<Array<{ id: string; name: string; completedServices: number; earned: number; paid: number; balance: number }>>(Prisma.sql`
      SELECT professional."id", professional."name",
        coalesce(appointments."completedServices", 0)::integer AS "completedServices",
        coalesce(account."earned", 0)::integer AS "earned",
        coalesce(account."paid", 0)::integer AS "paid",
        coalesce(account."balance", 0)::integer AS "balance"
      FROM "Professional" professional
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS "completedServices"
        FROM "Appointment" appointment
        WHERE appointment."businessId" = professional."businessId"
          AND appointment."professionalId" = professional."id"
          AND appointment."status" = 'COMPLETED'::"AppointmentStatus"
      ) appointments ON true
      LEFT JOIN LATERAL (
        SELECT
          coalesce(sum(entry."amount") FILTER (WHERE entry."direction" = 'CREDIT'::"ProfessionalAccountDirection"), 0)::integer AS "earned",
          coalesce(sum(entry."amount") FILTER (WHERE entry."direction" = 'DEBIT'::"ProfessionalAccountDirection"), 0)::integer AS "paid",
          coalesce(sum(CASE WHEN entry."direction" = 'CREDIT'::"ProfessionalAccountDirection" THEN entry."amount" ELSE -entry."amount" END), 0)::integer AS "balance"
        FROM "ProfessionalAccountEntry" entry
        WHERE entry."businessId" = professional."businessId"
          AND entry."professionalId" = professional."id"
      ) account ON true
      WHERE professional."businessId" = ${businessId}
      ORDER BY professional."name"
    `)
    return { items: rows }
  })

  app.get('/professional-settlements/entries', async (request, reply) => {
    const user = request.auth?.user
    const query = request.query as { businessId?: string; professionalId?: string }
    if (!canViewProfessionalSettlements(user)) return reply.status(403).send({ message: 'No tenés permiso para ver liquidaciones' })
    const businessId = requestedBusinessId(user, query.businessId)
    if (!businessId || !await requireAuthorizedBusiness(prisma, user!, businessId)) return reply.status(404).send({ message: 'Recurso no encontrado' })
    return prisma.professionalAccountEntry.findMany({
      where: { businessId, ...(query.professionalId ? { professionalId: query.professionalId } : {}) },
      include: {
        professional: { select: { name: true } },
        appointment: { select: { startAt: true, service: { select: { name: true } } } }
      },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
      take: 200
    })
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
