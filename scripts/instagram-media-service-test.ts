import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { InstagramMediaService } = await import('../src/services/instagram-media-service.js')
const { PrismaInstagramMediaRepository } = await import('../src/services/prisma-instagram-media-repository.js')
const { InstagramApiRequestError } = await import('../src/integrations/instagram-api.js')
const { emptyInsights, INSTAGRAM_INSIGHT_METRICS } = await import('../src/services/instagram-media-domain.js')
let now = new Date('2026-10-24T10:00:00Z')
let config: any = { businessId: 'business-a', instagramAccountId: 'account-a', accessToken: 'server-only-token', enabled: false }
const tables: Record<string, any[]> = { media: [], observations: [], sessions: [] }
const publications = [{ id: 'pub-a', businessId: 'business-a', metaMediaId: 'reel-a' }, { id: 'foreign-pub', businessId: 'business-b', metaMediaId: 'reel-a' }]
let sequence = 0
const events: string[] = []
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, expected]: [string, any]) => {
    if (key === 'OR') return expected.some((clause: any) => matches(row, clause))
    if (key.includes('_') && expected && typeof expected === 'object') return matches(row, expected)
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) return Object.entries(expected).every(([operator, value]: [string, any]) => {
      if (operator === 'gt') return row[key] > value
      if (operator === 'gte') return row[key] >= value
      if (operator === 'lt') return row[key] < value
      if (operator === 'lte') return row[key] <= value
      throw new Error('Unexpected fake operator ' + operator)
    })
    return row[key] === expected
  })
}
function apply(row: any, data: any) {
  for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'push' in value ? [...row[key], value.push] : value
  return row
}
function delegate(table: string) {
  const rows = () => tables[table]!
  return {
    async findUnique({ where }: any) { return rows().find((row) => matches(row, where)) ?? null },
    async findFirst({ where }: any) { return rows().find((row) => matches(row, where)) ?? null },
    async findMany({ where, take, skip = 0, orderBy = [] }: any) {
      return rows().filter((row) => matches(row, where)).sort((a, b) => {
        for (const sort of orderBy) {
          const [key, definition]: any = Object.entries(sort)[0]
          if (a[key] === b[key]) continue
          if (a[key] === null) return 1
          if (b[key] === null) return -1
          return (a[key] > b[key] ? 1 : -1) * ((typeof definition === 'string' ? definition : definition.sort) === 'desc' ? -1 : 1)
        }
        return 0
      }).slice(skip, take === undefined ? undefined : skip + take).map((row) => ({ ...row, ...(table === 'media' ? { snapshots: tables.observations!.filter((item) => item.mediaId === row.id).sort((a, b) => b.observedAt - a.observedAt).slice(0, 1) } : {}) }))
    },
    async count({ where }: any) { return rows().filter((row) => matches(row, where)).length },
    async create({ data }: any) {
      const row = { id: 'id-' + ++sequence, after: null, seenCursors: [], claimUntil: null, claimToken: null, metricObservedAt: {}, ...emptyInsights(), cataloguedAt: now, ...data }
      rows().push(row); return row
    },
    async upsert({ where, create, update }: any) {
      const row = rows().find((item) => matches(item, where))
      return row ? apply(row, update) : this.create({ data: create })
    },
    async update({ where, data }: any) {
      const row = rows().find((item) => matches(item, where)); assert.ok(row)
      events.push('write-' + table); return apply(row, data)
    },
    async updateMany({ where, data }: any) {
      const found = rows().filter((row) => matches(row, where)); found.forEach((row) => apply(row, data)); return { count: found.length }
    },
    async delete({ where }: any) { tables[table] = rows().filter((row) => !matches(row, where)) },
    async deleteMany({ where }: any) { tables[table] = rows().filter((row) => !matches(row, where)) }
  }
}
const client: any = {
  instagramMedia: delegate('media'), instagramMediaInsight: delegate('observations'), instagramMediaSync: delegate('sessions'),
  businessInstagramConfig: { async findUnique({ where }: any) { return config?.businessId === where.businessId ? config : null } },
  async $queryRaw(sql: any) {
    if (sql.strings.join('').includes('FOR UPDATE')) { events.push('lock-config'); return config?.businessId === sql.values[0] ? [config] : [] }
    assert.ok(sql.strings.join('').includes('m."businessId" = p."businessId"'))
    const [businessId, accountId] = sql.values
    return publications.filter((pub) => pub.businessId === businessId && tables.media!.some((media) => media.businessId === businessId && media.accountId === accountId && media.providerMediaId === pub.metaMediaId)).map((pub) => ({ id: pub.id, metaMediaId: pub.metaMediaId }))
  },
  async $transaction(callback: any) {
    const saved = structuredClone(tables)
    try { return await callback(client) } catch (error) { Object.assign(tables, saved); throw error }
  }
}
const repository = new PrismaInstagramMediaRepository(client)
const media = (id: string, kind = 'REELS') => ({ providerMediaId: id, caption: id, mediaType: 'VIDEO', mediaProductType: kind, permalink: null, thumbnailUrl: null, publishedAt: new Date('2026-01-01') })
let page: any = { media: [media('reel-a'), media('feed-video', 'FEED')], skipped: 0, nextCursor: 'after-A' }
let listError = false
let metricsError = false
let changeAccount = false
let values = Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name, index) => [name, index])) as any
const periods = Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name) => [name, 'lifetime'])) as any
const requestedMedia: string[] = []
let active = 0
let maxActive = 0
const api = {
  async listMedia(input: any) { assert.equal(input.accountId, config.instagramAccountId); if (listError) throw new Error(config.accessToken); return page },
  async getReelInsights(input: any) {
    requestedMedia.push(input.mediaId); active++; maxActive = Math.max(maxActive, active)
    await Promise.resolve(); active--
    if (changeAccount) config = { ...config, instagramAccountId: 'account-other' }
    if (metricsError) throw new InstagramApiRequestError({ message: config.accessToken, httpStatus: 429, transient: true, ambiguous: false })
    return { values, periods }
  }
}
const service = new InstagramMediaService(repository, api, () => now)
const filters = { limit: 1, offset: 0, sort: 'reach' as const, kind: 'REELS' as const }
assert.equal((await service.list('business-a', filters)).total, 0)
let result = await service.sync('business-a')
assert.equal(result.status, 'more')
assert.ok(result.continuation && !result.continuation.includes('after-A'))
assert.deepEqual(requestedMedia, ['reel-a'], 'ordinary VIDEO media must not trigger Reel insights')
assert.equal(tables.media!.length, 2)
assert.equal(tables.observations!.length, 1)
assert.ok(events.indexOf('lock-config') < events.indexOf('write-media'), 'account row is locked before committing any metrics')
const first = await service.list('business-a', filters)
assert.equal(first.items[0].latestMetrics.values.views, 0)
assert.equal(first.items[0].latestMetrics.values.reach, 1)
assert.equal(first.items[0].localPublicationId, 'pub-a')
assert.deepEqual(first.linkedPublicationIds, ['pub-a'], 'cross-business publication IDs are never provenance')
const offPage = await service.list('business-a', { ...filters, offset: 10, from: new Date('2027-01-01') })
assert.equal(offPage.items.length, 0)
assert.deepEqual(offPage.linkedPublicationIds, ['pub-a'], 'global dedup IDs survive filters and empty pages')

