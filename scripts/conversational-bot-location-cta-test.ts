import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialoguePort } from '../src/conversational-bot/engine.js'
import { textView } from '../src/bot-options/domain/views.js'
import { renderWhatsAppScreen, codePointLength } from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import { planPersistedView } from '../src/bot-options/application/process-session-job.js'
import { MetaOutboxProvider } from '../src/bot-options/infrastructure/meta-outbox-provider.js'
import * as cloud from '../src/integrations/whatsapp-cloud-api.js'
import { persistConversationTurnTx } from '../src/conversational-bot/persist-conversation-turn.js'
import { outboundMessageMetadata } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

const context = { businessId: 'location-tenant', timezone: 'UTC', dbNow: new Date('2026-10-12T12:00:00Z') }
const facts = { businessId: context.businessId, name: 'Salón ficticio', address: 'Calle 123', area: 'Ciudad', mapsUrl: null }
const port = { catalog: async () => [], information: async () => facts,
  availability: async () => { throw new Error('location must not query availability') } } as DialoguePort
const response = await respond(context, initialDialogueState(context.businessId), 'cual es la direccion?', port)
const link = (response as any).publicLink
assert.equal(link?.label, 'Ver ubicación', 'address delivers server-owned public link')
assert.match(link.url, /^https:\/\/www.google.com\/maps\/search\//)
assert.match(response.reply, /Maps: https:/, 'QA/text clients retain accessible fallback link')
assert.equal(response.choicePresentation, undefined, 'location never opens a booking question')
assert.equal(response.state.serviceId, null)
const view = (textView as any)(response.reply, link)
const screen = renderWhatsAppScreen(view, { promptToken: '', generateChoiceBytes: () => { throw new Error('CTA must not generate choice tokens') } })
const cta = screen.items.at(-1) as any
assert.equal(cta.mode, 'cta_url')
assert.equal(cta.url, link.url)
assert.equal(cta.buttonText, 'Ver ubicación')
assert.doesNotMatch(cta.body, /https:/, 'native CTA avoids repeating its inline fallback URL')
assert.deepEqual(screen.choiceMappings, [])
let id = 0
const long = planPersistedView({ view: (textView as any)('🙂 '.repeat(1100), link), transitionId: 't', toPhone: 'fake', promptToken: '', idFactory: () => String(++id) })
assert.equal(long.promptId, null)
assert.deepEqual(long.choiceRows, [])
assert.ok(long.outboxRows.length > 1)
assert.equal(long.outboxRows.at(-1)?.item.type, 'interactive')
for (const [index, row] of long.outboxRows.entries()) {
  assert.ok(codePointLength((row.item as any).body) <= 1024)
  assert.equal(row.dependsOnSequence, index ? index - 1 : null)
}
const builder = (cloud as any).buildWhatsAppUrlButtonPayload
const payload = builder({ to: 'fake', text: cta.body, url: link.url, buttonText: link.label })
assert.deepEqual(payload.interactive.action, { name: 'cta_url', parameters: { display_text: 'Ver ubicación', url: link.url } })
assert.equal(payload.interactive.type, 'cta_url')
for (const url of ['javascript:alert(1)', 'https://user:password@www.google.com/maps', 'https://evil.example/maps', 'http://www.google.com/maps']) {
  assert.throws(() => renderWhatsAppScreen((textView as any)('Dirección', { label: 'Ver ubicación', url }), { promptToken: '' }))
  assert.throws(() => builder({ to: 'fake', text: 'Dirección', buttonText: 'Ver ubicación', url }))
}
assert.throws(() => builder({ to: 'fake', text: 'a'.repeat(1025), buttonText: 'Ver ubicación', url: link.url }))
let sql = ''
await persistConversationTurnTx({ $queryRaw: async (query: any) => {
  sql = query.sql
  assert.ok(query.values.some((value: unknown) => typeof value === 'string' && value.includes('"mode":"cta_url"')))
  return [{ sessionCount: 1n, transitionCount: 1n, stepCount: 0n, outboxCount: 1n, inboxCount: 1n, dispatchCount: 1n, jobCount: 1n, conversationId: null, updatedAt: null }]
} } as never, { businessId: context.businessId, sessionId: 's', expectedRevision: 1n, revision: 2n, handoffFenceEpoch: 0,
  state: {}, transitionId: 't', deploymentId: 'd', generation: 1, providerEventId: 'e', actionType: 'conversation.message', step: null,
  finalizeText: { reply: response.reply, publicLink: link, toPhone: 'fake', dbNow: context.dbNow, inboxId: 'i', coveredIds: ['e'], dispatchToken: 'dispatch', jobId: 'j', jobToken: 'lease' } } as any)
assert.match(sql, /saved_session/)
assert.match(sql, /settled_inbox/)
assert.doesNotMatch(sql, /INSERT INTO "BotPrompt"|INSERT INTO "BotPromptChoice"/)
const calls: any[] = []
const diagnostics: any[] = []
const provider = new MetaOutboxProvider({ resolveCredentials: async () => ({ accessToken: 'fake', phoneNumberId: 'tenant-phone', apiVersion: 'v-test' } as any),
  api: { sendUrlButtonMessage: async (input: any, sink: any) => { calls.push(input); sink?.({ phase: 'meta_http', durationMs: 1, outcome: 'ok' }); return { sent: true, response: { messages: [{ id: 'accepted' }] } } } } as any })
const signal = new AbortController().signal
assert.equal((await provider.send({ businessId: context.businessId, payload: { to: 'fake', expectedProviderPhoneNumberId: 'tenant-phone', item: cta } }, signal, d => diagnostics.push(d))).kind, 'accepted')
assert.equal(calls[0].businessId, context.businessId)
assert.equal(calls[0].signal, signal)
assert.ok(diagnostics.some(d => d.phase === 'provider_credentials'))
assert.ok(diagnostics.some(d => d.phase === 'meta_http'))
assert.equal((await provider.send({ businessId: context.businessId, payload: { to: 'fake', expectedProviderPhoneNumberId: 'other', item: cta } }, signal)).kind, 'clear_failure')
assert.equal(calls.length, 1)
assert.equal((await provider.send({ businessId: context.businessId, payload: { to: 'fake', item: { ...cta, url: 'https://evil.example' } } }, signal)).kind, 'clear_failure')
assert.equal(calls.length, 1)
assert.deepEqual((outboundMessageMetadata({ item: cta } as any) as any).interactive, { mode: 'cta_url', buttonText: link.label, url: link.url })
// Exercise the real Cloud adapter locally: no network and no ambient credentials.
const originalFetch = globalThis.fetch
let request: any
const httpPhases: any[] = []
try {
  globalThis.fetch = (async (url: unknown, init: any) => {
    request = { url, ...init }
    return new Response(JSON.stringify({ messages: [{ id: 'fake-provider-id' }] }), { status: 200 })
  }) as typeof fetch
  const sent = await new cloud.WhatsAppCloudApi().sendUrlButtonMessage({ businessId: context.businessId,
    credentials: { accessToken: 'fictional-token', phoneNumberId: 'fictional-phone', apiVersion: 'v-test' } as any,
    to: '5491199990000', text: cta.body, url: link.url, buttonText: 'Ver ubicación', signal }, d => httpPhases.push(d))
  assert.equal(sent.sent, true)
  assert.equal(request.signal, signal)
  assert.match(request.url, /fictional-phone\/messages$/)
  assert.equal(JSON.parse(request.body).interactive.type, 'cta_url')
  assert.equal(JSON.parse(request.body).interactive.action.parameters.url, link.url)
  assert.deepEqual(httpPhases.map(d => d.phase), ['meta_http', 'meta_response_parse'])
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 131009, message: 'fixture' } }), { status: 400 })) as typeof fetch
  const failed = await new cloud.WhatsAppCloudApi().sendUrlButtonMessage({
    credentials: { accessToken: 'fictional-token', phoneNumberId: 'fictional-phone', apiVersion: 'v-test' } as any,
    to: '5491199990000', text: cta.body, url: link.url, buttonText: 'Ver ubicación' })
  assert.equal(failed.sent, false)
  assert.equal('status' in failed && failed.status, 400)
} finally { globalThis.fetch = originalFetch }
const missing = await respond(context, initialDialogueState(context.businessId), 'direccion?', { ...port, information: async () => ({ businessId: context.businessId, name: 'Demo', mapsUrl: 'https://evil.example' }) } as any)
assert.equal((missing as any).publicLink, undefined)
await assert.rejects(respond(context, initialDialogueState(context.businessId), 'direccion?', { ...port, information: async () => ({ ...facts, businessId: 'other' }) }), /scope/)
console.log('location CTA: PASS (safe metadata, no prompt, atomic outbox, limits, tenant, provider signals, QA fallback)')
