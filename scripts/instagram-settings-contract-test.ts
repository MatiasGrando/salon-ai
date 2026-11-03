import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'

// Offline contracts must never load local credentials or open a database connection.
process.env.DOTENV_CONFIG_PATH = '__instagram_contract_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { prisma } = await import('../src/config/prisma.js')
const { InstagramApi } = await import('../src/integrations/instagram-api.js')
const { instagramSettingsRoutes } = await import('../src/routes/instagram-settings.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')

const secret = 'contract-access-token'
const appSecret = '0123456789abcdef0123456789abcdef'
let settings: any = null
let apiFailure = false
let saveFailure = false
const calls: Array<{ accountId: string; accessToken: string }> = []
const updates: any[] = []
const originals: Array<() => void> = []
function stub(target: any, key: string, value: any) {
  const original = target[key]
  target[key] = value
  originals.push(() => { target[key] = original })
}
function configured() {
  return { businessId: 'business-a', instagramAccountId: 'professional-account', apiAccountId: 'app-scoped-account', username: 'salon', accessToken: secret, appSecret,
    tokenExpiresAt: null, enabled: true, connectedAt: new Date('2026-01-01'), lastError: 'Falta WhatsApp publico' }
}
stub(prisma.business, 'findUnique', async ({ where }: any) => where.id === 'missing' ? null : ({
  id: where.id, publicWhatsapp: '5491100000000', instagramConfig: settings
}))
stub(prisma.business, 'findFirst', async ({ where }: any) => where.accountAdminId === 'admin' && where.id === 'business-a' ? { id: where.id } : null)
stub(prisma.businessInstagramConfig, 'findUnique', async () => settings)
stub(prisma.businessInstagramConfig, 'upsert', async ({ create, update }: any) => {
  if (saveFailure) throw new Error('Database rejected ' + secret + ' ' + appSecret)
  settings = { ...(settings ?? create), ...(settings ? update : {}) }; updates.push(update); return settings
})
stub(prisma.businessInstagramConfig, 'update', async ({ data }: any) => { settings = { ...settings, ...data }; updates.push(data); return settings })
stub(InstagramApi.prototype, 'getAccountById', async (input: any) => {
  calls.push(input)
  if (apiFailure) throw new Error('Provider rejected ' + secret + ' ' + appSecret)
  return { id: 'app-scoped-account', username: 'salon', name: 'Salon' }
})
const app = Fastify()
app.addHook('preHandler', async (request) => {
  request.auth = { user: { id: 'admin', role: 'BUSINESS_ADMIN', businessId: 'business-a' } } as any
})
await app.register(instagramSettingsRoutes)
try {
  let result = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.json().connection.connected, false)
  assert.equal(calls.length, 0)
  assert.equal((await app.inject({ method: 'POST', url: '/businesses/business-a/instagram-settings/test' })).statusCode, 409)
  assert.equal(calls.length, 0, 'missing credentials must not call the provider')

  settings = configured()
  result = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })
  assert.equal(result.json().connection.verification?.status, 'not_checked', 'stored credentials must not claim a current verification')
  assert.equal(result.json().connection.expiry?.status, 'unknown')
  assert.equal(result.json().connection.connected, true, 'retain the legacy credential-presence contract')
  assert.equal(result.json().capabilities.length, 4)
  assert.ok(result.json().capabilities.every((item: any) => item.status === 'unknown'))
  assert.equal(calls.length, 0, 'GET only presents stored settings')

  for (const [date, expected] of [['2000-01-01', 'declared_expired'], ['2100-01-01', 'declared_future']]) {
    settings.tokenExpiresAt = new Date(date!)
    result = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })
    assert.equal(result.json().connection.expiry.status, expected)
    assert.equal(result.json().connection.expiry.source, 'manual')
  }
  settings = configured()
  const connectedAt = settings.connectedAt.toISOString()
  result = await app.inject({ method: 'POST', url: '/businesses/business-a/instagram-settings/test' })
  assert.equal(result.statusCode, 200)
  assert.equal(calls.at(-1)?.accountId, 'professional-account', 'test must target the saved account, never silently rebind from /me')
  assert.equal(result.json().connection.verification.status, 'verified')
  assert.ok(Number.isFinite(Date.parse(result.json().connection.verification.checkedAt)))
  assert.ok(result.json().capabilities.every((item: any) => item.status === 'unknown'), 'profile success proves no feature permission')
  assert.equal(settings.instagramAccountId, 'professional-account')
  assert.equal(settings.apiAccountId, 'app-scoped-account', 'app-scoped ID may legitimately differ')
  assert.equal(settings.connectedAt.toISOString(), connectedAt)
  assert.equal(settings.lastError, 'Falta WhatsApp publico', 'verification must not clear operational errors')
  assert.equal((await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })).json().connection.verification.status, 'not_checked', 'no persistent verification is invented')

  const before = JSON.stringify(settings)
  apiFailure = true
  result = await app.inject({ method: 'POST', url: '/businesses/business-a/instagram-settings/test' })
  assert.equal(result.statusCode, 400)
  assert.equal(JSON.stringify(settings), before, 'failed test must not mutate identity or lastError')
  assert.ok(!result.body.includes(secret) && !result.body.includes(appSecret), 'provider errors must not expose secrets')
  result = await app.inject({ method: 'PATCH', url: '/businesses/business-a/instagram-settings', payload: { accessToken: secret, appSecret } })
  assert.equal(result.statusCode, 400)
  assert.ok(!result.body.includes(secret) && !result.body.includes(appSecret))
  apiFailure = false
  result = await app.inject({ method: 'PATCH', url: '/businesses/business-a/instagram-settings', payload: { enabled: false } })
  assert.equal(result.statusCode, 200)
  assert.equal(result.json().connection.verification.status, 'verified')
  assert.equal(calls.at(-1)?.accountId, 'professional-account')
  for (const response of [result, await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })]) {
    assert.ok(!response.body.includes(secret) && !response.body.includes(appSecret))
  }
  saveFailure = true
  result = await app.inject({ method: 'PATCH', url: '/businesses/business-a/instagram-settings', payload: { enabled: false } })
  assert.equal(result.statusCode, 500)
  assert.ok(!result.body.includes(secret) && !result.body.includes(appSecret), 'database errors must not expose credentials either')
  saveFailure = false
  settings.lastError = 'Old provider error ' + secret + ' ' + appSecret
  result = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-settings' })
  assert.ok(!result.body.includes(secret) && !result.body.includes(appSecret), 'legacy operational messages must be redacted')
  const beforeCalls = calls.length
  const beforeWrites = updates.length
  for (const method of ['GET', 'POST', 'PATCH'] as const) {
    result = await app.inject({ method, url: '/businesses/business-b/instagram-settings' + (method === 'POST' ? '/test' : ''), ...(method === 'PATCH' ? { payload: {} } : {}) })
    assert.equal(result.statusCode, 403)
  }
  assert.equal(calls.length, beforeCalls)
  assert.equal(updates.length, beforeWrites)
  console.log('OK: settings, configured-account verification, expiry, isolation and redaction')
} finally {
  await app.close()
}

