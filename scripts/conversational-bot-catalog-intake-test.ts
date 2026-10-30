import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { planConversationChoiceView, resolveConversationChoicePayload } from '../src/conversational-bot/runtime-choice-persistence.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { expectedDialogueAnswer } from '../src/conversational-bot/dialogue-context.js'

// Controlled semantic proposals and synthetic public catalog; no model, server or real DB.
const blocked = () => { throw new Error('external transport forbidden in catalog intake') }
globalThis.fetch = blocked; http.request = blocked as typeof http.request; https.request = blocked as typeof https.request
http.get = blocked as typeof http.get; https.get = blocked as typeof https.get
const context = { businessId: 'catalog-intake', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-29T12:00:00Z') }
type Mode = 'ALL_SERVICES' | 'CATEGORIES_FIRST'
type TestService = DialogueService & { categoryId: string; categoryName: string }
const services = (count: number, groups = 2): TestService[] => Array.from({ length: count }, (_, index) => ({
  id: 's' + index, name: 'Servicio ' + index, categoryId: 'c' + index % groups,
  categoryName: 'Categoría ' + index % groups, durationMinutes: 30, price: 1000 + index, requiresConsultation: false
}))
let agenda = 0, passed = 0
const failures: string[] = []
const port = (catalog = services(6), displayMode: Mode = 'ALL_SERVICES'): DialoguePort => ({
  catalog: async () => catalog,
  catalogNavigation: async () => ({ businessId: context.businessId, displayMode,
    categories: [...new Map(catalog.map(service => [service.categoryId, { id: service.categoryId, name: service.categoryName }])).values()] }),
  availability: async () => { agenda++; throw new Error('catalog browsing cannot query agenda') }
} as DialoguePort)
const start = (catalog = services(6), mode: Mode = 'ALL_SERVICES', state = initialDialogueState(context.businessId)) =>
  respond(context, state, 'Quiero un turno', port(catalog, mode), { intent: 'booking', serviceId: null, candidateIds: [], correction: false })
const real = (result: Awaited<ReturnType<typeof start>>, kind: string) => result.choicePresentation?.choices.filter(choice => choice.operation.kind === kind) ?? []
async function check(name: string, run: () => Promise<void> | void) {
  try { await run(); passed++; console.log('PASS catalog intake ' + name) }
  catch (error) { failures.push(name); console.error('RED catalog intake ' + name + ': ' + String(error)) }
}
for (const count of [6, 9]) await check('OFF lists real services directly at ' + count, async () => {
  const result = await start(services(count))
  assert.equal(result.choicePresentation?.kind, 'service'); assert.equal(real(result, 'service').length, count)
  assert.equal(result.proposal, null); assert.deepEqual(selectionBasket(result.state), selectionBasket(initialDialogueState(context.businessId)))
})
for (const count of [6, 10]) await check('ON always lists real categories at ' + count, async () => {
  const result = await start(services(count), 'CATEGORIES_FIRST')
  assert.equal(result.choicePresentation?.kind, 'category'); assert.equal(real(result, 'category').length, 2)
  assert.equal(real(result, 'service').length, 0); assert.equal(result.state.serviceId, null)
})
await check('OFF switches to categories at ten services', async () => {
  const result = await start(services(10))
  assert.equal(result.choicePresentation?.kind, 'category'); assert.equal(real(result, 'category').length, 2)
})
await check('explicit service bypasses catalog navigation for either mode', async () => {
  for (const mode of ['ALL_SERVICES', 'CATEGORIES_FIRST'] as const) {
    const result = await respond(context, initialDialogueState(context.businessId), 'Quiero Servicio 0', port(services(10), mode),
      { intent: 'booking', serviceId: 's0', candidateIds: [], correction: false })
    assert.equal(result.state.serviceId, 's0'); assert.equal(real(result, 'category').length, 0)
    assert.notEqual(result.state.pending, 'service')
  }
})
await check('native category browses only current members, then service is acquired once', async () => {
  const catalog = services(6), first = await start(catalog, 'CATEGORIES_FIRST')
  const category = real(first, 'category')[0]; assert.ok(category)
  const before = agenda
  const members = await respondConversationChoice(context, first.state, category.operation, port(catalog, 'CATEGORIES_FIRST'))
  assert.deepEqual(real(members, 'service').map(choice => choice.operation.kind === 'service' && choice.operation.serviceId), ['s0', 's2', 's4'])
  assert.deepEqual(selectionBasket(members.state), selectionBasket(first.state)); assert.equal(agenda, before)
  const chosen = await respondConversationChoice(context, members.state, real(members, 'service')[0]!.operation, port(catalog, 'CATEGORIES_FIRST'))
  assert.equal(chosen.state.serviceId, 's0'); assert.notEqual(chosen.state.pending, 'service')
})
await check('browsing preserves independent customer, date and professional', async () => {
  const state = initialDialogueState(context.businessId)
  state.customerName = 'Matías'; state.date = '2026-10-30'; state.professional = { kind: 'any' }
  const result = await start(services(6), 'CATEGORIES_FIRST', state)
  const category = real(result, 'category')[0]; assert.ok(category)
  const next = await respondConversationChoice(context, result.state, category.operation, port(services(6), 'CATEGORIES_FIRST'))
  for (const key of ['customerName', 'date', 'professional'] as const) assert.deepEqual(next.state[key], state[key])
  assert.equal(next.state.serviceId, null); assert.equal(next.proposal, null)
})
for (const changed of ['removed', 'renamed', 'foreign', 'mode'] as const) await check('category choice rejects changed current scope: ' + changed, async () => {
  const catalog = services(6), result = await start(catalog, 'CATEGORIES_FIRST')
  const category = real(result, 'category')[0]; assert.ok(category)
  const nextCatalog = changed === 'removed' ? catalog.filter(service => service.categoryId !== 'c0')
    : changed === 'renamed' ? catalog.map(service => service.categoryId === 'c0' ? { ...service, categoryName: 'Nuevo nombre' } : service) : catalog
  const current = port(nextCatalog, changed === 'mode' ? 'ALL_SERVICES' : 'CATEGORIES_FIRST')
  if (changed === 'foreign') (current as any).catalogNavigation = async () => ({ businessId: 'foreign', displayMode: 'CATEGORIES_FIRST', categories: [{ id: 'c0', name: 'Categoría 0' }] })
  const snapshot = structuredClone(result.state)
  await assert.rejects(() => respondConversationChoice(context, result.state, category.operation, current))
  assert.deepEqual(result.state, snapshot)
})
await check('more than ten categories remain reachable through native pages', async () => {
  const catalog = services(23, 23), found = new Set<string>()
  let result = await start(catalog, 'CATEGORIES_FIRST')
  for (let page = 0; page < 5; page++) {
    assert.ok(result.choicePresentation); assert.ok(result.choicePresentation.choices.length <= 10)
    for (const choice of real(result, 'category')) found.add((choice.operation as any).categoryId)
    const forward = result.choicePresentation.choices.find(choice => choice.operation.kind === 'page' && choice.label === 'Ver más opciones')
    if (!forward) break
    result = await respondConversationChoice(context, result.state, forward.operation, port(catalog, 'CATEGORIES_FIRST'))
  }
  assert.equal(found.size, 23); assert.equal(result.state.serviceId, null)
})
await check('more than ten category members remain reachable without acquiring a basket', async () => {
  const catalog = services(23, 1), first = await start(catalog, 'CATEGORIES_FIRST'), category = real(first, 'category')[0]
  assert.ok(category)
  let result = await respondConversationChoice(context, first.state, category.operation, port(catalog, 'CATEGORIES_FIRST'))
  const found = new Set<string>()
  for (let page = 0; page < 5; page++) {
    assert.ok(result.choicePresentation); assert.ok(result.choicePresentation.choices.length <= 10)
    for (const choice of real(result, 'service')) if (choice.operation.kind === 'service') found.add(choice.operation.serviceId)
    const forward = result.choicePresentation.choices.find(choice => choice.operation.kind === 'page' && choice.label === 'Ver más opciones')
    if (!forward) break
    result = await respondConversationChoice(context, result.state, forward.operation, port(catalog, 'CATEGORIES_FIRST'))
  }
  assert.equal(found.size, 23); assert.deepEqual(selectionBasket(result.state), selectionBasket(first.state))
})
await check('native category and service reject unpresented off-page choices', async () => {
  const catalog = services(23, 23), categories = await start(catalog, 'CATEGORIES_FIRST')
  await assert.rejects(() => respondConversationChoice(context, categories.state, { kind: 'category', categoryId: 'c22' } as any, port(catalog, 'CATEGORIES_FIRST')))
  const grouped = services(23, 1), root = await start(grouped, 'CATEGORIES_FIRST')
  const members = await respondConversationChoice(context, root.state, real(root, 'category')[0]!.operation, port(grouped, 'CATEGORIES_FIRST'))
  await assert.rejects(() => respondConversationChoice(context, members.state, { kind: 'service', serviceId: 's22' }, port(grouped, 'CATEGORIES_FIRST')))
})
await check('category membership change invalidates old menu even when category remains', async () => {
  const catalog = services(6), first = await start(catalog, 'CATEGORIES_FIRST')
  const moved = catalog.map(service => service.id === 's0' ? { ...service, categoryId: 'c1', categoryName: 'Categoría 1' } : service)
  await assert.rejects(() => respondConversationChoice(context, first.state, real(first, 'category')[0]!.operation, port(moved, 'CATEGORIES_FIRST')))
})
await check('absent category metadata falls back to real paged services, empty catalog has no options', async () => {
  const catalog = services(23).map(({ categoryId: _id, categoryName: _name, ...service }) => service) as TestService[]
  const current = port(catalog, 'CATEGORIES_FIRST')
  ;(current as any).catalogNavigation = async () => ({ businessId: context.businessId, displayMode: 'CATEGORIES_FIRST', categories: [] })
  let result = await respond(context, initialDialogueState(context.businessId), 'Quiero un turno', current, { intent: 'booking', serviceId: null, candidateIds: [], correction: false })
  const found = new Set<string>()
  for (let page = 0; page < 5; page++) {
    assert.equal(result.choicePresentation?.kind, 'service')
    for (const choice of real(result, 'service')) if (choice.operation.kind === 'service') found.add(choice.operation.serviceId)
    const forward = result.choicePresentation?.choices.find(choice => choice.operation.kind === 'page' && choice.label === 'Ver más opciones')
    if (!forward) break
    result = await respondConversationChoice(context, result.state, forward.operation, current)
  }
  assert.equal(found.size, 23)
  const empty = await start([], 'CATEGORIES_FIRST')
  assert.equal(empty.choicePresentation, undefined); assert.equal(empty.state.serviceId, null)
})
await check('category choices use native scoped persistence and one outbound message', async () => {
  const result = await start(services(6), 'CATEGORIES_FIRST'); assert.equal(result.choicePresentation?.kind, 'category')
  const scope = { businessId: context.businessId, conversationKey: 'synthetic-session', policyKey: 'policy', policyGeneration: 1, revision: '2' }
  const question = issueChoiceQuestion(scope, result.state, result.choicePresentation!)
  const plan = planConversationChoiceView({ question, reply: result.reply, transitionId: 'category-intake' })
  assert.equal(plan.outboxRows.length, 1); assert.equal(plan.outboxRows[0]!.item.type, 'interactive')
  const row = plan.choiceRows[0]!, payload = row.payload
  assert.equal(resolveConversationChoicePayload(payload, scope, result.state).operation.kind, 'category')
  assert.throws(() => resolveConversationChoicePayload(payload, { ...scope, revision: '3' }, result.state))
  assert.throws(() => resolveConversationChoicePayload(payload, { ...scope, businessId: 'foreign' }, result.state))
  assert.equal(publicChoiceQuestion(question).choices.length, 2)
})
await check('AI generic booking intent receives native category intake in the same response', async () => {
  const provider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null,
    professionalMention: null, turnPlan: null, firstReply: null }), { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Quiero un turno', port(services(6), 'CATEGORIES_FIRST'), provider)
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.choicePresentation?.kind, 'category')
  assert.equal(result.state.serviceId, null)
})
for (const mode of ['ALL_SERVICES', 'CATEGORIES_FIRST'] as const) await check('AI explicit service bypasses intake in mode ' + mode, async () => {
  const body = 'Quiero Servicio 0', provider = Object.assign(async () => ({ intent: 'booking', serviceId: 's0', serviceEvidence: 'Servicio 0',
    professionalMention: null, turnPlan: null, firstReply: null }), { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), body, port(services(10), mode), provider)
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.state.serviceId, 's0')
  assert.notEqual(result.state.pending, 'service'); assert.equal(real(result, 'category').length, 0)
})
await check('AI resolves free category language against current category pool without acquiring members', async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST'), body = 'Me interesa lo que hay en el primer grupo'
  let input: any
  const provider = Object.assign(async (value: unknown) => {
    input = value
    return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
      turnPlan: { version: 1, operations: [{ kind: 'catalog_navigation', categoryId: 'c0', evidence: body, confidence: 1 }] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'general', evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply: null }
  }, { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, port(services(6), 'CATEGORIES_FIRST'), provider)
  assert.equal(result.interpretation.mode, 'ai')
  assert.deepEqual(input.catalogNavigation.categories.map((category: any) => category.id), ['c0', 'c1'])
  assert.deepEqual(real(result, 'service').map(choice => choice.operation.kind === 'service' && choice.operation.serviceId), ['s0', 's2', 's4'])
  assert.deepEqual(selectionBasket(result.state), selectionBasket(first.state))
})
for (const kind of ['request', 'inquiry', 'answer']) for (const field of ['general', 'service']) await check('AI category navigation accepts contextual ' + kind + '/' + field, async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST'), body = 'La segunda categoría'
  const provider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'catalog_navigation', categoryId: 'c1', evidence: body, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind, field, evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, port(services(6), 'CATEGORIES_FIRST'), provider)
  assert.equal(result.interpretation.mode, 'ai'); assert.deepEqual(real(result, 'service').map(choice => choice.operation.kind === 'service' && choice.operation.serviceId), ['s1', 's3', 's5'])
  assert.equal(result.state.serviceId, null)
})
for (const categoryId of ['c22', 'foreign']) await check('AI cannot open category outside the currently presented page: ' + categoryId, async () => {
  const catalog = services(23, 23), first = await start(catalog, 'CATEGORIES_FIRST'), body = 'La otra categoría'
  const provider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'catalog_navigation', categoryId, evidence: body, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind: 'answer', field: 'service', evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, port(catalog, 'CATEGORIES_FIRST'), provider)
  assert.equal(result.state.serviceId, null); assert.equal(real(result, 'service').length, 0)
  assert.equal(result.choicePresentation?.kind, 'category')
})
for (const kind of ['request', 'inquiry', 'answer']) await check('identity-enabled category browse preserves AI framing for ' + kind, async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST'), body = 'La segunda categoría'
  const current: DialoguePort = { ...port(services(6), 'CATEGORIES_FIRST'), identity: async () => ({ businessId: context.businessId,
    assistantName: 'Ada', businessName: 'Local', treatment: 'vos' }) }
  const firstReply = { salutation: null, opening: 'Te muestro las opciones.', closing: null, factIds: null, variantChoices: null }
  const provider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'catalog_navigation', categoryId: 'c1', evidence: body, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind, field: 'service', evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply }),
    { respond: async () => firstReply }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, current, provider)
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.interpretation.copyMode, 'ai')
  assert.ok(result.reply.includes('Te muestro las opciones.')); assert.equal(result.state.serviceId, null)
  assert.equal(result.choicePresentation?.kind, 'service')
})
for (const body of ['No quiero la primera categoría', 'No sé cuál de las dos']) await check('negative or ambiguous AI answer never chooses a category: ' + body, async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST')
  const provider = Object.assign(async () => ({ intent: 'other', serviceId: null, serviceEvidence: null,
    professionalMention: null, turnPlan: { version: 1, operations: [] },
    communicativeActs: { version: 1, acts: [{ kind: 'uncertain', field: 'general', evidence: body, confidence: 1, mention: null, operationIndexes: [] }] }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, port(services(6), 'CATEGORIES_FIRST'), provider)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(first.state))
  assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
  assert.equal(result.choicePresentation?.kind, 'category')
})
for (const changed of ['removed', 'renamed'] as const) await check('service choice from category rejects changed members: ' + changed, async () => {
  const catalog = services(6), first = await start(catalog, 'CATEGORIES_FIRST'), category = real(first, 'category')[0]
  assert.ok(category)
  const members = await respondConversationChoice(context, first.state, category.operation, port(catalog, 'CATEGORIES_FIRST'))
  const selected = real(members, 'service')[0]; assert.ok(selected)
  const current = changed === 'removed' ? catalog.filter(service => service.id !== 's0')
    : catalog.map(service => service.id === 's0' ? { ...service, name: 'Otro servicio' } : service)
  await assert.rejects(() => respondConversationChoice(context, members.state, selected.operation, port(current, 'CATEGORIES_FIRST')))
})
for (const mode of ['ALL_SERVICES', 'CATEGORIES_FIRST'] as const) for (const aspect of ['price', 'overview', 'comparison']) await check('catalog menu to ' + aspect + ' inquiry and booking continuation: ' + mode, async () => {
  const catalog = services(6), first = await start(catalog, mode), body = 'Quería saber sobre Servicio 0'
  const provider = Object.assign(async () => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'information', evidence: body, confidence: 1,
      target: { kind: 'service', serviceIds: aspect === 'comparison' ? ['s0', 's1'] : ['s0'], actions: [], aspect } }] },
    communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const information = await respondWithAiInterpreter(context, first.state, body, port(catalog, mode), provider)
  assert.equal(information.interpretation.mode, 'ai'); assert.equal(information.state.catalogNavigation, undefined)
  assert.deepEqual(selectionBasket(information.state), selectionBasket(first.state)); assert.equal(expectedDialogueAnswer(information.state).role, 'service')
  if (aspect === 'comparison') return
  assert.equal(information.choicePresentation?.choices[0]?.label, 'Reservar')
  const native = await respondConversationChoice(context, information.state, information.choicePresentation!.choices[0]!.operation, port(catalog, mode))
  assert.equal(native.state.serviceId, 's0'); assert.notEqual(native.state.pending, 'service')
  const acceptance = 'Sí dale'
  const acceptProvider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'service_reference', action: 'select', serviceId: 's0', evidence: acceptance, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind: 'answer', field: 'service', evidence: acceptance, confidence: 1, mention: null, operationIndexes: [0] }] }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const text = await respondWithAiInterpreter(context, information.state, acceptance, port(catalog, mode), acceptProvider)
  assert.equal(text.state.serviceId, native.state.serviceId); assert.equal(text.state.pending, native.state.pending)
})
for (const variant of ['navigation-first', 'navigation-last', 'low-time-confidence']) await check('category browse retains independent fields: ' + variant, async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST'), body = 'La segunda categoría, soy Matías y mañana a las 16hs'
  const operations = [
    { kind: 'catalog_navigation', categoryId: 'c1', evidence: 'La segunda categoría', confidence: 1 },
    { kind: 'name', value: 'Matías', evidence: 'soy Matías', confidence: 1 },
    { kind: 'date', expression: 'mañana', value: '2026-10-30', evidence: 'mañana', confidence: 1 },
    { kind: 'time', value: '16:00', evidence: '16hs', confidence: variant === 'low-time-confidence' ? .4 : 1 }
  ]
  if (variant === 'navigation-last') operations.push(operations.shift()!)
  const provider = Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations }, communicativeActs: { version: 1, acts: operations.map((operation, index) => ({
      kind: operation.kind === 'catalog_navigation' ? 'answer' : 'request', field: operation.kind === 'catalog_navigation' ? 'service' : operation.kind,
      evidence: operation.evidence, confidence: 1, mention: null, operationIndexes: [index] })) }, firstReply: null }),
    { respond: async () => null }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, first.state, body, port(services(6), 'CATEGORIES_FIRST'), provider)
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.state.customerName, 'Matías')
  assert.equal(result.state.date, '2026-10-30'); assert.equal(result.state.requestedTime, variant === 'low-time-confidence' ? null : '16:00')
  assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
  assert.deepEqual(real(result, 'service').map(choice => choice.operation.kind === 'service' && choice.operation.serviceId), ['s1', 's3', 's5'])
})
await check('category browsing does not authorize an unsupported action companion', async () => {
  const first = await start(services(6), 'CATEGORIES_FIRST'), before = structuredClone(first.state), body = 'La segunda categoría y quiero hablar con alguien'
  await assert.rejects(() => respond(context, first.state, body, port(services(6), 'CATEGORIES_FIRST'), { intent: 'booking', serviceId: null,
    candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
      { kind: 'catalog_navigation', categoryId: 'c1', evidence: 'La segunda categoría', confidence: 1 },
      { kind: 'unsupported_action', action: 'HUMAN_HANDOFF', evidence: 'quiero hablar con alguien', confidence: 1 }
    ] } }), /invalid catalog navigation proposal/)
  assert.deepEqual(first.state, before)
})
console.log(`catalog intake: ${passed} PASS, ${failures.length} RED; agenda calls ${agenda}`)
if (failures.length) process.exitCode = 1
