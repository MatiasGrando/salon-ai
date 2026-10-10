import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider, type AiResponseInput } from '../src/conversational-bot/ai-interpreter.js'
import { deriveCatalogInquiry } from '../src/conversational-bot/catalog-information-answer.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { parseInformationFocus } from '../src/conversational-bot/information-contract.js'
import { TURN_PLAN_INTERPRETATION_GUIDE } from '../src/conversational-bot/turn-plan-interpretation-guide.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'

// Synthetic fixtures only. No model, database, live conversation or external transport.
const original = { fetch: globalThis.fetch, request: http.request, httpsRequest: https.request, get: http.get, httpsGet: https.get }
const forbidden = () => { throw new Error('external transport forbidden in informational followup regression') }
globalThis.fetch = forbidden
http.request = forbidden as typeof http.request
https.request = forbidden as typeof https.request
http.get = forbidden as typeof http.get
https.get = forbidden as typeof https.get

const context = { businessId: 'information-followup', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T18:10:00Z') }
const initial = initialDialogueState(context.businessId)
const catalog: DialogueService[] = [
  { id: 'straight', name: 'Alisado sin formol', description: 'Prestación publicada orientada a reducir ondas del cabello.', price: 45000, durationMinutes: 90, requiresConsultation: false },
  { id: 'care', name: 'Tratamiento', description: 'Prestación publicada orientada a acondicionar el cabello.', price: 25000, durationMinutes: 30, requiresConsultation: false },
  { id: 'keratin', name: 'Keratina', description: 'Prestación publicada orientada a facilitar el peinado.', price: 32000, durationMinutes: 60, requiresConsultation: false }
]
const body = 'del alisado'
const focusState = (): DialogueState => ({
  ...initialDialogueState(context.businessId),
  informationFocus: { version: 1, businessId: context.businessId, topic: 'details', aspect: 'overview', serviceId: null,
    awaitingChoice: true, candidateId: null, options: catalog.map(service => ({ id: service.id, label: service.name })) }
})
const draft = (quote = catalog[0]!.description!) => ({
  salutation: null, opening: null, factIds: null, closing: null, variantChoices: null,
  catalogAnswer: { blocks: [{ kind: 'published', text: catalog[0]!.description!,
    sources: [{ serviceId: 'straight', field: 'description', quote }] }] }
})
const ownedAnswer = () => ({
  intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
  turnPlan: { version: 1, operations: [{ kind: 'information', evidence: body, confidence: .98,
    target: { kind: 'service', actions: [], serviceIds: ['straight'], aspect: 'description' } }] },
  communicativeActs: { version: 1, acts: [{ kind: 'answer', field: 'service', evidence: body, confidence: .98,
    mention: 'alisado', operationIndexes: [0] }] },
  firstReply: draft()
})
const scoped = (value: ReturnType<typeof ownedAnswer>, state = focusState(), services = catalog) => {
  const plan = parseTurnPlan(value.turnPlan, body, services.map(service => service.id))
  const acts = parseCommunicativeActs(value.communicativeActs, body, plan.operations.length, plan)
  return deriveCatalogInquiry(plan, acts, body, state, services)
}
const makePort = (services = catalog) => {
  let catalogCalls = 0, agendaCalls = 0
  const port: DialoguePort = {
    catalog: async () => { catalogCalls++; return services },
    availability: async () => { agendaCalls++; throw new Error('information followups cannot query appointments') },
    availabilityBasket: async () => { agendaCalls++; throw new Error('information followups cannot coordinate appointments') }
  }
  return { port, counts: () => ({ catalogCalls, agendaCalls }) }
}
const read = async (state: DialogueState, value: unknown, services = catalog) => {
  const { port, counts } = makePort(services)
  let calls = 0
  const provider: AiInterpretationProvider = async () => { calls++; return structuredClone(value) }
  const result = await respondWithAiInterpreter(context, state, body, port, provider)
  assert.equal(counts().agendaCalls, 0)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
  for (const key of ['serviceId', 'date', 'professional', 'slot', 'customerName', 'bookingReservation', 'sandboxReservation'] as const)
    assert.deepEqual(result.state[key], state[key], 'informational answer preserves ' + key)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
  assert.equal(result.handoffCommand, undefined)
  return { result, calls }
}
const comparisonBody = 'Quería saber la diferencia entre alisado y Keratina'
const generalExplanation = 'En general, un alisado busca reducir ondas; un tratamiento de keratina suele orientarse al acondicionamiento. Los nombres y efectos dependen de cada producto.'
const comparisonDraft = () => ({
  salutation: null, opening: null, factIds: null, closing: null, variantChoices: null,
  catalogAnswer: { blocks: [
    { kind: 'general', text: generalExplanation, sources: [] },
    { kind: 'published', text: catalog[0]!.description! + ' ' + catalog[2]!.description!, sources: [catalog[0]!, catalog[2]!].map(service =>
      ({ serviceId: service.id, field: 'description', quote: service.description! })) }
  ] }
})
const comparison = (firstReply: unknown = comparisonDraft()) => ({
  intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
  turnPlan: { version: 1, operations: [{ kind: 'information', evidence: comparisonBody, confidence: .98,
    target: { kind: 'service', actions: [], serviceIds: ['straight', 'keratin'], aspect: 'comparison' } }] },
  communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: comparisonBody, confidence: .98,
    mention: null, operationIndexes: [0] }] }, firstReply
})
const compose = async (state: DialogueState, message: string, value: unknown, secondDraft: unknown, services = catalog) => {
  const { port, counts } = makePort(services)
  let interpretations = 0, compositions = 0
  const compositionInputs: AiResponseInput[] = []
  const provider: AiInterpretationProvider = Object.assign(async () => { interpretations++; return structuredClone(value) },
    { respond: async (input: AiResponseInput) => {
      compositions++; compositionInputs.push(structuredClone(input))
      assert.equal(compositions, 1, 'only one composition after the accepted interpretation')
      return structuredClone(secondDraft)
    } })
  const result = await respondWithAiInterpreter(context, state, message, port, provider)
  assert.equal(counts().agendaCalls, 0)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
  for (const key of ['serviceId', 'date', 'professional', 'slot', 'customerName', 'bookingReservation', 'sandboxReservation'] as const)
    assert.deepEqual(result.state[key], state[key], 'composition preserves ' + key)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
  assert.equal(result.handoffCommand, undefined)
  return { result, interpretations, compositions, compositionInputs }
}
const failures: string[] = []
let passed = 0
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run(); passed++; console.log('PASS informational followup ' + name) }
  catch (error) { failures.push(name); console.error('RED informational followup ' + name + ': ' + String(error)) }
}
try {
  await check('a blocked acquisition still loads the real current informational focus catalog', async () => {
    const before = focusState(), plan = { version: 1 as const, operations: [] }
    const { port, counts } = makePort()
    const result = await respond(context, before, body, port,
      { intent: 'information', serviceId: null, candidateIds: [], correction: false, turnPlan: plan,
        communicative: { plan, blockedFields: ['service'] } }, { deferIntroduction: true })
    assert.equal(counts().catalogCalls, 1, 'absence of a loaded catalog cannot become evidence of a stale focus')
    assert.doesNotMatch(result.reply, /información vigente de ese servicio/)
    assert.deepEqual(selectionBasket(result.state), selectionBasket(before))
    assert.equal(counts().agendaCalls, 0)
    assert.equal(result.bookingCommand, undefined)
  })
  await check('a current semantic answer owns an informational description, not a booking reference', () => {
    assert.equal(scoped(ownedAnswer()).length, 1)
  })
  await check('comparison clarification then del alisado explains the model-owned current service', async () => {
    const message = 'Quería saber la diferencia entre alisado y shock de keratina'
    const firstValue = {
      intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
      // Existing informational menus may still be stored from an earlier, underspecified read.
      turnPlan: { version: 1, operations: [{ kind: 'information', evidence: message, confidence: .98,
        target: { kind: 'service', actions: [], serviceIds: catalog.map(service => service.id), aspect: 'overview' } }] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message, confidence: .98,
        mention: null, operationIndexes: [0] }] }, firstReply: null
    }
    const { port } = makePort()
    const first = await respondWithAiInterpreter(context, initial, message, port, async () => firstValue)
    assert.equal(first.state.informationFocus?.awaitingChoice, true)
    assert.equal(first.state.informationFocus?.options.length, 3)
    const { result, calls } = await read(first.state, ownedAnswer())
    assert.ok(result.reply.includes(catalog[0]!.description!))
    assert.doesNotMatch(result.reply, /De cuál|Qué servicio querés elegir|información vigente/)
    assert.equal(result.interpretation.replyRoute, 'first_call')
    assert.equal(result.interpretation.aiCalls, 1)
    assert.equal(calls, 1)
    assert.equal(result.choicePresentation, undefined)
  })
  await check('a genuinely renamed focus option cannot authorize the answer scope', async () => {
    const changed = catalog.map(service => service.id === 'straight' ? { ...service, name: 'Alisado nuevo' } : service)
    assert.equal(scoped(ownedAnswer(), focusState(), changed).length, 0)
    const { result } = await read(focusState(), ownedAnswer(), changed)
    assert.ok(!result.reply.includes(catalog[0]!.description!))
  })
  await check('an eliminated companion option is a genuinely stale informational menu', async () => {
    const changed = catalog.filter(service => service.id !== 'care')
    assert.equal(scoped(ownedAnswer(), focusState(), changed).length, 0)
    const { result } = await read(focusState(), ownedAnswer(), changed)
    assert.ok(!result.reply.includes(catalog[0]!.description!))
  })
  await check('an answer without the presented informational focus grants no descriptive scope', () => {
    assert.equal(scoped(ownedAnswer(), initial).length, 0)
  })
  await check('ambiguous public aliases cannot be hidden behind a proposed singleton', async () => {
    const changed = [...catalog, { ...catalog[0]!, id: 'other-straight', name: 'Alisado clásico', aliases: ['alisado'] }]
    const before = focusState()
    before.informationFocus!.options = changed.map(service => ({ id: service.id, label: service.name }))
    assert.equal(scoped(ownedAnswer(), before, changed).length, 0)
    const { result } = await read(before, ownedAnswer(), changed)
    assert.ok(!result.reply.includes(catalog[0]!.description!))
  })
  await check('foreign current evidence remains rejected rather than normalized', async () => {
    const value = ownedAnswer()
    value.turnPlan.operations[0]!.evidence = 'otro procedimiento'
    const { result } = await read(focusState(), value)
    assert.equal(result.interpretation.reason, 'invalid_output')
    assert.ok(!result.reply.includes(catalog[0]!.description!))
  })
  await check('weak ownership cannot use the focus as authority', async () => {
    const value = ownedAnswer()
    value.communicativeActs.acts[0]!.confidence = .5
    assert.equal(scoped(value).length, 0)
    const { result } = await read(focusState(), value)
    assert.ok(!result.reply.includes(catalog[0]!.description!))
  })
  await check('a mutation companion never receives the informational explanation scope', () => {
    const value = ownedAnswer()
    const plan = parseTurnPlan({ version: 1, operations: [
      value.turnPlan.operations[0],
      { kind: 'service', mode: 'single', serviceIds: ['straight'], correction: false, evidence: body, confidence: .98 }
    ] }, body, catalog.map(service => service.id))
    const acts = parseCommunicativeActs({ version: 1, acts: [
      value.communicativeActs.acts[0],
      { kind: 'request', field: 'service', evidence: body, confidence: .98, mention: 'alisado', operationIndexes: [1] }
    ] }, body, plan.operations.length, plan)
    assert.equal(deriveCatalogInquiry(plan, acts, body, focusState(), catalog).length, 0)
  })
  await check('unpublished description quotes remain rejected in an otherwise valid answer', async () => {
    const value = ownedAnswer()
    value.firstReply = draft('Contenido no publicado')
    const { result } = await read(focusState(), value)
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'unverified_value')
    assert.notEqual(result.interpretation.replyRoute, 'first_call')
  })
  await check('genuine comparison then a specific current answer explains without a booking menu', async () => {
    const first = await compose(initial, comparisonBody, comparison(), null)
    assert.ok(first.result.reply.includes(generalExplanation))
    assert.ok(first.result.reply.includes(catalog[0]!.description!))
    assert.ok(first.result.reply.includes(catalog[2]!.description!))
    assert.doesNotMatch(first.result.reply, /De cuál de estos|Qué servicio querés elegir/)
    assert.equal(first.result.interpretation.replyRoute, 'first_call')
    assert.equal(first.result.interpretation.aiCalls, 1)
    assert.equal(first.compositions, 0)
    assert.equal(first.result.choicePresentation, undefined)
    assert.deepEqual(first.result.state.informationFocus?.options.map(option => option.id), ['straight', 'keratin'])
    assert.equal(first.result.state.informationFocus?.awaitingChoice, false, 'explaining does not impose a choice')
    const next = ownedAnswer()
    const followup = await compose(first.result.state, body, next, null)
    assert.ok(followup.result.reply.includes(catalog[0]!.description!))
    assert.doesNotMatch(followup.result.reply, /información vigente|Qué servicio querés elegir/)
    assert.equal(followup.result.interpretation.replyRoute, 'first_call')
    assert.equal(followup.result.interpretation.aiCalls, 1)
    assert.equal(followup.compositions, 0)
    assert.equal(followup.result.choicePresentation, undefined)
    assert.equal(followup.result.state.informationFocus?.serviceId, 'straight')
    assert.equal(followup.result.state.informationFocus?.awaitingChoice, false)
  })
  await check('missing comparison draft composes once from verified explanatory scope', async () => {
    const { result, interpretations, compositions, compositionInputs } = await compose(initial, comparisonBody, comparison(null), comparisonDraft())
    assert.equal(compositions, 1)
    assert.equal(interpretations, 1)
    assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyRoute, 'second_call')
    assert.ok(result.reply.includes(generalExplanation))
    assert.doesNotMatch(result.reply, /De cuál de estos servicios/)
    assert.deepEqual(compositionInputs[0]!.catalogInformation?.services.map(service => service.id), ['straight', 'keratin'])
    assert.equal(compositionInputs[0]!.catalogInformation?.generalKnowledgeAllowed, true)
  })
  await check('missing focused description draft composes once without acquiring its service', async () => {
    const value = { ...ownedAnswer(), firstReply: null }
    const { result, compositions, compositionInputs } = await compose(focusState(), body, value, draft())
    assert.equal(compositions, 1)
    assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyRoute, 'second_call')
    assert.ok(result.reply.includes(catalog[0]!.description!))
    assert.doesNotMatch(result.reply, /información vigente|Qué servicio querés elegir/)
    assert.equal(compositionInputs[0]!.catalogInformation?.aspect, 'description')
    assert.deepEqual(compositionInputs[0]!.catalogInformation?.services.map(service => service.id), ['straight'])
  })
  await check('invalid comparison body repairs once without weakening current source validation', async () => {
    const unsafe = comparisonDraft()
    unsafe.catalogAnswer.blocks[1]!.sources[0]!.quote = 'Una descripción inexistente'
    const { result, compositions } = await compose(initial, comparisonBody, comparison(unsafe), comparisonDraft())
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'unverified_value')
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'accepted')
    assert.equal(compositions, 1)
    assert.ok(result.reply.includes(generalExplanation))
  })
  await check('accepted framing without an explanatory body composes the missing explanation once', async () => {
    const onlyFrame = { salutation: null, opening: 'Claro, te explico.', factIds: null, closing: null,
      variantChoices: null, catalogAnswer: null }
    const { result, compositions, interpretations } = await compose(initial, comparisonBody, comparison(onlyFrame), comparisonDraft())
    assert.equal(result.interpretation.replyValidation?.firstCall.status, 'accepted', 'retain original frame validation')
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, null)
    assert.equal(compositions, 1)
    assert.equal(interpretations, 1)
    assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyRoute, 'second_call')
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'accepted')
    assert.ok(result.reply.includes(generalExplanation))
    assert.ok(result.reply.includes(catalog[0]!.description!))
    assert.ok(result.reply.includes(catalog[2]!.description!))
  })
  await check('an accepted second frame without an explanation is not delivered as completed AI copy', async () => {
    const onlyFrame = { salutation: null, opening: 'Claro, te explico.', factIds: null, closing: null,
      variantChoices: null, catalogAnswer: null }
    const { result, compositions, interpretations } = await compose(initial, comparisonBody, comparison(null), onlyFrame)
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'accepted', 'retain original frame validation')
    assert.equal(result.interpretation.replyValidation?.secondCall.reason, null)
    assert.equal(compositions, 1)
    assert.equal(interpretations, 1)
    assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.copyReason, 'invalid_response')
    assert.notEqual(result.interpretation.copyMode, 'ai')
    assert.ok(!result.reply.includes(onlyFrame.opening), 'the frame cannot masquerade as an explanatory body')
    assert.ok(!result.reply.includes(generalExplanation))
  })
  await check('an invalid second body receives no partial rescue and no third call', async () => {
    const unsafe = comparisonDraft()
    unsafe.catalogAnswer.blocks[1]!.sources[0]!.quote = 'Una descripción inexistente'
    const { result, compositions, interpretations } = await compose(initial, comparisonBody, comparison(null), unsafe)
    assert.equal(compositions, 1)
    assert.equal(interpretations, 1)
    assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyValidation?.secondCall.reason, 'unverified_value')
    assert.ok(!result.reply.includes(generalExplanation), 'an invalid composite body is discarded entirely')
    assert.ok(!result.reply.includes('Una descripción inexistente'))
  })
  await check('unknown catalog identities cannot enable second explanatory composition', async () => {
    const value = comparison(null)
    value.turnPlan.operations[0]!.target.serviceIds = ['foreign-service']
    const { result, compositions } = await compose(initial, comparisonBody, value, comparisonDraft())
    assert.equal(result.interpretation.reason, 'invalid_output')
    assert.equal(compositions, 0)
    assert.ok(!result.reply.includes(generalExplanation))
  })
  await check('completed comparison focus preserves multiple referents without asking for a choice', () => {
    const value = { ...focusState().informationFocus!, aspect: 'comparison', awaitingChoice: false,
      options: [catalog[0]!, catalog[2]!].map(service => ({ id: service.id, label: service.name })) }
    const parsed = parseInformationFocus(value, context.businessId)
    assert.equal(parsed.serviceId, null)
    assert.equal(parsed.awaitingChoice, false)
    assert.deepEqual(parsed.options, value.options)
  })
  await check('non-choice comparison focus retains singleton, aspect, candidate, business and shape protections', () => {
    const value = { ...focusState().informationFocus!, aspect: 'comparison', awaitingChoice: false,
      options: [catalog[0]!, catalog[2]!].map(service => ({ id: service.id, label: service.name })) }
    for (const invalid of [
      { ...value, options: [] }, { ...value, options: value.options.slice(0, 1) },
      ...['overview', 'description', 'price'].map(aspect => ({ ...value, aspect })),
      { ...value, candidateId: 'straight' }, { ...value, businessId: 'foreign-business' },
      { ...value, options: [value.options[0], value.options[0]] },
      { ...value, options: Array.from({ length: 11 }, (_, i) => ({ id: 'service-' + i, label: 'Service ' + i })) },
      { ...value, serviceId: 'foreign-service' }, { ...value, unexpected: true }
    ]) assert.throws(() => parseInformationFocus(invalid, context.businessId), /invalid information focus/)
    const single = { ...value, aspect: 'description', serviceId: 'straight', options: [value.options[0]] }
    assert.equal(parseInformationFocus(single, context.businessId).serviceId, 'straight')
  })
  await check('model-owned comparison explains three related referents without literal names for all', async () => {
    const message = 'queria saber la diferencia entre shock de keratina y alisado porque no se cual hacerme'
    const ids = catalog.map(service => service.id)
    const reply = comparisonDraft()
    reply.catalogAnswer.blocks[1]!.text = catalog.map(service => service.description!).join(' ')
    reply.catalogAnswer.blocks[1]!.sources = catalog.map(service => ({ serviceId: service.id, field: 'description', quote: service.description! }))
    const value = comparison(reply)
    value.turnPlan.operations[0]!.evidence = message
    value.turnPlan.operations[0]!.target.serviceIds = ids
    value.communicativeActs.acts[0]!.evidence = message
    const first = await compose(initial, message, value, null)
    assert.equal(first.result.interpretation.replyRoute, 'first_call')
    assert.equal(first.compositions, 0)
    assert.ok(first.result.reply.includes(generalExplanation))
    for (const service of catalog) assert.ok(first.result.reply.includes(service.description!))
    assert.doesNotMatch(first.result.reply, /De cuál de estos|Cuál de estas|Qué servicio querés elegir/)
    assert.equal(first.result.choicePresentation, undefined)
    assert.deepEqual(first.result.state.informationFocus?.options.map(option => option.id), ids)
    const repeatMessage = 'quiero saber la diferencia entre shock de keratina y alisado'
    value.turnPlan.operations[0]!.evidence = repeatMessage
    value.communicativeActs.acts[0]!.evidence = repeatMessage
    const repeated = await compose(first.result.state, repeatMessage, value, null)
    assert.ok(repeated.result.reply.includes(generalExplanation))
    assert.equal(repeated.result.interpretation.replyRoute, 'first_call')
    assert.equal(repeated.result.choicePresentation, undefined)
  })
  await check('semantic comparative scope preserves current evidence, confidence, identity and ownership boundaries', () => {
    const message = 'quiero saber la diferencia entre shock de keratina y alisado'
    const scope = (state: DialogueState, evidence = message, confidence = .98, ids = catalog.map(item => item.id), kind = 'inquiry') => {
      const plan = parseTurnPlan({ version: 1, operations: [{ kind: 'information', evidence, confidence,
        target: { kind: 'service', actions: [], serviceIds: ids, aspect: 'comparison' } }] }, message, catalog.map(item => item.id))
      const acts = parseCommunicativeActs({ version: 1, acts: [{ kind, field: 'service', evidence: message,
        confidence, mention: null, operationIndexes: [0] }] }, message, plan.operations.length, plan)
      return deriveCatalogInquiry(plan, acts, message, state, catalog)
    }
    assert.equal(scope(initial, message, .5).length, 0)
    assert.equal(scope(initial, message, .98, catalog.map(item => item.id), 'answer').length, 0)
    assert.throws(() => scope(initial, 'otra consulta'), /evidence/)
    assert.throws(() => scope(initial, message, .98, ['foreign']), /invalid turn plan: information target/)
    const stale = focusState()
    stale.informationFocus!.options[1]!.label = 'Nombre histórico'
    assert.equal(scope(stale).length, 0)
  })
  await check('three current comparison candidates support an actual combined mention without equating the technique', async () => {
    const message = 'quiero saber la diferencia entre shock de keratina y alisado'
    const reply = comparisonDraft()
    reply.catalogAnswer.blocks[1]!.text = catalog.map(service => service.description!).join(' ')
    reply.catalogAnswer.blocks[1]!.sources = catalog.map(service => ({ serviceId: service.id, field: 'description', quote: service.description! }))
    const value = comparison(reply)
    value.turnPlan.operations[0]!.evidence = message
    value.turnPlan.operations[0]!.target.serviceIds = catalog.map(service => service.id)
    value.communicativeActs.acts[0]!.evidence = message
    value.communicativeActs.acts[0]!.mention = 'shock de keratina y alisado' as any
    const positive = await compose(initial, message, value, null)
    assert.equal(positive.result.interpretation.replyRoute, 'first_call')
    assert.ok(positive.result.reply.includes(generalExplanation))
    assert.doesNotMatch(positive.result.reply, /(?:local|negocio).*ofrece.*shock/i)
    for (const mention of ['otro tratamiento', 'shock de keratina']) {
      value.communicativeActs.acts[0]!.mention = mention as any
      const rejected = await compose(initial, message, value, null)
      assert.ok(!rejected.result.reply.includes(generalExplanation), 'foreign or partial mention does not own the combined comparison')
    }
  })
  const withKeratinVariants = (): DialogueService[] => catalog.map(service => service.id !== 'keratin' ? service : ({
    ...service, bookingPolicy: {
      id: service.id, name: service.name, attentionMode: 'GUIDED_ESTIMATE', price: service.price,
      priceMode: 'STARTING_AT', estimateAllowsBooking: true, estimateQuestion: '¿Qué largo tiene tu cabello?',
      estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false,
      estimateOptions: [
        { id: 'shoulders', label: 'Hasta los hombros', priceMin: 30000, priceMax: 40000, note: null },
        { id: 'below', label: 'Debajo de los hombros', priceMin: 40000, priceMax: 60000, note: null }
      ],
      validationEnabled: false, validationMessage: null, validationQuestion: null
    }
  }))
  await check('Keratina button after comparison menu returns description and configured variants', async () => {
    const before = focusState()
    before.informationFocus!.aspect = 'comparison'
    const { port, counts } = makePort(withKeratinVariants())
    const result = await respondConversationChoice(context, before, { kind: 'service', serviceId: 'keratin' }, port)
    assert.ok(result.reply.includes(catalog[2]!.description!), 'service comparison must not become a length comparison')
    assert.match(result.reply, /Hasta los hombros/)
    assert.match(result.reply, /Debajo de los hombros/)
    assert.equal(result.state.informationFocus?.aspect, 'overview')
    assert.equal(result.state.informationFocus?.serviceId, 'keratin')
    assert.deepEqual(selectionBasket(result.state), selectionBasket(before))
    assert.equal(counts().agendaCalls, 0)
    assert.equal(result.bookingCommand, undefined)
    assert.equal(result.proposal, null)
  })
  await check('single model-owned comparison followup remains explanatory with configured variants', async () => {
    const before = focusState()
    before.informationFocus!.aspect = 'comparison'
    const message = 'Keratina'
    const value = comparison({ salutation: null, opening: null, factIds: null, closing: null, variantChoices: null,
      catalogAnswer: { blocks: [{ kind: 'published', text: catalog[2]!.description!, sources: [
        { serviceId: 'keratin', field: 'description', quote: catalog[2]!.description! }
      ] }] } })
    value.turnPlan.operations[0]!.evidence = message
    value.turnPlan.operations[0]!.target.serviceIds = ['keratin']
    value.communicativeActs.acts[0] = { kind: 'answer', field: 'service', evidence: message, confidence: .98, mention: null, operationIndexes: [0] }
    const next = await compose(before, message, value, null, withKeratinVariants())
    assert.ok(next.result.reply.includes(catalog[2]!.description!))
    assert.equal(next.result.interpretation.replyRoute, 'first_call')
    assert.equal(next.compositions, 0)
    assert.equal(next.result.choicePresentation, undefined)
  })
  await check('interpretation guidance separates explanatory comparison from candidate search and readonly followup', () => {
    assert.match(TURN_PLAN_INTERPRETATION_GUIDE, /seguimiento informativo[\s\S]*answer\/service/)
    assert.match(TURN_PLAN_INTERPRETATION_GUIDE, /Una consulta comparativa o explicativa[\s\S]*búsqueda de candidatos/)
  })
  console.log(JSON.stringify({ passed, failed: failures.length, failures }))
  if (failures.length) process.exitCode = 1
} finally {
  globalThis.fetch = original.fetch
  http.request = original.request
  https.request = original.httpsRequest
  http.get = original.get
  https.get = original.httpsGet
}
