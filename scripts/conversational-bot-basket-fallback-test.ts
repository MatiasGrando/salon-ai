import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { rememberDialogueQuestion } from '../src/conversational-bot/dialogue-context.js'
import { basketServiceIds, selectionBasket } from '../src/conversational-bot/service-basket.js'
import { providerError } from '../src/conversational-bot/provider-error.js'
import { serviceConfigurationKey } from '../src/bot-options/domain/service-booking.js'

const context = { businessId: 'basket-fallback-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z'), sandboxBooking: true }
const cut: DialogueService = { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 100, requiresConsultation: false }
const woman: DialogueService = { ...cut, id: 'woman', name: 'Corte mujer' }
const smooth: DialogueService = { id: 'smooth', name: 'Alisado', durationMinutes: 90, price: 200, priceMode: 'STARTING_AT', requiresConsultation: false, bookingPolicy: {
  id: 'smooth', name: 'Alisado', attentionMode: 'GUIDED_ESTIMATE', price: 200, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué largo tiene tu cabello?', estimateOptions: [
    { id: 'short', label: 'Hasta los hombros', priceMin: 200, priceMax: 300, note: null },
    { id: 'long', label: 'Debajo de los hombros', priceMin: 300, priceMax: 400, note: null }
  ], estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null
} }
let services = [cut, woman, smooth, { ...cut, id: 'other', name: 'Barba hombre' }]
let agendaCalls = 0
const port: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date) => {
    agendaCalls++
    return { professionals: [{ id: 'cin', name: 'Cin', priority: 0 }], slots: [
      { date, time: '17:00', startAt: date + 'T20:00:00Z', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON', occupiedMinutes: 0 }
    ] }
  },
  availabilityBasket: async () => { agendaCalls++; return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' } }
}
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const first = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Corte y Alisado mañana soy Matías con Cin', port, async () => ({
  intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [
    { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [
      { mode: 'alternatives', serviceIds: ['cut', 'woman'], ...ev('Corte') },
      { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }
    ], ...ev('Corte y Alisado') },
    { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') },
    { kind: 'name', value: 'Matías', ...ev('Matías') },
    { kind: 'professional', mode: 'specific', mention: 'Cin', ...ev('Cin') }
  ] }
}))
assert.equal(first.state.pending, 'service')
assert.deepEqual(first.state.questionContext?.options.map(item => item.id), ['cut', 'woman'])
const initialBasket = selectionBasket(first.state)
const target = initialBasket.members[0]!.memberId
const companion = initialBasket.members[1]!
const fail: AiInterpretationProvider = async () => { throw providerError('shape', new Response(null, { status: 200 }), { reason: 'message_ambiguous', responseStatus: 'completed', messageCount: 2 }) }
const invalid: AiInterpretationProvider = async () => []
const slow: AiInterpretationProvider = async () => new Promise(() => {})
const fallback = (state: DialogueState, message: string, provider = fail) => respondWithAiInterpreter(context, state, message, port, provider, { timeoutMs: 2 })
function retained(state: DialogueState) {
  assert.deepEqual(selectionBasket(state).members[1], companion, 'the exact companion and its stable ID survive')
  assert.equal(state.customerName, 'Matías')
  assert.equal(state.date, '2026-10-03')
  assert.equal(state.professionalNameHint, 'cin')
  assert.equal(state.requestedTime, first.state.requestedTime)
  assert.deepEqual(parseDialogueState(state, context.businessId), state)
}
for (const [provider, reason] of [[fail, 'provider_error'], [invalid, 'invalid_output'], [slow, 'timeout']] as const) {
  for (const message of ['corte hombre', 'hombre', 'CORTE HÓMBRE']) {
    const result = await fallback(first.state, message, provider)
    assert.deepEqual(basketServiceIds(result.state), ['cut', 'smooth'], reason + '/' + message + ': resolve only the actually presented alternative')
    assert.equal(selectionBasket(result.state).members[0]!.mode, 'single')
    assert.equal(result.state.pending, 'estimate', 'straightening guidance still has priority over the saved date')
    assert.match(result.reply, /largo|hombros/)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(result.proposal, null)
    assert.equal(result.interpretation.reason, reason)
    assert.equal(result.interpretation.mode, 'fallback')
    assert.equal(result.interpretation.decision.acceptedAction, 'deterministic_fallback')
    retained(result.state)
  }
}
assert.equal(agendaCalls, 0, 'rescuing a service choice never bypasses a required guide')

