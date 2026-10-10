import assert from 'node:assert/strict'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T12:00:00Z') }
const state = initialDialogueState('tenant')
globalThis.fetch = (() => { throw new Error('external network forbidden') }) as typeof fetch

// C16: local controlled outputs only; no rejected model payload enters diagnostics.
const diagnosticHelpers = await import('../src/conversational-bot/ai-diagnostics.js')
const replyHelpers = await import('../src/conversational-bot/reply-contract.js')
const failures: string[] = []; let passed = 0
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run(); passed++; console.log('PASS rejection diagnostic ' + name) }
  catch (error) { failures.push(name); console.error('RED rejection diagnostic ' + name + ': ' + String(error)) }
}
const material = [{ id: 'catalog', text: 'Información actual.' }, { id: 'next', text: '¿Qué más querés saber?' }]
const rule = replyHelpers.replyContract('information', false, false, material)
const cleanDraft = { salutation: null, opening: null, closing: null, factIds: null, variantChoices: null, catalogAnswer: null }
const explanation = { blocks: [{ kind: 'general', text: 'Los objetivos de estos procedimientos pueden variar según el producto.', sources: [] }] }
const scope = { aspect: 'description' as const, generalKnowledgeAllowed: true as const, services: [] }
for (const [name, raw, facts, catalog, cause, path] of [
  ['draft structure', { ...cleanDraft, privateKey: 'PRIVATE_PAYLOAD' }, material, scope, 'draft_structure', 'draft'],
  ['fact ids structure', { ...cleanDraft, factIds: 'PRIVATE_ID' }, material, scope, 'draft_structure', 'draft'],
  ['salutation shape', { ...cleanDraft, salutation: 'PRIVATE_NAME' }, material, scope, 'salutation_shape', 'draft.salutation'],
  ['variant collection', { ...cleanDraft, variantChoices: 'PRIVATE_PAYLOAD' }, material, scope, 'variants_structure', 'draft.variantChoices'],
  ['variant count', { ...cleanDraft, variantChoices: Array(3).fill(null) }, material, scope, 'variants_structure', 'draft.variantChoices'],
  ['variant object', { ...cleanDraft, variantChoices: ['PRIVATE_PAYLOAD'] }, material, scope, 'variant_structure', 'draft.variantChoices[]'],
  ['variant keys', { ...cleanDraft, variantChoices: [{ factId: 'PRIVATE_ID', variantId: 'PRIVATE_ID', privateKey: 'PRIVATE_PAYLOAD' }] }, material, scope, 'variant_fields', 'draft.variantChoices[]'],
  ['variant types', { ...cleanDraft, variantChoices: [{ factId: null, variantId: 'PRIVATE_ID' }] }, material, scope, 'variant_fields', 'draft.variantChoices[]'],
  ['duplicate variant', { ...cleanDraft, variantChoices: [{ factId: 'catalog', variantId: 'v' }, { factId: 'catalog', variantId: 'v' }] }, [{ ...material[0], variants: [{ id: 'v', text: 'Actual.' }] }, material[1]], scope, 'variant_fields', 'draft.variantChoices[]'],
  ['catalog context missing', { ...cleanDraft, catalogAnswer: explanation }, material, undefined, 'catalog_context_missing', 'context.catalogInformation'],
  ['catalog fact missing', { ...cleanDraft, catalogAnswer: explanation }, [material[1]], scope, 'catalog_fact_missing', 'facts.catalog']
] as const) await check(name, () => {
  const before = structuredClone(raw)
  const result = replyHelpers.validateReplyDraft(raw, facts, rule, [], catalog)
  assert.equal(result.validation.status, 'rejected'); assert.equal(result.validation.reason, 'invalid_shape')
  assert.equal(result.text, null); assert.deepEqual(raw, before)
  assert.deepEqual((result.validation as any).detail, { cause, path })
  assert.doesNotMatch(JSON.stringify(result.validation), /PRIVATE_|privateKey|variantId|factId/)
})
const summarize = (diagnosticHelpers as unknown as { summarizeReplyValidationDiagnostic?: (value: unknown) => unknown }).summarizeReplyValidationDiagnostic
await check('public boundary retains only closed own-data trace and bounded history', () => {
  assert.equal(typeof summarize, 'function')
  const rejected = { status: 'rejected', reason: 'invalid_shape', factCount: 2, providedCount: 0,
    detail: { cause: 'catalog_context_missing', path: 'context.catalogInformation', raw: 'PRIVATE_DESCRIPTION' } }
  const accepted = { status: 'accepted', reason: null, factCount: 2, providedCount: 0 }
  const history = [{ stage: 'first_reply', reason: 'invalid_shape', factCount: 2, providedCount: 0, detail: rejected.detail, raw: 'PRIVATE_MODEL' }]
  assert.deepEqual(summarize!({ firstCall: { ...rejected, raw: 'PRIVATE_MODEL' }, secondCall: accepted, rejections: history, message: 'PRIVATE_MESSAGE' }),
    { firstCall: { ...rejected, detail: { cause: 'catalog_context_missing', path: 'context.catalogInformation' } }, secondCall: accepted,
      rejections: [{ stage: 'first_reply', reason: 'invalid_shape', factCount: 2, providedCount: 0, detail: { cause: 'catalog_context_missing', path: 'context.catalogInformation' } }] })
  assert.equal(summarize!({ firstCall: rejected, secondCall: accepted, rejections: Array(5).fill(history[0]) }), undefined)
  assert.equal(summarize!({ firstCall: { ...rejected, detail: { cause: 'PRIVATE_REASON', path: 'PRIVATE_PATH' } }, secondCall: accepted }), undefined)
  assert.equal(summarize!({ firstCall: accepted, secondCall: accepted, rejections: [{ ...history[0], stage: 'PRIVATE_STAGE' }] }), undefined)
  let accessed = false
  assert.equal(summarize!({ firstCall: Object.defineProperty({ ...rejected }, 'detail', { get() { accessed = true; throw new Error('PRIVATE_GETTER') } }), secondCall: accepted }), undefined)
  assert.equal(accessed, false)
})
await check('first rejected frame remains visible when accepted isolated body is delivered', async () => {
  const message = 'Explicame en general qué es Keratina'
  const localPort: DialoguePort = { catalog: async () => [{ id: 'keratin', name: 'Keratina', description: null, price: 1, durationMinutes: 30, requiresConsultation: false }],
    availability: async () => { throw new Error('no agenda for informative read') } }
  const output = await respondWithAiInterpreter(context, state, message, localPort, async () => ({
    intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: ['keratin'], aspect: 'description' }, evidence: message, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message, confidence: 1, mention: 'Keratina', operationIndexes: [0] }] },
    firstReply: { ...cleanDraft, opening: 'Soy PRIVATE_NAME.', catalogAnswer: explanation }
  }))
  assert.equal(output.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.equal(output.interpretation.replyValidation?.firstCall.discardedFramingReason, 'identity_in_frame')
  assert.deepEqual((output.interpretation.replyValidation as any).rejections, [{ stage: 'first_reply', reason: 'identity_in_frame', factCount: 2, providedCount: 0 }])
  assert.equal(output.interpretation.aiCalls, 1); assert.equal(output.interpretation.replyRoute, 'first_call')
  assert.doesNotMatch(JSON.stringify(output.interpretation.replyValidation), /PRIVATE_|keratin|Keratina/)
  assert.equal(output.state.serviceId, null); assert.equal(output.bookingCommand, undefined)
})
await check('second provider rejection is retained independently', async () => {
  const message = 'Explicame en general qué es Keratina'
  const localPort: DialoguePort = { catalog: async () => [{ id: 'keratin', name: 'Keratina', description: null, price: 1, durationMinutes: 30, requiresConsultation: false }], availability: async () => { throw new Error('no agenda') } }
  const responseFailure = await respondWithAiInterpreter(context, state, message, localPort, async () => ({
    intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: ['keratin'], aspect: 'description' }, evidence: message, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message, confidence: 1, mention: 'Keratina', operationIndexes: [0] }] }, firstReply: null
  }), { responseProvider: async () => { throw new Error('PRIVATE_PROVIDER_ERROR') } })
  assert.equal(responseFailure.interpretation.replyValidation?.secondCall.reason, 'provider_error')
  assert.deepEqual((responseFailure.interpretation.replyValidation as any).rejections,
    [{ stage: 'first_reply', reason: 'missing_draft', factCount: responseFailure.interpretation.replyValidation!.firstCall.factCount, providedCount: 0 },
      { stage: 'second_reply', reason: 'provider_error', factCount: responseFailure.interpretation.replyValidation!.secondCall.factCount, providedCount: 0 }])
  assert.equal(responseFailure.interpretation.aiCalls, 2)
  assert.doesNotMatch(JSON.stringify(responseFailure.interpretation.replyValidation), /PRIVATE_/)
})
await check('interpretation repair retains the rejected attempt even when repaired output is accepted', async () => {
  let calls = 0
  const localPort: DialoguePort = { catalog: async () => [], availability: async () => { throw new Error('no agenda') } }
  const result = await respondWithAiInterpreter(context, state, 'hola', localPort, async () => {
    calls++
    return calls === 1 ? { intent: 'PRIVATE_INVALID_INTENT' } : { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
  })
  assert.equal(calls, 2); assert.equal(result.interpretation.mode, 'ai')
  assert.equal(result.interpretation.interpretationAttempts?.length, 2)
  assert.equal(result.interpretation.interpretationAttempts?.[0]?.reason, 'invalid_output')
  assert.equal(result.interpretation.interpretationAttempts?.[1]?.reason, null)
  assert.doesNotMatch(JSON.stringify(result.interpretation.interpretationAttempts), /PRIVATE_/)
})
await check('WhatsApp diagnostic sink reuses the sanitizing trace boundary', async () => {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile(new URL('../src/conversational-bot/process-inbox-job.ts', import.meta.url), 'utf8')
  assert.match(source, /summarizeReplyValidationDiagnostic\(diagnostic\.replyValidation\)/)
  assert.doesNotMatch(source, /replyValidation:\s*diagnostic\.replyValidation/)
})
await check('intake rejection retains its independent stage', async () => {
  let responseCalls = 0
  const localPort: DialoguePort = { catalog: async () => [{ id: 'cut', name: 'Corte', price: 1, durationMinutes: 30, requiresConsultation: false }], availability: async () => ({ professionals: [], slots: [] }) }
  const result = await respondWithAiInterpreter(context, state, 'Corte', localPort, async () => ({
    intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null, serviceConfidence: 'certain',
    intakeReply: { opening: null, closing: null, pending: 'service', serviceId: null, candidateIds: [] }
  }), { responseProvider: async input => { responseCalls++; return { ...cleanDraft, factIds: input.facts.map(fact => fact.id) } } })
  assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'intake_mismatch')
  const history = (result.interpretation.replyValidation as any).rejections
  assert.equal(history?.[0]?.stage, 'intake'); assert.equal(history?.[0]?.reason, 'intake_mismatch')
  assert.ok(history.length <= 4); assert.equal(result.interpretation.aiCalls, 1); assert.equal(responseCalls, 0)
})
await check('prepared acquisition keeps rejected framing stage without adding calls', async () => {
  const result = await respondWithAiInterpreter(context, state, 'soy Ana', { catalog: async () => [], availability: async () => { throw new Error('no agenda') } }, async input => ({
    intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Ana', evidence: 'soy Ana', confidence: 1 }] },
    firstReply: { ...cleanDraft, opening: 'Soy PRIVATE_NAME.', factIds: input.firstReplyFacts!.map(fact => fact.id) }
  }))
  assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'identity_in_frame')
  const history = (result.interpretation.replyValidation as any).rejections
  assert.equal(history?.[0]?.stage, 'prepared_frame'); assert.equal(history?.[0]?.reason, 'identity_in_frame')
  assert.equal(result.interpretation.aiCalls, 1); assert.equal(result.state.customerName, 'Ana')
  assert.doesNotMatch(JSON.stringify(result.interpretation.replyValidation), /PRIVATE_|Ana/)
})
for (const place of ['trace','firstCall','detail','history','historyItem','secondCall'] as const) await check('proxy traps are never evaluated at ' + place, () => {
  let accessed = 0
  const trap = () => { accessed++; throw new Error('PRIVATE_PROXY') }
  const proxy = (value: object) => new Proxy(value, { get: trap, getOwnPropertyDescriptor: trap, ownKeys: trap })
  const accepted = { status: 'accepted', reason: null, factCount: 2, providedCount: 0 }
  const detail = { cause: 'catalog_context_missing', path: 'context.catalogInformation' }
  const rejected = { status: 'rejected', reason: 'invalid_shape', factCount: 2, providedCount: 0, detail }
  const item = { stage: 'first_reply', reason: 'invalid_shape', factCount: 2, providedCount: 0, detail }
  const trace = { firstCall: rejected, secondCall: accepted, rejections: [item] }
  const value = place === 'trace' ? proxy(trace) : place === 'firstCall' ? { ...trace, firstCall: proxy(rejected) }
    : place === 'detail' ? { ...trace, firstCall: { ...rejected, detail: proxy(detail) } }
    : place === 'history' ? { ...trace, rejections: proxy([item]) }
    : place === 'historyItem' ? { ...trace, rejections: [proxy(item)] }
    : { ...trace, secondCall: proxy(accepted) }
  assert.equal(summarize!(value), undefined); assert.equal(accessed, 0)
})
console.log('rejection diagnostics: ' + passed + ' PASS / ' + failures.length + ' FAIL')
assert.deepEqual(failures, [], 'C16 rejection diagnostics regressions')
