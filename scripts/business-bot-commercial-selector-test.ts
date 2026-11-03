import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.DOTENV_CONFIG_PATH = '__commercial_bot_selector_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/commercial_selector'
process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED = 'true'
process.env.OPENAI_API_KEY = 'synthetic-not-a-real-key'
const { prisma } = await import('../src/config/prisma.js')
const { businessBotRoutingService: service } = await import('../src/services/business-bot-routing-service.js')
const { businessBotRoutingRoutes } = await import('../src/routes/business-bot-routing.js')
const { default: Fastify } = await import('fastify')
let passed = 0, failed = 0
async function check(name: string, run: () => any) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const marker = { schemaVersion: 1, engine: 'conversational-booking-v1' }
const content = { businessId: 'b', schemaVersion: 1, items: [{ serviceId: 'cut', description: 'Synthetic' }] }
function cfg(id: string, variant: string, overrides = {}) {
  return { id, businessId: 'b', botKey: id, name: id, version: 'v1', mode: 'OPTIONS_ONLY', status: 'ACTIVE', channel: 'UNASSIGNED', routingMode: 'EXCLUSIVE', phoneNumberId: 'phone', displayPhoneNumber: 'display',
    definition: { schemaVersion: 1, engineKey: 'deterministic-options', serviceContent: content, ...(variant === 'conversational' ? { conversation: marker } : {}) }, ...overrides }
}
function fixture(configurations: any[] = [], active: string | null = null) {
  const writes: any[] = [], raw: any[] = []
  const pointer: any = { id: 'deployment', engineKey: active ? 'deterministic-options' : 'legacy-whatsapp', activeConfigurationId: active, generation: active ? 3 : 0, claimsPausedAt: null }
  const whatsapp = { connectionStatus: 'CONNECTED', phoneNumberId: 'phone', displayPhoneNumber: 'display', accessToken: 'synthetic', wabaId: 'waba', appSecret: 'synthetic' }
  const db: any = {
    botChannelDeployment: { findUnique: async () => pointer },
    businessBotConfiguration: {
      findMany: async ({ where }: any) => configurations.filter(c => c.businessId === where.businessId && (!where.status || c.status === where.status) && (!where.routingMode || c.routingMode === where.routingMode)),
      findUnique: async ({ where }: any) => configurations.find(c => where.businessId_botKey ? c.businessId === where.businessId_botKey.businessId && c.botKey === where.businessId_botKey.botKey : c.id === where.id) ?? null,
      findFirst: async ({ where }: any) => configurations.find(c => c.id === where.id && c.businessId === where.businessId) ?? null,
      create: async ({ data }: any) => { const value = { ...structuredClone(data), id: 'new-' + configurations.length }; configurations.push(value); writes.push({ type: 'create', value }); return value },
      upsert: async (input: any) => { writes.push({ type: 'upsert', input }); const found = configurations.find(c => c.botKey === input.where.businessId_botKey.botKey); if (found) { Object.assign(found, input.update); return found }; const value = { ...input.create, id: 'old-upsert' }; configurations.push(value); return value }
    },
    businessBotOptionsSettings: { findUnique: async () => ({ timezone: 'America/Argentina/Buenos_Aires' }), upsert: async (input: any) => { writes.push({ type: 'settings', input }); return input.create } },
    businessWhatsAppConfig: { findUnique: async () => whatsapp }, botDeploymentAudit: { findMany: async () => [] },
    $executeRaw: async (query: any) => { raw.push(query); return 1 }, $queryRaw: async () => [{ id: 'target' }]
  }
  for (const key of Object.keys(db)) (prisma as any)[key] = db[key]
  ;(prisma as any).$transaction = async (run: any) => run(db)
  return { configurations, pointer, whatsapp, writes, raw }
}
const prepare = (variant?: string) => service.prepare({ businessId: 'b', timezone: 'America/Argentina/Buenos_Aires', actorId: 'admin', ...(variant ? { variant } : {}) } as never)
await check('state classifies both variants and excludes malformed or unrelated engines', async () => {
  fixture([cfg('options', 'options'), cfg('new', 'conversational'), cfg('bad', 'conversational', { definition: { schemaVersion: 1, engineKey: 'deterministic-options', conversation: { ...marker, extra: true } } }), cfg('support', 'options', { definition: { engineKey: 'support' } })], 'new')
  const state: any = await service.state({ businessId: 'b' })
  assert.deepEqual(state.configurations.map((c: any) => [c.id, c.variant]), [['options', 'options'], ['new', 'conversational']])
  assert.equal(state.activeVariant, 'conversational')
  assert.equal(state.preparation.conversationalAiReady, true)
  assert(!JSON.stringify(state).includes('synthetic-not-a-real-key'))
})
await check('prepare conversational never overwrites active pilot marker under old options key', async () => {
  const pilot = cfg('pilot', 'conversational', { botKey: 'deterministic-options' })
  const before = structuredClone(pilot), f = fixture([pilot], 'pilot')
  const result: any = await prepare('conversational')
  assert.equal(result.id, 'pilot'); assert.equal(result.variant, 'conversational')
  assert.deepEqual(pilot, before); assert.equal(f.writes.filter(w => w.type !== 'settings').length, 0)
})
await check('prepare missing options creates separate definition, preserving pilot and service content', async () => {
  const pilot = cfg('pilot', 'conversational', { botKey: 'deterministic-options' })
  const before = structuredClone(pilot), f = fixture([pilot], 'pilot')
  const result: any = await prepare('options')
  assert.notEqual(result.id, pilot.id); assert.equal(result.variant, 'options')
  const created = f.configurations.find(c => c.id === result.id)!
  assert.notEqual(created.botKey, pilot.botKey); assert.equal(Object.hasOwn(created.definition, 'conversation'), false)
  assert.deepEqual(created.definition.serviceContent, content); assert.deepEqual(pilot, before)
  assert.equal(f.pointer.activeConfigurationId, 'pilot')
})
await check('options opt-in retains Glow configuration and conversation opt-in copies without changing it', async () => {
  const options = cfg('glow', 'options', { botKey: 'deterministic-options' })
  const before = structuredClone(options), f = fixture([options], 'glow')
  assert.equal((await prepare()).id, 'glow')
  const result: any = await prepare('conversational')
  assert.notEqual(result.id, 'glow'); assert.equal(result.variant, 'conversational')
  const created = f.configurations.find(c => c.id === result.id)!
  assert.deepEqual(created.definition.conversation, marker); assert.deepEqual(created.definition.serviceContent, content)
  assert.deepEqual(options, before); assert.equal(f.pointer.activeConfigurationId, 'glow')
})
await check('repeated preparation reuses configuration and never edits its custom definition', async () => {
  const f = fixture()
  const first: any = await prepare('conversational'), snapshot = structuredClone(f.configurations)
  const second: any = await prepare('conversational')
  assert.equal(first.id, second.id); assert.deepEqual(f.configurations, snapshot)
  assert.equal(f.writes.filter(w => w.type === 'create').length, 1)
  assert(f.raw.some(q => String(q.strings).includes('pg_advisory_xact_lock')))
})
await check('preparation rejects changed phone, malformed marker, paused scope and invalid variant', async () => {
  fixture([cfg('options', 'options', { phoneNumberId: 'another-phone' })], 'options')
  await assert.rejects(() => prepare('options'), /preparad|configuraci|tel.fono/i)
  const f = fixture(); f.pointer.claimsPausedAt = new Date()
  await assert.rejects(() => prepare('options'), /paus/i)
  fixture(); await assert.rejects(() => prepare('unsupported'), /variante/i)
})
await check('no public selection of legacy, another tenant, inactive or malformed configuration', async () => {
  fixture([cfg('foreign', 'options', { businessId: 'other' }), cfg('bad', 'conversational', { definition: { schemaVersion: 1, engineKey: 'deterministic-options', conversation: null } }), cfg('draft', 'options', { status: 'DRAFT' })])
  for (const target of ['legacy-whatsapp', 'foreign', 'bad', 'draft']) await assert.rejects(() => service.preflight({ businessId: 'b', expectedGeneration: 0, actorId: 'admin', target }), /configuraci|selecci|legad/i)
})
await check('new bot preflight requires actual WhatsApp AI flag and credential before pausing', async () => {
  for (const [flag, key] of [['false', 'synthetic'], ['true', ''], ['true', '   ']]) {
    process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED = flag; process.env.OPENAI_API_KEY = key
    const f = fixture([cfg('new', 'conversational')])
    await assert.rejects(() => service.preflight({ businessId: 'b', expectedGeneration: 0, actorId: 'admin', target: 'new' }), /IA/i)
    assert.equal(f.raw.length, 0, 'no attestation, pause or routing mutation before AI readiness')
    const state: any = await service.state({ businessId: 'b' }); assert.equal(state.preparation.conversationalAiReady, false)
  }
  process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'synthetic-not-a-real-key'
})
await check('commit rechecks readiness and refuses a foreign handle before routing operations', async () => {
  const f = fixture([cfg('new', 'conversational')]); process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED = 'false'
  await assert.rejects(() => service.commit({ businessId: 'b', target: 'new', actorId: 'admin', handle: { businessId: 'b', deploymentId: 'd', generation: 1, fenceEpoch: 2, pausedAt: new Date() } }), /IA/i)
  assert.equal(f.raw.length, 0)
  await assert.rejects(() => service.commit({ businessId: 'b', target: 'new', actorId: 'admin', handle: { businessId: 'other', deploymentId: 'd', generation: 1, fenceEpoch: 2, pausedAt: new Date() } }), /another business/)
  process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED = 'true'
})
await check('API forwards explicit variant, defaults previous clients to options and rejects invalid values', async () => {
  const calls: any[] = [], app = Fastify()
  app.addHook('preHandler', async r => { (r as any).auth = { user: { id: 'admin', businessId: 'b', role: 'BUSINESS_ADMIN' } } })
  await app.register(businessBotRoutingRoutes, { service: { ...service, prepare: async (input: any) => { calls.push(input); return { id: 'cfg', variant: input.variant } } } as any })
  const request = (variant?: any) => app.inject({ method: 'POST', url: '/crm/bot-routing/configurations/default', payload: { timezone: 'America/Argentina/Buenos_Aires', ...(variant === undefined ? {} : { variant }) } })
  assert.equal((await request('conversational')).statusCode, 200); assert.equal(calls[0].variant, 'conversational')
  assert.equal((await request()).statusCode, 200); assert.equal(calls[1].variant, 'options')
  for (const value of ['booking-v2', '', null, 2, {}]) assert.equal((await request(value)).statusCode, 400)
  assert.equal(calls.length, 2); await app.close()
})
await check('API keeps STAFF out of state and every mutation and rejects cross-business admins', async () => {
  for (const role of ['STAFF', 'BUSINESS_ADMIN']) {
    const app = Fastify(); let calls = 0
    app.addHook('preHandler', async r => { (r as any).auth = { user: { id: 'user', businessId: role === 'STAFF' ? 'b' : 'other', role } } })
    await app.register(businessBotRoutingRoutes, { service: new Proxy({}, { get: () => async () => { calls++; return {} } }) as any })
    for (const [method, path] of [['GET', ''], ['POST', '/configurations/default'], ['POST', '/preflight'], ['POST', '/commit'], ['POST', '/abort']]) {
      const response = await app.inject({ method: method as any, url: '/crm/bot-routing' + path + '?businessId=b', ...(method === 'POST' ? { payload: { businessId: 'b', timezone: 'America/Argentina/Buenos_Aires', variant: 'conversational' } } : {}) })
      assert.equal(response.statusCode, 403)
    }
    assert.equal(calls, 0); await app.close()
  }
})
await check('CRM has only the two public variants and no legacy toggle or settings write', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8')
  assert(!source.includes('id="booking-v2-toggle"')); assert(!source.includes('function toggleBookingV2'))
  const render = source.slice(source.indexOf('function renderBotRoutingControl()'), source.indexOf('async function prepareDefaultBotRouting()'))
  assert(render.includes("variant: 'options'")); assert(render.includes("variant: 'conversational'"))
  assert(!render.includes("legacyOption")); assert(!render.includes("option.value = 'legacy-whatsapp'"))
  assert.match(source, /const variant = els\.botRoutingSelector\.value/)
  assert.match(source, /JSON\.stringify\(\{ businessId, timezone, variant \}\)/)
  assert(!/bookingV2Enabled:\s*nextValue/.test(source))
  assert.match(source, /bot-routing-panel/); assert.match(source, /aria-describedby="bot-routing-help"/)
})
await check('reserved-key mismatch fails closed instead of editing an existing configuration', async () => {
  const malformed = cfg('collision', 'conversational', { botKey: 'commercial-conversational-v1', definition: { schemaVersion: 1, engineKey: 'deterministic-options', conversation: { ...marker, extra: true } } })
  const snapshot = structuredClone(malformed), f = fixture([malformed])
  await assert.rejects(() => prepare('conversational'), /no coincide/)
  assert.deepEqual(malformed, snapshot); assert.equal(f.writes.length, 0)
})
await check('CRM initially selects active variant, preserves an explicit choice, and scopes it per business', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8')
  const start = source.indexOf('    function routingConfigurationForVariant('), end = source.indexOf('    async function prepareDefaultBotRouting()', start)
  const state: any = { businessId: 'b', currentUser: { role: 'BUSINESS_ADMIN' }, aiSettings: { bookingV2Enabled: false }, botRouting: { engineKey: 'deterministic-options', activeConfigurationId: 'new', activeVariant: 'conversational', generation: 3,
    configurations: [{ id: 'options', variant: 'options' }, { id: 'new', variant: 'conversational' }], preparation: { ready: true, conversationalAiReady: true, hasAppSecret: true, hasTimezone: true, whatsappReady: true } } }
  const element = (value = ''): any => ({ value, textContent: '', disabled: false, hidden: false, className: '', children: [], replaceChildren() { this.children = []; this.value = '' }, appendChild(option: any) { this.children.push(option); if (!this.value) this.value = option.value } })
  const els: any = Object.fromEntries(['botRoutingControl', 'botRoutingStatus', 'botRoutingTimezone', 'botRoutingReadiness', 'botRoutingPrepare', 'botRoutingPreflight'].map(key => [key, element()]))
  els.botRoutingSelector = element('options')
  const help = element(), document = { createElement: () => element(), getElementById: () => help }
  const api = new Function('state', 'els', 'document', source.slice(start, end) + '; return { renderBotRoutingControl, updateBotRoutingSelection };')(state, els, document)
  api.renderBotRoutingControl(); assert.equal(els.botRoutingSelector.value, 'conversational'); assert.equal(els.botRoutingPreflight.disabled, true)
  assert.deepEqual(els.botRoutingSelector.children.map((choice: any) => choice.value), ['options', 'conversational'])
  els.botRoutingSelector.value = 'options'; api.renderBotRoutingControl(); assert.equal(els.botRoutingSelector.value, 'options'); assert.equal(els.botRoutingPreflight.disabled, false)
  state.businessId = 'another'; api.renderBotRoutingControl(); assert.equal(els.botRoutingSelector.value, 'conversational')
  state.botRouting = { ...state.botRouting, engineKey: 'legacy-whatsapp', activeVariant: null, activeConfigurationId: null }; state.businessId = 'legacy'
  api.renderBotRoutingControl(); assert.match(els.botRoutingStatus.textContent, /Bot anterior/); assert.doesNotMatch(els.botRoutingStatus.textContent, /Booking V2/)
  state.aiSettings.bookingV2Enabled = true; api.renderBotRoutingControl(); assert.match(els.botRoutingStatus.textContent, /Booking V2/)
  els.botRoutingSelector.value = 'conversational'; state.botRouting.preparation.conversationalAiReady = false; api.updateBotRoutingSelection(); assert.equal(els.botRoutingPreflight.disabled, true); assert.match(els.botRoutingReadiness.textContent, /IA de WhatsApp/)
  state.currentUser.role = 'STAFF'; api.renderBotRoutingControl(); assert.equal(els.botRoutingControl.hidden, true)
})
await check('CRM cutover confirms configuration ID and aborts cancelled or blocked preflight', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8'), start = source.indexOf('    function routingCountsText('), end = source.indexOf('    async function toggleConversationAi()', start)
  for (const result of ['confirm', 'cancel', 'blocked']) {
    const calls: any[] = [], routing: any = { engineKey: 'legacy-whatsapp', activeConfigurationId: null, generation: 3, configurations: [{ id: 'cfg-new', variant: 'conversational' }] }
    const state: any = { businessId: 'b', botRouting: routing }, els: any = { botRoutingSelector: { value: 'conversational' }, botRoutingPreflight: {}, botRoutingEvidence: {} }
    const handle = { businessId: 'b', deploymentId: 'd', generation: 3, fenceEpoch: 4, pausedAt: '2026-10-18T12:00:00Z' }
    const getJson = async (path: string, options: any) => {
      const payload = options?.body ? JSON.parse(options.body) : null; calls.push({ path, payload })
      if (path.endsWith('/preflight')) return { kind: result === 'blocked' ? 'BLOCKED' : 'CLEAN', reason: 'PROTECTED_STATE', handle, snapshot: { counts: {} } }
      return path.includes('?') ? routing : { kind: 'SWITCHED' }
    }
    let updates = 0
    const execute = new Function('state', 'els', 'getJson', 'requestCrmConfirmation', 'routingConfigurationForVariant', 'renderBotRoutingControl', 'updateBotRoutingSelection', source.slice(start, end) + '; return changeBotRouting;')(
      state, els, getJson, async () => result === 'confirm', () => routing.configurations[0], () => {}, () => { updates++ })
    await execute(); assert.equal(calls[0].payload.target, 'cfg-new'); assert.equal(state.botRoutingBusy, false); assert(updates >= 2)
    if (result === 'confirm') { assert.equal(calls[1].path, '/crm/bot-routing/commit'); assert.equal(calls[1].payload.target, 'cfg-new'); assert.equal(calls[1].payload.confirmation, 'CONFIRM_ROUTING_CHANGE') }
    else { assert.equal(calls[1].path, '/crm/bot-routing/abort'); assert(!calls.some(c => c.path.endsWith('/commit'))) }
    assert(calls.some(c => c.path.includes('?')), 'refresh durable routing after every preflight, including abort')
  }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
await check('CRM changing business during preflight aborts only the original scope and ignores stale response', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8'), start = source.indexOf('    function routingCountsText('), end = source.indexOf('    async function toggleConversationAi()', start)
  const preflight = deferred<any>(), calls: any[] = [], original: any = { engineKey: 'legacy-whatsapp', activeConfigurationId: null, generation: 3, configurations: [{ id: 'cfg-new', variant: 'conversational' }] }
  const next = { businessId: 'other', generation: 9 }, state: any = { businessId: 'b', botRouting: original }, els: any = { botRoutingSelector: { value: 'conversational' }, botRoutingPreflight: {}, botRoutingEvidence: {} }
  const handle = { businessId: 'b', deploymentId: 'd', generation: 3, fenceEpoch: 4, pausedAt: '2026-10-18T12:00:00Z' }
  let confirmations = 0
  const getJson = async (path: string, options: any) => { calls.push({ path, payload: options?.body ? JSON.parse(options.body) : null }); return path.endsWith('/preflight') ? preflight.promise : path.includes('?') ? original : {} }
  const execute = new Function('state', 'els', 'getJson', 'requestCrmConfirmation', 'routingConfigurationForVariant', 'renderBotRoutingControl', 'updateBotRoutingSelection', source.slice(start, end) + '; return changeBotRouting;')(
    state, els, getJson, async () => { confirmations++; return true }, () => original.configurations[0], () => {}, () => {})
  const pending = execute(); state.businessId = 'other'; state.botRouting = next; els.botRoutingEvidence.textContent = 'other-status'
  preflight.resolve({ kind: 'CLEAN', handle, snapshot: { counts: {} } }); await pending
  assert.equal(confirmations, 0); assert(!calls.some(call => call.path.endsWith('/commit')))
  const abort = calls.find(call => call.path.endsWith('/abort')); assert.equal(abort?.payload.businessId, 'b'); assert.deepEqual(abort?.payload.handle, handle)
  assert(calls.filter(call => call.path.includes('?')).every(call => call.path.endsWith('businessId=b')))
  assert.equal(state.botRouting, next); assert.equal(els.botRoutingEvidence.textContent, 'other-status'); assert.equal(state.botRoutingBusy, false)
})
await check('CRM changing business while confirmation is open cannot commit and preserves new business view', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8'), start = source.indexOf('    function routingCountsText('), end = source.indexOf('    async function toggleConversationAi()', start)
  const confirmation = deferred<boolean>(), opened = deferred<boolean>(), calls: any[] = [], original: any = { engineKey: 'legacy-whatsapp', activeConfigurationId: null, generation: 3, configurations: [{ id: 'cfg-new', variant: 'conversational' }] }
  const next = { businessId: 'other', generation: 9 }, state: any = { businessId: 'b', botRouting: original }, els: any = { botRoutingSelector: { value: 'conversational' }, botRoutingPreflight: {}, botRoutingEvidence: {} }
  const handle = { businessId: 'b', deploymentId: 'd', generation: 3, fenceEpoch: 4, pausedAt: '2026-10-18T12:00:00Z' }
  const getJson = async (path: string, options: any) => { calls.push({ path, payload: options?.body ? JSON.parse(options.body) : null }); return path.endsWith('/preflight') ? { kind: 'CLEAN', handle, snapshot: { counts: {} } } : path.includes('?') ? original : {} }
  const execute = new Function('state', 'els', 'getJson', 'requestCrmConfirmation', 'routingConfigurationForVariant', 'renderBotRoutingControl', 'updateBotRoutingSelection', source.slice(start, end) + '; return changeBotRouting;')(
    state, els, getJson, async () => { opened.resolve(true); return confirmation.promise }, () => original.configurations[0], () => {}, () => {})
  const pending = execute(); await opened.promise; state.businessId = 'other'; state.botRouting = next; els.botRoutingEvidence.textContent = 'other-status'
  confirmation.resolve(true); await pending
  assert(!calls.some(call => call.path.endsWith('/commit'))); assert.equal(calls.find(call => call.path.endsWith('/abort'))?.payload.businessId, 'b')
  assert.equal(state.botRouting, next); assert.equal(els.botRoutingEvidence.textContent, 'other-status')
  assert(calls.filter(call => call.path.includes('?')).every(call => call.path.endsWith('businessId=b')))
})
await check('CRM preparation uses captured business and variant and cannot overwrite another business after await', async () => {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8'), start = source.indexOf('    async function prepareDefaultBotRouting()'), end = source.indexOf('    function routingCountsText(', start)
  for (const delayedStage of ['prepare', 'refresh']) {
    const gate = deferred<any>(), reached = deferred<boolean>(), calls: any[] = [], original = { businessId: 'b' }, next = { businessId: 'other' }
    const state: any = { businessId: 'b', botRouting: original }, els: any = { botRoutingSelector: { value: 'conversational' }, botRoutingTimezone: { value: 'UTC' }, botRoutingEvidence: {} }
    const getJson = async (path: string, options: any) => {
      calls.push({ path, payload: options?.body ? JSON.parse(options.body) : null })
      if (path.endsWith('/default') && delayedStage === 'prepare' || path.includes('?') && delayedStage === 'refresh') { reached.resolve(true); return gate.promise }
      return {}
    }
    let renders = 0
    const execute = new Function('state', 'els', 'getJson', 'renderBotRoutingControl', 'updateBotRoutingSelection', source.slice(start, end) + '; return prepareDefaultBotRouting;')(state, els, getJson, () => { renders++ }, () => {})
    const pending = execute(); await reached.promise; state.businessId = 'other'; state.botRouting = next; els.botRoutingSelector.value = 'options'; els.botRoutingEvidence.textContent = 'other-status'
    gate.resolve(original); await pending
    assert.equal(calls[0].payload.businessId, 'b'); assert.equal(calls[0].payload.variant, 'conversational')
    assert(calls.filter(call => call.path.includes('?')).every(call => call.path.endsWith('businessId=b')))
    assert.equal(state.botRouting, next); assert.equal(els.botRoutingEvidence.textContent, 'other-status'); assert.equal(renders, 0); assert.equal(state.botRoutingBusy, false)
  }
})
await prisma.$disconnect()
console.log(`Commercial bot selector: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
