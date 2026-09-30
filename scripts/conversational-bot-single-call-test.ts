import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'

const empty = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false }
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-29T15:00:00Z') }
const facts: BusinessFacts = { businessId: 'qa', name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Martes: 09:00 a 18:00\nExcepciones: 30/09 cerrado' }
async function run(message: string, options: { state?: DialogueState; candidate?: object; draft?: (input: AiInterpretationInput) => unknown; service?: string; extraService?: string; information?: () => Promise<BusinessFacts> } = {}) {
  let calls = 0, informationCalls = 0, availabilityCalls = 0
  let firstInput: AiInterpretationInput | undefined
  const port: DialoguePort = {
    catalog: async () => [{ id: 'service', name: options.service ?? 'Corte hombre', price: 27000, priceMode: 'STARTING_AT', durationMinutes: 30, requiresConsultation: false }, ...(options.extraService ? [{ id: 'service2', name: options.extraService, price: 32000, priceMode: 'FIXED' as const, durationMinutes: 45, requiresConsultation: false }] : [])],
    information: async () => { informationCalls++; return options.information ? options.information() : facts },
    availability: async () => { availabilityCalls++; return { professionals: [{ id: 'professional', name: 'QA', priority: 0 }], slots: [{ date: '2026-09-30', time: '15:00', startAt: '2026-09-30T18:00:00Z', professionalId: 'professional', professionalName: 'QA', band: 'AFTERNOON', occupiedMinutes: 30 }] } }
  }
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++; firstInput = input
    return { ...empty, ...options.candidate, firstReply: options.draft ? options.draft(input) : { opening: '¡Hola! Te ayudo.', factIds: input.firstReplyFacts?.map(f => f.id) ?? [], closing: null } }
  }, { respond: async (input: { facts: readonly { id: string; text: string }[] }) => {
    calls++; return { opening: 'Dale.', factIds: input.facts.map(f => f.id), closing: null }
  } }) as AiInterpretationProvider
  const response = await respondWithAiInterpreter(context, options.state ?? initialDialogueState('qa'), message, port, provider)
  return { response, calls, informationCalls, availabilityCalls, firstInput: firstInput! }
}
const greeting = await run('hola')
assert.equal(greeting.calls, 1, 'social response should use the interpretation call')
assert.equal(greeting.informationCalls, 0, 'greetings should not eagerly query public facts')
assert.equal(greeting.response.reply, '¡Hola! Te ayudo.')
assert.equal(greeting.response.interpretation.aiCalls, 1)
assert.equal(greeting.response.interpretation.replyRoute, 'first_call')
assert.equal(greeting.response.interpretation.responseMs, 0)
for (const service of ['Corte hombre', 'Sesión coaching', 'Cambio de aceite']) {
  for (const message of ['donde estan?', 'que servicios tienen?', 'horario de atencion', 'cuanto sale ' + service]) {
    const result = await run(message, { service, candidate: { intent: 'information' } })
    assert.equal(result.calls, 1, message)
    assert.equal(result.availabilityCalls, 0)
    assert.ok(result.firstInput.firstReplyFacts?.length)
    assert.equal(result.response.interpretation.copyMode, 'ai')
    assert.equal(result.response.proposal, null)
    assert.deepEqual(result.response.state, initialDialogueState('qa'))
    if (message.includes('estan')) { assert.equal(result.informationCalls, 1); assert.ok(result.response.reply.includes('Calle 123')) }
    if (message.includes('horario')) { assert.equal(result.informationCalls, 1); assert.ok(result.response.reply.includes('30/09 cerrado')) }
    if (message.includes('sale')) assert.ok(result.response.reply.includes('Desde'))
  }
}
for (const [service, extraService] of [['Corte hombre', 'Corte mujer'], ['Sesión coaching', 'Sesión grupal'], ['Cambio de aceite', 'Revisión frenos']] as const) {
  const combined = await run('que servicios y precios tienen?', { service, extraService, candidate: { intent: 'information' } })
  assert.equal(combined.calls, 1)
  assert.equal(combined.firstInput.firstReplyFacts?.length, 2, 'only priced catalog entries are required facts')
  assert.equal(combined.response.interpretation.decision.candidateCount, 0, 'listing services is not service-selection ambiguity')
  assert.equal(combined.response.interpretation.replyRoute, 'first_call')
  assert.deepEqual(combined.response.state, initialDialogueState('qa'))
  assert.ok(!combined.response.reply.includes('De qué servicio'))
}

