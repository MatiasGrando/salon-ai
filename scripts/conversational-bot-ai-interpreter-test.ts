import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiResponseProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const services = [
  { id: 'cut', name: 'Corte Hombre', durationMinutes: 30, requiresConsultation: false, price: 27000 },
  { id: 'beard', name: 'Corte y barba', durationMinutes: 45, requiresConsultation: false, price: 32000 },
  { id: 'lights', name: 'Iluminación', durationMinutes: 60, requiresConsultation: false, price: 160000 }
]
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
const slots = [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ramiro', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 }]
const port: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date, professionalId) => ({ professionals, slots: slots.filter(slot => slot.date === date && (!professionalId || slot.professionalId === professionalId)) }),
  information: async () => ({ businessId: 'qa', name: 'Glow', address: 'Monroe 5252', area: 'Villa Urquiza', mapsUrl: null,
    website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: null })
}
const empty = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'uncertain' }
const writer: AiResponseProvider = async ({ facts }) => ({
  opening: '¡Hola! ¿Cómo estás?', factIds: facts.map(fact => fact.id), closing: facts.length ? null : '¿En qué te ayudo con el local?'
})
let calls = 0
const greeting = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => { calls++; return empty }, { responseProvider: async (input, signal) => { calls++; return writer(input, signal) } })
assert.equal(calls, 2, 'the second call occurs after deterministic results')
assert.equal(greeting.interpretation.copyMode, 'ai')
assert.equal(greeting.reply, '¡Hola! ¿Cómo estás?\n¿En qué te ayudo con el local?')
assert.doesNotMatch(greeting.reply, /27\.000|Iluminación|¿Qué servicio necesitás/)
assert.ok(greeting.interpretation.engineMs! >= 0 && greeting.interpretation.responseMs! >= 0)

const address = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'donde estan?', port,
  async () => ({ ...empty, intent: 'information' }), { responseProvider: writer })
assert.match(address.reply, /Monroe 5252, Villa Urquiza/)
assert.doesNotMatch(address.reply, /¿Qué servicio necesitás|27\.000/)
const price = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'cuanto sale iluminación', port,
  async () => ({ ...empty, intent: 'information' }), { responseProvider: writer })
assert.match(price.reply, /160\.000/)
const offTopic = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'recitame un poema', port,
  async () => empty, { responseProvider: async () => ({ opening: 'No hago poemas, pero te ayudo con el local.', factIds: [], closing: null }) })
assert.match(offTopic.reply, /te ayudo con el local/)
assert.doesNotMatch(offTopic.reply, /27\.000|Corte Hombre/)

const semantic = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero hacerme claritos', port,
  async () => ({ ...empty, intent: 'booking', serviceId: 'lights', serviceEvidence: 'claritos', serviceConfidence: 'certain' }), { responseProvider: writer })
assert.equal(semantic.state.serviceId, 'lights', 'AI semantic choice reaches deterministic engine')
assert.match(semantic.reply, /Iluminación/)
const ambiguous = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero un corte', port,
  async () => ({ ...empty, intent: 'booking', serviceId: 'cut', serviceEvidence: 'corte', serviceConfidence: 'certain' }), { responseProvider: writer })
assert.equal(ambiguous.state.serviceId, null, 'overlap is not silently selected')
assert.match(ambiguous.reply, /referís a Corte Hombre/)
const uncertain = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'claritos', port,
  async () => ({ ...empty, intent: 'booking', serviceId: 'lights', serviceEvidence: 'claritos', serviceConfidence: 'uncertain' }), { responseProvider: writer })
assert.equal(uncertain.state.serviceId, null)
const foreign = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'claritos', port,
  async () => ({ ...empty, serviceId: 'foreign', serviceEvidence: 'claritos' }), { responseProvider: writer })
assert.equal(foreign.interpretation.mode, 'fallback')

const inventedPrice = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'cuanto sale iluminación', port,
  async () => ({ ...empty, intent: 'information' }), { responseProvider: async () => ({ opening: 'Cuesta $ 1', factIds: ['0'], closing: null }) })
