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
    const { informationFocus, ...bookingState } = result.response.state
    assert.deepEqual(bookingState, initialDialogueState('qa'))
    if (message.includes('sale')) assert.equal(informationFocus?.serviceId, 'service')
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
const busyGreeting = await run('hola', { state: busyState })
assert.equal(busyGreeting.availabilityCalls, 0, 'a social turn never refreshes availability')
assert.equal(busyGreeting.calls, 1)
assert.deepEqual(busyGreeting.response.state, busyState)
const missing = await run('donde estan?', { candidate: { intent: 'information' }, information: async () => ({ ...facts, address: null }) })
assert.equal(missing.calls, 1)
assert.ok(missing.response.reply.includes('Todavía no tengo esa información cargada 😊'))
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
// E1: intake drafts predict a motor outcome; they never supply business facts.
const intakeDraft = (pending: 'service' | 'date', serviceId: string | null = null, candidateIds: string[] = []) => ({ opening: 'Dale.', closing: null, pending, serviceId, candidateIds })
const intake = await run('quiero un turno', { candidate: { intent: 'booking', intakeReply: intakeDraft('service') } })
assert.equal(intake.calls, 1)
assert.equal(intake.availabilityCalls, 0)
assert.equal(intake.response.interpretation.copyMode, 'ai')
assert.equal(intake.response.interpretation.replyRoute, 'first_call')
assert.match(intake.response.reply, /Qué servicio/)
assert.doesNotMatch(intake.response.reply, /27.?000/)
const selectedIntake = await run('Corte hombre', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre', intakeReply: intakeDraft('date', 'service') } })
assert.equal(selectedIntake.calls, 1)
assert.equal(selectedIntake.availabilityCalls, 0)
assert.equal(selectedIntake.response.state.serviceId, 'service')
assert.equal(selectedIntake.response.state.pending, 'date')
assert.match(selectedIntake.response.reply, /día/)
const ambiguousIntake = await run('quiero un corte con Ramiro mañana', { extraService: 'Corte mujer', candidate: { intent: 'booking', serviceEvidence: 'corte', serviceCandidateIds: ['service', 'service2'], serviceConfidence: 'uncertain', professionalMention: 'Ramiro', intakeReply: intakeDraft('service', null, ['service', 'service2']) } })
assert.equal(ambiguousIntake.calls, 1)
assert.equal(ambiguousIntake.availabilityCalls, 0)
assert.equal(ambiguousIntake.response.state.date, '2026-09-30')
assert.equal(ambiguousIntake.response.state.professionalNameHint, 'ramiro')
assert.match(ambiguousIntake.response.reply, /Corte hombre/)
assert.match(ambiguousIntake.response.reply, /Corte mujer/)
for (const message of ['mañana', 'con Ramiro']) {
  const early = await run(message, { candidate: { intent: 'booking', intakeReply: intakeDraft('service') } })
  assert.equal(early.calls, 1)
  assert.equal(early.availabilityCalls, 0)
  assert.equal(early.response.interpretation.replyRoute, 'first_call')
  if (message === 'mañana') assert.equal(early.response.state.date, '2026-09-30')
  else assert.equal(early.response.state.professionalNameHint, 'ramiro')
}
const hintFirst = await run('con Ramiro', { candidate: { intent: 'booking', intakeReply: intakeDraft('service') } })
const serviceAfterHint = await run('Corte hombre', { state: hintFirst.response.state, candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre', intakeReply: intakeDraft('date', 'service') } })
assert.equal(serviceAfterHint.calls, 1)
assert.equal(serviceAfterHint.response.state.professionalNameHint, 'ramiro')
const unknownService = await run('quiero un masaje', { candidate: { intent: 'booking', serviceEvidence: 'masaje', intakeReply: intakeDraft('service') } })
assert.equal(unknownService.calls, 1)
assert.equal(unknownService.response.state.serviceId, null)
for (const intakeReply of [intakeDraft('date', 'foreign'), intakeDraft('service', null, ['service']), { ...intakeDraft('date', 'service'), opening: 'Cuesta $ 1' }]) {
  const invalidIntake = await run('Corte hombre', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre', intakeReply } })
  assert.notEqual(invalidIntake.response.interpretation.replyRoute, 'first_call')
  assert.doesNotMatch(invalidIntake.response.reply, /\$ 1/)
}
const omittedAlternative = await run('un corte', { extraService: 'Corte mujer', candidate: { intent: 'booking', serviceEvidence: 'corte', serviceCandidateIds: ['service', 'service2'], intakeReply: intakeDraft('service', null, ['service']) } })
assert.notEqual(omittedAlternative.response.interpretation.replyRoute, 'first_call')
assert.match(omittedAlternative.response.reply, /Corte mujer/)
const realAvailability = await run('Corte hombre mañana', { candidate: { intent: 'booking', serviceId: 'service', serviceEvidence: 'Corte hombre', intakeReply: intakeDraft('date', 'service') } })
assert.ok(realAvailability.availabilityCalls > 0)
assert.equal(realAvailability.calls, 2)
const arithmetic = await run('decime cuanto es 2+2', { state: resetState })
assert.equal(arithmetic.calls, 1)
assert.equal(arithmetic.availabilityCalls, 0)
assert.deepEqual(arithmetic.response.state, resetState)
assert.match(arithmetic.response.reply, /2 \+ 2 es 4/)
assert.match(arithmetic.response.reply, /día/)
const fakeArithmetic = await run('hola', { draft: () => ({ opening: '2+2 es 4', factIds: [], closing: null }) })
assert.notEqual(fakeArithmetic.response.interpretation.replyRoute, 'first_call', 'numeric freedom is not granted to social framing')
const poem = await run('escribime un poema largo', { state: resetState })
assert.equal(poem.calls, 1)
assert.equal(poem.availabilityCalls, 0)
assert.deepEqual(poem.response.state, resetState)
assert.match(poem.response.reply, /día/)
for (const state of [busyState, proposalState, { ...proposalState, pending: 'time' as const }]) {
  const social = await run('hola como estas', { state })
  assert.equal(social.calls, 1)
  assert.equal(social.availabilityCalls, 0)
  assert.equal(social.response.proposal, null)
  assert.deepEqual(social.response.state, state)
  assert.doesNotMatch(social.response.reply, /disponibles/)
  for (const message of ['donde estan?', 'horario de atencion', 'que servicios tienen?', 'cuanto sale Corte hombre']) {
    const info = await run(message, { state, candidate: { intent: 'information' } })
    assert.equal(info.calls, 1)
    assert.equal(info.availabilityCalls, 0)
    assert.equal(info.response.proposal, null)
    assert.deepEqual({ ...info.response.state, informationFocus: undefined }, { ...state, informationFocus: undefined })
    if (message.includes('sale')) assert.equal(info.response.state.informationFocus?.serviceId, 'service')
  }
}
for (const message of ['cuanto es 3*4', 'cuanto es 8/2', 'cuanto es 7-2']) {
  const result = await run(message, { state: resetState })
  assert.equal(result.calls, 1)
  assert.equal(result.availabilityCalls, 0)
  assert.deepEqual(result.response.state, resetState)
  assert.ok(result.firstInput.firstReplyFacts?.some(fact => fact.id === 'calculation'))
}
for (const message of ['cuanto es 5/0', 'cuanto es 1/3', 'cuanto es 9999999+1', 'cuanto es 2+2;process.exit()', 'cuanto sale Corte hombre y cuanto es 2+2']) {
  const result = await run(message, { candidate: { intent: message.includes('sale') ? 'information' : 'other' } })
  assert.ok(!result.firstInput.firstReplyFacts?.some(fact => fact.id === 'calculation'))
  assert.doesNotMatch(result.response.reply, /NaN|Infinity|process\.exit/)
}
assert.equal(request!.text.format.schema.properties.intakeReply.additionalProperties, false)
assert.deepEqual(request!.text.format.schema.properties.intakeReply.required, ['opening', 'closing', 'pending', 'serviceId', 'candidateIds'])
assert.ok(request!.instructions.includes('intakeReplyAllowed'))
console.log('conversational-bot-single-call-test: PASS')

