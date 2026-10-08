import { admitCommunicativePlan, createProfessionalReference, parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { rememberDialogueQuestion } from '../src/conversational-bot/dialogue-context.js'
import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, respond, respondConversationChoice, ConversationChoiceUnavailableError, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { applyBasketMutation, parseServiceBasket, selectionBasket } from '../src/conversational-bot/service-basket.js'
import { parseTurnPlan, parseTurnPlanStructure } from '../src/conversational-bot/turn-plan.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'
import { expectedDialogueAnswer } from '../src/conversational-bot/dialogue-context.js'

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
const smooth: DialogueService = { id: 'smooth', name: 'Alisado', durationMinutes: 90, price: 85000, priceMode: 'STARTING_AT', requiresConsultation: false, bookingPolicy: policy }
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
const act = (kind: string, field: string, evidence: string, operationIndexes: number[] = [], mention: string | null = null, confidence = .99) => ({ kind, field, evidence, operationIndexes, mention, confidence })
const acted = (operations: object[], acts: object[], intent = 'booking') => ({ ...candidate(operations, intent), communicativeActs: { version: 1, acts } })
const referenceOf = (state: DialogueState) => (state as DialogueState & { professionalReference?: { businessId: string; mention: string; evidence: string; scope: string; question: string } }).professionalReference
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

  // The current operation is a preference; a past reference is not. Metadata is
  // emitted by the same controlled provider, not inferred by a second classifier.
  const currentMessage = 'Quiero atenderme con Cristian'
  const preferred = await say(first.state, currentMessage, acted([
    { kind: 'professional', mode: 'specific', mention: 'Cristian', ...ev('Cristian') }
  ], [act('request', 'professional', currentMessage, [0], 'Cristian')]))
  await check('explicit current professional request becomes only an unverified hint', () => {
    assert.equal(preferred.interpretation.mode, 'ai')
    assert.deepEqual(preferred.state.basket, first.state.basket)
    assert.equal(preferred.state.professionalNameHint, 'cristian')
    assert.equal(preferred.state.professional, null)
    assert.equal(preferred.state.customerName, null)
  })
  const referenced = await say(first.state, history, acted([
    { kind: 'professional', mode: 'specific', mention: 'Cristian', ...ev('Cristian') }
  ], [act('reference', 'professional', history, [0], 'Cristian')]))
  await check('historical professional reference asks once without changing current preference', () => {
    assert.equal(referenced.interpretation.mode, 'ai')
    assert.deepEqual(referenced.state.basket, first.state.basket)
    assert.equal(referenced.state.professionalNameHint, null)
    assert.equal(referenced.state.professional, null)
    assert.equal(referenceOf(referenced.state)?.mention, 'Cristian')
    assert.match(referenced.reply, /Cristian/)
    assert.equal((referenced.reply.match(/¿/g) ?? []).length, 1, 'one active question, not competing service/professional questions')
    assert.doesNotMatch(referenced.reply, /Cristian (?:atiende|trabaja|tiene disponibilidad)|reservad[oa]/i)
  })
  await check('reference roundtrip retains prior alternatives and exposes its actual question', () => {
    assert.ok(referenceOf(referenced.state), 'a tentative reference must be recoverable')
    const restored = parseDialogueState(JSON.parse(JSON.stringify(referenced.state)), context.businessId)
    assert.deepEqual(restored.basket, first.state.basket)
    assert.deepEqual(restored.questionContext, first.state.questionContext)
    assert.equal(expectedDialogueAnswer(restored).role, 'professional')
    assert.equal(expectedDialogueAnswer(restored).question, referenceOf(restored)?.question)
    const foreign = structuredClone(restored)
    referenceOf(foreign)!.businessId = 'foreign-tenant'
    assert.throws(() => parseDialogueState(foreign, context.businessId), /reference|scope/)
    const stale = structuredClone(restored)
    stale.date = '2026-10-06'
    assert.throws(() => parseDialogueState(stale, context.businessId), /reference|scope/)
  })
  const answer = 'sí, con él'
  const referenceReply = (action: string, kind = 'answer', confidence = .99) => acted([
    { kind: 'professional_reference', action, ...ev(answer) }
  ], [act(kind, 'professional', answer, [0], null, confidence)])
  const acceptedReference = await say(referenced.state, answer, referenceReply('prefer'))
  await check('contextual confirmation can prefer the referenced professional but not book', () => {
    assert.equal(acceptedReference.interpretation.mode, 'ai')
    assert.equal(acceptedReference.state.professionalNameHint, 'cristian')
    assert.equal(acceptedReference.state.professional, null)
    assert.deepEqual(acceptedReference.state.basket, first.state.basket)
    assert.equal(referenceOf(acceptedReference.state), undefined)
    assert.equal(acceptedReference.state.slot, null)
  })
  const dismissed = await say(referenced.state, answer, referenceReply('dismiss'))
  await check('dismissing a reference does not change the booking draft', () => {
    assert.equal(dismissed.interpretation.mode, 'ai')
    assert.equal(referenceOf(dismissed.state), undefined)
    assert.equal(dismissed.state.professionalNameHint, null)
    assert.deepEqual(dismissed.state.basket, first.state.basket)
  })
  for (const output of [referenceReply('prefer', 'inquiry'), referenceReply('prefer', 'answer', .5)]) {
    const uncertain = await say(referenced.state, answer, output)
    await check('an inquiry or weak answer cannot resolve a reference', () => {
      assert.equal(uncertain.state.professionalNameHint, null)
      assert.deepEqual(uncertain.state.basket, first.state.basket)
      assert.ok(referenceOf(uncertain.state), 'a refused resolution keeps its clarification recoverable')
    })
  }
  const absentReference = await say(first.state, answer, referenceReply('prefer'))
  await check('an answer without an active reference cannot invent its professional', () => {
    assert.equal(absentReference.state.professionalNameHint, null)
    assert.equal(absentReference.state.professional, null)
    assert.deepEqual(absentReference.state.basket, first.state.basket)
  })
  const mixedMessage = history + '. Mañana, soy Matías'
  const mixed = await say(first.state, mixedMessage, acted([
    basket('replace', [member('single', [cuts[0]!.id], 'cortó')], history, [groupId]),
    { kind: 'date', expression: 'Mañana', value: null, ...ev('Mañana') },
    { kind: 'name', value: 'Matías', ...ev('Matías') }
  ], [act('reference', 'professional', history, [0], 'Cristian'), act('request', 'date', 'Mañana', [1]), act('answer', 'name', 'soy Matías', [2], 'Matías')]))
  await check('semantic field mismatch blocks replacement but keeps independent valid entities', () => {
    assert.equal(mixed.interpretation.mode, 'ai')
    assert.deepEqual(mixed.state.basket, first.state.basket)
    assert.equal(mixed.state.date, '2026-10-06')
    assert.equal(mixed.state.customerName, 'Matías')
    assert.equal(mixed.state.professionalNameHint, null)
  })
  const unsafe = await say(first.state, history, acted([
    basket('replace', [member('single', ['foreign-id'], 'cortó')], history, [groupId])
  ], [act('reference', 'professional', history, [0], 'Cristian')]))
  await check('semantic blocking does not rescue foreign IDs before global shape/catalog validation', () => {
    assert.equal(unsafe.interpretation.mode, 'fallback')
    assert.equal(unsafe.interpretation.reason, 'invalid_output')
    assert.deepEqual(unsafe.state.basket, first.state.basket)
  })

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
    const changed = await say(first.state, message, acted([
      basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], message, [groupId])
    ], [act('change', 'service', message, [0])]))
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
  const selectedAll: DialogueState = {
    ...initialDialogueState(context.businessId), introduced: true, pending: 'date', customerName: 'Matías',
    basket: { version: 1, nextMemberId: 5, members: services.map((item, index) => ({
      memberId: 'm' + (index + 1), mode: 'single', serviceIds: [item.id], evidence: item.name
    })) }, serviceEstimates: { [smooth.id]: { configurationKey: serviceConfigurationKey(policy), optionId: 'shoulders' } }
  }
  const overlapping = basket('add', [member('alternatives', [cuts[1]!.id, cuts[0]!.id], 'corte')], 'corte')
  await check('already overlapping alternative add is rejected by original strict basket composition', () => {
    const original = parseTurnPlan({ version: 1, operations: [overlapping] }, 'corte', services.map(item => item.id)).operations[0]!
    assert.equal(original.kind, 'basket')
    if (original.kind !== 'basket') throw new Error('controlled overlap must be basket')
    assert.throws(() => applyBasketMutation(selectionBasket(selectedAll), original), /duplicate or invalid service/)
  })
  await check('legacy overlapping alternative add also cannot escape as a local exception', async () => {
    const result = await say(selectedAll, 'corte', candidate([overlapping]), idempotencePort)
    assert.deepEqual(result.state.basket, selectedAll.basket)
    assert.deepEqual(result.state.serviceEstimates, selectedAll.serviceEstimates)
    assert.match(result.reply, /¿/)
  })
  await check('an overlapping candidate add produces clarification without crashing or discarding peers', async () => {
    const result = await say(selectedAll, 'corte', acted([overlapping], [act('request', 'service', 'corte', [0])]), idempotencePort)
    assert.equal(result.interpretation.mode, 'ai')
    assert.deepEqual(result.state.basket, selectedAll.basket)
    assert.deepEqual(result.state.serviceEstimates, selectedAll.serviceEstimates)
    assert.equal(result.state.customerName, 'Matías')
    assert.equal(result.state.slot, null)
    assert.match(result.reply, /¿/)
  })
  await check('a legacy closed label cannot authorize a different date, time or estimate value', () => {
    const dateState = { ...selectedWoman, date: '2026-10-06' }
    rememberDialogueQuestion(dateState, '¿Qué día?', [{ id: '2026-10-07', label: 'miércoles 07/10' }])
    const datePlan = parseTurnPlan({ version: 1, operations: [{ kind: 'date', expression: 'miércoles 07/10', value: '2026-10-08', ...ev('miércoles 07/10') }] }, 'miércoles 07/10')
    assert.equal(admitCommunicativePlan(null, datePlan, datePlan, 'miércoles 07/10', dateState, services).plan.operations.length, 0)
    const timeState: DialogueState = { ...selectedWoman, date: '2026-10-06', pending: 'time', requestedTime: '16:00' }
    rememberDialogueQuestion(timeState, '¿Qué horario?', [{ id: '2026-10-06T20:00:00Z/cin', label: 'martes 06/10 a las 17:00 con Cin' }])
    const wrongClock = { version: 1, operations: [{ kind: 'time', value: '18:00', ...ev('martes 06/10 a las 17:00 con Cin') }] }
    assert.throws(() => parseTurnPlan(wrongClock, 'martes 06/10 a las 17:00 con Cin'), /clock value evidence/)
    const timePlan = parseTurnPlanStructure(wrongClock, 'martes 06/10 a las 17:00 con Cin')
    assert.equal(admitCommunicativePlan(null, timePlan, timePlan, 'martes 06/10 a las 17:00 con Cin', timeState, services).plan.operations.length, 0)
    const estimateState: DialogueState = { ...selectedAll, pending: 'estimate' }
    rememberDialogueQuestion(estimateState, '¿Hasta dónde?', [{ id: 'shoulders', label: 'Hasta los hombros' }], smooth.id)
    const estimatePlan = parseTurnPlan({ version: 1, operations: [{ kind: 'estimate', serviceId: smooth.id, optionId: null, ...ev('Hasta los hombros') }] }, 'Hasta los hombros')
    assert.equal(admitCommunicativePlan(null, estimatePlan, estimatePlan, 'Hasta los hombros', estimateState, services).plan.operations.length, 0)
  })
  await check('reference fingerprint is stable across JSONB key order and includes material edits', () => {
    const original = { ...selectedAll, professional: { kind: 'specific' as const, id: 'cin' } }
    const reference = createProfessionalReference(original, 'Cristian', history)
    const reordered = { ...original, professional: { id: 'cin', kind: 'specific' as const }, serviceEstimates: {
      [smooth.id]: { optionId: 'shoulders', configurationKey: serviceConfigurationKey(policy) }
    }, professionalReference: reference }
    assert.doesNotThrow(() => parseDialogueState(reordered, context.businessId))
    assert.throws(() => parseDialogueState({ ...reordered, customerName: 'Otra persona' }, context.businessId), /reference|scope/)
  })
  const sideways = await say(referenced.state, '¿Qué horario tiene el local?', acted([
    { kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, ...ev('horario tiene el local') }
  ], [act('inquiry', 'general', 'horario tiene el local', [0])]), port)
  await check('a side inquiry keeps one active reference question and does not acquire a preference', () => {
    assert.equal(sideways.interpretation.mode, 'ai')
    assert.deepEqual(referenceOf(sideways.state), referenceOf(referenced.state))
    assert.equal(sideways.state.professionalNameHint, null)
    assert.match(sideways.reply, /11:00|20:00/)
    assert.equal((sideways.reply.match(/¿/g) ?? []).length, 1)
  })
  const reorderedAnswer = await say(referenced.state, answer + ', mañana', acted([
    { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') },
    { kind: 'professional_reference', action: 'prefer', ...ev(answer + ', mañana') }
  ], [act('request', 'date', 'mañana', [0]), act('answer', 'professional', answer + ', mañana', [1])]))
  await check('a material independent edit cannot confirm a stale reference', () => {
    assert.equal(reorderedAnswer.interpretation.mode, 'ai')
    assert.equal(reorderedAnswer.state.date, '2026-10-06')
    assert.equal(reorderedAnswer.state.professionalNameHint, null)
    assert.equal(referenceOf(reorderedAnswer.state), undefined)
    assert.deepEqual(reorderedAnswer.state.basket, first.state.basket)
  })
  const standAloneReference = await say(first.state, history, { ...candidate([]), turnPlan: null,
    communicativeActs: { version: 1, acts: [act('reference', 'professional', history, [], 'Cristian')] } })
  await check('a reference act without a mutation still creates only a recoverable question', () => {
    assert.equal(standAloneReference.interpretation.mode, 'ai')
    assert.equal(referenceOf(standAloneReference.state)?.mention, 'Cristian')
    assert.equal(standAloneReference.state.professionalNameHint, null)
    assert.deepEqual(standAloneReference.state.basket, first.state.basket)
  })
  await check('same Responses request exposes strict act schema and actual reference question', async () => {
    let request: Record<string, any> | undefined, requests = 0
    const provider = createOpenAiInterpretationProvider({ apiKey: 'synthetic-test-only', fetchImpl: async (_url, init) => {
      requests++; request = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(acted([], [])) }] }] }), { status: 200 })
    } })
    await provider({ message: answer, state: referenced.state, services }, new AbortController().signal)
    assert.equal(requests, 1)
    const schema = request!.text.format.schema
    assert.ok(schema.required.includes('communicativeActs'))
    const checkObject = (node: any) => {
      if (node.type === 'object' || Array.isArray(node.type) && node.type.includes('object')) {
        assert.equal(node.additionalProperties, false)
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort())
      }
      if (node.properties) Object.values(node.properties).forEach(checkObject)
      if (node.items) checkObject(node.items)
      if (node.anyOf) node.anyOf.forEach(checkObject)
    }
    checkObject(schema)
    const input = JSON.parse(request!.input)
    assert.deepEqual(input.professionalReference, referenceOf(referenced.state))
    assert.equal(input.expectedAnswer.question, referenceOf(referenced.state)?.question)
    assert.equal(input.expectedAnswer.role, 'professional')
    assert.equal(request!.store, false)
    assert.equal(request!.model, 'gpt-6-luna')
    assert.equal(request!.reasoning.effort, 'none')
  })
  const legacyHistory = await say(first.state, 'La última vez me hice Corte hombre', {
    intent: 'booking', serviceId: cuts[0]!.id, serviceEvidence: 'Corte hombre', professionalMention: null,
    serviceConfidence: 'certain', serviceCorrection: true
  })
  await check('root legacy service entities do not bypass destructive act admission', () => {
    assert.equal(legacyHistory.interpretation.mode, 'ai')
    assert.deepEqual(legacyHistory.state.basket, first.state.basket)
    assert.equal(legacyHistory.state.slot, null)
  })
  const legacyProfessionalHistory = await say(first.state, history, {
    intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: 'Cristian'
  })
  await check('root legacy professional mention does not invent current preference from history', () => {
    assert.equal(legacyProfessionalHistory.interpretation.mode, 'ai')
    assert.deepEqual(legacyProfessionalHistory.state.basket, first.state.basket)
    assert.equal(legacyProfessionalHistory.state.professionalNameHint, null)
    assert.equal(legacyProfessionalHistory.state.professional, null)
  })
  await check('a closed service answer authorizes only its group, never dropping a companion', () => {
    const current = structuredClone(rich)
    rememberDialogueQuestion(current, '¿Cuál de estos cortes?', cuts.map(item => ({ id: item.id, label: item.name })))
    const destructive = parseTurnPlan({ version: 1, operations: [basket('set', [member('single', [cuts[0]!.id], 'Corte hombre')], 'Corte hombre')] }, 'Corte hombre', services.map(item => item.id))
    assert.equal(admitCommunicativePlan(null, destructive, destructive, 'Corte hombre', current, services).plan.operations.length, 0)
    const scoped = parseTurnPlan({ version: 1, operations: [basket('replace', [member('single', [cuts[0]!.id], 'Corte hombre')], 'Corte hombre', [groupId])] }, 'Corte hombre', services.map(item => item.id))
    assert.equal(admitCommunicativePlan(null, scoped, scoped, 'Corte hombre', current, services).plan.operations.length, 1)
  })
  await check('literal typo quotes preserve multi-service alternatives without an extra classifier or agenda', async () => {
    const message = 'hola como estan quiero uncorte y alisado'
    const beforeCalls = providerCalls
    const result = await say(initial, message, acted([
      basket('set', [member('alternatives', cuts.map(item => item.id), 'uncorte'), member('single', [smooth.id], 'alisado')], 'uncorte y alisado')
    ], [act('request', 'service', 'uncorte y alisado', [0], 'uncorte')]))
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.basket?.members.length, 2)
    assert.deepEqual(result.state.basket?.members[0]?.serviceIds, cuts.map(item => item.id))
    assert.equal(result.state.basket?.members[0]?.evidence, 'uncorte')
    assert.deepEqual(result.state.basket?.members[1]?.serviceIds, [smooth.id])
    assert.equal(providerCalls - beforeCalls, 1)
    assert.equal(result.interpretation.aiCalls, 1)
    assert.equal(result.interpretation.responseMs, 0)
  })
  await check('old finite service choice is not the active tentative professional answer', async () => {
    await assert.rejects(() => respondConversationChoice(context, referenced.state,
      { kind: 'service', serviceId: cuts[0]!.id, targetMemberId: groupId }, port), ConversationChoiceUnavailableError)
    assert.deepEqual(referenced.state.basket, first.state.basket)
  })
  const sandboxContext = { ...context, sandboxBooking: true }
  const sandboxSlot = { startAt: '2026-10-06T20:00:00.000Z', date: '2026-10-06', time: '17:00', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
  let syntheticSandboxReads = 0
  const sandboxPort: DialoguePort = { ...port, availability: async () => {
    syntheticSandboxReads++; return { professionals: [{ id: 'cin', name: 'Cin', priority: 0 }], slots: [sandboxSlot] }
  } }
  const ready = { ...initial, serviceId: cuts[0]!.id, date: sandboxSlot.date,
    professional: { kind: 'specific' as const, id: 'cin' }, slot: sandboxSlot, customerName: 'Matías' }
  const shown = await respond(sandboxContext, ready, 'quiero reservar', sandboxPort)
  assert.equal(shown.state.questionContext?.role, 'confirmation')
  const pendingReference = await respondWithAiInterpreter(sandboxContext, shown.state, history, sandboxPort,
    async () => { providerCalls++; return acted([], [act('reference', 'professional', history, [], 'Cristian')]) })
  await check('new reference suspends previous proposal consent and publishes only its active question', () => {
    assert.equal(pendingReference.bookingCommand, undefined)
    assert.equal(referenceOf(pendingReference.state)?.mention, 'Cristian')
    assert.equal(pendingReference.state.sandboxReservation?.presented.nonce, shown.state.sandboxReservation?.presented.nonce)
    assert.equal(pendingReference.choicePresentation, undefined, 'old confirmation buttons cannot authorize the new question')
    assert.equal((pendingReference.reply.match(/¿/g) ?? []).length, 1)
    assert.equal(expectedDialogueAnswer(pendingReference.state)?.role, 'professional')
  })
  const readsBeforeSuspendedAnswers = syntheticSandboxReads
  await check('a plain yes to professional reference cannot confirm a pending sandbox proposal', async () => {
    const result = await respond(sandboxContext, pendingReference.state, 'sí', sandboxPort)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(result.choicePresentation, undefined)
    assert.equal(referenceOf(result.state)?.mention, 'Cristian')
  })
  await check('even a model proposal-confirm operation cannot use a professional question as consent', async () => {
    const result = await respondWithAiInterpreter(sandboxContext, pendingReference.state, 'sí', sandboxPort,
      async () => { providerCalls++; return acted([{ kind: 'confirm_proposal', ...ev('sí') }], [act('answer', 'general', 'sí', [0])]) })
    assert.equal(result.bookingCommand, undefined)
    assert.equal(referenceOf(result.state)?.mention, 'Cristian')
  })
  await check('an old confirm button cannot resolve a new reference or create a reservation command', async () => {
    await assert.rejects(() => respondConversationChoice(sandboxContext, pendingReference.state,
      { kind: 'confirm', nonce: shown.state.sandboxReservation!.presented.nonce }, sandboxPort), ConversationChoiceUnavailableError)
    assert.equal(syntheticSandboxReads, readsBeforeSuspendedAnswers)
  })
  await check('dismissing a reference restores a pending proposal but does not itself grant consent', async () => {
    const message = 'No, seguimos con Cin'
    const result = await respondWithAiInterpreter(sandboxContext, pendingReference.state, message, sandboxPort,
      async () => { providerCalls++; return acted([{ kind: 'professional_reference', action: 'dismiss', ...ev(message) }], [act('answer', 'professional', message, [0])]) })
    assert.equal(referenceOf(result.state), undefined)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(result.state.professional?.kind, 'specific')
    assert.equal(result.state.sandboxReservation?.presented.nonce, shown.state.sandboxReservation?.presented.nonce)
    assert.equal(result.choicePresentation?.kind, 'proposal')
    assert.equal(expectedDialogueAnswer(result.state)?.role, 'confirmation')
  })
  await check('reference scope rejects tenant, slot and clarification changes, including saved JSON roundtrip', () => {
    const value = { ...shown.state, professionalReference: createProfessionalReference(shown.state, 'Cristian', history) }
    assert.doesNotThrow(() => parseDialogueState(JSON.parse(JSON.stringify(value)), context.businessId))
    assert.throws(() => parseDialogueState({ ...value, professionalReference: { ...value.professionalReference, businessId: 'foreign' } }, context.businessId), /reference|scope/)
    const withoutReservation = { ...value, sandboxReservation: undefined, dialogueContext: undefined, questionContext: undefined, pending: 'time' as const }
    assert.throws(() => parseDialogueState({ ...withoutReservation, slot: null }, context.businessId), /reference|scope/)
    assert.throws(() => parseDialogueState({ ...withoutReservation, slot: null, timeClarification: { candidateTimes: ['04:00', '16:00'] } }, context.businessId), /reference|scope|clarification/)
  })
  await check('reference fingerprint detects isolated valid slot and time-clarification edits', () => {
    const slotState = { ...ready, pending: 'time' as const }
    const slotReference = createProfessionalReference(slotState, 'Cristian', history)
    assert.doesNotThrow(() => parseDialogueState(slotState, context.businessId, context.timezone))
    const differentSlot = { ...slotState, slot: { ...sandboxSlot, time: '18:00', startAt: '2026-10-06T21:00:00.000Z' } }
    assert.doesNotThrow(() => parseDialogueState(differentSlot, context.businessId, context.timezone))
    assert.throws(() => parseDialogueState({ ...differentSlot, professionalReference: slotReference }, context.businessId, context.timezone), /reference scope/)
    const periodState = { ...ready, slot: null, pending: 'time' as const, timeClarification: { candidateTimes: ['04:00', '16:00'] } }
    const periodReference = createProfessionalReference(periodState, 'Cristian', history)
    const differentPeriod = { ...periodState, timeClarification: { candidateTimes: ['05:00', '17:00'] } }
    assert.doesNotThrow(() => parseDialogueState(periodState, context.businessId, context.timezone))
    assert.doesNotThrow(() => parseDialogueState(differentPeriod, context.businessId, context.timezone))
    assert.throws(() => parseDialogueState({ ...differentPeriod, professionalReference: periodReference }, context.businessId, context.timezone), /reference scope/)
  })
  await check('server informative estimate projection retains its original act index and field', async () => {
    const message = 'Hasta los hombros'
    const original = parseTurnPlan({ version: 1, operations: [{ kind: 'estimate', serviceId: smooth.id, optionId: 'shoulders', ...ev(message) }] }, message, services.map(item => item.id))
    const projected = parseTurnPlan({ version: 1, operations: [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: [smooth.id], aspect: 'price', estimateOptionId: 'shoulders' }, ...ev(message) }] }, message, services.map(item => item.id))
    const metadata = parseCommunicativeActs({ version: 1, acts: [act('answer', 'estimate', message, [0])] }, message, original.operations.length)
    const admission = admitCommunicativePlan(metadata, original, projected, message, initial, services)
    assert.equal(admission.plan.operations.length, 1)
    assert.deepEqual(admission.blockedFields, [])
    const originalInsufficient = await say(initial, '¿Precio del Alisado?', acted([
      { kind: 'information', target: { kind: 'service', actions: [], serviceIds: [smooth.id], aspect: 'price' }, ...ev('Precio del Alisado') }
    ], [act('inquiry', 'service', 'Precio del Alisado', [0])], 'information'))
    assert.equal(originalInsufficient.state.informationFocus?.serviceId, smooth.id, 'complete neutral body with exact public name proves the fallback')
    assert.equal(originalInsufficient.state.serviceId, initial.serviceId)
    assert.deepEqual(originalInsufficient.state.basket, initial.basket)
    assert.match(originalInsufficient.reply, /85[.,]?000|95[.,]?000/)
    const qualifiedUnscoped = await say(initial, '¿Precio del Alisado sin lavado?', acted([
      { kind: 'information', target: { kind: 'service', actions: [], serviceIds: [smooth.id], aspect: 'price' }, ...ev('Precio del Alisado') }
    ], [act('inquiry', 'service', 'Precio del Alisado', [0])], 'information'))
    assert.deepEqual(qualifiedUnscoped.state.informationFocus, initial.informationFocus)
    assert.deepEqual(qualifiedUnscoped.state.basket, initial.basket)
    assert.equal(qualifiedUnscoped.state.serviceId, initial.serviceId)
    assert.doesNotMatch(qualifiedUnscoped.reply, /85[.,]?000|95[.,]?000/)
    const price = await say(initial, '¿Precio del Alisado?', acted([
      { kind: 'information', target: { kind: 'service', actions: [], serviceIds: [smooth.id], aspect: 'price' }, ...ev('Precio del Alisado') }
    ], [act('inquiry', 'service', '¿Precio del Alisado?', [0], 'Alisado')], 'information'))
    const result = await say(price.state, message, acted([...original.operations], [act('answer', 'estimate', message, [0])], 'information'))
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.basket, undefined)
    assert.equal(result.state.serviceEstimates, undefined)
    assert.equal(result.bookingCommand, undefined)
    assert.match(result.reply, /85[.,]?000/)
    assert.doesNotMatch(result.reply, /Mantengo los datos|Qué opción del presupuesto/)
  })
  await check('prospective overlap with a valid companion estimate preserves independent current fields', async () => {
    const message = 'Agregá corte, hasta los hombros mañana'
    const result = await say(selectedAll, message, acted([
      { ...overlapping, evidence: 'Agregá corte' },
      { kind: 'estimate', serviceId: smooth.id, optionId: 'shoulders', ...ev('hasta los hombros') },
      { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }
    ], [act('request', 'service', 'Agregá corte', [0]), act('answer', 'estimate', 'hasta los hombros', [1]), act('request', 'date', 'mañana', [2])]), idempotencePort)
    assert.equal(result.interpretation.mode, 'ai')
    assert.deepEqual(result.state.basket, selectedAll.basket)
    assert.deepEqual(result.state.serviceEstimates, selectedAll.serviceEstimates)
    assert.equal(result.state.date, '2026-10-06')
    assert.equal(result.bookingCommand, undefined)
    assert.match(result.reply, /Mantengo los servicios/)
  })
  await check('independent estimates retain their own original act indexes', () => {
    const message = 'Largo corto; marca Karsell; cambiemos fecha y profesional'
    const estimates = parseTurnPlan({ version: 1, operations: [
      { kind: 'estimate', serviceId: 'smooth', optionId: 'shoulders', ...ev('Largo corto') },
      { kind: 'estimate', serviceId: 'cream', optionId: 'karsell', ...ev('marca Karsell') }
    ] }, message, ['smooth', 'cream'])
    const estimateActs = parseCommunicativeActs({ version: 1, acts: [
      act('answer', 'estimate', 'Largo corto', [0]), act('answer', 'estimate', 'marca Karsell', [1])
    ] }, message, 2)
    const admitted = admitCommunicativePlan(estimateActs, estimates, estimates, message, initial, services)
    assert.deepEqual(admitted.plan, estimates)
    assert.deepEqual(admitted.blockedFields, [])
    const crossed = parseCommunicativeActs({ version: 1, acts: [
      act('answer', 'estimate', 'marca Karsell', [0]), act('answer', 'estimate', 'Largo corto', [1])
    ] }, message, 2)
    assert.equal(admitCommunicativePlan(crossed, estimates, estimates, message, initial, services).plan.operations.length, 0,
      'same field alone cannot swap literal evidence between service-specific operations')
  })
  await check('independent change fields retain their own original act indexes', () => {
    const message = 'Largo corto; marca Karsell; cambiemos fecha y profesional'
    const changes = parseTurnPlan({ version: 1, operations: [
      { kind: 'request_change', field: 'date', ...ev('cambiemos fecha') },
      { kind: 'request_change', field: 'professional', ...ev('profesional') }
    ] }, message, services.map(item => item.id))
    const changeActs = parseCommunicativeActs({ version: 1, acts: [
      act('change', 'date', 'cambiemos fecha', [0]), act('change', 'professional', 'profesional', [1])
    ] }, message, 2)
    const changed = admitCommunicativePlan(changeActs, changes, changes, message, initial, services)
    assert.deepEqual(changed.plan, changes)
    assert.deepEqual(changed.blockedFields, [])
  })
  for (const claimed of [act('reference', 'time', 'tipo 5', [0]), act('request', 'service', 'tipo 5', [0])]) {
    await check('semantic time rejection cannot be recreated: ' + claimed.kind + '/' + claimed.field, async () => {
      const state: DialogueState = { ...initial, serviceId: 'cut-m', date: '2026-10-06', professional: { kind: 'specific', id: 'ramiro' }, customerName: 'Matías', pending: 'time', timePreference: { kind: 'band', band: 'AFTERNOON' } }
      const temporal = { kind: 'time_preference', preference: { kind: 'around', time: '17:00' }, ...ev('tipo 5') }
      const result = await say(state, 'tipo 5', acted([temporal], [claimed]))
      assert.equal(result.interpretation.mode, 'ai')
      assert.deepEqual(result.state.timePreference, state.timePreference)
      assert.equal(result.state.requestedTime, state.requestedTime)
      assert.equal(result.state.slot, state.slot)
      assert.equal(result.state.date, state.date)
      assert.equal(result.state.customerName, state.customerName)
      assert.equal(result.bookingCommand, undefined)
    })
  }
  await check('semantic time rejection preserves independent actual customer update', async () => {
    const state: DialogueState = { ...initial, serviceId: 'cut-m', date: '2026-10-06', professional: { kind: 'specific', id: 'ramiro' }, customerName: 'Matías', pending: 'time', timePreference: { kind: 'band', band: 'AFTERNOON' } }
    const message = 'tipo 5, soy Ana'
    const result = await say(state, message, acted([
      { kind: 'time_preference', preference: { kind: 'around', time: '17:00' }, ...ev('tipo 5') },
      { kind: 'name', value: 'Ana', ...ev('Ana') }
    ], [act('reference', 'time', 'tipo 5', [0]), act('change', 'name', 'soy Ana', [1])]))
    assert.equal(result.state.customerName, 'Ana')
    assert.equal(result.state.date, state.date)
    assert.deepEqual(result.state.timePreference, state.timePreference)
  })
  await check('historical professional and time reference retains prior temporal authority', async () => {
    const state: DialogueState = { ...initial, serviceId: 'cut-m', date: '2026-10-06', professional: { kind: 'specific', id: 'ramiro' }, customerName: 'Matías', pending: 'time', timePreference: { kind: 'band', band: 'AFTERNOON' } }
    const message = 'Antes me atendía Ramiro tipo 5'
    const result = await say(state, message, acted([{ kind: 'time_preference', preference: { kind: 'around', time: '17:00' }, ...ev('tipo 5') }],
      [act('reference', 'professional', message, [0], 'Ramiro')]))
    assert.deepEqual(result.state.timePreference, state.timePreference)
    assert.deepEqual(result.state.professional, state.professional)
    assert.equal(result.state.date, state.date)
    assert.equal(result.state.slot, state.slot)
    assert.equal(result.state.professionalNameHint ?? null, state.professionalNameHint ?? null)
    assert.equal(referenceOf(result.state)?.mention, 'Ramiro')
    assert.equal(result.bookingCommand, undefined)
  })
  await check('direct deterministic temporal grounding remains available without AI admission', async () => {
    const state: DialogueState = { ...initial, serviceId: 'cut-m', date: '2026-10-06', professional: { kind: 'specific', id: 'ramiro' }, customerName: 'Matías', pending: 'time', timePreference: { kind: 'band', band: 'AFTERNOON' } }
    let localReads = 0
    const deterministicPort: DialoguePort = { catalog: async () => services, availability: async () => { localReads++; return { professionals: [{ id: 'ramiro', name: 'Ramiro', priority: 0 }], slots: [] } } }
    const result = await respond(context, state, 'tipo 5', deterministicPort)
    assert.deepEqual(result.state.timePreference, { kind: 'around', time: '17:00' })
    assert.equal(result.state.slot, null)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(localReads, 1, 'one controlled availability read; no real network or reservation')
  })

  const pendingProcedure: DialogueState = {
    ...first.state, date: '2026-10-06', customerName: 'Ana',
    serviceRequest: { businessId: context.businessId, purpose: 'booking', disposition: 'needs_detail',
      serviceIds: ['cut-m'], correction: false, continuation: false, basis: 'related_category',
      sourceQuote: null, request: 'corte francés' }
  }
  rememberDialogueQuestion(pendingProcedure, first.state.questionContext!.question, first.state.questionContext!.options)
  assert.deepEqual(parseDialogueState(pendingProcedure, context.businessId, context.timezone), pendingProcedure, 'fixture question must already be current before the nonoperative turn')
  const nonoperative = [
    { kind: 'notice', message: 'Estoy llegando', expected: /Gracias por avisar/ },
    { kind: 'pause', message: 'Lo pienso y después sigo', expected: /cuando quieras seguimos/i },
    { kind: 'repair', message: 'No entendí lo que me preguntaste', expected: /qué parte.*servicio/i }
  ] as const
  for (const item of nonoperative) {
    await check(item.kind + ' preserves the recoverable draft without reopening its procedure', async () => {
      const readsBefore = agendaCalls
      const callsBefore = providerCalls
      const result = await say(pendingProcedure, item.message, acted([], [act(item.kind, 'general', item.message)], 'other'))
      assert.equal(result.interpretation.mode, 'ai')
      assert.match(result.reply, item.expected)
      assert.doesNotMatch(result.reply, /Cuál de estos servicios|Qué servicio necesitás|procedimiento|consultarlo con el equipo|te aviso/i)
      assert.deepEqual(result.state, pendingProcedure, 'notice/pause/repair cannot change stored choices, request, dates or basket')
      assert.equal(result.bookingCommand, undefined)
      assert.equal(agendaCalls, readsBefore)
      assert.equal(providerCalls, callsBefore + 1)
      assert.equal(result.interpretation.aiCalls, 1)
    })
  }
  const pauseMessage = 'Lo dejamos en pausa por hoy; después seguimos.'
  const orphanBasket = basket('set', [member('single', ['cut-b'], pauseMessage)], pauseMessage)
  await check('O raw V8 orphan basket preserves a paused date question without menu or effects', async () => {
    const selected = await say(initial, 'Quiero Corte y barba', acted([
      basket('set', [member('single', ['cut-b'], 'Corte y barba')], 'Corte y barba')
    ], [act('request', 'service', 'Quiero Corte y barba', [0])]))
    const state = selected.state, before = JSON.stringify(state), calls = providerCalls, reads = agendaCalls
    assert.equal(state.pending, 'date')
    const output = { ...acted([orphanBasket], [act('pause', 'general', pauseMessage)]),
      firstReply: { opening: 'Entendido, lo dejamos en pausa por hoy.', factIds: ['next'], followUp: null } }
    const outputBefore = JSON.stringify(output), result = await say(state, pauseMessage, output)
    assert.equal(result.interpretation.mode, 'ai'); assert.match(result.reply, /cuando quieras seguimos/i)
    assert.doesNotMatch(result.reply, /[¿?]|elegir|cambiar|Corte hombre|Corte mujer|Qué servicio/i)
    assert.deepEqual(result.state, state); assert.equal(JSON.stringify(state), before)
    assert.equal(JSON.stringify(output), outputBefore); assert.equal(result.bookingCommand, undefined)
    assert.equal(providerCalls, calls + 1); assert.equal(agendaCalls, reads)
  })
  await check('O all orphan operation kinds are filtered without invented blocked fields under sole continuity', () => {
    const message = 'Ana mañana pasado mañana 17:00 tipo 5 dirección Alisado Hasta los hombros Corte y barba pausa'
    const operations = [
      basket('set', [member('single', ['cut-b'], message)], message),
      { kind: 'service_request', purpose: 'booking', disposition: 'clear', serviceIds: ['cut-b'],
        correction: false, continuation: false, basis: 'exact_public_name', sourceQuote: null, ...ev(message) },
      { kind: 'service', mode: 'single', serviceIds: ['cut-b'], correction: false, ...ev(message) },
      { kind: 'referral', action: 'resume', ...ev(message) }, { kind: 'confirm_proposal', ...ev(message) },
      { kind: 'request_change', field: 'service', ...ev(message) },
      { kind: 'estimate', serviceId: 'smooth', optionId: 'shoulders', ...ev(message) },
      { kind: 'professional', mode: 'any', ...ev(message) }, { kind: 'professional_reference', action: 'dismiss', ...ev(message) },
      { kind: 'date', expression: 'mañana', ...ev('mañana') },
      { kind: 'date_preferences', candidates: [{ expression: 'mañana', value: null }, { expression: 'pasado mañana', value: null }], ...ev(message) },
      { kind: 'time', value: '17:00', ...ev('17:00') }, { kind: 'time_preference', preference: { kind: 'around', time: '17:00' }, ...ev('tipo 5') },
      { kind: 'time_clarification', candidateTimes: ['05:00', '17:00'], ...ev('tipo 5') },
      { kind: 'name', value: 'Ana', ...ev('Ana') },
      { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dirección') },
      { kind: 'unsupported_action', action: 'CANCEL', ...ev(message) }
    ]
    for (const operation of operations) for (const kind of ['notice', 'pause', 'repair']) {
      const plan = parseTurnPlan({ version: 1, operations: [operation] }, message, services.map(item => item.id))
      const metadata = parseCommunicativeActs({ version: 1, acts: [act(kind, 'general', message)] }, message, 1, plan)
      const result = admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services)
      assert.equal(result.plan.operations.length, 0, operation.kind); assert.deepEqual(result.blockedFields, [], operation.kind)
      assert.equal(result.continuity, kind, operation.kind)
    }
  })
  await check('O weak conflicting owned and server-rejected authority cannot become orphan continuity', () => {
    const plan = parseTurnPlan({ version: 1, operations: [orphanBasket] }, pauseMessage, services.map(item => item.id))
    const pause = act('pause', 'general', pauseMessage)
    for (const acts of [[{ ...pause, confidence: .84 }], [{ ...pause, field: 'service' }],
      [pause, act('notice', 'general', pauseMessage)], [pause, act('request', 'service', pauseMessage)],
      [pause, act('inquiry', 'general', pauseMessage)], [pause, act('uncertain', 'general', pauseMessage)],
      [pause, act('reference', 'general', pauseMessage)], [pause, act('request', 'name', pauseMessage, [0])],
      [pause, act('request', 'service', pauseMessage, [0], null, .5)]]) {
      const metadata = parseCommunicativeActs({ version: 1, acts }, pauseMessage, 1, plan)
      const result = admitCommunicativePlan(metadata, plan, plan, pauseMessage, pendingProcedure, services)
      assert.equal(result.continuity, undefined); assert.deepEqual(result.blockedFields, ['service'])
      assert.equal(result.plan.operations.length, 0)
    }
    assert.equal(admitCommunicativePlan(null, plan, plan, pauseMessage, pendingProcedure, services).continuity, undefined)
    const metadata = parseCommunicativeActs({ version: 1, acts: [pause] }, pauseMessage, 1, plan)
    const blocked = admitCommunicativePlan(metadata, plan, plan, pauseMessage, pendingProcedure, services, undefined, ['service'])
    assert.equal(blocked.continuity, undefined); assert.deepEqual(blocked.blockedFields, ['service'])
    for (const patch of [{ confidence: NaN }, { confidence: Infinity }, { confidence: 1.5 }, { evidence: 'inventado' }])
      assert.equal(admitCommunicativePlan({ version: 1, acts: [{ ...pause, ...patch }] } as any,
        plan, plan, pauseMessage, pendingProcedure, services).continuity, undefined)
  })
  await check('O sole pause cannot rescue global IDs quotes or duplicate indexes', async () => {
    for (const corrupt of [
      () => acted([basket('set', [member('single', ['foreign'], pauseMessage)], pauseMessage)], [act('pause', 'general', pauseMessage)]),
      () => acted([{ ...orphanBasket, evidence: 'inventado' }], [act('pause', 'general', pauseMessage)]),
      () => acted([orphanBasket], [act('pause', 'general', pauseMessage, [0, 0])]),
      () => acted([orphanBasket], [act('pause', 'general', 'inventado')])
    ]) {
      const before = providerCalls, reads = agendaCalls, result = await say(pendingProcedure, pauseMessage, corrupt())
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.deepEqual(selectionBasket(result.state), selectionBasket(pendingProcedure))
      assert.equal(result.bookingCommand, undefined); assert.equal(providerCalls, before + 1); assert.equal(agendaCalls, reads)
    }
  })
  await check('O owned current companions retain their normal route rather than being hidden by pause', () => {
    const message = 'Ana mañana 17:00 dirección Corte y barba después seguimos'
    for (const [operation, field, kind] of [
      [{ kind: 'name', value: 'Ana', ...ev('Ana') }, 'name', 'change'],
      [{ kind: 'date', expression: 'mañana', ...ev('mañana') }, 'date', 'request'],
      [{ kind: 'time', value: '17:00', ...ev('17:00') }, 'time', 'request'],
      [basket('set', [member('single', ['cut-b'], 'Corte y barba')], 'Corte y barba'), 'service', 'change'],
      [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dirección') }, 'general', 'inquiry']
    ] as const) {
      const plan = parseTurnPlan({ version: 1, operations: [operation] }, message, services.map(item => item.id))
      const metadata = parseCommunicativeActs({ version: 1, acts: [act('pause', 'general', 'después seguimos'),
        act(kind, field, message, [0])] }, message, 1, plan)
      const result = admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services)
      assert.deepEqual(result.plan, plan); assert.deepEqual(result.blockedFields, []); assert.equal(result.continuity, undefined)
    }
  })
  await check('O orphan confirmation under pause never consumes an existing proposal or reference', async () => {
    const state = structuredClone(pendingReference.state), calls = providerCalls, beforeReads = syntheticSandboxReads
    const result = await respondWithAiInterpreter(sandboxContext, state, pauseMessage, sandboxPort, async () => {
      providerCalls++
      return acted([{ kind: 'confirm_proposal', ...ev(pauseMessage) }], [act('pause', 'general', pauseMessage)])
    })
    assert.deepEqual(result.state, state); assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
    assert.match(result.reply, /cuando quieras seguimos/i); assert.doesNotMatch(result.reply, /[¿?]|confirmad|reservad/i)
    assert.equal(providerCalls, calls + 1); assert.equal(syntheticSandboxReads, beforeReads)
  })
  await check('a pause does not consume a proposal or reference scope', async () => {
    const state = structuredClone(pendingReference.state)
    const result = await say(state, 'Lo pienso y después sigo', acted([], [act('pause', 'general', 'Lo pienso y después sigo')], 'other'))
    assert.deepEqual(result.state, state)
    assert.equal(result.bookingCommand, undefined)
    assert.doesNotMatch(result.reply, /cancelad|confirmad|reservad|Cristian.*atiende/i)
  })
  await check('current request still resumes the pending procedure', async () => {
    const message = 'Quiero seguir con el pedido'
    const result = await say(pendingProcedure, message, acted([], [act('request', 'service', message)], 'booking'))
    assert.notEqual(result.reply, 'Dale, cuando quieras seguimos con tu pedido.')
    assert.deepEqual(result.state.serviceRequest, pendingProcedure.serviceRequest)
    assert.match(result.reply, /corte francés|procedimiento|servicio/i)
  })
  await check('notice with an independent information read does not suppress that read', async () => {
    const message = 'Estoy llegando, cuál es la dirección'
    const result = await say(pendingProcedure, message, acted([
      { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dirección') }
    ], [act('notice', 'general', 'Estoy llegando'), act('inquiry', 'general', 'dirección', [0])], 'information'))
    assert.match(result.reply, /Calle de prueba 123/)
    assert.deepEqual(result.state.basket, pendingProcedure.basket)
    assert.deepEqual(result.state.serviceRequest, pendingProcedure.serviceRequest)
  })
  await check('notice with an independent customer update applies the actual answer', async () => {
    const message = 'Estoy llegando, cambiá mi nombre a Elena'
    const result = await say(pendingProcedure, message, acted([
      { kind: 'name', value: 'Elena', ...ev('Elena') }
    ], [act('notice', 'general', 'Estoy llegando'), act('change', 'name', 'cambiá mi nombre a Elena', [0])]))
    assert.equal(result.state.customerName, 'Elena')
    assert.deepEqual(result.state.basket, pendingProcedure.basket)
    assert.deepEqual(result.state.serviceRequest, pendingProcedure.serviceRequest)
  })
  await check('nonoperative metadata cannot authorize a read or booking mutation', () => {
    for (const kind of ['notice', 'pause', 'repair']) {
      for (const raw of [
        { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dirección') },
        { kind: 'name', value: 'Elena', ...ev('Elena') }
      ]) {
        const message = raw.kind === 'information' ? 'dirección' : 'Elena'
        const plan = parseTurnPlan({ version: 1, operations: [raw] }, message, services.map(item => item.id))
        const metadata = parseCommunicativeActs({ version: 1, acts: [act(kind, 'general', message, [0])] }, message, 1)
        const result = admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services)
        assert.equal(result.plan.operations.length, 0)
        assert.equal((result as typeof result & { continuity?: string }).continuity, undefined)
      }
    }
  })
  await check('only strong current unlinked general acts gain continuity', () => {
    const plan = parseTurnPlan({ version: 1, operations: [] }, 'Lo pienso y sigo', [])
    const proposals = [
      [act('pause', 'general', 'Lo pienso y sigo', [], null, .5)],
      [act('pause', 'service', 'Lo pienso y sigo')],
      [act('reference', 'general', 'Lo pienso y sigo')],
      [act('pause', 'general', 'Lo pienso y sigo'), act('request', 'service', 'Lo pienso y sigo')],
      [act('pause', 'general', 'Lo pienso y sigo'), act('repair', 'general', 'Lo pienso y sigo')]
    ]
    for (const acts of proposals) {
      const metadata = parseCommunicativeActs({ version: 1, acts }, 'Lo pienso y sigo', 0)
      assert.equal((admitCommunicativePlan(metadata, plan, plan, 'Lo pienso y sigo', pendingProcedure, services) as
        ReturnType<typeof admitCommunicativePlan> & { continuity?: string }).continuity, undefined)
    }
    for (const acts of [
      [act('pause', 'general', 'De un mensaje anterior')],
      [act('pause', 'general', 'Lo pienso y sigo', [0])]
    ]) assert.throws(() => parseCommunicativeActs({ version: 1, acts }, 'Lo pienso y sigo', 0), /communicative/)
  })

  await check('a mismatched internal admission cannot suspend a current turn', async () => {
    const message = 'Estoy llegando'
    const empty = parseTurnPlan({ version: 1, operations: [] }, message, [])
    const claimed = parseTurnPlan({ version: 1, operations: [{ kind: 'name', value: 'Elena', ...ev('Elena') }] }, 'Elena', [])
    const response = await respond(context, pendingProcedure, message, port, {
      serviceId: null, candidateIds: [], correction: false, intent: 'other', turnPlan: empty,
      communicative: { plan: claimed, blockedFields: [], continuity: 'notice' }
    })
    assert.notEqual(response.reply, 'Gracias por avisar.')
    assert.deepEqual(response.state.basket, pendingProcedure.basket)
    assert.equal(response.state.customerName, pendingProcedure.customerName)
  })
  await check('a scoped current procedure inquiry is a read, not a service mutation', () => {
    const message = '¿El corte incluye lavado?'
    const operation = { kind: 'service_request', purpose: 'inquiry', disposition: 'needs_detail', serviceIds: ['cut-m'],
      correction: false, continuation: false, basis: 'related_category', sourceQuote: null, ...ev('El corte incluye lavado') }
    const plan = parseTurnPlan({ version: 1, operations: [operation] }, message, services.map(item => item.id))
    const metadata = parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', 'El corte incluye lavado', [0])] }, message, 1)
    const admitted = admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services)
    assert.deepEqual(admitted.plan, plan)
    assert.deepEqual(admitted.blockedFields, [])
  })
  await check('inquiry authority cannot acquire a booking procedure or change its field', () => {
    const message = '¿El corte incluye lavado?'
    for (const purpose of ['inquiry', 'booking']) for (const [kind, field, confidence] of [
      ['inquiry', 'general', .99], ['reference', 'service', .99], ['uncertain', 'service', .99], ['inquiry', 'service', .5],
      ['notice', 'service', .99], ['pause', 'service', .99], ['repair', 'service', .99]
    ] as const) {
      const operation = { kind: 'service_request', purpose, disposition: 'needs_detail', serviceIds: ['cut-m'],
        correction: false, continuation: false, basis: 'related_category', sourceQuote: null, ...ev('El corte incluye lavado') }
      const plan = parseTurnPlan({ version: 1, operations: [operation] }, message, services.map(item => item.id))
      const metadata = parseCommunicativeActs({ version: 1, acts: [act(kind, field, 'El corte incluye lavado', [0], null, confidence)] }, message, 1)
      const admitted = admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services)
      assert.equal(admitted.plan.operations.length, 0)
      assert.deepEqual(admitted.blockedFields, ['service'])
    }
    const booking = parseTurnPlan({ version: 1, operations: [{ kind: 'service_request', purpose: 'booking', disposition: 'needs_detail', serviceIds: ['cut-m'],
      correction: false, continuation: false, basis: 'related_category', sourceQuote: null, ...ev('El corte incluye lavado') }] }, message, services.map(item => item.id))
    const inquiry = parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', 'El corte incluye lavado', [0])] }, message, 1)
    assert.equal(admitCommunicativePlan(inquiry, booking, booking, message, pendingProcedure, services).plan.operations.length, 0)
    assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', 'Cita inventada', [0])] }, message, 1), /communicative/)
    assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', 'El corte incluye lavado', [1])] }, message, 1), /communicative/)
  })
  await check('date priorities share date authority, not a general or historical act', () => {
    const message = 'prefiero viernes o martes'
    const operation = { kind: 'date_preferences', candidates: [
      { expression: 'viernes', value: '2026-10-09' }, { expression: 'martes', value: '2026-10-06' }
    ], ...ev(message) }
    const plan = parseTurnPlan({ version: 1, operations: [operation] }, message)
    const current = parseCommunicativeActs({ version: 1, acts: [act('request', 'date', message, [0])] }, message, 1)
    assert.equal(admitCommunicativePlan(current, plan, plan, message, pendingProcedure, services).plan.operations.length, 1)
    for (const kind of ['inquiry', 'reference', 'notice'] as const) {
      const metadata = parseCommunicativeActs({ version: 1, acts: [act(kind, 'date', message, [0])] }, message, 1)
      assert.deepEqual(admitCommunicativePlan(metadata, plan, plan, message, pendingProcedure, services).blockedFields, ['date'])
    }
  })
  await check('captured basket plus malformed procedure fails closed while basket alone acquires both', async () => {
    const cream: DialogueService = { id: 'cream', name: 'Baño de crema', price: 10000, durationMinutes: 30, requiresConsultation: false }
    const catalog = [...services, cream], selectedPort = { ...port, catalog: async () => catalog }
    const message = 'Quiero corte de mujer y baño de crema. Soy Ana.'
    const acquisition = basket('set', [member('single', ['cut-w'], 'corte de mujer'), member('single', ['cream'], 'baño de crema')], 'corte de mujer y baño de crema')
    const bad = { kind: 'service_request', purpose: 'booking', disposition: 'clear', serviceIds: ['cut-w', 'cream'],
      correction: false, basis: 'exact_public_name', sourceQuote: null, continuation: false, ...ev('corte de mujer y baño de crema') }
    for (const procedure of [bad, { ...bad, serviceIds: ['cut-w'] }, { ...bad, serviceIds: ['foreign'] }, { ...bad, evidence: 'Inventado' }]) {
      const result = await say(initial, message, acted([acquisition, procedure], [act('request', 'service', message, [0, 1])]), selectedPort)
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.equal(selectionBasket(result.state).members.length, 0)
      assert.equal(result.bookingCommand, undefined)
    }
    const correct = await say(initial, message, acted([acquisition, { kind: 'name', value: 'Ana', ...ev('Ana') }], [
      act('request', 'service', 'corte de mujer y baño de crema', [0]), act('answer', 'name', 'Soy Ana', [1])
    ]), selectedPort)
    assert.equal(correct.interpretation.mode, 'ai')
    assert.deepEqual(selectionBasket(correct.state).members.map(item => item.serviceIds), [['cut-w'], ['cream']])
    assert.equal(correct.state.customerName, 'Ana')
    assert.equal(correct.state.date, null); assert.equal(correct.state.requestedTime, null)
    assert.equal(correct.bookingCommand, undefined)
  })
  // E2.26j: sharing one aggregate operation needs every current owner's authority.
  const sharedMessage = 'Quiero Corte mujer y Alisado. Soy Ana.'
  const sharedBasket = basket('set', [member('single', ['cut-w'], 'Corte mujer'), member('single', ['smooth'], 'Alisado')], 'Corte mujer y Alisado')
  const sharedOwners = [act('request', 'service', 'Corte mujer', [0]), act('request', 'service', 'Alisado', [0])]
  const sharedPlan = parseTurnPlan({ version: 1, operations: [sharedBasket, { kind: 'name', value: 'Ana', ...ev('Ana') }] }, sharedMessage, services.map(item => item.id))
  const sharedMetadata = (owners: object[], source = sharedPlan) => parseCommunicativeActs({ version: 1, acts: [...owners, act('answer', 'name', 'Soy Ana', [1])] }, sharedMessage, source.operations.length, source)
  await check('shared basket parser distinguishes owners across acts from duplicates inside one act', () => {
    assert.ok(sharedMetadata(sharedOwners))
    assert.throws(() => parseCommunicativeActs({ version: 1, acts: sharedOwners }, sharedMessage, 2), /communicative/)
    assert.throws(() => sharedMetadata([act('request', 'service', 'Corte mujer', [0, 0])]), /communicative/)
    assert.throws(() => parseCommunicativeActs({ version: 1, acts: sharedOwners }, sharedMessage, 1, sharedPlan), /communicative/)
    const nonBasket = parseTurnPlan({ version: 1, operations: [{ kind: 'name', value: 'Ana', ...ev('Ana') }] }, sharedMessage)
    assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('answer', 'name', 'Ana', [0]), act('answer', 'name', 'Soy Ana', [0])] }, sharedMessage, 1, nonBasket), /communicative/)
    for (const bad of [act('request', 'service', 'inventado', [0]), act('request', 'service', 'Corte mujer', [9])]) assert.throws(() => sharedMetadata([bad, sharedOwners[1]!]), /communicative/)
  })
  await check('all strong shared request owners cover the basket in either order', () => {
    for (const owners of [sharedOwners, [...sharedOwners].reverse()]) {
      const result = admitCommunicativePlan(sharedMetadata(owners), sharedPlan, sharedPlan, sharedMessage, initial, services)
      assert.deepEqual(result.plan.operations, sharedPlan.operations)
      assert.deepEqual(result.blockedFields, [])
    }
  })
  await check('captured two-service owners acquire both through the real interpretation seam', async () => {
    const cream: DialogueService = { id: 'cream', name: 'Baño de crema', price: 10000, durationMinutes: 30, requiresConsultation: false }
    const message = 'Quiero corte de mujer y baño de crema. Soy Ana.'
    const acquisition = basket('set', [member('single', ['cut-w'], 'corte de mujer'), member('single', ['cream'], 'baño de crema')], 'corte de mujer y baño de crema')
    const result = await say(initial, message, acted([acquisition, { kind: 'name', value: 'Ana', ...ev('Ana') }], [
      act('request', 'service', 'corte de mujer', [0]), act('request', 'service', 'baño de crema', [0]), act('answer', 'name', 'Soy Ana', [1])
    ]), { ...port, catalog: async () => [...services, cream] })
    assert.equal(result.interpretation.mode, 'ai')
    assert.deepEqual(selectionBasket(result.state).members.map(item => item.serviceIds), [['cut-w'], ['cream']])
    assert.equal(result.state.customerName, 'Ana'); assert.equal(result.bookingCommand, undefined)
  })
  const invalidOwners = [
    [sharedOwners[0]!, act('request', 'service', 'Corte mujer', [0])],
    [...sharedOwners, act('request', 'service', 'Soy Ana', [0])],
    [sharedOwners[0]!, act('request', 'service', 'Alisado', [0], null, .5)],
    [sharedOwners[0]!, act('request', 'professional', 'Alisado', [0])],
    ...['change', 'answer', 'inquiry', 'reference', 'uncertain'].map(kind => [sharedOwners[0]!, act(kind, 'service', 'Alisado', [0])])
  ]
  for (const [index, owners] of invalidOwners.entries()) await check('incompatible shared authority blocks only service ' + index, () => {
    const result = admitCommunicativePlan(sharedMetadata(owners), sharedPlan, sharedPlan, sharedMessage, initial, services)
    assert.deepEqual(result.blockedFields, ['service'])
    assert.deepEqual(result.plan.operations.map(item => item.kind), ['name'])
  })
  await check('shared request cannot replace an existing basket; add and explicit change stay bounded', () => {
    const prior = parseTurnPlan({ version: 1, operations: [basket('set', [member('single', ['cut-m'], 'Corte hombre')], 'Corte hombre')] }, 'Corte hombre', services.map(item => item.id)).operations[0]!
    if (prior.kind !== 'basket') throw new Error('controlled prior must be a basket')
    const current = { ...initial, basket: applyBasketMutation(selectionBasket(initial), prior).basket }
    assert.deepEqual(admitCommunicativePlan(sharedMetadata(sharedOwners), sharedPlan, sharedPlan, sharedMessage, current, services).blockedFields, ['service'])
    for (const [mutation, kind] of [['add', 'request'], ['set', 'change'], ['replace', 'change']] as const) {
      const source = parseTurnPlan({ version: 1, operations: [{ ...sharedBasket, mutation }, sharedPlan.operations[1]!] }, sharedMessage, services.map(item => item.id))
      const owners = sharedOwners.map(owner => ({ ...owner, kind }))
      const result = admitCommunicativePlan(sharedMetadata(owners, source), source, source, sharedMessage, current, services)
      assert.deepEqual(result.blockedFields, [], mutation)
      if (kind === 'change') assert.deepEqual(admitCommunicativePlan(sharedMetadata(owners, source), source, source, sharedMessage, initial, services).blockedFields, ['service'])
    }
    const answers = sharedOwners.map(owner => ({ ...owner, kind: 'answer' }))
    assert.deepEqual(admitCommunicativePlan(sharedMetadata(answers), sharedPlan, sharedPlan, sharedMessage, current, services).blockedFields, ['service'])
  })
  await check('shared answers need the current closed service choice and each owner covers it', () => {
    const current = structuredClone(first.state)
    const message = 'Corte mujer'
    const source = parseTurnPlan({ version: 1, operations: [basket('replace', [member('single', ['cut-w'], message)], message, [groupId])] }, message, services.map(item => item.id))
    const metadata = parseCommunicativeActs({ version: 1, acts: [act('answer', 'service', message, [0]), act('answer', 'service', message, [0])] }, message, 1, source)
    assert.deepEqual(admitCommunicativePlan(metadata, source, source, message, current, services).blockedFields, [])
    const stale = { ...current, pending: 'date' as const }
    assert.deepEqual(admitCommunicativePlan(metadata, source, source, message, stale, services).blockedFields, ['service'])
  })
  await check('historical sharing cannot authorize replacement and independent current name survives', async () => {
    const message = 'La última vez Corte mujer y Alisado. Soy Ana.'
    const result = await say(first.state, message, acted([...sharedPlan.operations], [act('reference', 'service', 'Corte mujer', [0]), act('reference', 'service', 'Alisado', [0]), act('answer', 'name', 'Soy Ana', [1])]))
    assert.equal(result.interpretation.mode, 'ai'); assert.deepEqual(result.state.basket, first.state.basket); assert.equal(result.state.customerName, 'Ana')
  })
  await check('weak shared service authority keeps independent date, name and information', async () => {
    const message = 'Corte mujer y Alisado mañana. Soy Ana. Dónde están?'
    const result = await say(initial, message, acted([sharedBasket, { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }, { kind: 'name', value: 'Ana', ...ev('Ana') }, { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('Dónde están') }], [
      sharedOwners[0]!, act('request', 'service', 'Alisado', [0], null, .5), act('request', 'date', 'mañana', [1]), act('answer', 'name', 'Soy Ana', [2]), act('inquiry', 'general', 'Dónde están', [3])
    ]))
    assert.equal(result.interpretation.mode, 'ai'); assert.equal(selectionBasket(result.state).members.length, 0)
    assert.equal(result.state.date, '2026-10-06'); assert.equal(result.state.customerName, 'Ana'); assert.match(result.reply, /Calle de prueba 123/)
  })
  await check('shared basket cannot rescue malformed companions or an invalid original catalog ID', async () => {
    for (const operations of [[sharedBasket, { kind: 'name', value: 'Eva', ...ev('inventado') }], [{ ...sharedBasket, members: [member('single', ['foreign'], 'Corte mujer'), member('single', ['smooth'], 'Alisado')] }, sharedPlan.operations[1]!]]) {
      const result = await say(first.state, sharedMessage, acted(operations, [...sharedOwners, act('answer', 'name', 'Soy Ana', [1])]))
      assert.equal(result.interpretation.reason, 'invalid_output'); assert.equal(result.interpretation.validation?.turnPlan?.outcome, 'rejected'); assert.equal(result.state.customerName, 'Ana', 'existing literal fallback may use the current name, never the malformed Eva proposal'); assert.deepEqual(result.state.basket, first.state.basket)
    }
  })

  // K: only the mention may be re-anchored; current literal evidence is not relaxed.
  const capturedInquiry = '¿Ese tratamiento incluye lavado?'
  const capturedMention = 'ese tratamiento incluye lavado'
  await check('K unique case-only mention returns current literal in cloned metadata', () => {
    const value = { version: 1, acts: [act('inquiry', 'service', capturedInquiry, [], capturedMention)] }
    const before = structuredClone(value)
    const parsed = parseCommunicativeActs(value, capturedInquiry, 0)!
    assert.equal(parsed.acts[0]?.mention, 'Ese tratamiento incluye lavado')
    assert.equal(parsed.acts[0]?.evidence, capturedInquiry)
    assert.deepEqual(value, before)
    assert.notEqual(parsed, value); assert.notEqual(parsed.acts[0], value.acts[0])
  })
  await check('K literal regex metacharacters and accented Unicode case keep original spans', () => {
    for (const [evidence, mention, expected] of [
      ['¿ÁCIDO (A+B)?', 'ácido (a+b)', 'ÁCIDO (A+B)'],
      ['¿ÑANDÚ?', 'ñandú', 'ÑANDÚ'],
      ['😀 TRATAMIENTO 😀', 'tratamiento', 'TRATAMIENTO']
    ]) {
      const parsed = parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', evidence!, [], mention!)] }, evidence!, 0)!
      assert.equal(parsed.acts[0]?.mention, expected)
    }
  })
  await check('K exact and null mentions retain legacy acceptance even for repeated literals', () => {
    assert.equal(parseCommunicativeActs(null, capturedInquiry, 0), null)
    for (const mention of ['Tratamiento', null]) {
      const value = { version: 1, acts: [act('inquiry', 'service', 'Tratamiento Tratamiento', [], mention)] }
      assert.deepEqual(parseCommunicativeActs(value, 'Tratamiento Tratamiento', 0), value)
    }
  })
  await check('K case-only anchoring rejects accents punctuation whitespace and homoglyph changes', () => {
    for (const [evidence, mention] of [
      ['¿Ácido?', 'acido'], ['¿Tratamiento?', 'tratamiento!'],
      ['Ese  tratamiento', 'ese tratamiento'], ['Ese tratamiento', 'ese  tratamiento'],
      ['Ese tratamiento', 'ese\u00a0tratamiento'], ['Tratamiento', 'tr\u0430tamiento'],
      ['Straße', 'STRASSE'], ['A+B', 'a.b']
    ]) assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', evidence!, [], mention!)] }, evidence!, 0), /communicative/)
  })
  await check('K case-only match must be unique including overlapping spans', () => {
    for (const [evidence, mention] of [['Tratamiento TRATAMIENTO', 'tratamiento'], ['AAA', 'aa']])
      assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', evidence!, [], mention!)] }, evidence!, 0), /communicative/)
  })
  await check('K current evidence remains exact and inherited or case-rewritten evidence fails', () => {
    for (const evidence of ['¿ese tratamiento incluye lavado?', '¿El anterior tratamiento incluye lavado?'])
      assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', evidence, [], capturedMention)] }, capturedInquiry, 0), /communicative/)
  })
  await check('K mention anchoring does not relax duplicate positions or invalid indexes', () => {
    for (const indexes of [[0, 0], [1], [-1]])
      assert.throws(() => parseCommunicativeActs({ version: 1, acts: [act('inquiry', 'service', capturedInquiry, indexes, capturedMention)] }, capturedInquiry, 1), /communicative/)
  })
  const capturedOperation = {
    kind: 'service_request', purpose: 'inquiry', disposition: 'needs_detail', serviceIds: [],
    correction: false, continuation: false, basis: 'related_category', sourceQuote: null, ...ev(capturedInquiry)
  }
  await check('K captured case-only inquiry crosses parser without acquiring a service', async () => {
    const output = acted([capturedOperation], [act('inquiry', 'service', capturedInquiry, [0], capturedMention)], 'information')
    const before = structuredClone(output)
    const result = await say(initial, capturedInquiry, output)
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.serviceRequest?.request, capturedInquiry)
    assert.equal(result.state.serviceRequest?.purpose, 'inquiry')
    assert.equal(result.state.serviceId, null)
    assert.deepEqual(selectionBasket(result.state), selectionBasket(initial))
    assert.equal(result.bookingCommand, undefined)
    assert.deepEqual(output, before)
  })
  await check('K valid case anchor cannot rescue weak ownership or foreign catalog IDs', async () => {
    const weak = await say(initial, capturedInquiry, acted([capturedOperation],
      [act('inquiry', 'service', capturedInquiry, [0], capturedMention, .84)], 'information'))
    assert.equal(weak.interpretation.mode, 'ai')
    assert.equal(weak.state.serviceRequest, undefined)
    const foreign = await say(initial, capturedInquiry, acted([{ ...capturedOperation, serviceIds: ['foreign'] }],
      [act('inquiry', 'service', capturedInquiry, [0], capturedMention)], 'information'))
    assert.equal(foreign.interpretation.reason, 'invalid_output')
    assert.equal(foreign.state.serviceRequest, undefined)
    assert.equal(foreign.state.serviceId, null)
  })


  await check('N owner evidence is current and bounded separately from the complete inquiry body', async () => {
    const module = await import('../src/conversational-bot/communicative-act.js')
    const scopeModule = await import('../src/conversational-bot/service-information-scope.js')
    const message = 'De esas opciones, me interesa el valor del corte de mujer.'
    const quote = 'me interesa el valor del corte de mujer', mention = 'corte de mujer'
    const source = parseTurnPlan({ version: 1, operations: [{ kind: 'information',
      target: { kind: 'service', actions: [], serviceIds: ['cut-w'], aspect: 'price' }, ...ev(quote) }] },
      message, services.map(item => item.id))
    const owner = act('inquiry', 'service', quote, [0], mention)
    const metadata = parseCommunicativeActs({ version: 1, acts: [act('answer', 'service', 'el corte de mujer', [], mention), owner] },
      message, source.operations.length, source)
    const scopes = module.deriveCurrentServiceInquiries(metadata, source, source, message, context.businessId)
    assert.equal(scopes.length, 1)
    const scope = scopes[0]! as unknown as Record<string, any>
    assert.equal(scope.ownerEvidence, quote); assert.equal(scope.inquiryEvidence, message); assert.equal(scope.operationEvidence, quote)
    assert.deepEqual(module.remapCurrentServiceInquiries(scopes, source, structuredClone(source), message, context.businessId), scopes)
    for (const patch of [{ ownerEvidence: 'inventado' }, { ownerEvidence: 'me interesa' },
      { ownerEvidence: quote + ' ' + mention }, { ownerEvidence: quote + ' '.repeat(300) },
      { inquiryEvidence: quote }, { businessId: 'foreign' }, { operationEvidence: 'corte de mujer' }]) {
      assert.equal(scopeModule.validCurrentServiceInquiry({ ...scope, ...patch } as any, source.operations[0], message, context.businessId), false)
      assert.deepEqual(module.remapCurrentServiceInquiries([{ ...scope, ...patch }] as any, source, source, message, context.businessId), [])
    }
    for (const patch of [{ confidence: .84 }, { mention: null }, { operationIndexes: [] },
      { evidence: 'me interesa' }, { kind: 'reference' }, { field: 'general' }])
      assert.deepEqual(module.deriveCurrentServiceInquiries({ version: 1, acts: [{ ...owner, ...patch }] } as any,
        source, source, message, context.businessId), [])
    assert.deepEqual(module.deriveCurrentServiceInquiries({ version: 1, acts: [owner, owner] } as any,
      source, source, message, context.businessId), [])
  })
  await check('M only one current strong service inquiry owns an exact operation scope', async () => {
    const module = await import('../src/conversational-bot/communicative-act.js') as unknown as Record<string, (...args: any[]) => any>
    const message = 'Me interesa saber el valor del corte de mujer.'
    const operation = { kind: 'information', target: { kind: 'service', actions: [], serviceIds: ['cut-w'], aspect: 'price' }, ...ev('el valor del corte de mujer') }
    const source = parseTurnPlan({ version: 1, operations: [operation] }, message, services.map(item => item.id))
    const owner = act('inquiry', 'service', message, [0], 'corte de mujer')
    const derive = (acts: object[], final = source) => module.deriveCurrentServiceInquiries!({ version: 1, acts }, source, final, message, context.businessId)
    assert.equal(derive([owner]).length, 1)
    assert.equal(derive([{ ...owner, evidence: operation.evidence }]).length, 1, 'original current short quote now proves ownership separately')
    for (const patch of [{ confidence: .84 }, { confidence: 1.5 }, { confidence: Infinity }, { kind: 'reference' }, { field: 'general' }, { mention: null },
      { operationIndexes: [] }, { evidence: 'Me interesa saber' }, { mention: 'Inventado' }])
      assert.deepEqual(derive([{ ...owner, ...patch }]), [])
    assert.deepEqual(derive([owner, owner]), [])
    assert.deepEqual(derive([owner], { version: 1, operations: [] }), [])
    const changed = { ...source, operations: [{ ...operation, target: { ...operation.target, serviceIds: ['cut-m'] } }] }
    assert.deepEqual(derive([owner], changed as typeof source), [])
  })

  // S uses a genuine earlier exact selection, then rejects only the mismatched current field.
  let clockReads=0
  const clockPort: DialoguePort={...port,availability:async(_service,date)=>{
    clockReads++
    return {professionals:[{id:'clock-pro',name:'Leo',priority:0}],slots:['13:00','13:30','17:00'].map(time=>({date,time,startAt:date+'T'+String(Number(time.slice(0,2))+3).padStart(2,'0')+':'+time.slice(3)+':00.000Z',professionalId:'clock-pro',professionalName:'Leo',band:'AFTERNOON' as const,occupiedMinutes:0}))}
  }}
  const clockStart=parseDialogueState({...initial,serviceId:'cut-m',date:'2026-10-07',professional:{kind:'specific',id:'clock-pro'},pending:'time'},context.businessId,context.timezone)
  const selectedClock=await respondWithAiInterpreter(context,clockStart,'a las17:00',clockPort,async()=>acted([{kind:'time',value:'17:00',...ev('a las17:00')}],[act('request','time','a las17:00',[0])]))
  assert.equal(selectedClock.state.slot?.time,'17:00')
  await check('S mismatch retains independent name and original operation indexes',async()=>{
    const message='13:30, soy Julia',before=clockReads
    const result=await say(selectedClock.state,message,acted([{kind:'time',value:'13:00',...ev('13:30')},{kind:'name',value:'Julia',...ev('Julia')}],[act('change','time','13:30',[0]),act('answer','name','soy Julia',[1])]),clockPort)
    assert.equal(result.interpretation.mode,'ai');assert.equal(result.interpretation.reason,null)
    assert.deepEqual(result.interpretation.temporalGrounding,{outcome:'field_rejected',field:'time',reason:'clock_value_mismatch'})
    assert.equal(result.state.customerName,'Julia');assert.equal(result.state.date,'2026-10-07')
    assert.deepEqual(result.state.professional,selectedClock.state.professional)
    assert.equal(result.state.timeMeaningClarification,true);assert.equal(result.state.slot,null);assert.equal(result.state.requestedTime,null)
    assert.equal(clockReads,before);assert.equal(result.bookingCommand,undefined)
    const restored=parseDialogueState(JSON.parse(JSON.stringify(result.state)),context.businessId,context.timezone)
    const next=await say(restored,'soy Laura',acted([{kind:'name',value:'Laura',...ev('Laura')}],[act('change','name','soy Laura',[0])]),clockPort)
    assert.equal(next.state.customerName,'Laura');assert.equal(next.state.timeMeaningClarification,true)
    assert.equal(next.state.slot,null);assert.equal(clockReads,before)
  })
  await check('S weak historical and wrong-field mismatch cannot erase a valid selection',async()=>{
    for(const owner of [act('reference','time','13:30',[0]),act('uncertain','time','13:30',[0]),act('change','service','13:30',[0]),act('change','time','13:30',[0],null,.6)]) {
      const before=clockReads
      const result=await say(selectedClock.state,'13:30',acted([{kind:'time',value:'13:00',...ev('13:30')}],[owner]),clockPort)
      assert.equal(result.interpretation.mode,'ai');assert.equal(result.state.timeMeaningClarification,undefined)
      assert.deepEqual(result.state.slot,selectedClock.state.slot);assert.equal(result.state.requestedTime,'17:00')
      assert.equal(clockReads,before);assert.equal(result.bookingCommand,undefined)
    }
  })
  await check('S temporal conflict cannot rescue malformed source or duplicate acts',async()=>{
    const message='13:30 Corte hombre'
    const time={kind:'time',value:'13:00',...ev('13:30')}
    for(const output of [
      acted([time,{kind:'service',mode:'single',serviceIds:['foreign-id'],correction:false,...ev('Corte hombre')}],[act('change','time','13:30',[0]),act('change','service','Corte hombre',[1])]),
      acted([{...time,evidence:'inventado'}],[act('change','time','13:30',[0])]),
      acted([time],[act('change','time','13:30',[0]),act('change','time','13:30',[0])]),
      acted([time,{...time}],[act('change','time','13:30',[0,1])])
    ]) {
      const result=await say(initial,message,output)
      assert.equal(result.interpretation.mode,'fallback');assert.equal(result.interpretation.reason,'invalid_output')
      assert.equal(result.interpretation.temporalGrounding,undefined)
    }
  })

  await check('P13 social initiation and name retain a useful next in one call', async () => {
    const identityPort: DialoguePort = { ...port, identity: async () => ({ businessId: context.businessId,
      businessName: 'Barber Demo', assistantName: 'Cami', treatment: 'vos', greetingEmoji: '😊' }) }
    for (const message of ['Hola que tal soy Matías', 'Hola\ncomo están muchachos\nsoy Matías']) {
      const output = { ...acted([{ kind: 'name', value: 'Matías', ...ev('soy Matías') }],
        [act('social', 'general', message), act('request', 'name', 'soy Matías', [0], 'Matías')], 'other'),
        firstReply: { salutation: 'greeting', opening: '¡Todo bien, gracias! ¿Vos?', factIds: null, closing: null, variantChoices: null } }
      const before = providerCalls
      const result = await say({ ...initial, introduced: false }, message, output, identityPort)
      assert.equal(result.interpretation.mode, 'ai', JSON.stringify(result.interpretation))
      assert.equal(result.state.customerName, 'Matías', JSON.stringify({state:result.state,interpretation:result.interpretation}))
      assert.equal(result.interpretation.aiCalls, 1)
      assert.equal(providerCalls, before + 1)
      assert.equal(result.interpretation.copyMode, 'ai', JSON.stringify({reply:result.reply,interpretation:result.interpretation}))
      assert.match(result.reply, /Todo bien, gracias/)
      assert.match(result.reply, /¿En qué te puedo ayudar/)
      assert.equal((result.reply.match(/Soy Cami/g) ?? []).length, 1, result.reply)
      assert.doesNotMatch(result.reply, /Gracias por avisar|Qué servicio necesitás/)
    }
  })
  await check('P13 social fallback keeps next while rejecting model identity', async () => {
    const output = { ...acted([], [act('social', 'general', 'Hola, cómo están')], 'other'),
      firstReply: { salutation: 'greeting', opening: 'Soy otra asistente.', factIds: null, closing: null, variantChoices: null } }
    const identityPort: DialoguePort = { ...port, identity: async () => ({ businessId: context.businessId,
      businessName: 'Barber Demo', assistantName: 'Cami', treatment: 'vos' }) }
    const result = await say({ ...initial, introduced: false }, 'Hola, cómo están', output, identityPort)
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'identity_in_frame')
    assert.match(result.reply, /¿En qué te puedo ayudar/)
    assert.doesNotMatch(result.reply, /otra asistente|Gracias por avisar/)
    assert.equal(result.interpretation.aiCalls, 1)
  })
  await check('P13 social active draft resumes its question without agenda or effects', async () => {
    const state: DialogueState = { ...initial, introduced: true, serviceId: 'cut-m', pending: 'date', customerName: 'Ana' }
    rememberDialogueQuestion(state, '¿Para qué día querés Corte hombre?')
    const result = await say(state, 'Cómo están', acted([], [act('social', 'general', 'Cómo están')], 'other'))
    assert.equal(result.interpretation.mode, 'ai')
    assert.match(result.reply, /¿Para qué día querés Corte hombre/, JSON.stringify({reply:result.reply,state:result.state,interpretation:result.interpretation}))
    assert.deepEqual(result.state, state)
    assert.equal(result.interpretation.aiCalls, 1)
  })
  await check('P13 social act cannot own a booking operation or suppress an independent request', () => {
    const operation = { kind: 'name', value: 'Ana', ...ev('Ana') }
    const plan = parseTurnPlan({ version: 1, operations: [operation] }, 'Hola Ana')
    const wrong = parseCommunicativeActs({ version: 1, acts: [act('social', 'name', 'Hola Ana', [0], 'Ana')] }, 'Hola Ana', 1, plan)
    const denied = admitCommunicativePlan(wrong, plan, plan, 'Hola Ana', initial, services)
    assert.equal(denied.social, undefined)
    assert.deepEqual(denied.plan.operations, [])
    assert.deepEqual(denied.blockedFields, ['name'])
    const social = parseCommunicativeActs({ version: 1, acts: [act('social', 'general', 'Hola'), act('request', 'name', 'Ana', [0], 'Ana')] }, 'Hola Ana', 1, plan)
    const accepted = admitCommunicativePlan(social, plan, plan, 'Hola Ana', initial, services)
    assert.equal(accepted.social, true)
    assert.deepEqual(accepted.plan.operations, plan.operations)
    for (const kind of ['notice', 'pause', 'repair']) {
      const mixed = parseCommunicativeActs({ version: 1, acts: [act('social', 'general', 'Hola'), act(kind, 'general', 'Ana')] }, 'Hola Ana', 0)
      const continuity = admitCommunicativePlan(mixed, { version: 1, operations: [] }, { version: 1, operations: [] }, 'Hola Ana', initial, services)
      assert.equal(continuity.social, undefined)
      assert.equal(continuity.continuity, kind, 'a polite greeting cannot erase a genuine notice or pause')
    }
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
