import assert from 'node:assert/strict'
import Fastify from 'fastify'
import type { ProviderEventAdmission } from '../src/bot-options/application/admit-provider-events.js'
import type { BotOptionsConfig } from '../src/config/bot-options.js'
import {
  whatsappWebhookRoutes,
  type WhatsAppWebhookServiceContract
} from '../src/routes/whatsapp-webhook.js'

const botOptionsConfig: BotOptionsConfig = {
  shadowAdmissionEnabled: true,
  authoritativeProcessingEnabled: false,
  workersEnabled: false,
  senderEnabled: false,
  bookingCapabilityEnabled: false,
  depositsCapabilityEnabled: false,
  appointmentManagementCapabilityEnabled: false,
  handoffCapabilityEnabled: false,
  legacyDispatchCoverageComplete: false
}

const legacyResult = {
  legacy: true,
  result: [{ messageId: 'wamid.legacy', skipped: true }]
}
let legacyCalls = 0
const legacyWebhookService: WhatsAppWebhookServiceContract = {
  verifyWebhook(input) {
    return input.token === 'verify-token' && input.challenge
      ? { verified: true as const, challenge: input.challenge }
      : { verified: false as const }
  },
  async handleWebhook(payload) {
    legacyCalls += 1
    assert.deepEqual(payload, { entry: [] })
    return legacyResult
  }
}

let shadowCalls = 0
let mode: 'throw' | 'invalid' | 'pending' = 'throw'
const shadowAdmission: ProviderEventAdmission = {
  async admit(input) {
    shadowCalls += 1
    assert.deepEqual(input.rawBody, Buffer.from('{"entry":[]}', 'utf8'))
    if (mode === 'throw') throw new Error('simulated ingress outage')
    if (mode === 'pending') return new Promise(() => {})
    return { status: 'invalid_signature' }
  }
}

const app = Fastify({ logger: false })
await app.register(whatsappWebhookRoutes, {
  botOptionsConfig,
  shadowAdmission,
  legacyWebhookService
})

const shadowFailure = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: '{"entry":[]}'
})
assert.equal(shadowFailure.statusCode, 200)
assert.deepEqual(shadowFailure.json(), legacyResult)

mode = 'invalid'
const shadowInvalid = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: '{"entry":[]}'
})
assert.equal(shadowInvalid.statusCode, 200)
assert.deepEqual(shadowInvalid.json(), legacyResult)
assert.equal(shadowCalls, 2)
assert.equal(legacyCalls, 2)

mode = 'pending'
const shadowHung = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: '{"entry":[]}'
})
assert.equal(shadowHung.statusCode, 200, 'a hung shadow database must not delay the legacy ACK')
assert.deepEqual(shadowHung.json(), legacyResult)
assert.equal(shadowCalls, 3)
assert.equal(legacyCalls, 3)

const verification = await app.inject({
  method: 'GET',
  url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-1'
})
assert.equal(verification.statusCode, 200)
assert.equal(verification.body, 'challenge-1')
assert.equal(shadowCalls, 3, 'GET verification must not invoke shadow admission')

await app.close()
console.log('OK WhatsApp shadow wiring: shadow failures and invalid outcomes preserve the legacy HTTP contract.')
