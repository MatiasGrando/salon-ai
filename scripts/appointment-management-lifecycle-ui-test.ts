import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.DOTENV_CONFIG_PATH = '__offline_management_lifecycle_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_management_lifecycle'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const original = BusinessService.prototype.findPublicBySlug
const business: any = { id: 'lifecycle', slug: 'lifecycle', name: 'Local sintetico', timezone: 'America/Argentina/Buenos_Aires', accountStatus: 'ACTIVE', landingEnabled: true, allowGuestWebBooking: true, services: [], professionals: [] }
BusinessService.prototype.findPublicBySlug = async () => business
const app = Fastify(); await app.register(landingUiRoutes)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined,
  args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] })
const directory = 'tmp/appointment-management-lifecycle/' + (process.env.MANAGEMENT_EVIDENCE || 'latest')
await mkdir(directory, { recursive: true })
const contexts: any[] = [], results: any[] = []
let passed = 0, failed = 0
async function check(name: string, run: () => any) {
  if (process.env.MANAGEMENT_FILTER && !name.includes(process.env.MANAGEMENT_FILTER)) return
  try { await run(); passed++; results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { failed++; results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const row = (id: string, name: string) => ({ id, startAt: '2030-10-25T18:00:00Z', status: 'CONFIRMED', quotedPrice: 15000,
  totalDurationMinutes: 30, service: { id, name, duration: 30, price: 15000 }, professional: { id: 'p', name: 'Profesional sintetico' } })
async function fixture(options: any = {}) {
  const rows = [row('first', 'Corte sintetico'), row('second', 'Color sintetico')]
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 900 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' }); contexts.push(context)
  await context.addInitScript({ content: 'globalThis.__name = value => value;' })
  const f: any = { context, rows, requests: [], errors: [], gates: new Map(), manageStatus: 200, guest: options.guest, group: options.group,
    account: { id: 'synthetic-owner', name: 'Persona sintetica', email: 'synthetic@example.test', phone: '5491166553322' }, managementTimezone: options.timezone || business.timezone }
  f.manage = () => f.requests.filter((r: any) => r.path.endsWith('/manage'))
  await context.route('**/*', async (route: any) => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== 'weex.test') return route.abort()
    if (request.isNavigationRequest()) { const page = await app.inject({ url: url.pathname + url.search, headers: { host: 'weex.test', 'x-forwarded-proto': 'https' } }); return route.fulfill({ status: page.statusCode, contentType: 'text/html', body: page.body }) }
    f.requests.push({ path: url.pathname, query: url.search, method: request.method() })
    let body: any = {}, status = 200
    if (url.pathname === '/public/weex/me') { status = f.guest || !f.account ? 401 : 200; body = { account: f.account } }
    else if (url.pathname === '/public/weex/logout') { f.account = null; body = {} }
    else if (url.pathname === '/public/weex/auth/google') { f.account = { id: 'new-owner', name: 'Nueva persona', email: 'new@example.test', phone: '5491166553322' }; body = { account: f.account } }
    else if (url.pathname === '/public/weex/appointments') body = { appointments: rows }
    else if (url.pathname.endsWith('/catalog')) body = { business, services: [rows[0].service], professionals: [rows[0].professional] }
    else if (url.pathname.endsWith('/pending-deposit')) body = {}
    else if (url.pathname.endsWith('/guest-booking')) body = { guest: true, bookingId: 'grant-first', appointments: [rows[0]], bookings: rows.map(r => ({ guest: true, bookingId: 'grant-' + r.id, appointments: [r] })) }
    else if (url.pathname.endsWith('/manage')) {
      const id = url.pathname.split('/').at(-2)!, selected = rows.find(r => r.id === id)!
      const account = f.account
      const hold = f.gates.get(id); if (hold) await hold.promise
      status = f.manageStatus
      const managedRows = f.group && id === 'first' ? rows : [selected]
      // Match web-appointment-self-service.serialize(): effective snapshots live inside service.
      body = status === 200 ? { appointments: managedRows.map((item: any) => ({ id: item.id,
        startAt: options.fresh ? '2030-10-25T19:00:00Z' : item.startAt, status: item.status,
        service: { id: item.service.id, name: item.service.name, price: options.fresh ? (options.freshPrice === undefined ? 17000 : options.freshPrice) : item.quotedPrice,
          duration: options.fresh ? 35 : item.totalDurationMinutes },
        professional: options.fresh ? { id: 'q', name: 'Profesional actualizado' } : item.professional })), selfService: { mode: 'direct', canCancel: true, canReschedule: true,
        timezone: f.managementTimezone, revision: account?.id || 'guest-revision', professionalChoices: [] } } : { message: 'Acceso no disponible.' }
    } else { status = 404; f.errors.push('Unexpected endpoint ' + request.method() + ' ' + url.pathname) }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(5000); f.page = page
  page.on('pageerror', (error: any) => f.errors.push(String(error)))
  await page.goto('https://weex.test/lifecycle/' + (options.guest ? 'reservar?reservationView=browser' : 'cuenta'), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator(options.guest ? 'button[data-guest-booking-id="grant-first"]' : '[data-appointment-id="first"]').waitFor({ state: 'visible' })
  return f
}
async function clean(f: any) { assert.deepEqual(f.errors, []); await f.context.close(); contexts.splice(contexts.indexOf(f.context), 1) }
async function open(f: any, id = 'first') { await f.page.locator(f.guest ? 'button[data-guest-booking-id="grant-' + id + '"]' : '[data-appointment-id="' + id + '"]').tap() }
async function loaded(f: any) { await f.page.locator('[data-self-action="cancel"]').waitFor({ state: 'visible' }) }
try {
  await check('mobile list performs no hidden management load; first explicit open loads actions exactly once', async () => {
    const f = await fixture(); await f.page.waitForTimeout(150); assert.equal(f.manage().length, 0)
    await open(f); await loaded(f); assert.equal(f.manage().length, 1); assert.equal(f.manage()[0].query, '?view=actions'); await clean(f)
  })
  for (const group of [false, true]) await check('accepted delayed management summary preserves the focused detail title ' + (group ? 'group' : 'single'), async () => {
    const f = await fixture({ group, fresh: true }), hold = gate(); f.gates.set('first', hold)
    await open(f); await f.page.locator('.appointment-management[aria-busy="true"]').waitFor()
    const title = f.page.locator('[data-account-detail-title]')
    assert.equal(await title.evaluate((node: Element) => node === document.activeElement), true)
    hold.resolve(); await loaded(f)
    assert.match(await f.page.locator('[data-account-detail-summary]').innerText(), /Profesional actualizado/)
    assert.equal(await title.evaluate((node: Element) => node === document.activeElement), true, 'accepted summary must not leave focus on BODY')
    assert.equal(await title.innerText(), group ? 'Tu reserva' : 'Corte sintetico')
    assert.equal(f.manage().length, 1); await clean(f)
  })
  await check('accepted delayed summary never steals focus moved elsewhere or returned to the list', async () => {
    for (const target of ['account', 'list']) {
      const f = await fixture({ group: true, fresh: true }), hold = gate(); f.gates.set('first', hold)
      await open(f); await f.page.locator('.appointment-management[aria-busy="true"]').waitFor()
      if (target === 'list') await f.page.locator('[data-account-back]').tap()
      else await f.page.locator('#account-profile-toggle').focus()
      const selector = target === 'list' ? '[data-appointment-id="first"]' : '#account-profile-toggle'
      assert.equal(await f.page.locator(selector).evaluate((node: Element) => node === document.activeElement), true)
      hold.resolve(); await f.page.waitForTimeout(150)
      assert.equal(await f.page.locator(selector).evaluate((node: Element) => node === document.activeElement), true, 'summary may restore only its own previously focused title')
      assert.equal(f.manage().length, 1); await clean(f)
    }
  })
  await check('mobile close and reopen retain the actual manager without another authority request', async () => {
    const f = await fixture(); await open(f); await loaded(f); const before = f.manage().length
    await f.page.locator('[data-account-back]').tap(); await open(f); await loaded(f); assert.equal(f.manage().length, before); await clean(f)
  })
  await check('different reservation invalidates the previous manager and loads only the new selection', async () => {
    const f = await fixture(); await open(f); await loaded(f); await f.page.locator('[data-account-back]').tap(); await open(f, 'second'); await loaded(f)
    assert.equal(f.manage().length, 2); assert.match(f.manage()[1].path, /second\/manage$/); await clean(f)
  })
  await check('desktop visible auto-selection has exactly one actions request', async () => {
    const f = await fixture({ width: 1366 }); await loaded(f); assert.equal(f.manage().length, 1); assert.equal(f.manage()[0].query, '?view=actions')
    await open(f); assert.equal(f.manage().length, 1); await clean(f)
  })
  await check('in-flight reads do not freeze list navigation and reopening the same manager is single-flight', async () => {
    const f = await fixture(), hold = gate(); f.gates.set('first', hold); await open(f)
    await f.page.locator('.appointment-management[aria-busy="true"]').waitFor(); await f.page.locator('[data-account-back]').tap(); await open(f)
    assert.equal(f.manage().length, 1); hold.resolve(); await loaded(f); await clean(f)
  })
  await check('a delayed previous selection cannot replace the current manager or its timezone', async () => {
    const f = await fixture(), hold = gate(); f.gates.set('first', hold); await open(f)
    await f.page.locator('.appointment-management[aria-busy="true"]').waitFor(); await f.page.locator('[data-account-back]').tap(); await open(f, 'second'); await loaded(f)
    hold.resolve(); await f.page.waitForTimeout(150)
    assert.match(await f.page.locator('[data-account-detail-summary]').innerText(), /Color sintetico/)
    assert.ok(!(await f.page.locator('.appointment-management').innerText()).includes('Corte sintetico')); assert.equal(f.manage().length, 2); await clean(f)
  })
  await check('individual home is not duplicated; explicit cancellation keeps its full authoritative summary', async () => {
    const f = await fixture(); await open(f); await loaded(f)
    assert.equal(await f.page.locator('.appointment-management table').count(), 0)
    assert.equal(await f.page.locator('#history-detail').getByText('Corte sintetico', { exact: true }).count(), 1)
    await f.page.locator('[data-self-action="cancel"]').tap(); assert.equal(await f.page.locator('.appointment-management tbody tr').count(), 1); await clean(f)
  })
  await check('group management home includes the additional booked services, not only the anchor', async () => {
    const f = await fixture({ group: true }); await open(f); await loaded(f)
    assert.equal(await f.page.locator('[data-account-detail-summary] tbody tr').count(), 2)
    assert.equal(await f.page.locator('.appointment-management table').count(), 0)
    assert.match(await f.page.locator('[data-account-detail-summary]').innerText(), /Color sintetico/); await clean(f)
  })
  await check('guest capability list does not load management until a detail is opened', async () => {
    const f = await fixture({ guest: true }); assert.equal(f.manage().length, 0); await open(f); await loaded(f)
    assert.equal(f.manage().length, 1); assert.equal(f.manage()[0].query, '?view=actions')
    assert.equal(await f.page.locator('.appointment-management table').count(), 0); await clean(f)
  })
  await check('guest list roundtrip reuses only the current same-capability manager', async () => {
    const f = await fixture({ guest: true }); await open(f); await loaded(f)
    await f.page.locator('#booking-view-reservations').tap(); await open(f); await loaded(f); assert.equal(f.manage().length, 1)
    await f.page.locator('#booking-view-reservations').tap(); await open(f, 'second'); await loaded(f); assert.equal(f.manage().length, 2); await clean(f)
  })
  await check('guest delayed read cannot reopen a list the user intentionally returned to', async () => {
    const f = await fixture({ guest: true }), hold = gate(); f.gates.set('first', hold); await open(f)
    await f.page.locator('.appointment-management[aria-busy="true"]').waitFor(); await f.page.locator('#booking-view-reservations').tap()
    hold.resolve(); await f.page.waitForTimeout(150)
    await f.page.locator('button[data-guest-booking-id="grant-first"]').waitFor({ state: 'visible' })
    assert.match(await f.page.locator('#booking-summary-lines').innerText(), /Abrí el detalle/)
    await open(f); await loaded(f); assert.equal(f.manage().length, 1); await clean(f)
  })
  await check('deduplication uses the fresh management snapshots for account and guest, never stale list data', async () => {
    for (const guest of [false, true]) for (const group of [false, true]) {
      const f = await fixture({ guest, group, fresh: true }); await open(f); await loaded(f)
      const summary = f.page.locator(guest ? '#booking-summary-lines' : '[data-account-detail-summary]')
      assert.match(await summary.innerText(), /Profesional actualizado/)
      assert.match(await summary.innerText(), /35 min/); assert.match(await summary.innerText(), /17\.000/)
      if (group) assert.match(await summary.innerText(), /Color sintetico/)
      assert.equal(await f.page.locator('.appointment-management table').count(), 0); await clean(f)
    }
  })
  await check('real management DTO preserves both zero and unknown booked prices over legacy guest fields', async () => {
    for (const guest of [false, true]) for (const freshPrice of [0, null]) {
      const f = await fixture({ guest, fresh: true, freshPrice }); await open(f); await loaded(f)
      const text = await f.page.locator(guest ? '#booking-summary-lines' : '[data-account-detail-summary]').innerText()
      assert.match(text, freshPrice === 0 ? /\$\s*0/ : /[Cc]onsultar/)
      assert.ok(!text.includes('15.000')); assert.match(text, /35 min/); await clean(f)
    }
  })
  await check('management timezone update changes summary without a recursive manager reload', async () => {
    const f = await fixture({ timezone: 'UTC' }); await open(f); await loaded(f)
    assert.match(await f.page.locator('[data-account-detail-summary]').innerText(), /(?:18:00|06:00 p\. m\.)/); assert.equal(f.manage().length, 1); await clean(f)
  })
  await check('explicit retry repeats only a failed request; denied capability cannot retry', async () => {
    for (const status of [503, 404]) {
      const f = await fixture(); f.manageStatus = status; await open(f); await f.page.locator('.self-service-feedback:not([hidden])').waitFor()
      if (status === 503) { f.manageStatus = 200; await f.page.locator('[data-self-action="retry"]').tap(); await loaded(f); assert.equal(f.manage().length, 2) }
      else { assert.equal(await f.page.locator('[data-self-action="retry"]').count(), 0); assert.equal(f.manage().length, 1) }
      await clean(f)
    }
  })
  await check('logout and new Google identity cannot reuse or render the old manager', async () => {
    const f = await fixture({ width: 1366 }), hold = gate(); f.gates.set('first', hold)
    // Reload with a held manager response, then use the actual auth event handlers.
    await f.page.reload(); await f.page.locator('.appointment-management[aria-busy="true"]').waitFor()
    await f.page.locator('#account-logout').click(); hold.resolve(); await f.page.waitForTimeout(100)
    assert.equal(await f.page.locator('.appointment-management:visible').count(), 0)
    await f.page.evaluate(() => { (window as any).google = { accounts: { id: { initialize(config: any) { (window as any).__googleCredential = config.callback }, renderButton(host: HTMLElement) { host.innerHTML = '<button id="synthetic-google">Google</button>' } } } } })
    await f.page.locator('#synthetic-google').waitFor(); await f.page.evaluate(() => (window as any).__googleCredential({ credential: 'synthetic-only' }))
    await loaded(f); assert.equal(f.manage().at(-1).query, '?view=actions'); assert.equal(f.account.id, 'new-owner'); await clean(f)
  })
  await check('a new mobile identity starts at its list and never preloads the previous selected detail', async () => {
    const f = await fixture(); await open(f); await loaded(f)
    await f.page.locator('#account-profile-toggle').tap(); await f.page.locator('#account-logout').tap()
    const before = f.manage().length
    await f.page.evaluate(() => { (window as any).google = { accounts: { id: { initialize(config: any) { (window as any).__googleCredential = config.callback }, renderButton(host: HTMLElement) { host.innerHTML = '<button id="synthetic-google">Google</button>' } } } } })
    await f.page.locator('#synthetic-google').waitFor(); await f.page.evaluate(() => (window as any).__googleCredential({ credential: 'synthetic-only' }))
    await f.page.locator('#account-profile-toggle').tap()
    await f.page.locator('[data-appointment-id="first"]').waitFor({ state: 'visible' })
    assert.equal(f.manage().length, before); await open(f); await loaded(f); assert.equal(f.manage().length, before + 1); await clean(f)
  })
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ passed, failed, results }, null, 2))
  for (const context of contexts) await context.close()
  await browser.close(); await app.close(); BusinessService.prototype.findPublicBySlug = original
}
console.log('Appointment management lifecycle UI: ' + passed + ' PASS, ' + failed + ' FAIL')
if (failed) process.exitCode = 1
