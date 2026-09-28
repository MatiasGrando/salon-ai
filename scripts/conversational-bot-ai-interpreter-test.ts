import assert from 'node:assert/strict'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const services = [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, requiresConsultation: false, price: 27000 }]
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
const slots = [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ramiro', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 }]
const port: DialoguePort = { catalog: async () => services, availability: async (_service, date, professionalId) => ({ professionals, slots: slots.filter(slot => slot.date === date && (!professionalId || slot.professionalId === professionalId)) }) }
const empty = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null }
let calls = 0
const fake = async () => { calls++; return empty }
let state = initialDialogueState(context.businessId)
for (const message of ['hola queria', 'un turno con ramiro mañana', 'corte hombre']) {
  const result = await respondWithAiInterpreter(context, state, message, port, fake)
  assert.equal(result.interpretation.mode, 'ai')
  assert.ok(result.interpretation.providerMs >= 0)
  assert.ok(result.interpretation.validationMs >= 0)
  state = result.state
}
assert.equal(calls, 3, 'AI is called on every enabled turn')
assert.equal(state.professional?.kind === 'specific' ? state.professional.id : null, 'ramiro', 'early Ramiro is preserved and grounded')

state = initialDialogueState(context.businessId)
const typo = await respondWithAiInterpreter(context, state, 'corte hombnre', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombnre' }))
assert.equal(typo.state.serviceId, null, 'typo is not silently selected')
assert.match(typo.reply, /Corte Hombre/)
const mixedTypo = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'corte hombnre con Ramiro mañana', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombnre', professionalMention: 'Ramiro' }))
assert.equal(mixedTypo.state.serviceId, null)
assert.equal(mixedTypo.state.date, '2026-09-29')
assert.equal(mixedTypo.state.professionalNameHint, 'ramiro')
const mixedWithoutCon = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'corte hombnre Ramiro mañana', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombnre', professionalMention: 'Ramiro' }))
assert.equal(mixedWithoutCon.state.professionalNameHint, 'ramiro', 'AI identifies literal professional even before service correction')
const corrected = await respondWithAiInterpreter(context, typo.state, 'Corte Hombre mañana con Ramiro', port, fake)
assert.equal(corrected.state.serviceId, 'cut')
assert.equal(corrected.state.professional?.kind === 'specific' ? corrected.state.professional.id : null, 'ramiro')

state = initialDialogueState(context.businessId)
const aiProfessional = await respondWithAiInterpreter(context, state, 'Ramiro mañana', port, async () => ({ ...empty, professionalMention: 'Ramiro' }))
assert.equal(aiProfessional.state.professionalNameHint, 'ramiro', 'AI understands early professional without inventing an ID')
const rejectedProfessional = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'no Ramiro mañana', port, async () => ({ ...empty, professionalMention: 'Ramiro' }))
assert.equal(rejectedProfessional.state.professionalNameHint, null, 'negated name is not a preference')
const embeddedName = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Ramirox mañana', port, async () => ({ ...empty, professionalMention: 'Ramiro' }))
assert.equal(embeddedName.interpretation.mode, 'fallback', 'professional evidence must be a whole word')

for (const bad of [
  { ...empty, serviceId: 'foreign', serviceEvidence: 'corte hombnre' },
  { ...empty, serviceId: 'cut', serviceEvidence: 'invented' },
  { ...empty, professionalMention: 'Nonexistent' },
  { ...empty, professionalMention: 'ramiro' },
  { ...empty, date: '2026-09-30' }
]) {
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'corte hombnre', port, async () => bad)
  assert.equal(result.interpretation.mode, 'fallback')
  assert.equal(result.state.serviceId, null)
}
const failure = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'hola', port, async () => { throw new Error('offline') })
assert.equal(failure.interpretation.mode, 'fallback')
const timeout = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'hola', port, async (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), { timeoutMs: 20 })
assert.equal(timeout.interpretation.mode, 'fallback')
assert.equal(timeout.interpretation.reason, 'timeout')
const ignoredAbort = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'hola', port, async () => new Promise(() => {}), { timeoutMs: 20 })
assert.equal(ignoredAbort.interpretation.reason, 'timeout', 'uncooperative provider cannot hang QA turn')

