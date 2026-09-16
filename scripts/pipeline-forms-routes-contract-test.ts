import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import { pipelineMarkup, pipelineScript } from '../src/routes/crm-ui/pipeline.js'
import { leadFormPublicationReady, resolveLeadFormTrustedProxyIps, usesConservativeSharedPeerMode } from '../src/services/lead-form-edge-ip-policy.js'
import { BARBER_DEMO_FORM_PILOT } from '../src/services/barber-demo-lead-form-pilot.js'
import { validateLeadFormSchema } from '../src/services/lead-form-domain.js'
import { pipelineFormsRoutes } from '../src/routes/pipeline-forms.js'
import { PipelineFormsError, PipelineFormsService } from '../src/services/pipeline-forms-service.js'

const app = Fastify()
app.addHook('preHandler', async request => { request.auth = { user: { id: 'admin-a', role: 'BUSINESS_ADMIN', businessId: 'business-a' } } as never })
const calls: string[] = []
const service = {
  list: async (businessId: string) => { calls.push(`list:${businessId}`); return [] },
  create: async (input: { businessId: string; rewardMode?: string }) => { calls.push(`create:${input.businessId}:${input.rewardMode}`); return { id: 'form-a', status: 'DRAFT', version: 1, rewardMode: input.rewardMode } },
  update: async (input: { businessId: string; rewardMode?: string }) => { calls.push(`update:${input.businessId}:${input.rewardMode}`); return { id: 'form-a', status: 'DRAFT', version: 1, rewardMode: input.rewardMode } },
  publish: async (input: { businessId: string }) => { calls.push(`publish:${input.businessId}`); return { id: 'form-a', status: 'PUBLISHED', version: 1 } },
  disable: async (input: { businessId: string }) => { calls.push(`disable:${input.businessId}`); return { id: 'form-a', status: 'DISABLED', version: 1 } }
  ,configureReward: async (input: { businessId: string }) => { calls.push(`reward:${input.businessId}`); return { id: 'reward-a', type: 'LINK' } }
}
await app.register(pipelineFormsRoutes, { service: service as never, accessGuard: (async (_request, reply, businessId) => {
  if (businessId !== 'business-a') { reply.status(404).send({ code: 'PIPELINE_RESOURCE_NOT_FOUND' }); return null }
  return { id: businessId }
}) as never })

