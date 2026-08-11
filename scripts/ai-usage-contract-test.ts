import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { calculateAiUsageCostNanoUsd } from '../src/services/ai-pricing.js'
import {
  getAiUsageAttribution,
  runWithAiEnabled,
  setAiUsageAttribution
} from '../src/services/ai-execution-context.js'

const gpt4oMini = calculateAiUsageCostNanoUsd('gpt-4o-mini', {
  inputTokens: 1_000,
  cachedInputTokens: 200,
  outputTokens: 100
})
assert.deepEqual(gpt4oMini, {
  costNanoUsd: 195_000n,
  pricingKey: 'gpt-4o-mini-2026-08'
})

const gpt5Mini = calculateAiUsageCostNanoUsd('gpt-5-mini-2025-08-07', {
  inputTokens: 1_000,
  cachedInputTokens: 200,
  outputTokens: 100
})
assert.deepEqual(gpt5Mini, {
  costNanoUsd: 405_000n,
  pricingKey: 'gpt-5-mini-2026-08'
})
assert.equal(calculateAiUsageCostNanoUsd('modelo-sin-tarifa', {
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1
}), null)

await runWithAiEnabled(true, async () => {
  setAiUsageAttribution({
    businessId: 'business-1',
    conversationId: 'conversation-1',
    appointmentId: null
  })
  await Promise.resolve()
  assert.deepEqual(getAiUsageAttribution(), {
    businessId: 'business-1',
    conversationId: 'conversation-1',
    appointmentId: null
  })
})

const trackedSources = [
  ['conversation-router.ts', 'conversation_router'],
  ['ai-message-understanding-service.ts', 'message_understanding'],
  ['booking-v2-extractor.ts', 'booking_extraction'],
  ['booking-v2-choice-extractor.ts', 'booking_choice'],
  ['booking-v2-estimate-option-extractor.ts', 'booking_estimate_option'],
  ['booking-v2-estimate-decision-extractor.ts', 'booking_estimate_decision'],
  ['booking-v2-service-validation.ts', 'booking_service_validation']
] as const

for (const [fileName, source] of trackedSources) {
  const code = await readFile(new URL(`../src/services/${fileName}`, import.meta.url), 'utf8')
  assert.match(
    code,
    new RegExp(`createTrackedOpenAiResponse\\(client, '${source}', \\{`),
    `${fileName} debe registrar su consumo de IA`
  )
  assert.equal(code.includes('client.responses.create('), false)
}

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schema, /model AiUsageEvent/)
assert.match(schema, /responseId\s+String\s+@unique/)
assert.match(schema, /costNanoUsd\s+BigInt\?/)
assert.match(schema, /@@index\(\[conversationId, createdAt\]\)/)
assert.match(schema, /@@index\(\[appointmentId, createdAt\]\)/)

console.log('ai-usage-contract-test: OK')
