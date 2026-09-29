import assert from 'node:assert/strict'
import { MetaOutboxProvider } from '../src/bot-options/infrastructure/meta-outbox-provider.js'
import { WhatsAppCloudApi, buildWhatsAppReplyButtonsPayload, buildWhatsAppInteractiveListPayload } from '../src/integrations/whatsapp-cloud-api.js'

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

const rotatedTokenCalls: string[] = []
const rotatedTokenProvider = new MetaOutboxProvider({
  api: {
    async sendTextMessage(input) { rotatedTokenCalls.push(input.credentials.accessToken!); return { sent: true as const, to: input.to, response: { messages: [{ id: 'wamid.rotated' }] } } },
    async sendReplyButtonsMessage() { throw new Error('unexpected buttons send') },
    async sendInteractiveListMessage() { throw new Error('unexpected list send') }
  },
  async resolveCredentials() { return { accessToken: 'rotated-token', phoneNumberId: 'stable-phone', apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' } }
})
assert.deepEqual(await rotatedTokenProvider.send({
  businessId: 'tenant-rotated',
  payload: { to: '5491100000000', expectedProviderPhoneNumberId: 'stable-phone', item: { type: 'informative_text', body: 'hola' } }
}, signal), { kind: 'accepted', providerMessageId: 'wamid.rotated' })
assert.deepEqual(rotatedTokenCalls, ['rotated-token'], 'same provider phone identity permits token rotation')

let changedIdentityApiCalls = 0
let currentProviderPhoneNumberId = 'changed-phone'
const changedIdentityProvider = new MetaOutboxProvider({
  api: {
    async sendTextMessage(input) { changedIdentityApiCalls += 1; return { sent: true as const, to: input.to, response: { messages: [{ id: 'wamid.restored' }] } } },
    async sendReplyButtonsMessage() { changedIdentityApiCalls += 1; throw new Error('must not call Meta') },
    async sendInteractiveListMessage() { changedIdentityApiCalls += 1; throw new Error('must not call Meta') }
  },
  async resolveCredentials() { return { accessToken: 'new-token', phoneNumberId: currentProviderPhoneNumberId, apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' } }
})
assert.deepEqual(await changedIdentityProvider.send({
  businessId: 'tenant-changed',
  payload: { to: '5491100000000', expectedProviderPhoneNumberId: 'original-phone', item: { type: 'informative_text', body: 'hola' } }
}, signal), { kind: 'clear_failure', code: 'provider_identity_mismatch', retryable: true })
assert.equal(changedIdentityApiCalls, 0, 'changed provider phone identity must fail closed before any Meta API call')
currentProviderPhoneNumberId = 'original-phone'
assert.deepEqual(await changedIdentityProvider.send({
  businessId: 'tenant-changed',
  payload: { to: '5491100000000', expectedProviderPhoneNumberId: 'original-phone', item: { type: 'informative_text', body: 'hola' } }
}, signal), { kind: 'accepted', providerMessageId: 'wamid.restored' })
assert.equal(changedIdentityApiCalls, 1, 'restoring the fenced provider identity permits the retained outbox to send')

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

// Offline diagnostics: one credential lookup, one fetch and one body read per send.
const originalFetch = globalThis.fetch
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
type Diagnostic = { phase: string; durationMs: number; outcome: string }
const credentials = { accessToken: 'synthetic-token', phoneNumberId: 'synthetic-phone', apiVersion: 'v23.0', phoneNumberMode: 'LOCAL' }
const diagnosticPayload = { to: '5491100000000', item: { type: 'informative_text' as const, body: 'synthetic text' } }
let credentialCalls = 0
let fetchCalls = 0
let bodyReads = 0
let responseMode: 'ok' | 'http_error' | 'invalid_json' | 'missing_id' | 'fetch_error' | 'abort' = 'ok'
const sentRequests: RequestInit[] = []
const apiProvider = new MetaOutboxProvider({
  api: new WhatsAppCloudApi(),
  async resolveCredentials() { credentialCalls += 1; await pause(12); return credentials }
})
const diagnostics: Diagnostic[] = []
try {
  globalThis.fetch = (async (_url, init) => {
    fetchCalls += 1
    sentRequests.push(init!)
    if (responseMode === 'abort') {
      await new Promise<void>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('synthetic_abort')), { once: true }))
    }
    await pause(18)
    if (responseMode === 'fetch_error') throw new Error('synthetic_fetch_failure')
    return {
      ok: responseMode !== 'http_error', status: responseMode === 'http_error' ? 429 : 200,
      async json() {
        bodyReads += 1; await pause(24)
        if (responseMode === 'invalid_json') throw new SyntaxError('synthetic_invalid_json')
        return { messages: responseMode === 'missing_id' ? [] : [{ id: 'wamid.synthetic' }] }
      },
      async text() { bodyReads += 1; await pause(24); return JSON.stringify({ error: { code: 131000, message: 'synthetic rejection' } }) }
    } as Response
  }) as typeof fetch
  const diagnosticItems = [diagnosticPayload.item,
    { type: 'interactive' as const, mode: 'buttons' as const, body: 'synthetic buttons', buttons: [{ id: 'one', title: 'One' }] },
    { type: 'interactive' as const, mode: 'list' as const, body: 'synthetic list', rows: [{ id: 'one', title: 'One' }] }
  ]
  for (const item of diagnosticItems) {
    diagnostics.length = 0
    const beforeBodyReads = bodyReads
    const phaseReads: Array<{ phase: string; bodyReads: number }> = []
    const result = await apiProvider.send({ businessId: 'synthetic-tenant', payload: { ...diagnosticPayload, item } }, signal, (event) => {
      diagnostics.push(event); phaseReads.push({ phase: event.phase, bodyReads })
    })
    assert.deepEqual(phaseReads.map(({ bodyReads }) => bodyReads), [beforeBodyReads, beforeBodyReads, beforeBodyReads + 1], 'HTTP header phase closes before reading the body')
    assert.deepEqual(result, { kind: 'accepted', providerMessageId: 'wamid.synthetic' })
    assert.deepEqual(diagnostics.map((event) => event.phase), ['provider_credentials', 'meta_http', 'meta_response_parse'], 'provider must separate credentials, HTTP headers, and body/ID validation')
    for (const [index, minimum] of [10, 15, 20].entries()) {
      assert.ok(diagnostics[index]!.durationMs >= minimum, `phase ${index} must include its own delay`)
      assert.equal(diagnostics[index]!.outcome, 'ok')
      assert.deepEqual(Object.keys(diagnostics[index]!).sort(), ['durationMs', 'outcome', 'phase'])
    }
    const request = sentRequests.at(-1)!
    assert.equal(request.signal, signal, 'original abort signal is preserved')
    assert.equal(request.method, 'POST')
    const expected = item.type === 'informative_text'
      ? { messaging_product: 'whatsapp', to: diagnosticPayload.to, type: 'text', text: { body: item.body } }
      : item.mode === 'buttons'
        ? buildWhatsAppReplyButtonsPayload({ to: diagnosticPayload.to, text: item.body, buttons: item.buttons })
        : buildWhatsAppInteractiveListPayload({ to: diagnosticPayload.to, text: item.body, rows: item.rows })
    assert.deepEqual(JSON.parse(request.body as string), expected, 'instrumentation does not alter payload')
  }
  assert.equal(credentialCalls, 3)
  assert.equal(fetchCalls, 3)
  assert.equal(bodyReads, 3)

  const input = { businessId: 'synthetic-tenant', payload: diagnosticPayload }
  const capture = (event: Diagnostic) => diagnostics.push(event)
  for (const mode of ['invalid_json', 'missing_id', 'fetch_error'] as const) {
    responseMode = mode; diagnostics.length = 0
    await assert.rejects(apiProvider.send(input, signal, capture), mode === 'missing_id' ? /accepted_without_provider_id/ : new RegExp(`synthetic_${mode === 'invalid_json' ? 'invalid_json' : 'fetch_failure'}`))
    assert.equal(diagnostics.at(-1)!.phase, mode === 'fetch_error' ? 'meta_http' : 'meta_response_parse')
    assert.equal(diagnostics.at(-1)!.outcome, 'error', 'ambiguous errors preserved without raw errors')
  }
  responseMode = 'http_error'
  for (const item of diagnosticItems) {
    diagnostics.length = 0
    assert.deepEqual(await apiProvider.send({ ...input, payload: { ...diagnosticPayload, item } }, signal, capture), { kind: 'clear_failure', code: '131000', retryable: true })
    assert.deepEqual(diagnostics.map(({ phase, outcome }) => ({ phase, outcome })), [
      { phase: 'provider_credentials', outcome: 'ok' }, { phase: 'meta_http', outcome: 'error' }, { phase: 'meta_response_parse', outcome: 'ok' }
    ])
  }
  responseMode = 'invalid_json'
  await assert.rejects(apiProvider.send(input, signal, () => { throw new Error('synthetic_sink_failure') }), /synthetic_invalid_json/, 'sink failure cannot replace the original parse error')
  responseMode = 'ok'
  assert.deepEqual(await apiProvider.send(input, signal, () => { throw new Error('synthetic_sink_failure') }), { kind: 'accepted', providerMessageId: 'wamid.synthetic' }, 'diagnostic callbacks cannot break delivery')
  assert.deepEqual(await apiProvider.send(input, signal), { kind: 'accepted', providerMessageId: 'wamid.synthetic' }, 'callers without diagnostics stay compatible')
  responseMode = 'abort'; diagnostics.length = 0
  const controller = new AbortController()
  const pending = apiProvider.send(input, controller.signal, capture)
  setTimeout(() => controller.abort(), 35)
  await assert.rejects(pending, /synthetic_abort/)
  assert.equal(sentRequests.at(-1)!.signal, controller.signal)
  assert.equal(diagnostics.at(-1)!.phase, 'meta_http')
  assert.equal(diagnostics.at(-1)!.outcome, 'error')

  const credentialError = new Error('synthetic_credential_failure')
  const failingCredentialsProvider = new MetaOutboxProvider({ async resolveCredentials() { throw credentialError } })
  diagnostics.length = 0
  await assert.rejects(failingCredentialsProvider.send(input, signal, capture), (error) => error === credentialError)
  assert.equal(diagnostics[0]!.phase, 'provider_credentials')
  assert.equal(diagnostics[0]!.outcome, 'error')
  assert.equal(fetchCalls, 13, 'no duplicate requests, including error/abort paths')
  assert.equal(credentialCalls, 13, 'no extra credential reads')
  assert.equal(bodyReads, 11, 'fetch errors and aborts do not read a body')
} finally {
  globalThis.fetch = originalFetch
}
console.log('OK request-scoped provider latency diagnostics, offline.')
