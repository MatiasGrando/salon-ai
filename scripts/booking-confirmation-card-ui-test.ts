import assert from 'node:assert/strict'
import { Script, runInNewContext } from 'node:vm'
import Fastify from 'fastify'

process.env.DOTENV_CONFIG_PATH = '__offline_confirmation_card_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_confirmation_card'
const [{ landingUiRoutes }, { BusinessService }] = await Promise.all([
  import('../src/routes/landing-ui.js'), import('../src/services/business-service.js')
])

const logoUrl = 'https://media.example.test/logo.png'
const bannerUrl = 'https://media.example.test/banner-composed.jpg'
const photoUrl = 'https://media.example.test/thumb.jpg'
const coverImageUrl = 'https://media.example.test/square-cover.png'
const photoSource = 'https://media.example.test/full-photo.jpg'
const configured = {
  logoUrl,
  banner: { source: 'cover', sourceUrl: coverImageUrl, imageUrl: bannerUrl },
  gallery: [{ sourceUrl: photoSource, imageUrl: photoUrl }]
}
let media: unknown = configured
const previous = BusinessService.prototype.findPublicBySlug
BusinessService.prototype.findPublicBySlug = async () => ({
  id: 'card-fixture', slug: 'card-fixture', name: 'Salón <Prueba>', accountStatus: 'ACTIVE',
  landingEnabled: true, landingTemplate: 'classic', allowGuestWebBooking: true,
  timezone: 'America/Argentina/Buenos_Aires', publicAddress: 'Av. Prueba 123',
  publicMapsUrl: 'https://maps.example.test/?place=123',
  logoUrl, coverImageUrl, landingGalleryImages: JSON.stringify([photoSource]), bookingEmailMedia: media,
  services: [], professionals: []
}) as any
const app = Fastify()

try {
  await app.register(landingUiRoutes)
  const visit = async () => {
    const page = await app.inject('/card-fixture/reservar')
    assert.equal(page.statusCode, 200)
    const script = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).find(code => code?.includes('function confirmBooking'))!
    new Script(script)
    return script
  }

  function render(script: string, stateOverrides: Record<string, unknown> = {}) {
    const source = (name: string) => {
      const start = script.search(new RegExp('          function ' + name + '\\('))
      if (start < 0) return ''
      const end = script.indexOf('\n          }', start)
      return script.slice(start, end + '\n          }'.length)
    }
    const constants = script.match(/^          const bookingConfirmationBusiness = .+$/m)?.[0] || ''
    const functions = [
      'guestBookingAllowed', 'persistedBookingActions', 'guestBookingStatus', 'bookingConfirmationAppointments',
      'renderBookingConfirmationCard', 'renderConfirmStep'
    ].map(source).join('\n')
    const content = { innerHTML: '' }
    const heading = { textContent: '' }
    const service = { id: 'legacy', name: 'Servicio del borrador', duration: 20, price: 900 }
    const appointment = {
      startAt: '2030-10-10T18:30:00.000Z', totalDurationMinutes: 30, quotedPrice: 1200,
      service: { name: 'Corte <especial>', duration: 15, price: 200 },
      professional: { name: 'Ana López' }
    }
    const state = {
      confirmed: true, guestAppointments: [appointment], guestBooking: false,
      catalog: { business: { name: 'Salón <Prueba>', allowGuestWebBooking: true } },
      weexAccount: { name: 'Cliente' }, dateLabel: 'jueves, 10 de octubre',
      slot: { time: '16:00', professionalId: 'draft' }, professionalId: 'draft',
      service, ...stateOverrides
    }
    runInNewContext(constants + '\n' + functions + '\nrenderConfirmStep()', {
      state, els: { content, heading, continue: { hidden: false } },
      backPath: '/card-fixture', accountPath: '/card-fixture/cuenta',
      selectedServices: () => [service], professionalName: () => 'Profesional del borrador',
      serviceDisplayPrice: () => '$900', combinedDisplayPrice: () => '$900',
      formatPrice: (price: number) => '$' + price,
      isMultiService: () => Boolean(state.itinerary),
      updateContinue() {},
      escapeHtml: (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    })
    return { html: content.innerHTML, title: heading.textContent, appointment }
  }

  const script = await visit()
  const account = render(script)
  assert.match(account.html, /Corte &lt;especial&gt;/, 'el turno confirmado debe incluir el servicio reservado')
  assert.equal(account.title, 'Turno confirmado')
  assert.match(account.html, /Ana López/)
  assert.match(account.html, /jueves, 10 de octubre/)
  assert.match(account.html, /15:30[^<]+16:00/, 'el rango usa la hora local y la duración reservada')
  assert.match(account.html, /Av\. Prueba 123/)
  assert.match(account.html, /https:\/\/maps\.example\.test\/\?place=123/)
  assert.match(account.html, /\$1200/)
  assert.match(account.html, /href="\/card-fixture\/cuenta"/)
  assert.match(account.html, /banner-composed\.jpg/)
  assert.match(account.html, /thumb\.jpg/)
  assert.doesNotMatch(account.html, /logo\.png|square-cover\.png|full-photo\.jpg|Profesional del borrador/)

  const unquoted = render(script, { guestAppointments: [{ ...account.appointment, quotedPrice: null }] })
  assert.doesNotMatch(unquoted.html, /\$200/, 'un turno sin importe reservado no debe mostrar el precio de catálogo')
  assert.match(unquoted.html, /Precio a consultar/)
  assert.match(unquoted.html, /<span>Total<\/span><strong>A consultar<\/strong>/)

  const group = render(script, {
    guestBooking: true, weexAccount: null, guestCompleted: true,
    guestAppointments: [account.appointment, {
      ...account.appointment, startAt: '2030-10-10T19:15:00.000Z', totalDurationMinutes: 20, quotedPrice: 800,
      service: { name: 'Barba', duration: 10, price: 300 }, professional: { name: 'Nico Ruiz' }
    }]
  })
  assert.equal(group.title, 'Turno realizado')
  assert.match(group.html, /Barba/)
  assert.match(group.html, /Nico Ruiz/)
  assert.match(group.html, /16:15[^<]+16:35/)
  assert.match(group.html, /\$2000/)
  assert.match(group.html, /id="booking-view-reservations"/)
  assert.match(group.html, /id="booking-guest-refresh"/)
  assert.doesNotMatch(group.html, /href="\/card-fixture\/cuenta"/)

  media = null
  const unconfigured = await visit()
  const legacy = render(unconfigured, { guestAppointments: [] })
  assert.match(legacy.html, /Servicio del borrador/)
  assert.match(legacy.html, /Profesional del borrador/)
  assert.match(legacy.html, /logo\.png/)
  assert.doesNotMatch(legacy.html, /square-cover\.png|banner-composed\.jpg|thumb\.jpg/)

  const pending = render(script, { confirmed: false, guestBooking: true, proofSent: true })
  assert.equal(pending.title, 'Comprobante enviado')
  assert.match(pending.html, /Recibimos tu comprobante/)
  assert.doesNotMatch(pending.html, /booking-confirmation-card|banner-composed\.jpg/)
  console.log('OK ficha web de confirmación: cuenta, invitado, coordinada, respaldo y comprobante')
} finally {
  BusinessService.prototype.findPublicBySlug = previous
  await app.close()
}