const dynamic = await run('quiero Corte hombre mañana', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre' } })
assert.equal(dynamic.calls, 2)
assert.ok(dynamic.availabilityCalls > 0)
assert.deepEqual(dynamic.firstInput.firstReplyFacts, [], 'a pre-interpretation social option carries no dynamic facts')
assert.equal(dynamic.response.interpretation.replyRoute, 'second_call')
const mixed = await run('donde estan y quiero Corte hombre mañana', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre' } })
assert.equal(mixed.calls, 2)
assert.equal(mixed.firstInput.firstReplyFacts, undefined)
assert.ok(mixed.response.reply.includes('Calle 123'))
assert.ok(mixed.availabilityCalls > 0)
for (const draft of [
  () => ({ opening: 'Hola', factIds: [], closing: null }),
  () => ({ opening: null, factIds: ['foreign'], closing: null }),
  (input: AiInterpretationInput) => ({ opening: 'Cuesta $ 1', factIds: input.firstReplyFacts?.map(f => f.id), closing: null }),
  () => 'Hola'
]) {
  const invalid = await run('donde estan?', { candidate: { intent: 'information' }, draft })
  assert.equal(invalid.calls, 2)
  assert.ok(invalid.response.reply.includes('Calle 123'))
  assert.ok(!invalid.response.reply.includes('$ 1'))
}
const invalidCandidate = await run('hola', { candidate: { serviceId: 'foreign', serviceEvidence: 'hola' } })
assert.equal(invalidCandidate.calls, 1, 'invalid candidate must not be masked by draft')
assert.equal(invalidCandidate.response.interpretation.reason, 'invalid_output')
assert.equal(invalidCandidate.response.interpretation.replyRoute, 'motor')
assert.equal((await run('Corte hombre', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre', serviceCorrection: true } })).calls, 2)
const resetState = { ...initialDialogueState('qa'), serviceId: 'service', pending: 'date' as const }
assert.equal((await run('reset', { state: resetState })).calls, 2)
const busyState = { ...initialDialogueState('qa'), serviceId: 'service', date: '2026-09-30', pending: 'professional' as const }
assert.equal((await run('hola', { state: busyState })).calls, 2)
const missing = await run('donde estan?', { candidate: { intent: 'information' }, information: async () => ({ ...facts, address: null }) })
assert.equal(missing.calls, 1)
assert.ok(missing.response.reply.includes('No tengo una dirección publicada.'))
const failedFacts = await run('donde estan?', { candidate: { intent: 'information' }, information: async () => { throw new Error('offline') } })
assert.equal(failedFacts.calls, 2)
assert.equal(failedFacts.informationCalls, 1, 'reuse failed preparation without duplicate query')
assert.ok(failedFacts.response.reply.includes('No pude consultar'))
const ambiguous = await run('quiero un corte', { extraService: 'Corte mujer', candidate: { intent: 'booking', serviceEvidence: 'corte', serviceCandidateIds: ['service', 'service2'], serviceConfidence: 'uncertain' } })
assert.equal(ambiguous.calls, 2)
assert.equal(ambiguous.response.state.serviceId, null)
assert.ok(ambiguous.response.reply.includes('Corte hombre') && ambiguous.response.reply.includes('Corte mujer'))
const duplicateFacts = await run('horario de atencion', { candidate: { intent: 'information' }, draft: input => ({ opening: null, factIds: input.firstReplyFacts?.map(() => '0'), closing: null }) })
assert.equal(duplicateFacts.calls, 2)
const pendingOperation = await run('quiero cancelar mi turno', { candidate: { intent: 'booking' } })
assert.equal(pendingOperation.calls, 2)
assert.equal(pendingOperation.firstInput.firstReplyFacts, undefined)
const foreignFacts = await run('donde estan?', { candidate: { intent: 'information' }, information: async () => ({ ...facts, businessId: 'foreign', address: 'FOREIGN SECRET' }) })
assert.equal(foreignFacts.calls, 2)
assert.ok(!foreignFacts.response.reply.includes('FOREIGN SECRET'))
assert.equal(foreignFacts.informationCalls, 1)
const proposalState: DialogueState = {
  ...initialDialogueState('qa'), serviceId: 'service', date: '2026-09-30', professional: { kind: 'specific', id: 'professional' },
  requestedTime: '15:00', slot: { date: '2026-09-30', time: '15:00', startAt: '2026-09-30T18:00:00Z', professionalId: 'professional', professionalName: 'QA', band: 'AFTERNOON', occupiedMinutes: 30 }, pending: 'name'
}
const proposal = await run('me llamo Ana', { state: proposalState, candidate: { intent: 'booking' } })
assert.equal(proposal.calls, 1)
assert.equal(proposal.response.interpretation.replyRoute, 'motor')
assert.equal(proposal.response.proposal?.kind, 'BOOKING_PROPOSAL')
assert.ok(proposal.response.reply.includes('Todavía no está reservado.'))

let legacyCalls = 0
const legacy = Object.assign(async () => { legacyCalls++; return empty }, { respond: async () => { legacyCalls++; return { opening: 'Hola', factIds: [], closing: null } } })
await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', { catalog: async () => [], availability: async () => { throw new Error('unexpected') } }, legacy)
assert.equal(legacyCalls, 2)
let request: Record<string, any> | undefined
const openai = createOpenAiInterpretationProvider({ apiKey: 'test-only', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...empty, firstReply: { opening: 'Hola', factIds: [], closing: null } }) }] }] }), { status: 200 })
} })
await openai(greeting.firstInput, new AbortController().signal)
assert.ok(request!.text.format.schema.required.includes('firstReply'))
assert.equal(request!.text.format.strict, true)
assert.equal(request!.text.format.schema.properties.firstReply.additionalProperties, false)
assert.deepEqual(JSON.parse(request!.input).firstReplyFacts, [])
await openai((await run('donde estan?', { candidate: { intent: 'information' } })).firstInput, new AbortController().signal)
assert.ok(JSON.parse(request!.input).firstReplyFacts[0].text.includes('Calle 123'))
assert.equal(request!.store, false)
assert.equal(request!.reasoning.effort, 'none')
// Candidate interpretation must represent a particular request, not the list being returned.
assert.match(request!.instructions, /serviceCandidateIds[^.]*servicio[^.]*mensaje actual/i)
assert.match(request!.instructions, /consulta general[^.]*catálogo[^.]*serviceCandidateIds[^.]*vacío/i)
assert.match(request!.instructions, /no se menciona[^.]*servicio particular[^.]*serviceId[^.]*serviceEvidence[^.]*null/i)
assert.match(request!.instructions, /serviceId[^.]*estado[^.]*sin[^.]*evidencia[^.]*mensaje actual/i)

const firstReplySchema = request!.text.format.schema.properties.firstReply
assert.deepEqual(firstReplySchema.type, ['object', 'null'])
assert.deepEqual(firstReplySchema.required, ['opening', 'factIds', 'closing'])
await assert.rejects(() => openai({ ...greeting.firstInput, firstReplyFacts: [{ id: '0', text: 'a'.repeat(1001) }] }, new AbortController().signal), /too large/)
console.log('conversational-bot-single-call-test: PASS')

