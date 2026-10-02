import assert from 'node:assert/strict'
import { evaluateCases, type EvalBundle } from './glow-offline-eval.js'
const other = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
const booking = { ...other, intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte' }
const corpus = [{ conversationId: 'glow-001', customerCode: 'WX-QG5FQA', cutoffExclusive: '2026-09-02T16:28:39.631Z', messages: [
  { messageId: 'glow-001-m0001', direction: 'INBOUND', body: 'Corte', createdAt: '2026-08-20T12:00:00Z', hasMedia: false, isInteractiveReply: false },
  { messageId: 'glow-001-m0002', direction: 'INBOUND', body: 'Gracias', createdAt: '2026-08-20T12:01:00Z', hasMedia: false, isInteractiveReply: false },
  { messageId: 'glow-001-m0003', direction: 'OUTBOUND', body: 'Mensaje anterior', createdAt: '2026-08-20T12:02:00Z', hasMedia: false, isInteractiveReply: false }
] }]
const fixture = { businessId: 'qa-glow', timezone: 'America/Argentina/Buenos_Aires', services: [
  { id: 'cut', name: 'Corte', durationMinutes: 30, price: 1000, requiresConsultation: false }
], professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [] }
const first = { id: 'first', fixtureId: 'salon', sourceConversationId: 'glow-001', turns: [
  { sourceMessageId: 'glow-001-m0001', oracle: booking, expected: { state: { serviceId: 'cut', pending: 'date' }, proposal: false } },
  { sourceMessageId: 'glow-001-m0002', oracle: other, expected: { state: { serviceId: 'cut' }, proposal: false } }
] }
const bundle = { schemaVersion: 1, fixtures: { salon: fixture }, cases: [first,
  { id: 'isolated', fixtureId: 'salon', sourceConversationId: 'glow-001', turns: [
    { sourceMessageId: 'glow-001-m0002', oracle: other, expected: { state: { serviceId: null }, proposal: false } }
  ] }
] }
const result = await evaluateCases(bundle, corpus)
assert.equal(result.mode, 'controlled_interpretation_real_motor')
assert.equal(result.turnsRun, 3)
assert.equal(result.failed, 0)
assert.equal(result.cases.length, 2)
assert.deepEqual(await evaluateCases(bundle, corpus), result, 'repeated offline runs must be reproducible')
const wrong = structuredClone(bundle)
wrong.cases[0]!.turns[0]!.expected.state.serviceId = 'missing'
const penalized = await evaluateCases(wrong, corpus)
assert.equal(penalized.failed, 1, 'wrong expectations must not receive a pass')
assert.ok(penalized.cases[0]!.turns[0]!.failures.includes('state.serviceId'))
const outbound = structuredClone(bundle)
outbound.cases[0]!.turns[0]!.sourceMessageId = 'glow-001-m0003'
await assert.rejects(evaluateCases(outbound, corpus), /inbound/)
const late = structuredClone(corpus)
late[0]!.messages[0]!.createdAt = late[0]!.cutoffExclusive
await assert.rejects(evaluateCases(bundle, late), /cutoff/)
const crossTenant = structuredClone(bundle) as any
crossTenant.cases[0].initialState = { businessId: 'foreign' }
await assert.rejects(evaluateCases(crossTenant, corpus), /initial state/)
const missing = structuredClone(bundle)
missing.cases[0]!.fixtureId = 'unknown'
await assert.rejects(evaluateCases(missing, corpus), /fixture/)
const unscored = structuredClone(bundle) as any
unscored.cases[0].turns[0].expected = {}
await assert.rejects(evaluateCases(unscored, corpus), /expectations/)
const invented = structuredClone(bundle)
invented.cases[0]!.turns[0]!.sourceMessageId = 'glow-001-m9999'
await assert.rejects(evaluateCases(invented, corpus), /source/)
const reverse = structuredClone(bundle)
reverse.cases[0]!.turns.reverse()
await assert.rejects(evaluateCases(reverse, corpus), /chronological/)
assert.equal(JSON.stringify(bundle).includes('failed'), false, 'input annotations remain unchanged')
const basketExpectation = structuredClone(bundle) as any
basketExpectation.cases[0].turns[0].expected.basketServiceIds = ['cut']
assert.equal((await evaluateCases(basketExpectation, corpus)).failed, 0, 'basket expectations must inspect the actual selection')
const datedCorpus = structuredClone(corpus)
datedCorpus[0]!.messages[0]!.body = 'Corte mañana'
const dated = structuredClone(bundle) as any
dated.cases = [dated.cases[0]]; dated.cases[0].turns = [dated.cases[0].turns[0]]
dated.cases[0].turns[0].oracle = { ...other, intent: 'booking', turnPlan: { version: 1, operations: [
  { kind: 'service', evidence: 'Corte', confidence: 1, mode: 'single', serviceIds: ['cut'], correction: false },
  { kind: 'date', evidence: 'mañana', confidence: 1, expression: 'mañana' }
] } }
dated.cases[0].turns[0].expected = { state: { serviceId: 'cut', date: '2026-08-21' }, proposal: false }
dated.fixtures.salon.slots = [{ date: '2026-08-21', time: '14:00', startAt: '2026-08-21T17:00:00Z', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON', occupiedMinutes: 0 }]
const datedResult = await evaluateCases(dated, datedCorpus)
assert.equal(datedResult.failed, 0, 'relative dates must use the historical message clock')
const invalidOracle = structuredClone(bundle) as any
invalidOracle.cases[0].turns[0].oracle = { ...booking, serviceId: 'foreign' }
assert.ok((await evaluateCases(invalidOracle, corpus)).failed > 0, 'invalid controlled output cannot masquerade as a success')
const unsupportedCorpus = structuredClone(corpus)
unsupportedCorpus[0]!.messages[0]!.body = 'Quiero cancelar'
const unsupported = structuredClone(dated) as any
unsupported.cases[0].turns[0].oracle = { ...other, turnPlan: { version: 1, operations: [
  { kind: 'unsupported_action', evidence: 'cancelar', confidence: 1, action: 'CANCEL' }
] } }
unsupported.cases[0].turns[0].expected = { proposal: false, replyIncludes: ['todavía no está disponible'] }
assert.equal((await evaluateCases(unsupported, unsupportedCorpus)).failed, 0, 'pending operations must be disclosed without real effects')
console.log('Glow offline evaluator: PASS (isolation, reproducibility, failure reporting, source and cutoff guards)')

const injectedBundle = structuredClone(bundle) as EvalBundle
injectedBundle.cases = [injectedBundle.cases[0]!]; injectedBundle.cases[0]!.turns = [injectedBundle.cases[0]!.turns[0]!]
injectedBundle.cases[0]!.turns[0]!.oracle = other // Poison the oracle: the supplied provider must be the only interpretation source.
let providerCalls = 0
const spyProvider = async (request: unknown) => {
  providerCalls++
  assert.deepEqual(Object.keys(request as object).sort(), ['businessDate','firstReplyFacts','intakeReplyAllowed','message','services','state','timezone'].sort())
  return booking
}
const injected = await evaluateCases(injectedBundle, corpus, { provider: spyProvider, timeoutMs: 4500 })
assert.equal(providerCalls, 1, 'injected provider must run instead of the annotation oracle')
assert.equal(injected.failed, 0)
assert.equal(injected.mode, 'external_provider_real_motor')
assert.equal(injected.comprehensionEvaluated, true)
assert.equal(injected.cases[0]!.turns[0]!.diagnostics?.reason, null)
const unavailable = await evaluateCases(injectedBundle, corpus, { provider: async () => { throw new Error('do not expose') } })
assert.equal(unavailable.comprehensionEvaluated, false, 'fallback cannot count as model comprehension')
assert.equal(unavailable.cases[0]!.turns[0]!.diagnostics?.reason, 'provider_error')
assert.ok(unavailable.cases[0]!.turns[0]!.failures.includes('interpretationMode'))
assert.equal(JSON.stringify(unavailable).includes('do not expose'), false)
let invalidCalls = 0
await assert.rejects(evaluateCases(outbound, corpus, { provider: async () => { invalidCalls++; return booking } }), /inbound/)
assert.equal(invalidCalls, 0, 'source guards must run before external provider invocation')
const timedOut = await evaluateCases(injectedBundle, corpus, { provider: async () => new Promise(resolve => setTimeout(() => resolve(booking), 30)), timeoutMs: 1 })
assert.equal(timedOut.cases[0]!.turns[0]!.diagnostics?.reason, 'timeout', 'caller timeout must be preserved and reported')
console.log('Glow provider injection: PASS (oracle isolation, source guards, diagnostics, fallback, caller timeout)')
