import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { createPublicSubmissionResponse, publicLeadFormsRoutes, renderPublicLeadFormHtml } from '../src/routes/public-lead-forms.js'

const routes = await readFile('src/routes/public-lead-forms.ts', 'utf8')
const barber = await readFile('src/routes/barber-demo-courses-site.ts', 'utf8')
assert.match(routes, /findCustomSiteProfileBinding/)
assert.match(routes, /findPublicByCustomerCode/)
assert.match(routes, /GET|app\.get\('\/f\/:slug'/)
assert.match(routes, /app\.post\('\/public\/forms\/:slug\/submissions'/)
assert.match(routes, /LeadFormSubmissionService/)
assert.match(routes, /no-store/)
assert.match(routes, /FORM_NOT_AVAILABLE/)
assert.match(routes, /form\.rewardMode !== 'NONE'.*form\.rewardMode !== 'BENEFIT'/)
assert.doesNotMatch(routes, /businessId\s*:\s*body\./)
assert.match(routes, /instagramRef:\s*body\.ref/)
assert.doesNotMatch(routes, /source:\s*'INSTAGRAM_COMMENT'/)
assert.match(barber, /appendConfiguredLeadForm/)
const rendered = renderPublicLeadFormHtml('oferta', { name: '<script>bad</script>', successTitle: null, successMessage: null, rewardMode: 'NONE' }, { fields: [{ key: 'email', label: 'Correo <personal>', type: 'EMAIL', required: true }] })
assert.match(rendered, /type="email"/)
assert.match(rendered, /aria-live="polite"/)
assert.doesNotMatch(rendered, /<script>bad/)
assert.match(rendered, /Correo &lt;personal&gt;/)
assert.match(rendered, />Enviar</)
assert.doesNotMatch(rendered, /acceder al beneficio/i)
const noneResponse = createPublicSubmissionResponse({
  submission: { id: 'submission-a', formId: 'form-a' },
  claim: null,
  benefitAvailable: false,
  replayed: false
}, { businessId: 'business-a', rewardTokenSecret: '' })
assert.deepEqual(noneResponse, { status: 'ACCEPTED', submissionId: 'submission-a', benefitAvailable: false, rewardClaim: null, replayed: false })
assert.throws(() => createPublicSubmissionResponse({
  submission: { id: 'submission-b', formId: 'form-a' },
  claim: { id: 'claim-a', accessVersion: 1, expiresAt: null, revokedAt: null },
  benefitAvailable: true,
  replayed: false
}, { businessId: 'business-a', rewardTokenSecret: '' }))
const benefitResponse = createPublicSubmissionResponse({
  submission: { id: 'submission-b', formId: 'form-a' },
  claim: { id: 'claim-a', accessVersion: 1, expiresAt: null, revokedAt: null },
  benefitAvailable: true,
  replayed: false
}, { businessId: 'business-a', rewardTokenSecret: 'reward-test-secret-at-least-32-bytes-long' })
assert.equal(benefitResponse.benefitAvailable, true)
assert.equal(benefitResponse.rewardClaim?.id, 'claim-a')
const app = Fastify()
await app.register(publicLeadFormsRoutes)
const spoofed = await app.inject({ method: 'GET', url: '/f/barber-demo-course-lead', headers: { host: 'attacker.example', 'x-forwarded-host': 'demo-barber.weex.com.ar' } })
assert.equal(spoofed.statusCode, 404)
assert.equal(spoofed.json().code, 'FORM_NOT_AVAILABLE')
const spoofedPost = await app.inject({ method: 'POST', url: '/public/forms/barber-demo-course-lead/submissions', headers: { host: 'attacker.example', 'x-forwarded-host': 'demo-barber.weex.com.ar' }, payload: { answers: {} } })
assert.equal(spoofedPost.statusCode, 404)
await app.close()
console.log('public lead forms routes contract: PASS')
