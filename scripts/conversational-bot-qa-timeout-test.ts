import assert from 'node:assert/strict'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { resolveQaPreviewAiTimeoutMs } from '../src/conversational-bot/qa-preview-ai.js'
const businessId = 'qa'
const started = performance.now()
const result = await runConversationalPreview({
  load: async () => null,
  save: async () => {},
  createPort: async () => ({
    context: { businessId, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') },
    port: { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) }
  }),
  interpretationTimeoutMs: resolveQaPreviewAiTimeoutMs({}),
  interpretationProvider: async (_input, signal) => {
    await new Promise(resolve => setTimeout(resolve, 3500))
    assert.equal(signal.aborted, false, '3500ms response must not be timed out')
    return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
  }
}, businessId, 'qa:slow', 'hola')
assert.equal(result.interpretation.mode, 'ai', '3.5 second provider must use AI, not fallback')
assert.equal(result.interpretation.reason, null)
assert.ok(performance.now() - started >= 3400)
assert.equal(resolveQaPreviewAiTimeoutMs({}), 4500)
assert.equal(resolveQaPreviewAiTimeoutMs({ CONVERSATIONAL_QA_AI_TIMEOUT_MS: '5000' }), 5000)
assert.equal(resolveQaPreviewAiTimeoutMs({ CONVERSATIONAL_QA_AI_TIMEOUT_MS: '8000' }), 5000)
assert.equal(resolveQaPreviewAiTimeoutMs({ CONVERSATIONAL_QA_AI_TIMEOUT_MS: 'not-a-number' }), 4500)
console.log('QA AI timeout: OK')
