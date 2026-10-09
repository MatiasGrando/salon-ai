import assert from 'node:assert/strict'
import { WhatsAppCloudApi } from '../src/integrations/whatsapp-cloud-api.js'

const api = new WhatsAppCloudApi()
assert.equal(typeof api.sendTypingIndicator, 'function', 'Cloud API must support the actual typing/read endpoint')
assert.equal(typeof api.sendReadReceipt, 'function', 'read coverage must not depend on preparing a text reply')
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
  await api.sendReadReceipt({ credentials, providerMessageId: context.providerMessageId, signal: new AbortController().signal })
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.fake'
  }, 'independent read receipt does not show typing after an already prepared reply')
  assert.ok(requests[0]?.init?.signal)
  const aborted = new AbortController(); aborted.abort()
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: 'wamid.fake', signal: aborted.signal }), false)
  assert.equal(await api.sendTypingIndicator({ credentials, providerMessageId: ' ', signal: new AbortController().signal }), false)
  assert.equal(await api.sendTypingIndicator({ credentials: { ...credentials, accessToken: '' }, providerMessageId: 'wamid.fake', signal: new AbortController().signal }), false)
  assert.equal(requests.length, 2, 'invalid inputs never make a request')
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
  assert.equal(attempts, 2, 'a new explicit preparation can try again; failures are not cached as successful hints'); failing.stop()
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

// P19 grouped acknowledgements remain bounded but cannot discard the fifth fragment.
const readIds: string[] = []
const readDiagnostics: unknown[] = []
let simultaneousReads = 0
let maximumReads = 0
const reception = createBarberTypingIndicator({
  resolveCredentials: async () => credentials,
  onDiagnostic: (event: unknown) => { readDiagnostics.push(event) },
  api: {
    async sendTypingIndicator() { return true },
    async sendReadReceipt(input: { providerMessageId: string }) {
      simultaneousReads++
      maximumReads = Math.max(maximumReads, simultaneousReads)
      await Promise.resolve()
      readIds.push(input.providerMessageId)
      simultaneousReads--
      return true
    }
  }
} as never)
const fragments = Array.from({ length: 6 }, (_, index) => ({ ...context, providerMessageId: 'read-' + index }))
reception.consume(fragments)
for (let index = 0; index < 60; index++) await Promise.resolve()
assert.deepEqual([...readIds].sort(), fragments.map(value => value.providerMessageId), 'every grouped fragment is attempted')
assert.ok(maximumReads <= 4, 'read and typing keep the existing global concurrency bound')
reception.stop()

const failedDiagnostics: unknown[] = []
const rejectedRead = createBarberTypingIndicator({
  resolveCredentials: async () => credentials,
  onDiagnostic: (event: unknown) => { failedDiagnostics.push(event) },
  api: {
    async sendTypingIndicator() { throw new Error('PRIVATE_PROVIDER_TOKEN') },
    async sendReadReceipt() { return false }
  }
} as never)
rejectedRead.consume([context])
for (let index = 0; index < 30; index++) await Promise.resolve()
assert.match(JSON.stringify(failedDiagnostics), /rejected/, 'HTTP false must produce a sanitized outcome')
assert.doesNotMatch(JSON.stringify(failedDiagnostics), /fake-token|wamid|PRIVATE_PROVIDER_TOKEN|barber-phone/, 'diagnostics must not expose credentials or provider identities')
rejectedRead.stop()

let releaseDelayedCredentials!: (value: typeof credentials) => void
let delayedTypingCalls = 0
const preparation = new AbortController()
const cancellableTyping = createBarberTypingIndicator({
  resolveCredentials: () => new Promise(resolve => { releaseDelayedCredentials = resolve }),
  api: {
    async sendTypingIndicator() { delayedTypingCalls++; return true },
    async sendReadReceipt() { return true }
  }
} as never)
cancellableTyping.notify({ ...context, signal: preparation.signal })
await flush()
preparation.abort()
releaseDelayedCredentials(credentials)
await flush()
assert.equal(delayedTypingCalls, 0, 'late credential lookup cannot start typing after reply preparation ends')
cancellableTyping.stop()
// Credential lookup and HTTP each receive their own bounded deadline.
const phaseOutcomes: unknown[] = []
let independentPhaseAccepted = 0
const independentPhases = createBarberTypingIndicator({
  timeoutMs: 200,
  resolveCredentials: async () => {
    await new Promise(resolve => setTimeout(resolve, 130))
    return credentials
  },
  onDiagnostic: event => { phaseOutcomes.push(event) },
  api: {
    async sendTypingIndicator({ signal }) {
      await new Promise(resolve => setTimeout(resolve, 130))
      if (signal.aborted) return false
      independentPhaseAccepted++
      return true
    },
    async sendReadReceipt() { return true }
  }
})
independentPhases.notify({ ...context, signal: new AbortController().signal })
await new Promise(resolve => setTimeout(resolve, 320))
assert.equal(independentPhaseAccepted, 1, 'a valid lookup must not eat the HTTP deadline')
assert.match(JSON.stringify(phaseOutcomes), /accepted/)
independentPhases.stop()