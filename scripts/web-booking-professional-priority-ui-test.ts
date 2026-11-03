import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { runInNewContext } from 'node:vm'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

process.env.DOTENV_CONFIG_PATH = '__offline_web_priority_ui_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
process.env.GOOGLE_CLIENT_ID = ''
process.env.WEEX_GOOGLE_CLIENT_ID = ''
const [{ renderCrmHtml }, { landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('../src/routes/crm-ui.js'), import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const original = BusinessService.prototype.findPublicBySlug, app = Fastify()
BusinessService.prototype.findPublicBySlug = async () => ({ id: 'offline', name: 'Offline', slug: 'offline',
  accountStatus: 'ACTIVE', landingEnabled: true, services: [], professionals: [] }) as any
let passes = 0, failures = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message.split('\n')[0]) }
}
function source(script: string, name: string, indent: number) {
  const match = new RegExp('(?:async )?function ' + name + '\\(').exec(script)
  assert.ok(match, 'shipped handler exists: ' + name)
  const tail = script.slice(match.index).search(new RegExp('\\n {' + indent + '}(?:(?:async )?function |const |let |els\\.|window\\.)'))
  return script.slice(match.index, tail < 0 ? undefined : match.index + tail)
}
function element() { return { value: '', checked: false, disabled: false, innerHTML: '', textContent: '', hidden: false,
  focus() {}, scrollIntoView() {}, classList: { toggle() {} }, querySelector: () => null, querySelectorAll: () => [] } }
