import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_editor_no_dotenv__'
const { InstagramDuplicationService } = await import('../src/services/instagram-duplication-service.js')
const { copyInstagramReelVideo } = await import('../src/services/instagram-video-storage-service.js')
const { PrismaInstagramPublicationRepository } = await import('../src/services/instagram-publication-service.js')
const { PrismaInstagramVideoRetentionRepository } = await import('../src/services/instagram-video-retention-worker.js')
const original = 'a/instagram/reels/11111111-1111-4111-8111-111111111111.mp4'
const destination = 'a/instagram/reels/22222222-2222-4222-8222-222222222222.mp4'
function fixture() {
  let time = Date.parse('2026-10-26T12:00:00Z')
  const source: any = { publicationType:'REEL',mediaKind:'VIDEO',deliveryMode:'AUTO', id: 'source', businessId: 'a', videoObjectPath: original, videoMimeType: 'video/mp4', videoSizeBytes: 100,
    caption: 'Original', shareToFeed: true, revision: 0, status: 'PUBLISHED', publishedAt: new Date(time - 86400000), scheduledAt: new Date(time - 172800000),
    metaMediaId: 'provider', metaContainerId: 'container', claimToken: null, claimedUntil: null, videoDeletedAt: null, videoDeleteRequestedAt: null,
    automation: { enabled: true, privateReplyEnabled: false, privateReplyText: 'Disabled private', publicReplyEnabled: true, publicReplyText: 'Public', keywords: [{ value: 'info', normalizedValue: 'info' }] } }
  let rows: any[] = [source], next = 0
  const copies: any[] = [], deleted: string[] = []
  let afterCopy: () => void | Promise<void> = () => {}, copyError = false, commitUncertain = false, queryUnavailable = false
  let providerCopy: typeof copyInstagramReelVideo | null = null
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part))
    if (value && typeof value === 'object' && !(value instanceof Date)) return 'in' in value ? value.in.includes(row[key]) : 'gt' in value ? row[key] > value.gt : row[key] <= value.lte
    return row[key] === value
  })
  const client: any = { async $queryRawUnsafe() { return [] },
    async $transaction(fn: Function) {
      const before = structuredClone(rows)
      try { const result = await fn(client); if (commitUncertain) throw new Error('commit response lost'); return result }
      catch (error) { if (!commitUncertain) rows = before; throw error }
    },
    businessInstagramConfig: { async findUnique() { return { instagramAccountId: 'account-a' } } },
    instagramMedia: { async findFirst({ where }: any) { return where.accountId === 'account-a' && where.businessId === 'a' ? { id: 'import', caption: 'Imported', providerMediaId: 'not-local' } : null } },
    instagramPublication: {
      async findFirst({ where }: any) { if (queryUnavailable && where.videoObjectPath === destination) throw new Error('DB unavailable'); return rows.find((row) => matches(row, where)) ?? null },
      async updateMany({ where, data }: any) { const row = rows.find((row) => matches(row, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 } },
      async create({ data }: any) { const row = { ...data, id: 'copy', status: 'DRAFT', revision: 0,
        metaContainerId: null, metaMediaId: null, scheduledAt: null, scheduleTimezone: null, claimToken: null, claimedUntil: null,
        automation: { ...data.automation.create, keywords: data.automation.create.keywords.create } }; rows.push(row); return row }
    } }
  const service = new InstagramDuplicationService(client, { async copy(input) { copies.push(input); await afterCopy(); if (copyError) throw new Error('copy failed'); if (providerCopy) await providerCopy(input) },
    async delete(input) { deleted.push(input.objectPath) } }, () => new Date(time), () => next++ === 0 ? 'owner' : '22222222-2222-4222-8222-222222222222')
  return { source, service, client, copies, deleted, rows: () => rows, advance: (ms: number) => { time += ms }, afterCopy: (fn: () => void) => { afterCopy = fn },
    failCopy: () => { copyError = true }, uncertain: (unavailable = false) => { commitUncertain = true; queryUnavailable = unavailable }, clock: () => new Date(time),
    actualStorage: () => { providerCopy = copyInstagramReelVideo } }
}
for (const status of ['CREATING_CONTAINER', 'PROCESSING', 'PUBLISHING']) {
  const f = fixture(); f.source.status = status; f.source.claimToken = 'old-worker'; f.source.claimedUntil = new Date('2026-10-25T12:00:00Z')
  await assert.rejects(f.service.duplicate('a', { publicationId: 'source' }, 0), /archivo está en uso/)
  assert.deepEqual(f.copies, []); assert.equal(f.source.claimToken, 'old-worker')
  assert.equal(f.source.claimedUntil.toISOString(), '2026-10-25T12:00:00.000Z')
}
{
  const f = fixture(), result = await f.service.duplicate('a', { publicationId: 'source' }, 0)
  assert.equal(result.requiresFile, false); assert.equal(result.publication!.videoObjectPath, destination)
  assert.equal(result.publication!.status, 'DRAFT'); assert.equal(result.publication!.metaMediaId, null); assert.equal(result.publication!.scheduledAt, null)
  assert.equal(result.publication!.automation.publicReplyEnabled, true); assert.equal(f.source.videoObjectPath, original)
  assert.deepEqual(f.deleted, []); assert.equal(f.source.claimToken, null)
}
for (const change of ['expired', 'revision', 'path', 'delete', 'owner', 'copy-error']) {
  const f = fixture()
  f.afterCopy(() => {
    if (change === 'expired') f.advance(300001)
    if (change === 'revision') f.source.revision++
    if (change === 'path') f.source.videoObjectPath = 'replacement'
    if (change === 'delete') f.source.videoDeleteRequestedAt = new Date()
    if (change === 'owner') f.source.claimToken = 'new-owner'
  })
  if (change === 'copy-error') f.failCopy()
  await assert.rejects(f.service.duplicate('a', { publicationId: 'source' }, 0))
  assert.deepEqual(f.deleted, change === 'copy-error' ? [] : [destination]); assert.ok(!f.rows().some((row) => row.id === 'copy'))
  if (change === 'owner') assert.equal(f.source.claimToken, 'new-owner')
}
for (const unavailable of [false, true]) {
  const f = fixture(); f.uncertain(unavailable)
  if (unavailable) await assert.rejects(f.service.duplicate('a', { publicationId: 'source' }, 0))
  else assert.equal((await f.service.duplicate('a', { publicationId: 'source' }, 0)).publication!.id, 'copy')
  assert.deepEqual(f.deleted, [], 'unknown commit/reference status never permits deleting the destination')
}
{
  const f = fixture()
  const outcomes = await Promise.allSettled([f.service.duplicate('a', { publicationId: 'source' }, 0), f.service.duplicate('a', { publicationId: 'source' }, 0)])
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
  assert.equal(f.copies.length, 1, 'simultaneous duplicate requests cannot share the source reservation')
}
{
  const f = fixture()
  f.afterCopy(async () => {
    assert.equal(await new PrismaInstagramPublicationRepository(f.client, f.clock).reserveVideoDeletion({ businessId: 'a', id: 'source' }), null)
    assert.equal(await new PrismaInstagramVideoRetentionRepository(f.client, ['a']).claimNext({ cutoff: f.clock(), now: f.clock(),
      leaseUntil: new Date(+f.clock() + 60000), claimToken: 'retention' }), null, 'automatic retention respects the same live source reservation')
  })
  await f.service.duplicate('a', { publicationId: 'source' }, 0)
}
{
  const f = fixture(); f.source.claimToken = 'retention'; f.source.claimedUntil = new Date('2100-01-01')
  await assert.rejects(f.service.duplicate('a', { publicationId: 'source' }, 0)); assert.deepEqual(f.copies, [])
  await assert.rejects(f.service.duplicate('b', { publicationId: 'source' }, 0)); assert.deepEqual(f.copies, [])
}
{
  const f = fixture(), preview = await f.service.duplicate('a', { mediaId: 'import' }, undefined)
  assert.equal(preview.requiresFile, true); assert.equal(preview.publication, null); assert.equal(preview.content.caption, 'Imported'); assert.deepEqual(f.copies, [])
}
const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
const previousFetch = globalThis.fetch
try {
  process.env.SUPABASE_URL = 'https://storage.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key'
  const requests: any[] = []
  let badOriginal = false
  let destinationConflict = false
  let invalidDestinationAccess = false
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), ...options })
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': invalidDestinationAccess ? '200' : '100', 'content-type': 'video/mp4' } })
    if (options.method === 'DELETE') return Response.json([])
    if (String(url).includes('/object/info/')) return Response.json({ size: badOriginal ? 200 : 100, content_type: 'video/mp4' })
    if (String(url).endsWith('/object/copy')) return destinationConflict ? Response.json({ message: 'Object already exists' }, { status: 409 }) : Response.json({})
    if (String(url).includes('/object/sign/')) return Response.json({ signedURL: '/object/sign/bucket/a/instagram/reels/22222222-2222-4222-8222-222222222222.mp4?token=fake' })
    throw new Error('unexpected storage operation')
  }
  await copyInstagramReelVideo({ businessId: 'a', sourceObjectPath: original, destinationObjectPath: destination, expectedMimeType: 'video/mp4', expectedSizeBytes: 100 })
  const post = requests.find((request) => request.url.endsWith('/object/copy'))
  assert.equal(new Headers(post.headers).get('x-upsert'), 'false')
  assert.deepEqual(JSON.parse(post.body), { bucketId: 'instagram-reels', sourceKey: original, destinationKey: destination, copyMetadata: true })
  assert.ok(!requests.some((request) => request.method === 'DELETE'))
  destinationConflict = true
  const conflict = fixture(); conflict.actualStorage()
  await assert.rejects(conflict.service.duplicate('a', { publicationId: 'source' }, 0))
  assert.deepEqual(conflict.deleted, [], 'provider no-overwrite conflict never proves ownership of the existing destination')
  destinationConflict = false
  invalidDestinationAccess = true; requests.length = 0
  await assert.rejects(copyInstagramReelVideo({ businessId: 'a', sourceObjectPath: original, destinationObjectPath: destination, expectedMimeType: 'video/mp4', expectedSizeBytes: 100 }), /inconsistente/)
  assert.deepEqual(requests.filter((request) => request.method === 'DELETE').map((request) => JSON.parse(request.body).prefixes), [[destination]], 'only a confirmed new destination may be cleaned after access validation fails')
  invalidDestinationAccess = false
  badOriginal = true; requests.length = 0
  await assert.rejects(copyInstagramReelVideo({ businessId: 'a', sourceObjectPath: original, destinationObjectPath: destination, expectedMimeType: 'video/mp4', expectedSizeBytes: 100 }), /original/)
  assert.equal(requests.length, 1); assert.equal(requests[0].method, undefined)
  await assert.rejects(copyInstagramReelVideo({ businessId: 'b', sourceObjectPath: original, destinationObjectPath: destination, expectedMimeType: 'video/mp4', expectedSizeBytes: 100 }), /no pertenece/)
} finally {
  globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value
}
{
  const f=fixture();Object.assign(f.source,{publicationType:'STORY',mediaKind:'IMAGE',deliveryMode:'MANUAL',videoMimeType:'image/jpeg',videoObjectPath:'a/instagram/stories/11111111-1111-4111-8111-111111111111.jpg',automation:{enabled:false,privateReplyText:'',keywords:[]}})
  const copy=await f.service.duplicate('a',{publicationId:'source',publicationType:'STORY'},0)
  assert.equal(copy.publication!.publicationType,'STORY');assert.equal(copy.publication!.mediaKind,'IMAGE');assert.equal(copy.publication!.deliveryMode,'MANUAL')
  assert.match(copy.publication!.videoObjectPath,/\/instagram\/stories\/.+\.jpg$/);assert.notEqual(copy.publication!.videoObjectPath,f.source.videoObjectPath)
  assert.equal(copy.publication!.status,'DRAFT');assert.equal(copy.publication!.publishedAt,null)
}
console.log('OK: independent storage copy, read-only original validation, reserved source, fresh commit fencing and safe ambiguous compensation')
