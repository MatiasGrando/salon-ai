import assert from 'node:assert/strict'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { replyContract, validateReplyDraft, REPLY_CONTRACT_INSTRUCTIONS } from '../src/conversational-bot/reply-contract.js'

const context = { businessId: 'writing', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const state = initialDialogueState(context.businessId)
const base = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null }
const facts = [{ id: 'next', text: '¿En qué te puedo ayudar con el local?' }]
const contract = replyContract('social', true, false, facts)
const requests: { instructions: string; input: string; store: boolean }[] = []
const fetchImpl: typeof fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(base) }] }] }), { status: 200 })
}
await createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl })({ message: 'hola, cómo están, quería un turno', state, services: [], firstReplyFacts: facts, replyContract: contract }, new AbortController().signal)
await createOpenAiResponseProvider({ apiKey: 'fake-only', fetchImpl })({ message: 'hola', state, intent: 'other', facts, replyContract: contract }, new AbortController().signal)
// A typed greeting is not free identity text and must not discard a safe social response.
const greetingDraft = { salutation: 'greeting', opening: 'Bien, gracias por preguntar.', factIds: ['next'], closing: null }
assert.equal(validateReplyDraft(greetingDraft, facts, contract, []).validation.status, 'accepted')
assert.equal(validateReplyDraft(greetingDraft, facts, contract, []).text, 'Bien, gracias por preguntar.\n¿En qué te puedo ayudar con el local?')
assert.match(validateReplyDraft(greetingDraft, facts, replyContract('social', true, true, facts), []).text!, /^¡Hola!\nBien, gracias/)
for (const salutation of ['Soy Otra', true, {}, undefined]) assert.equal(validateReplyDraft({ ...greetingDraft, salutation }, facts, contract, []).validation.reason, 'invalid_shape')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Soy Otra' }, facts, contract, []).validation.reason, 'identity_in_frame')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Soy Otra' }, facts, replyContract('social', false, false, facts), []).validation.reason, 'identity_in_frame')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Reservado' }, facts, contract, []).validation.reason, 'unverified_action')
for (const request of requests) {
  assert.ok(request.instructions.includes(REPLY_CONTRACT_INSTRUCTIONS))
  assert.match(request.instructions, /Presentación del servidor:/)
  assert.match(request.instructions, /Respuesta social y reconocimiento:/)
  assert.match(request.instructions, /Cuerpo material:/)
  assert.match(request.instructions, /Continuación pertinente:/)
  assert.deepEqual(JSON.parse(request.input).replyContract, contract)
  assert.equal(request.store, false)
}
assert.match(requests[0]!.instructions, /Primera llamada, cualquier intención:/)
assert.match(requests[0]!.instructions, /booking con operations vacío/)
assert.match(requests[0]!.instructions, /factIds originales/)
assert.match(requests[0]!.instructions, /no es necesario predecir la nueva pregunta/)

// These fixtures verify delivery and safety, not the real model's language quality.
let agenda = 0, catalogReads = 0
const port: DialoguePort = {
  catalog: async () => { catalogReads++; return [{ id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false }] },
  identity: async () => ({ businessId: context.businessId, assistantName: 'Ada', businessName: 'Local', treatment: 'vos' }),
  availability: async () => { agenda++; throw new Error('agenda forbidden for acquisition') }
}
for (const shape of ['empty', 'null', 'absent']) for (const introduced of [false, true]) {
  let calls = 0
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++
    assert.equal(input.replyContract?.introduction, introduced ? 'server_complete' : 'server_pending')
    return { ...base, ...(shape === 'empty' ? { turnPlan: { version: 1, operations: [] } } : shape === 'null' ? { turnPlan: null } : {}),
      firstReply: { salutation: 'greeting', opening: 'Bien, gracias por preguntar. Te ayudo a buscar un turno.', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  }, { respond: async () => { calls++; throw new Error('a style call is forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, { ...state, introduced }, 'hola, cómo están, quería un turno', port, provider)
  assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1)
  assert.match(result.reply, /Bien, gracias por preguntar/); assert.match(result.reply, /¿Qué servicio necesitás\?/)
  assert.equal(result.reply.match(/Soy Ada, de Local/g)?.length ?? 0, introduced ? 0 : 1)
  assert.equal(result.reply.match(/hol+a/gi)?.length, 1)
  assert.doesNotMatch(result.reply, /No pude identificar|En qué.*ayudar/)
  assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.state.sandboxReservation, undefined)
}
assert.equal(agenda, 0); assert.equal(catalogReads, 6)
const original = { opening: 'Bien, gracias por preguntar.', closing: null, factIds: ['data', 'next'] }
const verified = [{ id: 'data', text: 'Dato verificado.' }, { id: 'next', text: '¿Qué día?' }]
const guard = replyContract('continuation', true, false, verified)
for (const [draft, reason] of [
  [{ ...original, opening: 'Soy Otra' }, 'identity_in_frame'],
  [{ ...original, opening: 'Hola, bien, gracias.' }, 'identity_in_frame'],
  [{ ...original, opening: 'Reservado' }, 'unverified_action'],
  [{ ...original, opening: 'Cuesta $100' }, 'unverified_value'],
  [{ ...original, opening: 'Corte' }, 'catalog_in_frame'],
  [{ ...original, factIds: ['next', 'data'] }, 'fact_order'],
  [{ ...original, factIds: ['foreign', 'next'] }, 'fact_membership'],
  [{ ...original, closing: '¿Confirmamos?' }, 'continuation_conflict']
] as const) assert.equal(validateReplyDraft(draft, verified, guard, ['Corte']).validation.reason, reason)
assert.equal(validateReplyDraft(original, verified, guard, ['Corte']).validation.status, 'accepted')
for (const scenario of ['pure-social', 'lateral-information', 'unsafe-identity']) {
  let calls = 0
  const introduced = scenario === 'lateral-information'
  const previous = introduced ? { ...state, introduced: true, serviceId: 'cut', date: '2026-10-04', customerName: 'Ana', pending: 'date' as const } : state
  const message = scenario === 'lateral-information' ? 'hola, cómo están, qué horarios tienen' : 'hola, cómo están'
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++
    return { ...base, intent: scenario === 'lateral-information' ? 'information' : 'other',
      turnPlan: { version: 1, operations: scenario === 'lateral-information' ? [
        { kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, evidence: 'horarios', confidence: 1 }
      ] : [] }, firstReply: { salutation: 'greeting', opening: scenario === 'unsafe-identity' ? 'Soy Otra, bien, gracias.' : 'Bien, gracias por preguntar.',
        closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  }, { respond: async () => { calls++; throw new Error('style call forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, previous, message, { ...port, information: async () => ({
    businessId: context.businessId, name: 'Local', address: null, area: null, mapsUrl: null, hours: 'Lunes: 09:00 a 18:00', website: null,
    bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null
  }) }, provider)
  assert.equal(calls, 1); assert.equal(result.reply.match(/hol+a/gi)?.length, 1)
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
  if (scenario === 'unsafe-identity') {
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'identity_in_frame')
    assert.doesNotMatch(result.reply, /Otra|bien, gracias/)
  } else assert.match(result.reply, /Bien, gracias por preguntar/)
  if (introduced) {
    assert.doesNotMatch(result.reply, /Soy Ada/); assert.match(result.reply, /Lunes: 09:00 a 18:00/)
    assert.equal(result.state.serviceId, previous.serviceId); assert.equal(result.state.date, previous.date)
    assert.equal(result.state.customerName, previous.customerName)
  }
}
assert.equal(agenda, 0)
console.log('first-call writing guide: PASS (contract and offline delivery; model quality not evaluated)')
