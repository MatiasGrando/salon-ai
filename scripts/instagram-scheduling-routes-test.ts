import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH = '__instagram_schedule_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { prisma } = await import('../src/config/prisma.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { instagramPublicationRoutes } = await import('../src/routes/instagram-publications.js')
const { InstagramPublicationConflictError, InstagramPublicationValidationError } = await import('../src/services/instagram-publication-service.js')
const restores: Array<() => void> = []
function stub(target: any, key: string, value: any) { const previous = target[key]; target[key] = value; restores.push(() => { target[key] = previous }) }
const users = new Map(['admin', 'foreign', 'staff'].map((id) => [createHash('sha256').update(id).digest('hex'), {
  id, expiresAt: new Date('2100-01-01'), user: { id, role: id === 'staff' ? 'STAFF' : 'ACCOUNT_ADMIN',
    businessId: id === 'staff' ? 'a' : null, isActive: true, business: null } }]))
stub(prisma.userSession, 'findUnique', async ({ where }: any) => users.get(where.tokenHash) ?? null)
stub(prisma.business, 'findFirst', async ({ where }: any) => !where.isDemo && where.id === 'a' && (!where.accountAdminId || where.accountAdminId === 'admin') ? { id: 'a' } : null)
stub(prisma.business, 'count', async ({ where }: any) => where.AND[0].accountAdminId === 'admin' && where.AND[1].id.in.every((id: string) => id === 'a') ? 1 : 0)
const calls: any[] = []
let failure: Error | null = null
let deletionFails = false
const publication: any = { id: 'p', businessId: 'a', status: 'CANCELLED', videoObjectPath: 'a/reels/source.mp4', videoMimeType: 'video/mp4',
  videoSizeBytes: 100, videoAvailable: true, videoDeletedAt: null, videoDeleteRequestedAt: null, scheduledAt: '2026-10-27T12:00:00Z',
  scheduleTimezone: 'UTC', revision: 2, destinationInstagramAccountId: 'professional-a', destinationApiAccountId: 'app-a' }
const service: any = { async get() { calls.push('get'); return { ...publication } }, async list() { return [publication] },
  async schedule(...args: any[]) { calls.push(['schedule', ...args]); if (failure) throw failure; return { ...publication, status: 'SCHEDULED' } },
  async cancel(...args: any[]) { calls.push(['cancel', ...args]); if (failure) throw failure; return publication },
  async reserveVideoDeletion() { calls.push('reserve'); publication.videoDeleteRequestedAt = '2026-10-26T12:00:00Z'; return publication },
  async markVideoDeleted() { calls.push('deleted'); publication.videoDeletedAt = '2026-10-26T12:00:00Z'; return publication } }
const app = Fastify()
await authGuard(app)
await app.register(instagramPublicationRoutes, { service, allowedBusinessIds: ['a'], storage: {
  async createUpload() { throw new Error('not used') }, async verifyUpload() { calls.push('verify'); return {} },
  async deleteVideo() { assert.ok(publication.videoDeleteRequestedAt, 'eligibility must be invalidated before storage I/O'); calls.push('storage-delete'); if (deletionFails) throw new Error('secret-storage-token') }
} })
for (const method of ['GET', 'PATCH', 'DELETE'] as const) app.route({ method, url: '/businesses/:businessId/instagram-publications/:publicationId/schedule', handler: () => ({ forbidden: true }) })
const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, actor = 'admin', payload?: any) => app.inject({ method, url: path,
  headers: { cookie: 'salon_ai_session=' + actor }, ...(payload === undefined ? {} : { payload }) })
try {
  for (const action of ['schedule', 'cancel']) {
    const url = '/businesses/a/instagram-publications/p/' + action
    const body = action === 'schedule' ? { scheduledAt: '2026-10-27T12:00:00Z', expectedRevision: 2 } : { expectedRevision: 2 }
    assert.equal((await request('POST', url, 'admin', body)).statusCode, 200)
    assert.deepEqual(calls.at(-1), action === 'schedule' ? [action, 'a', 'p', body] : [action, 'a', 'p', 2])
    const before = calls.length
    for (const actor of ['', 'staff', 'foreign']) assert.ok([401,403].includes((await request('POST', url, actor, body)).statusCode))
    assert.equal((await request('POST', url.replace('/a/', '/b/'), 'admin', body)).statusCode, 403)
    assert.equal(calls.length, before)
    for (const [error, status] of [[new InstagramPublicationConflictError(),409], [new InstagramPublicationValidationError(['fecha inválida']),400], [new Error('secret-token'),503]] as const) {
      failure = error
      const result = await request('POST', url, 'admin', body)
      assert.equal(result.statusCode, status); assert.ok(!result.body.includes('secret-token'))
    }
    failure = null
  }
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) assert.equal((await request(method, '/businesses/a/instagram-publications/p/schedule')).statusCode, 403)
  const get = await request('GET', '/businesses/a/instagram-publications/p')
  assert.equal(get.json().scheduledAt, publication.scheduledAt); assert.equal(get.json().revision, 2)
  deletionFails = true
  const failed = await request('DELETE', '/businesses/a/instagram-publications/p/video')
  assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('secret-storage-token'))
  assert.ok(publication.videoDeleteRequestedAt); assert.equal(publication.videoDeletedAt, null)
  deletionFails = false
  assert.equal((await request('DELETE', '/businesses/a/instagram-publications/p/video')).statusCode, 200)
  assert.deepEqual(calls.slice(-3), ['reserve', 'storage-delete', 'deleted'])
  console.log('OK: real schedule/cancel routes and guard: exact methods/tenant/role, DTO, errors and deletion invalidation before I/O')
} finally { await app.close(); restores.reverse().forEach((restore) => restore()); await prisma.$disconnect() }
