import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import Fastify from 'fastify'
import sharp from 'sharp'
import { landingUiRoutes } from '../src/routes/landing-ui.js'
import { BusinessService } from '../src/services/business-service.js'

const store = {
  slug: 'dosbros',
  name: 'Dos Bros Barbería',
  accountStatus: 'ACTIVE',
  landingEnabled: true,
  landingTemplate: 'classic',
  publicWhatsapp: null as string | null,
  whatsappConfig: null,
  contactPhone: 'private-account-phone',
  contactEmail: null as string | null,
  instagramUrl: null as string | null,
  facebookUrl: null,
  tiktokUrl: null,
  publicAddress: null as string | null,
  publicAddressArea: null as string | null,
  publicMapsUrl: null,
  services: [] as Array<{ id: string; name: string; category: string; price: number | null; priceMode: string; attentionMode: string }>,
  professionals: [] as Array<{ id: string; name: string; avatarUrl: string | null }>,
  businessHours: [] as Array<{ dayOfWeek: number; startTime: string; endTime: string }>
}

const originalFind = BusinessService.prototype.findPublicBySlug
BusinessService.prototype.findPublicBySlug = async (slug) => {
  if (slug === store.slug) return store as never
  if (slug === 'otro') return { ...store, slug, name: 'Otro comercio' } as never
  return null
}

const app = Fastify()
try {
  await app.register(landingUiRoutes)
  const main = { url: '/' + store.slug, headers: { host: 'weex.com.ar' } }
  const subdomain = { url: '/', headers: { host: store.slug + '.weex.com.ar' } }
  const empty = await app.inject(main)
  assert.equal(empty.statusCode, 200)
  assert.equal(empty.headers['cache-control'], 'no-store')
  assert.match(empty.body, /Pr&oacute;ximamente vas a poder consultar los servicios y precios/)
  assert.match(empty.body, /Pr&oacute;ximamente vas a poder conocer al equipo/)
  assert.match(empty.body, /class="floating-wa" hidden/)
  assert.doesNotMatch(empty.body, /private-account-phone|Solo Donato|CRM:[A-Z_]+/)
  assert.match(empty.body, /property="og:url" content="https:\/\/dosbros\.weex\.com\.ar\/"/)
  assert.match(empty.body, /property="og:image" content="https:\/\/weex\.com\.ar\/landing-assets\/dosbros-compartir-v1\.jpg"/)
  assert.match(empty.body, /property="og:image:width" content="1200"/)
  assert.match(empty.body, /property="og:image:height" content="630"/)
  const imageRequest = { url: '/landing-assets/dosbros-compartir-v1.jpg', headers: main.headers }
  const preview = await app.inject(imageRequest)
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.headers['content-type'], 'image/jpeg')
  assert.ok(preview.rawPayload.byteLength < 300_000)
  const { width, height, format } = await sharp(preview.rawPayload).metadata()
  assert.deepEqual({ width, height, format }, { width: 1200, height: 630, format: 'jpeg' })
  assert.equal((await app.inject({ ...imageRequest, method: 'HEAD' })).statusCode, 200)

  store.services = [
    { id: 'corte&barba', name: 'Corte & barba', category: 'Cortes', price: 22000, priceMode: 'FIXED', attentionMode: 'DIRECT_BOOKING' },
    { id: 'reflejos', name: 'Reflejos', category: 'Color', price: 45000, priceMode: 'STARTING_AT', attentionMode: 'DIRECT_BOOKING' },
    { id: 'asesoria', name: 'Asesoría', category: 'Otros', price: null, priceMode: 'FIXED', attentionMode: 'QUOTE' }
  ]
  store.professionals = [
    { id: 'donato', name: 'Donato', avatarUrl: null },
    { id: 'ines', name: 'Inés <García>', avatarUrl: 'https://cdn.example.com/ines.webp' },
    { id: 'valen', name: 'Valen Torres', avatarUrl: null },
  ]
  store.instagramUrl = 'https://www.instagram.com/dosbros.fixture/'
  store.contactEmail = 'hola@example.com'
  store.publicWhatsapp = '11 3456-7890'
  store.publicAddress = 'Avenida de prueba 100'
  store.publicAddressArea = 'Buenos Aires'
  store.businessHours = [{ dayOfWeek: 2, startTime: '10:00', endTime: '19:00' }]

  const populated = await app.inject(main)
  assert.match(populated.body, /\/dosbros\/reservar\?servicio=corte%26barba/)
  assert.match(populated.body, /Corte &amp; barba<\/span><strong>\$\s*22\.000/)
  assert.match(populated.body, /Reflejos<\/span><strong>Desde \$\s*45\.000/)
  assert.match(populated.body, /Asesoría<\/span><strong>Consultar/)
  assert.doesNotMatch(populated.body, /\?servicio=asesoria/)
  assert.match(populated.body, /\/dosbros\/reservar\?profesional=ines/)
  assert.match(populated.body, /Inés &lt;García&gt;/)
  assert.match(populated.body, /cdn\.example\.com\/ines\.webp/)
  assert.match(populated.body, /class="person-initials" aria-hidden="true">VT/)
  assert.match(populated.body, /data-img="8"/)
  assert.match(populated.body, /href="tel:\+5491134567890"/)
  assert.match(populated.body, /href="https:\/\/wa\.me\/5491134567890"/)
  assert.match(populated.body, /@dosbros\.fixture/)
  assert.match(populated.body, /href="mailto:hola@example\.com"/)
  assert.match(populated.body, /Avenida de prueba 100<\/strong><br>Buenos Aires/)
  assert.match(populated.body, /Martes<strong>10:00 &ndash; 19:00/)
  for (const [, script] of populated.body.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(script!)
  assert.match((await app.inject(subdomain)).body, /href="\/reservar\?servicio=corte%26barba"/)

  store.services[0]!.price = 25000
  store.professionals.shift()
  store.instagramUrl = null
  const edited = await app.inject(main)
  assert.match(edited.body, /Corte &amp; barba<\/span><strong>\$\s*25\.000/)
  assert.doesNotMatch(edited.body, /\?profesional=donato|@dosbros\.fixture/)
  const booking = await app.inject({ ...main, url: main.url + '/reservar?servicio=reflejos' })
  assert.equal(booking.statusCode, 200)
  assert.match(booking.body, /if \(true(?: && !pending\?\.deposit)?\) \{\s*const requested/)
  const other = await app.inject({ ...main, url: '/otro' })
  assert.equal(other.statusCode, 200)
  assert.doesNotMatch(other.body, /hero-track/)
  store.landingEnabled = false
  assert.equal((await app.inject(main)).statusCode, 404)
  assert.doesNotMatch((await app.inject({ ...main, url: main.url + '?preview=model' })).body, /hero-track/)
  store.accountStatus = 'PAUSED'
  assert.equal((await app.inject(subdomain)).statusCode, 503)
  console.log('Dos Bros landing test: OK')
} finally {
  BusinessService.prototype.findPublicBySlug = originalFind
  await app.close()
}
