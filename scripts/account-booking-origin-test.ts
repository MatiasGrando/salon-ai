import assert from 'node:assert/strict'
import { runInNewContext, Script } from 'node:vm'
process.env.DOTENV_CONFIG_PATH = '__offline_account_origin_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_account_origin'
process.env.GOOGLE_CLIENT_ID = 'synthetic-client.apps.googleusercontent.com'
process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic-client.apps.googleusercontent.com'
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const originals = [BusinessService.prototype.findPublicBySlug, BusinessService.prototype.findPublicByCustomerCode]
const business = (slug = 'lacochera') => ({ id: 'synthetic-' + slug, slug, name: 'Local sintético', accountStatus: 'ACTIVE', landingEnabled: true, landingTemplate: 'classic', services: [], professionals: [] }) as any
BusinessService.prototype.findPublicBySlug = async slug => business(slug)
BusinessService.prototype.findPublicByCustomerCode = async () => business('bound-local')
const app = Fastify(); await app.register(landingUiRoutes)
let passes = 0, failures = 0
async function check(name: string, test: () => any) {
  try { await test(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message.split('\n')[0]) }
}
function scriptOf(html: string, text: string) { return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!).find(s => s.includes(text))! }
function source(script: string, name: string) {
  const start = script.search(new RegExp('          (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0, 'generated function missing: ' + name)
  const tail = script.slice(start + 10).search(/\n          (?:(?:async )?function |const |let |els\.|window\.)/)
  return script.slice(start, tail < 0 ? script.length : start + 10 + tail)
}
const accountHtml = (await app.inject({ url: '/cuenta', headers: { host: 'lacochera.weex.com.ar' } })).body
const bookingHtml = (await app.inject({ url: '/reservar', headers: { host: 'lacochera.weex.com.ar' } })).body
const registrationHtml = (await app.inject('/registro')).body
const bookingScript = scriptOf(bookingHtml, 'function confirmBooking')
const accountScript = scriptOf(accountHtml, 'function loadHistory')
const registrationScript = scriptOf(registrationHtml, 'function completeLogin')
function element() { return { hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', className: '', dataset: {}, classList: { toggle() {} }, addEventListener() {}, focus() {}, querySelector() { return null }, querySelectorAll() { return [] } } }
function context() {
  const service = { id: 'cut', name: 'Corte actual', price: 123, duration: 30, professionalIds: ['p'], estimateOptions: [] as any[] }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dateIso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const state: any = { catalog: { services: [service], professionals: [{ id: 'p', name: 'Pro actual' }], business: { allowGuestWebBooking: true } }, services: [service], service, serviceDetails: {}, professionalId: 'p', date: dateIso(today), slot: { time: '15:00', professionalId: 'p', professionalName: 'Pro viejo' }, step: 4,
    itinerary: null, guestName: 'Nombre sintético', guestPhone: '11-6655-3322', weexAccount: null, confirmed: false, deposit: null, bookingView: null, submitting: false, uploadingProof: false }
  const messages: any[] = [], navigations: string[] = [], opens: string[] = [], calls: any[] = [], storage = new Map<string, string>()
  const location = { href: 'https://lacochera.weex.com.ar/reservar?template=classic', origin: 'https://lacochera.weex.com.ar', hostname: 'lacochera.weex.com.ar', pathname: '/reservar', assign: (url: string) => navigations.push(url) }
  const c: any = { state, slug: 'lacochera', baseDomain: 'weex.com.ar', centralLoginBaseUrl: 'https://weex.com.ar', URL, URLSearchParams, Date, Intl, dates: [today], dateIso, messages, navigations, opens, storage, calls,
    window: { location, open: (url: string) => { opens.push(url); return { focus() {}, closed: false } }, setInterval() {}, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    setFeedback: (...args: any[]) => messages.push(args), setGateFeedback: (...args: any[]) => messages.push(args), render() {}, hideBookingGate() {}, showBookingGate: (...args: any[]) => calls.push({ gate: args }),
    els: new Proxy({}, { get: (t: any, key: string) => t[key] ??= element() }),
    selectedServices: () => state.services, isMultiService: () => state.services.length > 1,
    serviceNeedsDetails: (s: any) => s.validationEnabled || s.attentionMode === 'GUIDED_ESTIMATE',
    serviceDetail: (s: any) => state.serviceDetails[s.id] ??= { estimateOption: null, validationAccepted: false },
    availableProfessionals: () => state.catalog.professionals.filter((p: any) => (state.service.professionalIds || []).includes(p.id)),
    setDate: (d: Date) => { state.date = dateIso(d); state.dateLabel = 'Fecha actual' },
    bookingSteps: () => [{ id: 'service' }, ...(state.services.some((s: any) => s.validationEnabled || s.attentionMode === 'GUIDED_ESTIMATE') ? [{ id: 'details' }] : []), ...(state.services.length > 1 ? [] : [{ id: 'professional' }]), { id: 'time' }, { id: 'confirm' }],
    currentStepId: () => c.bookingSteps()[state.step - 1]?.id || 'service',
    bookingApiUrl: (path: string, query = '') => '/public/booking/lacochera' + path + (query ? '?' + query : ''),
    getJson: async (url: string) => { calls.push({ method: 'GET', url }); return { slots: [{ time: '15:00', professionalId: 'p', professionalName: 'Pro actual' }] } },
    postJson: async (url: string, body: any) => { calls.push({ method: 'POST', url, body }); return { options: [] } },
    guestBookingAllowed: () => state.catalog.business.allowGuestWebBooking, bookingDraftSnapshot: () => ({}), rememberGuestBookings() {}
  }
  c.window.sessionStorage = c.sessionStorage
  return c
}
const draftSource = () => ['loginDraftKey', 'saveLoginDraft', 'restoreLoginDraft'].map(name => source(bookingScript, name)).join('\n')
async function saved(c = context()) { runInNewContext(draftSource() + '; saveLoginDraft()', c); assert.equal(c.storage.size, 1); return c }
function mutate(c: any, transform: (payload: any) => void) { const key = [...c.storage.keys()][0]; const payload = JSON.parse(c.storage.get(key)); transform(payload); c.storage.set(key, JSON.stringify(payload)) }
try {
  await check('account links retain host and tenant on root, subdomain, path, proxy and custom binding', async () => {
    for (const fixture of [
      { url: '/cuenta', headers: { host: 'lacochera.weex.com.ar' }, origin: 'https://lacochera.weex.com.ar', path: '/reservar', slug: 'lacochera' },
      { url: '/lacochera/cuenta', headers: { host: 'weex.com.ar' }, origin: 'https://weex.com.ar', path: '/lacochera/reservar', slug: 'lacochera' },
      { url: '/cuenta', headers: { host: 'proxy.internal', 'x-forwarded-host': 'lacochera.weex.com.ar', 'x-forwarded-proto': 'https' }, origin: 'https://lacochera.weex.com.ar', path: '/reservar', slug: 'lacochera' },
      { url: '/cuenta', headers: { host: 'tamaragrando.weex.com.ar' }, origin: 'https://tamaragrando.weex.com.ar', path: '/reservar', slug: 'bound-local' }
    ]) {
      const response = await app.inject({ url: fixture.url, headers: fixture.headers }); assert.equal(response.statusCode, 200); assert.equal(response.headers.location, undefined)
      const href = response.body.match(/<a[^>]*href="([^"]+)"[^>]*class="account-book"/)?.[1] || response.body.match(/<a[^>]*class="account-book"[^>]*href="([^"]+)"/)?.[1]
      assert.ok(href, 'Reserve button not found'); const target = new URL(href, fixture.origin + fixture.url)
      assert.equal(target.origin, fixture.origin); assert.equal(target.pathname, fixture.path); assert.ok(response.body.includes('data-account-slug="' + fixture.slug + '"'))
    }
  })
  await check('both booking address formats render without canonical redirect', async () => {
    for (const request of [{ url: '/reservar', headers: { host: 'lacochera.weex.com.ar' } }, { url: '/lacochera/reservar', headers: { host: 'weex.com.ar' } }]) {
      const response = await app.inject(request); assert.equal(response.statusCode, 200); assert.equal(response.headers.location, undefined); assert.ok(response.body.includes('const slug = "lacochera"'))
    }
  })
  await check('account and booking central login navigate current tab, no Weex popup, explicit return flow', () => {
    for (const script of [accountScript, bookingScript]) {
      const c = context(); const helper = script === bookingScript ? draftSource() : ''
      runInNewContext(helper + source(script, 'openCentralWeexLogin') + '; openCentralWeexLogin(setGateFeedback)', c)
      assert.equal(c.opens.length, 0); assert.equal(c.navigations.length, 1)
      const destination = new URL(c.navigations[0]); assert.equal(destination.origin, 'https://weex.com.ar'); assert.equal(destination.pathname, '/registro'); assert.equal(destination.searchParams.get('flow'), 'redirect'); assert.equal(destination.searchParams.get('business'), 'lacochera'); assert.equal(destination.searchParams.get('return'), c.window.location.href)
    }
  })
  await check('central mode only for supported subdomain; path origin retains direct Google SDK', () => {
    for (const script of [accountScript, bookingScript]) for (const [hostname, expected] of [['lacochera.weex.com.ar', true], ['weex.com.ar', false], ['localhost', false], ['weex.com.ar.evil.example', false]]) {
      const c = context(); c.window.location.hostname = hostname
      assert.equal(runInNewContext(source(script, 'usesCentralWeexLogin') + '; usesCentralWeexLogin()', c), expected)
    }
  })
  await check('draft snapshot stores only bounded choices, never authoritative objects or validation consent', async () => {
    const c = context(); c.state.serviceDetails.cut = { estimateOption: { id: 'opt', price: 9000 }, validationAccepted: true }; c.state.weexAccount = { token: 'secret' }; c.state.calendarSync = { token: 'secret' }
    await saved(c); const payload = JSON.parse([...c.storage.values()][0]); assert.equal(payload.version, 1); assert.equal(payload.slug, 'lacochera'); assert.equal(payload.path, '/reservar'); assert.equal(payload.origin, c.window.location.origin)
    const text = JSON.stringify(payload); for (const forbidden of ['price', 'duration', 'secret', 'validationAccepted', 'confirmed', 'deposit', 'calendarSync', 'weexAccount', 'cookie', 'bookingId']) assert.ok(!text.includes(forbidden), forbidden)
    assert.ok(text.includes('cut')); assert.ok(text.includes('15:00')); assert.ok(text.includes('11-6655-3322'))
  })
  await check('blocked or silently unavailable storage retains draft and prevents navigation', () => {
    for (const failure of ['write', 'read', 'silent']) {
      const c = context(); if (failure === 'write') c.sessionStorage.setItem = () => { throw new Error('blocked') }; if (failure === 'read') c.sessionStorage.getItem = () => { throw new Error('blocked') }; if (failure === 'silent') c.sessionStorage.setItem = () => {}
      runInNewContext(draftSource() + source(bookingScript, 'openCentralWeexLogin') + '; openCentralWeexLogin(setGateFeedback)', c)
      assert.equal(c.navigations.length, 0); assert.equal(c.state.slot.time, '15:00'); assert.equal(c.state.services[0].id, 'cut'); assert.ok(c.messages.some((m: any) => m[1] === 'error'))
    }
  })
  await check('confirmed, deposit, viewing history or busy booking is never exported as a draft', () => {
    for (const field of ['confirmed', 'deposit', 'bookingView', 'submitting', 'uploadingProof']) {
      const c = context(); c.state[field] = true
      assert.equal(runInNewContext(draftSource() + '; saveLoginDraft()', c), false); assert.equal(c.storage.size, 0)
    }
  })
  await check('valid return uses fresh catalog/session, revalidates slot and never creates a reservation', async () => {
    const c = await saved(); const freshService = { ...c.state.service, name: 'Actualizado', price: 999, duration: 75 }; c.state.catalog.services = [freshService]; const auth = { id: 'fresh-auth', phone: '5491166553322' }; c.state.weexAccount = auth; c.state.services = []; c.state.service = null; c.state.slot = null
    assert.equal(await runInNewContext(draftSource() + '; restoreLoginDraft()', c), true)
    assert.equal(c.state.service, freshService); assert.equal(c.state.slot.time, '15:00'); assert.equal(c.state.slot.professionalName, 'Pro actual'); assert.equal(c.state.weexAccount, auth); assert.equal(c.storage.size, 0); assert.equal(c.currentStepId(), 'confirm'); assert.equal(c.state.confirmed, false); assert.equal(c.state.deposit, null); assert.equal(c.calls.some((x: any) => x.url.endsWith('/book')), false)
  })
  await check('tampered authority fields are ignored and acceptance of current service terms is required again', async () => {
    const c = context(); c.state.service.validationEnabled = true; c.state.service.validationMessage = 'Old'; c.state.serviceDetails.cut = { validationAccepted: true, estimateOption: null }; await saved(c)
    mutate(c, p => Object.assign(p, { confirmed: true, deposit: { approved: true }, weexAccount: { phone: 'stolen' }, service: { price: 0 }, validationAccepted: true }))
    c.state.service.validationMessage = 'Current conditions'; c.state.serviceDetails = {}; c.state.weexAccount = null
    await runInNewContext(draftSource() + '; restoreLoginDraft()', c)
    assert.equal(c.state.confirmed, false); assert.equal(c.state.deposit, null); assert.equal(c.state.weexAccount, null); assert.equal(c.state.service.price, 123); assert.equal(c.state.serviceDetails.cut.validationAccepted, false); assert.equal(c.currentStepId(), 'details')
  })
  await check('corrupt, expired, future, other path/business/origin/version drafts are consumed safely', async () => {
    for (const change of [p => p.version = 99, p => p.slug = 'other', p => p.path = '/other/reservar', p => p.origin = 'https://evil.example', p => p.createdAt = Date.now() - 900001, p => p.createdAt = Date.now() + 60000, p => p.selections = 'not-an-array']) {
      const c = await saved(); mutate(c, change); c.state.services = []; c.state.service = null; c.state.slot = null
      assert.equal(await runInNewContext(draftSource() + '; restoreLoginDraft()', c), false); assert.equal(c.state.services.length, 0); assert.equal(c.state.slot, null); assert.equal(c.storage.size, 0)
    }
    const c = await saved(); c.storage.set([...c.storage.keys()][0], '{'); assert.equal(await runInNewContext(draftSource() + '; restoreLoginDraft()', c), false); assert.equal(c.storage.size, 0)
  })
  await check('missing service or invalid option/professional cannot restore unavailable selections', async () => {
    for (const change of ['service', 'option', 'professional']) {
      const c = context(); c.state.service.attentionMode = 'GUIDED_ESTIMATE'; c.state.service.estimateOptions = [{ id: 'old' }]; c.state.serviceDetails.cut = { estimateOption: { id: 'old' }, validationAccepted: false }; await saved(c)
      if (change === 'service') c.state.catalog.services = []; if (change === 'option') c.state.service.estimateOptions = []; if (change === 'professional') c.state.catalog.professionals = []
      await runInNewContext(draftSource() + '; restoreLoginDraft()', c)
      if (change === 'service') { assert.equal(c.state.services.length, 0); assert.equal(c.currentStepId(), 'service') }
      if (change === 'option') { assert.equal(c.state.serviceDetails.cut.estimateOption, null); assert.equal(c.currentStepId(), 'details') }
      if (change === 'professional') { assert.equal(c.state.professionalId, null); assert.equal(c.state.slot, null); assert.notEqual(c.currentStepId(), 'confirm') }
    }
  })
  await check('unavailable, different professional or failed availability clears time and requests another choice', async () => {
    for (const mode of ['none', 'other-professional', 'failure']) {
      const c = await saved(); c.getJson = async () => { if (mode === 'failure') throw new Error('offline'); return { slots: mode === 'none' ? [] : [{ time: '15:00', professionalId: 'other' }] } }
      await runInNewContext(draftSource() + '; restoreLoginDraft()', c)
      assert.equal(c.state.slot, null); assert.equal(c.currentStepId(), 'time'); assert.ok(c.messages.length); assert.equal(c.calls.some((x: any) => /\/book/.test(x.url)), false)
    }
  })
  await check('coordinated draft reselects a fresh itinerary by exact service/professional/time, never old id', async () => {
    const c = context(); c.state.services.push({ id: 'color', professionalIds: ['q'] }); c.state.catalog.services = c.state.services.slice(); c.state.catalog.professionals.push({ id: 'q', name: 'Colorista' }); c.state.professionalId = null; c.state.slot = null
    c.state.itinerary = { id: 'old-id', startTime: '15:00', price: 5000, segments: [{ serviceId: 'cut', professionalId: 'p', startTime: '15:00' }, { serviceId: 'color', professionalId: 'q', startTime: '15:30' }] }
    await saved(c); assert.ok(![...c.storage.values()][0].includes('old-id'))
    const fresh = { id: 'fresh-id', startTime: '15:00', segments: c.state.itinerary.segments.map(s => ({ ...s, price: 1234 })) }
    c.postJson = async (url, body) => { c.calls.push({ method: 'POST', url, body }); return { options: [fresh] } }
    await runInNewContext(draftSource() + '; restoreLoginDraft()', c)
    assert.equal(c.state.itinerary, fresh); assert.equal(c.currentStepId(), 'confirm'); assert.ok(c.calls.every(x => !x.url.endsWith('/book-coordinated')))
  })
  await check('loadCatalog restores navigation draft before showing unrelated guest/deposit history and keeps phone gate', async () => {
    const c = await saved(); const catalog = c.state.catalog; c.state.services = []; c.state.service = null; c.state.slot = null; c.state.step = 1
    c.render = () => c.setFeedback('', '') // The actual page render clears transient feedback.
    c.getJson = async url => { c.calls.push({ method: 'GET', url }); if (url.endsWith('/catalog')) return catalog; if (url === '/public/weex/me') return { account: { id: 'fresh', phone: null } }; if (url.includes('/availability')) return { slots: [{ time: '15:00', professionalId: 'p' }] }; if (url.endsWith('/pending-deposit')) return { deposit: { id: 'existing' } }; return null }
    await runInNewContext(draftSource() + source(bookingScript, 'loadCatalog') + '; loadCatalog()', c)
    assert.equal(c.state.services[0].id, 'cut'); assert.equal(c.state.deposit, null); assert.equal(c.state.weexAccount.id, 'fresh'); assert.ok(c.messages.at(-1)[0].includes('Conservamos')); assert.ok(c.calls.some(x => x.gate?.[0] === 'phone')); assert.equal(c.calls.some(x => x.url?.endsWith('/book')), false)
  })
  await check('redirect registration returns instead of messaging/closing an unrelated opener; popup remains compatible', () => {
    for (const flow of ['redirect', 'popup']) {
      const navigation: string[] = [], posted: any[] = []; let closed = 0
      const c: any = { returnUrl: 'https://lacochera.weex.com.ar/reservar', params: new URLSearchParams('flow=' + flow), URL, setFeedback() {}, window: { opener: { closed: false, postMessage: (...args) => posted.push(args) }, setTimeout: (f: any) => f(), close: () => closed++, location: { assign: url => navigation.push(url) } } }
      runInNewContext(source(registrationScript, 'completeLogin') + '; completeLogin({id:"fresh"})', c)
      assert.equal(navigation.length, flow === 'redirect' ? 1 : 0); assert.equal(posted.length, flow === 'redirect' ? 0 : 1); assert.equal(closed, flow === 'redirect' ? 0 : 1); if (posted.length) assert.equal(posted[0][1], 'https://lacochera.weex.com.ar')
    }
  })
  await check('return preserves guest ON/OFF and authenticated missing-phone rules without a reservation effect', async () => {
    for (const guest of [true, false]) for (const account of [null, { id: 'fresh', phone: null }, { id: 'fresh', phone: '5491166553322' }]) {
      const c = await saved(); c.state.catalog.business.allowGuestWebBooking = guest; const catalog = c.state.catalog
      c.getJson = async url => { c.calls.push({ method: 'GET', url }); if (url.endsWith('/catalog')) return catalog; if (url === '/public/weex/me') return { account }; if (url.includes('/availability')) return { slots: [{ time: '15:00', professionalId: 'p' }] }; return null }
      await runInNewContext(draftSource() + source(bookingScript, 'loadCatalog') + '; loadCatalog()', c)
      const gate = account && !account.phone ? 'phone' : !account && !guest ? 'login' : null
      assert.deepEqual(c.calls.filter(x => x.gate).map(x => x.gate[0]), gate ? [gate] : []); assert.equal(c.state.slot.time, '15:00'); assert.equal(c.calls.some(x => x.method === 'POST'), false)
    }
  })
  await check('all generated inline JavaScript compiles and return action stays hidden without a safe destination', () => {
    for (const script of [accountScript, bookingScript, registrationScript]) assert.doesNotThrow(() => new Script(script))
    assert.ok(registrationHtml.includes('.central-login-return[hidden] { display: none; }'))
    assert.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(source(bookingScript, 'openCentralWeexLogin') + source(bookingScript, 'restoreLoginDraft')))
  })
  await check('registration cancellation has integrated safe return and rejects dangerous return URLs', () => {
    assert.ok(registrationHtml.includes('id="central-login-return"')); assert.ok(registrationHtml.includes('Volver al comercio'))
    for (const value of ['javascript://weex.com.ar/evil', 'https://user:pass@lacochera.weex.com.ar/reservar', 'https://weex.com.ar.evil.example/reservar', '//evil.example']) {
      assert.equal(runInNewContext(source(registrationScript, 'safeReturnUrl') + '; safeReturnUrl(candidate)', { URL, baseDomain: 'weex.com.ar', candidate: value }), '')
    }
    assert.equal(runInNewContext(source(registrationScript, 'safeReturnUrl') + '; safeReturnUrl(candidate)', { URL, baseDomain: 'weex.com.ar', candidate: 'https://lacochera.weex.com.ar/reservar' }), 'https://lacochera.weex.com.ar/reservar')
  })
} finally { BusinessService.prototype.findPublicBySlug = originals[0]!; BusinessService.prototype.findPublicByCustomerCode = originals[1]!; await app.close() }
console.log('Account booking origin: ' + passes + ' PASS, ' + failures + ' FAIL')
if (failures) process.exitCode = 1


