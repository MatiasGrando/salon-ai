import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'] as const
const VISIT_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'] as const

type CountRow = { count: bigint | number }
type CustomerMixRow = {
  newCustomers: bigint | number
  returningCustomers: bigint | number
}
type VisitGapRow = {
  averageDays: number | string | null
  sampleSize: bigint | number
}
type CustomerSummaryRow = {
  customerId: string
  name: string
  phone: string
  visitCount: bigint | number
  lastVisit: Date
  daysSinceLastVisit: number | string
  averageGapDays: number | string | null
  expectedReturnDays?: number | string
  overdueDays?: number | string
  totalCount: bigint | number
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/overview', async (request, reply) => {
    const query = request.query as {
      businessId?: string
      days?: string
      futureDays?: string
      inactiveDays?: string
    }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })

    const days = boundedInteger(query.days, 30, 7, 365)
    const futureDays = boundedInteger(query.futureDays, 30, 7, 180)
    const inactiveDays = boundedInteger(query.inactiveDays, 60, 15, 730)
    const periodEnd = new Date()
    const periodStart = startOfDay(addDays(periodEnd, -(days - 1)))
    const futureEnd = addDays(periodEnd, futureDays)
    const businessAppointmentWhere = {
      professional: { businessId }
    }
    const periodWhere = {
      ...businessAppointmentWhere,
      startAt: { gte: periodStart, lte: periodEnd }
    }
    const activePeriodWhere = {
      ...periodWhere,
      status: { in: [...ACTIVE_STATUSES] }
    }

    const [
      statusGroups,
      activeCustomerRows,
      newCustomers,
      serviceGroups,
      professionalGroups,
      futureGroups,
      conversationCountRows,
      convertedConversationRows,
      customerMixRows,
      visitGapRows,
      inactiveRows,
      riskRows
    ] = await Promise.all([
      prisma.appointment.groupBy({
        by: ['status'],
        where: periodWhere,
        _count: { _all: true }
      }),
      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(DISTINCT a."customerId") AS count
         FROM "Appointment" a
         JOIN "Professional" p ON p.id = a."professionalId"
         WHERE p."businessId" = $1
           AND a."startAt" >= $2
           AND a."startAt" <= $3
           AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')`,
        businessId,
        periodStart,
        periodEnd
      ),
      prisma.customer.count({
        where: {
          createdAt: { gte: periodStart, lte: periodEnd },
          appointments: { some: businessAppointmentWhere }
        }
      }),
      prisma.appointment.groupBy({
        by: ['serviceId'],
        where: activePeriodWhere,
        _count: { _all: true },
        orderBy: { _count: { serviceId: 'desc' } }
      }),
      prisma.appointment.groupBy({
        by: ['professionalId', 'status'],
        where: periodWhere,
        _count: { _all: true }
      }),
      prisma.appointment.groupBy({
        by: ['professionalId'],
        where: {
          ...businessAppointmentWhere,
          status: { in: [...ACTIVE_STATUSES] },
          startAt: { gte: periodEnd, lt: futureEnd }
        },
        _count: { _all: true },
        orderBy: { _count: { professionalId: 'desc' } }
      }),
      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM "Conversation"
         WHERE "businessId" = $1 AND "updatedAt" >= $2 AND "updatedAt" <= $3`,
        businessId,
        periodStart,
        periodEnd
      ),
      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM "Conversation" c
         WHERE c."businessId" = $1
           AND c."updatedAt" >= $2
           AND c."updatedAt" <= $3
           AND EXISTS (
             SELECT 1
             FROM "Appointment" a
             JOIN "Professional" p ON p.id = a."professionalId"
             JOIN "Customer" customer ON customer.id = a."customerId"
             WHERE p."businessId" = $1
               AND a."startAt" >= $2
               AND a."startAt" <= $3
               AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
               AND regexp_replace(customer.phone, '[^0-9]', '', 'g') = regexp_replace(c.phone, '[^0-9]', '', 'g')
           )`,
        businessId,
        periodStart,
        periodEnd
      ),
      prisma.$queryRawUnsafe<CustomerMixRow[]>(
        `WITH period_customers AS (
           SELECT DISTINCT a."customerId"
           FROM "Appointment" a
           JOIN "Professional" p ON p.id = a."professionalId"
           WHERE p."businessId" = $1
             AND a."startAt" >= $2
             AND a."startAt" <= $3
             AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
         ),
         first_visits AS (
           SELECT a."customerId", MIN(a."startAt") AS first_visit
           FROM "Appointment" a
           JOIN "Professional" p ON p.id = a."professionalId"
           JOIN period_customers pc ON pc."customerId" = a."customerId"
           WHERE p."businessId" = $1
             AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
           GROUP BY a."customerId"
         )
         SELECT
           COUNT(*) FILTER (WHERE first_visit >= $2) AS "newCustomers",
           COUNT(*) FILTER (WHERE first_visit < $2) AS "returningCustomers"
         FROM first_visits`,
        businessId,
        periodStart,
        periodEnd
      ),
      prisma.$queryRawUnsafe<VisitGapRow[]>(
        `WITH visits AS (
           SELECT
             a."startAt",
             LAG(a."startAt") OVER (PARTITION BY a."customerId" ORDER BY a."startAt") AS previous_visit
           FROM "Appointment" a
           JOIN "Professional" p ON p.id = a."professionalId"
           WHERE p."businessId" = $1
             AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
             AND a."startAt" <= $3
         )
         SELECT
           ROUND(AVG(EXTRACT(EPOCH FROM ("startAt" - previous_visit)) / 86400)) AS "averageDays",
           COUNT(*) AS "sampleSize"
         FROM visits
         WHERE "startAt" >= $2 AND previous_visit IS NOT NULL`,
        businessId,
        periodStart,
        periodEnd
      ),
      prisma.$queryRawUnsafe<CustomerSummaryRow[]>(
        `WITH visits AS (
           SELECT
             a."customerId",
             customer.name,
             customer.phone,
             a."startAt",
             LAG(a."startAt") OVER (PARTITION BY a."customerId" ORDER BY a."startAt") AS previous_visit
           FROM "Appointment" a
           JOIN "Professional" p ON p.id = a."professionalId"
           JOIN "Customer" customer ON customer.id = a."customerId"
           WHERE p."businessId" = $1
             AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
             AND a."startAt" <= $2
         ),
         summaries AS (
           SELECT
             "customerId",
             MAX(name) AS name,
             MAX(phone) AS phone,
             COUNT(*) AS "visitCount",
             MAX("startAt") AS "lastVisit",
             ROUND(EXTRACT(EPOCH FROM ($2 - MAX("startAt"))) / 86400) AS "daysSinceLastVisit",
             ROUND(AVG(EXTRACT(EPOCH FROM ("startAt" - previous_visit)) / 86400)
               FILTER (WHERE previous_visit IS NOT NULL)) AS "averageGapDays"
           FROM visits
           GROUP BY "customerId"
         )
         SELECT *, COUNT(*) OVER() AS "totalCount"
         FROM summaries s
         WHERE s."daysSinceLastVisit" >= $3
           AND NOT EXISTS (
             SELECT 1
             FROM "Appointment" future
             JOIN "Professional" future_professional ON future_professional.id = future."professionalId"
             WHERE future."customerId" = s."customerId"
               AND future_professional."businessId" = $1
               AND future.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
               AND future."startAt" >= $2
           )
         ORDER BY s."daysSinceLastVisit" DESC
         LIMIT 8`,
        businessId,
        periodEnd,
        inactiveDays
      ),
      prisma.$queryRawUnsafe<CustomerSummaryRow[]>(
        `WITH visits AS (
           SELECT
             a."customerId",
             customer.name,
             customer.phone,
             a."startAt",
             LAG(a."startAt") OVER (PARTITION BY a."customerId" ORDER BY a."startAt") AS previous_visit
           FROM "Appointment" a
           JOIN "Professional" p ON p.id = a."professionalId"
           JOIN "Customer" customer ON customer.id = a."customerId"
           WHERE p."businessId" = $1
             AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
             AND a."startAt" <= $2
         ),
         summaries AS (
           SELECT
             "customerId",
             MAX(name) AS name,
             MAX(phone) AS phone,
             COUNT(*) AS "visitCount",
             MAX("startAt") AS "lastVisit",
             ROUND(EXTRACT(EPOCH FROM ($2 - MAX("startAt"))) / 86400) AS "daysSinceLastVisit",
             ROUND(AVG(EXTRACT(EPOCH FROM ("startAt" - previous_visit)) / 86400)
               FILTER (WHERE previous_visit IS NOT NULL)) AS "averageGapDays"
           FROM visits
           GROUP BY "customerId"
         )
         SELECT
           *,
           GREATEST(14, ROUND("averageGapDays" * 1.25)) AS "expectedReturnDays",
           "daysSinceLastVisit" - GREATEST(14, ROUND("averageGapDays" * 1.25)) AS "overdueDays",
           COUNT(*) OVER() AS "totalCount"
         FROM summaries
         WHERE "visitCount" >= 2
           AND "averageGapDays" IS NOT NULL
           AND "daysSinceLastVisit" > GREATEST(14, ROUND("averageGapDays" * 1.25))
         ORDER BY "overdueDays" DESC
         LIMIT 8`,
        businessId,
        periodEnd
      )
    ])

    const statusCounts = new Map(statusGroups.map((row) => [row.status, row._count._all]))
    const totalAppointments = sum(statusCounts.values())
    const cancelled = statusCounts.get('CANCELLED') ?? 0
    const noShow = statusCounts.get('NO_SHOW') ?? 0
    const active = sum(ACTIVE_STATUSES.map((status) => statusCounts.get(status) ?? 0))
    const completed = await prisma.appointment.count({
      where: {
        ...activePeriodWhere,
        OR: [
          { status: 'COMPLETED' },
          { startAt: { lt: periodEnd } }
        ]
      }
    })

    const serviceIds = serviceGroups.map((row) => row.serviceId)
    const professionalIds = Array.from(new Set([
      ...professionalGroups.map((row) => row.professionalId),
      ...futureGroups.map((row) => row.professionalId)
    ]))
    const [services, professionals] = await Promise.all([
      prisma.service.findMany({
        where: { id: { in: serviceIds }, businessId },
        select: { id: true, name: true, price: true }
      }),
      prisma.professional.findMany({
        where: { id: { in: professionalIds }, businessId },
        select: { id: true, name: true }
      })
    ])
    const serviceById = new Map(services.map((service) => [service.id, service]))
    const professionalById = new Map(professionals.map((professional) => [professional.id, professional]))
    const serviceRows = serviceGroups
      .map((group) => ({
        id: group.serviceId,
        label: serviceById.get(group.serviceId)?.name ?? 'Servicio',
        count: group._count._all
      }))
      .sort((left, right) => right.count - left.count)
    const missingServices = serviceRows
      .filter((row) => serviceById.get(row.id)?.price === null)
      .map((row) => ({ id: row.id, name: row.label }))
    const pricedRows = serviceRows.filter((row) => serviceById.get(row.id)?.price !== null)
    const revenueTotal = pricedRows.reduce((total, row) => {
      return total + row.count * Number(serviceById.get(row.id)?.price ?? 0)
    }, 0)
    const professionalRows = Array.from(groupByProfessional(professionalGroups, professionalById).values())
      .sort((left, right) => right.attended - left.attended || right.total - left.total)
      .slice(0, 6)
    const futureAgenda = futureGroups
      .map((group) => ({
        label: professionalById.get(group.professionalId)?.name ?? 'Profesional',
        count: group._count._all
      }))
      .sort((left, right) => right.count - left.count)
    const chatTotal = numberValue(conversationCountRows[0]?.count)
    const chatConverted = numberValue(convertedConversationRows[0]?.count)
    const customerMix = customerMixRows[0] ?? { newCustomers: 0, returningCustomers: 0 }
    const mixNew = numberValue(customerMix.newCustomers)
    const mixReturning = numberValue(customerMix.returningCustomers)
    const mixTotal = mixNew + mixReturning
    const visitGap = visitGapRows[0]

    return {
      period: {
        start: periodStart,
        end: periodEnd,
        days
      },
      appointments: {
        total: totalAppointments,
        active,
        completed,
        cancelled,
        noShow,
        cancellationRate: totalAppointments ? Math.round((cancelled / totalAppointments) * 100) : 0
      },
      customers: {
        active: numberValue(activeCustomerRows[0]?.count),
        new: newCustomers
      },
      chatConversion: {
        total: chatTotal,
        converted: chatConverted,
        rate: chatTotal ? Math.round((chatConverted / chatTotal) * 100) : 0
      },
      customerMix: {
        newCustomers: mixNew,
        returningCustomers: mixReturning,
        newRate: mixTotal ? Math.round((mixNew / mixTotal) * 100) : 0,
        returningRate: mixTotal ? Math.round((mixReturning / mixTotal) * 100) : 0
      },
      visitGap: {
        averageDays: visitGap?.averageDays === null || visitGap?.averageDays === undefined
          ? null
          : numberValue(visitGap.averageDays),
        sampleSize: numberValue(visitGap?.sampleSize)
      },
      revenue: {
        total: revenueTotal,
        pricedAppointments: sum(pricedRows.map((row) => row.count)),
        missingAppointments: sum(serviceRows
          .filter((row) => serviceById.get(row.id)?.price === null)
          .map((row) => row.count)),
        missingServices
      },
      services: serviceRows.slice(0, 6),
      professionals: professionalRows,
      futureAgenda: {
        total: sum(futureAgenda.map((row) => row.count)),
        byProfessional: futureAgenda
      },
      inactiveCustomers: {
        total: numberValue(inactiveRows[0]?.totalCount),
        items: inactiveRows.map(normalizeCustomerSummary)
      },
      riskCustomers: {
        total: numberValue(riskRows[0]?.totalCount),
        items: riskRows.map(normalizeCustomerSummary)
      }
    }
  })
}