const ambiguous = await fallback(first.state, 'corte')
assert.deepEqual(selectionBasket(ambiguous.state), initialBasket)
assert.match(ambiguous.reply, /Corte hombre/)
assert.match(ambiguous.reply, /Corte mujer/)
assert.deepEqual(ambiguous.state.questionContext?.options.map(item => item.id), ['cut', 'woman'])
assert.equal((await fallback(ambiguous.state, 'sí')).state.basket?.members[0]?.mode, 'alternatives', 'yes cannot choose between multiple candidates')
assert.deepEqual(basketServiceIds((await fallback(ambiguous.state, 'mujer')).state), ['woman', 'smooth'])

const typo = await fallback(first.state, 'cortee hombre')
assert.deepEqual(selectionBasket(typo.state), initialBasket, 'fuzzy matching proposes, never applies')
assert.match(typo.reply, /¿Te referís a Corte hombre\?/)
assert.deepEqual(typo.state.questionContext?.matchCandidateIds, ['cut'])
assert.equal(typo.state.questionContext?.matchTargetMemberId, target)
retained(typo.state)
assert.deepEqual(selectionBasket((await fallback(typo.state, 'cortee hombre')).state), initialBasket, 'repeating a typo is not confirmation')
const confirmed = await fallback(typo.state, 'sí')
assert.deepEqual(basketServiceIds(confirmed.state), ['cut', 'smooth'])
assert.equal(confirmed.state.pending, 'estimate')
assert.equal(confirmed.bookingCommand, undefined, 'candidate yes is not consent to book')
assert.equal(confirmed.proposal, null)
retained(confirmed.state)

for (const state of [first.state, typo.state]) {
  for (const message of ['no', 'no hombre', 'no corte hombre', 'sí pero no corte hombre', 'sí?', '¿corte hombre?', 'soy hombre', 'hombre mañana', 'hombre 17:00', 'hombre y mujer', 'hola', 'precio corte hombre']) {
    const result = await fallback(state, message)
    assert.deepEqual(selectionBasket(result.state), initialBasket, 'closed-answer guard: ' + message)
    assert.equal(result.bookingCommand, undefined)
    retained(result.state)
  }
}

const noQuestion = structuredClone(first.state)
delete noQuestion.questionContext
assert.deepEqual(selectionBasket((await fallback(noQuestion, 'hombre')).state), initialBasket, 'legacy basket alone is not evidence of presented options')
const incomplete = structuredClone(first.state)
incomplete.questionContext = { ...incomplete.questionContext!, complete: false, options: [] }
delete incomplete.questionContext.matchCandidateIds
delete incomplete.questionContext.matchTargetMemberId
assert.deepEqual(selectionBasket((await fallback(incomplete, 'hombre')).state), initialBasket)
const expired = { ...structuredClone(first.state), date: '2026-10-04' }
assert.deepEqual(selectionBasket((await fallback(expired, 'hombre')).state), initialBasket, 'changed dependent scope expires the question')
const unpresented = structuredClone(first.state)
rememberDialogueQuestion(unpresented, '¿Cuál elegís?', [{ id: 'woman', label: 'Corte mujer' }])
assert.deepEqual(selectionBasket((await fallback(unpresented, 'hombre')).state), initialBasket, 'catalog presence is not presentation')
const unrelated = structuredClone(first.state)
rememberDialogueQuestion(unrelated, '¿Cuál elegís?', [{ id: 'other', label: 'Barba hombre' }])
assert.deepEqual(selectionBasket((await fallback(unrelated, 'hombre')).state), initialBasket, 'presented IDs outside the pending group grant no mutation')
const collision = structuredClone(first.state)
collision.basket!.members.push({ memberId: 'm3', mode: 'alternatives', serviceIds: ['other', 'fourth'], evidence: 'Barba' })
collision.basket!.nextMemberId = 4
services.push({ ...woman, id: 'fourth', name: 'Barba mujer' })
rememberDialogueQuestion(collision, '¿Cuál elegís?', [{ id: 'cut', label: 'Corte hombre' }, { id: 'other', label: 'Barba hombre' }])
assert.deepEqual(selectionBasket((await fallback(collision, 'hombre')).state), selectionBasket(collision), 'unscoped options intersecting two members are not uniquely targeted')
const foreign = structuredClone(first.state)
foreign.questionContext!.businessId = 'foreign'
await assert.rejects(fallback(foreign, 'hombre'), /invalid question context/)