assert.equal(inventedPrice.interpretation.copyMode, 'fallback')
assert.doesNotMatch(inventedPrice.reply, /\$ 1/)
const inventedService = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => empty, { responseProvider: async () => ({ opening: 'Te ofrezco Corte y barba', factIds: [], closing: null }) })
assert.equal(inventedService.interpretation.copyMode, 'fallback')
const omittedFact = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'donde estan?', port,
  async () => ({ ...empty, intent: 'information' }), { responseProvider: async () => ({ opening: 'Estamos cerca', factIds: [], closing: null }) })
assert.equal(omittedFact.interpretation.copyMode, 'fallback')
const inventedBooking = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => empty, { responseProvider: async () => ({ opening: 'Te reservé un turno', factIds: [], closing: null }) })
assert.equal(inventedBooking.interpretation.copyMode, 'fallback')
assert.doesNotMatch(inventedBooking.reply, /reservé/)

const writerFailure = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => empty, { responseProvider: async () => { throw new Error('offline') } })
assert.equal(writerFailure.interpretation.copyReason, 'response_error')
const timeout = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => empty, { timeoutMs: 20, responseProvider: async () => new Promise(() => {}) })
assert.equal(timeout.interpretation.copyReason, 'response_timeout')
const interpreterFailure = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port,
  async () => { throw new Error('offline') }, { responseProvider: writer })
assert.equal(interpreterFailure.interpretation.mode, 'fallback')

let requests: Array<{ url: string; body: any }> = []
const fetchImpl: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init!.body))
  requests.push({ url: String(url), body })
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{
    type: 'output_text', text: JSON.stringify(body.text.format.name === 'grounded_qa_reply'
      ? { opening: 'Hola', factIds: [], closing: null }
      : empty)
  }] }], usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }), { status: 200 })
}
const interpreter = createOpenAiInterpretationProvider({ apiKey: 'test-only', fetchImpl })
const composer = createOpenAiResponseProvider({ apiKey: 'test-only', fetchImpl })
const interpretedUsage = await interpreter({ message: 'hola', state: initialDialogueState('qa'), services }, new AbortController().signal)
const responseUsage = await composer({ message: 'hola', intent: 'other', state: initialDialogueState('qa'), facts: [] }, new AbortController().signal)
assert.equal(requests.length, 2)
const meteredProvider = Object.assign(async () => interpretedUsage, { respond: async () => responseUsage })
const metered = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port, meteredProvider)
assert.equal(metered.interpretation.usage?.interpretation?.inputTokens, 120)
assert.equal(metered.interpretation.usage?.response?.outputTokens, 30)
assert.ok(requests.every(request => request.url === 'https://api.openai.com/v1/responses' &&
  request.body.model === 'gpt-6-luna' && request.body.reasoning.effort === 'none' &&
  request.body.store === false && request.body.text.format.strict === true))
assert.ok(requests[0]!.body.text.format.schema.required.includes('serviceConfidence'))
assert.ok(requests[1]!.body.text.format.schema.required.includes('factIds'))
let consecutive = initialDialogueState('qa')
const turns = [
  ['hola', { ...empty }],
  ['quiero un corte hombre mañana con Ramiro', { ...empty, intent: 'booking', serviceId: 'cut', serviceEvidence: 'corte hombre', serviceConfidence: 'certain', professionalMention: 'Ramiro' }],
  ['17:00', { ...empty, intent: 'booking' }]
] as const
for (const [message, interpretation] of turns) {
  const turn = await respondWithAiInterpreter(context, consecutive, message, port, async () => interpretation, { responseProvider: writer })
  consecutive = turn.state
}
assert.equal(consecutive.serviceId, 'cut')
assert.equal(consecutive.professional?.kind === 'specific' ? consecutive.professional.id : null, 'ramiro')
assert.equal(consecutive.pending, 'name')
console.log('conversational AI two-stage: offline PASS')
