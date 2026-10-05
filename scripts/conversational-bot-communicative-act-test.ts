import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { applyBasketMutation, parseServiceBasket, selectionBasket } from '../src/conversational-bot/service-basket.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

// Offline behavior regressions through the existing public entry point. Controlled
// provider outputs are proposals, not proof that a live model understood a message.
// No runtime, corpus, persistence, reservation adapter or real provider is changed.
const context = { businessId: 'communicative-act-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-05T15:00:00Z') }
const cuts: DialogueService[] = [
  { id: 'cut-m', name: 'Corte hombre', durationMinutes: 30, price: 27000, requiresConsultation: false },
  { id: 'cut-w', name: 'Corte mujer', durationMinutes: 30, price: 37000, requiresConsultation: false },
  { id: 'cut-b', name: 'Corte y barba', durationMinutes: 45, price: 32000, requiresConsultation: false }
]
const policy: ServiceBookingPolicy = {
  id: 'smooth', name: 'Alisado', attentionMode: 'GUIDED_ESTIMATE', price: 85000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué largo tiene tu cabello?', estimateOptions: [{ id: 'shoulders', label: 'Hasta los hombros', priceMin: 85000, priceMax: 95000, note: null }],
  estimateExplanation: 'El presupuesto depende del largo.', estimateDisclaimer: 'Presupuesto estimado.', requiresPhoto: false,
  validationEnabled: false, validationMessage: null, validationQuestion: null
}
const smooth: DialogueService = { id: 'smooth', name: 'Alisado', durationMinutes: 90, price: 85000, requiresConsultation: false, bookingPolicy: policy }
const services = [...cuts, smooth]
const facts: BusinessFacts = {
  businessId: context.businessId, name: 'QA unitario', address: 'Calle de prueba 123', area: null, mapsUrl: null, website: null,
  bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Martes a sábado de 11:00 a 20:00'
}
let agendaCalls = 0, professionalReads = 0, providerCalls = 0, networkCalls = 0
const port: DialoguePort = {
  catalog: async () => services,
  information: async () => facts,
  professionalInformation: async () => {
    professionalReads++
    return { businessId: context.businessId, complete: true, professionals: [] }
  },
  availability: async () => { agendaCalls++; return { professionals: [], slots: [] } },
  availabilityBasket: async selected => {
    agendaCalls++
    return { ok: true, services: selected, durationMinutes: selected.reduce((sum, item) => sum + item.durationMinutes!, 0), totalPrice: null, professionals: [], slots: [] }
  }
}
const ev = (evidence: string) => ({ evidence, confidence: .99 })
const member = (mode: string, serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...ev(evidence) })
const basket = (mutation: string, members: object[], evidence: string, targets: string[] = []) => ({
  kind: 'basket', mutation, scope: targets.length ? 'members' : 'all', targetMemberIds: targets, members, ...ev(evidence)
})
const candidate = (operations: object[], intent = 'booking') => ({
  intent, serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [],
  serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null, turnPlan: { version: 1, operations }
})
async function say(state: DialogueState, message: string, output: unknown, dialoguePort: DialoguePort = port) {
  const supplied = structuredClone(state), before = structuredClone(supplied)
  const provider: AiInterpretationProvider = async () => { providerCalls++; return structuredClone(output) }
  const result = await respondWithAiInterpreter(context, supplied, message, dialoguePort, provider)
  assert.deepEqual(supplied, before, 'evaluation must not mutate the supplied previous state')
  assert.equal(result.interpretation.interpretationProviderError, null, 'controlled provider must not fabricate an HTTP/provider failure')
  assert.equal(result.proposal, null, 'these fixtures cannot produce a booking proposal')
  return result
}
let passed = 0
const failures: string[] = []
async function check(name: string, assertion: () => void | Promise<void>) {
  try { await assertion(); passed++; console.log('PASS ' + name) }
  catch (error) {
    failures.push(name)
    console.error('RED ' + name + ': ' + (error instanceof Error ? error.message.split('\n')[0] : String(error)))
  }
}
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { networkCalls++; throw new Error('real network forbidden in communicative-act unit fixture') }
try {
  const initial = { ...initialDialogueState(context.businessId), introduced: true }
  const first = await say(initial, 'Quería pedirles turno para corte, por favor', candidate([
    basket('set', [member('alternatives', cuts.map(item => item.id), 'corte')], 'turno para corte')
  ]))
  await check('initial cut request preserves all three alternatives', () => {
    assert.equal(first.interpretation.mode, 'ai')
    assert.equal(first.state.basket?.members[0]?.mode, 'alternatives')
    assert.deepEqual(first.state.basket?.members[0]?.serviceIds, cuts.map(item => item.id))
    assert.equal(agendaCalls, 0)
  })
  const groupId = first.state.basket!.members[0]!.memberId
  const history = 'Me cortó Cristian las últimas veces'
  // Causal reproduction of the observed wrong action, without replaying a live
  // customer/provider request: a quoted verb does not authorize service replacement.
  const wrong = candidate([basket('replace', [member('single', [cuts[0]!.id], 'cortó')], history, [groupId])])
  const historical = await say(first.state, history, wrong)
  console.log('OBSERVED historical replacement ' + JSON.stringify({
    validation: historical.interpretation.validation?.outcome,
    beforeModes: selectionBasket(first.state).members.map(item => item.mode),
    afterModes: selectionBasket(historical.state).members.map(item => item.mode),
    beforeCandidates: selectionBasket(first.state).members.map(item => item.serviceIds.length),
    afterCandidates: selectionBasket(historical.state).members.map(item => item.serviceIds.length)
  }))
  await check('historical professional reference must not replace the pending service', () => {
    assert.deepEqual(historical.state.basket, first.state.basket, 'historical reference is not permission to replace a service group')
  })
  await check('unaccredited destructive proposal keeps the previous clarification target', () => {
    assert.deepEqual(historical.state.questionContext, first.state.questionContext, 'clarification must be tentative, not overwrite the previously asked service choices')
  })
  await check('historical reference never proves current staff identity or booking availability', () => {
    assert.equal(historical.state.professional, null)
    assert.equal(historical.state.slot, null)
    assert.equal(agendaCalls, 0)
    assert.equal(professionalReads, 0)
  })

  // Existing professional operation is tested independently of model recognition:
  // an unknown literal name can remain an unverified hint while service is ambiguous.
// This is current operation compatibility, not acceptance of history as a present
// preference. The modular act contract must distinguish those before compiling it.
  for (const message of [history, 'Quiero atenderme con Cristian']) {
    const preferred = await say(first.state, message, candidate([{ kind: 'professional', mode: 'specific', mention: 'Cristian', ...ev('Cristian') }]))
    await check('independent professional hint preserves service ambiguity: ' + message, () => {
      assert.deepEqual(preferred.state.basket, first.state.basket)
      assert.equal(preferred.state.professionalNameHint, 'cristian')
      assert.equal(preferred.state.professional, null)
      assert.equal(preferred.state.customerName, null)
      assert.equal(agendaCalls, 0)
      assert.equal(professionalReads, 0)
      assert.doesNotMatch(preferred.reply, /Cristian (?:atiende|trabaja|tiene disponibilidad)|reservad[oa]/i)
    })
  }

  const rich: DialogueState = {
    ...structuredClone(first.state), date: '2026-10-06', customerName: 'Matías', timePreference: { kind: 'after', time: '13:00' },
    basket: { version: 1, nextMemberId: 3, members: [...selectionBasket(first.state).members, { memberId: 'm2', mode: 'single', serviceIds: [smooth.id], evidence: 'alisado' }] },
    serviceEstimates: { [smooth.id]: { configurationKey: serviceConfigurationKey(policy), optionId: 'shoulders' } }
  }
  const richHistory = await say(rich, history, wrong)
  await check('historical reference preserves group, companion and configured estimate', () => {
    assert.deepEqual(richHistory.state.basket, rich.basket)
    assert.deepEqual(richHistory.state.serviceEstimates, rich.serviceEstimates)
  })
  await check('historical reference preserves independent date, name and time preference', () => {
    assert.equal(richHistory.state.date, rich.date)
    assert.equal(richHistory.state.customerName, rich.customerName)
    assert.deepEqual(richHistory.state.timePreference, rich.timePreference)
    assert.equal(richHistory.state.slot, null)
  })
  const wrongAll = await say(rich, history, candidate([basket('replace', [member('single', [cuts[0]!.id], 'cortó')], history)]))
  await check('unaccredited all-scope replacement cannot discard companions or their guides', () => {
    assert.deepEqual(wrongAll.state.basket, rich.basket)
    assert.deepEqual(wrongAll.state.serviceEstimates, rich.serviceEstimates)
  })

  // A literal public service name in a past experience is still not a current
  // selection. This prevents an implementation limited to the verb/name above.
  const exactHistoryMessage = 'La última vez me hice Corte mujer. Ahora quiero saber los horarios del local'
  const exactHistory = await say(first.state, exactHistoryMessage, candidate([
    basket('replace', [member('single', [cuts[1]!.id], 'Corte mujer')], 'La última vez me hice Corte mujer', [groupId]),
    { kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, ...ev('horarios del local') }
  ], 'information'))
  await check('historical exact service identity does not authorize a current service change', () => {
    assert.deepEqual(exactHistory.state.basket, first.state.basket)
    assert.match(exactHistory.reply, /11:00|20:00/)
  })

  for (const message of ['Mejor quiero Corte hombre', 'Antes me hacía Corte mujer; ahora quiero Corte hombre']) {
    const changed = await say(first.state, message, candidate([
      basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], message, [groupId])
    ]))
    await check('an explicit current choice remains valid: ' + message, () => {
      assert.equal(changed.interpretation.mode, 'ai')
      assert.equal(changed.state.basket?.members[0]?.mode, 'single')
      assert.deepEqual(changed.state.basket?.members[0]?.serviceIds, [cuts[0]!.id])
    })
  }

  const negatives = [
    { name: 'foreign service ID', output: candidate([basket('replace', [member('single', ['foreign-id'], 'Corte hombre')], 'Corte hombre', [groupId])]) },
    { name: 'invented member evidence', output: candidate([basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], history, [groupId])]) },
    { name: 'nonexistent target member', output: candidate([basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], 'Corte hombre', ['m999'])]) },
    { name: 'two competing service operations', output: candidate([
      basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], 'Corte hombre', [groupId]),
      { kind: 'service', mode: 'single', serviceIds: [cuts[0]!.id], correction: true, ...ev('Corte hombre') }
    ]) }
  ]
  for (const negative of negatives) {
    const invalid = await say(first.state, negative.name === 'invented member evidence' ? history : 'La última vez me hice Corte hombre', negative.output)
    await check('security rejects ' + negative.name + ' without destructive fallback', () => {
      assert.equal(invalid.interpretation.mode, 'fallback')
      assert.equal(invalid.interpretation.reason, 'invalid_output')
      assert.deepEqual(invalid.state.basket, first.state.basket)
      assert.equal(invalid.state.professional, null)
      assert.equal(invalid.state.slot, null)
    })
  }
  // A closed answer independently grounded in the previously displayed choices
  // remains valid even when the model proposes a foreign service ID.
  const closedAnswer = await say(first.state, 'Corte hombre', negatives[0]!.output)
  await check('a closed presented answer survives an invalid provider proposal safely', () => {
    assert.equal(closedAnswer.interpretation.mode, 'fallback')
    assert.equal(closedAnswer.interpretation.reason, 'invalid_output')
    assert.equal(closedAnswer.state.basket?.members[0]?.mode, 'single')
    assert.deepEqual(closedAnswer.state.basket?.members[0]?.serviceIds, [cuts[0]!.id])
    assert.equal(closedAnswer.state.professional, null)
    assert.equal(closedAnswer.state.slot, null)
  })
  const notConsent = await say(first.state, 'Cristian me atendió antes', candidate([]))
  await check('reference or no-op cannot consent to a booking', () => {
    assert.deepEqual(notConsent.state.basket, first.state.basket)
    assert.equal(notConsent.state.sandboxReservation, undefined)
    assert.equal(notConsent.state.slot, null)
  })
  // Reproduce the documented local error with a synthetic literal, not a replay
  // of the private corpus body. Raw add of an already selected ID is a no-op;
  // grounding must not widen it into an overlapping group and crash the turn.
  const repeatedMessage = 'corte'
  const selectedWoman: DialogueState = {
    ...initialDialogueState(context.businessId), introduced: true, pending: 'date',
    serviceId: cuts[1]!.id, customerName: 'Matías',
    basket: { version: 1, nextMemberId: 2, members: [
      { memberId: 'm1', mode: 'single', serviceIds: [cuts[1]!.id], evidence: 'Corte mujer' }
    ] }
  }
  const repeatedAdd = basket('add', [member('single', [cuts[1]!.id], 'corte')], 'corte')
  const rawPlan = parseTurnPlan({ version: 1, operations: [repeatedAdd] }, repeatedMessage, services.map(item => item.id))
  const rawAdd = rawPlan.operations[0]!
  assert.equal(rawAdd.kind, 'basket')
  if (rawAdd.kind !== 'basket') throw new Error('controlled repeated add must be a basket operation')
  await check('original validated repeated add is idempotent before grounding', () => {
    const applied = applyBasketMutation(selectionBasket(selectedWoman), rawAdd)
    assert.equal(applied.changed, false)
    assert.deepEqual(applied.basket, selectedWoman.basket)
  })
  await check('basket parser still rejects an overlapping widened member', () => {
    assert.throws(() => parseServiceBasket({ version: 1, nextMemberId: 3, members: [
      ...selectionBasket(selectedWoman).members,
      { memberId: 'm2', mode: 'alternatives', serviceIds: cuts.map(item => item.id), evidence: 'corte' }
    ] }), /duplicate or invalid service/)
  })
  // Isolate synthetic agenda reads so legitimate future next-step rendering is
  // not mistaken for a real database/network call or forbidden by this regression.
  const idempotencePort: DialoguePort = {
    ...port, availability: async () => ({ professionals: [], slots: [] }),
    availabilityBasket: async selected => ({ ok: true, services: selected,
      durationMinutes: selected.reduce((sum, item) => sum + item.durationMinutes!, 0),
      totalPrice: null, professionals: [], slots: [] })
  }
  await check('repeated add remains idempotent after grounding without a local exception', async () => {
    const repeated = await say(selectedWoman, repeatedMessage, candidate([repeatedAdd]), idempotencePort)
    assert.equal(repeated.interpretation.mode, 'ai')
    assert.equal(repeated.interpretation.validation?.outcome, 'accepted')
    assert.deepEqual(repeated.state.basket, selectedWoman.basket)
    assert.equal(repeated.state.customerName, selectedWoman.customerName)
    assert.equal(repeated.state.slot, null)
    assert.equal(repeated.state.sandboxReservation, undefined)
  })
  await check('all checks use controlled provider and no real network or reservation adapter', () => {
    assert.ok(providerCalls > 0)
    assert.equal(networkCalls, 0)
    assert.equal(agendaCalls, 0)
    assert.equal(professionalReads, 0)
  })
} finally { globalThis.fetch = originalFetch }
console.log('communicative-act: ' + passed + ' passed, ' + failures.length + ' failed; controlled provider=' + providerCalls + ', real network=' + networkCalls)
assert.equal(failures.length, 0, 'unresolved communicative-act regressions: ' + failures.join('; '))
