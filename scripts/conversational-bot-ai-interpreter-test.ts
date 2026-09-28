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
assert.equal(body.store, false)
assert.equal(body.text.format.type, 'json_schema')
assert.equal(body.text.format.strict, true)
assert.ok(body.max_output_tokens <= 500)
console.log('conversational AI interpreter: offline PASS')