function groupByProfessional(
  groups: Array<{ professionalId: string; status: string; _count: { _all: number } }>,
  professionals: Map<string, { id: string; name: string }>
) {
  const rows = new Map<string, {
    name: string
    attended: number
    cancelled: number
    noShow: number
    total: number
  }>()
  for (const group of groups) {
    const row = rows.get(group.professionalId) ?? {
      name: professionals.get(group.professionalId)?.name ?? 'Profesional',
      attended: 0,
      cancelled: 0,
      noShow: 0,
      total: 0
    }
    row.total += group._count._all
    if (group.status === 'CANCELLED') row.cancelled += group._count._all
    if (group.status === 'NO_SHOW') row.noShow += group._count._all
    if (VISIT_STATUSES.includes(group.status as (typeof VISIT_STATUSES)[number])) {
      row.attended += group._count._all
    }
    rows.set(group.professionalId, row)
  }

  return rows
}

function normalizeCustomerSummary(row: CustomerSummaryRow) {
  return {
    customerId: row.customerId,
    name: row.name,
    phone: row.phone,
    visitCount: numberValue(row.visitCount),
    lastVisit: row.lastVisit,
    daysSinceLastVisit: numberValue(row.daysSinceLastVisit),
    averageGapDays: row.averageGapDays === null ? null : numberValue(row.averageGapDays),
    ...(row.expectedReturnDays === undefined ? {} : { expectedReturnDays: numberValue(row.expectedReturnDays) }),
    ...(row.overdueDays === undefined ? {} : { overdueDays: numberValue(row.overdueDays) })
  }
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

function numberValue(value: bigint | number | string | undefined) {
  return Number(value ?? 0)
}

function sum(values: Iterable<number>) {
  let total = 0
  for (const value of values) total += value
  return total
}

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}
