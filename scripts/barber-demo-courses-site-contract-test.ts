import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { findCustomSiteProfileBinding } from '../src/services/custom-site-profile-binding.js'
import { BusinessService } from '../src/services/business-service.js'
import { barberDemoCoursesSiteRoutes } from '../src/routes/barber-demo-courses-site.js'
import { authGuard } from '../src/plugins/auth-guard.js'
import { BARBER_DEMO_FORM_PILOT } from '../src/services/barber-demo-lead-form-pilot.js'

const host = 'demo-barber.weex.com.ar'
assert.equal(BARBER_DEMO_FORM_PILOT.rewardMode, 'NONE')
assert.equal(BARBER_DEMO_FORM_PILOT.status, 'DRAFT')

assert.deepEqual(findCustomSiteProfileBinding(host), {
  hostname: host,
  businessCustomerCode: 'WX-38N6UG',
  serviceCatalogMode: 'ALL'
})

const html = await readFile('src/assets/barber-demo-courses-site/index.html', 'utf8')
assert.match(html, /<title>DEMO CURSOS/)
assert.match(html, /<link rel="canonical" href="https:\/\/demo-barber\.weex\.com\.ar\/">/)
assert.match(html, /<meta property="og:url" content="https:\/\/demo-barber\.weex\.com\.ar\/">/)
assert.match(html, /<meta property="og:image" content="https:\/\/demo-barber\.weex\.com\.ar\/assets\/og-preview\.jpg">/)

const original = BusinessService.prototype.findPublicByCustomerCode
let available = true
BusinessService.prototype.findPublicByCustomerCode = async (code: string) => {
  assert.equal(code, 'WX-38N6UG')
  return (available
    ? { landingEnabled: true, accountStatus: 'ACTIVE' }
    : { landingEnabled: true, accountStatus: 'PAUSED' }) as any
}

const app = Fastify()
try {
  await app.register(barberDemoCoursesSiteRoutes)
  await authGuard(app)

  const home = await app.inject({ url: '/', headers: { host } })
  assert.equal(home.statusCode, 200)
  assert.match(home.headers['content-type'] || '', /text\/html/)

  const image = await app.inject({ url: '/assets/marketing-digital.jpg', headers: { host } })
  assert.equal(image.statusCode, 200)
  assert.match(image.headers['content-type'] || '', /image\/jpeg/)

  assert.notEqual(
    (await app.inject({ url: '/assets/marketing-digital.jpg', headers: { host: 'otro.weex.com.ar' } })).statusCode,
    200
  )

  available = false
  assert.equal((await app.inject({ url: '/', headers: { host } })).statusCode, 503)
} finally {
  BusinessService.prototype.findPublicByCustomerCode = original
  await app.close()
}

console.log('Barber Demo courses site contract: OK')