// Exercise the real authentication guard, including session and business scope resolution.
const sessions = new Map(['admin', 'foreign'].map((id) => [createHash('sha256').update(id).digest('hex'), {
  id, expiresAt: new Date('2100-01-01'), user: { id, role: 'ACCOUNT_ADMIN', businessId: null, isActive: true, business: null }
}]))
stub(prisma.userSession, 'findUnique', async ({ where }: any) => sessions.get(where.tokenHash) ?? null)
stub(prisma.business, 'count', async ({ where }: any) => where.AND[0].accountAdminId === 'admin' && where.AND[1].id.in.every((id: string) => id === 'business-a') ? 1 : 0)
const guarded = Fastify()
await authGuard(guarded)
await guarded.register(instagramSettingsRoutes)
for (const method of ['GET', 'PATCH', 'DELETE'] as const) guarded.route({ method, url: '/businesses/:id/instagram-settings/test', handler: async () => ({ unintended: true }) })
guarded.post('/businesses/:id/instagram-settings/test/extra', async () => ({ unintended: true }))
try {
  settings = configured()
  const beforeCalls = calls.length
  assert.equal((await guarded.inject({ method: 'POST', url: '/businesses/business-a/instagram-settings/test', headers: { cookie: 'salon_ai_session=admin' } })).statusCode, 200, 'assigned account admin can run the exact connection test')
  assert.equal(calls.length, beforeCalls + 1)
  for (const [id, url, expected] of [['foreign', '/businesses/business-a/instagram-settings/test', 403], ['admin', '/businesses/business-b/instagram-settings/test', 403], ['', '/businesses/business-a/instagram-settings/test', 401]] as const) {
    assert.equal((await guarded.inject({ method: 'POST', url, headers: { cookie: 'salon_ai_session=' + id } })).statusCode, expected)
  }
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) assert.equal((await guarded.inject({ method, url: '/businesses/business-a/instagram-settings/test', headers: { cookie: 'salon_ai_session=admin' } })).statusCode, 403)
  assert.equal((await guarded.inject({ method: 'POST', url: '/businesses/business-a/instagram-settings/test/extra', headers: { cookie: 'salon_ai_session=admin' } })).statusCode, 403)
  assert.equal(calls.length, beforeCalls + 1, 'denied requests never reach the provider')
  console.log('OK: real guard permits only the exact account-admin route and business')
} finally {
  await guarded.close()
  originals.reverse().forEach((restore) => restore())
  await prisma.$disconnect()
}