// A partial fresh observation retains missing cached fields with their original timestamps.
now = new Date('2026-10-24T10:10:00Z')
page = { ...page, media: [media('reel-a')], nextCursor: 'after-B' }
values = { ...emptyInsights(), likes: 100 }
await service.sync('business-a', result.continuation!)
let listed = await service.list('business-a', filters)
assert.equal(listed.items[0].latestMetrics.values.views, 0)
assert.equal(listed.items[0].latestMetrics.observedAtByMetric.views, '2026-10-24T10:00:00.000Z')
assert.equal(listed.items[0].latestMetrics.observedAtByMetric.likes, '2026-10-24T10:10:00.000Z')
assert.equal(listed.items[0].latestObservation.values.views, null)
assert.equal(listed.items[0].latestObservation.status, 'partial')
assert.equal(listed.items[0].latestObservation.periods.likes, 'lifetime')
assert.equal((await service.history('business-a', first.items[0].id, 100, 0)).total, 2)

now = new Date('2026-10-24T10:20:00Z')
metricsError = true
page.nextCursor = null
await service.sync('business-a', result.continuation!)
listed = await service.list('business-a', filters)
assert.equal(listed.items[0].lastInsightAttemptAt.toISOString(), now.toISOString())
assert.equal(listed.items[0].latestMetrics.observedAtByMetric.views, '2026-10-24T10:00:00.000Z')
assert.equal(listed.items[0].insightsStatus, 'unavailable')
assert.equal(listed.items[0].insightsErrorCode, 'rate_limited')
assert.ok(Object.values(listed.items[0].latestObservation.values).every((value) => value === null))
assert.ok(!JSON.stringify(listed).includes('server-only-token'))
metricsError = false

