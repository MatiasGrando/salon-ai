import { admitCommunicativePlan, parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { approximateTimeRequest } from '../src/conversational-bot/time-preference.js'
import assert from 'node:assert/strict'
import httpTransport from 'node:http'
import httpsTransport from 'node:https'
import { initialDialogueState, parseDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA } from '../src/conversational-bot/turn-plan.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'

// Captured approximation is literal and semantically correct; no real transport is replayed.
assert.deepEqual(approximateTimeRequest('Masomenos a las 5 tenés lugar?'), { evidence: 'Masomenos a las 5', candidateTimes: ['05:00', '17:00'] }, 'joined approximation preserves the requested anchor, not an exact selection')
const capturedMixed='Buenas! Como va? Tendran turno para mañana viernes, a las 18 aprox?'
assert.deepEqual(approximateTimeRequest(capturedMixed),{evidence:'a las 18 aprox',candidateTimes:['18:00']})
for(const [input,evidence,candidates] of [
  ['a las 18 aproximadamente','a las 18 aproximadamente',['18:00']],
  ['18:30 aprox.','18:30 aprox',['18:30']],
  ['a las 6 aprox','a las 6 aprox',['06:00','18:00']],
  ['6 pm aprox','6 pm aprox',['18:00']],
  ['6 aprox de la tarde','6 aprox de la tarde',['18:00']],
  ['tipo 18 aprox','tipo 18 aprox',['18:00']]
] as const)assert.deepEqual(approximateTimeRequest(input),{evidence,candidateTimes:[...candidates]},input)
for(const input of ['no a las 18 aprox','sin horario a las 18 aprox','a las 25 aprox','18:99 aprox',
  'a las 18 aprox o tipo 19','tipo 18 o a las 19','a las 18 aprox y a las 19','18 aprox o 19:00','18 aprox o 19','tipo 18 y 19'])
  assert.equal(approximateTimeRequest(input),null,input)

// Q: explicit two-digit clocks retain their precision; a one-digit clock is still twelve-hour ambiguous.
const preciseApproximationCases: readonly (readonly [string, readonly string[] | null])[] = [
  ['alrededor de las 11:00', ['11:00']],
  ['aproximadamente a las 11:30', ['11:30']],
  ['cerca de las 12:00', ['12:00']],
  ['tipo 00:00', ['00:00']],
  ['tipo 05:30', ['05:30']],
  ['a las 11:00 aproximadamente', ['11:00']],
  ['11:30 aprox.', ['11:30']],
  ['12:00 aprox', ['12:00']],
  ['00:00 aproximadamente', ['00:00']],
  ['05:30 aprox', ['05:30']],
  ['tipo 5:30', ['05:30', '17:30']],
  ['5:30 aprox', ['05:30', '17:30']],
  ['tipo 11', ['11:00', '23:00']],
  ['tipo 11:00pm', ['23:00']],
  ['05:30 pm aprox', ['17:30']],
  ['tipo 12:00am', ['00:00']],
  ['tipo 05:30 de la tarde', ['17:30']],
  ['11:30 aprox de la mañana', ['11:30']],
  ['no alrededor de las 11:00', null],
  ['tipo 23:00am', null],
  ['tipo 11:00pm o 11:00am', null],
  ['tipo 11:00 y a las 17:00', null]
]
let preciseApproximationFailures = 0
for (const [body, expected] of preciseApproximationCases) {
  try {
    const actual = approximateTimeRequest(body)
    assert.deepEqual(actual?.candidateTimes ?? null, expected, body)
    if (actual) assert.ok(body.includes(actual.evidence), 'anchor evidence remains an original literal slice')
  } catch (error) {
    preciseApproximationFailures++
    console.error('FAIL explicit approximate clock:', body, (error as Error).message)
  }
}
console.log('Q approximate clock cases:', preciseApproximationCases.length, 'failures:', preciseApproximationFailures)
if (preciseApproximationFailures) throw new Error('explicit approximate clock regressions: ' + preciseApproximationFailures)

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
assert.equal(noMatch.state.customerName, 'Matias')
assert.match(noMatch.reply, /disponibles en otro horario:[\s\S]*18:00/, 'a verified alternative must be labeled outside the requested preference')
assert.deepEqual(noMatch.state.timePreference, { kind: 'before', time: '13:00' }, 'an offer never changes the requested preference')
assert.equal(noMatch.state.requestedTime, null); assert.equal(noMatch.proposal, null); assert.equal(noMatch.bookingCommand, undefined)
assert.equal(noMatch.state.sandboxReservation, undefined); assert.equal(noMatch.availability?.reason, 'PREFERENCE_NO_MATCH')
assert.deepEqual(noMatch.choicePresentation?.choices.filter(choice => choice.operation.kind === 'slot').map(choice => choice.operation),
  [{ kind: 'slot', date: '2026-10-03', time: '18:00', startAt: '2026-10-03T21:00:00.000Z', professionalId: 'ramiro' }], 'only the fresh real slot is selectable')
assert.equal(noMatch.state.questionContext?.complete, true); assert.equal(noMatch.state.questionContext?.role, 'time')
assert.deepEqual(parseDialogueState(noMatch.state, context.businessId, context.timezone), noMatch.state)
let providerCalls = 0
const semantic = await respondWithAiInterpreter(context, initial(), message + ' con Ramiro', port, async () => {
  providerCalls++; return { ...legacy, turnPlan: { version: 1, operations: [serviceOp, dateOp, nameOp, specific, pref({ kind: 'after', time: '13:00' })] },
    communicativeActs: { version: 1, acts: [
      { kind: 'request', field: 'service', evidence: 'Corte hombre', confidence: 1, mention: null, operationIndexes: [0] },
      { kind: 'request', field: 'date', evidence: 'mañana', confidence: 1, mention: null, operationIndexes: [1] },
      { kind: 'request', field: 'name', evidence: 'soy Matias', confidence: 1, mention: 'Matias', operationIndexes: [2] },
      { kind: 'request', field: 'professional', evidence: 'con Ramiro', confidence: 1, mention: 'Ramiro', operationIndexes: [3] },
      { kind: 'request', field: 'time', evidence: 'después de las 13', confidence: 1, mention: null, operationIndexes: [4] }
    ] } }
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
const copied = await respondWithAiInterpreter(context, restored, 'Ramiro', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [specific] }, communicativeActs: { version: 1, acts: [{ kind: 'answer', field: 'professional', evidence: 'Ramiro', confidence: 1, mention: 'Ramiro', operationIndexes: [0] }] } }), { responseProvider: async input => ({ opening: 'Te asigné el turno.', factIds: input.facts.map(fact => fact.id), closing: null }) })
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