const savedServices = services
services = services.filter(item => item.id !== 'cut')
assert.deepEqual(selectionBasket((await fallback(first.state, 'hombre')).state), initialBasket, 'removed options are never selected')
assert.deepEqual(selectionBasket((await fallback(typo.state, 'sí')).state), initialBasket, 'confirmation rechecks the current catalog')
services = savedServices.map(item => item.id === 'cut' ? { ...item, name: 'Otro servicio' } : item)
assert.deepEqual(selectionBasket((await fallback(first.state, 'hombre')).state), initialBasket, 'renamed labels expire presentation evidence')
assert.deepEqual(selectionBasket((await fallback(typo.state, 'sí')).state), initialBasket)
services = savedServices

const estimated = structuredClone(first.state)
estimated.serviceEstimates = { smooth: { configurationKey: serviceConfigurationKey(smooth.bookingPolicy!), optionId: 'short' } }
const estimateChoice = await fallback(estimated, 'hombre')
assert.deepEqual(estimateChoice.state.serviceEstimates, estimated.serviceEstimates, 'a valid companion estimate survives scoped replacement')
assert.deepEqual(basketServiceIds(estimateChoice.state), ['cut', 'smooth'])
retained(estimateChoice.state)


const refreshed = await fallback(noQuestion, 'corte hombre')
assert.deepEqual(selectionBasket(refreshed.state), initialBasket, 'an old snapshot is refreshed by showing choices, not assuming they were shown')
assert.deepEqual(refreshed.state.questionContext?.options.map(item => item.id), ['cut', 'woman'])
assert.match(refreshed.reply, /Corte hombre/)
assert.match(refreshed.reply, /Corte mujer/)
assert.deepEqual(basketServiceIds((await fallback(refreshed.state, 'hombre')).state), ['cut', 'smooth'])

const specific = structuredClone(first.state)
specific.professional = { kind: 'specific', id: 'cin' }
rememberDialogueQuestion(specific, '¿Cuál de estos servicios querés?', [{ id: 'cut', label: 'Corte hombre' }, { id: 'woman', label: 'Corte mujer' }])
const specificChoice = await fallback(specific, 'hombre')
assert.deepEqual(specificChoice.state.professional, specific.professional, 'independent professional selection survives')
assert.equal(specificChoice.state.professionalNameHint, 'cin')
assert.equal(specificChoice.state.pending, 'estimate')

services.push({ ...cut, id: 'cut-barba', name: 'Corte barba' })
const single = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'quiero un corte para mañana', port, async () => ({
  intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [
    { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [
      { mode: 'alternatives', serviceIds: ['cut', 'woman', 'cut-barba'], ...ev('corte') }
    ], ...ev('corte') },
    { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }
  ] }
}))
assert.deepEqual(single.state.questionContext?.options.map(item => item.id), ['cut', 'woman', 'cut-barba'])
assert.equal(single.state.customerName, null)
for (const message of ['corte hombre', 'hombre']) {
  const result = await fallback(single.state, message)
  assert.deepEqual(basketServiceIds(result.state), ['cut'], 'single basket resolves the same presented-choice contract')
  assert.equal(result.state.serviceId, 'cut')
  assert.equal(result.state.basket?.members.length, 1)
  assert.equal(result.state.date, '2026-10-03')
  assert.equal(result.state.customerName, null)
  assert.equal(result.bookingCommand, undefined)
}

console.log('conversational basket fallback tests passed')
