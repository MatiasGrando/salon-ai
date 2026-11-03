import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.DOTENV_CONFIG_PATH = '__offline_booking_time_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_booking_time'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'
process.env.NODE_ENV = 'test'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')])
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const original = BusinessService.prototype.findPublicBySlug
let business: any
BusinessService.prototype.findPublicBySlug = async () => business
const app = Fastify(); await app.register(landingUiRoutes)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] })
const directory = 'tmp/booking-time-transition/' + (process.env.BOOKING_TIME_EVIDENCE || 'latest')
await mkdir(directory, { recursive: true })
let passes = 0, failures = 0
const results: any[] = [], contexts: any[] = []
async function check(name: string, fn: () => any) { if (process.env.BOOKING_TIME_FILTER && !name.includes(process.env.BOOKING_TIME_FILTER)) return; try { await fn(); passes++; results.push({ name, status: 'PASS' }); console.log('PASS ' + name) } catch (error) { failures++; results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) } }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function fixture(config: any = {}) {
  const width = config.width || 390, account = config.account === undefined ? { id: 'owner', name: 'Synthetic Owner', phone: '5491166553322' } : config.account
  const services = [{ id: 'cut', name: 'Corte', duration: 30, displayDuration: '30 min', price: 15000, priceMode: 'FIXED', professionalIds: ['pro'] }, { id: 'color', name: 'Color', duration: 90, displayDuration: '90 min', price: 65000, priceMode: 'FIXED', professionalIds: ['pro'] }]
  business = { id: 'offline', slug: 'offline', name: 'Local de prueba', timezone: 'America/Argentina/Buenos_Aires', accountStatus: 'ACTIVE', landingEnabled: true, landingTemplate: 'classic', bookingTheme: config.theme || 'light', allowGuestWebBooking: config.guest !== false, services: [], professionals: [] }
  const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 1024 : 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Buenos_Aires' }); contexts.push(context)
  await context.addInitScript({ content: 'globalThis.__name = value => value;' })
  const f: any = { context, requests: [], errors: [], dialogs: [], holdAuth: null }
  await context.route('**/*', async (route: any) => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== 'weex.test') return route.abort()
    if (request.isNavigationRequest()) { const rendered = await app.inject({ url: url.pathname, headers: { host: 'weex.test', 'x-forwarded-proto': 'https' } }); assert.equal(rendered.statusCode, 200); return route.fulfill({ contentType: 'text/html', body: rendered.body }) }
    f.requests.push({ path: url.pathname, method: request.method(), body: request.postData() })
    let body: any = {}, status = 200
    if (url.pathname === '/public/weex/me') { if (f.holdAuth) await f.holdAuth.promise; status = account ? 200 : 401; body = account ? { account } : { message: 'Sin sesion sintetica' } }
    else if (url.pathname.endsWith('/catalog')) body = { business, services, professionals: [{ id: 'pro', name: 'Profesional' }], combinationRules: [] }
    else if (url.pathname.endsWith('/guest-booking')) status = 404
    else if (url.pathname.endsWith('/pending-deposit')) body = {}
    else if (url.pathname.endsWith('/availability')) body = { slots: ['15:00', '16:00'].map(time => ({ time, professionalId: 'pro', professionalName: 'Profesional' })) }
    else if (url.pathname.endsWith('/itineraries')) body = { options: ['15:00', '16:00'].map((time, i) => ({ id: 'itinerary-' + i, startTime: time, endTime: i ? '18:00' : '17:00', segments: services.map((service, j) => ({ serviceId: service.id, serviceName: service.name, professionalId: 'pro', professionalName: 'Profesional', startTime: j ? (i ? '16:30' : '15:30') : time, endTime: j ? (i ? '18:00' : '17:00') : (i ? '16:30' : '15:30') })) })) }
    else if (/\/book(?:-coordinated)?$/.test(url.pathname)) body = { appointment: { id: 'created-by-explicit-confirm' }, deposit: null }
    else { status = 404; f.errors.push('Unexpected endpoint ' + url.pathname) }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(2200); f.page = page
  page.on('pageerror', (e: any) => f.errors.push(String(e))); page.on('dialog', async (d: any) => { f.dialogs.push(d.type()); await d.dismiss() })
  await page.goto('https://weex.test/offline/reservar', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator('[data-service-id="cut"]').waitFor({ state: 'visible' }); await page.locator('[data-service-id="cut"]').tap()
  if (config.multi) await page.locator('[data-service-id="color"]').tap()
  await page.locator('#booking-mobile-continue').tap()
  if (!config.multi) { await page.locator('.fresha-option[data-professional-id="pro"]').tap(); await page.locator('#booking-continue').tap() }
  await page.locator(config.multi ? '[data-itinerary-id="itinerary-0"]' : '.slot[data-time="15:00"]').waitFor({ state: 'visible' })
  return f
}
const authCount = (f: any) => f.requests.filter((r: any) => r.path === '/public/weex/me').length
const posts = (f: any) => f.requests.filter((r: any) => r.method === 'POST').length
const bookCount = (f: any) => f.requests.filter((r: any) => /\/book(?:-coordinated)?$/.test(r.path)).length
async function clean(f: any) { assert.deepEqual(f.errors, []); assert.deepEqual(f.dialogs, []); await f.context.close(); contexts.splice(contexts.indexOf(f.context), 1) }
try {
  await check('guest double click: one auth GET, no POST, Back preserves choice and final submit is explicit', async () => {
    const f = await fixture({ account: null }), authBefore = authCount(f), postBefore = posts(f), date = await f.page.locator('.date-chip.selected').getAttribute('data-date')
    f.holdAuth = deferred(); await f.page.locator('.slot[data-time="15:00"]').dblclick({ delay: 40 }); await f.page.waitForTimeout(120)
    assert.equal(authCount(f) - authBefore, 1, 'one auth request for emitted double click'); assert.equal(posts(f), postBefore); assert.equal(await f.page.locator('#booking-continue').isVisible(), false)
    f.holdAuth.resolve(); f.holdAuth = null; await f.page.locator('#booking-guest-name').waitFor({ state: 'visible' }); assert.equal(bookCount(f), 0)
    await f.page.locator('#booking-back').tap(); assert.equal(await f.page.locator('.date-chip.selected').getAttribute('data-date'), date)
    await f.page.locator('.slot.selected[data-time="15:00"]').waitFor({ state: 'visible' }); assert.match(await f.page.locator('.fresha-pill').innerText(), /Profesional/i)
    await f.page.locator('.slot[data-time="16:00"]').tap(); await f.page.locator('#booking-guest-name').fill('Persona sintetica'); await f.page.locator('#booking-guest-phone').fill('+598 99 123 456')
    assert.match(await f.page.locator('#booking-summary-lines').innerText(), /16:00/); assert.equal(bookCount(f), 0)
    await f.page.locator('#booking-continue').tap(); await f.page.locator('.booking-success').waitFor({ state: 'visible' }); assert.equal(bookCount(f), 1); await clean(f)
  })
  await check('coordinated itinerary advances once, Back retains selection and no book POST is automatic', async () => {
    const f = await fixture({ multi: true }), authBefore = authCount(f), postBefore = posts(f)
    await f.page.locator('[data-itinerary-id="itinerary-0"]').tap(); await f.page.locator('.booking-account-ready').waitFor({ state: 'visible' })
    assert.equal(authCount(f) - authBefore, 1); assert.equal(posts(f), postBefore); assert.equal(bookCount(f), 0)
    await f.page.locator('#booking-back').tap(); await f.page.locator('[data-itinerary-id="itinerary-0"].selected').waitFor({ state: 'visible' })
    await f.page.locator('[data-itinerary-id="itinerary-1"]').tap(); await f.page.locator('.booking-account-ready').waitFor({ state: 'visible' }); assert.match(await f.page.locator('#booking-summary-lines').innerText(), /16:00/); assert.equal(bookCount(f), 0); await clean(f)
  })
  for (const missing of ['phone', 'login']) await check('existing ' + missing + ' gate retains selection and never creates a booking', async () => {
    const f = await fixture({ account: missing === 'login' ? null : { id: 'owner', name: 'Synthetic Owner', phone: null }, guest: missing !== 'login' }), before = posts(f)
    await f.page.locator('.slot[data-time="15:00"]').tap(); await f.page.locator('#booking-gate-' + missing).waitFor({ state: 'visible' }); assert.equal(posts(f), before); assert.equal(bookCount(f), 0)
    await f.page.locator('#booking-gate-close').tap(); await f.page.locator('.slot.selected[data-time="15:00"]').waitFor({ state: 'visible' }); await clean(f)
  })
  await check('late auth cannot advance after Back changes step', async () => {
    const f = await fixture(), count = authCount(f); f.holdAuth = deferred(); await f.page.locator('.slot[data-time="15:00"]').tap(); await f.page.waitForFunction(() => document.querySelector('.slot.selected'))
    await f.page.locator('#booking-back').tap(); await f.page.locator('.fresha-option[data-professional-id="pro"]').waitFor({ state: 'visible' }); f.holdAuth.resolve(); f.holdAuth = null; await f.page.waitForTimeout(150)
    assert.equal(authCount(f) - count, 1); assert.equal(await f.page.locator('.booking-account-ready').count(), 0); assert.equal(bookCount(f), 0); await clean(f)
  })
  await check('keyboard repeated Enter advances once without confirming', async () => {
    const f = await fixture(), count = authCount(f), before = posts(f); f.holdAuth = deferred()
    await f.page.locator('.slot[data-time="15:00"]').focus(); await f.page.keyboard.press('Enter'); await f.page.keyboard.press('Enter'); await f.page.waitForTimeout(100)
    assert.equal(authCount(f) - count, 1); assert.equal(posts(f), before); f.holdAuth.resolve(); f.holdAuth = null
    await f.page.locator('.booking-account-ready').waitFor({ state: 'visible' }); assert.equal(bookCount(f), 0); await clean(f)
  })
  for (const width of [390, 820]) await check('time touch targets are at least44px at ' + width, async () => {
    const f = await fixture({ width })
    const controls = await f.page.locator('.slot, .date-nav-button, .date-chip, #booking-back, #booking-header-reservations').evaluateAll((items: Element[]) => items.filter(item => (item as HTMLElement).offsetParent).map(item => ({ selector: item.className || item.id, width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })))
    assert.ok(controls.length >= 6); for (const control of controls) { assert.ok(control.width >= 44, control.selector + ' width:' + control.width); assert.ok(control.height >= 44, control.selector + ' height:' + control.height) }
    await clean(f)
  })
  for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) for (const width of [320, 390, 768, 820]) await check('compact review with complete summary ' + theme + '/' + width, async () => {
    const f = await fixture({ theme, width }); await f.page.locator('.slot[data-time="15:00"]').tap()
    await f.page.locator('.booking-account-ready').waitFor({ state: 'visible' })
    const geometry = await f.page.evaluate(() => ({ minHeight: getComputedStyle(document.querySelector('.fresha-main')!).minHeight, gap: document.querySelector('.fresha-summary')!.getBoundingClientRect().top - document.querySelector('.booking-account-ready')!.getBoundingClientRect().bottom, overflow: document.documentElement.scrollWidth - innerWidth, summary: getComputedStyle(document.querySelector('#booking-summary-lines')!).display, confirmHeight: document.querySelector('#booking-continue')!.getBoundingClientRect().height }))
    assert.equal(geometry.minHeight, '0px', 'mobile main cannot retain desktop min-height'); assert.ok(geometry.gap < 70, 'desktop-sized blank gap: ' + geometry.gap); assert.ok(geometry.overflow <= 1); assert.notEqual(geometry.summary, 'none'); assert.ok(geometry.confirmHeight >= 44)
    assert.match(await f.page.locator('#booking-summary-lines').innerText(), /Corte[\s\S]*30 min[\s\S]*15[.,]000[\s\S]*Profesional[\s\S]*15:00/); assert.equal(bookCount(f), 0)
    if (theme === 'light' && [390, 820].includes(width)) await f.page.screenshot({ path: directory + '/review-' + width + '.png', fullPage: true }); await clean(f)
  })
} finally { for (const context of contexts) await context.close(); await browser.close(); await app.close(); BusinessService.prototype.findPublicBySlug = original; await writeFile(directory + '/results.json', JSON.stringify({ passes, failures, results }, null, 2)) }
console.log(`Booking time transition: ${passes} passed, ${failures} failed`)
if (failures) process.exitCode = 1
