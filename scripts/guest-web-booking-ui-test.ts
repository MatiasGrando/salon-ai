import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

process.env.DOTENV_CONFIG_PATH = '__offline_guest_ui_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_guest_ui'
process.env.GOOGLE_CLIENT_ID = ''
process.env.WEEX_GOOGLE_CLIENT_ID = ''
const [{ landingUiRoutes }, { BusinessService }, { renderCrmHtml }] = await Promise.all([
  import('../src/routes/landing-ui.js'), import('../src/services/business-service.js'), import('../src/routes/crm-ui.js')
])
const original = BusinessService.prototype.findPublicBySlug
BusinessService.prototype.findPublicBySlug = async () => ({
  id: 'guest-ui', slug: 'guest-ui', name: 'Offline', accountStatus: 'ACTIVE', landingEnabled: true,
  landingTemplate: 'classic', allowGuestWebBooking: true, services: [], professionals: []
}) as any
const app = Fastify()
let passes = 0, failures = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message.split('\n')[0]) }
}
try {
  await app.register(landingUiRoutes)
  const html = (await app.inject('/guest-ui/reservar')).body
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function confirmBooking'))!
  function source(name: string) {
    const start = script.search(new RegExp('          (?:async )?function ' + name + '\\('))
    assert.ok(start >= 0, 'generated function missing: ' + name)
    const tail = script.slice(start + 10).search(/\n          (?:(?:async )?function |const |let |els\.|window\.)/)
    return script.slice(start, tail < 0 ? script.length : start + 10 + tail)
  }
  function element() { return { value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', focus() {}, setAttribute() {}, classList: { toggle() {} }, addEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] } } }
  function context(on = true): any {
    const calls: any[] = [], messages: any[] = [], gates: string[] = []
    const service = { id: 'cut', name: 'Corte', duration: 30, price: 100 }
    const state: any = { catalog: { business: { allowGuestWebBooking: on, name: 'Offline' }, services: [service] },
      service, services: [service], professionalId: 'p', date: '2026-10-15', dateLabel: 'jueves', slot: { time: '15:00', professionalId: 'p' },
      guestName: 'Synthetic', guestPhone: '15-6655-3322', weexAccount: null, submitting: false, guestBooking: false, deposit: null }
    const els: any = new Proxy({}, { get: (t: any, k: string) => t[k] ??= element() })
    const document = { getElementById: (_: string) => element(), querySelector: (_: string) => null }
    return { state, els, calls, messages, gates, document, window: { setTimeout() {} },
      refreshWeexAccount: async () => state.weexAccount, showBookingGate: (s: string) => gates.push(s), proceedToConfirm: () => calls.push({ proceed: true }),
      updateContinue: (...args: any[]) => calls.push({ continue: args }), setFeedback: (...args: any[]) => messages.push(args), render() {},
      isMultiService: () => state.services.length > 1, selectedServices: () => state.services,
      serviceDetail: () => ({ validationAccepted: true }), bookingApiUrl: (path: string, query = '') => '/public/booking/guest-ui' + path + (query ? '?' + query : ''),
      getJson: async () => null, rememberGuestBookings() {}, bookingDraftSnapshot: () => ({}),
      postJson: async (path: string, body: any) => { calls.push({ path, body }); return { guest: true, appointment: { id: 'new' }, deposit: null } },
      phoneForSubmit: (v: string) => v.trim(), escapeHtml: (v: any) => String(v || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), initials: () => 'S',
      formatPrice: (v: any) => '$' + v, formatDepositDeadline: (v: any) => v, backPath: '/guest-ui', accountPath: '/guest-ui/cuenta' }
  }
  const withGuest = (name: string) => source('guestBookingAllowed') + (name === 'renderConfirmStep' ? source('persistedBookingActions') + source('guestBookingStatus') : '') + source(name)
  await check('guest ON skips login gate after time; OFF retains Google gate', async () => {
    for (const on of [true, false]) {
      const c = context(on)
      await runInNewContext(withGuest('continueFromTimeStep') + '; continueFromTimeStep()', c)
      assert.equal(c.gates.length, on ? 0 : 1)
      assert.equal(c.calls.some(x => x.proceed), on)
    }
  })
  await check('valid Google account skips contact; missing phone preserves profile gate', async () => {
    for (const phone of ['5491166553322', null]) {
      const c = context(); c.state.weexAccount = { name: 'Google', phone }
      await runInNewContext(withGuest('continueFromTimeStep') + '; continueFromTimeStep()', c)
      assert.deepEqual(c.gates, phone ? [] : ['phone'])
    }
  })
  await check('guest confirmation renders own contact hierarchy and secondary Google, not fake account', () => {
    const c = context()
    runInNewContext(withGuest('renderConfirmStep') + '; renderConfirmStep()', c)
    for (const text of ['booking-guest-contact', 'booking-guest-name', 'booking-guest-phone', 'booking-guest-google', 'adulto responsable']) assert.ok(c.els.content.innerHTML.includes(text), text)
    assert.ok(!c.els.content.innerHTML.includes('type="email"'))
    assert.ok(!c.els.content.innerHTML.includes('maxlength="10"'))
  })
  await check('all exact phone formats reach single and coordinated payload without forced prefix or truncation', async () => {
    const phones = ['1566553322', '15-6655-3322', '1166553322', '91566553322', '91166553322', '+541566553322', '+5491566553322', '+5491166553322', '+54911-6655-3322', '+598 99 123 456', '00598 99 123 456', '+1 202 555 0123', '+34 612 345 678']
    for (const multi of [false, true]) for (const phone of phones) {
      const c = context(); c.state.guestPhone = phone
      if (multi) { c.state.services.push({ id: 'second' }); c.state.itinerary = { id: 'it' } }
      await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
      const request = c.calls.find(x => x.path)
      assert.ok(request, JSON.stringify(c.messages)); assert.equal(request.body.customerName, 'Synthetic'); assert.equal(request.body.customerPhone, phone)
      assert.equal(request.path.endsWith(multi ? '/book-coordinated' : '/book'), true)
      assert.equal(c.state.guestBooking, true)
    }
  })
  await check('blank guest contact fails in place without effects and retains selected time', async () => {
    for (const field of ['guestName', 'guestPhone']) {
      const c = context(); c.state[field] = ''
      await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
      assert.equal(c.calls.filter(x => x.path).length, 0); assert.equal(c.state.slot.time, '15:00')
      assert.ok(c.messages.some(x => x[1] === 'error'))
    }
  })
  await check('double-submit blocked, server failure retries without losing contact or slot', async () => {
    const c = context(); let resolve: any
    c.postJson = async (path: string, body: any) => { c.calls.push({ path, body }); return new Promise(r => { resolve = r }) }
    const first = runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
    await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
    assert.equal(c.calls.filter(x => x.path).length, 1)
    resolve({ guest: true, deposit: null }); await first
    const failed = context(); failed.postJson = async () => { throw new Error('Horario ocupado') }
    await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', failed)
    assert.equal(failed.state.submitting, false); assert.equal(failed.state.guestName, 'Synthetic'); assert.equal(failed.state.guestPhone, '15-6655-3322'); assert.equal(failed.state.slot.time, '15:00')
    assert.ok(failed.messages.some(x => x[0] === 'Horario ocupado'))
  })
  await check('Google success never submits guest contact or changes authenticated identity', async () => {
    const c = context(); c.state.weexAccount = { name: 'Google', phone: '4930123456' }
    c.postJson = async (path, body) => { c.calls.push({ path, body }); return { appointment: { id: 'new' } } }
    await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
    const request = c.calls.find(x => x.path)
    assert.equal(request.body.customerPhone, undefined); assert.equal(request.body.customerName, undefined); assert.equal(c.state.guestBooking, false)
  })
  await check('anonymous loader uses scoped guest status, never pending deposit or history by phone', async () => {
    const c = context(); const requests: string[] = []
    Object.assign(c, { getJson: async (path: string) => {
      requests.push(path)
      if (path.endsWith('/catalog')) return c.state.catalog
      return null
    }, applyGuestBooking: () => {}, bookingSteps: () => [1, 2, 3, 4] })
    await runInNewContext(source('loadCatalog') + '; loadCatalog()', c)
    assert.ok(requests.some(p => p.endsWith('/guest-booking')))
    assert.ok(!requests.some(p => /pending-deposit|\/history/.test(p)))
  })
  await check('guest success/review does not link to private account; account success retains previous link', () => {
    for (const guest of [true, false]) for (const proof of [true, false]) {
      const c = context(); c.state.guestBooking = guest; c.state.confirmed = !proof; c.state.proofSent = proof
      runInNewContext(withGuest('renderConfirmStep') + '; renderConfirmStep()', c)
      assert.equal(c.els.content.innerHTML.includes('/guest-ui/cuenta'), !guest)
      assert.equal(c.els.content.innerHTML.includes('booking-guest-refresh'), guest)
    }
  })
  await check('guest contact input and Google switching preserve raw contact and selection', () => {
    const handler = script.match(/els\.content\.addEventListener\('input', \(event\) => \{([\s\S]*?)\n          \}\)/)![1]
    const click = script.match(/els\.content\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n          \}\)/)![1]
    const c: any = context()
    for (const [id, value] of [['booking-guest-name', 'A < B'], ['booking-guest-phone', '+54911-6655-3322']]) {
      c.event = { target: { id, value, removeAttribute() {} } }
      runInNewContext('(function(){' + handler + '})()', c)
    }
    c.event = { target: { closest: (selector: string) => selector === '#booking-guest-google' ? {} : null } }
    runInNewContext('(function(){' + click + '})()', c)
    assert.deepEqual(c.gates, ['login']); assert.equal(c.state.guestName, 'A < B'); assert.equal(c.state.guestPhone, '+54911-6655-3322'); assert.equal(c.state.slot.time, '15:00')
    runInNewContext(withGuest('renderConfirmStep') + '; renderConfirmStep()', c)
    assert.ok(c.els.content.innerHTML.includes('A &lt; B'))
  })
  await check('cookie-scoped status restores only returned current reservation, including paid group summary', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'CANCELLED']) {
      const c: any = context(); c.bookingSteps = () => [1, 2, 3, 4]
      c.result = { guest: true, appointments: ['cut', 'second'].map((id, i) => ({ id: 'new-' + i, status,
        startAt: '2026-10-15T' + (i ? '19' : '18') + ':00:00Z', quotedPrice: 321, totalDurationMinutes: 60,
        service: { id, name: id, price: 100, duration: 30, displayDuration: '30 min' }, professional: { id: 'p' + i, name: 'Professional ' + i } })), deposit: status === 'CANCELLED' ? { status: 'EXPIRED' } : null }
      c.state.catalog.services[0].duration = 15
      c.state.catalog.services[0].displayDuration = '15 min'
      runInNewContext(source('applyGuestBooking') + '; applyGuestBooking(result)', c)
      assert.equal(c.state.guestBooking, true); assert.equal(c.state.date, '2026-10-15'); assert.equal(c.state.slot.time, '15:00')
      assert.equal(c.state.services[0].price, 321); assert.equal(c.state.services[0].duration, 60); assert.equal(c.state.itinerary.segments.length, 2)
      assert.equal(c.state.services[0].displayDuration, '60 min', 'booked duration must win over mutable catalog displayDuration')
      assert.equal(c.state.itinerary.segments[0].endTime, '16:00', 'segment end must use immutable booked duration')
      assert.equal(c.state.confirmed, status === 'CONFIRMED'); assert.equal(c.state.guestClosed, status === 'CANCELLED')
      assert.equal(c.state.weexAccount, null)
      if (status === 'CANCELLED') {
        runInNewContext(withGuest('renderConfirmStep') + '; renderConfirmStep()', c)
        assert.ok(c.els.content.innerHTML.includes('ya no est&aacute; activa'))
        assert.equal(c.els.continue.hidden, true)
      }
    }
  })
  await check('proof upload retains scoped existing endpoint, blocks repeat, and reports rejected files in place', async () => {
    const c: any = context(); c.state.guestBooking = true; c.state.deposit = { id: 'own-deposit' }; c.readFileAsDataUrl = async () => 'data:image/png;base64,offline'
    let resolve: any
    c.postJson = async (path: string, body: any) => { c.calls.push({ path, body }); return new Promise(r => { resolve = r }) }
    const file = { name: 'synthetic.png', size: 100 }, button = element(); c.file = file; c.button = button
    const first = runInNewContext(source('uploadDepositProof') + '; uploadDepositProof(file,button)', c)
    await new Promise(r => setTimeout(r, 0))
    await runInNewContext(source('uploadDepositProof') + '; uploadDepositProof(file,button)', c)
    assert.equal(c.calls.length, 1); assert.equal(c.calls[0].path, '/public/booking/guest-ui/deposits/own-deposit/proof')
    assert.equal(c.calls[0].body.filename, 'synthetic.png'); resolve({ ok: true }); await first
    assert.equal(c.state.proofSent, true); assert.equal(c.state.uploadingProof, false)
    c.state.proofSent = false; c.postJson = async () => { throw new Error('Formato no admitido') }
    await runInNewContext(source('uploadDepositProof') + '; uploadDepositProof(file,button)', c)
    assert.equal(c.button.disabled, false); assert.ok(c.messages.some((m: any[]) => m[0] === 'Formato no admitido')); assert.equal(c.state.deposit.id, 'own-deposit')
  })
  await check('CRM has isolated checkbox sizing and existing-form save/load hooks', () => {
    const crm = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
    assert.match(crm, /id="landing-web-booking-settings"/)
    assert.match(crm, /id="landing-allow-guest-web-booking"/)
    assert.match(crm, /allowGuestWebBooking: els\.landingAllowGuestWebBooking\.checked/)
    assert.match(crm, /els\.landingAllowGuestWebBooking\.checked = state\.business\?\.allowGuestWebBooking === true/)
    assert.match(crm, /els\.landingAllowGuestWebBooking\.disabled = state\.currentUser\?\.role === 'STAFF'/)
    assert.match(crm, /#landing-settings-form #landing-allow-guest-web-booking\s*\{[^}]*width:\s*1em\s*!important/)
  })
  await check('actual CRM save sends a boolean, respects STAFF, and load resets guest option from saved business', async () => {
    const crm = renderCrmHtml({ cashRegisterEnabled: false, pollingMarker: { enabled: false } } as any)
    function crmSource(name: string) {
      const match = new RegExp('(?:async )?function ' + name + '\\(').exec(crm)!
      assert.ok(match, 'CRM handler exists: ' + name)
      const tail = crm.slice(match.index).search(/\n    (?:(?:async )?function |const |let |els\.)/)
      return crm.slice(match.index, tail < 0 ? undefined : match.index + tail)
    }
    for (const role of ['BUSINESS_ADMIN', 'STAFF']) for (const checked of [true, false]) {
      const c: any = context(); c.state.businessId = 'own-business'; c.state.currentUser = { role }; c.els.landingAllowGuestWebBooking.checked = checked
      c.els.landingSlug.value = 'own-business'; c.event = { preventDefault() {} }
      Object.assign(c, { clearLandingSettingsFeedback() {}, showLandingSettingsFeedback: (...m: any[]) => c.messages.push(m),
        normalizeLandingSlug: (v: string) => v, defaultBookingThemeForTemplate: () => 'light',
        landingStyleContentFromForm: () => ({ title: 'Title' }), salonWhiteContentFromForm: () => ({}), luxeNailsContentFromForm: () => ({}),
        classicContentWithLegacyDefaults: () => ({}), setButtonLoading: () => true, renderLandingSettings() {},
        getJson: async (path: string, init: any) => { c.calls.push({ path, body: JSON.parse(init.body) }); return { allowGuestWebBooking: checked } } })
      c.document.querySelector = () => ({ value: 'editorial' })
      await runInNewContext(crmSource('saveLandingSettings') + '; saveLandingSettings(event)', c)
      assert.equal(c.calls.length, role === 'STAFF' ? 0 : 1)
      if (role !== 'STAFF') assert.equal(c.calls[0].body.allowGuestWebBooking, checked)
      const load = crmSource('renderLandingSettings')
      Object.assign(c, { renderBookingThemePreview() {}, renderLandingTemplateConfiguration() {}, loadLandingTemplateForm() {}, setLandingCover() {}, setLandingSocialImage() {}, setLandingGallery() {}, parseLandingGalleryImages: () => [], renderLandingLinks() {} })
      c.state.business = { allowGuestWebBooking: !checked }
      runInNewContext(load + '; renderLandingSettings()', c)
      assert.equal(c.els.landingAllowGuestWebBooking.checked, !checked); assert.equal(c.els.landingAllowGuestWebBooking.disabled, role === 'STAFF')
    }
  })
  function browserBooking(id: string, status = 'CONFIRMED', deposit: any = null): any {
    return { guest: true, bookingId: id, expiresAt: '2026-10-22T18:00:00Z', deposit,
      appointments: [{ id: 'appointment-' + id, status, startAt: '2026-10-15T18:00:00Z', quotedPrice: 321, totalDurationMinutes: 60,
        service: { id: 'cut', name: 'Corte', duration: 30, price: 100 }, professional: { id: 'p', name: 'Synthetic professional' } }] }
  }
  const browserFunctions = () => ['guestBookingAllowed', 'bookingDraftSnapshot', 'restoreBookingDraft', 'beginNewBooking',
    'rememberGuestBookings', 'viewGuestBookings', 'guestBookingStatus', 'renderGuestBookings', 'applyGuestBooking', 'refreshGuestBooking']
    .map(source).join('\n')
  await check('reopening with two grants offers their collection without hydrating the last reservation into the draft', async () => {
    const c = context(); const bookings = [browserBooking('new'), browserBooking('old')]
    Object.assign(c, { getJson: async (path: string) => path.endsWith('/catalog') ? c.state.catalog : path === '/public/weex/me' ? null : { ...bookings[0], bookings },
      bookingSteps: () => [1, 2, 3, 4] })
    await runInNewContext(browserFunctions() + source('loadCatalog') + '; loadCatalog()', c)
    assert.equal(c.state.bookingView, 'list'); assert.equal(c.state.guestBookings.length, 2)
    assert.equal(c.state.guestBooking, false); assert.equal(c.state.slot.time, '15:00'); assert.equal(c.state.deposit, null)
  })
  await check('new booking clears only the draft, retaining access and contact with no reservation or payment mutation', () => {
    const c = context(); const previous = browserBooking('old', 'PENDING', { id: 'deposit-old', status: 'PROOF_RECEIVED' })
    c.state.guestBookings = [previous]; c.state.guestBooking = true; c.state.deposit = previous.deposit; c.state.proofSent = true; c.state.confirmed = true
    c.state.serviceDetails = { cut: { validationAccepted: true } }; c.state.itineraryOptions = [{ id: 'previous' }]; c.state.bookingView = 'detail'
    runInNewContext(browserFunctions() + '; beginNewBooking()', c)
    assert.equal(c.state.bookingView, null); assert.equal(c.state.step, 1); assert.equal(c.state.services.length, 0); assert.equal(c.state.service, null)
    assert.equal(c.state.slot, null); assert.equal(c.state.date, null); assert.equal(c.state.professionalId, null); assert.equal(c.state.itinerary, null)
    assert.equal(c.state.deposit, null); assert.equal(c.state.proofSent, false); assert.equal(c.state.confirmed, false)
    assert.equal(c.state.guestName, 'Synthetic'); assert.equal(c.state.guestPhone, '15-6655-3322'); assert.equal(c.state.guestBookings[0], previous)
    assert.equal(previous.deposit.status, 'PROOF_RECEIVED'); assert.equal(c.calls.filter(x => x.path).length, 0)
  })
  await check('consulting old detail then returning preserves the in-progress draft and uses only scoped GET', async () => {
    const c = context(); c.state.step = 3; const slot = c.state.slot; const service = c.state.service
    const booking = browserBooking('old', 'PENDING', { id: 'deposit-old', status: 'PENDING' }); const requests: string[] = []
    c.getJson = async (path: string) => { requests.push(path); return { ...booking, bookings: [booking] } }; c.bookingSteps = () => [1, 2, 3, 4]
    await runInNewContext(browserFunctions() + '; viewGuestBookings();', c)
    runInNewContext(browserFunctions() + '; applyGuestBooking(state.guestBookings[0]); restoreBookingDraft()', c)
    assert.equal(c.state.step, 3); assert.equal(c.state.slot, slot); assert.equal(c.state.service, service)
    assert.equal(c.state.deposit, null); assert.equal(c.state.guestBooking, false); assert.equal(c.state.guestPhone, '15-6655-3322')
    assert.equal(requests.length, 1); assert.match(requests[0], /\/guest-booking$/); assert.equal(c.calls.filter(x => x.path).length, 0)
  })
  await check('reservation collection is a responsive table with grouped segments, real statuses, and privacy help', () => {
    const c = context(); const group = browserBooking('group'); group.appointments.push({ ...group.appointments[0], id: 'second', service: { id: 'color', name: '<Color>', duration: 90 }, professional: { id: 'other', name: 'Second professional' } })
    c.state.guestBookings = [group, browserBooking('cancelled', 'CANCELLED'), browserBooking('done', 'COMPLETED'), browserBooking('absent', 'NO_SHOW'), browserBooking('expired', 'PENDING', { status: 'EXPIRED' })]
    runInNewContext(browserFunctions() + '; renderGuestBookings()', c)
    const markup = c.els.content.innerHTML
    for (const text of ['<table', '<thead', 'data-guest-booking-id="group"', '&lt;Color&gt;', 'Second professional', 'Cancelado', 'Realizado', 'Ausente', 'Seña vencida', '7 d', 'cookies', 'booking-new-reservation']) assert.ok(markup.includes(text), text)
    assert.equal((markup.match(/data-guest-booking-id="group"/g) || []).length, 1)
    assert.ok(!/localStorage|sessionStorage|tokenHash|customerPhone/.test(markup))
    assert.equal(c.els.continue.hidden, true)
  })
  await check('persisted detail blocks the back action and cannot be submitted as a new or edited reservation', async () => {
    const c = context(); c.state.bookingView = 'detail'; c.state.step = 4; c.state.confirmed = false
    runInNewContext(source('goToStep') + '; goToStep(3)', c)
    assert.equal(c.state.step, 4)
    await runInNewContext(withGuest('confirmBooking') + '; confirmBooking()', c)
    assert.equal(c.calls.filter(x => x.path).length, 0)
  })
  await check('new/list actions exist for all financial states; completed detail is not called a newly successful booking', () => {
    for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) for (const depositStatus of [null, 'PENDING', 'PROOF_RECEIVED', 'APPROVED', 'EXPIRED', 'REJECTED']) {
      const c = context(); c.bookingSteps = () => [1, 2, 3, 4]
      c.document.getElementById = () => ({ ...element(), closest() { return { classList: { toggle() {} } } } })
      c.result = browserBooking('old', status, depositStatus ? { id: 'deposit-old', status: depositStatus, amount: 100, payment: {} } : null)
      runInNewContext(browserFunctions() + source('persistedBookingActions') + source('renderConfirmStep') + '; applyGuestBooking(result); renderConfirmStep()', c)
      for (const id of ['booking-new-reservation', 'booking-view-reservations']) assert.ok(c.els.content.innerHTML.includes(id), status + '/' + depositStatus + '/' + id)
      if (status === 'COMPLETED' && !['EXPIRED', 'REJECTED'].includes(depositStatus || '')) assert.ok(c.els.content.innerHTML.includes('Turno realizado'))
    }
  })
  await check('old proof selection and refresh keep that booking instead of reverting to the newest grant', async () => {
    const c = context(); const old = browserBooking('old', 'PENDING', { id: 'deposit-old', status: 'PENDING' }); const newest = browserBooking('new')
    c.state.selectedGuestBookingId = 'old'; c.state.bookingView = 'detail'; c.state.guestBooking = true; c.state.deposit = old.deposit
    const requests: string[] = []; c.getJson = async (path: string) => { requests.push(path); return { ...old, bookings: [newest, old] } }; c.bookingSteps = () => [1, 2, 3, 4]
    await runInNewContext(browserFunctions() + '; refreshGuestBooking()', c)
    assert.equal(requests.length, 1); assert.match(requests[0], /guest-booking\?bookingId=old$/)
    assert.equal(c.state.selectedGuestBookingId, 'old'); assert.equal(c.state.deposit.id, 'deposit-old'); assert.equal(c.state.guestBookings.length, 2)
  })
  await check('collection errors and cleared cookies report in place without phone lookup or previous booking rehydration', async () => {
    const c = context(); c.getJson = async () => { throw new Error('Acceso vencido') }; const slot = c.state.slot
    await runInNewContext(browserFunctions() + '; viewGuestBookings()', c)
    assert.equal(c.state.slot, slot); assert.equal(c.state.deposit, null); assert.ok(c.messages.some(x => x[0] === 'Acceso vencido'))
    assert.equal(c.calls.filter(x => x.path).length, 0)
  })
  await check('a second successful reservation refreshes the collection without removing the first booking', async () => {
    const c = context(); const old = browserBooking('old', 'PENDING', { id: 'deposit-old', status: 'PROOF_RECEIVED' }); const added = browserBooking('added')
    c.state.guestBookings = [old]
    c.postJson = async (path: string, body: any) => { c.calls.push({ path, body }); return { ...added, appointment: added.appointments[0] } }
    const requests: string[] = []; c.getJson = async (path: string) => { requests.push(path); return { ...added, bookings: [added, old] } }
    await runInNewContext(browserFunctions() + source('confirmBooking') + '; confirmBooking()', c)
    assert.equal(c.calls.filter(x => x.path).length, 1); assert.equal(requests.length, 1); assert.equal(c.state.selectedGuestBookingId, 'added')
    assert.equal(c.state.guestBookings.length, 2); assert.equal(c.state.guestBookings[1].deposit.status, 'PROOF_RECEIVED'); assert.equal(c.state.submitting, false)
  })
  await check('delayed old detail refresh cannot overwrite a new draft or a different selected booking', async () => {
    const c = context(); let resolve: any; c.state.bookingView = 'detail'; c.state.selectedGuestBookingId = 'old'
    c.getJson = async () => new Promise(r => { resolve = r }); c.bookingSteps = () => [1, 2, 3, 4]
    const refresh = runInNewContext(browserFunctions() + '; refreshGuestBooking()', c)
    runInNewContext(browserFunctions() + '; beginNewBooking()', c)
    c.state.date = '2026-11-01'; resolve({ ...browserBooking('old'), bookings: [browserBooking('old')] }); await refresh
    assert.equal(c.state.bookingView, null); assert.equal(c.state.date, '2026-11-01'); assert.equal(c.state.guestBooking, false); assert.equal(c.state.deposit, null)
  })
  await check('persisted summary uses booked prices, durations, names and status, not mutable current catalog estimates', () => {
    const c = context(); c.state.bookingView = 'detail'; c.state.guestBooking = true
    c.state.guestAppointments = browserBooking('old').appointments
    c.state.guestAppointments[0].service.name = 'Booked name'
    c.state.guestAppointments[0].professional.name = 'Booked professional'
    c.state.catalog.services[0] = { id: 'cut', name: 'Current name', duration: 15, price: 999, attentionMode: 'GUIDED_ESTIMATE', estimateOptions: [{ priceMin: 999 }] }
    c.state.deposit = { id: 'deposit-old', amount: 55, status: 'APPROVED' }
    runInNewContext(source('renderGuestBookingSummary') + '; renderGuestBookingSummary()', c)
    const markup = c.els.summaryLines.innerHTML
    for (const value of ['Booked name', 'Booked professional', '60 min', '$321', '$55']) assert.ok(markup.includes(value), value)
    assert.ok(!markup.includes('999')); assert.ok(!markup.includes('pagar ahora')); assert.equal(c.els.mobileBar.hidden, true)
  })
  await check('booking capacity/server rejection retains draft, previous grants and access without adding a phantom booking', async () => {
    const c = context(); const old = browserBooking('old'); c.state.guestBookings = [old]
    c.postJson = async () => { throw new Error('Llegaste al límite de reservas consultables en este navegador') }
    await runInNewContext(browserFunctions() + source('confirmBooking') + '; confirmBooking()', c)
    assert.equal(c.state.guestBookings.length, 1); assert.equal(c.state.guestBookings[0], old); assert.equal(c.state.slot.time, '15:00')
    assert.equal(c.state.guestName, 'Synthetic'); assert.equal(c.state.guestPhone, '15-6655-3322'); assert.ok(!c.state.bookingView)
    assert.ok(c.messages.some(x => x[0].includes('límite'))); assert.equal(c.state.submitting, false)
  })
  await check('actual new/list/detail click routing starts only GET or a local draft, never mutating earlier reservations', () => {
    const handler = script.match(/els\.content\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n          \}\)/)![1]
    for (const selector of ['#booking-new-reservation', '#booking-view-reservations', '#booking-resume-draft', '[data-guest-booking-id]']) {
      const c = context(); c.state.guestBookings = [browserBooking('old')]
      c.event = { target: { closest: (current: string) => current === selector ? { dataset: { guestBookingId: 'old' } } : null } }
      const routed: string[] = []; Object.assign(c, { beginNewBooking: () => routed.push('new'), viewGuestBookings: () => routed.push('list'), restoreBookingDraft: () => routed.push('resume'), applyGuestBooking: () => routed.push('detail'), refreshGuestBooking: () => routed.push('get') })
      runInNewContext('(function(){' + handler + '})()', c)
      assert.deepEqual(routed, selector === '#booking-new-reservation' ? ['new'] : selector === '#booking-view-reservations' ? ['list'] : selector === '#booking-resume-draft' ? ['resume'] : ['detail', 'get'])
      assert.equal(c.calls.filter(x => x.path).length, 0)
    }
  })
  await check('resuming a time-step draft keeps its chosen slot only while freshly verified availability still contains it', async () => {
    for (const scenario of ['available', 'missing-time', 'different-professional']) {
      const c = context(); const selected = c.state.slot
      c.getJson = async () => ({ slots: [{ time: scenario === 'missing-time' ? '16:00' : '15:00', professionalId: scenario === 'different-professional' ? 'other' : 'p', professionalName: 'Synthetic' }] })
      Object.assign(c, { renderSlotsLoading: () => 'Loading', updateConfirmState() {}, selectSlot() {} })
      await runInNewContext(source('loadSlots') + '; loadSlots()', c)
      assert.equal(c.state.slot, scenario === 'available' ? selected : null, 'resume must retain the selection, not blindly clear it or keep an unavailable slot')
    }
  })
} finally {
  BusinessService.prototype.findPublicBySlug = original
  await app.close()
}
console.log(`Guest web booking UI: ${passes} passed, ${failures} failed`)
if (failures) process.exitCode = 1