// E2.26d.1: a complete interval is one preference, never two conflicting time operations.
const interval = { kind: 'range', from: '13:00', to: '18:00', fromInclusive: true, toInclusive: false } as const
const intervalEvidence = 'después de las 13 y antes de las 18'
const intervalFailures: string[] = []
async function intervalCheck(label: string, check: () => void | Promise<void>) {
  try { await check(); console.log('PASS interval ' + label) }
  catch (error) { intervalFailures.push(label + ': ' + String(error)); console.error('FAIL interval ' + label + ': ' + String(error)) }
}
await intervalCheck('strict value and both boundary filters', () => {
  assert.deepEqual(parseTimePreference(interval), interval)
  const slots = ['12:30', '13:00', '13:30', '17:30', '18:00', '18:30'].map(time => ({
    date: '2026-10-03', time, startAt: '2026-10-03T' + String(Number(time.slice(0, 2)) + 3).padStart(2, '0') + ':' + time.slice(3) + ':00Z',
    professionalId: 'ramiro', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0
  }))
  assert.deepEqual(filterTimePreference(slots, interval as any).map(slot => slot.time), ['13:00', '13:30', '17:30'])
  assert.deepEqual(filterTimePreference(slots, { ...interval, fromInclusive: false, toInclusive: true } as any).map(slot => slot.time), ['13:30', '17:30', '18:00'])
  for (const invalid of [{ ...interval, from: '19:00' }, { ...interval, to: '13:00' }, { ...interval, from: '25:00' },
    { ...interval, toInclusive: 'yes' }, { ...interval, extra: true }, { kind: 'range', from: '13:00', to: '18:00' }]) assert.throws(() => parseTimePreference(invalid))
})
await intervalCheck('single aggregate schema and classification', () => {
  assert.deepEqual(classifyTemporalRequest(intervalEvidence), { kind: 'preference', preference: interval })
  assert.deepEqual(fallbackTemporalRequest(intervalEvidence), { kind: 'preference', preference: interval })
  assert.equal(fallbackTemporalRequest('¿' + intervalEvidence + ' hay lugar?'), null)
  const schema = (TURN_PLAN_JSON_SCHEMA.properties.operations as any).items.anyOf.find((item: any) => item.properties.kind.enum.includes('time_preference'))
  const range = schema.properties.preference.anyOf.find((item: any) => item.properties.kind.enum.includes('range'))
  assert.ok(range, 'the real structured-output schema must expose the complete range')
  assert.equal(range.additionalProperties, false)
  assert.deepEqual([...range.required].sort(), ['kind', 'from', 'to', 'fromInclusive', 'toInclusive'].sort())
})
await intervalCheck('partial candidate and duplicate field stay rejected', () => {
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'after', time: '13:00' }, intervalEvidence)] }, intervalEvidence), 'a lower bound cannot represent the entire interval')
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'before', time: '18:00' }, 'antes de las 18')] }, intervalEvidence))
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'after', time: '13:00' }, 'después de las 13'), pref({ kind: 'before', time: '18:00' }, 'antes de las 18')] }, intervalEvidence))
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref(interval, 'otra evidencia')] }, intervalEvidence))
  assert.equal(parseTurnPlan({ version: 1, operations: [pref(interval, intervalEvidence)] }, intervalEvidence).operations.length, 1)
})
await intervalCheck('state roundtrip, offer and one-result non-selection', async () => {
  times = ['12:30', '13:00', '13:30', '17:30', '18:00']
  const offer = await say(offered.state, intervalEvidence, [pref(interval, intervalEvidence)])
  assert.deepEqual(offer.state.timePreference, interval)
  assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(offer.state)), context.businessId, context.timezone), offer.state)
  assert.equal(offer.state.requestedTime, null); assert.equal(offer.state.slot, null)
  assert.equal(offer.proposal, null); assert.equal(offer.bookingCommand, undefined)
  assert.deepEqual(offer.choicePresentation?.choices.filter(choice => choice.operation.kind === 'slot').map(choice => (choice.operation as { time: string }).time), ['13:00', '13:30', '17:30'])
  assert.match(offer.reply, /13:00/); assert.match(offer.reply, /18:00/)
  times = ['13:00']
  const singleInterval = await say(offer.state, intervalEvidence, [pref(interval, intervalEvidence)])
  assert.equal(singleInterval.state.slot, null); assert.equal(singleInterval.state.requestedTime, null)
  assert.equal(singleInterval.proposal, null); assert.equal(singleInterval.bookingCommand, undefined)
  const chosen = await say(singleInterval.state, 'a las 13', [{ kind: 'time', value: '13:00', ...ev('a las 13') }])
  assert.equal(chosen.state.slot?.time, '13:00'); assert.equal(chosen.state.timePreference, undefined)
})
await intervalCheck('weak and historical acts do not acquire an interval', async () => {
  const before = structuredClone(offered.state)
  for (const kind of ['reference', 'uncertain', 'request'] as const) {
    const confidence = kind === 'request' ? .6 : 1
    const result = await respondWithAiInterpreter(context, before, intervalEvidence, port, async () => ({
      ...legacy, turnPlan: { version: 1, operations: [pref(interval, intervalEvidence)] },
      communicativeActs: { version: 1, acts: [{ kind, field: 'time', evidence: intervalEvidence, confidence, mention: null, operationIndexes: [0] }] }
    }))
    assert.equal(result.interpretation.mode, 'ai', 'a well-shaped range is understood even when authority is withheld')
    assert.deepEqual(result.state.timePreference, before.timePreference)
    assert.equal(result.state.slot, null); assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
  }
  assert.deepEqual(offered.state, before, 'caller snapshot is not changed by a rejected temporal act')
})
await intervalCheck('preference button roundtrip and stale upper bound', async () => {
  const { issueChoiceQuestion, parseChoiceQuestion, resolveChoice } = await import('../src/conversational-bot/choices.js')
  const { preferenceOptionId, canonicalPreferenceOptionId } = await import('../src/conversational-bot/dialogue-choice-presentation.js')
  const operation = { kind: 'preference' as const, preference: interval as any }
  const scope = { businessId: context.businessId, conversationKey: 'range-test', policyKey: 'qa', policyGeneration: 1, revision: '1' }
  let tokenIndex = 0
  const draft = { requestedTime: null, slot: null, timePreference: interval }
  const question = issueChoiceQuestion(scope, draft, { kind: 'preference', title: 'Preferencia horaria', choices: [{ label: 'De 13 a antes de 18', operation }] }, () => 'range_token_0000_' + (++tokenIndex))
  const restoredQuestion = parseChoiceQuestion(JSON.parse(JSON.stringify(question)))
  const actionId = 'c1.' + restoredQuestion.nonce + '.' + restoredQuestion.choices[0]!.token
  assert.deepEqual(resolveChoice(restoredQuestion, scope, draft, actionId).operation, operation)
  assert.equal(canonicalPreferenceOptionId(preferenceOptionId(operation)), preferenceOptionId(operation))
  assert.throws(() => resolveChoice(restoredQuestion, scope, { ...draft, timePreference: { ...interval, to: '17:00' } }, actionId), /stale/)
  assert.equal(draft.slot, null); assert.equal(draft.requestedTime, null)
})
await intervalCheck('range forms and alternatives preserve semantics', () => {
  for (const evidence of ['entre las 13 y las 18', 'desde las 13 hasta las 18']) {
    assert.deepEqual(classifyTemporalRequest(evidence), { kind: 'preference', preference: { ...interval, toInclusive: true } })
    assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'after', time: '13:00' }, evidence)] }, evidence))
  }
  assert.deepEqual(classifyTemporalRequest('antes de las 18 y después de las 13'), { kind: 'preference', preference: interval })
  assert.deepEqual(classifyTemporalRequest('después de las 13 o antes de las 18'), { kind: 'ambiguous' })
  assert.deepEqual(classifyTemporalRequest('mañana después de las 13 y el domingo antes de las 18'), { kind: 'ambiguous' })
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ ...interval, to: '17:00' }, intervalEvidence)] }, intervalEvidence))
})
// A recognized alternative or contradiction cannot be admitted as one convenient half.
const ambiguousIntervals = [
  { message: 'después de las 13 o antes de las 18', preference: { kind: 'after', time: '13:00' }, evidence: 'después de las 13' },
  { message: 'después de las 13 o antes de las 18', preference: { kind: 'before', time: '18:00' }, evidence: 'antes de las 18' },
  { message: 'después de las 18 y antes de las 13', preference: { kind: 'after', time: '18:00' }, evidence: 'después de las 18' },
  { message: 'después de las 13 y antes de las 18 a las 17', preference: interval, evidence: intervalEvidence }
] as const
await intervalCheck('ambiguous candidates rejected by parser', () => {
  const failures: string[] = []
  for (const candidate of ambiguousIntervals) {
    try { assert.throws(() => parseTurnPlan({ version: 1, operations: [pref(candidate.preference, candidate.evidence)] }, candidate.message)) }
    catch (error) { failures.push(candidate.message + ' / ' + candidate.preference.kind + ': ' + String(error)) }
  }
  assert.deepEqual(failures, [], 'no partial preference represents recognized alternatives or contradictions')
})
await intervalCheck('ambiguous candidates never acquire authority through AI', async () => {
  const failures: string[] = []
  for (const candidate of ambiguousIntervals) {
    const before = structuredClone(offered.state)
    const readsBefore = reads
    const result = await respondWithAiInterpreter(context, before, candidate.message, port, async () => ({
      ...legacy, turnPlan: { version: 1, operations: [pref(candidate.preference, candidate.evidence)] },
      communicativeActs: { version: 1, acts: [{ kind: 'request', field: 'time', evidence: candidate.evidence, confidence: 1, mention: null, operationIndexes: [0] }] }
    }))
    try {
      assert.equal(result.interpretation.mode, 'ai')
      assert.equal(result.interpretation.reason, null)
      assert.deepEqual(result.interpretation.temporalGrounding, { outcome: 'field_rejected', field: 'time', reason: 'constraint_mismatch' })
      assert.equal(result.state.timePreference, undefined)
      assert.equal(result.state.timeMeaningClarification, true)
      assert.equal(reads, readsBefore)
      assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(result.state)), context.businessId), result.state)
      assert.equal(result.state.serviceId, before.serviceId)
      assert.equal(result.state.date, before.date)
      assert.deepEqual(result.state.professional, before.professional)
      assert.equal(result.state.customerName, before.customerName)
      assert.equal(result.state.slot, null); assert.equal(result.state.requestedTime, null)
      assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
      assert.deepEqual(offered.state, before)
    } catch (error) { failures.push(candidate.message + ' / ' + candidate.preference.kind + ': ' + String(error)) }
  }
  assert.deepEqual(failures, [], 'current explicit acts do not make incomplete candidates correct')
})
if (intervalFailures.length) throw new Error('Interval regressions: ' + intervalFailures.length + '\n' + intervalFailures.join('\n'))
console.log('PASS complete intervals: structured contract, filters, state and independent choice')

