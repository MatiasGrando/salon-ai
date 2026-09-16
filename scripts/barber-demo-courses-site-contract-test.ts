import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { findCustomSiteProfileBinding } from '../src/services/custom-site-profile-binding.js'
import { BusinessService } from '../src/services/business-service.js'
import { barberDemoCoursesSiteRoutes } from '../src/routes/barber-demo-courses-site.js'
import { authGuard } from '../src/plugins/auth-guard.js'
import { BARBER_DEMO_FORM_PILOT } from '../src/services/barber-demo-lead-form-pilot.js'
import { prisma } from '../src/config/prisma.js'

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
const originalFlags = prisma.businessFeatureSettings.findUnique
const originalForm = prisma.leadCaptureForm.findFirst
let available = true
let formsEnabled = false
let published = false
BusinessService.prototype.findPublicByCustomerCode = async (code: string) => {
  assert.equal(code, 'WX-38N6UG')
  return (available
    ? { id: 'barber-demo-business', landingEnabled: true, accountStatus: 'ACTIVE' }
    : { id: 'barber-demo-business', landingEnabled: true, accountStatus: 'PAUSED' }) as any
}
(prisma.businessFeatureSettings.findUnique as any) = async ({ where }: any) => {
  assert.equal(where.businessId, 'barber-demo-business')
  return { pipelineEnabled: true, leadCaptureFormsEnabled: formsEnabled }
}
(prisma.leadCaptureForm.findFirst as any) = async ({ where }: any) => {
  assert.deepEqual(where, { businessId: 'barber-demo-business', publicSlug: 'barber-demo-course-lead', status: 'PUBLISHED' })
  return published ? { id: 'published-form' } : null
}

const app = Fastify()
try {
  await app.register(barberDemoCoursesSiteRoutes)
  await authGuard(app)

  const home = await app.inject({ url: '/', headers: { host } })
  assert.equal(home.statusCode, 200)
  assert.match(home.headers['content-type'] || '', /text\/html/)
  assert.doesNotMatch(home.body, /<form id="leadContactForm"/)
  assert.match(home.body, /Formulario no disponible temporalmente/)

  formsEnabled = true
  published = true
  const activeHome = await app.inject({ url: '/', headers: { host } })
  assert.equal(activeHome.statusCode, 200)
  assert.match(activeHome.body, /<form id="leadContactForm"/)
  assert.doesNotMatch(activeHome.body, /Formulario no disponible temporalmente/)

  formsEnabled = false
  const pausedHome = await app.inject({ url: '/', headers: { host } })
  assert.doesNotMatch(pausedHome.body, /<form id="leadContactForm"/)

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
  ;(prisma.businessFeatureSettings.findUnique as any) = originalFlags
  ;(prisma.leadCaptureForm.findFirst as any) = originalForm
  await app.close()
}

console.log('Barber Demo courses site contract: OK')
