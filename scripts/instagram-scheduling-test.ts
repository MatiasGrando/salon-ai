import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_schedule_no_dotenv__'
const { PrismaInstagramPublicationWorkerRepository, InstagramPublicationWorker } = await import('../src/services/instagram-publication-worker.js')
const { PrismaInstagramPublicationRepository, InstagramPublicationService } = await import('../src/services/instagram-publication-service.js')
const { InstagramApiRequestError } = await import('../src/integrations/instagram-api.js')

const now = new Date('2026-10-26T12:00:00Z')
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part))
    if (key === 'AND') return value.every((part: any) => matches(row, part))
    const actual = row[key]
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value && !value.in.includes(actual)) return false
      if ('lte' in value && !(actual != null && actual <= value.lte)) return false
      if ('gt' in value && !(actual != null && actual > value.gt)) return false
      return true
    }
    return value === null ? actual == null : actual instanceof Date && value instanceof Date ? +actual === +value : actual === value
  })
}
for (const race of ['reprogram', 'cancel']) {
  const row: any = { publicationType: 'REEL', deliveryMode: 'AUTO', mediaKind: 'VIDEO', id: 'p', businessId: 'a', status: 'READY', revision: 1, availableAt: now,
    scheduledAt: now, claimToken: null, claimedUntil: null, videoDeletedAt: null }
  const client: any = { $transaction: (fn: Function) => fn(client), instagramPublication: {
    findFirst: async () => {
      const selected = { ...row }
      row.revision++
      if (race === 'reprogram') row.availableAt = row.scheduledAt = new Date(+now + 60_000)
      else row.status = 'CANCELLED'
      return selected
    },
    updateMany: async ({ where, data }: any) => {
      if (!matches(row, where)) return { count: 0 }
      Object.assign(row, data); return { count: 1 }
    },
    findUnique: async () => row
  } }
  const repository = new PrismaInstagramPublicationWorkerRepository(client, ['a'], () => now)
  assert.equal(await repository.claimNext({ now, leaseUntil: new Date(+now + 60_000), claimToken: 'old-selection' }), null,
    'a stale selection must not claim a reprogrammed or cancelled publication')
  assert.equal(row.claimToken, null)
}
console.log('OK: actual publication claim rejects stale reprogram/cancel selections')

