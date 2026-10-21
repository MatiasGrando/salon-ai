import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
process.env.DOTENV_CONFIG_PATH = '__offline_booking_navigation_no_env__'
process.env.DATABASE_URL = process.env.DIRECT_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_booking_navigation'
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
const photo = await readFile(new URL('../src/assets/landing/barber-hero-service.png', import.meta.url))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined,
  args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] })
const directory = 'tmp/booking-navigation-presentation/' + (process.env.NAVIGATION_EVIDENCE || 'latest')
await mkdir(directory, { recursive: true })
const sourceHash = createHash('sha256').update(await readFile(new URL('../src/routes/landing-ui.ts', import.meta.url))).digest('hex')
let passed = 0, failed = 0
const contexts: any[] = [], results: any[] = []
async function check(name: string, run: () => any) {
  if (process.env.NAVIGATION_FILTER && !name.includes(process.env.NAVIGATION_FILTER)) return
  const startingContexts = new Set(contexts)
  try { await run(); passed++; results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { failed++; results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
  finally { for (const context of contexts.slice()) if (!startingContexts.has(context)) { await context.close(); contexts.splice(contexts.indexOf(context), 1) } }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const pros = [{ id: 'pro', name: 'Profesional de prueba' }]
const snapshot = (id: string, name: string) => ({ id, startAt: '2030-10-25T18:00:00Z', status: 'CONFIRMED',
  quotedPrice: 15000, totalDurationMinutes: 30, service: { id: 'cut', name, price: 15000, duration: 30 }, professional: pros[0] })
async function fixture(config: any = {}) {
  const width = config.width || 390
  const services = [
    { id: 'cut', name: config.longNames ? 'Corte de cabello personalizado con acabado y asesoramiento' : 'Corte Hombre', category: 'Cortes', duration: 30, displayDuration: '30 min', price: 15000, priceMode: 'FIXED', professionalIds: ['pro'], imageUrl: 'https://weex.test/fixture/cut.png', agendaFavorite: true },
    { id: 'color', name: 'Color Completo', category: 'Coloracion', duration: 90, displayDuration: '90 min', price: 65000, priceMode: 'FIXED', professionalIds: ['pro'], imageUrl: null },
    { id: 'roots', name: 'Raices', category: 'Coloracion', duration: 60, displayDuration: '60 min', price: 40000, priceMode: 'FIXED', professionalIds: ['pro'], imageUrl: 'https://weex.test/fixture/broken.png', deposit: { amount: 30000 } },
    { id: 'estimate', name: 'Iluminacion', category: 'Iluminacion', duration: 120, displayDuration: '120 min', price: 60000, priceMode: 'FROM', professionalIds: ['pro'], imageUrl: 'javascript:globalThis.__unsafeThumbnail=true', attentionMode: 'GUIDED_ESTIMATE', estimateOptions: [{ id: 'short', label: 'Largo corto', priceMin: 60000, priceMax: 80000 }] }
  ]
  const rows = [snapshot('first', 'Corte Hombre'), ...(config.group ? [snapshot('second', 'Color Completo')] : [])]
  business = { id: 'navigation', slug: 'navigation', name: 'Barber de prueba', landingSubtitle: 'Especialidad publicada por el local', timezone: 'America/Argentina/Buenos_Aires',
    accountStatus: 'ACTIVE', landingEnabled: true, landingTemplate: 'classic', bookingTheme: config.theme || 'light', allowGuestWebBooking: true,
    ...(config.brandImages ? { coverImageUrl: 'https://weex.test/fixture/cover.png', logoUrl: 'https://weex.test/fixture/logo.png' } : {}),
    services: [], professionals: [] }
  const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 1024 : 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Buenos_Aires' }); contexts.push(context)
  await context.addInitScript({ content: 'globalThis.__name = value => value;' })
  const f: any = { context, rows, services, requests: [], errors: [], dialogs: [], imageGate: config.holdImages ? gate() : null, postGate: null, posts: [] }
  const managed = () => ({ appointments: rows.map(({ quotedPrice, totalDurationMinutes, ...row }) => ({ ...row, service: { ...row.service, price: quotedPrice, duration: totalDurationMinutes } })),
    selfService: { timezone: business.timezone, mode: 'direct', canCancel: true, canReschedule: true, revision: 'synthetic-revision', professionalChoices: rows.map(row => ({ appointmentId: row.id, professionals: pros })) } })
  await context.route('**/*', async (route: any) => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname !== 'weex.test') return route.abort()
    if (req.isNavigationRequest()) { const rendered = await app.inject({ url: url.pathname + url.search, headers: { host: 'weex.test', 'x-forwarded-proto': 'https' } }); assert.equal(rendered.statusCode, 200); return route.fulfill({ contentType: 'text/html', body: rendered.body }) }
    if (['/fixture/cover.png', '/fixture/logo.png'].includes(url.pathname)) return route.fulfill({ contentType: 'image/png', body: photo })
    if (url.pathname === '/fixture/cut.png') { if (f.imageGate) await f.imageGate.promise; return route.fulfill({ contentType: 'image/png', body: photo }) }
    if (url.pathname === '/fixture/broken.png') { if (f.imageGate) await f.imageGate.promise; return route.fulfill({ status: 404, body: '' }) }
    f.requests.push({ path: url.pathname, query: url.search, method: req.method(), body: req.postData() ? req.postDataJSON() : null })
    let status = 200, body: any = {}
    if (url.pathname.endsWith('/catalog')) body = { business, services, professionals: pros, combinationRules: [] }
    else if (url.pathname === '/public/weex/me') { status = config.guest ? 401 : 200; body = config.guest ? {} : { account: { id: 'owner', name: 'Persona de prueba', phone: '5491166553322', email: 'synthetic@example.test' } } }
    else if (url.pathname === '/public/weex/appointments') body = { appointments: rows }
    else if (url.pathname.endsWith('/guest-booking')) { status = config.collection ? 200 : 404; body = config.collection ? { guest: true, bookingId: 'browser-grant', appointments: rows, bookings: [{ guest: true, bookingId: 'browser-grant', appointments: rows }] } : {} }
    else if (url.pathname.endsWith('/pending-deposit')) body = {}
    else if (url.pathname.endsWith('/manage')) body = managed()
    else if (url.pathname.endsWith('/availability')) body = { slots: ['15:00', '16:00'].map(time => ({ time, professionalId: 'pro', professionalName: pros[0].name })) }
    else if (url.pathname.endsWith('/itineraries')) body = { options: [{ id: 'itinerary', startTime: '15:00', endTime: '17:00', segments: services.slice(0, 2).map((service, i) => ({ serviceId: service.id, serviceName: service.name, professionalId: 'pro', professionalName: pros[0].name, startTime: i ? '15:30' : '15:00', endTime: i ? '17:00' : '15:30' })) }] }
    else if (url.pathname.endsWith('/reschedule-options')) body = { selfService: managed().selfService, options: [{ id: 'reschedule-option', date: url.searchParams.get('date'), time: '15:00', segments: rows.map((row, i) => ({ appointmentId: row.id, serviceName: row.service.name, professionalId: 'pro', professionalName: pros[0].name, startAt: i ? '2030-10-26T18:30:00Z' : '2030-10-26T18:00:00Z', durationMinutes: 30 })) }] }
    else if (/\/book(?:-coordinated)?$/.test(url.pathname)) { f.posts.push(url.pathname); if (f.postGate) await f.postGate.promise; body = { appointment: rows[0], appointments: rows, deposit: null } }
    else { status = 404; f.errors.push('Unexpected endpoint ' + req.method() + ' ' + url.pathname) }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(3500); f.page = page
  page.on('pageerror', (e: any) => f.errors.push(String(e))); page.on('dialog', async (d: any) => { f.dialogs.push(d.type()); await d.dismiss() })
  const path = config.account ? '/cuenta' : '/reservar' + (config.reschedule ? '?reschedule=first&rescheduleFrom=account' : config.collection ? '?reservationView=browser' : '?reservationView=new')
  await page.goto('https://weex.test/navigation' + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator(config.account ? '[data-appointment-id="first"]' : config.collection ? 'button[data-guest-booking-id="browser-grant"]' : config.reschedule ? '[data-professional-id="pro"]' : '[data-service-id="cut"]').waitFor({ state: 'visible' })
  return f
}
async function clean(f: any) { assert.deepEqual(f.errors, []); assert.deepEqual(f.dialogs, []); f.imageGate?.resolve(); f.postGate?.resolve(); await f.context.close(); contexts.splice(contexts.indexOf(f.context), 1) }
async function navigation(f: any, progress = true) {
  const nav = f.page.locator('[data-booking-navigation]:visible').first()
  assert.equal(await nav.count(), 1, 'shared navigation surface must be visible')
  assert.match(await nav.innerText(), /Volver/); assert.match(await nav.innerText(), /Mi cuenta/)
  assert.equal(await f.page.locator('[data-booking-progress]:visible').count(), progress ? 1 : 0, 'only an active wizard has progress')
  return nav
}
async function progress(f: any, step: number, total: number) {
  await navigation(f)
  const bar = f.page.locator('[data-booking-progress]:visible')
  assert.equal(await bar.getAttribute('data-step'), String(step)); assert.equal(await bar.getAttribute('data-total'), String(total))
  assert.match((await bar.innerText()).replace(/\s+/g, ' '), new RegExp('Paso ' + step + ' de ' + total))
  assert.equal(await bar.locator('[data-booking-progress-segment]').count(), total)
}
async function next(f: any) {
  const mobile = f.page.locator('#booking-mobile-continue')
  await (await mobile.isVisible() ? mobile : f.page.locator('#booking-continue')).click()
}
async function singleTime(f: any) {
  await f.page.locator('[data-service-id="cut"]').tap(); await next(f)
  await f.page.locator('[data-professional-id="pro"]').tap(); await next(f)
  await f.page.locator('.slot[data-time="15:00"]').waitFor({ state: 'visible' })
}
async function geometry(f: any) {
  const layout = await f.page.evaluate(() => {
    const nav = document.querySelector('[data-booking-navigation]')!, heading = document.querySelector('#booking-heading')!
    const visible = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
    const controls = [...nav.querySelectorAll('button,a')].filter(visible).map(e => ({ text: (e.textContent || e.getAttribute('aria-label') || '').trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))
    const footer = document.querySelector('#booking-mobile-bar')!, footerStyle = getComputedStyle(footer)
    const lastRow = [...document.querySelectorAll('.booking-service-option')].at(-1)!
    const main = document.querySelector('.fresha-booking')!
    return { overflow: document.documentElement.scrollWidth - innerWidth, controls, navBottom: nav.getBoundingClientRect().bottom, headingTop: heading.getBoundingClientRect().top,
      mainWidth: main.getBoundingClientRect().width, viewport: innerWidth, footerFixed: footerStyle.position === 'fixed' && visible(footer), footerTop: footer.getBoundingClientRect().top, lastBottom: lastRow.getBoundingClientRect().bottom }
  })
  assert.ok(layout.overflow <= 1, 'horizontal viewport overflow: ' + layout.overflow)
  assert.ok(layout.mainWidth <= layout.viewport + 1)
  assert.ok(layout.headingTop >= layout.navBottom - 1, 'navigation overlaps heading')
  assert.ok(layout.controls.length >= 2)
  for (const control of layout.controls) { assert.ok(control.width >= 44 && control.height >= 44, control.text + ' touch target ' + control.width + 'x' + control.height) }
  if (layout.footerFixed) assert.ok(layout.lastBottom <= layout.footerTop + 1, 'last service cannot be scrolled above fixed action bar')
}
function contrastRatio(ink: number[], background: number[]) {
  const luminance = (rgb: number[]) => rgb.map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  const l = [luminance(ink), luminance(background)].sort((a, b) => b - a)
  return (l[0] + .05) / (l[1] + .05)
}
try {
  await check('320px real name duration price and deposit text never collide inside service rows', async () => {
    const f = await fixture({ width: 320, longNames: true })
    const rows = await f.page.locator('.booking-service-option').evaluateAll((items: Element[]) => {
      const rectangle = (b: DOMRect) => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height })
      const textRects = (element: Element) => {
        const rectangles: any[] = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) if (node.textContent?.trim()) {
          const range = document.createRange(); range.selectNodeContents(node)
          for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rectangles.push({ text: node.textContent.trim(), ...rectangle(rect) })
        }
        return rectangles
      }
      return items.map(item => ({ id: item.getAttribute('data-service-id'), copy: textRects(item.querySelector('.service-copy')!), right: textRects(item.querySelector('.option-right')!),
        thumbnail: rectangle(item.querySelector('[data-service-thumbnail]')!.getBoundingClientRect()), nameFont: parseFloat(getComputedStyle(item.querySelector('.service-copy strong')!).fontSize), priceFont: parseFloat(getComputedStyle(item.querySelector('.service-price')!).fontSize) }))
    })
    const overlap = (a: any, b: any) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5
    const collisions: any[] = []
    for (const row of rows) {
      assert.ok(row.nameFont >= 14 && row.priceFont >= 14, row.id + ' name/price text must remain readable')
      assert.ok(Math.abs(row.thumbnail.width - 48) < 1 && Math.abs(row.thumbnail.height - 48) < 1, row.id + ' real thumbnail footprint remains48px')
      for (const copy of row.copy) for (const right of row.right) if (overlap(copy, right)) collisions.push({ id: row.id, copy, right })
      for (const text of [...row.copy, ...row.right]) if (overlap(text, row.thumbnail)) collisions.push({ id: row.id, text, thumbnail: row.thumbnail })
    }
    await writeFile(directory + '/service-text-320.json', JSON.stringify({ rows, collisions }, null, 2))
    await f.page.screenshot({ path: directory + '/service-text-320.png', fullPage: true })
    assert.deepEqual(collisions, [], 'actual service text cannot overlap another column or thumbnail at320px')
    await clean(f)
  })
  await check('catalogue search and chips inherit the surrounding catalogue font in six themes', async () => {
    const mismatches: any[] = [], metrics: any[] = []
    for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) {
      const f = await fixture({ theme })
      const fonts = await f.page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily,
        service: getComputedStyle(document.querySelector('.service-copy strong')!).fontFamily,
        search: getComputedStyle(document.querySelector('[data-service-search]')!).fontFamily,
        placeholder: getComputedStyle(document.querySelector('[data-service-search]')!, '::placeholder').fontFamily,
        chips: [...document.querySelectorAll('[data-service-category]')].map(chip => getComputedStyle(chip).fontFamily) }))
      metrics.push({ theme, ...fonts })
      if (fonts.search !== fonts.service || fonts.placeholder !== fonts.service || fonts.chips.some(font => font !== fonts.service)) mismatches.push({ theme, ...fonts })
      await clean(f)
    }
    await writeFile(directory + '/font-metrics.json', JSON.stringify(metrics, null, 2))
    assert.deepEqual(mismatches, [], 'catalogue controls and placeholder must match adjacent service copy, without overriding the global theme or loading a new font')
  })
  await check('catalogue search and category chips have full 44px touch areas', async () => {
    const f = await fixture()
    const controls = await f.page.locator('.booking-service-search, [data-service-category]').evaluateAll((items: Element[]) => items.map(item => ({ name: item.className, width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })))
    assert.ok(controls.length >= 4)
    for (const control of controls) assert.ok(control.width >= 44 && control.height >= 44, control.name + ' touch area ' + control.width + 'x' + control.height)
    await f.page.locator('.booking-service-search').tap(); assert.equal(await f.page.locator('[data-service-search]').evaluate((input: Element) => input === document.activeElement), true)
    await clean(f)
  })
  for (const width of [390, 820]) await check('configured brand cover and logo remain real legible and proportionate ' + width, async () => {
    for (const theme of ['light', 'dark']) {
      const f = await fixture({ width, theme, brandImages: true })
      await f.page.waitForFunction(() => [...document.querySelectorAll('.booking-brand-cover, .booking-brand-logo img')].length === 2 && [...document.querySelectorAll('.booking-brand-cover, .booking-brand-logo img')].every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))
      assert.equal(await f.page.locator('.booking-brand-cover').getAttribute('src'), 'https://weex.test/fixture/cover.png')
      assert.equal(await f.page.locator('.booking-brand-logo img').getAttribute('src'), 'https://weex.test/fixture/logo.png')
      const brand = await f.page.evaluate(() => {
        const rail = document.querySelector('.booking-brand-rail')!, box = rail.getBoundingClientRect(), cover = document.querySelector('.booking-brand-cover')!, logo = document.querySelector('.booking-brand-logo')!, image = logo.querySelector('img')!
        const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
        return { overflow: document.documentElement.scrollWidth - innerWidth, opacity: Number(getComputedStyle(cover).opacity), surface: rgb(getComputedStyle(rail).backgroundColor), fit: getComputedStyle(image).objectFit, logoWidth: logo.getBoundingClientRect().width, logoHeight: logo.getBoundingClientRect().height,
          lines: [...document.querySelectorAll('.booking-brand-name strong, .booking-brand-name span')].map(line => { const b = line.getBoundingClientRect(); return { text: line.textContent, ink: rgb(getComputedStyle(line).color), fontSize: parseFloat(getComputedStyle(line).fontSize), inside: b.left >= box.left && b.right <= box.right + 1 && b.top >= box.top && b.bottom <= box.bottom + 1 } }) }
      })
      assert.ok(brand.overflow <= 1); assert.equal(brand.fit, 'contain'); assert.ok(Math.abs(brand.logoWidth - brand.logoHeight) < 1)
      for (const line of brand.lines) {
        assert.ok(line.inside && line.fontSize >= 12, 'published identity is clipped or unreadably small: ' + line.text)
        // An image of either extreme cannot exceed these composites at the measured opacity.
        const bounds = [0, 255].map(channel => brand.surface.map((base: number) => base * (1 - brand.opacity) + channel * brand.opacity))
        const contrast = Math.min(...bounds.map(background => contrastRatio(line.ink, background)))
        assert.ok(contrast >= 4.5, line.text + ' worst-case image contrast ' + contrast.toFixed(2))
      }
      await navigation(f); await f.page.screenshot({ path: directory + '/brand-' + theme + '-' + width + '.png', fullPage: true }); await clean(f)
    }
  })
  await check('actual dynamic steps: single four, estimated five, multi three, estimated multi four', async () => {
    const f = await fixture(); await progress(f, 1, 4)
    await f.page.locator('[data-service-id="cut"]').tap(); await progress(f, 1, 4)
    await f.page.locator('[data-service-id="color"]').tap(); await progress(f, 1, 3)
    await f.page.locator('[data-service-id="estimate"]').tap(); await progress(f, 1, 4)
    await f.page.locator('[data-service-id="cut"]').tap(); await f.page.locator('[data-service-id="color"]').tap(); await progress(f, 1, 5)
    await next(f); await progress(f, 2, 5); await clean(f)
  })
  for (const group of [false, true]) await check('reschedule progress uses booked members plus time and review ' + (group ? 'group' : 'single'), async () => {
    const f = await fixture({ reschedule: true, group }); await progress(f, 1, group ? 4 : 3)
    await f.page.locator('[data-professional-id="pro"]').tap(); await next(f); await progress(f, 2, group ? 4 : 3); assert.equal(f.posts.length, 0); await clean(f)
  })
  await check('guest contact and time auto-advance preserve actual last step and Back selection', async () => {
    const f = await fixture({ guest: true }); await singleTime(f); await progress(f, 3, 4)
    await f.page.locator('.slot[data-time="15:00"]').tap(); await f.page.locator('#booking-guest-name').waitFor(); await progress(f, 4, 4)
    await f.page.locator('#booking-back').tap(); await progress(f, 3, 4); await f.page.locator('.slot.selected[data-time="15:00"]').waitFor(); assert.equal(f.posts.length, 0); await clean(f)
  })
  await check('navigation cannot abandon explicit pending booking and terminal success has no fake progress', async () => {
    const f = await fixture(); await singleTime(f); await f.page.locator('.slot[data-time="15:00"]').tap(); await f.page.locator('.booking-account-ready').waitFor()
    f.postGate = gate(); await f.page.locator('#booking-continue').click(); await f.page.waitForTimeout(80); assert.equal(f.posts.length, 1)
    const oldUrl = f.page.url(), nav = await navigation(f)
    for (const control of await nav.locator('button,a').all()) {
      if (!await control.isVisible()) continue
      if (!await control.isDisabled() && await control.getAttribute('aria-disabled') !== 'true') await control.click({ force: true })
      assert.equal(f.page.url(), oldUrl, 'pending write cannot navigate away')
    }
    f.postGate.resolve(); await f.page.locator('.booking-success').waitFor(); await navigation(f, false); assert.equal(f.posts.length, 1); await clean(f)
  })
  for (const guest of [false, true]) await check('static account/browser list and detail share bar without wizard progress ' + (guest ? 'guest' : 'account'), async () => {
    const f = await fixture(guest ? { guest: true, collection: true } : { account: true }); await navigation(f, false)
    await f.page.locator(guest ? 'button[data-guest-booking-id="browser-grant"]' : '[data-appointment-id="first"]').tap()
    await f.page.locator('[data-self-action="cancel"]').waitFor(); await navigation(f, false); assert.equal(f.posts.length, 0); await clean(f)
  })
  await check('real thumbnail URL only; absent invalid and broken image use neutral fallback without layout shift', async () => {
    const f = await fixture({ holdImages: true }), wrappers = f.page.locator('[data-service-thumbnail]')
    assert.equal(await wrappers.count(), 4, 'each service reserves the same thumbnail footprint')
    const cut = f.page.locator('[data-service-id="cut"] [data-service-thumbnail]'), broken = f.page.locator('[data-service-id="roots"] [data-service-thumbnail]')
    assert.equal(await cut.locator('img').getAttribute('src'), 'https://weex.test/fixture/cut.png')
    const before = await cut.boundingBox(), brokenBefore = await broken.boundingBox(); f.imageGate.resolve()
    await f.page.waitForFunction(() => { const image = document.querySelector('[data-service-id="cut"] [data-service-thumbnail] img') as HTMLImageElement; return image?.complete && image.naturalWidth > 0 })
    await f.page.waitForTimeout(100)
    for (const id of ['color', 'estimate', 'roots']) assert.equal(await f.page.locator('[data-service-id="' + id + '"] [data-service-thumbnail] img:visible').count(), 0, id + ' must not display guessed/broken photo')
    assert.equal(await f.page.evaluate(() => (globalThis as any).__unsafeThumbnail), undefined)
    for (const [beforeBox, afterBox] of [[before, await cut.boundingBox()], [brokenBefore, await broken.boundingBox()]]) { assert.ok(beforeBox && afterBox); assert.ok(Math.abs(beforeBox.width - afterBox.width) < 1 && Math.abs(beforeBox.height - afterBox.height) < 1) }
    const imageStyle = await cut.locator('img').evaluate((img: Element) => ({ fit: getComputedStyle(img).objectFit, ratio: img.getBoundingClientRect().width / img.getBoundingClientRect().height }))
    assert.equal(imageStyle.fit, 'cover'); assert.ok(imageStyle.ratio > .75 && imageStyle.ratio < 1.35); await clean(f)
  })
  await check('search categories selection and published prices survive thumbnail rendering', async () => {
    const f = await fixture(); await f.page.locator('[data-service-id="cut"]').tap(); await f.page.locator('[data-service-category="Coloracion"]').tap()
    assert.equal(await f.page.locator('[data-service-id]').count(), 2); await f.page.locator('[data-service-id="color"]').tap()
    await f.page.locator('[data-service-category="all"]').tap(); await f.page.locator('[data-service-search]').fill('iluminacion')
    assert.equal(await f.page.locator('[data-service-id]').count(), 1); await f.page.locator('[data-service-search]').fill('')
    assert.equal(await f.page.locator('[data-service-id="cut"]').getAttribute('aria-pressed'), 'true'); assert.equal(await f.page.locator('[data-service-id="color"]').getAttribute('aria-pressed'), 'true')
    assert.match(await f.page.locator('[data-service-id="cut"]').innerText(), /15[.,]000/); assert.match(await f.page.locator('[data-service-id="roots"]').innerText(), /30[.,]000/); assert.equal(f.posts.length, 0); await clean(f)
  })
  for (const theme of ['light', 'dark', 'rose', 'sage', 'blue', 'violet']) for (const width of [320, 390, 484, 768, 820, 1366]) await check('responsive navigation real thumbnails touch and footer ' + theme + '/' + width, async () => {
    const f = await fixture({ width, theme, longNames: width === 320 }); await f.page.locator('[data-service-id="estimate"]').scrollIntoViewIfNeeded()
    if (process.env.NAVIGATION_SCREENSHOTS === '1') await f.page.screenshot({ path: directory + '/catalog-' + theme + '-' + width + '.png', fullPage: true })
    await navigation(f); assert.equal(await f.page.locator('[data-service-thumbnail]').count(), 4); await geometry(f); await clean(f)
  })
} finally {
  for (const context of contexts) await context.close()
  await browser.close(); await app.close(); BusinessService.prototype.findPublicBySlug = previous
  const endHash = createHash('sha256').update(await readFile(new URL('../src/routes/landing-ui.ts', import.meta.url))).digest('hex')
  await writeFile(directory + '/results.json', JSON.stringify({ passed, failed, sourceHash, endHash, frozenSource: sourceHash === endHash, results }, null, 2))
}
console.log('Booking navigation presentation: ' + passed + ' PASS, ' + failed + ' FAIL')
if (failed) process.exitCode = 1
