import assert from 'node:assert/strict'
import { resolveQaPreviewAi } from '../src/conversational-bot/qa-preview-ai.js'

assert.equal(resolveQaPreviewAi({ CONVERSATIONAL_QA_AI_ENABLED: 'false', OPENAI_API_KEY: 'secret' }), undefined)
assert.equal(resolveQaPreviewAi({ OPENAI_API_KEY: 'secret' }), undefined, 'default OFF')
let requests = 0
const fakeFetch = async (_url: string, options: any) => {
  requests++
  assert.equal(options.headers.Authorization, 'Bearer secret')
  const body = JSON.parse(options.body)
  assert.equal(body.model, 'qa-model')
  assert.equal(body.store, false)
  const answer = body.text.format.name === 'grounded_qa_reply' ? { opening: 'Hola', factIds: [], closing: null } : { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
  return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }) } as any
}
const enabled = resolveQaPreviewAi({ CONVERSATIONAL_QA_AI_ENABLED: 'true', OPENAI_API_KEY: 'secret', CONVERSATIONAL_QA_AI_MODEL: 'qa-model' }, fakeFetch as typeof fetch)
assert.ok(enabled)
assert.deepEqual(await enabled!({ message: 'hola', state: {} as any, services: [] }, new AbortController().signal), { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null })
assert.ok(enabled!.respond)
assert.deepEqual(await enabled!.respond!({ message: 'hola', intent: 'other', state: {} as any, facts: [] }, new AbortController().signal), { opening: 'Hola', factIds: [], closing: null })
assert.equal(requests, 2)
const missing = resolveQaPreviewAi({ CONVERSATIONAL_QA_AI_ENABLED: 'true' })
assert.ok(missing, 'enabled without key stays observable as fallback')
await assert.rejects(missing!({ message: 'hola', state: {} as any, services: [] }, new AbortController().signal), /configuration unavailable/)
console.log('QA AI config: OK')