function context(): any {
  const els = new Proxy({}, { get: (t: any, key: string) => t[key] ??= element() })
  const calls: any[] = [], messages: any[] = []
  return { els, calls, messages, state: { currentUser: { role: 'BUSINESS_ADMIN' }, businessId: 'offline', business: { slug: 'offline' } },
    document: { querySelector: () => ({ value: 'editorial' }) }, event: { preventDefault() {} },
    clearLandingSettingsFeedback() {}, showLandingSettingsFeedback: (...args: any[]) => messages.push(args),
    normalizeLandingSlug: (value: string) => value, defaultBookingThemeForTemplate: () => 'light',
    landingStyleContentFromForm: () => ({ title: 'Title' }), salonWhiteContentFromForm: () => ({}), luxeNailsContentFromForm: () => ({}),
    classicContentWithLegacyDefaults: () => ({}), setButtonLoading: () => true,
    renderBookingThemePreview() {}, renderLandingTemplateConfiguration() {}, loadLandingTemplateForm() {},
    setLandingCover() {}, setLandingSocialImage() {}, setLandingGallery() {}, parseLandingGalleryImages: () => [], renderLandingLinks() {} }
}
try {
  const crm = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
  await check('settings checkbox has its own labelled, scoped, accessible container and period help', () => {
    assert.match(crm, /id="landing-professional-priority" type="checkbox"/)
    assert.match(crm, /for="landing-professional-priority"/)
    assert.match(crm, /class="landing-professional-priority-settings"/)
    assert.match(crm, /5 d&iacute;as anteriores, hoy y los 2 siguientes/)
    assert.match(crm, /#landing-settings-form \.landing-professional-priority-settings/)
    assert.match(crm, /#landing-professional-priority:focus-visible/)
    assert.match(crm, /landingProfessionalPriority: document.getElementById\('landing-professional-priority'\)/)
    assert.match(crm, /landingSettingsForm.addEventListener\('submit', saveLandingSettings\)/)
  })
  await check('shipped settings load/save persists true/false, reloads saved state, and blocks STAFF', async () => {
    const handlers = source(crm, 'renderLandingSettings', 4) + source(crm, 'saveLandingSettings', 4)
    for (const role of ['BUSINESS_ADMIN', 'STAFF']) for (const checked of [true, false]) {
      const c = context(); c.state.currentUser.role = role; c.state.business.webBookingPrioritizeLeastBooked = checked
      runInNewContext(handlers + '; renderLandingSettings()', c)
      assert.equal(c.els.landingProfessionalPriority.checked, checked)
      assert.equal(c.els.landingProfessionalPriority.disabled, role === 'STAFF')
      c.els.landingProfessionalPriority.checked = !checked
      c.getJson = async (url: string, init: any) => { const body = JSON.parse(init.body); c.calls.push({ url, body }); return { slug: 'offline', ...body } }
      await runInNewContext(handlers + '; saveLandingSettings(event)', c)
      assert.equal(c.calls.length, role === 'STAFF' ? 0 : 1)
      if (role !== 'STAFF') {
        assert.equal(c.calls[0].url, '/businesses/offline')
        assert.equal(c.calls[0].body.webBookingPrioritizeLeastBooked, !checked)
        assert.equal(c.els.landingProfessionalPriority.checked, !checked)
        assert.ok(c.messages.some((m: any[]) => m[1] === 'success'))
      }
    }
    const c = context(); runInNewContext(handlers + '; renderLandingSettings()', c)
    assert.equal(c.els.landingProfessionalPriority.checked, false, 'existing business defaults OFF')
    c.getJson = async () => { throw new Error('Configurá una zona horaria válida') }
    await runInNewContext(handlers + '; saveLandingSettings(event)', c)
    assert.ok(c.messages.some((m: any[]) => m[1] === 'error' && /zona horaria/.test(m[0])))
  })
  await app.register(landingUiRoutes)
  const html = (await app.inject('/offline/reservar')).body
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.includes('function loadCatalog'))
  assert.ok(script, 'booking response contains the shipped catalog handler')
  await check('shipped web catalog loader and service filter retain ranking without changing draft, professional, or slot', async () => {
    const service = { id: 'cut', professionalIds: ['a', 'b'] }, slot = { professionalId: 'a', time: '15:00' }
    const catalog = { business: { name: 'Offline' }, services: [service], professionals: [{ id: 'c' }, { id: 'b' }, { id: 'a' }] }
    const c: any = { state: { service, services: [service], professionalId: 'a', date: '2026-11-20', slot,
      guestName: 'Synthetic', guestPhone: '15-6655-3322', serviceDetails: { cut: { validationAccepted: true } } },
      setFeedback() {}, bookingApiUrl: (p: string) => '/public/booking/offline' + p,
      getJson: async (p: string) => p.endsWith('/catalog') ? catalog : null,
      restoreLoginDraft: async () => false, bookingParameters: new URLSearchParams('reservationView=new'), render() {} }
    await runInNewContext(source(script, 'loadCatalog', 10) + '; loadCatalog()', c)
    const filtered = runInNewContext(source(script, 'availableProfessionals', 10) + '; availableProfessionals()', c)
    assert.deepEqual(Array.from(filtered, (p: any) => p.id), ['b', 'a'])
    assert.equal(c.state.professionalId, 'a'); assert.equal(c.state.slot, slot); assert.equal(c.state.service, service)
    assert.equal(c.state.date, '2026-11-20'); assert.equal(c.state.guestName, 'Synthetic'); assert.equal(c.state.guestPhone, '15-6655-3322')
    assert.equal(c.state.serviceDetails.cut.validationAccepted, true)
    const controls = context()
    Object.assign(c, { els: controls.els, updateContinue() {}, escapeHtml: (v: string) => v,
      professionalAvatarHtml: () => '', selectedServices: () => c.state.services,
      serviceNeedsDetails: () => false, isMultiService: () => c.state.services.length > 1 })
    const renderProfessional = source(script, 'availableProfessionals', 10) + source(script, 'renderProfessionalStep', 10)
    runInNewContext(renderProfessional + '; renderProfessionalStep()', c)
    assert.ok(c.els.content.innerHTML.indexOf('data-professional-id="b"') < c.els.content.innerHTML.indexOf('data-professional-id="a"'))
    assert.match(c.els.content.innerHTML, /selected[^>]*data-professional-id="a"/)
    assert.equal(c.state.slot, slot); assert.equal(c.state.professionalId, 'a')
    c.state.bookingDraft = runInNewContext(source(script, 'bookingDraftSnapshot', 10) + '; bookingDraftSnapshot()', c)
    c.state.professionalId = 'b'; c.state.date = null; c.state.slot = null
    runInNewContext(source(script, 'restoreBookingDraft', 10) + '; restoreBookingDraft()', c)
    assert.equal(c.state.professionalId, 'a'); assert.equal(c.state.slot, slot); assert.equal(c.state.date, '2026-11-20')
    c.state.services = [service, { id: 'second' }]
    const steps = runInNewContext(source(script, 'bookingSteps', 10) + '; bookingSteps()', c)
    assert.deepEqual(Array.from(steps, (step: any) => step.id), ['service', 'time', 'confirm'])
    c.state.service = null; c.state.date = null; c.state.professionalId = null; c.state.slot = null
    const initial = runInNewContext(source(script, 'availableProfessionals', 10) + '; availableProfessionals()', c)
    assert.deepEqual(Array.from(initial, (p: any) => p.id), ['c', 'b', 'a'])
    assert.equal(c.state.professionalId, null); assert.equal(c.state.slot, null); assert.equal(c.state.date, null)
    c.state.reschedule = { appointments: [{ id: 'old' }], selfService: { professionalChoices: [{ appointmentId: 'old', professionals: [{ id: 'original-order' }] }] } }
    c.state.step = 1; c.bookingSteps = () => [{ appointmentIndex: 0 }]
    const reschedule = runInNewContext(source(script, 'availableProfessionals', 10) + '; availableProfessionals()', c)
    assert.deepEqual(Array.from(reschedule, (p: any) => p.id), ['original-order'])
  })
} finally { BusinessService.prototype.findPublicBySlug = original; await app.close() }
console.log(`${passes} passed; ${failures} failed (functional VM/DOM; visual geometry not exercised)`)
if (failures) process.exitCode = 1
