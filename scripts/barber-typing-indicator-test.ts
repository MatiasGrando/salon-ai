import assert from 'node:assert/strict'
import { WhatsAppCloudApi } from '../src/integrations/whatsapp-cloud-api.js'

const api = new WhatsAppCloudApi()
assert.equal(typeof api.sendTypingIndicator, 'function', 'Cloud API must support the actual typing/read endpoint')
const { createBarberTypingIndicator } = await import('../src/barber-local/typing-indicator.js')
const businessId = 'cmpvr0oqo0000o0vcnhgyv054'
const context = { businessId, providerPhoneNumberId: 'barber-phone', providerMessageId: 'wamid.fake' }
const credentials = { accessToken: 'fake-token', phoneNumberId: 'barber-phone', apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), ...(init ? { init } : {}) })
  return new Response('{"success":true}', { status: 200 })
}
try {
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: context.providerMessageId, signal: new AbortController().signal }), true)
  assert.equal(requests[0]?.url, 'https://graph.facebook.com/v23.0/barber-phone/messages')
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.fake', typing_indicator: { type: 'text' }
  })
  assert.equal(new Headers(requests[0]?.init?.headers).get('Authorization'), 'Bearer fake-token')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.ok(requests[0]?.init?.signal)
  const aborted = new AbortController(); aborted.abort()
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: 'wamid.fake', signal: aborted.signal }), false)
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: ' ', signal: new AbortController().signal }), false)
  assert.equal(await api.sendTypingIndicator({ credentials: { ...credentials, accessToken: '' }, providerMessageId: 'wamid.fake', signal: new AbortController().signal }), false)
  assert.equal(requests.length, 1, 'invalid inputs never make a request')
  globalThis.fetch = async () => new Response('private provider error', { status: 429 })
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: 'wamid.fake', signal: new AbortController().signal }), false)
} finally { globalThis.fetch = originalFetch }

let now = 0
let resolves = 0
let sends = 0
let token = 'first'
const tokens: string[] = []
const indicator = createBarberTypingIndicator({
  now: () => now,
  resolveCredentials: async (id, options) => { assert.equal(id, businessId); assert.deepEqual(options, { allowInternalFallback: false }); resolves++; return { ...credentials, accessToken: token } },
  api: { async sendTypingIndicator(input) { sends++; tokens.push(input.credentials.accessToken!); return true } }
})
assert.equal(indicator.notify(context), undefined, 'notification must not return a promise that caller could await')
indicator.notify(context)
await flush()
assert.equal(sends, 1, 'concurrent duplicate is suppressed')
for (const bad of [{ ...context, businessId: 'other' }, { ...context, providerPhoneNumberId: '' }, { ...context, providerMessageId: '' }]) indicator.notify(bad)
await flush(); assert.equal(resolves, 1)
indicator.notify(context); await flush(); assert.equal(sends, 1, 'finished duplicate remains suppressed')
now = 300_001; token = 'rotated'; indicator.notify(context); await flush()
assert.deepEqual(tokens, ['first', 'rotated'], 'TTL expiry resolves current credentials without caching secrets')
indicator.stop(); indicator.notify({ ...context, providerMessageId: 'after-stop' }); await flush(); assert.equal(sends, 2)

for (const badCredentials of [{ ...credentials, phoneNumberId: 'other' }, { ...credentials, accessToken: '' }, { ...credentials, phoneNumberId: '' }]) {
  const invalid = createBarberTypingIndicator({ resolveCredentials: async () => badCredentials, api: { async sendTypingIndicator() { assert.fail('invalid tenant identity must not call Meta') } } })
  invalid.notify(context); await flush(); invalid.stop()
}
for (const failure of ['credentials', 'api'] as const) {
  let attempts = 0
  const failing = createBarberTypingIndicator({ resolveCredentials: async () => { attempts++; if (failure === 'credentials') throw new Error('private credential failure'); return credentials }, api: { async sendTypingIndicator() { throw new Error('private provider failure') } } })
  assert.doesNotThrow(() => failing.notify(context)); await flush(); failing.notify(context); await flush()
  assert.equal(attempts, 1, 'errors are swallowed without retry'); failing.stop()
}

let releaseCredentials!: (value: typeof credentials) => void
let lateCalls = 0
const late = createBarberTypingIndicator({ timeoutMs: 10, resolveCredentials: () => new Promise(resolve => { releaseCredentials = resolve }), api: { async sendTypingIndicator() { lateCalls++; return true } } })
late.notify(context); await flush()
await new Promise(resolve => setTimeout(resolve, 25))
releaseCredentials(credentials); await flush(); assert.equal(lateCalls, 0, 'credentials resolving after timeout cannot start HTTP'); late.stop()

let aborts = 0
let activeCalls = 0
const hanging = createBarberTypingIndicator({ timeoutMs: 10, resolveCredentials: async () => credentials, api: { sendTypingIndicator: async ({ signal }) => {
  activeCalls++
  await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborts++; resolve() }, { once: true }))
  return false
} } })
for (let i = 0; i < 6; i++) hanging.notify({ ...context, providerMessageId: `active-${i}` })
await flush(); assert.equal(activeCalls, 4, 'at most four requests in flight')
await new Promise(resolve => setTimeout(resolve, 25)); await flush(); assert.equal(aborts, 4)
hanging.stop()

let boundedCalls = 0
const bounded = createBarberTypingIndicator({ now: () => 0, resolveCredentials: async () => credentials, api: { async sendTypingIndicator() { boundedCalls++; return true } } })
for (let i = 0; i <= 256; i++) { bounded.notify({ ...context, providerMessageId: `bounded-${i}` }); await flush() }
bounded.notify({ ...context, providerMessageId: 'bounded-256' }); await flush(); assert.equal(boundedCalls, 257)
bounded.notify({ ...context, providerMessageId: 'bounded-0' }); await flush(); assert.equal(boundedCalls, 258, 'oldest dedupe key evicted at bounded capacity')
bounded.stop()

let stopRelease!: (value: typeof credentials) => void
const stopped = createBarberTypingIndicator({ resolveCredentials: () => new Promise(resolve => { stopRelease = resolve }), api: { async sendTypingIndicator() { assert.fail('shutdown forbids late request') } } })
stopped.notify(context); await flush(); stopped.stop(); stopRelease(credentials); await flush()
console.log('Barber typing indicator contracts: PASS')