// A failed metadata page has an opaque retry token, no fabricated observation or secret.
listError = true
const before = tables.observations!.length
result = await service.sync('business-a')
assert.equal(result.status, 'failed')
assert.equal(result.errorCode, 'provider_unavailable')
assert.ok(result.continuation)
assert.equal(tables.observations!.length, before)
assert.ok(!JSON.stringify(result).includes(config.accessToken))
listError = false
values = emptyInsights()
await service.sync('business-a', result.continuation!)
assert.equal((await service.list('business-a', filters)).items[0].latestObservation.status, 'unavailable')

// Repeated provider cursor rolls back the entire page; a busy continuation cannot be stolen.
page = { media: [media('reel-a')], nextCursor: 'repeat', skipped: 0 }
result = await service.sync('business-a')
const beforeRepeat = tables.observations!.length
await assert.rejects(service.sync('business-a', result.continuation!), /continuacion/)
assert.equal(tables.observations!.length, beforeRepeat)
const claim = await repository.claim((await repository.connection('business-a'))!, result.continuation!, 'owner-lease', now)
await assert.rejects(service.sync('business-a', result.continuation!), /en uso/)
await repository.release(claim)
await assert.rejects(service.sync('business-b', result.continuation!), /conexion/)

// Credentials or account changed while waiting for the provider must not commit into either account.
changeAccount = true
const beforeChange = tables.observations!.length
await assert.rejects(service.sync('business-a'), /cuenta/)
assert.equal(tables.observations!.length, beforeChange)
assert.equal((await service.list('business-a', filters)).items.length, 0)
await assert.rejects(service.history('business-a', first.items[0].id, 25, 0), /no encontrado/)
changeAccount = false
config = { ...config, instagramAccountId: 'account-a' }
const oldContinuation = result.continuation!
config.accessToken = 'rotated-server-token'
await assert.rejects(service.sync('business-a', oldContinuation), /continuacion/)
page = { media: Array.from({ length: 5 }, (_, index) => media('new-' + index)), nextCursor: null, skipped: 0 }
await service.sync('business-a')
assert.equal(maxActive, 3, 'bounded provider concurrency is three')
assert.equal(config.enabled, false, 'analytics neither requires nor activates the DM bot')
page = { media: [], nextCursor: null, skipped: 0 }
assert.equal((await service.sync('business-a')).status, 'complete')
config = null
assert.equal((await service.list('business-a', filters)).accountId, null)
await assert.rejects(service.sync('business-a'), /conexion/)
console.log('OK: production service/repository on offline delegates: partial cache timestamps, raw history, global provenance, pagination/retry/leases/account isolation and bounded concurrency')

