import assert from 'node:assert/strict'
import { REPLY_DRAFT_SCHEMA, replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
const context = { businessId: 'server-facts', timezone: 'UTC', dbNow: new Date('2026-10-03T12:00:00Z') }
const base = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
const serverDraft = { salutation: null, opening: 'Claro, te ayudo.', factIds: null, closing: null, variantChoices: null }
let passed = 0, failed = 0
async function check(label: string, run: () => void | Promise<void>) {
  try { await run(); passed++; console.log('PASS ' + label) }
  catch (error) { failed++; console.error('FAIL ' + label + ': ' + String(error)) }
}
for (const count of [10, 4]) {
  const facts = Array.from({ length: count }, (_, index) => ({
    id: index === count - 1 ? 'next' : String(index),
    text: index === count - 1 ? '¿Qué día preferís?' : index === count - 2 ? 'Condición obligatoria: precio $100.' : 'Dato verificado ' + index + '.'
  }))
  const policy = replyContract('information', false, false, facts)
  await check('server material complete and ordered ' + count, () => {
    const original = structuredClone(facts)
    const result = validateReplyDraft(serverDraft, facts, policy, [])
    assert.equal(result.validation.status, 'accepted')
    assert.equal(result.validation.providedCount, 0, 'the model did not provide a list')
    assert.equal(result.validation.factCount, count)
    assert.equal(result.text, ['Claro, te ayudo.', ...facts.map(fact => fact.text)].join('\n'))
    assert.deepEqual(facts, original)
  })
  await check('legacy omission ' + count + '/' + (count - 1) + ' remains rejected', () => {
    const legacy = { ...serverDraft, factIds: facts.slice(0, -1).map(fact => fact.id) }
    const result = validateReplyDraft(legacy, facts, policy, [])
    assert.equal(result.validation.reason, 'fact_membership'); assert.equal(result.text, null)
    assert.equal(result.validation.providedCount, count - 1)
  })
  for (const kind of ['duplicate', 'foreign', 'reverse'] as const) await check('legacy ' + kind + ' stays strict ' + count, () => {
    const ids = facts.map(fact => fact.id)
    if (kind === 'duplicate') ids[0] = ids[1]!
    if (kind === 'foreign') ids[0] = 'foreign'
    if (kind === 'reverse') ids.reverse()
    assert.equal(validateReplyDraft({ ...serverDraft, factIds: ids }, facts, policy, []).validation.reason, kind === 'reverse' ? 'fact_order' : 'fact_membership')
  })
}
const facts = [{ id: 'condition', text: 'Condición y precio $100.', variants: [{ id: 'brief', text: 'Precio $100; condición obligatoria.' }] }, { id: 'next', text: '¿Qué día preferís?' }]
const policy = replyContract('continuation', true, false, facts)
await check('server mode retains all framing and variant fences', () => {
  for (const [patch, reason] of [
    [{ opening: 'Soy Otra' }, 'identity_in_frame'],
    [{ opening: 'Hola, te ayudo.' }, 'identity_in_frame'],
    [{ opening: 'Cuesta $1' }, 'unverified_value'],
    [{ opening: 'https://invalid.example' }, 'unverified_value'],
    [{ opening: 'Reservado' }, 'unverified_action'],
    [{ opening: 'Corte' }, 'catalog_in_frame'],
    [{ opening: '\t' }, 'frame_bounds'],
    [{ closing: '¿Confirmamos?' }, 'continuation_conflict'],
    [{ variantChoices: [{ factId: 'foreign', variantId: 'brief' }] }, 'fact_membership'],
    [{ variantChoices: [{ factId: 'condition', variantId: 'foreign' }] }, 'fact_membership'],
    [{ variantChoices: [{ factId: 'condition', variantId: 'brief' }, { factId: 'condition', variantId: 'brief' }] }, 'invalid_shape']
  ] as const) assert.equal(validateReplyDraft({ ...serverDraft, ...patch }, facts, policy, ['Corte']).validation.reason, reason)
  assert.equal(validateReplyDraft(serverDraft, facts, { ...policy, neutral: true }, []).validation.reason, 'neutral_frame')
  assert.equal(validateReplyDraft({ ...serverDraft, factIds: undefined }, facts, policy, []).validation.reason, 'invalid_shape')
  const selected = validateReplyDraft({ ...serverDraft, variantChoices: [{ factId: 'condition', variantId: 'brief' }] }, facts, policy, [])
  assert.equal(selected.text, 'Claro, te ayudo.\nPrecio $100; condición obligatoria.\n¿Qué día preferís?')
  assert.equal(selected.validation.providedCount, 0)
})
const requests: Record<string, any>[] = []
const fakeFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)); requests.push(body)
  const input = JSON.parse(body.input)
  const output = body.text.format.name === 'grounded_qa_reply' ? serverDraft :
    { ...base, intent: input.message.includes('Corte mañana') ? 'booking' : input.message.includes('servicios') ? 'information' : 'other',
      ...(input.message.includes('Corte mañana') ? { serviceId: 'cut', serviceEvidence: 'Corte' } : {}),
      firstReply: serverDraft }
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }), { status: 200 })
}
const interpretation = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })
const composition = createOpenAiResponseProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })
await check('both structured providers request explicit server material', async () => {
  const state = initialDialogueState(context.businessId)
  const first = await interpretation({ message: 'hola', state, services: [], firstReplyFacts: facts, replyContract: policy }, new AbortController().signal) as { firstReply: unknown }
  const second = await composition({ message: 'hola', state, intent: 'other', facts, replyContract: policy }, new AbortController().signal)
  assert.equal(validateReplyDraft(first.firstReply, facts, policy, []).validation.status, 'accepted')
  assert.equal(validateReplyDraft(second, facts, policy, []).validation.status, 'accepted')
  assert.deepEqual(REPLY_DRAFT_SCHEMA.properties.factIds, { type: 'null' })
  for (const request of requests) {
    const schema = request.text.format.name === 'grounded_qa_reply' ? request.text.format.schema : request.text.format.schema.properties.firstReply
    assert.deepEqual(schema.properties.factIds, { type: 'null' }); assert.ok(schema.required.includes('factIds'))
    assert.equal(schema.additionalProperties, false); assert.equal(request.text.format.strict, true)
    assert.match(request.instructions, /factIds:null/); assert.equal(request.store, false)
    assert.deepEqual(JSON.parse(request.input)[request.text.format.name === 'grounded_qa_reply' ? 'facts' : 'firstReplyFacts'], facts)
  }
})
for (const count of [9, 3]) await check('actual first provider assembles ' + (count + 1) + ' facts in one call', async () => {
  let agenda = 0
  const port: DialoguePort = { catalog: async () => Array.from({ length: count }, (_, index) => ({
    id: 'service' + index, name: 'Servicio ' + index, price: 100 + index, durationMinutes: 30, requiresConsultation: false
  })), availability: async () => { agenda++; throw new Error('agenda forbidden') } }
  const before = requests.length
  const provider = Object.assign(interpretation, { respond: composition }) as AiInterpretationProvider
  const response = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'que servicios y precios tienen?', port, provider)
  assert.equal(requests.length - before, 1); assert.equal(response.interpretation.aiCalls, 1)
  assert.equal(response.interpretation.replyRoute, 'first_call')
  assert.equal(response.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.equal(response.interpretation.replyValidation?.firstCall.factCount, count + 1)
  assert.equal(response.interpretation.replyValidation?.firstCall.providedCount, 0)
  const inputFacts = JSON.parse(requests.at(-1)!.input).firstReplyFacts as { text: string }[]
  assert.equal(response.reply, ['Claro, te ayudo.', ...inputFacts.map(fact => fact.text)].join('\n'))
  assert.equal(agenda, 0); assert.equal(response.proposal, null); assert.equal(response.bookingCommand, undefined)
  assert.equal(response.state.serviceId, null)
})
await check('prepared acquisition reuses framing but inserts current server continuation', async () => {
  let calls = 0
  const port: DialoguePort = { catalog: async () => [], availability: async () => { throw new Error('agenda forbidden') },
    identity: async () => ({ businessId: context.businessId, assistantName: 'Ada', businessName: 'Local', treatment: 'vos' }) }
  const provider = Object.assign(async () => {
    calls++; return { ...base, intent: 'booking', turnPlan: { version: 1, operations: [
      { kind: 'date', expression: 'mañana', value: '2026-10-04', evidence: 'mañana', confidence: 1 }
    ] }, firstReply: serverDraft }
  }, { respond: async () => { calls++; throw new Error('style call forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'quiero un turno mañana', port, provider)
  assert.equal(calls, 1); assert.equal(result.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.match(result.reply, /Claro, te ayudo/); assert.match(result.reply, /¿Qué servicio necesitás/)
  assert.doesNotMatch(result.reply, /¿En qué te puedo ayudar con el local/)
  assert.equal(result.state.date, '2026-10-04'); assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
})
await check('new agenda facts still use the actual response provider and complete material', async () => {
  const port: DialoguePort = { catalog: async () => [{ id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false }],
    availability: async () => ({ professionals: [{ id: 'pro', name: 'Ada', priority: 0 }], slots: [
      { date: '2026-10-04', time: '15:00', startAt: '2026-10-04T15:00:00Z', professionalId: 'pro', professionalName: 'Ada', band: 'AFTERNOON', occupiedMinutes: 30 }
    ] }) }
  const before = requests.length
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Corte mañana', port,
    Object.assign(interpretation, { respond: composition }))
  assert.equal(requests.length - before, 2); assert.equal(result.interpretation.aiCalls, 2)
  assert.equal(result.interpretation.replyRoute, 'second_call')
  assert.equal(result.interpretation.replyValidation?.secondCall.status, 'accepted')
  assert.equal(result.interpretation.replyValidation?.secondCall.providedCount, 0)
  const current = JSON.parse(requests.at(-1)!.input).facts as { text: string }[]
  assert.equal(result.reply, ['Claro, te ayudo.', ...current.map(fact => fact.text)].join('\n'))
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
})
console.log('server facts: ' + passed + ' PASS / ' + failed + ' FAIL (offline only)')
if (failed) process.exitCode = 1