assert.equal((await app.inject({ method: 'GET', url: '/pipeline/forms?businessId=business-a' })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/pipeline/forms', payload: { businessId: 'business-a', publicSlug: 'pilot', name: 'Pilot', initialStageId: 'stage-a', rewardMode: 'NONE', fields: [] } })).statusCode, 201)
assert.equal((await app.inject({ method: 'PATCH', url: '/pipeline/forms/form-a', payload: { businessId: 'business-a', name: 'Pilot 2', rewardMode: 'BENEFIT' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/pipeline/forms/form-a/publish', payload: { businessId: 'business-a' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/pipeline/forms/form-a/disable', payload: { businessId: 'business-a' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'POST', url: '/pipeline/forms/form-a/reward', payload: { businessId: 'business-a', type: 'LINK', value: 'https://example.com' } })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/pipeline/forms?businessId=business-b' })).statusCode, 404)
assert.equal((await app.inject({ method: 'GET', url: '/pipeline/forms' })).statusCode, 400)
assert.deepEqual(calls, ['list:business-a', 'create:business-a:NONE', 'update:business-a:BENEFIT', 'publish:business-a', 'disable:business-a', 'reward:business-a'])
await app.close()
const barberHtml = await readFile('src/assets/barber-demo-courses-site/index.html', 'utf8')
assert.match(barberHtml, /fetch\('\/public\/forms\/barber-demo-course-lead\/submissions'/)
assert.doesNotMatch(barberHtml, /setTimeout\(\(\) => \{\s*submitBtn\.disabled = false;\s*submitBtn\.innerText = prevText;\s*successAlert\.style\.display = 'block'/)
assert.match(pipelineMarkup, /pl-forms-open/)
assert.match(pipelineMarkup, /pl-form-field-rows/)
assert.match(pipelineMarkup, /pl-form-reward-mode/)
assert.match(pipelineMarkup, /Sin beneficio/)
assert.match(pipelineMarkup, /Con beneficio/)
assert.doesNotMatch(pipelineMarkup, /value="FILE"/)
assert.match(pipelineScript, /\/pipeline\/forms/)
assert.match(pipelineScript, /rewardMode/)
assert.doesNotMatch(pipelineScript, /window\.(?:prompt|confirm|alert)/)
assert.equal(BARBER_DEMO_FORM_PILOT.status, 'DRAFT')
assert.equal(BARBER_DEMO_FORM_PILOT.rewardMode, 'NONE')
assert.equal(BARBER_DEMO_FORM_PILOT.businessCustomerCode, 'WX-38N6UG')
assert.equal(validateLeadFormSchema({ schemaVersion: 1, fields: BARBER_DEMO_FORM_PILOT.fields }).ok, true)
assert.equal(resolveLeadFormTrustedProxyIps(undefined), null)
assert.equal(resolveLeadFormTrustedProxyIps('0.0.0.0/0'), null)
assert.equal(resolveLeadFormTrustedProxyIps('203.0.113.10'), '203.0.113.10')
assert.equal(usesConservativeSharedPeerMode({ LEAD_FORM_INGRESS_MODE: 'SHARED_PEER_CONSERVATIVE', LEAD_FORM_CONSERVATIVE_BUSINESS_IDS: 'business-a' } as NodeJS.ProcessEnv, 'business-a'), true)
assert.equal(usesConservativeSharedPeerMode({ LEAD_FORM_INGRESS_MODE: 'SHARED_PEER_CONSERVATIVE', LEAD_FORM_CONSERVATIVE_BUSINESS_IDS: 'business-a' } as NodeJS.ProcessEnv, 'business-b'), false)
assert.equal(leadFormPublicationReady({ LEAD_FORM_INGRESS_MODE: 'SHARED_PEER_CONSERVATIVE', LEAD_FORM_CONSERVATIVE_BUSINESS_IDS: 'business-a', LEAD_FORM_RATE_LIMIT_SECRET: 'r'.repeat(32) } as NodeJS.ProcessEnv, false, 'business-a'), true)
assert.equal(leadFormPublicationReady({ LEAD_FORM_INGRESS_MODE: 'SHARED_PEER_CONSERVATIVE', LEAD_FORM_CONSERVATIVE_BUSINESS_IDS: 'business-a', LEAD_FORM_RATE_LIMIT_SECRET: 'r'.repeat(32), LEAD_REWARD_TOKEN_SECRET: 't'.repeat(32) } as NodeJS.ProcessEnv, true, 'business-a'), false)
const edge = Fastify({ trustProxy: resolveLeadFormTrustedProxyIps('203.0.113.10') || false })
edge.get('/ip', request => ({ ip: request.ip }))
const spoofedIp = await edge.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '198.51.100.20' })
assert.equal(spoofedIp.json().ip, '198.51.100.20')
const trustedIp = await edge.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '203.0.113.10' })
assert.equal(trustedIp.json().ip, '1.2.3.4')
await edge.close()

function publishHarness(rewardMode: unknown, reward: Record<string, unknown> | readonly Record<string, unknown>[] | null) {
  const form = { id: 'form-a', businessId: 'business-a', publicSlug: 'pilot', status: 'DRAFT', rewardMode, fields: [{ key: 'name', label: 'Nombre', type: 'TEXT', required: true, order: 0, mapping: { target: 'CONTACT_NAME' } }], initialStageId: 'stage-a', defaultAssigneeUserId: null, pipelineId: 'pipeline-a', version: 1, schemaVersion: 1, name: 'Pilot' }
  let rewardLookups = 0
  const tx = {
    leadCaptureForm: {
      findFirst: async () => ({ ...form }),
      updateMany: async () => ({ count: 0 }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...form, ...data })
    },
    businessFeatureSettings: { findUnique: async () => ({ leadCaptureFormsEnabled: true, pipelineEnabled: true }) },
    pipeline: { findUnique: async () => ({ id: 'pipeline-a' }) },
    pipelineStage: { findFirst: async () => ({ id: 'stage-a' }) },
    user: { findFirst: async () => null },
    formReward: {
      findFirst: async () => { rewardLookups++; return Array.isArray(reward) ? reward[0] ?? null : reward },
      findMany: async () => { rewardLookups++; return reward == null ? [] : Array.isArray(reward) ? reward : [reward] }
    }
  }
  const client = { ...tx, $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) }
  return { service: new PipelineFormsService(client as never), get rewardLookups() { return rewardLookups } }
}

const previousEnv = {
  proxy: process.env.LEAD_FORM_TRUSTED_PROXY_IPS,
  rate: process.env.LEAD_FORM_RATE_LIMIT_SECRET,
  reward: process.env.LEAD_REWARD_TOKEN_SECRET
}
process.env.LEAD_FORM_TRUSTED_PROXY_IPS = '203.0.113.10'
process.env.LEAD_FORM_RATE_LIMIT_SECRET = 'r'.repeat(32)
delete process.env.LEAD_REWARD_TOKEN_SECRET
try {
  const none = publishHarness('NONE', null)
  const published = await none.service.publish({ businessId: 'business-a', formId: 'form-a' })
  assert.equal(published.status, 'PUBLISHED')
  assert.equal(none.rewardLookups, 0)

  process.env.LEAD_REWARD_TOKEN_SECRET = 't'.repeat(32)
  const missing = publishHarness('BENEFIT', null)
  await assert.rejects(() => missing.service.publish({ businessId: 'business-a', formId: 'form-a' }),
    (error) => error instanceof PipelineFormsError && error.code === 'REWARD_REQUIRED')
  const valid = publishHarness('BENEFIT', { id: 'reward-a', businessId: 'business-a', formId: 'form-a', enabled: true })
  assert.equal((await valid.service.publish({ businessId: 'business-a', formId: 'form-a' })).status, 'PUBLISHED')
  const duplicate = publishHarness('BENEFIT', [
    { id: 'reward-a', businessId: 'business-a', formId: 'form-a', enabled: true },
    { id: 'reward-b', businessId: 'business-a', formId: 'form-a', enabled: true }
  ])
  await assert.rejects(() => duplicate.service.publish({ businessId: 'business-a', formId: 'form-a' }),
    (error) => error instanceof PipelineFormsError && error.code === 'REWARD_REQUIRED')
  const crossTenant = publishHarness('BENEFIT', { id: 'reward-a', businessId: 'business-b', formId: 'form-a', enabled: true })
  await assert.rejects(() => crossTenant.service.publish({ businessId: 'business-a', formId: 'form-a' }),
    (error) => error instanceof PipelineFormsError && error.code === 'REWARD_REQUIRED')
  const unknown = publishHarness(null, null)
  await assert.rejects(() => unknown.service.publish({ businessId: 'business-a', formId: 'form-a' }),
    (error) => error instanceof PipelineFormsError && error.code === 'INVALID_REWARD_MODE')
} finally {
  if (previousEnv.proxy === undefined) delete process.env.LEAD_FORM_TRUSTED_PROXY_IPS; else process.env.LEAD_FORM_TRUSTED_PROXY_IPS = previousEnv.proxy
  if (previousEnv.rate === undefined) delete process.env.LEAD_FORM_RATE_LIMIT_SECRET; else process.env.LEAD_FORM_RATE_LIMIT_SECRET = previousEnv.rate
  if (previousEnv.reward === undefined) delete process.env.LEAD_REWARD_TOKEN_SECRET; else process.env.LEAD_REWARD_TOKEN_SECRET = previousEnv.reward
}

const validFields = [{ key: 'name', label: 'Nombre', type: 'TEXT', required: true, order: 0, mapping: { target: 'CONTACT_NAME' } }]
for (const badMode of [undefined, 'AUTO']) {
  await assert.rejects(() => new PipelineFormsService({} as never).create({
    businessId: 'business-a', publicSlug: 'pilot', name: 'Pilot', initialStageId: 'stage-a',
    fields: validFields, rewardMode: badMode
  }), (error) => error instanceof PipelineFormsError && error.code === 'INVALID_REWARD_MODE')
}

{
  let savedMode: unknown
  const draft = { id: 'form-a', businessId: 'business-a', pipelineId: 'pipeline-a', initialStageId: 'stage-a', defaultAssigneeUserId: null, publicSlug: 'pilot', name: 'Pilot', status: 'DRAFT', rewardMode: 'NONE', schemaVersion: 1, version: 1, fields: validFields, successTitle: null, successMessage: null }
  const tx = {
    businessFeatureSettings: { findUnique: async () => ({ pipelineEnabled: true }) },
    pipeline: { findUnique: async () => ({ id: 'pipeline-a' }) },
    pipelineStage: { findFirst: async () => ({ id: 'stage-a' }) },
    user: { findFirst: async () => null },
    leadCaptureForm: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => 'id' in where ? ({ ...draft }) : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { savedMode = data.rewardMode; return { ...draft, ...data } },
      update: async ({ data }: { data: Record<string, unknown> }) => { savedMode = data.rewardMode; return { ...draft, ...data } }
    }
  }
  const service = new PipelineFormsService({ ...tx, $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as never)
  const created = await service.create({ businessId: 'business-a', publicSlug: 'nuevo', name: 'Nuevo', initialStageId: 'stage-a', fields: validFields, rewardMode: 'BENEFIT' })
  assert.equal(created.rewardMode, 'BENEFIT')
  assert.equal(savedMode, 'BENEFIT')
  const updated = await service.update({ businessId: 'business-a', formId: 'form-a', rewardMode: 'BENEFIT' })
  assert.equal(updated.rewardMode, 'BENEFIT')
  assert.equal(savedMode, 'BENEFIT')
}
console.log('pipeline forms routes: PASS')