function fixture() {
  let time = +now
  const row: any = { publicationType: 'REEL', deliveryMode: 'AUTO', mediaKind: 'VIDEO', id: 'p', businessId: 'a', status: 'DRAFT', revision: 0, availableAt: now, scheduledAt: null,
    scheduleTimezone: null, claimToken: null, claimedUntil: null, videoDeletedAt: null, videoDeleteRequestedAt: null,
    videoObjectPath: 'a/reels/a.mp4', videoMimeType: 'video/mp4', videoSizeBytes: 100, caption: 'Reel', shareToFeed: true,
    attempts: 0, maxAttempts: 5, metaContainerId: null, metaMediaId: null,
    automation: { enabled: true, privateReplyText: 'Info', keywords: [{ value: 'info', normalizedValue: 'info' }] } }
  const config: any = { enabled: true, instagramAccountId: 'professional-a', apiAccountId: 'app-a', accessToken: 'token-a' }
  const business: any = { timezone: 'America/Argentina/Buenos_Aires', instagramConfig: config }
  let afterLock = () => {}
  const clock = () => new Date(time)
  const client: any = { $transaction: async (fn: Function) => fn(client), $queryRawUnsafe: async () => { afterLock(); return [] },
    business: { findUnique: async () => business }, businessInstagramConfig: { findUnique: async () => config },
    instagramPublication: {
      findFirst: async ({ where }: any) => matches(row, where) ? structuredClone({ ...row, business: { instagramConfig: config } }) : null,
      findFirstOrThrow: async () => structuredClone(row), findUnique: async () => structuredClone({ ...row, business: { instagramConfig: config } }),
      updateMany: async ({ where, data }: any) => {
        if (!matches(row, where)) return { count: 0 }
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value
        return { count: 1 }
      }
    } }
  const repository = new PrismaInstagramPublicationRepository(client, clock)
  const service = new InstagramPublicationService(repository, clock)
  const workerRepository = new PrismaInstagramPublicationWorkerRepository(client, ['a'], clock)
  const calls: any[] = []
  let signing = () => {}
  let poll = () => 'FINISHED'
  let createFailure: Error | null = null
  const makeWorker = () => new InstagramPublicationWorker({ repository: workerRepository, clock: { now: clock }, randomToken: () => 'owner', onStatusChanged() {},
    videoUrls: { async createTemporaryHttpsUrl() { calls.push('sign'); signing(); return 'https://storage.invalid/source' } },
    api: { async createReelContainer(input) { calls.push({ kind: 'create', ...input }); if (createFailure) throw createFailure; return { containerId: 'container' } },
      async getContainerStatus() { calls.push('poll'); return { statusCode: poll() } },
      async publishContainer(input) { calls.push({ kind: 'publish', ...input }); return { mediaId: 'published' } } } })
  return { row, config, business, service, repository, workerRepository, calls, makeWorker, clock,
    advance: (ms: number) => { time += ms }, setTime: (value: Date) => { time = +value },
    onLock: (fn: () => void) => { afterLock = fn }, onSign: (fn: () => void) => { signing = fn },
    onPoll: (fn: () => string) => { poll = fn }, failCreate: (error: Error | null) => { createFailure = error } }
}
const schedule = (f: ReturnType<typeof fixture>, at = new Date(+now + 60_000).toISOString(), revision = f.row.revision) => f.service.schedule('a', 'p', { scheduledAt: at, expectedRevision: revision })
for (const invalid of ['2026-10-27', '2026-10-27T10:00:00', '2026-02-30T12:00:00Z', '2026-10-27T25:00:00Z', now.toISOString()]) {
  const f = fixture(); await assert.rejects(schedule(f, invalid), /fecha futura/); assert.equal(f.row.status, 'DRAFT')
}
for (const revision of [undefined, -1, 0.5, '0']) {
  const f = fixture(); await assert.rejects(f.service.schedule('a', 'p', { scheduledAt: new Date(+now + 60_000).toISOString(), expectedRevision: revision }), /revisión/)
}
for (const timezone of [null, '', 'Not/A_Zone']) {
  const f = fixture(); f.business.timezone = timezone; await assert.rejects(schedule(f), /zona horaria/)
}
for (const value of ['2026-10-27T00:30:00+03:00', '2026-10-27T23:30:00-03:00']) {
  const f = fixture(); await schedule(f, value)
  assert.equal(+f.row.scheduledAt, +new Date(value)); assert.equal(f.row.scheduleTimezone, f.business.timezone)
  assert.equal(f.row.destinationInstagramAccountId, 'professional-a'); assert.equal(f.row.destinationApiAccountId, 'app-a')
}
{
  const f = fixture(); await schedule(f)
  assert.equal((await f.makeWorker().runOnce()).outcome, 'idle'); assert.deepEqual(f.calls, [])
  f.advance(60_000)
  assert.equal((await f.makeWorker().runOnce()).outcome, 'processed')
  assert.equal(f.row.status, 'PROCESSING')
  const desired = +f.row.scheduledAt
  f.onPoll(() => 'IN_PROGRESS'); await f.makeWorker().runOnce()
  assert.ok(+f.row.availableAt > +f.clock()); assert.equal(+f.row.scheduledAt, desired)
  f.advance(120_000); f.onPoll(() => 'FINISHED')
  await f.makeWorker().runOnce() // A new worker after restart runs the persisted late job.
  assert.equal(f.row.status, 'PUBLISHED'); assert.equal(+f.row.scheduledAt, desired)
  assert.equal(+f.row.publishedAt, +f.clock()); assert.equal(f.row.scheduleTimezone, f.business.timezone)
}
{
  const f = fixture(); await schedule(f)
  await assert.rejects(schedule(f, new Date(+now + 120_000).toISOString(), 0), /revisión/)
  await assert.rejects(f.service.cancel('b', 'p', 1), /no encontrada/)
  await f.service.cancel('a', 'p', 1)
  assert.equal(f.row.status, 'CANCELLED'); assert.equal(f.row.revision, 2)
  f.advance(120_000); assert.equal((await f.makeWorker().runOnce()).outcome, 'idle')
  await schedule(f, new Date(+f.clock() + 60_000).toISOString())
  const desired = +f.row.scheduledAt
  f.setTime(new Date(desired))
  await schedule(f, new Date(desired + 60_000).toISOString())
  f.advance(120_000)
  await f.service.cancel('a', 'p', f.row.revision)
  assert.equal(f.row.status, 'CANCELLED', 'overdue unclaimed work remains cancellable/reprogrammable after worker downtime')
}
for (const kind of ['claim', 'container', 'unknown']) {
  const f = fixture(); await schedule(f)
  if (kind === 'claim') { f.row.claimToken = 'other'; f.row.claimedUntil = new Date(+now + 30_000) }
  else if (kind === 'container') f.row.metaContainerId = 'already-created'
  else f.row.status = 'UNKNOWN'
  await assert.rejects(f.service.cancel('a', 'p', 1), /comenzó/)
  await assert.rejects(schedule(f), /comenzó/)
}
for (const switched of ['professional', 'api', 'disabled', 'token']) {
  const f = fixture(); await schedule(f); f.advance(60_000)
  f.onSign(() => {
    if (switched === 'professional') f.config.instagramAccountId = 'other'
    if (switched === 'api') f.config.apiAccountId = 'other'
    if (switched === 'disabled') f.config.enabled = false
    if (switched === 'token') f.config.accessToken = 'rotated-token'
  })
  await f.makeWorker().runOnce()
  const posts = f.calls.filter((call) => call.kind === 'create')
  assert.equal(posts.length, switched === 'token' ? 1 : 0)
  if (switched === 'token') assert.equal(posts[0].accessToken, 'rotated-token')
}
{
  const f = fixture(); await schedule(f); f.advance(60_000)
  f.onSign(() => f.advance(60_001))
  assert.equal((await f.makeWorker().runOnce()).outcome, 'lost-lease')
  assert.ok(!f.calls.some((call) => call.kind === 'create'))
}
{
  const f = fixture(); f.row.status = 'READY' // Legacy identity is deliberately unknown.
  await f.makeWorker().runOnce(); assert.equal(f.row.status, 'FAILED'); assert.deepEqual(f.calls, [])
}
for (const ambiguous of [false, true]) {
  const f = fixture(); await schedule(f); f.advance(60_000)
  f.failCreate(new InstagramApiRequestError({ message: 'fixture', transient: true, ambiguous, httpStatus: ambiguous ? null : 429 }))
  const desired = +f.row.scheduledAt
  await f.makeWorker().runOnce()
  assert.equal(f.row.status, ambiguous ? 'UNKNOWN' : 'CREATING_CONTAINER')
  assert.equal(+f.row.scheduledAt, desired)
  f.advance(60_000); f.failCreate(null); await f.makeWorker().runOnce()
  assert.equal(f.calls.filter((call) => call.kind === 'create').length, ambiguous ? 1 : 2)
}
{
  const f = fixture(); await schedule(f); await f.service.cancel('a', 'p', 1)
  await f.service.reserveVideoDeletion('a', 'p')
  assert.ok(f.row.videoDeleteRequestedAt); assert.equal(f.row.videoDeletedAt, null)
  assert.equal((await f.service.get('a', 'p')).videoAvailable, true, 'pending deletion must not claim that the physical video is already deleted')
  await assert.rejects(schedule(f), /comenzó/)
  f.advance(120_000); assert.equal((await f.makeWorker().runOnce()).outcome, 'idle')
  await f.service.reserveVideoDeletion('a', 'p') // Failed storage deletion can be retried explicitly.
  await f.service.markVideoDeleted('a', 'p'); assert.ok(f.row.videoDeletedAt)
}
{
  const f = fixture(); f.onLock(() => f.advance(31_000))
  await assert.rejects(schedule(f), /dejó de ser futura/)
  assert.equal(f.row.status, 'DRAFT')
}
console.log('OK: durable scheduling, real predicates, timezone/revision/tenant rules, restart/backoff, destination rotation and deletion fencing')