// V: operator and clock must agree; full-source validation precedes per-field rejection.
const vFailures: string[] = []
async function vCheck(label: string, check: () => void | Promise<void>) {
  try {
    await check()
    console.log('PASS V ' + label)
  } catch (error) {
    vFailures.push(label + ': ' + String(error))
    console.error('RED V ' + label + ': ' + String(error))
  }
}
const vMismatches: readonly (readonly [string, object])[] = [
  ['a las19', { kind: 'after', time: '19:00' }],
  ['antes de las19', { kind: 'after', time: '19:00' }],
  ['después de las17', { kind: 'before', time: '17:00' }],
  ['después de las17', { kind: 'after', time: '18:00' }],
  ['por la mañana', { kind: 'band', band: 'AFTERNOON' }],
  ['lo más temprano posible', { kind: 'any' }],
  ['entre las17 y las19', { kind: 'range', from: '17:00', to: '19:00', fromInclusive: true, toInclusive: false }]
]
await vCheck('strict canonical preference class and parameters', () => {
  for (const [body, preference] of vMismatches) {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [pref(preference, body)] }, body), body)
  }
  const body = 'alrededor de las17:00'
  assert.throws(() => parseTurnPlan({ version: 1, operations: [pref({ kind: 'after', time: '17:00' }, body)] }, body))
})
const vLowerBodies = [
  '17 en adelante', 'a las17 en adelante', '17hs en adelante',
  '17:30 en adelante', 'a las17:30hs\nen adelante', '17\t en adelante'
] as const
await vCheck('postposed boundary spans compose without a second exact clock', () => {
  for (const body of vLowerBodies) {
    const time = body.includes('17:30') ? '17:30' : '17:00'
    assert.deepEqual(classifyTemporalRequest(body, true), { kind: 'preference', preference: { kind: 'after', time } }, body)
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'time', value: time, ...ev(body) }] }, body))
  }
  assert.deepEqual(classifyTemporalRequest('13:30 en adelante y antes de las19'), {
    kind: 'preference', preference: { kind: 'range', from: '13:30', to: '19:00', fromInclusive: true, toInclusive: false }
  })
  assert.deepEqual(classifyTemporalRequest('17 en adelante o antes de las19'), { kind: 'ambiguous' })
})
const vAct = (kind: string, field: string, evidence: string, index: number, confidence = 1) => ({
  kind, field, evidence, operationIndexes: [index], mention: null, confidence
})
const vSay = (state: DialogueState, body: string, operations: object[], acts: object[]) =>
  respondWithAiInterpreter(context, state, body, port, async () => ({
    ...legacy, turnPlan: { version: 1, operations }, communicativeActs: { version: 1, acts }
  }))
