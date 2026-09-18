import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { BusinessService } from '../src/services/business-service.js'
import { landingUiRoutes } from '../src/routes/landing-ui.js'

const originalFind = BusinessService.prototype.findPublicBySlug
let customerCode = ''
BusinessService.prototype.findPublicBySlug = async function (slug: string) {
  return { slug, customerCode, name: 'Test business', accountStatus: 'ACTIVE', landingEnabled: true,
    landingTemplate: 'salon-white', services: [], professionals: [] } as any
}
const app = Fastify()
await app.register(landingUiRoutes)
try {
  for (const [code, slug, returnUrl] of [
    ['WX-NPP7HE', 'glowcanitas', 'https://glow.weex.com.ar/?sede=canitas'],
    ['WX-QG5FQA', 'glowurquiza', 'https://glow.weex.com.ar/?sede=urquiza'],
    ['WX-OTHER', 'other', '/other'],
    ['__proto__', 'glowcanitas', '/glowcanitas'],
    ['', 'glowurquiza', '/glowurquiza'],
  ]) {
    customerCode = code
    const response = await app.inject(`/${slug}/reservar?template=salon-white&returnTo=https://evil.example`)
    assert.equal(response.statusCode, 200)
    const html = response.body
    assert.ok(html.includes(`class="booking-brand" href="${returnUrl}"`), `${code}: brand must return to correct landing`)
    assert.ok(html.includes(`href="${returnUrl}" aria-label="Cerrar reserva"`), `${code}: close must return to correct landing`)
    assert.ok(html.includes(`const backPath = ${JSON.stringify(returnUrl)}`), `${code}: success links must share safe return URL`)
    assert.ok(html.includes(`href="/${slug}/cuenta" aria-label="Mi perfil"`), 'profile must remain business-scoped')
    assert.ok(html.includes(`const accountPath = "/${slug}/cuenta"`))
    assert.ok(html.includes(`const slug = "${slug}"`), 'booking APIs must retain original business slug')
    assert.equal(html.includes('evil.example'), false, 'query input must never define redirect destination')
  }
  console.log('Glow booking return contract: passed')
} finally {
  BusinessService.prototype.findPublicBySlug = originalFind
  await app.close()
}
