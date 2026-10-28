import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import Fastify from 'fastify'
import sharp from 'sharp'
import { BusinessService } from '../src/services/business-service.js'
import { landingUiRoutes } from '../src/routes/landing-ui.js'
import { authGuard } from '../src/plugins/auth-guard.js'

assert.ok(existsSync('src/routes/la-cochera-site.ts'), 'Falta integrar la landing V13 en las dos direcciones públicas')
const { laCocheraSiteRoutes, isLaCocheraPublicResource } = await import('../src/routes/la-cochera-site.js')
const html = readFileSync('sites/la-cochera/published-v13.html')
assert.equal(createHash('sha256').update(html).digest('hex'), '6c4a8df3575b3469e76e61a8ad5f5d51001af6f0423f921872ae3a1430d6365a')
function assertSameTabReservationLinks(document: string, file: string, expectedHref = 'https://lacochera.weex.com.ar/reservar', origin = 'https://lacochera.weex.com.ar', expectedPath = '/reservar') {
  const links = [...document.matchAll(/<a\b[^>]*href="([^"]*\/reservar)"[^>]*>/gi)]
  assert.equal(links.length, 8, `${file} debe incluir los ocho CTA de reserva`)
  for (const [link, href] of links) {
    assert.equal(href, expectedHref, `${file} debe conservar la entrada pública al reservar`)
    const destination = new URL(href, origin)
    assert.equal(destination.origin, origin)
    assert.equal(destination.pathname, expectedPath)
    assert.doesNotMatch(link, /\btarget\s*=/i, `${file} debe abrir la reserva en la pestaña actual`)
    assert.doesNotMatch(link, /\brel\s*=/i, `${file} no necesita rel para una reserva interna`)
  }
}
function assertLookbookReservationTarget(document: string, expectedHref: string) {
  const lookbook = document.match(/function initServicesLookbook\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(lookbook, 'Ejecutar el lookbook realmente servido')
  const listeners = new Map<string, () => void>()
  const element = (id = '') => ({
    href: '', textContent: '', className: '', classList: { toggle() {} },
    replaceChildren() {}, appendChild() {}, setAttribute() {},
    addEventListener(event: string, handler: () => void) { listeners.set(`${id}:${event}`, handler) }
  })
  const ids = ['servicios', 'lbCounter', 'lbTitle', 'lbTagline', 'lbDesc', 'lbDuration', 'lbPrice', 'lbCta', 'lbModelLayer', 'lbSceneCurtain', 'lbSceneSweep', 'lbPrevBtn', 'lbNextBtn', 'lbMeta']
  const elements = new Map(ids.map(id => [id, element(id)]))
  const tabs = Array.from({ length: 5 }, (_, index) => element(`tab${index}`))
  runInNewContext(`${lookbook}\ninitServicesLookbook()`, {
    document: {
      getElementById: (id: string) => elements.get(id), querySelectorAll: () => tabs,
      createElement: () => element(), createTextNode: (text: string) => text
    },
    window: { matchMedia: () => ({ matches: true }) }, __lcAsset: (key: string) => key
  })
  assert.equal(elements.get('lbCta')?.href, expectedHref, 'El lookbook inicial debe conservar la entrada de reserva')
  for (let index = 1; index < tabs.length; index++) {
    const click = listeners.get(`tab${index}:click`)
    assert.ok(click)
    click()
    assert.equal(elements.get('lbCta')?.href, expectedHref, 'Cambiar de servicio no debe restablecer otro host de reserva')
  }
}
assertSameTabReservationLinks(html.toString('utf8'), 'published-v13.html')
assertSameTabReservationLinks(readFileSync('sites/la-cochera/index.html', 'utf8'), 'index.html')
const preview = readFileSync('sites/la-cochera/assets/social/portada-whatsapp-v11.png')
const whatsappPreviewPath = 'sites/la-cochera/assets/social/portada-whatsapp-v14.jpg'
assert.ok(existsSync(whatsappPreviewPath), 'Falta una portada JPEG liviana para la vista previa de WhatsApp')
const whatsappPreview = readFileSync(whatsappPreviewPath)
assert.ok(whatsappPreview.byteLength < 300_000, 'La portada de WhatsApp debe pesar menos de 300 KB')
const whatsappPreviewMetadata = await sharp(whatsappPreview).metadata()
assert.equal(whatsappPreviewMetadata.format, 'jpeg')
assert.equal(whatsappPreviewMetadata.width, 1200)
assert.equal(whatsappPreviewMetadata.height, 630)
assert.match(html.toString('utf8'), /og:image" content="https:\/\/weex\.com\.ar\/lacochera\/assets\/social\/portada-whatsapp-v14\.jpg"/)
assert.match(html.toString('utf8'), /og:image:type" content="image\/jpeg"/)
assert.match(html.toString('utf8'), /twitter:image" content="https:\/\/weex\.com\.ar\/lacochera\/assets\/social\/portada-whatsapp-v14\.jpg"/)
const originalFind = BusinessService.prototype.findPublicBySlug
const fixture = {
  id: 'public-cochera-fixture', slug: 'lacochera', name: 'La Cochera', accountStatus: 'ACTIVE', landingEnabled: true,
  landingTemplate: 'barber-dark', landingTemplateContent: {}, landingSubtitle: null, landingFeature: null,
  landingDescription: null, landingOpeningYear: null, logoUrl: null, coverImageUrl: null, landingSocialImageUrl: null,
  landingGalleryImages: null, publicWhatsapp: '+5491168255414', publicAddress: 'Franklin D. Roosevelt 5520',
  publicAddressArea: 'Villa Urquiza', publicMapsUrl: null, contactEmail: null, instagramUrl: null, facebookUrl: null,
  tiktokUrl: null, services: [], professionals: [], businessHours: [], whatsappConfig: null,
}
let accountStatus = 'ACTIVE', landingEnabled = true
const lookups: string[] = []
BusinessService.prototype.findPublicBySlug = async (slug: string) => {
  lookups.push(slug)
  if (slug !== 'lacochera' && slug !== 'otro') return null
  return { ...fixture, slug, name: slug === 'otro' ? 'Otro comercio' : fixture.name, accountStatus, landingEnabled } as never
}
const app = Fastify()
try {
  await app.register(laCocheraSiteRoutes)
  await app.register(landingUiRoutes)
  await authGuard(app)
  app.get('/professionals', async () => ({ private: true }))
  const pages = [
    { host: 'weex.com.ar', url: '/lacochera', bookingHref: '/lacochera/reservar', bookingPath: '/lacochera/reservar' },
    { host: 'lacochera.weex.com.ar', url: '/', bookingHref: 'https://lacochera.weex.com.ar/reservar', bookingPath: '/reservar' },
  ].flatMap(page => [page, { ...page, url: `${page.url}?next=https%3A%2F%2Fexample.invalid%2Freservar&bookingPath=%2Fotro%2Freservar` }])
  for (const page of pages) {
    const response = await app.inject({ ...page, headers: { host: page.host } })
    assert.equal(response.statusCode, 200)
    assertSameTabReservationLinks(response.body, `${page.host}${page.url}`, page.bookingHref, `https://${page.host}`, page.bookingPath)
    assertLookbookReservationTarget(response.body, page.bookingHref)
    const unchangedContent = response.body
      .replaceAll(`href="${page.bookingHref}"`, 'href="https://lacochera.weex.com.ar/reservar"')
      .replaceAll(`cta.href = '${page.bookingHref}'`, "cta.href = 'https://lacochera.weex.com.ar/reservar'")
    assert.equal(unchangedContent, html.toString('utf8'), 'Conservar todo el HTML aprobado salvo los destinos de reserva conocidos')
    if (page.host === 'lacochera.weex.com.ar') assert.ok(response.rawPayload.equals(html), 'Conservar los bytes aprobados en la entrada por subdominio')
    assert.match(response.headers['content-type']!, /text\/html/)
    assert.match(response.headers['cache-control']!, /no-cache/)
    const csp = response.headers['content-security-policy']!
    assert.match(csp, /script-src 'self' 'unsafe-inline'/)
    assert.match(csp, /img-src 'self' data:/)
    assert.match(csp, /frame-src https:\/\/www.google.com/)
    assert.equal(csp.includes('*'), false)
    const head = await app.inject({ method: 'HEAD', url: page.url, headers: { host: page.host } })
    assert.equal(head.statusCode, 200)
    assert.equal(head.body, '')
  }
  assert.deepEqual(lookups.slice(0, 4), ['lacochera', 'lacochera', 'lacochera', 'lacochera'])
  for (const status of ['PAUSED', 'CANCELLED']) {
    accountStatus = status
    for (const page of pages) {
      const response = await app.inject({ url: page.url, headers: { host: page.host } })
      assert.equal(response.statusCode, 503)
      assert.equal(response.rawPayload.equals(html), false)
    }
  }
  accountStatus = 'ACTIVE'; landingEnabled = false
  for (const page of pages) assert.equal((await app.inject({ url: page.url, headers: { host: page.host } })).statusCode, 404)
  const model = await app.inject({ url: '/lacochera?preview=model', headers: { host: 'weex.com.ar' } })
  assert.equal(model.rawPayload.equals(html), false, 'La vista modelo no debe saltarse landingEnabled para servir datos reales')
  landingEnabled = true
  for (const page of pages) {
    const response = await app.inject({ url: `${page.url.split('?')[0]}?preview=model`, headers: { host: page.host } })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.includes('hero-reserve'), false, 'La vista modelo debe conservar la plantilla genérica')
    assert.match(response.body, /Plantilla modelo/)
  }
  for (const page of [
    { host: 'lacochera.weex.com.ar', url: '/reservar' }, { host: 'lacochera.weex.com.ar', url: '/cuenta' },
    { host: 'weex.com.ar', url: '/lacochera/reservar' }, { host: 'weex.com.ar', url: '/lacochera/cuenta' },
    { host: 'otro.weex.com.ar', url: '/' }, { host: 'weex.com.ar', url: '/otro' },
    { host: 'otro.weex.com.ar', url: '/lacochera' },
  ]) {
    const response = await app.inject({ url: page.url, headers: { host: page.host } })
    assert.equal(response.statusCode, 200)
    assert.equal(response.rawPayload.equals(html), false, `No reemplazar ${page.host}${page.url}`)
  }
  for (const [host, url] of [
    ['weex.com.ar', '/lacochera/assets/social/portada-whatsapp-v11.png'],
    ['lacochera.weex.com.ar', '/assets/social/portada-whatsapp-v11.png'],
    ['weex.com.ar', '/lacochera/assets/social/portada-whatsapp-v14.jpg'],
    ['lacochera.weex.com.ar', '/assets/social/portada-whatsapp-v14.jpg'],
  ]) {
    const response = await app.inject({ url, headers: { host, 'user-agent': 'facebookexternalhit/1.1' } })
    assert.equal(response.statusCode, 200)
    const expectedPreview = url.endsWith('.jpg') ? whatsappPreview : preview
    assert.ok(response.rawPayload.equals(expectedPreview))
    assert.equal(response.headers['content-type'], url.endsWith('.jpg') ? 'image/jpeg' : 'image/png')
    assert.equal((await app.inject({ method: 'HEAD', url, headers: { host } })).statusCode, 200)
    assert.equal(isLaCocheraPublicResource('GET', host, url), true)
    assert.equal(isLaCocheraPublicResource('POST', host, url), false)
    assert.equal(isLaCocheraPublicResource('GET', 'otro.weex.com.ar', url), false)
  }
  for (const url of ['/assets/social/private.txt', '/lacochera/assets/%2e%2e/private.txt', '/assets/social/portada-whatsapp-v11.png']) {
    const response = await app.inject({ url, headers: { host: 'otro.weex.com.ar' } })
    assert.ok(response.statusCode === 404 || response.statusCode === 401)
    assert.equal(response.rawPayload.equals(preview), false)
    assert.equal(isLaCocheraPublicResource('GET', 'otro.weex.com.ar', url), false)
  }
  assert.equal((await app.inject({ url: '/professionals', headers: { host: 'lacochera.weex.com.ar' } })).statusCode, 401)
  const server = readFileSync('src/server.ts', 'utf8')
  assert.match(server, /app.register\(laCocheraSiteRoutes\)/)
  console.log('La Cochera hosting contract: OK (dos entradas, controles de cuenta, rutas existentes y OG pública)')
} finally {
  BusinessService.prototype.findPublicBySlug = originalFind
  await app.close()
}
