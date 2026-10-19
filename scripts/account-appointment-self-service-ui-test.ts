import assert from 'node:assert/strict'
import { runInNewContext, Script } from 'node:vm'
process.env.DOTENV_CONFIG_PATH = '__offline_self_service_ui_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_self_service_ui'
const [{ default: Fastify }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('fastify'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const original = BusinessService.prototype.findPublicBySlug
BusinessService.prototype.findPublicBySlug = async () => ({ id: 'safe-local', slug: 'safe-local', name: 'Local de prueba', publicWhatsapp: '5491166553322', timezone: 'America/Argentina/Buenos_Aires', accountStatus: 'ACTIVE', landingEnabled: true, services: [], professionals: [] }) as any
const app = Fastify(); await app.register(landingUiRoutes)
let passed = 0, failed = 0
async function check(name: string, test: () => any) {
  try { await test(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message.split('\n')[0]) }
}
function clientScript(html: string) { return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!).find(s => s.includes('function mountAppointmentManager'))! }
function source(script: string, name: string) {
  assert.ok(script, 'management client is embedded')
  const start = script.search(new RegExp('          (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0, 'generated function missing: ' + name)
  const tail = script.slice(start + 10).search(/\n          (?:(?:async )?function |const |let |els\.|window\.)/)
  return script.slice(start, tail < 0 ? script.length : start + 10 + tail)
}
const appointment = (id = 'one', professionalId = 'p') => ({ id, startAt: '2026-10-25T18:00:00Z', status: 'CONFIRMED', quotedPrice: 15000, service: { id: 'cut', name: 'Corte <ejemplo>', duration: 30, price: 15000 }, professional: { id: professionalId, name: 'Profesional ' + professionalId } })
function managed(direct = true) { return { appointments: [appointment()], selfService: { mode: direct ? 'direct' : 'contact', canReschedule: direct, canCancel: direct, reason: direct ? '' : 'Solicitá el cambio al local.', revision: 'server-revision', professionalChoices: [{ appointmentId: 'one', professionals: [{ id: 'p', name: 'Profesional p' }, { id: 'q', name: 'Profesional q' }] }] } } }
function harness(result: any = managed()) {
  const handlers: Record<string, any> = {}, fields = new Map<string, any>(), requests: any[] = [], updated: any[] = []
  const host: any = { innerHTML: '', isConnected: true, setAttribute() {}, addEventListener: (name: string, fn: any) => handlers[name] = fn,
    querySelector: (selector: string) => fields.get(selector) || null, querySelectorAll: (selector: string) => selector === '[data-self-professional]' ? [...fields.values()].filter(f => f.dataset?.selfProfessional) : [], contains: () => true }
  const queue: any[] = [result]
  let uuid = 0
  const ctx: any = { Intl, Date, URL, encodeURIComponent, console, crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0') },
    document: { activeElement: null }, escapeHtml: (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    fetch: async (url: string, options?: any) => { requests.push({ url, ...options, payload: options?.body ? JSON.parse(options.body) : undefined }); const item = queue.shift(); if (item instanceof Error) throw item; return { ok: !item?.error, status: item?.status || 200, json: async () => item?.error ? { message: item.message } : item } }, host,
    config: { slug: 'safe-local', appointmentId: 'one', timeZone: 'America/Argentina/Buenos_Aires', contactUrl: 'https://wa.me/5491166553322', appointments: result?.appointments || [appointment()], onUpdated: async (value: any) => updated.push(value) } }
  const click = async (action: string, data: any = {}) => { const target = { dataset: { selfAction: action, ...data }, closest: () => target }; await handlers.click({ target, preventDefault() {} }) }
  const change = async (selector: string, value: string, dataset: any = {}) => { const field = { value, dataset, matches: (s: string) => s === selector }; fields.set(selector, field); await handlers.change({ target: field }) }
  return { ctx, host, queue, requests, updated, fields, click, change, start: async (script: string) => { const controller = runInNewContext(source(script, 'mountAppointmentManager') + '; mountAppointmentManager(host, config)', ctx); await controller.ready } }
}
try {
  const accountHtml = (await app.inject({ url: '/cuenta', headers: { host: 'safe-local.weex.com.ar' } })).body
  const bookingHtml = (await app.inject({ url: '/reservar', headers: { host: 'safe-local.weex.com.ar' } })).body
  const script = clientScript(accountHtml)
  await check('both safe route formats embed one shared manager in account and browser reservation details', async () => {
    for (const url of ['/cuenta', '/reservar', '/safe-local/cuenta', '/safe-local/reservar']) {
      const html = (await app.inject({ url, headers: { host: 'safe-local.weex.com.ar' } })).body
      assert.ok(clientScript(html)); assert.ok(html.includes('appointment-management-host')); assert.ok(html.includes('mountAppointmentManager('))
    }
    assert.equal(source(clientScript(bookingHtml), 'mountAppointmentManager'), source(script, 'mountAppointmentManager'))
  })
  await check('loads server authority with business and appointment only; no mutation or telephone authority', async () => {
    const c = harness(); await c.start(script)
    assert.equal(c.requests.length, 1); assert.equal(c.requests[0].url, '/public/booking/safe-local/appointments/one/manage'); assert.equal(c.requests[0].method, undefined)
    assert.ok(c.host.innerHTML.includes('data-self-action="reschedule"')); assert.ok(c.host.innerHTML.includes('data-self-action="cancel"'))
    assert.ok(!JSON.stringify(c.requests).includes('phone')); assert.ok(c.host.innerHTML.includes('Corte &lt;ejemplo&gt;'))
  })
  await check('current and proposed summaries preserve booked duration and price rather than mutable catalog values', async () => {
    const c = harness(); await c.start(script)
    assert.ok(c.host.innerHTML.includes('30 min')); assert.ok(c.host.innerHTML.includes('15.000'))
    await c.click('reschedule'); c.fields.set('[data-self-date]', { value: '2026-10-26' }); c.fields.set('pro', { value: 'p', dataset: { selfProfessional: 'one' } })
    c.queue.push({ selfService: managed().selfService, options: [{ id: 'fresh', date: '2026-10-26', time: '15:00', segments: [{ appointmentId: 'one', serviceName: 'Corte', professionalId: 'p', professionalName: 'Profesional p', startAt: '2026-10-26T18:00:00Z', durationMinutes: 30 }] }] })
    await c.click('find-options'); await c.click('select-option', { selfOption: 'fresh' })
    assert.equal((c.host.innerHTML.match(/15\.000/g) || []).length, 2)
  })
  await check('legacy and unsupported finances expose contact, never direct action', async () => {
    for (const reason of ['Reserva anterior.', 'Seña en revisión.']) {
      const data = managed(false); data.selfService.reason = reason; const c = harness(data); await c.start(script)
      assert.ok(c.host.innerHTML.includes('Solicitar cambio o cancelaci')); assert.ok(c.host.innerHTML.includes('https://wa.me/'))
      assert.ok(!c.host.innerHTML.includes('data-self-action="cancel"')); await c.click('cancel'); assert.equal(c.requests.length, 1)
    }
  })
  await check('403 fallback renders ordinary Spanish text once, without literal HTML entities', async () => {
    const c = harness(); await c.start(script); await c.click('cancel')
    c.queue.push({ error: true, status: 403, message: 'Acceso no disponible' }); await c.click('confirm-cancel')
    assert.ok(c.host.innerHTML.includes('Esta reserva necesita gestión del local.'))
    assert.ok(!c.host.innerHTML.includes('&amp;oacute;')); assert.ok(c.host.innerHTML.includes('https://wa.me/'))
  })
  await check('missing or unsafe contact shows explanation without broken or dangerous link', async () => {
    for (const contactUrl of ['', 'javascript:alert(1)', 'https://evil.example/', 'https://wa.me@evil.example/']) {
      const c = harness(managed(false)); c.ctx.config.contactUrl = contactUrl; await c.start(script)
      assert.ok(c.host.innerHTML.includes('contacto')); assert.ok(!c.host.innerHTML.includes('href="'))
    }
  })
  await check('404 capability loss and 403 session rejection cannot be retried or escalate via editable phone', async () => {
    for (const status of [403, 404]) {
      const c = harness({ error: true, status, message: 'Acceso no disponible' }); await c.start(script)
      await c.click('retry'); await c.click('cancel'); assert.equal(c.requests.length, 1); assert.ok(c.host.innerHTML.includes('Acceso no disponible'))
      assert.ok(!c.host.innerHTML.includes('data-self-action="confirm-cancel"'))
    }
  })
  await check('cancel requires complete group summary and explicit integrated confirmation without a refund', async () => {
    const data = managed(); data.appointments.push(appointment('two', 'q')); const c = harness(data); await c.start(script); await c.click('cancel')
    assert.equal(c.requests.length, 1); assert.ok(c.host.innerHTML.includes('Cancelar esta reserva')); assert.ok(c.host.innerHTML.includes('devoluci')); assert.ok(c.host.innerHTML.includes('Profesional q'))
    assert.ok(c.host.innerHTML.includes('data-self-action="confirm-cancel"')); await c.click('back'); assert.equal(c.requests.length, 1)
  })
  await check('cancel sends scoped revision, stable UUID and explicit confirmation only; refreshes after success', async () => {
    const c = harness(); await c.start(script); await c.click('cancel'); c.queue.push(managed(false)); await c.click('confirm-cancel')
    const request = c.requests[1]; assert.ok(request.url.endsWith('/one/cancel')); assert.equal(request.method, 'POST')
    assert.deepEqual(Object.keys(request.payload).sort(), ['confirmed', 'operationId', 'revision']); assert.equal(request.payload.confirmed, true); assert.equal(request.payload.revision, 'server-revision')
    assert.match(request.payload.operationId, /^[a-f0-9-]{36}$/); assert.equal(c.updated.length, 1); assert.ok(c.host.innerHTML.includes('cancelada'))
  })
  await check('rescheduling asks current date and per-segment professionals before fetching, never posts reservation creation', async () => {
    const c = harness(); await c.start(script); await c.click('reschedule'); assert.ok(c.host.innerHTML.includes('type="date"')); assert.ok(c.host.innerHTML.includes('data-self-professional="one"'))
    c.fields.set('[data-self-date]', { value: '2026-10-26' }); c.fields.set('pro', { value: 'q', dataset: { selfProfessional: 'one' } })
    c.queue.push({ selfService: managed().selfService, options: [] }); await c.click('find-options')
    assert.ok(c.requests[1].url.includes('date=2026-10-26&professionalIds=q')); assert.equal(c.requests[1].method, undefined); assert.ok(c.host.innerHTML.includes('No hay horarios'))
  })
  await check('date or professional change invalidates selected option and comparison', async () => {
    const c = harness(); await c.start(script); await c.click('reschedule')
    c.fields.set('[data-self-date]', { value: '2026-10-26' }); c.fields.set('pro', { value: 'p', dataset: { selfProfessional: 'one' } })
    c.queue.push({ selfService: managed().selfService, options: [{ id: 'fresh', date: '2026-10-26', time: '15:00', segments: [{ appointmentId: 'one', serviceName: 'Corte', professionalId: 'p', professionalName: 'Profesional p', startAt: '2026-10-26T18:00:00Z', durationMinutes: 30 }] }] })
    await c.click('find-options'); await c.click('select-option', { selfOption: 'fresh' }); assert.ok(c.host.innerHTML.includes('Antes')); assert.ok(c.host.innerHTML.includes('Despu'))
    await c.change('[data-self-date]', '2026-10-27'); await c.click('confirm-reschedule'); assert.equal(c.requests.length, 2)
  })
  await check('reschedule posts opaque current option and identity only after explicit confirmation', async () => {
    const c = harness(); await c.start(script); await c.click('reschedule'); c.fields.set('[data-self-date]', { value: '2026-10-26' }); c.fields.set('pro', { value: 'q', dataset: { selfProfessional: 'one' } })
    c.queue.push({ selfService: managed().selfService, options: [{ id: 'fresh', date: '2026-10-26', time: '15:00', segments: [{ appointmentId: 'one', serviceName: 'Corte', professionalId: 'q', professionalName: 'Profesional q', startAt: '2026-10-26T18:00:00Z', durationMinutes: 30 }] }] })
    await c.click('find-options'); await c.click('select-option', { selfOption: 'fresh' }); assert.equal(c.requests.length, 2)
    assert.ok(c.host.innerHTML.includes('se&ntilde;a')); c.queue.push(managed()); await c.click('confirm-reschedule')
    assert.deepEqual(Object.keys(c.requests[2].payload).sort(), ['date', 'operationId', 'optionId', 'professionalIds', 'revision']); assert.equal(c.requests[2].payload.optionId, 'fresh'); assert.deepEqual(c.requests[2].payload.professionalIds, ['q']); assert.equal(c.updated.length, 1)
  })
  await check('network error keeps frozen action UUID for explicit retry; no hidden retry or auto-submit', async () => {
    const c = harness(); await c.start(script); await c.click('cancel'); c.queue.push(new Error('Sin conexión')); await c.click('confirm-cancel'); assert.equal(c.requests.length, 2)
    c.queue.push(managed(false)); await c.click('confirm-cancel'); assert.equal(c.requests[1].payload.operationId, c.requests[2].payload.operationId); assert.equal(c.updated.length, 1)
  })
  await check('409 refreshes authority and clears stale selected operation without submitting again', async () => {
    const c = harness(); await c.start(script); await c.click('cancel'); c.queue.push({ error: true, status: 409, message: 'La reserva cambió.' }, managed()); await c.click('confirm-cancel')
    assert.equal(c.requests.length, 3); assert.ok(c.requests[2].url.endsWith('/manage')); assert.ok(!c.host.innerHTML.includes('data-self-action="confirm-cancel"')); assert.ok(c.host.innerHTML.includes('La reserva camb'))
  })
  await check('busy double click is blocked and actions expose loading state', async () => {
    const c = harness(); await c.start(script); await c.click('cancel'); let release: any
    c.ctx.fetch = async (url: string, options: any) => { c.requests.push({ url, ...options }); return new Promise(resolve => release = () => resolve({ ok: true, status: 200, json: async () => managed(false) })) }
    const first = c.click('confirm-cancel'); await c.click('confirm-cancel'); assert.equal(c.requests.length, 2); assert.ok(c.host.innerHTML.includes('aria-busy="true"')); release(); await first
  })
  await check('cancellation announces pending work, then finishes without waiting for background history', async () => {
    const c = harness(); await c.start(script); await c.click('cancel')
    let releasePost: any, releaseRefresh: any
    c.ctx.fetch = async () => new Promise(resolve => releasePost = () => resolve({ ok: true, json: async () => ({ ...managed(false), appointments: [{ ...appointment(), status: 'CANCELLED' }] }) }))
    c.ctx.config.onUpdated = () => new Promise(resolve => releaseRefresh = resolve)
    const pending = c.click('confirm-cancel')
    assert.match(c.host.innerHTML, /Estamos gestionando la cancelaci/)
    releasePost(); await new Promise(resolve => setImmediate(resolve))
    assert.ok(c.host.innerHTML.includes('La reserva fue cancelada'))
    assert.ok(c.host.innerHTML.includes('aria-busy="false"'), 'authoritative POST ends pending state before history finishes')
    releaseRefresh(); await pending
  })
  await check('a cancelled reservation is final and cannot offer cancellation contact again', async () => {
    const data = managed(false); data.appointments[0]!.status = 'CANCELLED'
    const c = harness(data); await c.start(script)
    assert.ok(c.host.innerHTML.includes('Reserva cancelada'))
    assert.ok(!c.host.innerHTML.includes('https://wa.me/'))
    assert.ok(!c.host.innerHTML.includes('data-self-action="cancel"'))
  })
  await check('a synchronous account refresh error cannot undo a successful cancellation notice', async () => {
    const c = harness(); await c.start(script); await c.click('cancel')
    c.ctx.config.onUpdated = () => { throw new Error('Refresh callback failed') }
    c.queue.push({ ...managed(false), appointments: [{ ...appointment(), status: 'CANCELLED' }] })
    await c.click('confirm-cancel'); await new Promise(resolve => setImmediate(resolve))
    assert.ok(c.host.innerHTML.includes('La reserva fue cancelada'))
    assert.ok(c.host.innerHTML.includes('el cambio ya qued'))
    assert.ok(!c.host.innerHTML.includes('Refresh callback failed'))
  })
  function accountHarness(items: any[]) {
    const elements: Record<string, any> = {}
    for (const key of ['historyCount', 'upcomingCount', 'summaryUpcoming', 'summaryPast', 'summaryNext', 'upcomingState', 'historyItems', 'historyDetail', 'historyPanel']) elements[key] = { innerHTML: '', textContent: '', hidden: false, dataset: {}, classList: { toggle() {} }, querySelector: () => null }
    let managerConfig: any, renderCount = 0, releaseHistory: any
    const context: any = { state: { user: { phone: '5491166553322' }, appointments: items, selectedId: items[0]?.id, tab: 'history', reservationFilter: 'upcoming', mobileDetail: false }, els: elements, slug: 'safe-local', Date, Intl, Promise, encodeURIComponent,
      window: { matchMedia: () => ({ matches: true }), scrollY: 0, scrollTo() {}, requestAnimationFrame: (fn: any) => fn() },
      document: { getElementById: () => ({}) , querySelectorAll: () => [] },
      mountAppointmentManager: (_host: any, config: any) => { managerConfig = config; renderCount++; return { ready: Promise.resolve() } },
      setFeedback() {}, getJson: () => new Promise(resolve => releaseHistory = resolve) }
    const names = ['loadHistory', 'renderHistory', 'renderAppointmentCard', 'renderDetail', 'formatDateTime', 'formatPriceLine', 'statusLabel', 'normalizePhone', 'businessInitials', 'initials', 'escapeHtml']
    // Execute the emitted account functions and its actual onUpdated callback, rather than a callback fixture.
    const optional = ['appointmentGroups', 'applyAppointmentUpdate', 'renderDetailSummary', 'showAppointmentDetail', 'showAppointmentList']
    for (const name of optional) if (script.includes('function ' + name + '(')) names.push(name)
    runInNewContext(names.map(name => source(script, name)).join('\n') + '; globalThis.accountFunctions = { renderHistory, renderDetail, loadHistory }', context)
    return { context, elements, get config() { return managerConfig }, get renders() { return renderCount }, get release() { return releaseHistory } }
  }
  await check('account applies POST rows immediately and preserves manager through delayed or stale history refresh', async () => {
    const h = accountHarness([appointment()]); h.context.accountFunctions.renderHistory()
    const originalRenders = h.renders
    const updated = { ...managed(false), appointments: [{ ...appointment(), status: 'CANCELLED' }] }
    const callback = h.config.onUpdated(updated)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.context.state.appointments[0].status, 'CANCELLED', 'POST outcome immediately updates local account rows')
    assert.equal(h.renders, originalRenders, 'updating the list must not remount the successful manager')
    if (h.release) { h.release({ appointments: [appointment()] }); await callback; await new Promise(resolve => setImmediate(resolve)) }
    assert.equal(h.context.state.appointments[0].status, 'CANCELLED', 'stale history cannot overwrite authoritative POST')
    assert.equal(h.context.state.selectedId, 'one')
    assert.equal(h.renders, originalRenders)
  })
  await check('upcoming appointments are chronological and future cancelled appointments move to history', () => {
    const now = Date.now(), later = { ...appointment('later'), startAt: new Date(now + 86400000 * 4).toISOString() }, soon = { ...appointment('soon'), startAt: new Date(now + 86400000).toISOString() }, cancelled = { ...appointment('cancelled'), startAt: new Date(now + 86400000 * 2).toISOString(), status: 'CANCELLED' }
    const h = accountHarness([later, cancelled, soon]); h.context.accountFunctions.renderHistory()
    assert.ok(!h.elements.upcomingState.innerHTML.includes('data-appointment-id="cancelled"'))
    assert.ok(h.elements.historyItems.innerHTML.includes('data-appointment-id="cancelled"'))
    assert.ok(h.elements.upcomingState.innerHTML.indexOf('data-appointment-id="soon"') < h.elements.upcomingState.innerHTML.indexOf('data-appointment-id="later"'))
    assert.equal(h.elements.summaryUpcoming.textContent, '2')
  })
  await check('mobile account starts at appointments and provides explicit list/detail navigation', () => {
    assert.match(script, /tab: 'history'/)
    assert.ok(accountHtml.includes('data-account-back'))
    assert.ok(accountHtml.includes('data-reservation-filter="upcoming"'))
    assert.ok(accountHtml.includes('data-reservation-filter="history"'))
    assert.ok(accountHtml.includes('account-profile-toggle'))
    assert.ok(!source(script, 'renderAppointmentCard').includes('<em>Volver a reservar</em>'))
  })
  await check('the profile editor close control remains a full touch target', () => {
    const rules = accountHtml.match(/\.account-modal-close\s*\{([^}]+)\}/)![1]!
    for (const dimension of ['width', 'height']) assert.ok(Number(rules.match(new RegExp('(?:^|[;\\s])' + dimension + ':\\s*(\\d+)px'))![1]) >= 44, dimension + ' must be at least44px')
  })
  await check('guest booking navigation icons remain full touch targets', () => {
    const rules = accountHtml.match(/\.fresha-icon-btn\s*\{([^}]+)\}/)![1]!
    for (const dimension of ['width', 'height']) assert.ok(Number(rules.match(new RegExp('(?:^|[;\\s])' + dimension + ':\\s*(\\d+)px'))![1]) >= 44, dimension + ' must be at least44px')
  })
  await check('the account brand home link remains a full touch target on tablet and desktop', () => {
    assert.match(accountHtml, /\.account-page \.account-brand\s*\{[^}]*min-height: 44px/)
  })
  await check('account keeps its light approved surface and compact mobile header with clear warnings', () => {
    assert.ok(!accountHtml.match(/<body[^>]*class="[^"]*booking-theme-dark/), 'merchant theme must not unexpectedly change the account skin')
    assert.ok(accountHtml.includes('grid-template-rows: auto 1fr'), 'compact brand header must not stretch into unused viewport height')
    assert.match(accountHtml, /\.appointment-management \.self-service-body p\.self-service-warning\s*\{[^}]*color: #722727/)
    assert.ok(accountHtml.includes('account-new-booking'), 'mobile appointment list includes its own full-width booking action')
  })
  await check('authoritative refresh rows are cleared when the signed-in account changes or logs out', async () => {
    for (const name of ['handleGoogleCode', 'handleGoogleCredential', 'logout']) {
      const context: any = { state: { user: { id: 'previous' }, appointments: [appointment()], appointmentOverrides: { one: appointment() }, selectedId: 'one' },
        postJson: async () => ({ account: { id: 'new-account' } }), setLoginFeedback() {}, setFeedback() {}, renderShell() {}, renderGoogleButton() {}, loadHistory() {} }
      const action = name === 'logout' ? script.match(/els\.logout\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n          \}\)/)![1]! : source(script, name) + '; await ' + name + '({ code: "synthetic-code", credential: "synthetic-credential" })'
      await runInNewContext('(async () => {' + action + '})()', context)
      assert.equal(Object.keys(context.state.appointmentOverrides).length, 0, name + ' must discard the previous account rows')
    }
  })
  await check('disconnected detail ignores stale async response and never changes another selected reservation', async () => {
    const c = harness(); c.host.isConnected = false; await c.start(script); assert.equal(c.updated.length, 0); assert.equal(c.host.innerHTML.includes('data-self-action="cancel"'), false)
  })
  await check('self-contained responsive hierarchy covers touch, tablet and small width with no native dialogs or resizable form', () => {
    assert.ok(script); for (const token of ['appointment-management', 'self-service-header', 'self-service-fields', 'self-service-actions', 'self-service-feedback', 'min-height: 44px', 'minmax(0, 1fr)']) assert.ok(accountHtml.includes(token), token)
    assert.ok(accountHtml.includes('.appointment-management [hidden]')); assert.ok(accountHtml.includes('.appointment-management :focus-visible')); assert.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(source(script, 'mountAppointmentManager')))
    for (const html of [accountHtml, bookingHtml]) for (const block of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) assert.doesNotThrow(() => new Script(block[1]!))
  })
  await check('management text and control surfaces use paired theme tokens with readable light/dark contrast', () => {
    const css = accountHtml.match(/<style>([\s\S]*?)<\/style>/)![1]!
    const controls = css.match(/\.appointment-management select\s*\{([^}]+)\}/)![1]!
    assert.ok(controls.includes('color: var(--booking-ink')); assert.ok(controls.includes('background: var(--booking-surface'))
    const notes = css.match(/\.appointment-management \.self-service-warning\s*\{([^}]+)\}/)![1]!
    assert.ok(notes.includes('color: var(--booking-secondary-ink'))
    assert.ok(css.includes('.booking-theme-dark .appointment-management { color-scheme: dark; }'))
    const luminance = (hex: string) => {
      const channels = hex.replace('#', '').match(/../g)!.map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
    }
    const contrast = (a: string, b: string) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0]! + .05) / (values[1]! + .05) }
    let themes = 0
    for (const match of css.matchAll(/\.booking-theme-(light|dark|rose|sage|blue|violet)\s*\{([^}]+)\}/g)) {
      const tokens = Object.fromEntries([...match[2]!.matchAll(/--booking-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(x => [x[1]!, x[2]!]))
      for (const [ink, background] of [['ink', 'surface'], ['secondary-ink', 'surface'], ['ink', 'accent-soft'], ['on-cta', 'cta']]) assert.ok(contrast(tokens[ink!]!, tokens[background!]!) >= 4.5, match[1] + ' ' + ink + '/' + background)
      themes++
    }
    assert.equal(themes, 6)
  })
} finally { BusinessService.prototype.findPublicBySlug = original; await app.close() }
console.log('Account appointment self-service UI: ' + passed + ' PASS, ' + failed + ' FAIL')
if (failed) process.exitCode = 1
