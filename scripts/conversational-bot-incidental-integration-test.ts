import assert from 'node:assert/strict'
import { initialDialogueState, hasActiveBooking, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'

const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
let agendaCalls = 0
const port: DialoguePort = { catalog: async () => [], availability: async () => { agendaCalls++; throw new Error('agenda forbidden') },
  identity: async () => ({ businessId: 'tenant', assistantName: 'Alba', businessName: 'Local', treatment: 'vos', greetingEmoji: '😊' }) }
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
const base = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }

async function main() {
  let calls = 0
  const seen: string[][] = []
  const provider: AiInterpretationProvider = Object.assign(async (input: AiInterpretationInput) => {
    calls++
    seen.push(input.firstReplyFacts?.map(fact => fact.text) ?? [])
    return { ...base, firstReply: { opening: null, closing: null, factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [] } }
  }, { respond: async () => { throw new Error('second AI call forbidden') } })
  const first = await respondWithAiInterpreter(context, initialDialogueState('tenant'), '¿cuánto es 2+2?', port, provider)
  assert.equal(calls, 1)
  assert.equal(first.interpretation.aiCalls, 1)
  assert.ok(seen[0]?.includes('2 + 2 es 4.'), 'first call receives the server-verified fact')
  assert.match(first.reply, /2 \+ 2 es 4\./)
  assert.match(first.reply, /Soy Alba, de Local/)
  assert.equal(hasActiveBooking(first.state), false)
  const second = await respondWithAiInterpreter(context, first.state, 'y 7x8?', port, provider)
  assert.equal(calls, 2, 'one AI call per turn')
  assert.equal(second.interpretation.aiCalls, 1)
  assert.ok(seen[1]?.includes('7 * 8 es 56.'), 'follow-up operation is server-verified in the first call')
  assert.match(second.reply, /7 \* 8 es 56\./)
  assert.doesNotMatch(second.reply, /Soy Alba/)
  assert.equal(hasActiveBooking(second.state), false)
  assert.equal(second.state.serviceId, null)
  assert.equal(second.state.date, null)
  assert.equal(agendaCalls, 0)
  const bookingState = { ...second.state, serviceId: 'cut', pending: 'date' as const, professional: { kind: 'specific' as const, id: 'ramiro' } }
  const bookingPort: DialoguePort = { ...port, catalog: async () => [{ id: 'cut', name: 'Corte', price: 12000, priceMode: 'FIXED', durationMinutes: 30, requiresConsultation: false }] }
  const contextual = await respondWithAiInterpreter(context, bookingState, 'y 7x8?', bookingPort, provider)
  assert.ok(seen.at(-1)?.includes('7 * 8 es 56.'))
  assert.match(contextual.reply, /7 \* 8 es 56\./)
  assert.equal(contextual.state.serviceId, 'cut')
  assert.deepEqual(contextual.state.professional, { kind: 'specific', id: 'ramiro' })
  assert.equal(contextual.state.pending, 'date')
  assert.equal(contextual.state.date, null)
  assert.equal(agendaCalls, 0)
  for (const message of ['quiero un turno y 7x8', '7x8 pesos', '7x8 minutos', '7x8 precio', '7x8 10:00', '7x8 y 2+2']) {
    await respondWithAiInterpreter(context, second.state, message, port, provider)
    assert.ok(!seen.at(-1)?.some(fact => /7 \* 8 es 56\./.test(fact)), message + ': mixed content is not arithmetic')
  }
  const unsafe: AiInterpretationProvider = async input => ({ ...base, firstReply: { opening: 'El resultado es 999.', closing: null, factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [] } })
  const rejected = await respondWithAiInterpreter(context, second.state, '¿cuánto es 2+2?', port, unsafe)
  assert.equal(rejected.interpretation.replyValidation?.firstCall.reason, 'unverified_value')
  assert.match(rejected.reply, /2 \+ 2 es 4\./)
  assert.doesNotMatch(rejected.reply, /999/)
  assert.equal(agendaCalls, 0)
  console.log('PASS incidental arithmetic contextual integration, safety and one-call delivery')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
