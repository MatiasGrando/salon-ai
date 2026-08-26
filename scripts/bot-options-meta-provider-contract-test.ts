import assert from 'node:assert/strict'
import { MetaOutboxProvider } from '../src/bot-options/infrastructure/meta-outbox-provider.js'

const calls: Array<{ businessId: string | null | undefined; accessToken: string | undefined }> = []
const api = {
  async sendTextMessage(input: { businessId?: string | null; credentials?: { accessToken?: string }; to: string }) {
    calls.push({ businessId: input.businessId, accessToken: input.credentials?.accessToken })
    return { sent: true as const, to: input.to, response: { messages: [{ id: `wamid.${input.businessId}` }] } }
  },
  async sendReplyButtonsMessage(input: { businessId?: string | null; credentials?: { accessToken?: string }; to: string }) {
    calls.push({ businessId: input.businessId, accessToken: input.credentials?.accessToken })
    return { sent: true as const, to: input.to, response: { messages: [{ id: `wamid.${input.businessId}` }] } }
  },
  async sendInteractiveListMessage(input: { businessId?: string | null; credentials?: { accessToken?: string }; to: string }) {
    calls.push({ businessId: input.businessId, accessToken: input.credentials?.accessToken })
    return { sent: true as const, to: input.to, response: { messages: [{ id: `wamid.${input.businessId}` }] } }
  }
}

const provider = new MetaOutboxProvider({
  api,
  async resolveCredentials(businessId) {
    return { accessToken: `token-${businessId}`, phoneNumberId: `phone-${businessId}`, apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' }
  }
})
const signal = new AbortController().signal
for (const businessId of ['tenant-a', 'tenant-b']) {
  const result = await provider.send({
    businessId,
    payload: { to: '5491100000000', item: { type: 'informative_text', body: 'hola' } }
  }, signal)
  assert.deepEqual(result, { kind: 'accepted', providerMessageId: `wamid.${businessId}` })
}
assert.deepEqual(calls, [
  { businessId: 'tenant-a', accessToken: 'token-tenant-a' },
  { businessId: 'tenant-b', accessToken: 'token-tenant-b' }
], 'authoritative sender must pass the matching tenant credentials into Meta')

let missingCredentialApiCalls = 0
const missingCredentialsProvider = new MetaOutboxProvider({
  api: {
    async sendTextMessage() { missingCredentialApiCalls += 1; throw new Error('must not call Meta') },
    async sendReplyButtonsMessage() { missingCredentialApiCalls += 1; throw new Error('must not call Meta') },
    async sendInteractiveListMessage() { missingCredentialApiCalls += 1; throw new Error('must not call Meta') }
  },
  async resolveCredentials() { return { apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' } }
})
assert.deepEqual(await missingCredentialsProvider.send({
  businessId: 'tenant-without-credentials',
  payload: { to: '5491100000000', item: { type: 'informative_text', body: 'hola' } }
}, signal), { kind: 'clear_failure', code: 'tenant_whatsapp_credentials_missing', retryable: false })
assert.equal(missingCredentialApiCalls, 0, 'authoritative sender must never fall back to shared credentials')

const ambiguousProvider = new MetaOutboxProvider({
  api: {
    async sendTextMessage(input) { return { sent: true as const, to: input.to, response: { messages: [] } } },
    async sendReplyButtonsMessage(input) { return { sent: true as const, to: input.to, response: { messages: [] } } },
    async sendInteractiveListMessage(input) { return { sent: true as const, to: input.to, response: { messages: [] } } }
  },
  async resolveCredentials() { return { accessToken: 'tenant-token', phoneNumberId: 'tenant-phone', apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' } }
})
await assert.rejects(ambiguousProvider.send({
  businessId: 'tenant-a',
  payload: { to: '5491100000000', item: { type: 'informative_text', body: 'hola' } }
}, signal), /accepted_without_provider_id/)

console.log('OK bot-options Meta provider: tenant credentials are explicit, fallback is forbidden and missing IDs are ambiguous.')
