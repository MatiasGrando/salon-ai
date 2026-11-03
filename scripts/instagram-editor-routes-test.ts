import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH = '__instagram_editor_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { prisma } = await import('../src/config/prisma.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { instagramCalendarRoutes } = await import('../src/routes/instagram-calendar.js')
const { instagramStoriesRoutes } = await import('../src/routes/instagram-stories.js')
const { instagramPublicationRoutes } = await import('../src/routes/instagram-publications.js')
const restores: Array<() => void> = []
function stub(target: any, key: string, value: any) { const before = target[key]; target[key] = value; restores.push(() => { target[key] = before }) }
const sessions = new Map(['admin', 'foreign', 'staff'].map((id) => [createHash('sha256').update(id).digest('hex'), { id, expiresAt: new Date('2100-01-01'),
  user: { id, role: id === 'staff' ? 'STAFF' : 'ACCOUNT_ADMIN', isActive: true, businessId: id === 'staff' ? 'a' : null, business: null } }]))
stub(prisma.userSession, 'findUnique', async ({ where }: any) => sessions.get(where.tokenHash) ?? null)
stub(prisma.business, 'findFirst', async ({ where }: any) => !where.isDemo && where.id === 'a' && (!where.accountAdminId || where.accountAdminId === 'admin') ? { id: 'a' } : null)
stub(prisma.business, 'count', async ({ where }: any) => where.AND[0].accountAdminId === 'admin' && where.AND[1].id.in.every((id: string) => id === 'a') ? 1 : 0)
const calls: any[] = []
let fail = false
const app = Fastify()
await authGuard(app)
await app.register(instagramCalendarRoutes, { calendar: {
  async list(...args: any[]) { calls.push(['list', ...args]); return { items: [], total: 0 } },
  async resolveTime(...args: any[]) { calls.push(['resolve', ...args]); return { candidates: [] } }
}, duplication: { async duplicate(...args: any[]) { calls.push(['duplicate', ...args]); if (fail) throw new Error('secret-provider-token'); return { requiresFile: true, publication: null } } } })
const service: any = { async createDraft(input: any) { calls.push(['create', input]); return input }, async updateDraft(...args: any[]) { calls.push(['edit', ...args]); return {} },
  async get() { return { status: 'CANCELLED', businessId: 'a', videoObjectPath: 'path', videoMimeType: 'video/mp4', videoSizeBytes: 100 } },
  async publish(...args: any[]) { calls.push(['publish', ...args]); return { status: 'READY' } } }
await app.register(instagramPublicationRoutes, { service, storage: { async verifyUpload() { calls.push(['verify']); return {} } } as any })
const storyCalls: any[] = []
const storyRow = {id:'s',businessId:'a',publicationType:'STORY',deliveryMode:'MANUAL',mediaKind:'IMAGE',status:'DRAFT',revision:0,videoObjectPath:'a/instagram/stories/12345678-1234-4234-8234-123456789abc.jpg',videoMimeType:'image/jpeg',videoSizeBytes:100,caption:'Nota',videoAvailable:true}
await app.register(instagramStoriesRoutes,{runtimeReady:true,allowedBusinessIds:['a'],service:{
 async capability(...args:any[]){storyCalls.push(['capability',...args]);return{automatic:false,source:'unknown'}},
 async declare(...args:any[]){storyCalls.push(['declare',...args]);return{automatic:true,source:'operator_declared'}},
 async list(...args:any[]){storyCalls.push(['list',...args]);return[storyRow]},async get(...args:any[]){storyCalls.push(['get',...args]);return storyRow},
 async create(...args:any[]){storyCalls.push(['create',...args]);return storyRow},async update(...args:any[]){storyCalls.push(['update',...args]);return storyRow},
 async publish(...args:any[]){storyCalls.push(['publish',...args]);return{...storyRow,status:'READY'}},
 async schedule(...args:any[]){storyCalls.push(['schedule',...args]);return{...storyRow,status:'SCHEDULED'}},async cancel(...args:any[]){storyCalls.push(['cancel',...args]);return storyRow},async completeManual(...args:any[]){storyCalls.push(['complete',...args]);return{...storyRow,status:'MANUALLY_COMPLETED'}}
} as any,storage:{async createUpload(){storyCalls.push(['upload']);return{}},async verify(input:any){storyCalls.push(['verify',input]);return{mimeType:'image/jpeg',sizeBytes:100,signedUrl:'https://storage.invalid/fake?token=fake-only',expiresAt:new Date('2100-01-01')} as any}}})
for (const [method, url] of [['POST', '/businesses/:businessId/instagram-calendar'], ['PATCH', '/businesses/:businessId/instagram-media/:id/duplicate'],
  ['GET', '/businesses/:businessId/instagram-publications/:id/duplicate']] as const) app.route({ method, url, handler: () => ({ forbidden: true }) })
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, actor = 'admin', payload?: any) => app.inject({ method, url,
  headers: { cookie: 'salon_ai_session=' + actor }, ...(payload === undefined ? {} : { payload }) })