times = ['13:00', '17:00', '17:30', '19:00']
const vSelected = await vSay(offered.state, 'a las13',
  [{ kind: 'time', value: '13:00', ...ev('a las13') }], [vAct('change', 'time', 'a las13', 0)])
assert.equal(vSelected.state.slot?.time, '13:00')
await vCheck('typed rejection persists, clears an old slot and retains independent fields', async () => {
  const body = 'a las19; domingo04/10; soy María; con Ramiro'
  const before = reads
  const result = await vSay(vSelected.state, body, [
    pref({ kind: 'after', time: '19:00' }, 'a las19'),
    { kind: 'date', expression: 'domingo04/10', value: '2026-10-04', ...ev('domingo04/10') },
    { kind: 'name', value: 'María', ...ev('María') }, specific
  ], [
    vAct('change', 'time', 'a las19', 0), vAct('change', 'date', 'domingo04/10', 1),
    vAct('change', 'name', 'soy María', 2), { ...vAct('change', 'professional', 'con Ramiro', 3), mention: 'Ramiro' }
  ])
  assert.equal(result.interpretation.mode, 'ai')
  assert.equal(result.interpretation.temporalGrounding?.outcome, 'field_rejected')
  assert.equal(result.state.timeMeaningClarification, true)
  assert.equal(result.state.requestedTime, null)
  assert.equal(result.state.slot, null)
  assert.equal(result.state.timePreference, undefined)
  assert.equal(result.state.date, '2026-10-04')
  assert.equal(result.state.customerName, 'María')
  // A new professional mention is retained as a hint, never a fresh ID without roster verification.
  assert.equal(result.state.professionalNameHint, 'ramiro')
  assert.equal(result.state.professional, null)
  assert.equal(result.state.sandboxReservation, undefined)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
  assert.equal(reads, before)
  const restored = parseDialogueState(JSON.parse(JSON.stringify(result.state)), context.businessId, context.timezone)
  const later = await vSay(restored, 'soy Laura', [{ kind: 'name', value: 'Laura', ...ev('Laura') }],
    [vAct('change', 'name', 'soy Laura', 0)])
  assert.equal(later.state.timeMeaningClarification, true)
  assert.equal(later.state.customerName, 'Laura')
  assert.equal(later.state.slot, null)
  assert.equal(reads, before)
  assert.doesNotMatch(later.reply, /mañana o de la tarde/)
})
await vCheck('all scalar mismatches reject time only without agenda or consent', async () => {
  for (const [body, preference] of vMismatches) {
    const before = reads
    const result = await vSay(vSelected.state, body, [pref(preference, body)], [vAct('change', 'time', body, 0)])
    assert.equal(result.interpretation.mode, 'ai', body)
    assert.equal(result.interpretation.temporalGrounding?.outcome, 'field_rejected', body)
    assert.equal(result.state.timeMeaningClarification, true, body)
    assert.equal(result.state.slot, null)
    assert.equal(reads, before)
    assert.equal(result.bookingCommand, undefined)
    assert.deepEqual(result.state.professional, vSelected.state.professional)
    assert.equal(result.state.date, vSelected.state.date)
    assert.equal(result.state.customerName, vSelected.state.customerName)
  }
})
await vCheck('weak historical wrong-field and weak operation cannot erase old time', async () => {
  const owners = [
    ['reference', 'time', 1, 1], ['uncertain', 'time', 1, 1], ['change', 'name', 1, 1],
    ['change', 'time', .5, 1], ['change', 'time', 1, .5]
  ] as const
  for (const [kind, field, confidence, opConfidence] of owners) {
    const body = 'a las19', before = reads
    const result = await vSay(vSelected.state, body,
      [{ ...pref({ kind: 'after', time: '19:00' }, body), confidence: opConfidence }],
      [vAct(kind, field, body, 0, confidence)])
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.slot?.time, '13:00')
    assert.equal(result.state.timeMeaningClarification, undefined)
    assert.equal(reads, before)
    assert.equal(result.bookingCommand, undefined)
  }
})
await vCheck('valid lower limits offer inclusive fresh options, even a singleton is not selection', async () => {
  for (const body of vLowerBodies) {
    times = body.includes('17:30') ? ['17:30'] : ['13:00', '17:00', '17:30']
    const time = body.includes('17:30') ? '17:30' : '17:00'
    const result = await vSay(offered.state, body, [pref({ kind: 'after', time }, body)], [vAct('change', 'time', body, 0)])
    assert.equal(result.interpretation.mode, 'ai')
    assert.deepEqual(result.state.timePreference, { kind: 'after', time })
    assert.equal(result.state.slot, null)
    assert.equal(result.state.requestedTime, null)
    assert.equal(result.proposal, null)
    assert.equal(result.bookingCommand, undefined)
    const slots = result.choicePresentation?.choices.filter(choice => choice.operation.kind === 'slot')
    assert.ok(slots?.length)
    assert.ok(slots.every(choice => choice.operation.kind === 'slot' && choice.operation.time >= time))
    assert.ok(slots.some(choice => choice.operation.kind === 'slot' && choice.operation.time === time))
  }
})
await vCheck('global malformed source and original indexes are never rescued', async () => {
  const malformedPlans = [
    [pref({ kind: 'after', time: '19:00' }, 'invented quote')],
    [pref({ kind: 'after', time: '19:00' }, 'a las19'), { kind: 'time', value: '19:00', ...ev('a las19') }],
    [pref({ kind: 'after', time: '19:00' }, 'a las19'),
      { kind: 'service', mode: 'single', serviceIds: ['foreign'], correction: false, ...ev('a las19') }]
  ]
  for (const malformed of malformedPlans) {
    const result = await vSay(vSelected.state, 'a las19', malformed, [vAct('change', 'time', 'a las19', 0)])
    assert.equal(result.interpretation.reason, 'invalid_output')
    assert.equal(result.interpretation.temporalGrounding, undefined)
    assert.equal(result.bookingCommand, undefined)
  }
  const invalidIndex = await vSay(vSelected.state, 'a las19', [pref({ kind: 'after', time: '19:00' }, 'a las19')],
    [vAct('change', 'time', 'a las19', 9)])
  assert.equal(invalidIndex.interpretation.reason, 'invalid_output')
  assert.equal(invalidIndex.interpretation.temporalGrounding, undefined)
})
await vCheck('no missing operation reconstruction or twelve-hour precision regression', async () => {
  const none = await vSay(vSelected.state, '17 en adelante', [], [])
  assert.equal(none.state.slot?.time, '13:00')
  assert.equal(none.state.timePreference, undefined)
  times = ['17:00']
  const afternoonBody = 'por la tarde'
  const afternoon = await vSay(offered.state, afternoonBody,
    [pref({ kind: 'band', band: 'AFTERNOON' }, afternoonBody)], [vAct('change', 'time', afternoonBody, 0)])
  assert.deepEqual(afternoon.state.timePreference, { kind: 'band', band: 'AFTERNOON' })
  const established = await vSay(afternoon.state, 'tipo 5',
    [pref({ kind: 'band', band: 'AFTERNOON' }, 'tipo 5')], [vAct('change', 'time', 'tipo 5', 0)])
  assert.deepEqual(established.state.timePreference, { kind: 'around', time: '17:00' })
  assert.equal(established.state.slot, null)
  assert.equal(established.bookingCommand, undefined)
})
await vCheck('owned approximation is not rejected by a disjoint orphan clock or granted authority', async () => {
  const body = 'Ana mañana pasado mañana 17:00 tipo 5 dirección Alisado Hasta los hombros Corte y barba pausa'
  const operation = pref({ kind: 'around', time: '17:00' }, 'tipo 5')
  const plan = parseTurnPlan({ version: 1, operations: [operation] }, body)
  for (const kind of ['notice', 'pause', 'repair']) {
    const metadata = parseCommunicativeActs({ version: 1, acts: [{
      kind, field: 'general', evidence: body, confidence: 1, mention: null, operationIndexes: []
    }] }, body, 1, plan)
    const admission = admitCommunicativePlan(metadata, plan, plan, body, vSelected.state, [])
    assert.deepEqual(admission.plan.operations, [])
    assert.deepEqual(admission.blockedFields, [])
    assert.equal(admission.continuity, kind)
    const before = reads
    const result = await vSay(vSelected.state, body, [operation], [{
      kind, field: 'general', evidence: body, confidence: 1, mention: null, operationIndexes: []
    }])
    assert.equal(result.state.slot?.time, '13:00')
    assert.equal(result.state.timeMeaningClarification, undefined)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(reads, before)
  }
  // Structural parsing alone does not authorize the operation; a current owner is still required.
  const history = 'Antes 17:00; ahora tipo 5'
  const historicalPlan = parseTurnPlan({ version: 1, operations: [operation] }, history)
  const metadata = parseCommunicativeActs({ version: 1, acts: [vAct('change', 'time', 'ahora tipo 5', 0)] }, history, 1, historicalPlan)
  const admission = admitCommunicativePlan(metadata, historicalPlan, historicalPlan, history, offered.state, [])
  assert.equal(admission.plan.operations.length, 1)
  for (const message of ['a las19, tipo 5', '19:00 tipo 5', '17:00 o tipo 5',
    '17:00 y tipo 5', '17:00 / tipo 5', '17:00 después de las13 y antes de las19 tipo 5',
    '17:00 tipo 5 tipo 5']) {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [operation] }, message), message)
  }
  assert.throws(() => parseTurnPlan({ version: 1, operations: [
    { kind: 'time', value: '18:00', ...ev('martes06/10 a las17:00 con Cin') }
  ] }, 'martes06/10 a las17:00 con Cin'), /clock value evidence/)
})
await vCheck('quote scoping cannot hide full-message bounds or clock alternatives', async () => {
  const compounds = [
    ['Alrededor de las17:00, pero antes de las19:00', { kind: 'around', time: '17:00' }, 'Alrededor de las17:00'],
    ['Después de las17 y antes de las19', { kind: 'after', time: '17:00' }, 'Después de las17'],
    ['Tipo17:00 o a las19:00', { kind: 'around', time: '17:00' }, 'Tipo17:00']
  ] as const
  for (const [body, preference, quote] of compounds) {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [pref(preference, quote)] }, body), body)
    for (const kind of ['change', 'reference', 'uncertain']) {
      const message = body + '; soy Laura'
      const before = reads
      const result = await vSay(vSelected.state, message, [
        pref(preference, quote), { kind: 'name', value: 'Laura', ...ev('Laura') }
      ], [vAct(kind, 'time', body, 0), vAct('change', 'name', 'soy Laura', 1)])
      assert.equal(result.interpretation.mode, 'ai')
      assert.equal(result.interpretation.temporalGrounding?.outcome, 'field_rejected')
      assert.equal(result.state.customerName, 'Laura')
      assert.deepEqual(result.state.professional, vSelected.state.professional)
      assert.equal(result.state.date, vSelected.state.date)
      assert.equal(result.state.timeMeaningClarification, kind === 'change' ? true : undefined)
      assert.equal(result.state.slot?.time ?? null, kind === 'change' ? null : '13:00')
      assert.equal(result.bookingCommand, undefined)
      assert.equal(reads, before)
    }
  }
  assert.ok(vLowerBodies.some(body => body.includes('\n')))
  assert.ok(vLowerBodies.some(body => body.includes('\t')))
})
await vCheck('current period clarification owns meaning without hiding another request', async () => {
  const pair: DialogueState = {
    ...offered.state, timeClarification: { candidateTimes: ['04:00', '16:00'] }
  }
  delete pair.timePreference
  const body = 'de la tarde obviamente, quien se va a cortar a las 4 de la mañana'
  const operation = { kind: 'time_clarification', candidateTimes: ['04:00', '16:00'], ...ev('de la tarde') }
  times = ['16:00', '17:00', '19:00']
  const result = await vSay(pair, body, [operation], [vAct('answer', 'time', 'de la tarde', 0)])
  assert.equal(result.interpretation.mode, 'ai')
  assert.deepEqual(result.state.timePreference, { kind: 'around', time: '16:00' })
  assert.equal(result.state.slot, null)
  assert.equal(result.state.requestedTime, null)
  assert.equal(result.bookingCommand, undefined)
  for (const message of [body + '; quiero a las19', body + '; después de las17',
    'de la tarde o de la mañana', body + '; o a las19:00']) {
    const blocked = await vSay(pair, message, [operation], [vAct('answer', 'time', 'de la tarde', 0)])
    assert.notDeepEqual(blocked.state.timePreference, { kind: 'around', time: '16:00' }, message)
    assert.equal(blocked.state.slot, null)
    assert.equal(blocked.bookingCommand, undefined)
  }
  for (const kind of ['reference', 'uncertain']) {
    const weak = await vSay(pair, body, [operation], [vAct(kind, 'time', 'de la tarde', 0)])
    assert.deepEqual(weak.state.timeClarification, pair.timeClarification)
    assert.equal(weak.state.timePreference, undefined)
    assert.equal(weak.bookingCommand, undefined)
  }
  for (const [message, time] of [
    [body, '17:00'], [body.replace('las 4 ', 'las 4:30 '), '16:00'],
    [body + '; quiero a las19', '16:00'], [body + '; después de las17', '16:00'],
    [body + '; no a las18', '16:00'], [body + '; o de la mañana', '16:00']
  ] as const) {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [
      pref({ kind: 'around', time }, 'de la tarde')
    ] }, message), message + ' / ' + time)
  }
  const noOperation = await vSay(pair, body, [], [])
  assert.deepEqual(noOperation.state.timeClarification, pair.timeClarification)
  assert.equal(noOperation.state.timePreference, undefined)
  assert.equal(noOperation.state.slot, null)
  assert.equal(noOperation.bookingCommand, undefined)
  const absent = await vSay(offered.state, body, [operation], [vAct('answer', 'time', 'de la tarde', 0)])
  assert.notDeepEqual(absent.state.timePreference, { kind: 'around', time: '16:00' })
  const otherPair: DialogueState = { ...pair, timeClarification: { candidateTimes: ['05:00', '17:00'] } }
  const foreign = await vSay(otherPair, body, [operation], [vAct('answer', 'time', 'de la tarde', 0)])
  assert.notDeepEqual(foreign.state.timePreference, { kind: 'around', time: '16:00' })
  assert.equal(foreign.state.slot, null)
  assert.equal(foreign.bookingCommand, undefined)
})
assert.deepEqual(vFailures, [], 'V canonical temporal constraints')
