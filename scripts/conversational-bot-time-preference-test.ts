import assert from 'node:assert/strict'
import httpTransport from 'node:http'
import httpsTransport from 'node:https'
import { initialDialogueState, parseDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA } from '../src/conversational-bot/turn-plan.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'

const forbiddenTransport = () => { throw new Error('external transport forbidden') }
httpTransport.request = forbiddenTransport; httpTransport.get = forbiddenTransport
httpsTransport.request = forbiddenTransport; httpsTransport.get = forbiddenTransport
globalThis.fetch = async () => { throw new Error('external transport forbidden') }
const context = { businessId: 'time-preference-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z'), sandboxBooking: true }
const services = [{ id: 'cut', name: 'Corte hombre', price: 100, durationMinutes: 30, requiresConsultation: false }, { id: 'woman', name: 'Corte mujer', price: 200, durationMinutes: 30, requiresConsultation: false }]
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
let times = ['12:00', '13:00', '13:30', '18:00'], reads = 0
const port: DialoguePort = { catalog: async () => services, availability: async (_service, date) => {
  reads++
  return { professionals, slots: times.map(time => ({ date, time, startAt: date + 'T' + String(Number(time.slice(0, 2)) + 3).padStart(2, '0') + ':' + time.slice(3) + ':00.000Z', professionalId: 'ramiro', professionalName: 'Ramiro', band: time < '12:30' ? 'MORNING' as const : time < '16:30' ? 'AFTERNOON' as const : 'EVENING' as const, occupiedMinutes: 0 })) }
} }
const initial = () => initialDialogueState(context.businessId)
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const pref = (preference: unknown, evidence = 'después de las 13') => ({ kind: 'time_preference', preference, ...ev(evidence) })
const dateOp = { kind: 'date', expression: 'mañana', value: '2026-10-03', ...ev('mañana') }
const nameOp = { kind: 'name', value: 'Matias', ...ev('Matias') }
const specific = { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }
const serviceOp = { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') }
const decision = (operations: object[]) => ({ serviceId: null, candidateIds: [], correction: false, intent: 'booking' as const, turnPlan: { version: 1 as const, operations: operations as any } })
const say = (state: DialogueState, message: string, operations: object[]) => respond(context, state, message, port, decision(operations))
const legacy = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null }
const fail: AiInterpretationProvider = async () => { throw new Error('offline provider failure') }
const preservation = await respond(context, initial(), 'soy Matias quiero corte mañana después de las 13 con Ramiro', port, { serviceId: null, candidateIds: ['cut', 'woman'], correction: false, intent: 'booking' })
assert.equal(preservation.state.customerName, 'Matias', 'legacy ambiguous service must preserve identity before returning')
// First RED: fallback previously returns service ambiguity before explicit identity.
const fallback = await respondWithAiInterpreter(context, initial(), 'soy Matias quiero corte mañana después de las 13 con Ramiro', port, fail)
assert.equal(fallback.state.customerName, 'Matias', 'independent identity survives fallback ambiguity')
assert.equal(fallback.state.date, '2026-10-03'); assert.equal(fallback.state.professionalNameHint, 'ramiro')
assert.equal(fallback.state.slot, null); assert.equal(fallback.state.requestedTime, null)
assert.deepEqual((fallback.state as any).timePreference, { kind: 'after', time: '13:00' })
const message = 'soy Matias Corte hombre mañana después de las 13'
const result = await say(initial(), message, [serviceOp, dateOp, nameOp, pref({ kind: 'after', time: '13:00' })])
assert.equal(result.state.pending, 'professional'); assert.equal(result.state.customerName, 'Matias')
assert.equal(result.state.requestedTime, null); assert.equal(result.state.slot, null)
const restored = parseDialogueState(JSON.parse(JSON.stringify(result.state)), context.businessId, context.timezone)
assert.deepEqual(restored, result.state)
const offered = await say(restored, 'Ramiro', [specific])
assert.equal(offered.state.pending, 'time'); assert.equal(offered.state.slot, null); assert.equal(offered.proposal, null)
assert.equal(offered.bookingCommand, undefined); assert.equal(offered.state.customerName, 'Matias')
assert.deepEqual(offered.state.questionContext?.options.map(option => option.label.match(/a las (\d{2}:\d{2}) con Ramiro/)?.[1]), ['13:00', '13:30', '18:00'])
assert.doesNotMatch(offered.reply, /12:00/); assert.deepEqual(parseDialogueState(offered.state, context.businessId), offered.state)
times = ['13:00']
const single = await say(restored, 'Ramiro', [specific])
assert.equal(single.state.slot, null, 'one filtered option is still not a selection'); assert.equal(single.proposal, null)
const exact = await say(single.state, 'a las 13', [{ kind: 'time', value: '13:00', ...ev('a las 13') }])
assert.equal(exact.state.slot?.time, '13:00'); assert.equal(exact.state.requestedTime, '13:00')
assert.equal((exact.state as any).timePreference, undefined); assert.equal(exact.state.pending, 'proposal')
assert.equal(exact.bookingCommand, undefined, 'selection never authorizes reservation')
times = ['12:00', '13:00', '13:30', '18:00']
for (const [preference, evidence, expected] of [
  [{ kind: 'before', time: '13:00' }, 'antes de las 13', ['12:00']],
  [{ kind: 'band', band: 'MORNING' }, 'por la mañana', ['12:00']],
  [{ kind: 'band', band: 'AFTERNOON' }, 'por la tarde', ['13:00', '13:30']],
  [{ kind: 'band', band: 'EVENING' }, 'por la noche', ['18:00']],
  [{ kind: 'earliest' }, 'lo más temprano posible', ['12:00', '13:00', '13:30']],
  [{ kind: 'any' }, 'cualquier horario', times.slice(0, 3)]
] as const) {
  const filtered = await say(offered.state, evidence, [pref(preference, evidence)])
  assert.equal(filtered.state.slot, null); assert.equal(filtered.state.requestedTime, null)
  assert.deepEqual(filtered.state.questionContext?.options.filter(option => !option.id.startsWith('page:')).map(option => option.label.match(/a las (\d{2}:\d{2})/)?.[1]), expected)
  if (preference.kind === 'any' || preference.kind === 'earliest') assert.ok(filtered.state.questionContext?.options.some(option => option.id === 'page:slots:1'))
  assert.equal(filtered.proposal, null); assert.deepEqual(parseDialogueState(filtered.state, context.businessId), filtered.state)
}
const corrected = await say(exact.state, 'después de las 13', [pref({ kind: 'after', time: '13:00' })])
assert.equal(corrected.state.slot, null); assert.equal(corrected.state.sandboxReservation, undefined)
assert.equal(corrected.state.customerName, 'Matias'); assert.equal(corrected.state.date, '2026-10-03'); assert.equal(corrected.state.serviceId, 'cut')
assert.equal(corrected.bookingCommand, undefined)
const tomorrow = await say(corrected.state, 'el domingo', [{ kind: 'date', expression: 'el domingo', value: '2026-10-04', ...ev('el domingo') }])
assert.deepEqual((tomorrow.state as any).timePreference, { kind: 'after', time: '13:00' }); assert.equal(tomorrow.state.slot, null)
times = ['18:00']
const stale = await say(offered.state, 'a las 13', [{ kind: 'time', value: '13:00', ...ev('a las 13') }])
assert.equal(stale.state.slot, null); assert.equal(stale.proposal, null); assert.match(stale.reply, /18:00/)
const noMatch = await say(offered.state, 'antes de las 13', [pref({ kind: 'before', time: '13:00' }, 'antes de las 13')])
assert.equal(noMatch.state.slot, null); assert.equal(noMatch.state.date, '2026-10-03', 'filter cannot discard independently chosen day')
assert.equal(noMatch.state.customerName, 'Matias'); assert.doesNotMatch(noMatch.reply, /18:00/)
let providerCalls = 0
const semantic = await respondWithAiInterpreter(context, initial(), message + ' con Ramiro', port, async () => {
  providerCalls++; return { ...legacy, turnPlan: { version: 1, operations: [serviceOp, dateOp, nameOp, specific, pref({ kind: 'after', time: '13:00' })] } }
})
assert.equal(providerCalls, 1); assert.equal(semantic.interpretation.mode, 'ai')
assert.equal(semantic.state.slot, null); assert.equal(semantic.state.customerName, 'Matias'); assert.equal(semantic.state.pending, 'time')
const ambiguity = await say(initial(), 'soy Matias corte mañana después de las 13 con Ramiro', [{ ...serviceOp, mode: 'alternatives', serviceIds: ['cut', 'woman'], evidence: 'corte' }, dateOp, nameOp, specific, pref({ kind: 'after', time: '13:00' })])
assert.equal(ambiguity.state.customerName, 'Matias'); assert.equal(ambiguity.state.pending, 'service')
assert.deepEqual((ambiguity.state as any).timePreference, { kind: 'after', time: '13:00' })
const snapshot = structuredClone(offered.state)
for (const preference of [{ kind: 'after', time: '99:00' }, { kind: 'band', band: 'OTHER' }, { kind: 'any', extra: true }, null, [], { kind: 'foreign', businessId: 'other' }]) {
  assert.throws(() => parseDialogueState({ ...offered.state, timePreference: preference }, context.businessId))
  await assert.rejects(() => say(offered.state, 'después de las 13', [pref(preference)]))
}
assert.throws(() => parseDialogueState({ ...offered.state, requestedTime: '13:00' }, context.businessId))
assert.throws(() => parseDialogueState(offered.state, 'foreign')); assert.deepEqual(offered.state, snapshot)
assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'after', time: '13:00' }), { kind: 'time', value: '13:00', ...ev('13') }] }, 'después de las 13'))
assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'any' }, 'not present')] }, 'cualquier horario'))
assert.deepEqual(parseDialogueState(initial(), context.businessId), initial())
assert.ok((TURN_PLAN_JSON_SCHEMA.properties.operations as any).items.anyOf.some((schema: any) => schema.properties.kind.enum.includes('time_preference')))
let request: any
const http = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...legacy, turnPlan: { version: 1, operations: [] } }) }] }] }), { status: 200 })
} })
await http({ message: 'hola', state: offered.state, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request.input).timePreference, { kind: 'after', time: '13:00' })
assert.match(request.instructions, /time_preference/); assert.match(request.instructions, /inclusiv/); assert.ok(reads > 0)
console.log('PASS temporal preferences, identity, snapshots, correction and offline AI contract')
// Additional RED: fallback on a pre-existing basket must preserve explicit new identity and preference.
const basketFallback = await respondWithAiInterpreter(context, ambiguity.state, 'soy Juan mañana después de las 13', port, fail)
assert.equal(basketFallback.state.customerName, 'Juan')
assert.deepEqual((basketFallback.state as any).timePreference, { kind: 'after', time: '13:00' })
assert.equal(basketFallback.state.pending, 'service'); assert.equal(basketFallback.state.slot, null)
// Confidence is per field: a tentative preference must not become a stored filter or selection.
const tentative = await say(restored, 'después de las 18', [{ ...pref({ kind: 'after', time: '18:00' }, 'después de las 18'), confidence: 0.6 }])
assert.deepEqual((tentative.state as any).timePreference, { kind: 'after', time: '13:00' })
assert.equal(tentative.state.slot, null)
// Fake copy cannot claim an automatic assignment merely because a preference was interpreted.
const copied = await respondWithAiInterpreter(context, restored, 'Ramiro', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [specific] } }), { responseProvider: async input => ({ opening: 'Te asigné el turno.', factIds: input.facts.map(fact => fact.id), closing: null }) })
assert.doesNotMatch(copied.reply, /asigné/)
assert.equal(copied.state.slot, null)
// Pure temporal module: generic fallback never promotes the preference bound to an exact choice.
const { fallbackTemporalRequest, filterTimePreference, parseTimePreference } = await import('../src/conversational-bot/time-preference.js')
for (const text of ['después de las 13', 'despues de las 13:00', 'desde las 13', 'a partir de las 13']) assert.deepEqual(fallbackTemporalRequest(text), { kind: 'preference', preference: { kind: 'after', time: '13:00' } })
for (const text of ['primero', 'temprano', 'lo más temprano posible']) assert.deepEqual(fallbackTemporalRequest(text), { kind: 'preference', preference: { kind: 'earliest' } })
assert.deepEqual(fallbackTemporalRequest('antes del mediodía'), { kind: 'preference', preference: { kind: 'before', time: '12:00' } })
assert.deepEqual(fallbackTemporalRequest('cualquierhora'), { kind: 'preference', preference: { kind: 'any' } })
assert.deepEqual(fallbackTemporalRequest('mañana por la mañana'), { kind: 'preference', preference: { kind: 'band', band: 'MORNING' } })
assert.equal(fallbackTemporalRequest('después de las 13:99'), null)
assert.equal(fallbackTemporalRequest('no después de las 13'), null)
assert.equal(fallbackTemporalRequest('¿después de las 13?'), null)
assert.deepEqual(fallbackTemporalRequest('a las 13'), { kind: 'exact', time: '13:00' })
assert.deepEqual(fallbackTemporalRequest('1300', true), { kind: 'exact', time: '13:00' })
assert.equal(fallbackTemporalRequest('13', false), null)
assert.deepEqual(fallbackTemporalRequest('después de las 13 a las 17'), { kind: 'ambiguous' })
assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'time', value: '13:00', ...ev('después de las 13') }] }, 'después de las 13'))
assert.throws(() => parseTimePreference({ kind: 'after', time: '13:00', secret: 'x' }))
assert.throws(() => parseDialogueState({ ...restored, unused: 'x'.repeat(17000) }, context.businessId))
const ambiguousTime = await respond(context, offered.state, 'después de las 13 a las 17', port)
assert.equal(ambiguousTime.state.slot, null); assert.equal(ambiguousTime.proposal, null); assert.match(ambiguousTime.reply, /prefer/)
const fold = ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'].map(startAt => ({ startAt, date: '2026-11-01', time: '01:30', professionalId: 'ramiro', professionalName: 'Ramiro', band: 'MORNING' as const, occupiedMinutes: 0 }))
assert.equal(filterTimePreference(fold, { kind: 'after', time: '01:30' }).length, 2, 'filter keeps both actual DST alternatives')
assert.equal(filterTimePreference(fold, { kind: 'earliest' })[0]?.startAt, fold[0]?.startAt)
assert.equal(parseDialogueState({ ...initial(), serviceId: 'cut', date: '2026-11-01', professional: { kind: 'specific', id: 'ramiro' }, slot: fold[1]!, requestedTime: '01:30', pending: 'name' }, context.businessId, 'America/New_York').slot?.startAt, fold[1]?.startAt)
console.log('PASS confidence, copy safety, generic fallback ambiguity and DST wall-time bounds')
const rollbackInput = structuredClone(offered.state)
await assert.rejects(() => respond(context, offered.state, 'después de las 13', { ...port, availability: async () => { throw new Error('offline failure') } }, decision([pref({ kind: 'after', time: '13:00' })])))
assert.deepEqual(offered.state, rollbackInput, 'failed agenda read leaves caller snapshot untouched')
const independentlyExact = await respond(context, initial(), 'soy Matias, quiero corte mañana a las 13 con Ramiro', port, { serviceId: null, candidateIds: ['cut', 'woman'], correction: false, intent: 'booking' })
assert.equal(independentlyExact.state.customerName, 'Matias'); assert.equal(independentlyExact.state.requestedTime, '13:00')
assert.equal(independentlyExact.state.slot, null, 'independent exact choice is retained, never fabricated before service resolution')
assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'time', value: '13:00', ...ev('13') }] }, 'después de las 13'), 'shrinking model evidence to the bound must not turn a preference into an exact selection')
// Parent review: classification must recognize a questioned preference without authorizing fallback mutation.
times = ['13:00']
const temporalGuardChecks = await Promise.allSettled([
  (async () => {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'time', value: '13:00', ...ev('13') }] }, '¿Mañana después de las 13 hay lugar?'))
  })(),
  (async () => {
    const tentativeExact = await say(offered.state, 'a las 13', [{ kind: 'time', value: '13:00', ...ev('a las 13'), confidence: 0.6 }])
    assert.equal(tentativeExact.state.slot, null, 'medium-confidence exact proposal is not a choice')
    assert.equal(tentativeExact.state.requestedTime, null)
    assert.equal(tentativeExact.state.customerName, 'Matias')
  })()
])
assert.deepEqual(temporalGuardChecks.map(result => result.status), ['fulfilled', 'fulfilled'], temporalGuardChecks.map(result => result.status === 'rejected' ? String(result.reason) : 'PASS').join('\n'))
// Split remains non-actionable: direct fallback questions preserve state and never select, while exact choices stay supported.
const questionFallback = await respond(context, offered.state, '¿Mañana después de las 13 hay lugar?', port)
assert.equal(questionFallback.state.slot, null); assert.equal(questionFallback.state.requestedTime, null)
const { classifyTemporalRequest } = await import('../src/conversational-bot/time-preference.js')
assert.deepEqual(classifyTemporalRequest('¿Mañana después de las 13 hay lugar?'), { kind: 'preference', preference: { kind: 'after', time: '13:00' } })
assert.equal(fallbackTemporalRequest('¿Mañana después de las 13 hay lugar?'), null)
assert.equal(parseTurnPlan({ version: 1, operations: [{ kind: 'time', value: '13:00', ...ev('a las 13') }] }, 'mañana a las 13').operations[0]?.kind, 'time')
const independentLow = await say(initial(), 'soy Matias Corte hombre mañana con Ramiro a las 13', [serviceOp, dateOp, nameOp, specific, { kind: 'time', value: '13:00', ...ev('a las 13'), confidence: 0.4 }])
assert.equal(independentLow.state.customerName, 'Matias'); assert.equal(independentLow.state.date, '2026-10-03'); assert.equal(independentLow.state.slot, null)
console.log('PASS question classification separated from action admission and per-field exact confidence')
