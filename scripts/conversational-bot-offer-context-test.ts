import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiResponseProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'

const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T15:00:00Z') }
const service = { id: 'cut', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 27000 }
let availabilityCalls = 0, informationCalls = 0
const port: DialoguePort = {
  catalog: async () => [service],
  availability: async (_, date) => { availabilityCalls++; return {
    professionals: [{ id: 'ramiro', name: 'Ramiro', priority: 0 }],
    slots: [{ date, time: '17:00', startAt: date + 'T20:00:00Z', professionalId: 'ramiro', professionalName: 'Ramiro', band: 'AFTERNOON', occupiedMinutes: 0 }]
  } },
  information: async () => { informationCalls++; return { businessId: 'qa', name: 'Glow', address: 'Monroe 5252', area: 'Villa Urquiza', mapsUrl: null,
    website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Horario comercial semanal' } }
}
const empty = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false }
const copy: AiResponseProvider = async ({ facts }) => ({ opening: null, factIds: facts.map(f => f.id), closing: null })
const offer = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero corte hombre mañana con Ramiro', port,
  async () => ({ ...empty, intent: 'booking', serviceId: 'cut', serviceEvidence: 'corte hombre', professionalMention: 'Ramiro' }), { responseProvider: copy })
assert.equal(offer.state.pending, 'time')
assert.equal(offer.state.dialogueContext?.presentedOffer?.date, '2026-10-02', 'delivered offer is compact conversational evidence')
assert.match(offer.state.dialogueContext?.lastQuestion ?? '', /elegís/)
assert.ok(JSON.stringify(offer.state).length <= 4096)
let captured: AiInterpretationInput | undefined
const address = await respondWithAiInterpreter(context, offer.state, 'cual es la direccion', port,
  async input => { captured = input; return { ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['ADDRESS'] } } }, { responseProvider: copy })
assert.equal(captured?.state.dialogueContext?.presentedOffer?.date, '2026-10-02')
assert.deepEqual(address.state.dialogueContext?.presentedOffer, offer.state.dialogueContext?.presentedOffer, 'interleaved address preserves the offer')
assert.equal(address.state.dialogueContext?.lastQuestion, '¿Qué horario de los disponibles elegís?')
const today = await respondWithAiInterpreter(context, address.state, 'mejor hoy', port,
  async () => ({ ...empty, intent: 'booking', informationTarget: null }), { responseProvider: copy })
assert.equal(today.state.dialogueContext?.presentedOffer?.date, '2026-10-01', 'correction replaces offer evidence')
const beforeReference = availabilityCalls
const reference = await respondWithAiInterpreter(context, today.state, 'estos son los horarios dehoy?', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'presented_offer', actions: [] } }), { responseProvider: copy })
assert.equal(reference.state.date, '2026-10-01')
assert.match(reference.reply, /que te mostré.*jueves 01\/10/s)
assert.doesNotMatch(reference.reply, /semanal|disponibles para/)
assert.equal(availabilityCalls, beforeReference, 'reference does not refresh agenda')
const saturday = await respondWithAiInterpreter(context, offer.state, 'son los del sábado?', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'presented_offer', actions: [] } }), { responseProvider: copy })
assert.equal(saturday.state.date, '2026-10-02', 'weekday inside a reference is not a date correction')
assert.match(saturday.reply, /viernes 02\/10/)
const weekly = await respondWithAiInterpreter(context, offer.state, 'cuándo abren?', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['HOURS'] } }), { responseProvider: copy })
assert.match(weekly.reply, /comercial semanal/)
assert.deepEqual(weekly.state.dialogueContext?.presentedOffer, offer.state.dialogueContext?.presentedOffer)
const semantic = await respondWithAiInterpreter(context, offer.state, '¿Y eso que me acabás de mostrar?', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'presented_offer', actions: [] } }), { responseProvider: copy })
assert.match(semantic.reply, /viernes 02\/10/, 'contextual action works without lexical routing')
assert.equal(availabilityCalls, beforeReference)
const legacy = { ...offer.state }; delete legacy.dialogueContext
assert.deepEqual(parseDialogueState(legacy, 'qa'), legacy, 'schema v1 without context remains readable')
const missing = await respondWithAiInterpreter(context, legacy, 'estos?', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'presented_offer', actions: [] } }), { responseProvider: copy })
assert.match(missing.reply, /No tengo.*oferta|No tengo.*horarios.*mostrados/i)
assert.doesNotMatch(missing.reply, /viernes 02\/10/)
for (const change of [{ businessId: 'foreign' }, { date: '2026-10-03' }, { serviceId: 'alien' }, { professionalId: 'alien' }, { extra: true }]) {
  assert.throws(() => parseDialogueState({ ...offer.state, dialogueContext: { ...offer.state.dialogueContext,
    presentedOffer: { ...offer.state.dialogueContext!.presentedOffer, ...change } } }, 'qa'), /context|offer/)
}
let request: any
const api = createOpenAiInterpretationProvider({ apiKey: 'fake-offline', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...empty, informationTarget: { kind: 'presented_offer', actions: [] } }) }] }] }), { status: 200 })
} })
await api({ message: 'estos?', state: offer.state, services: [service] }, new AbortController().signal)
const input = JSON.parse(request.input)
assert.deepEqual(input.dialogueContext, offer.state.dialogueContext)
assert.ok(request.text.format.schema.required.includes('informationTarget'))
assert.match(request.instructions, /presented_offer/)
assert.equal(input.dialogueContext.presentedOffer.date, '2026-10-02')
assert.ok(informationCalls > 0)
console.log('PASS conversational offer context: referential routing, date safety, snapshot validation and offline provider contract')