let request: { url: string; init: RequestInit } | null = null
const provider = createOpenAiInterpretationProvider({ apiKey: 'test-only', fetchImpl: async (url, init) => {
  request = { url: String(url), init: init! }
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(empty) }] }] }), { status: 200 })
} })
await provider({ message: 'hola', state: initialDialogueState('qa'), services }, new AbortController().signal)
assert.equal(request!.url, 'https://api.openai.com/v1/responses')
const body = JSON.parse(String(request!.init.body))
assert.equal(body.model, 'gpt-6-luna')
assert.equal(body.reasoning.effort, 'none', 'QA-only latency experiment keeps reasoning off')
assert.equal(body.store, false)
assert.equal(body.text.format.type, 'json_schema')
assert.equal(body.text.format.strict, true)
assert.match(body.instructions, /servicio ya validado/, 'QA prompt may mention only the validated service in a date question')
assert.ok(body.max_output_tokens <= 500)
// The QA writer must use the same AI call, but never delegate business facts to the draft.
const greetingCopy = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola como estas', port, async () => ({ ...empty, replyDraft: '¡Hola! ¿Cómo estás? ¿Qué servicio te gustaría reservar?' }))
assert.equal(greetingCopy.reply, '¡Hola! ¿Cómo estás? ¿Qué servicio te gustaría reservar?')
assert.equal(greetingCopy.interpretation.copyMode, 'ai')
assert.doesNotMatch(greetingCopy.reply, /27\.000|Corte Hombre/)
const socialGreeting = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola como estas', port, async () => ({ ...empty, replyDraft: '¡Hola! Todo bien, gracias.' }))
assert.equal(socialGreeting.interpretation.copyMode, 'ai')
assert.match(socialGreeting.reply, /Todo bien, gracias\.\n¿Qué servicio necesitás\?/)
assert.doesNotMatch(socialGreeting.reply, /27\.000|Corte Hombre/)
const exactQaGreeting = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola como estas', port, async () => ({ ...empty, replyDraft: '¡Hola! Bien, gracias 😊' }))
assert.equal(exactQaGreeting.interpretation.copyMode, 'ai')
assert.equal(exactQaGreeting.reply, '¡Hola! Bien, gracias 😊\n¿Qué servicio necesitás?')
const realQaGreeting = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola como estas', port, async () => ({ ...empty, replyDraft: '¡Hola! Muy bien, gracias 😊' }))
assert.equal(realQaGreeting.interpretation.copyMode, 'ai')
assert.equal(realQaGreeting.reply, '¡Hola! Muy bien, gracias 😊\n¿Qué servicio necesitás?')
const inventedGreeting = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port, async () => ({ ...empty, replyDraft: 'Hola, te reservé un turno. ¿Qué servicio necesitás?' }))
assert.equal(inventedGreeting.interpretation.copyMode, 'fallback')
assert.doesNotMatch(inventedGreeting.reply, /reservé/)
const dateCopy = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'corte hombre', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombre', replyDraft: '¡Claro! ¿Qué día te queda bien para el turno?' }))
assert.equal(dateCopy.state.serviceId, 'cut')
assert.equal(dateCopy.reply, '¡Claro! ¿Qué día te queda bien para el turno?')
assert.equal(dateCopy.interpretation.copyMode, 'ai')
const selectedServiceDate = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'corte hombre', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombre', replyDraft: '¡Claro! ¿Para qué día querés el Corte Hombre?' }))
assert.equal(selectedServiceDate.interpretation.copyMode, 'ai')
assert.equal(selectedServiceDate.reply, '¡Claro! ¿Para qué día querés el Corte Hombre?')
const inventedOtherService = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'corte hombre', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombre', replyDraft: '¡Claro! ¿Para qué día querés Corte Mujer?' }))
assert.equal(inventedOtherService.interpretation.copyMode, 'fallback')
assert.doesNotMatch(inventedOtherService.reply, /Corte Mujer/)
const inventedDateFact = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'corte hombre', port, async () => ({ ...empty, serviceId: 'cut', serviceEvidence: 'corte hombre', replyDraft: 'Corte Hombre disponible hoy. ¿Qué día querés?' }))
assert.equal(inventedDateFact.interpretation.copyMode, 'fallback')
assert.doesNotMatch(inventedDateFact.reply, /disponible hoy/)
const startingPort: DialoguePort = { ...port, catalog: async () => [{ ...services[0]!, priceMode: 'STARTING_AT', price: 27000 }] }
const startingPrice = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'precio de corte hombre', startingPort, async () => ({ ...empty, replyDraft: 'Claro, te cuento.' }))
assert.match(startingPrice.reply, /Desde \$\s*27\.000/)
assert.equal(startingPrice.interpretation.copyMode, 'ai')
const typoFromActualModel = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero un corte de hombnre', port, async () => ({ ...empty, serviceEvidence: 'corte de hombnre', replyDraft: 'Te reservé Corte Hombre' }))
assert.equal(typoFromActualModel.interpretation.mode, 'ai', 'un paired null service ID and literal typo evidence is valid')
assert.equal(typoFromActualModel.state.serviceId, null)
assert.match(typoFromActualModel.reply, /referís a Corte Hombre/)
assert.doesNotMatch(typoFromActualModel.reply, /reservé/)
const typoWithoutModelEvidence = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero un corte de hombnre', port, async () => ({ ...empty, replyDraft: null }))
assert.match(typoWithoutModelEvidence.reply, /referís a Corte Hombre/)
assert.equal(typoWithoutModelEvidence.state.serviceId, null)
const partialEvidence = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'quiero un corte de hombnre', port, async () => ({ ...empty, serviceEvidence: 'corte', replyDraft: '¿Podrías aclararme qué servicio querés?' }))
assert.equal(partialEvidence.interpretation.mode, 'ai')
assert.match(partialEvidence.reply, /referís a Corte Hombre/)
assert.equal(partialEvidence.state.serviceId, null)
const priceCopy = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'cuanto sale corte hombre', port, async () => ({ ...empty, replyDraft: 'Sale $ 1 y ya está reservado' }))
assert.equal(priceCopy.interpretation.copyMode, 'fallback', 'unsafe AI facts cannot replace canonical price')
assert.doesNotMatch(priceCopy.reply, /\$ 1 y/)
const invalidDraft = await respondWithAiInterpreter(context, initialDialogueState('qa'), 'hola', port, async () => ({ ...empty, replyDraft: 'x'.repeat(181) }))
assert.equal(invalidDraft.interpretation.mode, 'fallback')
assert.equal(invalidDraft.interpretation.reason, 'invalid_output')
assert.equal(invalidDraft.interpretation.copyMode, 'fallback')
assert.doesNotMatch(invalidDraft.reply, /27\.000|Corte Hombre/, 'failed copy still does not dump a catalog for a greeting')
const timeCopy = await respondWithAiInterpreter(context, { ...initialDialogueState('qa'), serviceId: 'cut', date: '2026-09-29', professional: { kind: 'specific', id: 'ramiro' }, pending: 'time' }, 'mañana', port, async () => ({ ...empty, replyDraft: 'Reservado, nos vemos a las 18:00' }))
assert.equal(timeCopy.interpretation.copyMode, 'fallback')
assert.match(timeCopy.reply, /17:00 con Ramiro/)
assert.doesNotMatch(timeCopy.reply, /Reservado/)
const proposalState = { ...initialDialogueState('qa'), pending: 'proposal' as const, serviceId: 'cut', date: '2026-09-29', professional: { kind: 'specific' as const, id: 'ramiro' }, slot: slots[0]!, customerName: 'Ana' }
const proposalCopy = await respondWithAiInterpreter(context, proposalState, 'confirmar', port, async () => ({ ...empty, replyDraft: 'Ya está reservado, Ana' }))
assert.equal(proposalCopy.interpretation.copyMode, 'fallback')
assert.match(proposalCopy.reply, /Todavía no está reservado/)
assert.doesNotMatch(proposalCopy.reply, /Ya está reservado/)
assert.equal(body.text.format.schema.required.includes('replyDraft'), true, 'single model call includes reply draft')
console.log('conversational AI interpreter: offline PASS')