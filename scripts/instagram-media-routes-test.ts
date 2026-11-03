import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { prisma } = await import('../src/config/prisma.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { instagramMediaRoutes } = await import('../src/routes/instagram-media.js')
const { InstagramMediaError } = await import('../src/services/instagram-media-service.js')
const originals: Array<() => void> = []
function stub(target: any, key: string, implementation: any) { const original = target[key]; target[key] = implementation; originals.push(() => { target[key] = original }) }
const users = new Map(['admin', 'foreign', 'staff'].map((id) => [createHash('sha256').update(id).digest('hex'), {
  id, expiresAt: new Date('2100-01-01'), user: { id, role: id === 'staff' ? 'STAFF' : 'ACCOUNT_ADMIN', businessId: id === 'staff' ? 'business-a' : null, isActive: true, business: null }
}]))
stub(prisma.userSession, 'findUnique', async ({ where }: any) => users.get(where.tokenHash) ?? null)
stub(prisma.business, 'findFirst', async ({ where }: any) => !where.isDemo && where.id === 'business-a' && (!where.accountAdminId || where.accountAdminId === 'admin') ? { id: 'business-a' } : null)
stub(prisma.business, 'count', async ({ where }: any) => where.AND[0].accountAdminId === 'admin' && where.AND[1].id.in.every((id: string) => id === 'business-a') ? 1 : 0)
const calls: Array<{ operation: string; args: any[] }> = []
let failure: Error | null = null
const service = {
  async list(...args: any[]) { calls.push({ operation: 'list', args }); if (failure) throw failure; return { items: [], total: 0, accountId: 'account-a', linkedPublicationIds: [] } },
  async sync(...args: any[]) { calls.push({ operation: 'sync', args }); if (failure) throw failure; return { status: 'complete', imported: 0, continuation: null } },
  async history(...args: any[]) { calls.push({ operation: 'history', args }); if (failure) throw failure; return { items: [], total: 0 } }
}
const app = Fastify()
await authGuard(app)
await app.register(instagramMediaRoutes, { service })
// Canary routes prove that the actual ACCOUNT_ADMIN guard rejects neighboring paths/methods.
for (const [method, url] of [['DELETE', '/businesses/:businessId/instagram-media'], ['PATCH', '/businesses/:businessId/instagram-media/sync'], ['GET', '/businesses/:businessId/instagram-media/sync'], ['POST', '/businesses/:businessId/instagram-media/item/history'], ['POST', '/businesses/:businessId/instagram-media/sync/extra']] as const) {
  app.route({ method, url, handler: async () => ({ unintended: true }) })
}
const request = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, payload?: any, user = 'admin') => app.inject({ method, url, headers: { cookie: 'salon_ai_session=' + user }, ...(payload !== undefined ? { payload } : {}) })
const base = '/businesses/business-a/instagram-media'
try {
  assert.equal((await request('GET', base + '?kind=REELS&sort=reach&limit=5&offset=10&from=2026-01-01&to=2026-12-31')).statusCode, 200)
  assert.equal(calls.at(-1)?.args[0], 'business-a')
  assert.equal(calls.at(-1)?.args[1].kind, 'REELS')
  assert.equal(calls.at(-1)?.args[1].limit, 5)
  assert.equal(calls.at(-1)?.args[1].from.toISOString(), '2026-01-01T00:00:00.000Z')
  for (const [value, expected] of [['2026-01-01T00:30:00+03:00', '2025-12-31T21:30:00.000Z'], ['2026-12-31T23:30:00-03:00', '2027-01-01T02:30:00.000Z'], ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z']]) {
    assert.equal((await request('GET', base + '?from=' + encodeURIComponent(value!))).statusCode, 200)
    assert.equal(calls.at(-1)?.args[1].from.toISOString(), expected)
  }
  assert.equal((await request('POST', base + '/sync')).statusCode, 200)
  assert.equal((await request('POST', base + '/sync', { continuation: '12345678-1234-4234-8234-123456789abc' })).statusCode, 200)
  assert.equal(calls.at(-1)?.args[1], '12345678-1234-4234-8234-123456789abc')
  assert.equal((await request('GET', base + '/catalogue-id/history?limit=5&offset=1')).statusCode, 200)
  assert.deepEqual(calls.at(-1)?.args, ['business-a', 'catalogue-id', 5, 1])
  const beforeInvalid = calls.length
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'sort=accessToken', 'kind=VIDEO', 'from=oops', 'from=2026-02-30', 'from=2026-12-31&to=2026-01-01', 'from=2026-10-24T10:00:00', 'to=2026-10-24T10:00', 'from=2026-10-24T10:00:00.000']) {
    assert.equal((await request('GET', base + '?' + query)).statusCode, 400, query)
  }
  for (const body of [{ continuation: 'https://evil.test/' }, { continuation: 123 }, []]) assert.equal((await request('POST', base + '/sync', body)).statusCode, 400)
  assert.equal(calls.length, beforeInvalid, 'invalid input never reaches the service/provider')
  for (const [method, suffix] of [['GET', ''], ['POST', '/sync'], ['GET', '/item/history']] as const) {
    for (const actor of ['foreign', 'staff', '']) assert.ok([401, 403].includes((await request(method, base + suffix, undefined, actor)).statusCode))
    assert.equal((await request(method, '/businesses/business-b/instagram-media' + suffix)).statusCode, 403)
  }
  assert.equal(calls.length, beforeInvalid, 'unauthorized roles/businesses never reach the service')
  for (const [method, suffix] of [['DELETE', ''], ['PATCH', '/sync'], ['GET', '/sync'], ['POST', '/item/history'], ['POST', '/sync/extra']] as const) assert.equal((await request(method, base + suffix)).statusCode, 403)
  failure = new Error('Provider echoed private-token app-secret')
  const rejected = await request('POST', base + '/sync')
  assert.equal(rejected.statusCode, 503)
  assert.ok(!rejected.body.includes('private-token') && !rejected.body.includes('app-secret'))
  failure = new InstagramMediaError(409, 'La continuacion cambio.')
  assert.equal((await request('POST', base + '/sync')).statusCode, 409)
  failure = new InstagramMediaError(404, 'Contenido no encontrado.')
  assert.equal((await request('GET', base + '/foreign/history')).statusCode, 404)
  console.log('OK: actual media routes and auth guard, exact methods, assigned-business scope, validated filters/continuation and sanitized failures')
} finally {
  await app.close(); originals.reverse().forEach((restore) => restore()); await prisma.$disconnect()
}
