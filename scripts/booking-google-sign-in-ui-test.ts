import assert from 'node:assert/strict'
import { Script, runInNewContext } from 'node:vm'
import Fastify from 'fastify'

process.env.DOTENV_CONFIG_PATH = '__offline_google_booking_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_google_booking'
process.env.WEEX_GOOGLE_CLIENT_ID = 'synthetic.apps.googleusercontent.com'
const [{ landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])
const previous = BusinessService.prototype.findPublicBySlug
BusinessService.prototype.findPublicBySlug = async () => ({
  id: 'google-fixture', slug: 'google-fixture', name: 'Offline', accountStatus: 'ACTIVE',
  landingEnabled: true, landingTemplate: 'classic', allowGuestWebBooking: true, services: [], professionals: []
}) as any
const app = Fastify()
try {
  await app.register(landingUiRoutes)
  const page = await app.inject('/google-fixture/reservar')
  assert.equal(page.statusCode, 200)
  const script = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(code => code.includes('function confirmBooking'))!
  assert.ok(!script.includes("closest('#booking-guest-google')"), 'the guest Google button must start sign-in without opening the login gate')
  assert.ok(script.includes('renderBookingGoogleButton(guestGoogle, setGuestGoogleFeedback)'), 'the guest step must mount the shared Google control')
  assert.ok(script.includes('id="booking-guest-google-feedback" role="status" aria-live="polite"'))
  assert.ok(/id="booking-account" href="(?:https:\/\/[^"]+)?\/google-fixture\/cuenta"/.test(page.body), 'Mi cuenta must remain a navigation link')
  new Script(script)
  const source = (name: string) => {
    const start = script.search(new RegExp('          (?:async )?function ' + name + '\\('))
    assert.ok(start >= 0, 'missing generated function ' + name)
    const end = script.indexOf('\n          }', start)
    assert.ok(end >= 0)
    return script.slice(start, end + '\n          }'.length)
  }
  const helpers = ['renderBookingGoogleButton', 'renderBookingGoogleAction', 'handleBookingGoogleCode',
    'handleBookingGoogleCredential', 'finishBookingGoogleLogin', 'usesCentralWeexLogin', 'openCentralWeexLogin',
    'loginDraftKey', 'saveLoginDraft', 'restoreLoginDraft'].map(source).join('\n')
  const element = () => {
    const listeners: Record<string, () => void> = {}
    return { isConnected: true, dataset: {}, innerHTML: '', clientWidth: 280,
      querySelector: () => ({ addEventListener: (event: string, handler: () => void) => { listeners[event] = handler } }),
      click: () => listeners.click?.() }
  }
  function fixture(calendar = false, hostname = 'weex.com.ar') {
    const calls: string[] = [], rendered: any[] = [], messages: string[] = [], gateMessages: string[] = []
    const timers: (() => void)[] = []
    const storage = new Map<string, string>()
    const service = { id: 'cut' }
    const day = '2030-10-10'
    const state = { service, services: [service], serviceDetails: {}, catalog: { services: [service] },
      professionalId: 'pro', date: day, slot: { time: '15:00', professionalId: 'pro' },
      guestName: 'Matías', guestSurname: 'Prueba', guestPhone: '11-5555-5555', guestEmail: 'guest@example.test' }
    let credential: (response: unknown) => Promise<void>
    let code: (response: unknown) => Promise<void>
    const context = {
      state, els: { gateGoogle: element(), gate: { hidden: false }, gateLogin: { hidden: false } },
      googleClientId: 'synthetic', googleCalendarEnabled: calendar, googleSignInIcon: '<svg aria-hidden="true"></svg>',
      slug: 'google-fixture', baseDomain: 'weex.com.ar', centralLoginBaseUrl: 'https://weex.com.ar',
      window: { location: { hostname, origin: 'https://' + hostname, pathname: '/google-fixture/reservar',
        href: 'https://' + hostname + '/google-fixture/reservar', assign: (url: string) => calls.push(url) },
        setTimeout: (callback: () => void) => timers.push(callback), google: { accounts: {
          id: { initialize: ({ callback }: any) => { calls.push('initialize'); credential = callback },
            renderButton: (target: any, options: any) => rendered.push({ target, options }) },
          oauth2: { initCodeClient: ({ callback }: any) => { calls.push('initCodeClient'); code = callback
            return { requestCode: () => calls.push('requestCode') } } }
        } } },
      sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value),
        getItem: (key: string) => storage.get(key), removeItem: (key: string) => storage.delete(key) },
      setGateFeedback: (message: string) => gateMessages.push(message),
      guestFeedback: (message: string) => messages.push(message),
      showBookingGate: (mode: string) => calls.push('gate:' + mode),
      proceedToConfirm: () => calls.push('confirm'), currentStepId: () => 'confirm',
      render() {}, setFeedback() {}, dates: [new Date(day)], dateIso: () => day,
      setDate: () => { state.date = day }, serviceDetail: () => ({}), isMultiService: () => false,
      availableProfessionals: () => [{ id: 'pro' }], bookingSteps: () => [{ id: 'service' }, { id: 'time' }, { id: 'confirm' }],
      bookingApiUrl: (path: string) => path, getJson: async () => ({ slots: [{ time: '15:00', professionalId: 'pro' }] }),
      postJson: async (path: string, input: Record<string, string>) => {
        calls.push(path)
        if (input.credential === 'invalid') throw new Error('Credencial rechazada')
        return { account: { phone: input.code ? null : '5491155555555' } }
      }
    }
    const run = (expression: string, values = {}) => runInNewContext(helpers + '\n' + expression, { ...context, ...values })
    return { context, run, calls, rendered, messages, gateMessages, timers, storage,
      credential: (response: unknown) => credential(response), code: (response: unknown) => code(response) }
  }
  const direct = fixture(), guest = element(), rerendered = element()
  direct.run('renderBookingGoogleButton(); renderBookingGoogleButton(guest, guestFeedback); renderBookingGoogleButton(guest, guestFeedback); renderBookingGoogleButton(rerendered, guestFeedback)', { guest, rerendered })
  assert.deepEqual(direct.calls, ['initialize'])
  assert.deepEqual(direct.rendered.map(item => item.target), [direct.context.els.gateGoogle, guest, rerendered])
  assert.equal(direct.rendered[1].options.type, 'standard')
  assert.equal(direct.rendered[1].options.text, 'continue_with')
  direct.rendered[1].options.click_listener()
  await direct.credential({ credential: 'invalid' })
  assert.ok(direct.messages.includes('Credencial rechazada'))
  assert.ok(!direct.gateMessages.includes('Credencial rechazada'))
  direct.rendered[2].options.click_listener()
  await direct.credential({ credential: 'synthetic-token' })
  assert.deepEqual(direct.calls, ['initialize', '/public/weex/auth/google', '/public/weex/auth/google', 'confirm'])
  assert.equal(direct.context.state.guestEmail, 'guest@example.test')
  assert.equal(direct.context.state.slot.time, '15:00')

  const calendar = fixture(true), calendarGuest = element()
  calendar.run('renderBookingGoogleButton(); renderBookingGoogleButton(guest, guestFeedback)', { guest: calendarGuest })
  assert.match(calendarGuest.innerHTML, /<svg.*Continuar con Google/)
  calendarGuest.click()
  await calendar.code({ code: 'synthetic-code' })
  assert.deepEqual(calendar.calls, ['initCodeClient', 'requestCode', '/public/weex/auth/google-code', 'gate:phone'])

  const legacy = fixture(false, 'google-fixture.weex.com.ar'), legacyGuest = element()
  legacy.run('renderBookingGoogleButton(guest, guestFeedback)', { guest: legacyGuest })
  legacyGuest.click()
  assert.equal(legacy.calls.length, 1)
  assert.match(legacy.calls[0]!, /^https:\/\/weex.com.ar\/registro\?flow=redirect&business=google-fixture&return=/)
  assert.equal(legacy.storage.size, 1)
  assert.equal(JSON.parse([...legacy.storage.values()][0]!).time, '15:00')
  assert.equal(await legacy.run('restoreLoginDraft()'), true)
  assert.equal(legacy.storage.size, 0)
  assert.equal(legacy.context.state.guestSurname, 'Prueba')
  assert.equal(legacy.context.state.slot.time, '15:00')

  const blocked = fixture(), disconnected = element()
  blocked.context.window.google = undefined as any
  blocked.run('renderBookingGoogleButton(guest, guestFeedback)', { guest: disconnected })
  disconnected.isConnected = false
  blocked.timers.shift()?.()
  assert.equal(blocked.timers.length, 0)
  const waiting = element()
  blocked.run('renderBookingGoogleButton(guest, guestFeedback)', { guest: waiting })
  for (let tick = 0; tick < 25; tick++) blocked.timers.shift()?.()
  assert.equal(blocked.timers.length, 0, 'SDK loading retries are bounded')
  assert.match(blocked.messages.join(' '), /Google/)
  assert.deepEqual(blocked.calls, [])
  console.log('Google booking: direct credential and Calendar, local errors, legacy draft return, and missing SDK passed.')
} finally {
  BusinessService.prototype.findPublicBySlug = previous
  await app.close()
}
