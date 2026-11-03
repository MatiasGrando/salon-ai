import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH = '__instagram_comment_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { prisma } = await import('../src/config/prisma.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { instagramCommentAutomationRoutes } = await import('../src/routes/instagram-comment-automations.js')
const restores: Array<() => void> = []
function stub(target: any, name: string, value: any) { const original = target[name]; target[name] = value; restores.push(() => { target[name] = original }) }
const users = new Map(['admin', 'foreign', 'staff'].map((id) => [createHash('sha256').update(id).digest('hex'), { id, expiresAt: new Date('2100-01-01'),
  user: { id, role: id === 'staff' ? 'STAFF' : 'ACCOUNT_ADMIN', businessId: id === 'staff' ? 'business-a' : null, isActive: true, business: null } }]))
stub(prisma.userSession, 'findUnique', async ({ where }: any) => users.get(where.tokenHash) ?? null)
stub(prisma.business, 'findFirst', async ({ where }: any) => !where.isDemo && where.id === 'business-a' && (!where.accountAdminId || where.accountAdminId === 'admin') ? { id: 'business-a' } : null)
stub(prisma.business, 'count', async ({ where }: any) => where.AND[0].accountAdminId === 'admin' && where.AND[1].id.in.every((id: string) => id === 'business-a') ? 1 : 0)
const calls: any[] = []
let fail = false
const service = { async get(...args: any[]) { calls.push(args); if (fail) throw new Error('echo secret-token'); return { automation: null } },
  async save(...args: any[]) { calls.push(args); return { automation: { id: 'same-id' } } } }
const app = Fastify()
await authGuard(app)
await app.register(instagramCommentAutomationRoutes, { service, runtimeReady: true, allowedBusinessIds: ['business-a'] })
for (const method of ['POST', 'DELETE'] as const) app.route({ method, url: '/businesses/:businessId/instagram-media/:id/automation', handler: () => ({ forbidden: true }) })
const request = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, actor = 'admin', payload?: Record<string, unknown>) => app.inject({ method, url,
  headers: { cookie: 'salon_ai_session=' + actor }, ...(payload === undefined ? {} : { payload }) })
try {
  for (const kind of ['media', 'publications']) {
    const url = '/businesses/business-a/instagram-' + kind + '/target-a/automation'
    assert.equal((await request('GET', url)).statusCode, 200)
    assert.deepEqual(calls.at(-1), ['business-a', kind === 'media' ? { mediaId: 'target-a' } : { publicationId: 'target-a' }])
    assert.equal((await request('PATCH', url, 'admin', { publicReplyEnabled: true })).statusCode, 200)
    const before = calls.length
    for (const actor of ['', 'staff', 'foreign']) for (const method of ['GET', 'PATCH'] as const) assert.ok([401,403].includes((await request(method, url, actor, method === 'PATCH' ? {} : undefined)).statusCode))
    assert.equal((await request('GET', url.replace('business-a','business-b'))).statusCode, 403)
    assert.equal(calls.length, before, 'real auth guard rejects tenants and roles before the service')
  }
  for (const method of ['POST', 'DELETE'] as const) assert.equal((await request(method, '/businesses/business-a/instagram-media/target-a/automation')).statusCode, 403)
  fail = true
  const failed = await request('GET', '/businesses/business-a/instagram-media/target-a/automation')
  assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('secret-token'))
  const disabled = Fastify()
  await disabled.register(instagramCommentAutomationRoutes, { service, runtimeReady: false })
  assert.equal((await disabled.inject('/businesses/business-a/instagram-media/m/automation')).statusCode, 503)
  await disabled.close()
  console.log('OK: actual configuration routes/auth guard share target contract, exact methods, role/business isolation and sanitized errors')
} finally { await app.close(); restores.reverse().forEach((restore) => restore()); await prisma.$disconnect() }