// Delivery continuity is an obligatory server fact, not optional model framing.
assert.match(address.reply, /¿Qué horario de los disponibles elegís\?$/, 'address resumes the active offer after AI composition')
assert.match(weekly.reply, /¿Qué horario de los disponibles elegís\?$/, 'commercial hours resume the booking question')
const isolated = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'cual es la direccion', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['ADDRESS'] } }), { responseProvider: copy })
assert.doesNotMatch(isolated.reply, /¿Qué servicio|¿Qué horario/, 'standalone information does not force a booking')
const invalidCopy = await respondWithAiInterpreter(context, offer.state, 'cual es la direccion', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['ADDRESS'] } }),
  { responseProvider: async () => ({ opening: 'Hola', factIds: [], closing: null }) })
assert.match(invalidCopy.reply, /¿Qué horario de los disponibles elegís\?$/)
const providerFailure = await respondWithAiInterpreter(context, offer.state, 'cual es la direccion', port,
  async () => { throw new Error('offline-provider-failure') }, { responseProvider: copy })
assert.match(providerFailure.reply, /¿Qué horario de los disponibles elegís\?$/)
const failedReference = await respondWithAiInterpreter(context, offer.state, 'estos son los horarios dehoy?', port,
  async () => { throw new Error('offline-provider-failure') }, { responseProvider: copy })
assert.doesNotMatch(failedReference.reply, /comercial semanal/, 'ambiguous hours reference on AI failure must not choose weekly hours')
assert.match(failedReference.reply, /horario.*local|oferta|mostré/i)
const atTime = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero corte hombre mañana con Ramiro a las 17:00', port,
  async () => ({ ...empty, intent: 'booking', serviceId: 'cut', serviceEvidence: 'corte hombre', professionalMention: 'Ramiro' }), { responseProvider: copy })
assert.equal(atTime.state.pending, 'name', 'professional selection preserves the current time preference')
assert.equal(atTime.state.slot?.time, '17:00')
assert.equal(atTime.state.dialogueContext?.lastQuestion, '¿A nombre de quién sería el turno?')
console.log('PASS conversation continuity: information interleaving, provider/copy fallback and time preference')


const ambiguousDate = await respondWithAiInterpreter(context, offer.state, 'corte el sábado', {
  ...port, catalog: async () => [service, { ...service, id: 'woman', name: 'Corte mujer' }]
}, async () => ({ ...empty, intent: 'booking', serviceEvidence: 'corte', serviceCandidateIds: ['cut', 'woman'], serviceCorrection: false }), { responseProvider: copy })
assert.doesNotThrow(() => parseDialogueState(ambiguousDate.state, 'qa'), 'an ambiguous service with a new date cannot leave an old offer bound to the previous date')
assert.equal(ambiguousDate.state.date, '2026-10-03')
assert.equal(ambiguousDate.state.slot, null)
assert.equal(ambiguousDate.state.dialogueContext?.presentedOffer ?? null, null)
console.log('PASS ambiguous correction invalidates date-dependent offer evidence')


const named = await respondWithAiInterpreter(context, atTime.state, 'soy Lucia', port,
  async () => ({ ...empty, intent: 'booking' }), { responseProvider: copy })
assert.equal(named.state.pending, 'proposal')
const beforeProposalRead = availabilityCalls
const proposalRead = await respondWithAiInterpreter(context, named.state, 'que servicios hay', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['SERVICES'] } }), { responseProvider: copy })
assert.doesNotThrow(() => parseDialogueState(proposalRead.state, 'qa'), 'the proposal reminder is a statement, not a lastQuestion')
assert.equal(proposalRead.state.pending, 'proposal')
assert.equal(proposalRead.state.dialogueContext?.lastQuestion, null)
assert.equal(proposalRead.proposal, null)
assert.equal(availabilityCalls, beforeProposalRead, 'a read from pending proposal does not consult availability or publish a new proposal')
console.log('PASS proposal information read preserves a valid snapshot')


const bookingIntro = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero un turno', port,
  async () => ({ ...empty, intent: 'booking' }), { responseProvider: copy })
const introAddress = await respondWithAiInterpreter(context, bookingIntro.state, 'cual es la direccion', port,
  async () => ({ ...empty, intent: 'information', informationTarget: { kind: 'business', actions: ['ADDRESS'] } }), { responseProvider: copy })
assert.match(introAddress.reply, /¿Qué servicio necesitás\?$/, 'an explicit booking intent remains active before any entity was supplied')
assert.equal(bookingIntro.state.dialogueContext?.lastQuestion, '¿Qué servicio necesitás?')
console.log('PASS booking intent before entities preserves required continuation')


const unclearTarget = await respondWithAiInterpreter(context, offer.state, 'estos horarios?', port,
  async () => ({ ...empty, intent: 'information' }), { responseProvider: copy })
assert.doesNotMatch(unclearTarget.reply, /comercial semanal/, 'a valid legacy AI candidate without an information target cannot pick commercial hours on a conflicting offer')
assert.match(unclearTarget.reply, /horario.*atención.*local.*horarios.*mostré/i)
assert.deepEqual(unclearTarget.state, offer.state)
console.log('PASS missing semantic target clarifies conflicting hours reference')
