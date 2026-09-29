import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveWhatsAppConversationAi } from '../src/conversational-bot/whatsapp-ai.js'
const qaOnly = { CONVERSATIONAL_QA_AI_ENABLED: 'true', OPENAI_API_KEY: 'secret' }
assert.equal(resolveWhatsAppConversationAi({}), undefined)
assert.equal(resolveWhatsAppConversationAi(qaOnly), undefined, 'QA flag cannot enable WhatsApp')
assert.equal(resolveWhatsAppConversationAi({ ...qaOnly, CONVERSATIONAL_WHATSAPP_AI_ENABLED: '1' }), undefined)
const missing = resolveWhatsAppConversationAi({ CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true' })!
await assert.rejects(missing.provider({ message: 'hola', state: {} as never, services: [] }, new AbortController().signal), /configuration unavailable/)
assert.equal(missing.timeoutMs, 4500)
for (const [value, expected] of [['0', 1000], ['9000', 5000], ['no', 4500]] as const) {
  assert.equal(resolveWhatsAppConversationAi({ CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true', CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS: value })!.timeoutMs, expected)
}
const bodies: Record<string, unknown>[] = []
const fakeFetch = (async (_url: unknown, init: RequestInit) => {
  bodies.push(JSON.parse(String(init.body)))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }) }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
}) as typeof fetch
const config = resolveWhatsAppConversationAi({ CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true', OPENAI_API_KEY: 'secret', OPENAI_MODEL: 'gpt-4o-mini' }, fakeFetch)!
await config.provider({ message: 'hola', state: {} as never, services: [] }, new AbortController().signal)
assert.equal(bodies[0]!.model, 'gpt-6-luna', 'must not inherit Booking V2 model')
assert.equal(bodies[0]!.store, false)
assert.equal(typeof config.provider.respond, 'function')
const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
assert.ok(server.includes('resolveWhatsAppConversationAi(process.env)'))
assert.ok(server.includes('conversationalAi'), 'production composition passes the opt-in through existing worker')
console.log('conversational WhatsApp AI configuration/wiring: PASS')