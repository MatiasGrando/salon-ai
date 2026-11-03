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
const originalBusinessUnique = prisma.business.findUnique
const originalQueryRaw = prisma.$queryRaw
const originalFetch = globalThis.fetch
let providerCalls = 0
;(prisma.userSession as any).findUnique = async () => ({ id: 'session', expiresAt: new Date('2100-01-01'), user: { id: 'admin', role: 'SUPER_ADMIN', businessId: null, business: null, isActive: true } })
;(prisma.businessInstagramConfig as any).findUnique = async () => null
;(prisma.business as any).findFirst = async () => ({ id: 'business-a' })
;(prisma.business as any).count = async () => 1
;(prisma.business as any).findUnique = async () => ({ timezone: 'UTC', instagramConfig: null })
;(prisma as any).$queryRaw = async (query: any) => query.text.includes('COUNT(*)') ? [{ total: 0 }] : []
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
  const calendar = await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-calendar?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z', headers: { cookie: 'salon_ai_session=fake-local-session' } })
  assert.equal(calendar.statusCode, 200, 'cached calendar also remains readable independently from publication storage/runtime')
  assert.equal(calendar.json().total, 0)
  const duplicate = await app.inject({ method: 'POST', url: '/businesses/business-a/instagram-publications/local/duplicate', headers: { cookie: 'salon_ai_session=fake-local-session' } })
  assert.equal(duplicate.statusCode, 503, 'the real server keeps storage-copy writes behind the existing publication runtime gate')
  assert.equal(providerCalls, 0, 'neither boot nor cached GET may synchronize the provider')
  process.env.SUPABASE_URL='https://story-storage.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fake-only-key'
  let storageCalls=0
  globalThis.fetch=async(url,options)=>{storageCalls++;assert.ok(String(url).startsWith('https://story-storage.invalid/storage/v1/object/upload/sign/'));return Response.json({url:'/object/upload/sign/instagram-reels/business-a/instagram/stories/12345678-1234-4234-8234-123456789abc.jpg?token=fake'})}
  for(const storiesReady of [false,true]){
    const gatedApp=await buildApp({authorizationProviders:createAuthorizationProviderFakes().providers,botOptionsConfig:resolveBotOptionsConfig({}),instagramReelsRuntime:{ready:true,storiesReady,businessIds:['business-a'],async stop(){}}})
    try{
      const before=storageCalls,write=await gatedApp.inject({method:'POST',url:'/businesses/business-a/instagram-stories/uploads',headers:{cookie:'salon_ai_session=fake-local-session'},payload:{mimeType:'image/jpeg',sizeBytes:100}})
      assert.equal(write.statusCode,storiesReady?200:503,'Stories rollout is separate from an enabled Reel runtime')
      assert.equal(storageCalls-before,storiesReady?1:0,'disabled Stories cannot reach storage')
    }finally{await gatedApp.close()}
  }
  console.log('OK: real server requires independent Story rollout and permits manual source preparation without Meta credentials')
  console.log('OK: real server exposes cached Instagram catalogue with publication storage OFF and no boot/provider calls')
} finally {
  await app.close()
  ;(prisma.userSession as any).findUnique = originalSession
  ;(prisma.businessInstagramConfig as any).findUnique = originalConfig
  ;(prisma.business as any).findFirst = originalBusiness
  ;(prisma.business as any).count = originalCount
  ;(prisma.business as any).findUnique = originalBusinessUnique
  ;(prisma as any).$queryRaw = originalQueryRaw
  globalThis.fetch = originalFetch
  await prisma.$disconnect()
}
