import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { InstagramMediaError, INSTAGRAM_INSIGHT_METRICS, type InsightValues } from './instagram-media-domain.js'
import type { InstagramMediaRepository, MediaConnection, MediaScope, MediaListOptions } from './instagram-media-service.js'

type Client = Record<string, any>
const conflict = () => new InstagramMediaError(409, 'La cuenta o la continuacion cambio, vencio o esta en uso. Reinicia la sincronizacion.')
const fingerprint = (token: string | null) => createHash('sha256').update(token ?? '').digest('hex')
export class PrismaInstagramMediaRepository implements InstagramMediaRepository {
  constructor(private readonly client: Client = prisma) {}

  async connection(businessId: string): Promise<MediaConnection | null> {
    const row = await this.client.businessInstagramConfig.findUnique({ where: { businessId }, select: { instagramAccountId: true, accessToken: true } })
    return row?.instagramAccountId ? { businessId, accountId: row.instagramAccountId, accessToken: row.accessToken } : null
  }

  async list(scope: MediaScope, options: MediaListOptions) {
    const where = { ...scope, ...(options.kind ? { mediaProductType: options.kind } : {}),
      ...(options.from || options.to ? { publishedAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } } : {}) }
    const [rows, total, links] = await Promise.all([
      this.client.instagramMedia.findMany({ where, take: options.limit, skip: options.offset,
        orderBy: [{ [options.sort]: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }], include: { snapshots: { orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], take: 1 } } }),
      this.client.instagramMedia.count({ where }),
      // Global provenance BEFORE date/kind filters and pagination, always same business/account.
      this.client.$queryRaw(Prisma.sql`SELECT p."id", p."metaMediaId" FROM "InstagramPublication" p
        JOIN "InstagramMedia" m ON m."businessId" = p."businessId" AND m."providerMediaId" = p."metaMediaId"
        WHERE m."businessId" = ${scope.businessId} AND m."accountId" = ${scope.accountId}`)
    ])
    const publications = new Map<string, string>((links as any[]).map((row) => [row.metaMediaId, row.id]))
    return { items: rows.map((row: any) => presentMedia(row, publications.get(row.providerMediaId) ?? null)), total, linkedPublicationIds: [...publications.values()] }
  }

  async history(scope: MediaScope, id: string, limit: number, offset: number) {
    if (!await this.client.instagramMedia.findFirst({ where: { ...scope, id }, select: { id: true } })) return null
    const where = { ...scope, mediaId: id }
    const [items, total] = await Promise.all([
      this.client.instagramMediaInsight.findMany({ where, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.client.instagramMediaInsight.count({ where })
    ])
    return { items: items.map(presentObservation), total }
  }

  async claim(connection: MediaConnection, continuation: string | undefined, claimToken: string, now: Date) {
    const { businessId, accountId } = connection
    let id = continuation
    if (!id) {
      await this.client.instagramMediaSync.deleteMany({ where: { businessId, expiresAt: { lte: now } } })
      id = randomUUID()
      await this.client.instagramMediaSync.create({ data: { id, businessId, accountId, credentialHash: fingerprint(connection.accessToken), expiresAt: new Date(now.getTime() + 3600000) } })
    }
    const claimed = await this.client.instagramMediaSync.updateMany({
      where: { id, businessId, accountId, credentialHash: fingerprint(connection.accessToken), expiresAt: { gt: now }, OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] },
      data: { claimToken, claimUntil: new Date(now.getTime() + 60000) }
    })
    if (claimed.count !== 1) throw conflict()
    const session = await this.client.instagramMediaSync.findUnique({ where: { id } })
    return { id: id!, after: session.after, claimToken }
  }

  async commit(input: Parameters<InstagramMediaRepository['commit']>[0]) {
    await this.client.$transaction(async (tx: Client) => {
      // Serialize account changes with this short commit, never while requesting Meta.
      const configs = await tx.$queryRaw(Prisma.sql`SELECT "instagramAccountId", "accessToken" FROM "BusinessInstagramConfig" WHERE "businessId" = ${input.connection.businessId} FOR UPDATE`)
      const config = configs[0]
      if (!config || config.instagramAccountId !== input.connection.accountId || config.accessToken !== input.connection.accessToken) throw conflict()
      const session = await tx.instagramMediaSync.findUnique({ where: { id: input.claim.id } })
      if (!session || session.claimToken !== input.claim.claimToken || session.expiresAt <= input.now || session.claimUntil <= input.now) throw conflict()
      if (input.nextCursor && session.seenCursors.includes(input.nextCursor)) throw conflict()
      const scope = { businessId: input.connection.businessId, accountId: input.connection.accountId }
      for (const media of input.media) {
        const where = { businessId_accountId_providerMediaId: { ...scope, providerMediaId: media.providerMediaId } }
        const previous = await tx.instagramMedia.findUnique({ where })
        const row = await tx.instagramMedia.upsert({ where, create: { ...scope, ...media, lastSyncedAt: input.metadataObservedAt },
          update: previous && previous.lastSyncedAt > input.metadataObservedAt ? {} : { ...media, lastSyncedAt: input.metadataObservedAt } })
        const observation = input.observations.find((item) => item.providerMediaId === media.providerMediaId)
        if (!observation) continue
        const timestamps = { ...row.metricObservedAt }
        const known = Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.filter((name) => observation.values[name] !== null
          && (!timestamps[name] || new Date(timestamps[name]) <= observation.observedAt)).map((name) => [name, observation.values[name]]))
        for (const name of Object.keys(known)) timestamps[name] = observation.observedAt.toISOString()
        const latestAttempt = !row.lastInsightAttemptAt || row.lastInsightAttemptAt <= observation.observedAt
        await tx.instagramMedia.update({ where: { id: row.id }, data: { ...known, metricObservedAt: timestamps,
          ...(latestAttempt ? { lastInsightAttemptAt: observation.observedAt, insightsStatus: observation.status, insightsErrorCode: observation.errorCode } : {}) } })
        await tx.instagramMediaInsight.create({ data: { ...scope, mediaId: row.id, observedAt: observation.observedAt,
          apiVersion: observation.apiVersion, status: observation.status, errorCode: observation.errorCode, periods: observation.periods, ...observation.values } })
      }
      if (input.nextCursor) await tx.instagramMediaSync.update({ where: { id: session.id }, data: { after: input.nextCursor, seenCursors: { push: input.nextCursor }, claimToken: null, claimUntil: null } })
      else await tx.instagramMediaSync.delete({ where: { id: session.id } })
    }, { timeout: 10000 })
  }

  async release(claim: { id: string; claimToken: string }) {
    await this.client.instagramMediaSync.updateMany({ where: { id: claim.id, claimToken: claim.claimToken }, data: { claimToken: null, claimUntil: null } })
  }
}
function metricValues(row: any): InsightValues {
  return Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name) => [name, row[name] ?? null])) as InsightValues
}
function presentObservation(row: any) {
  return { id: row.id, observedAt: row.observedAt, apiVersion: row.apiVersion, status: row.status, errorCode: row.errorCode, periods: row.periods, values: metricValues(row) }
}
function presentMedia(row: any, localPublicationId: string | null) {
  return { id: row.id, accountId: row.accountId, providerMediaId: row.providerMediaId, localPublicationId,
    caption: row.caption, mediaType: row.mediaType, mediaProductType: row.mediaProductType, permalink: row.permalink,
    thumbnailUrl: row.thumbnailUrl, publishedAt: row.publishedAt, cataloguedAt: row.cataloguedAt, lastSyncedAt: row.lastSyncedAt,
    lastInsightAttemptAt: row.lastInsightAttemptAt, insightsStatus: row.insightsStatus, insightsErrorCode: row.insightsErrorCode,
    latestMetrics: { values: metricValues(row), observedAtByMetric: row.metricObservedAt, period: 'lifetime' },
    latestObservation: row.snapshots?.[0] ? presentObservation(row.snapshots[0]) : null }
}
