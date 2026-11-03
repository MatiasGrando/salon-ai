import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.DOTENV_CONFIG_PATH = '__offline_cancellation_dialog_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_cancellation_dialog'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const original = BusinessService.prototype.findPublicBySlug
const business: any = { id: 'cancel-dialog', slug: 'cancel-dialog', name: 'Local sintetico', timezone: 'UTC', accountStatus: 'ACTIVE', landingEnabled: true,
  bookingTheme: 'light', allowGuestWebBooking: true, publicWhatsapp: '5491166553322', services: [], professionals: [] }
BusinessService.prototype.findPublicBySlug = async () => business
const app = Fastify(); await app.register(landingUiRoutes)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined,
  args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] })
const directory = 'tmp/appointment-cancellation-dialog/' + (process.env.CANCELLATION_EVIDENCE || 'latest')
await mkdir(directory, { recursive: true })
const fixtures: any[] = [], results: any[] = []
let passed = 0, failed = 0
async function check(name: string, run: () => any) {
  if (process.env.CANCELLATION_FILTER && !name.includes(process.env.CANCELLATION_FILTER)) return
  try { await run(); passed++; results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { failed++; results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function fixture(options: any = {}) {
  const rows = [
    { id: 'first', startAt: '2030-10-25T19:00:00Z', status: 'CONFIRMED', quotedPrice: 64000, totalDurationMinutes: 85,
      service: { id: 'color', name: 'Coloracion contratada', duration: 85, price: 64000 }, professional: { id: 'p', name: 'Profesional A' } },
    { id: 'second', startAt: '2030-10-25T20:25:00Z', status: 'CONFIRMED', quotedPrice: 17000, totalDurationMinutes: 35,
      service: { id: 'cut', name: 'Corte contratado', duration: 35, price: 17000 }, professional: { id: 'q', name: 'Profesional B' } }
  ]
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: options.height || 844 }, hasTouch: true,
    reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Buenos_Aires' })
  await context.addInitScript({ content: 'globalThis.__name = value => value;' })
  const f: any = { context, rows, requests: [], errors: [], dialogs: [], outcomes: [], revision: 'first-revision', guest: options.guest, postGate: null }
  fixtures.push(f)
  const account = { id: 'synthetic-owner', name: 'Persona sintetica', email: 'synthetic@example.test', phone: '5491166553322' }
  const managed = () => ({ appointments: rows.map(r => ({ id: r.id, startAt: r.startAt, status: r.status,
    service: { id: r.service.id, name: r.service.name, duration: r.totalDurationMinutes, price: r.quotedPrice }, professional: r.professional })),
    selfService: { mode: rows.every(r => r.status === 'CANCELLED') ? 'contact' : 'direct', canCancel: rows.every(r => r.status !== 'CANCELLED'),
      canReschedule: rows.every(r => r.status !== 'CANCELLED'), timezone: 'UTC', revision: f.revision, professionalChoices: [] } })
  f.posts = () => f.requests.filter((r: any) => r.path.endsWith('/cancel') && r.method === 'POST')
  await context.route('**/*', async (route: any) => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== 'weex.test') return route.abort()
    if (request.isNavigationRequest()) { const response = await app.inject({ url: url.pathname + url.search, headers: { host: 'weex.test', 'x-forwarded-proto': 'https' } }); return route.fulfill({ status: response.statusCode, contentType: 'text/html', body: response.body }) }
    const entry = { path: url.pathname, query: url.search, method: request.method(), body: request.postData() ? request.postDataJSON() : null }; f.requests.push(entry)
    let body: any = {}, status = 200
    if (url.pathname === '/public/weex/me') { status = f.guest ? 401 : 200; body = { account } }
    else if (url.pathname === '/public/weex/appointments') body = { appointments: rows }
    else if (url.pathname.endsWith('/catalog')) body = { business, services: rows.map(r => ({ ...r.service, price: 999999, duration: 5 })), professionals: rows.map(r => r.professional) }
    else if (url.pathname.endsWith('/pending-deposit')) body = {}
    else if (url.pathname.endsWith('/guest-booking')) body = { guest: true, bookingId: 'scoped-grant', appointments: rows, bookings: [{ guest: true, bookingId: 'scoped-grant', appointments: rows }] }
    else if (url.pathname.endsWith('/manage')) { assert.equal(url.searchParams.get('view'), 'actions'); body = managed() }
    else if (url.pathname.endsWith('/cancel') && request.method() === 'POST') {
      assert.deepEqual(Object.keys(entry.body).sort(), ['confirmed', 'operationId', 'revision']); assert.equal(entry.body.confirmed, true)
      assert.match(entry.body.operationId, /^[a-f\d-]{36}$/i)
      if (f.postGate) await f.postGate.promise
      const outcome = f.outcomes.shift()
      if (outcome === 'network') return route.abort('failed')
      status = outcome || 200
      if (status === 200) { rows.forEach(r => r.status = 'CANCELLED'); f.revision = 'cancelled-revision'; body = managed() }
      else if (status === 409) { f.revision = 'fresh-revision'; body = { message: 'La reserva cambió. Revisá el pedido completo.' } }
      else body = { message: status === 403 ? 'Acceso a la reserva no disponible.' : 'No pudimos cancelar en este momento.' }
    } else { status = 404; f.errors.push('Unexpected endpoint ' + request.method() + ' ' + url.pathname) }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(2500); f.page = page
  page.on('pageerror', (e: any) => f.errors.push(String(e))); page.on('dialog', async (d: any) => { f.dialogs.push(d.type()); await d.dismiss() })
  await page.goto('https://weex.test/cancel-dialog/' + (f.guest ? 'reservar?reservationView=browser' : 'cuenta'), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator(f.guest ? 'button[data-guest-booking-id="scoped-grant"]' : '[data-appointment-id="first"]').tap()
  await page.locator('[data-self-action="cancel"]').waitFor({ state: 'visible' })
  return f
}
const dialog = (f: any) => f.page.locator('dialog.appointment-cancel-dialog[open]')
async function open(f: any) { await f.page.locator('[data-self-action="cancel"]').tap(); await dialog(f).waitFor({ state: 'visible' }) }
async function clean(f: any) { assert.deepEqual(f.errors, []); assert.deepEqual(f.dialogs, []); await f.context.close(); fixtures.splice(fixtures.indexOf(f), 1) }
try {
  for (const guest of [false, true]) for (const width of [390, 1366]) await check('separate accessible confirmation shows the complete booked group ' + width + '/' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ guest, width }); await open(f)
    assert.match(await dialog(f).getAttribute('aria-label') || await dialog(f).getAttribute('aria-labelledby') || '', /.+/)
    assert.equal(await dialog(f).getAttribute('aria-modal'), 'true')
    assert.match(await dialog(f).innerText(), /[Cc]ancelar/)
    for (const value of ['Coloracion contratada', 'Corte contratado', 'Profesional A', 'Profesional B', '19:00', '20:25', '64.000', '17.000', '85 min', '35 min']) assert.ok((await dialog(f).innerText()).includes(value), value)
    assert.ok(!(await dialog(f).innerText()).includes('999.999'), 'use booked snapshots, not catalog prices')
    assert.equal(f.posts().length, 0, 'opening confirmation cannot cancel')
    assert.equal(await f.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.selfAction), 'back', 'initial focus is on the safe action')
    const metrics = await dialog(f).evaluate((node: HTMLDialogElement) => ({ modal: node.matches(':modal'), rect: node.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight },
      backdrop: getComputedStyle(node, '::backdrop').backgroundColor, buttons: [...node.querySelectorAll('button')].filter(b => !b.hidden).map(b => ({ label: b.textContent, ...b.getBoundingClientRect().toJSON() })) }))
    assert.equal(metrics.modal, true, 'top layer makes background controls inert')
    assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(metrics.backdrop))
    assert.ok(metrics.rect.width <= width && metrics.rect.height <= metrics.viewport.height)
    for (const button of metrics.buttons) assert.ok(button.height >= 44, button.label + ' must have a full touch target')
    if (width < 768) assert.ok(Math.abs(metrics.rect.bottom - metrics.viewport.height) <= 8, 'mobile confirmation is a bottom sheet')
    else assert.ok(Math.abs(metrics.rect.top + metrics.rect.height / 2 - metrics.viewport.height / 2) <= 25, 'desktop confirmation is centered')
    await f.page.screenshot({ path: directory + '/confirmation-' + width + '-' + (guest ? 'guest' : 'account') + '.png' }); await clean(f)
  })
  for (const guest of [false, true]) await check('safe dismiss, keyboard focus cycle and return focus ' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ guest }); await open(f)
    for (let i = 0; i < 8; i++) { await f.page.keyboard.press('Tab'); assert.equal(await dialog(f).evaluate((node: HTMLElement) => node.contains(document.activeElement)), true) }
    for (let i = 0; i < 8; i++) { await f.page.keyboard.press('Shift+Tab'); assert.equal(await dialog(f).evaluate((node: HTMLElement) => node.contains(document.activeElement)), true) }
    await f.page.keyboard.press('Escape'); assert.equal(await dialog(f).count(), 0)
    assert.equal(await f.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.selfAction), 'cancel'); assert.equal(f.posts().length, 0)
    await open(f); await dialog(f).locator('[data-self-action="back"]').tap(); assert.equal(await dialog(f).count(), 0); assert.equal(f.posts().length, 0)
    await clean(f)
  })
  for (const guest of [false, true]) await check('pending cancellation keeps one dialog, blocks repeat/close/navigation and persists authoritative success ' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ guest }), hold = gate(); f.postGate = hold; await open(f)
    await dialog(f).evaluate((node: any) => node.__identity = 'retained-dialog')
    const initialUrl = f.page.url()
    await dialog(f).locator('[data-self-action="confirm-cancel"]').tap()
    await dialog(f).locator('[aria-busy="true"]').waitFor({ state: 'visible' })
    assert.match(await dialog(f).innerText(), /[Cc]ancelando|Estamos.*cancelaci/)
    assert.equal(await dialog(f).locator('[data-self-action="confirm-cancel"]').isDisabled(), true)
    assert.equal(await dialog(f).locator('[data-self-action="back"]').isDisabled(), true)
    await f.page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-self-action="confirm-cancel"]')?.click(); document.querySelector<HTMLButtonElement>('[data-self-action="back"]')?.click() })
    await f.page.keyboard.press('Escape'); await f.page.mouse.click(2, 2)
    assert.equal(await dialog(f).count(), 1); assert.equal(f.posts().length, 1); assert.equal(f.page.url(), initialUrl)
    assert.equal(await dialog(f).evaluate((node: HTMLElement) => node.contains(document.activeElement)), true)
    assert.equal(await dialog(f).evaluate((node: any) => node.__identity), 'retained-dialog')
    await f.page.screenshot({ path: directory + '/pending-' + (guest ? 'guest' : 'account') + '.png' })
    hold.resolve(); await dialog(f).getByRole('heading', { name: /(?:Turno|Reserva) cancelad[oa]/i }).waitFor({ state: 'visible' })
    assert.equal(await dialog(f).evaluate((node: any) => node.__identity), 'retained-dialog')
    assert.ok(f.rows.every((r: any) => r.status === 'CANCELLED')); assert.equal(f.posts().length, 1)
    await f.page.waitForTimeout(200); assert.equal(await dialog(f).count(), 1, 'success cannot silently disappear')
    assert.equal(await dialog(f).evaluate((node: HTMLElement) => node.contains(document.activeElement)), true)
    assert.equal(await dialog(f).locator('[data-self-action="confirm-cancel"]').count(), 0)
    await f.page.screenshot({ path: directory + '/success-' + (guest ? 'guest' : 'account') + '.png' })
    await dialog(f).getByRole('button', { name: /Volver a mis turnos|Cerrar/ }).first().tap()
    assert.equal(await dialog(f).count(), 0); assert.equal(await f.page.locator('[data-self-action="cancel"]:visible').count(), 0)
    await clean(f)
  })
  for (const guest of [false, true]) await check('network error stays in confirmation and explicit retry reuses the operation identity ' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture({ guest }); f.outcomes.push('network', 200); await open(f)
    await dialog(f).locator('[data-self-action="confirm-cancel"]').tap()
    await dialog(f).locator('[data-self-action="confirm-cancel"]:not([disabled])').waitFor({ state: 'visible' })
    assert.equal(f.posts().length, 1); assert.ok(f.rows.every((r: any) => r.status === 'CONFIRMED'))
    assert.ok(!(await dialog(f).innerText()).includes('Turno cancelado'))
    await dialog(f).locator('[data-cancel-title]').focus()
    await f.page.keyboard.press('Shift+Tab')
    assert.equal(await f.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.selfAction), 'confirm-cancel', 'Shift+Tab from the focused error heading reaches the last control')
    await dialog(f).locator('[data-cancel-title]').focus()
    await f.page.keyboard.press('Tab')
    assert.equal(await f.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.selfAction), 'dismiss-cancel', 'Tab from the heading reaches the first control')
    await dialog(f).locator('[data-self-action="confirm-cancel"]').tap()
    await dialog(f).getByRole('heading', { name: /(?:Turno|Reserva) cancelad[oa]/i }).waitFor({ state: 'visible' })
    assert.equal(f.posts().length, 2); assert.equal(f.posts()[0].body.operationId, f.posts()[1].body.operationId)
    assert.equal(f.posts()[0].body.revision, f.posts()[1].body.revision); await clean(f)
  })
  await check('revision conflict reloads a complete current group without claiming cancellation or auto-submitting', async () => {
    const f = await fixture(); f.outcomes.push(409); await open(f); await dialog(f).locator('[data-self-action="confirm-cancel"]').tap()
    await f.page.getByText('La reserva cambió. Revisá el pedido completo.', { exact: false }).first().waitFor({ state: 'visible' })
    assert.equal(f.posts().length, 1); assert.ok(f.rows.every((r: any) => r.status === 'CONFIRMED'))
    assert.equal(f.requests.filter((r: any) => r.path.endsWith('/manage')).length, 2)
    const current = await f.page.locator('.appointment-management').innerText()
    assert.match(current, /Coloracion contratada/); assert.match(current, /Corte contratado/)
    assert.ok(!current.includes('La reserva fue cancelada')); await clean(f)
  })
  await check('authority loss cannot leave a usable confirmation or fabricate success', async () => {
    const f = await fixture(); f.outcomes.push(403); await open(f); await dialog(f).locator('[data-self-action="confirm-cancel"]').tap()
    await f.page.getByText('Acceso a la reserva no disponible.', { exact: false }).first().waitFor({ state: 'visible' })
    assert.equal(f.posts().length, 1); assert.ok(f.rows.every((r: any) => r.status === 'CONFIRMED'))
    assert.equal(await f.page.locator('[data-self-action="confirm-cancel"]:enabled').count(), 0)
    assert.equal(await f.page.locator('[data-self-action="cancel"]:enabled').count(), 0); await clean(f)
  })
  await check('disposing a superseded manager removes its modal and restores the original body scroll state', async () => {
    const f = await fixture({ width: 1366 }), overflow = await f.page.evaluate(() => document.body.style.overflow); await open(f)
    assert.equal(await f.page.evaluate(() => document.body.style.overflow), 'hidden')
    await f.page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-appointment-id="second"]')!.click())
    await f.page.locator('[data-self-action="cancel"]').waitFor({ state: 'visible' })
    assert.equal(await dialog(f).count(), 0); assert.equal(await f.page.evaluate(() => document.body.style.overflow), overflow)
    assert.equal(f.posts().length, 0); await clean(f)
  })
  for (const width of [320, 484, 768, 820]) await check('dialog fits a short viewport with readable scrollable content and visible actions ' + width, async () => {
    const f = await fixture({ width, height: 600, guest: width === 484 }); await open(f)
    const metrics = await dialog(f).evaluate((node: HTMLDialogElement) => ({ width: node.clientWidth, scroll: node.scrollWidth, bounds: node.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight }, cancel: node.querySelector('[data-self-action="confirm-cancel"]')!.getBoundingClientRect().toJSON() }))
    assert.ok(metrics.scroll <= metrics.width + 1, 'no horizontal dialog overflow')
    assert.ok(metrics.bounds.top >= -1 && metrics.bounds.bottom <= metrics.viewport.height + 1)
    assert.ok(metrics.cancel.top >= metrics.bounds.top && metrics.cancel.bottom <= metrics.viewport.height, 'confirmation remains visible without scrolling the entire page')
    await f.page.screenshot({ path: directory + '/short-' + width + '.png' }); await clean(f)
  })
} finally {
  for (const f of fixtures) { f.postGate?.resolve(); await f.context.close() }
  await browser.close(); await app.close(); BusinessService.prototype.findPublicBySlug = original
  await writeFile(directory + '/results.json', JSON.stringify({ passed, failed, results }, null, 2))
}
console.log('Appointment cancellation dialog UI: ' + passed + ' PASS, ' + failed + ' FAIL')
if (failed) process.exitCode = 1
