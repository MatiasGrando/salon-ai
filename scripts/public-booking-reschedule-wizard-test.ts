import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.DOTENV_CONFIG_PATH = '__offline_reschedule_wizard_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_reschedule_wizard'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'
process.env.NODE_ENV = 'test'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const previous = BusinessService.prototype.findPublicBySlug
let business: any
BusinessService.prototype.findPublicBySlug = async () => business
const app = Fastify(); await app.register(landingUiRoutes)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined,
  args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] })
const directory = 'tmp/reschedule-wizard/' + (process.env.RESCHEDULE_EVIDENCE || 'latest')
await mkdir(directory, { recursive: true })
const contexts: any[] = [], results: any[] = []
let passes = 0, failures = 0
async function check(name: string, fn: () => any) {
  if (process.env.RESCHEDULE_FILTER && !name.includes(process.env.RESCHEDULE_FILTER)) return
  try { await fn(); passes++; results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { failures++; results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
}
const pros = [{ id: 'p', name: 'Profesional P' }, { id: 'q', name: 'Profesional Q' }]
function appointments(group: boolean) {
  return Array.from({ length: group ? 2 : 1 }, (_, index) => ({ id: index ? 'appointment-second' : 'appointment-first',
    startAt: index ? '2026-10-27T20:25:00Z' : '2026-10-27T19:00:00Z', status: 'CONFIRMED', quotedPrice: index ? 17000 : 64000,
    totalDurationMinutes: index ? 35 : 85, service: { depositMode: 'FIXED', depositValue: 5000, id: 'same-service', name: index ? 'Servicio contratado segundo' : 'Servicio contratado primero', price: index ? 17000 : 64000, duration: index ? 35 : 85 }, professional: pros[0] }))
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function fixture(config: any = {}) {
  const host = config.format === 'subdomain' ? 'safe-wizard.weex.com.ar' : 'weex.test', base = config.format === 'subdomain' ? '' : '/safe-wizard'
  const rows = appointments(config.group !== false), requests: any[] = [], errors: string[] = [], dialogs: string[] = []
  if (config.startAt) rows[0].startAt = config.startAt
  const policyTimezone = config.policyTimezone || 'America/Argentina/Buenos_Aires'
  const optionStart = (date: string, time: string, offset = 0) => new Date(new Date(date + 'T' + time + ':00Z').getTime() + (policyTimezone === 'Asia/Tokyo' ? -9 : policyTimezone === 'UTC' ? 0 : 3) * 3600000 + offset * 60000).toISOString()
  business = { id: 'safe-wizard', slug: 'safe-wizard', name: 'Local sintetico', timezone: config.businessTimezone || 'America/Argentina/Buenos_Aires', accountStatus: 'ACTIVE', landingEnabled: true, landingTemplate: 'classic', bookingTheme: config.theme || 'light', allowGuestWebBooking: true, services: [], professionals: [] }
  const context = await browser.newContext({ viewport: { width: config.width || 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Buenos_Aires' }); contexts.push(context)
  await context.addInitScript({ content: 'globalThis.__name = value => value;' })
  const f: any = { context, requests, errors, dialogs, rows, base, host, manageStatus: config.manageStatus || 200, submitStatus: config.submitStatus || 200, optionsStatus: config.optionsStatus || 200, mode: config.mode || 'direct', postGate: null, posts: [], revision: 'initial-revision', optionsCount: 0 }
  const managed = () => ({ appointments: rows, selfService: { timezone: policyTimezone, mode: f.mode, canReschedule: f.mode === 'direct', canCancel: true, revision: f.revision, reason: f.mode === 'direct' ? '' : 'Reserva fuera de plazo. Comunicate con el local.', professionalChoices: rows.map(row => ({ appointmentId: row.id, professionals: pros })) } })
  await context.route('**/*', async (route: any) => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname !== host) return route.abort()
    if (req.isNavigationRequest()) { const rendered = await app.inject({ url: url.pathname + url.search, headers: { host, 'x-forwarded-proto': 'https' } }); assert.equal(rendered.statusCode, 200); return route.fulfill({ contentType: 'text/html', body: rendered.body }) }
    const entry: any = { path: url.pathname, query: url.search, method: req.method(), body: req.postData() ? req.postDataJSON() : undefined }; requests.push(entry)
    let status = 200, body: any = {}
    if (url.pathname.endsWith('/catalog')) body = { business: config.omitCatalogTimezone ? { ...business, timezone: undefined } : business, services: [{ id: 'same-service', name: 'Catalogo cambiado', price: 999999, duration: 5, professionalIds: ['p'], attentionMode: 'GUIDED_ESTIMATE', estimateOptions: [{ id: 'changed', priceMin: 999999 }] }], professionals: pros }
    else if (url.pathname === '/public/weex/me') { status = config.guest ? 401 : 200; body = config.guest ? {} : { account: { id: 'synthetic-owner', name: 'Propietario sintetico', phone: '5491166553322' } } }
    else if (url.pathname.endsWith('/manage')) { status = f.manageStatus; body = status === 200 ? managed() : { message: 'Acceso a la reserva no disponible.' } }
    else if (url.pathname.endsWith('/reschedule-options')) {
      status = f.optionsStatus; f.optionsCount++
      const professionalIds = (url.searchParams.get('professionalIds') || '').split(',')
      assert.equal(professionalIds.length, rows.length, 'one professional per appointment, duplicate service retained')
      const date = url.searchParams.get('date')!
      const { timezone: _timezone, ...optionsPolicy } = managed().selfService
      body = status === 200 ? { selfService: optionsPolicy, options: ['15:00', '16:00'].map((time, index) => ({ id: 'opaque-' + f.optionsCount + '-' + index, date, time,
        segments: rows.map((row, i) => ({ appointmentId: row.id, serviceName: row.service.name, professionalId: professionalIds[i], professionalName: pros.find(p => p.id === professionalIds[i])?.name,
          startAt: optionStart(date, time, i * 85), durationMinutes: row.totalDurationMinutes })) })) } : { message: 'No se pudieron consultar estos horarios.' }
    } else if (url.pathname.endsWith('/reschedule') && req.method() === 'POST') {
      f.posts.push(entry); if (f.postGate) await f.postGate.promise
      status = f.submitStatus
      if (status === 200) { assert.equal(entry.body.revision, f.revision); assert.match(entry.body.operationId, /^[a-f0-9-]{36}$/i); rows.forEach((row, i) => { row.startAt = optionStart(entry.body.date, entry.body.optionId.endsWith('-0') ? '15:00' : '16:00', i * 85); row.professional = pros.find(p => p.id === entry.body.professionalIds[i])! }); f.revision = 'after-revision'; body = managed() }
      else { if (status === 409) f.revision = 'fresh-after-conflict'; body = { message: status === 409 ? 'La reserva cambió. Revisá sus datos actuales.' : 'El horario ya no está disponible.' } }
    } else if (url.pathname.endsWith('/guest-booking')) body = { guest: true, bookingId: 'browser-grant', appointments: rows, bookings: [{ guest: true, bookingId: 'browser-grant', appointments: rows }] }
    else if (url.pathname === '/public/weex/appointments') body = { appointments: rows }
    else if (url.pathname.endsWith('/pending-deposit')) body = {}
    else { status = 404; errors.push('Unexpected endpoint ' + req.method() + ' ' + url.pathname) }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(2600); f.page = page
  page.on('pageerror', (e: any) => errors.push(String(e))); page.on('dialog', async (d: any) => { dialogs.push(d.type()); await d.dismiss() })
  if (config.savedDraft) await context.addInitScript(({ key, value }: any) => { if (!sessionStorage.getItem(key + ':seeded')) { sessionStorage.setItem(key, value); sessionStorage.setItem(key + ':seeded', 'yes') } }, { key: 'weex.login-draft:safe-wizard:' + base + '/reservar', value: config.savedDraft })
  await page.goto('https://' + host + base + (config.entry ? (config.guest ? '/reservar' : '/cuenta') : '/reservar?reschedule=appointment-first' + (config.from ? '&rescheduleFrom=' + encodeURIComponent(config.from) : '')), { waitUntil: 'domcontentloaded', timeout: 30000 })
  return f
}
async function clean(f: any) { assert.deepEqual(f.errors, []); assert.deepEqual(f.dialogs, []); await f.context.close(); contexts.splice(contexts.indexOf(f.context), 1) }
async function professionalSteps(f: any) {
  for (let index = 0; index < f.rows.length; index++) {
    await f.page.locator('.fresha-option[data-professional-id="' + (index ? 'p' : 'q') + '"]').tap()
    await f.page.locator('#booking-continue').tap()
  }
  await f.page.locator('.slot[data-time="16:00"], [data-itinerary-id]').first().waitFor({ state: 'visible' })
}
async function chooseTime(f: any) {
  const slot = f.page.locator('.slot[data-time="16:00"]'); if (await slot.count()) await slot.tap(); else await f.page.locator('[data-itinerary-id]').last().tap()
  await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).waitFor({ state: 'visible' })
}
try {
  for (const format of ['path', 'subdomain']) for (const guest of [false, true]) await check('shared wizard same IDs/snapshots and explicit POST ' + format + '/' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ format, guest }); await professionalSteps(f); assert.equal(f.posts.length, 0)
    await chooseTime(f); const summary = await f.page.locator('#booking-summary-lines').innerText()
    assert.match(summary, /Servicio contratado primero/); assert.match(summary, /Servicio contratado segundo/); assert.match(summary, /64[.,]000/); assert.match(summary, /17[.,]000/); assert.match(summary, /85 min/); assert.match(summary, /35 min/); assert.ok(!summary.includes('999.999')); assert.ok(!summary.includes('pagar ahora')); assert.equal(f.posts.length, 0)
    assert.equal(f.requests.filter((r: any) => /\/availability|\/itineraries|\/book$|\/book-coordinated$/.test(r.path)).length, 0)
    assert.equal(f.requests.filter((r: any) => r.path === '/public/weex/me').length, 0, 'manage already authorizes account or guest')
    f.postGate = deferred(); await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).dblclick({ delay: 30 }); await f.page.waitForTimeout(100); assert.equal(f.posts.length, 1)
    assert.deepEqual(Object.keys(f.posts[0].body).sort(), ['date', 'operationId', 'optionId', 'professionalIds', 'revision']); assert.deepEqual(f.posts[0].body.professionalIds, ['q', 'p']); assert.match(f.posts[0].body.optionId, /^opaque-/)
    f.postGate.resolve(); f.postGate = null; await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' }); assert.deepEqual(f.rows.map((r: any) => r.id), ['appointment-first', 'appointment-second']); assert.equal(f.posts.length, 1)
    if (format === 'path' && guest) await f.page.screenshot({ path: directory + '/guest-success-390.png', fullPage: true, timeout: 15000 }); await clean(f)
  })
  for (const guest of [false, true]) await check('actual ' + (guest ? 'guest' : 'account') + ' entry opens the same booking wizard', async () => {
    const f = await fixture({ entry: true, guest })
    await f.page.locator(guest ? 'button[data-guest-booking-id="browser-grant"]' : '[data-appointment-id="appointment-first"]').tap()
    await f.page.locator('.appointment-management [data-self-action="reschedule"]').tap()
    await f.page.waitForURL((url: URL) => url.searchParams.get('reschedule') === 'appointment-first')
    await f.page.locator('.fresha-option[data-professional-id="q"]').waitFor({ state: 'visible' })
    assert.equal(await f.page.locator('[data-self-date], [data-self-professional]').count(), 0); assert.equal(f.posts.length, 0); await clean(f)
  })
  await check('professional and date changes discard old opaque options before explicit confirmation', async () => {
    const f = await fixture({ group: false }); await professionalSteps(f); await chooseTime(f)
    await f.page.locator('#booking-back').tap(); await f.page.locator('#booking-back').tap()
    await f.page.locator('.fresha-option[data-professional-id="p"]').tap(); await f.page.locator('#booking-continue').tap()
    await f.page.locator('.date-chip').last().tap(); await f.page.locator('.slot[data-time="16:00"]').tap()
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap()
    await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' })
    assert.equal(f.posts.length, 1); assert.deepEqual(f.posts[0].body.professionalIds, ['p']); assert.ok(!f.posts[0].body.optionId.startsWith('opaque-1-')); await clean(f)
  })
  await check('manual retry retains operation UUID and performs no hidden reschedule retry', async () => {
    const f = await fixture({ group: false, submitStatus: 503 }); await professionalSteps(f); await chooseTime(f)
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap(); await f.page.getByText('El horario ya no está disponible.', { exact: false }).waitFor({ state: 'visible' })
    await f.page.waitForTimeout(100); assert.equal(f.posts.length, 1); const first = f.posts[0].body; f.submitStatus = 200
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap(); await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' })
    assert.equal(f.posts.length, 2); assert.deepEqual(f.posts[1].body, first); await clean(f)
  })
  await check('single appointment uses same time picker and Back, not a mini form', async () => {
    const f = await fixture({ group: false, width: 820 }); await professionalSteps(f); await chooseTime(f)
    await f.page.locator('#booking-back').tap(); await f.page.locator('.slot.selected[data-time="16:00"]').waitFor({ state: 'visible' }); await f.page.locator('.slot[data-time="15:00"]').tap()
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).waitFor({ state: 'visible' }); assert.equal(f.posts.length, 0); assert.match(await f.page.locator('#booking-summary-lines').innerText(), /15:00/)
    assert.equal(await f.page.locator('[data-self-date], [data-self-professional]').count(), 0); await f.page.screenshot({ path: directory + '/review-820.png', fullPage: true, timeout: 15000 }); await clean(f)
  })
  for (const config of [{ mode: 'contact' }, { manageStatus: 404 }]) await check('denied authority preserves reason and cannot open booking mutation ' + JSON.stringify(config), async () => {
    const f = await fixture(config); await f.page.getByText(config.manageStatus ? 'Acceso a la reserva no disponible.' : 'Reserva fuera de plazo. Comunicate con el local.', { exact: false }).waitFor({ state: 'visible' })
    assert.equal(await f.page.locator('.slot, [data-itinerary-id], [data-service-id]').count(), 0); assert.equal(f.posts.length, 0); await clean(f)
  })
  for (const status of [409, 422]) await check('error ' + status + ' retains original booking and requires explicit new review', async () => {
    const f = await fixture({ submitStatus: status }); await professionalSteps(f); await chooseTime(f); const before = JSON.stringify(f.rows)
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap(); await f.page.getByText(status === 409 ? 'La reserva cambió.' : 'El horario ya no está disponible.', { exact: false }).waitFor({ state: 'visible' })
    assert.equal(JSON.stringify(f.rows), before); assert.equal(f.posts.length, 1); await f.page.waitForTimeout(100); assert.equal(f.posts.length, 1)
    if (status === 409) { assert.ok(f.requests.filter((r: any) => r.path.endsWith('/manage')).length >= 2); assert.equal(await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).count(), 0) }
    await clean(f)
  })
  await check('guest collection uses embedded business timezone when the catalog omits it', async () => {
    const f = await fixture({ guest: true, entry: true, policyTimezone: 'UTC', businessTimezone: 'UTC', omitCatalogTimezone: true })
    await f.page.locator('button[data-guest-booking-id="browser-grant"]').waitFor({ state: 'visible' })
    const collection = await f.page.locator('.booking-reservations-table').innerText()
    assert.match(collection, /19:00/); assert.match(collection, /20:25/)
    assert.equal(f.requests.filter((r: any) => r.path.endsWith('/manage')).length, 0, 'list does not add management lookups')
    await clean(f)
  })
  for (const guest of [false, true]) await check('management timezone stays coherent in returned detail and cancellation ' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ guest, entry: true, policyTimezone: 'UTC', businessTimezone: 'America/Argentina/Buenos_Aires', omitCatalogTimezone: true })
    await f.page.locator(guest ? 'button[data-guest-booking-id="browser-grant"]' : '[data-appointment-id="appointment-first"]').tap()
    await f.page.locator('.appointment-management [data-self-action="reschedule"]').waitFor({ state: 'visible' })
    const detailText = async () => (await f.page.locator(guest ? '.fresha-summary' : '[data-account-detail-summary]').innerText()).replace(/\s/g, '')
    assert.match(await detailText(), /19:00/)
    const expectedDetailTime = async (hour: string) => hour + ':00'
    assert.ok((await detailText()).includes((await expectedDetailTime('19')).replace(/\s/g, '')), 'detail reflects UTC rather than browser/SSR timezone, retaining its existing clock format')
    await f.page.locator('.appointment-management [data-self-action="reschedule"]').tap()
    await professionalSteps(f); await chooseTime(f)
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap()
    await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' })
    await f.page.getByRole('button', { name: 'Volver a reservas', exact: true }).tap()
    await f.page.locator(guest ? 'button[data-guest-booking-id="browser-grant"]' : '[data-appointment-id="appointment-first"]').tap()
    await f.page.locator('.appointment-management [data-self-action="cancel"]').waitFor({ state: 'visible' })
    assert.match(await detailText(), /16:00/)
    assert.ok((await detailText()).includes((await expectedDetailTime('16')).replace(/\s/g, '')))
    if (guest) {
      assert.match(await f.page.locator('.fresha-summary').innerText(), /17:25/)
      assert.match(await f.page.locator('.booking-success').innerText(), /16:00/)
    }
    await f.page.locator('.appointment-management [data-self-action="cancel"]').tap()
    assert.match(await f.page.locator('.appointment-management .self-service-table-wrap').innerText(), /16:00/)
    assert.match(await f.page.locator('.appointment-management .self-service-table-wrap').innerText(), /17:25/)
    assert.equal(f.posts.length, 1)
    assert.equal(f.requests.filter((r: any) => r.method === 'POST').length, 1, 'read-timezone update cannot post a cancellation')
    assert.equal(f.requests.filter((r: any) => r.path.endsWith('/manage')).length, 3, 'one actions GET per explicit detail and one full GET for the wizard, no hidden mobile preload')
    await clean(f)
  })
  for (const policyTimezone of ['UTC', 'Asia/Tokyo']) await check('management timezone is authoritative for initial date, segments and review ' + policyTimezone, async () => {
    const f = await fixture({ policyTimezone, startAt: policyTimezone === 'UTC' ? '2026-10-27T01:00:00Z' : '2026-10-27T19:00:00Z' })
    await professionalSteps(f)
    const date = policyTimezone === 'UTC' ? '2026-10-27' : '2026-10-28'
    assert.equal(new URLSearchParams(f.requests.find((r: any) => r.path.endsWith('/reschedule-options')).query).get('date'), date)
    const card = f.page.locator('[data-itinerary-id]').last()
    assert.match(await card.innerText(), /16:00 a 17:25/)
    assert.match(await card.innerText(), /17:25 a 18:00/)
    await card.tap()
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).waitFor({ state: 'visible' })
    assert.match(await f.page.locator('#booking-summary-lines').innerText(), /16:00 a 18:00/)
    assert.equal(f.posts.length, 0)
    await clean(f)
  })
  for (const format of ['path', 'subdomain']) for (const guest of [false, true]) await check('entry origin survives Back and returns to owned reservations ' + format + '/' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ entry: true, guest, format })
    await f.page.locator(guest ? 'button[data-guest-booking-id="browser-grant"]' : '[data-appointment-id="appointment-first"]').tap()
    await f.page.locator('.appointment-management [data-self-action="reschedule"]').tap()
    await f.page.waitForURL((url: URL) => url.searchParams.get('reschedule') === 'appointment-first')
    assert.equal(new URL(f.page.url()).searchParams.get('rescheduleFrom'), guest ? 'browser' : 'account')
    await f.page.locator('.fresha-option[data-professional-id="q"]').waitFor({ state: 'visible' })
    await f.page.locator('#booking-back').tap()
    if (guest) await f.page.locator('button[data-guest-booking-id="browser-grant"]').waitFor({ state: 'visible' })
    else { await f.page.waitForURL('**/cuenta'); await f.page.locator('[data-appointment-id="appointment-first"]').waitFor({ state: 'visible' }) }
    assert.equal(new URL(f.page.url()).searchParams.has('reschedule'), false)
    assert.equal(f.requests.filter((r: any) => r.method === 'POST').length, 0)
    assert.equal(new URL(f.page.url()).hostname, f.host)
    await clean(f)
  })
  for (const from of ['account', 'browser']) await check('saved action returns to reservations, while another booking opens the existing wizard ' + from, async () => {
    const f = await fixture({ guest: from === 'browser', from, group: false })
    await professionalSteps(f); await chooseTime(f)
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap()
    await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' })
    await f.page.getByRole('button', { name: 'Volver a reservas', exact: true }).tap()
    if (from === 'account') await f.page.waitForURL('**/cuenta')
    else await f.page.locator('button[data-guest-booking-id="browser-grant"]').waitFor({ state: 'visible' })
    assert.equal(f.posts.length, 1)
    await f.page.goto('https://' + f.host + f.base + '/reservar?reschedule=appointment-first&rescheduleFrom=' + from)
    await professionalSteps(f); await chooseTime(f)
    await f.page.getByRole('button', { name: 'Confirmar cambio', exact: true }).tap()
    await f.page.getByText('Tu reserva fue reprogramada', { exact: false }).waitFor({ state: 'visible' })
    await f.page.getByRole('button', { name: 'Reservar otro turno', exact: true }).tap()
    await f.page.locator('[data-service-id="same-service"]').waitFor({ state: 'visible' })
    assert.equal(new URL(f.page.url()).searchParams.has('reschedule'), false)
    assert.equal(f.posts.length, 2)
    await clean(f)
  })
  await check('browser return keeps the earlier draft and resume reuses its selection without posting', async () => {
    const savedDraft = JSON.stringify({ version: 1, createdAt: Date.now(), slug: 'safe-wizard', origin: 'https://weex.test', path: '/safe-wizard/reservar', selections: [{ serviceId: 'same-service', estimateOptionId: 'changed' }], professionalId: null, date: null, time: null, segments: null, guestName: 'Original draft', guestPhone: '+598 99 123 456' })
    const f = await fixture({ entry: true, guest: true, savedDraft })
    await f.page.locator('.fresha-option[data-professional-id="p"]').waitFor({ state: 'visible' })
    await f.page.locator('#booking-header-reservations').tap()
    await f.page.locator('button[data-guest-booking-id="browser-grant"]').tap()
    await f.page.locator('.appointment-management [data-self-action="reschedule"]').tap()
    await f.page.locator('.fresha-option[data-professional-id="q"]').waitFor({ state: 'visible' })
    const key = 'weex.login-draft:safe-wizard:/safe-wizard/reservar'
    const draftBefore = await f.page.evaluate((key: string) => sessionStorage.getItem(key), key)
    assert.ok(draftBefore)
    await f.page.locator('#booking-back').tap()
    await f.page.locator('#booking-resume-draft').waitFor({ state: 'visible' })
    await f.page.locator('#booking-resume-draft').tap()
    await f.page.locator('.fresha-option[data-professional-id="p"]').waitFor({ state: 'visible' })
    assert.match(await f.page.locator('#booking-summary-lines').innerText(), /Catalogo cambiado/)
    assert.equal(f.requests.filter((r: any) => r.method === 'POST').length, 0)
    await clean(f)
  })
  await check('leaving managed mode keeps an existing browser draft and removes reschedule context', async () => {
    const savedDraft = JSON.stringify({ version: 1, createdAt: Date.now(), slug: 'safe-wizard', origin: 'https://weex.test', path: '/safe-wizard/reservar', selections: [{ serviceId: 'same-service', estimateOptionId: 'changed' }], professionalId: null, date: null, time: null, segments: null, guestName: 'Original draft', guestPhone: '+598 99 123 456' }), f = await fixture({ savedDraft })
    await f.page.locator('.fresha-option[data-professional-id="q"]').waitFor({ state: 'visible' })
    const key = 'weex.login-draft:safe-wizard:/safe-wizard/reservar'; assert.equal(await f.page.evaluate((key: string) => sessionStorage.getItem(key), key), savedDraft)
    // Close management by its existing back control; storage is read before following the returned page.
    await f.page.locator('#booking-back').tap(); await f.page.waitForURL((url: URL) => !url.searchParams.has('reschedule')); await f.page.locator('.fresha-option[data-professional-id="p"]').waitFor({ state: 'visible' }); assert.match(await f.page.locator('#booking-summary-lines').innerText(), /Catalogo cambiado/); assert.equal(f.posts.length, 0); assert.equal(f.requests.filter((r: any) => r.method === 'POST').length, 0); await clean(f)
  })
} finally {
  for (const context of contexts) await context.close(); await browser.close(); await app.close(); BusinessService.prototype.findPublicBySlug = previous
  await writeFile(directory + '/results.json', JSON.stringify({ passes, failures, results }, null, 2))
}
console.log(`Reschedule shared wizard: ${passes} passed, ${failures} failed`)
if (failures) process.exitCode = 1