// Recovery regressions first exercised by independent offline QA.
config = { businessId: 'business-a', instagramAccountId: 'account-a', accessToken: 'cursor-fixture-token', enabled: false }
now = new Date('2026-10-24T14:00:00Z')
let pageRequests = 0
const originalList = api.listMedia
api.listMedia = async (input: any) => { pageRequests++; return originalList(input) }
page = { media: [], skipped: 0, nextCursor: 'expiry-boundary' }
const expiring = await service.sync('business-a')
const beforeExpiry = pageRequests
now = new Date(now.getTime() + 3600000)
await assert.rejects(service.sync('business-a', expiring.continuation!), /continuacion/)
assert.equal(pageRequests, beforeExpiry, 'an exactly expired cursor is rejected before the provider')
const connection = (await repository.connection('business-a'))!
const ownerA = await repository.claim(connection, undefined, 'owner-a', now)
now = new Date(now.getTime() + 60001)
const ownerB = await repository.claim(connection, ownerA.id, 'owner-b', now)
await repository.release(ownerA)
assert.equal(tables.sessions!.find((row) => row.id === ownerA.id).claimToken, 'owner-b')
await assert.rejects(repository.commit({ connection, claim: ownerA, media: [], metadataObservedAt: now, observations: [], nextCursor: null, now }), /continuacion/)
assert.equal(tables.sessions!.find((row) => row.id === ownerB.id).claimToken, 'owner-b')
await repository.release(ownerB)
config.accessToken = 'before-inflight-rotation'
page = { media: [media('inflight-token')], skipped: 0, nextCursor: null }
api.getReelInsights = async () => { config = { ...config, accessToken: 'after-inflight-rotation' }; return { values: { ...emptyInsights(), reach: 7 }, periods } }
const beforeRotation = tables.observations!.length
await assert.rejects(service.sync('business-a'), /cuenta|continuacion/)
assert.equal(tables.observations!.length, beforeRotation)
assert.equal(tables.media!.some((row) => row.providerMediaId === 'inflight-token'), false)
page = { media: [media('mixed-zero'), media('mixed-failed')], skipped: 0, nextCursor: null }
api.getReelInsights = async (input: any) => {
  if (input.mediaId === 'mixed-failed') throw new InstagramApiRequestError({ message: 'permission failure', httpStatus: 403, transient: false, ambiguous: false })
  return { values: { ...emptyInsights(), reach: 0 }, periods }
}
assert.equal((await service.sync('business-a')).status, 'partial')
const mixed = await service.list('business-a', { limit: 100, offset: 0, sort: 'reach', kind: 'REELS' })
const zero = mixed.items.find((row: any) => row.providerMediaId === 'mixed-zero')!
const failed = mixed.items.find((row: any) => row.providerMediaId === 'mixed-failed')!
assert.equal(zero.latestMetrics.values.reach, 0)
assert.equal(failed.latestMetrics.values.reach, null)
assert.equal(failed.insightsErrorCode, 'permission_unavailable')

// Provider requests finish outside the DB lock: older results can commit after newer ones.
const current = (await service.list('business-a', { ...filters, limit: 100 })).items.find((row: any) => row.providerMediaId === 'reel-a')!
const currentMetrics = structuredClone(current.latestMetrics)
const currentAttempt = current.lastInsightAttemptAt
const lateConnection = (await repository.connection('business-a'))!
const lateClaim = await repository.claim(lateConnection, undefined, 'late-result', now)
await repository.commit({ connection: lateConnection, claim: lateClaim, media: [{ ...media('reel-a'), caption: 'stale caption' }], metadataObservedAt: new Date('2026-10-24T09:00:00Z'), nextCursor: null, now,
  observations: [{ providerMediaId: 'reel-a', observedAt: new Date('2026-10-24T09:00:00Z'), apiVersion: 'v25.0', status: 'partial', errorCode: null, periods, values: { ...emptyInsights(), views: 999 } }] })
const afterLate = (await service.list('business-a', { ...filters, limit: 100 })).items.find((row: any) => row.providerMediaId === 'reel-a')!
assert.deepEqual(afterLate.latestMetrics, currentMetrics, 'late older observation must never overwrite a newer cached metric')
assert.equal(afterLate.lastInsightAttemptAt.toISOString(), currentAttempt.toISOString(), 'last-attempt status cannot move backwards')
assert.equal(afterLate.lastSyncedAt.toISOString(), current.lastSyncedAt.toISOString(), 'metadata freshness cannot move backwards')
assert.equal(afterLate.caption, current.caption, 'an older page cannot overwrite newer metadata')
console.log('OK: expiry/lease recovery, stale owners, in-flight token rotation, mixed failures and out-of-order observations')
