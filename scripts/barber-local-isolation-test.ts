import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AuthoritativeAdmissionRepository, AuthoritativeRoute } from '../src/bot-options/infrastructure/prisma-admission.js'
import { createBarberWebhookApps } from '../src/barber-local/ingress.js'
import { validateBarberLocalConfig, startBarberWorkerLoops } from '../src/barber-local/runtime.js'

const barber = 'cmpvr0oqo0000o0vcnhgyv054'
const other = 'another-business'
const secret = 'test-only-secret'
const received: Array<{ businessId: string; kinds: string[] }> = []
const route = (businessId: string): AuthoritativeRoute => ({
  kind: 'new', businessId, deploymentId: 'test-deploy', generation: 1,
  appSecret: secret, appSecretPrevious: null, appSecretPreviousValidUntil: null
})
const repository: AuthoritativeAdmissionRepository = {
  async resolveRoute(phoneNumberId) {
    if (phoneNumberId === 'barber-phone') return route(barber)
    if (phoneNumberId === 'other-phone') return route(other)
    return { kind: 'legacy' }
  },
  async admitAuthoritative(input) {
    received.push({ businessId: input.route.businessId, kinds: input.events.map((event) => event.kind) })
    return { eventCount: input.events.length, insertedCount: input.events.length }
  }
}
const apps = await createBarberWebhookApps({ repository, verifyToken: 'test-verify-token' })
const { gateway, internal } = apps
await gateway.ready()
try {
  const verify = await gateway.inject({ method: 'GET',
    url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123' })
  assert.equal(verify.statusCode, 200)
  assert.equal(verify.body, 'challenge-123')
  assert.equal((await gateway.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x' })).statusCode, 403)
  for (const url of ['/crm', '/health', '/webhooks/whatsapp/', '/webhooks/%77hatsapp']) {
    assert.notEqual((await gateway.inject({ method: 'GET', url })).statusCode, 200, url)
  }
  assert.notEqual((await gateway.inject({ method: 'PUT', url: '/webhooks/whatsapp' })).statusCode, 200)
  assert.notEqual((await gateway.inject({ method: 'HEAD', url: '/webhooks/whatsapp' })).statusCode, 200)

  const post = (phone: string, value: Record<string, unknown>, signed = true) => {
    const raw = Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, ...value
      } }] }]
    }))
    const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
    return gateway.inject({ method: 'POST', url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', ...(signed ? { 'x-hub-signature-256': signature } : {}) },
      payload: raw })
  }
  const message = await post('barber-phone', { messages: [{ id: 'wamid-in', from: '15551112222',
    timestamp: '1780000000', type: 'text', text: { body: 'Hola' } }] })
  assert.equal(message.statusCode, 200)
  const status = await post('barber-phone', { statuses: [{ id: 'wamid-out', status: 'delivered', timestamp: '1780000001',
    recipient_id: '15551112222' }] })
  assert.equal(status.statusCode, 200)
  assert.deepEqual(received, [{ businessId: barber, kinds: ['message'] }, { businessId: barber, kinds: ['status'] }])
  const mixedRaw = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account', entry: [
      { id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: 'barber-phone' },
        messages: [{ id: 'mixed-1', from: '15551112222', type: 'text', text: { body: 'Hola' } }]
      } }] },
      { id: 'other-waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: 'other-phone' },
        statuses: [{ id: 'mixed-status', status: 'read' }]
      } }] }
    ]
  }))
  const mixedSignature = 'sha256=' + createHmac('sha256', secret).update(mixedRaw).digest('hex')
  assert.notEqual((await gateway.inject({ method: 'POST', url: '/webhooks/whatsapp',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': mixedSignature },
    payload: mixedRaw })).statusCode, 200, 'mixed WABA batch must not be admitted as Barber')
  assert.equal(received.length, 2)
  assert.equal((await post('barber-phone', { messages: [] }, false)).statusCode, 403, 'unsigned payload is denied')
  assert.notEqual((await post('other-phone', { messages: [] })).statusCode, 200, 'foreign tenant is never admitted')
  assert.notEqual((await post('unknown-phone', { messages: [] })).statusCode, 200, 'legacy fallback is disabled')
  assert.equal(received.length, 2)
  assert.equal((await internal.inject({ method: 'GET', url: '/crm' })).statusCode, 404, 'internal app registers no CRM route')
} finally {
  await Promise.all([gateway.close(), internal.close()])
}

const env = {
  BOT_WORKER_SCOPE_MODE: 'include', BOT_WORKER_SCOPE_BUSINESS_ID: barber,
  BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED: 'true', BOT_OPTIONS_WORKERS_ENABLED: 'true',
  BOT_OPTIONS_SENDER_ENABLED: 'true', BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE: 'true',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token', CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true',
  OPENAI_API_KEY: 'fake-test-key', DATABASE_URL: 'postgres://fake', WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES: 'WX-38N6UG'
}
assert.deepEqual(validateBarberLocalConfig(env).scope, { mode: 'include', businessId: barber })
for (const broken of [
  { ...env, BOT_WORKER_SCOPE_MODE: 'exclude' },
  { ...env, BOT_WORKER_SCOPE_BUSINESS_ID: other },
  { ...env, BOT_WORKER_SCOPE_BUSINESS_ID: undefined },
  { ...env, WHATSAPP_VERIFY_TOKEN: undefined },
  { ...env, OPENAI_API_KEY: undefined }
]) assert.throws(() => validateBarberLocalConfig(broken))
const scopes: unknown[] = []
const loops = await startBarberWorkerLoops({
  scope: { mode: 'include', businessId: barber },
  client: {} as never, provider: { async send() { return { kind: 'accepted' as const, providerMessageId: 'fake' } } },
  handle: async () => {},
  startWorker: (input) => { scopes.push(input.scope); return { async stop() {} } },
  startSender: (input) => { scopes.push(input.scope); return { async stop() {} } }
})
assert.deepEqual(scopes, Array.from({ length: 3 }, () => ({ mode: 'include', businessId: barber })))
await loops.stop()
const entrypoint = await readFile(new URL('../src/barber-local.ts', import.meta.url), 'utf8')
for (const forbidden of ['startServer(', 'buildApp(', 'startMarketingScheduler(', 'ensureBootstrapSuperAdmin(', 'startAppointmentRealtimeListener(', 'startCashRealtimeListener(']) {
  assert.equal(entrypoint.includes(forbidden), false, `local entrypoint must not start global service: ${forbidden}`)
}
assert.match(entrypoint, /processProviderEventJob/)
assert.match(entrypoint, /MetaOutboxProvider/)
// P21: a settled proof job is not necessarily a proof accepted for review.
// Log only the existing closed result, never the job, media or customer data.
const proofHandler = entrypoint.match(/if \(job\.kind === 'RECEIVE_DEPOSIT_PROOF'\) \{([\s\S]*?)\n    \}/)?.[1]
assert.ok(proofHandler, 'Barber must retain its proof-worker route')
assert.match(proofHandler, /const outcome = await processDepositProofJob\(/,
  'the existing worker result must be captured after its durable transaction')
const proofEmission = proofHandler.match(/diagnosticSink\.emit\('barber-local-deposit-proof',\s*(\{[^}]*\})\)/)?.[1]
assert.equal(proofEmission?.replace(/\s/g, ''), '{outcome}',
  'proof diagnostics expose only the closed result enum, not identifiers, contents or errors')
assert.match(proofHandler, /await processDepositProofJob[\s\S]*diagnosticSink\.emit[\s\S]*return/,
  'result diagnostics follow the completed worker and cannot precede submission validation')
console.log('barber local ingress and runtime isolation passed')
