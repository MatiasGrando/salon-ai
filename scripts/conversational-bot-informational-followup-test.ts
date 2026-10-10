import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, respond, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { deriveCatalogInquiry } from '../src/conversational-bot/catalog-information-answer.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
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
  console.log(JSON.stringify({ passed, failed: failures.length, failures }))
  if (failures.length) process.exitCode = 1
} finally {
  globalThis.fetch = original.fetch
  http.request = original.request
  https.request = original.httpsRequest
  http.get = original.get
  https.get = original.httpsGet
}
