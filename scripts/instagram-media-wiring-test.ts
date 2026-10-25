import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
process.env.JITI_FS_CACHE = 'false'
const { prisma } = await import('../src/config/prisma.js')
const { buildApp } = await import('../src/server.js')
const { resolveBotOptionsConfig } = await import('../src/config/bot-options.js')
const { createAuthorizationProviderFakes } = await import('../src/providers/authorization-provider-fakes.js')
const originalSession = prisma.userSession.findUnique
const originalConfig = prisma.businessInstagramConfig.findUnique
const originalBusiness = prisma.business.findFirst
const originalCount = prisma.business.count
const originalFetch = globalThis.fetch
let providerCalls = 0
;(prisma.userSession as any).findUnique = async () => ({ id: 'session', expiresAt: new Date('2100-01-01'), user: { id: 'admin', role: 'SUPER_ADMIN', businessId: null, business: null, isActive: true } })
;(prisma.businessInstagramConfig as any).findUnique = async () => null
;(prisma.business as any).findFirst = async () => ({ id: 'business-a' })
;(prisma.business as any).count = async () => 1
globalThis.fetch = async () => { providerCalls++; throw new Error('Unexpected external request') }
const app = await buildApp({
  authorizationProviders: createAuthorizationProviderFakes().providers,
  botOptionsConfig: resolveBotOptionsConfig({}),
  instagramReelsRuntime: { ready: false, async stop() {} }
})
try {
  const result = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-media', headers: { cookie: 'salon_ai_session=fake-local-session' } })
  assert.equal(result.statusCode, 200, 'cached Instagram catalogue must be available with publication storage/runtime OFF')
  assert.deepEqual(result.json().items, [])
  assert.equal(result.json().accountId, null)
  assert.equal(providerCalls, 0, 'neither boot nor cached GET may synchronize the provider')
  console.log('OK: real server exposes cached Instagram catalogue with publication storage OFF and no boot/provider calls')
} finally {
  await app.close()
  ;(prisma.userSession as any).findUnique = originalSession
  ;(prisma.businessInstagramConfig as any).findUnique = originalConfig
  ;(prisma.business as any).findFirst = originalBusiness
  ;(prisma.business as any).count = originalCount
  globalThis.fetch = originalFetch
  await prisma.$disconnect()
}
