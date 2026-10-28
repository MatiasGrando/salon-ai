import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { assertIanaTimezone } from './cash-domain.js'
import { localDateTimeToInstants, formatSlotOffset } from '../bot-options/application/availability-queries.js'
import { InstagramPublicationConflictError, InstagramPublicationValidationError, parseScheduleInstant } from './instagram-publication-service.js'

type Client = Record<string, any>
export class InstagramCalendarService {
  constructor(private readonly client: Client = prisma) {}

  private async context(businessId: string) {
    const business = await this.client.business.findUnique({ where: { id: businessId }, select: { timezone: true, instagramConfig: true } })
    let timezone: string
    try { timezone = assertIanaTimezone(business?.timezone) } catch { throw new InstagramPublicationConflictError('Configurá una zona horaria válida para el comercio.') }
    return { timezone, accountId: business.instagramConfig?.instagramAccountId ?? null,
      apiAccountId: business.instagramConfig?.apiAccountId || business.instagramConfig?.instagramAccountId || null }
  }

  async resolveTime(businessId: string, date: unknown, minute: unknown) {
    const { timezone } = await this.context(businessId)
    if (typeof date !== 'string' || typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute >= 1440) throw new InstagramPublicationValidationError(['Fecha y minuto local inválidos.'])
    const candidates = localDateTimeToInstants(date, minute, timezone).map((instant) => ({ instant: instant.toISOString(), offset: formatSlotOffset(instant.toISOString(), timezone) }))
    if (!candidates.length) throw new InstagramPublicationValidationError(['Ese horario no existe en la zona del comercio.'])
    return { timezone, requiresChoice: candidates.length > 1, candidates }
  }

  async list(businessId: string, raw: Record<string, unknown>) {
    const context = await this.context(businessId)
    const publicationType = raw.publicationType === 'STORY' ? 'STORY' : 'REEL'
    const from = parseScheduleInstant(raw.from), to = parseScheduleInstant(raw.to)
    const limit = raw.limit === undefined ? 50 : Number(raw.limit), offset = raw.offset === undefined ? 0 : Number(raw.offset)
    if (!from || !to || from >= to || +to - +from > 93 * 86400000 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new InstagramPublicationValidationError(['Rango o paginación del calendario inválidos.'])
    const records = Prisma.sql`WITH records AS (
      SELECT 'media'::text AS kind,m."id",m."caption",'PUBLISHED'::text AS status,m."accountId",
        NULL::timestamp AS "scheduledAt",m."publishedAt",m."publishedAt" AS "eventAt",NULL::text AS "scheduleTimezone",NULL::integer AS revision,false AS "unverifiedAccount",NULL::timestamp AS "manuallyCompletedAt",NULL::text AS "deliveryMode",
        (SELECT p."id" FROM "InstagramPublication" p WHERE p."businessId"=m."businessId" AND p."metaMediaId"=m."providerMediaId" LIMIT 1) AS "publicationId"
      FROM "InstagramMedia" m WHERE m."businessId"=${businessId} AND m."accountId"=${context.accountId} AND m."mediaProductType"=${publicationType === 'STORY' ? 'STORY' : 'REELS'}
      UNION ALL
      SELECT 'publication',p."id",p."caption",p."status"::text,p."destinationInstagramAccountId",p."scheduledAt",p."publishedAt",
        CASE WHEN p."status"='PUBLISHED' THEN p."publishedAt" WHEN p."status"='MANUALLY_COMPLETED' THEN p."manuallyCompletedAt" ELSE p."scheduledAt" END,p."scheduleTimezone",p."revision",p."destinationInstagramAccountId" IS NULL,p."manuallyCompletedAt",p."deliveryMode",p."id"
      FROM "InstagramPublication" p WHERE p."businessId"=${businessId} AND p."publicationType"=${publicationType}
        AND ((p."destinationInstagramAccountId"=${context.accountId} AND p."destinationApiAccountId"=${context.apiAccountId})
          OR p."destinationInstagramAccountId" IS NULL)
        AND NOT EXISTS (SELECT 1 FROM "InstagramMedia" m WHERE m."businessId"=p."businessId" AND m."accountId"=${context.accountId} AND m."providerMediaId"=p."metaMediaId")
    ), filtered AS (SELECT * FROM records WHERE "eventAt">=${from} AND "eventAt"<${to})`
    const [items, total, undatedItems] = await Promise.all([
      this.client.$queryRaw(Prisma.sql`${records} SELECT * FROM filtered ORDER BY "eventAt","kind","id" LIMIT ${limit} OFFSET ${offset}`),
      this.client.$queryRaw(Prisma.sql`${records} SELECT COUNT(*)::integer AS total FROM filtered`),
      this.client.$queryRaw(Prisma.sql`${records} SELECT * FROM records WHERE "eventAt" IS NULL ORDER BY "kind","id" LIMIT ${limit} OFFSET ${offset}`)
    ])
    const undatedTotal = await this.client.$queryRaw(Prisma.sql`${records} SELECT COUNT(*)::integer AS total FROM records WHERE "eventAt" IS NULL`)
    return { ...context, publicationType, from: from.toISOString(), to: to.toISOString(), limit, offset, items, total: total[0].total, undatedItems, undatedTotal: undatedTotal[0].total }
  }
}