try {
  for (const ready of [false, true]) {
    const gated = Fastify(), attempted: any[] = []
    await gated.register(instagramCalendarRoutes, { runtimeReady: ready, allowedBusinessIds: ['a'],
      calendar: { async list() { return { items: [] } }, async resolveTime() { return { candidates: [] } } },
      duplication: { async duplicate(...args: any[]) { attempted.push(args); return {} } } })
    const denied = await gated.inject({ method: 'POST', url: '/businesses/' + (ready ? 'b' : 'a') + '/instagram-publications/p/duplicate' })
    assert.equal(denied.statusCode, ready ? 404 : 503, 'file duplication preserves publication runtime/storage and rollout gates')
    assert.equal(attempted.length, 0)
    assert.equal((await gated.inject('/businesses/a/instagram-calendar')).statusCode, 200, 'cached reads stay independent from write gates')
    await gated.close()
  }
  const endpoints: Array<['GET' | 'POST', string]> = [['GET', '/businesses/a/instagram-calendar?from=x&to=y'], ['GET', '/businesses/a/instagram-calendar/time-options?date=2026-11-01&minute=90'],
    ['POST', '/businesses/a/instagram-media/m/duplicate'], ['POST', '/businesses/a/instagram-publications/p/duplicate']]
  for (const [method, url] of endpoints) {
    assert.equal((await request(method, url, 'admin', method === 'POST' ? { expectedRevision: 2 } : undefined)).statusCode, 200)
    const before = calls.length
    for (const actor of ['', 'foreign', 'staff']) assert.ok([401,403].includes((await request(method, url, actor)).statusCode))
    assert.equal((await request(method, url.replace('/a/', '/b/'))).statusCode, 403); assert.equal(calls.length, before)
  }
  for (const [method, url] of [['POST', '/businesses/a/instagram-calendar'], ['PATCH', '/businesses/a/instagram-media/m/duplicate'], ['GET', '/businesses/a/instagram-publications/p/duplicate']] as const) assert.equal((await request(method, url)).statusCode, 403)
  for (const [method,url] of [['GET','/businesses/a/instagram-stories'],['GET','/businesses/a/instagram-stories/capability'],['GET','/businesses/a/instagram-stories/s'],['GET','/businesses/a/instagram-stories/s/download'],['POST','/businesses/a/instagram-stories/s/publish'],['POST','/businesses/a/instagram-stories/s/schedule'],['POST','/businesses/a/instagram-stories/s/cancel']] as const) {
    assert.equal((await request(method,url,'admin',method==='POST'?{expectedRevision:0,scheduledAt:'2026-11-01T12:00:00Z'}:undefined)).statusCode,200,url)
    const before=storyCalls.length
    for(const actor of ['','foreign','staff'])assert.ok([401,403].includes((await request(method,url,actor,method==='POST'?{expectedRevision:0}:undefined)).statusCode))
    assert.equal((await request(method,url.replace('/a/','/b/'))).statusCode,403)
    assert.equal(storyCalls.length,before,'authorization runs before Story storage/service')
  }
  assert.equal((await request('POST','/businesses/a/instagram-stories/capability','admin',{enabled:true})).statusCode,400)
  assert.equal((await request('POST','/businesses/a/instagram-stories/capability','admin',{enabled:true,acknowledged:true,declaredBy:'spoof',storiesDeclarationFingerprint:'spoof'})).statusCode,200)
  assert.deepEqual(storyCalls.at(-1),['declare','a','admin',true],'actor comes exclusively from the authenticated session')
  assert.equal((await request('POST','/businesses/a/instagram-stories/s/complete-manual','admin',{expectedRevision:0})).statusCode,400)
  assert.equal((await request('POST','/businesses/a/instagram-stories/s/complete-manual','admin',{expectedRevision:0,confirmed:true})).statusCode,200)
  const downloaded=await request('GET','/businesses/a/instagram-stories/s/download')
  assert.equal(downloaded.headers['cache-control'],'no-store');assert.equal(storyCalls.at(-1)[1].readOnly,true)
  const disabled=Fastify()
  await disabled.register(instagramStoriesRoutes,{runtimeReady:false,service:{async capability(){return{automatic:false}},async list(){return[]}} as any})
  assert.equal((await disabled.inject('/businesses/a/instagram-stories')).statusCode,200)
  assert.equal((await disabled.inject({method:'POST',url:'/businesses/a/instagram-stories',payload:{}})).statusCode,503)
  await disabled.close()
  console.log('OK: actual Stories route guards, tenant/read/write gates, authenticated declaration and private download')
  fail = true
  const failed = await request('POST', '/businesses/a/instagram-publications/p/duplicate')
  assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('secret-provider-token'))
  await request('POST', '/businesses/a/instagram-publications', 'admin', { videoObjectPath: 'file', videoMimeType: 'video/mp4', videoSizeBytes: 100 })
  assert.equal(calls.at(-1)[1].automation.enabled, false, 'omitted automation stays disabled at the real route boundary')
  await request('PATCH', '/businesses/a/instagram-publications/p', 'admin', { expectedRevision: 7, caption: 'Edit', automation: { publicReplyEnabled: true, publicReplyText: 'Public' } })
  assert.equal(calls.at(-1)[3].expectedRevision, 7); assert.equal(calls.at(-1)[3].automation.publicReplyEnabled, true)
  await request('POST', '/businesses/a/instagram-publications/p/publish', 'admin', { expectedRevision: 7 })
  assert.deepEqual(calls.slice(-2), [['verify'], ['publish', 'a', 'p', 7]])
  console.log('OK: actual calendar/time/duplication guards, tenant/method isolation, provider-error redaction and optional/revision publication routes')
} finally { await app.close(); restores.reverse().forEach((restore) => restore()); await prisma.$disconnect() }
