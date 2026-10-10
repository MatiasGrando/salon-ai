import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider, type AiResponseInput } from '../src/conversational-bot/ai-interpreter.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { deriveCatalogInquiry, catalogInformation } from '../src/conversational-bot/catalog-information-answer.js'
import { replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'

// Literal synthetic outputs captured in C6. No model, database or external transport.
const original = { fetch: globalThis.fetch, request: http.request, httpsRequest: https.request, get: http.get, httpsGet: https.get }
const forbidden = () => { throw new Error('external transport forbidden in explanatory plan regression') }
globalThis.fetch = forbidden; http.request = forbidden as typeof http.request; https.request = forbidden as typeof https.request
http.get = forbidden as typeof http.get; https.get = forbidden as typeof https.get
const context = { businessId: 'explanatory-plan', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T15:00:00Z') }
const initial = initialDialogueState(context.businessId)
const description = 'Servicio orientado a reducir ondas. Requiere evaluación previa del cabello y no garantiza un resultado idéntico en todos los casos.'
const services: DialogueService[] = [
  { id: 'synthetic-straight', name: 'Alisado sin formol', description, price: 45000, durationMinutes: 90, requiresConsultation: false },
  { id: 'synthetic-keratin', name: 'Keratina', description: null, price: 32000, durationMinutes: 60, requiresConsultation: false }
]
const mixedMessage = '¿Qué diferencia hay entre el alisado y el shock de keratina? Explicame en general y qué ofrecen ustedes.'
const zeroMessage = 'Explicame en general qué es una cauterización capilar y en qué se diferencia de un shock de keratina'
const mixedGeneral = 'En general, el alisado busca reducir ondas o alisar el cabello; un shock de keratina suele presentarse como un tratamiento de acondicionamiento o control del frizz, pero sus efectos y composición varían según el producto y el salón.'
const zeroGeneral = 'La cauterización capilar suele referirse a tratamientos orientados a mejorar temporalmente la apariencia y el tacto del cabello, ayudando a suavizarlo y controlar el frizz. El shock de keratina suele describir un tratamiento de alisado o reducción del frizz basado en productos con keratina. Los nombres y las fórmulas varían entre salones y productos, así que no implican una composición o resultado uniforme.'
const originalPublished = 'El catálogo describe el alisado sin formol como un servicio orientado a reducir ondas; requiere evaluación previa y no garantiza un resultado idéntico para todos. También lista Keratina, pero no incluye una descripción que permita confirmar que ofrezcan específicamente un “shock de keratina”.'
// This safe variant isolates integration from the independently recorded caveat rejection.
const safePublished = 'El catálogo describe el alisado sin formol como un servicio orientado a reducir ondas y que requiere evaluación previa del cabello.'
const source = { serviceId: 'synthetic-straight', field: 'description', quote: description }
const base = { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null }
const draft = (general: string, published?: string) => ({ catalogAnswer: { blocks: [
  { kind: 'general', text: general, sources: [] },
  ...(published ? [{ kind: 'published', text: published, sources: [structuredClone(source)] }] : [])
] }, salutation: null, opening: null as string | null, factIds: null, closing: null, variantChoices: null })
const mixed = () => ({ ...base,
  turnPlan: { version: 1, operations: [
    { kind: 'information', evidence: mixedMessage, confidence: .99,
      target: { kind: 'service', actions: [], serviceIds: ['synthetic-straight', 'synthetic-keratin'], aspect: 'comparison' } },
    { kind: 'service_request', evidence: 'shock de keratina', confidence: .96, purpose: 'inquiry', disposition: 'unverified_variant',
      serviceIds: ['synthetic-keratin'], correction: false, basis: 'related_category', sourceQuote: null,
      subject: 'shock de keratina', aspect: 'description', continuation: false }
  ] },
  communicativeActs: { version: 1, acts: [
    { kind: 'inquiry', field: 'service', evidence: mixedMessage, confidence: .99, mention: null as string | null, operationIndexes: [0] },
    { kind: 'inquiry', field: 'service', evidence: 'shock de keratina', confidence: .96, mention: 'shock de keratina', operationIndexes: [1] }
  ] }, firstReply: draft(mixedGeneral, safePublished) })
const zero = () => ({ ...base,
  turnPlan: { version: 1, operations: [{ kind: 'information', evidence: zeroMessage, confidence: .98,
    target: { kind: 'service', actions: [], serviceIds: [] as string[], aspect: 'comparison' } }] },
  communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: zeroMessage, confidence: .98,
    mention: 'cauterización capilar y shock de keratina', operationIndexes: [0] }] },
  firstReply: { ...draft(zeroGeneral), opening: 'Puedo orientarte sobre la diferencia general entre ambos procedimientos.' } })
const scope = (value: ReturnType<typeof mixed> | ReturnType<typeof zero>, message: string, catalog = services) => {
  const plan = parseTurnPlan(value.turnPlan, message, catalog.map(service => service.id))
  const acts = parseCommunicativeActs(value.communicativeActs, message, plan.operations.length, plan)
  return deriveCatalogInquiry(plan, acts, message, initial, catalog)
}
const replay = async (message: string, value: unknown, catalog: DialogueService[], secondDraft?: unknown) => {
  let calls = 0, compositions = 0, agenda = 0
  const compositionInputs: AiResponseInput[] = []
  const port: DialoguePort = { catalog: async () => catalog,
    identity: async () => ({ businessId: context.businessId, assistantName: 'Alba', businessName: 'Demo', treatment: 'vos', greetingEmoji: '😊' }),
    availability: async () => { agenda++; throw new Error('explanatory reads cannot query appointments') },
    availabilityBasket: async () => { agenda++; throw new Error('explanatory reads cannot coordinate appointments') } }
  const provider: AiInterpretationProvider = Object.assign(async () => { calls++; return structuredClone(value) },
    { respond: async (input: AiResponseInput) => {
      compositions++; compositionInputs.push(structuredClone(input))
      if (secondDraft === undefined) throw new Error('valid first reply needs no second composition')
      return structuredClone(secondDraft)
    } })
  const result = await respondWithAiInterpreter(context, initial, message, port, provider)
  assert.equal(agenda, 0); assert.deepEqual(selectionBasket(result.state), selectionBasket(initial))
  for (const key of ['serviceId', 'date', 'professional', 'customerName', 'slot', 'pending', 'bookingReservation', 'sandboxReservation'] as const)
    assert.deepEqual(result.state[key], initial[key], 'read preserves ' + key)
  if (result.state.referral) assert.equal(result.state.referral.status, 'offered', 'an offered clarification is never accepted handoff consent')
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  return { result, calls, compositions, compositionInputs }
}
const failures: string[] = []; let passed = 0
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run(); passed++; console.log('PASS explanatory plan ' + name) }
  catch (error) { failures.push(name); console.error('RED explanatory plan ' + name + ': ' + String(error)) }
}
try {
  await check('captured zero-ID semantic mention grants no identity but permits current descriptive inquiry', () => {
    const value = zero(); const before = structuredClone(value)
    assert.equal(scope(value, zeroMessage, []).length, 1)
    assert.deepEqual(value, before, 'raw semantic mention remains available for diagnostics, never rewritten')
  })
  await check('captured zero-ID explanation is delivered in one interpretation without effects', async () => {
    const { result, calls, compositions } = await replay(zeroMessage, zero(), [])
    assert.ok(result.reply.includes(zeroGeneral)); assert.match(result.reply, /Información general \(orientativa\)/)
    assert.doesNotMatch(result.reply, /¿Qué servicio necesitás|¿Cuál.*(?:servicio|opcion)/i)
    assert.equal(result.interpretation.reason, null); assert.equal(result.interpretation.replyRoute, 'first_call')
    assert.equal(result.interpretation.copyMode, 'ai'); assert.equal(calls, 1); assert.equal(compositions, 0)
    assert.equal(result.state.serviceRequest, undefined)
  })
  await check('mixed captured reads retain the original informative operation index', () => {
    const value = mixed(); assert.equal(scope(value, mixedMessage).length, 1)
    value.turnPlan.operations.reverse()
    value.communicativeActs.acts[0]!.operationIndexes = [1]; value.communicativeActs.acts[1]!.operationIndexes = [0]
    const scopes = scope(value, mixedMessage)
    assert.equal(scopes.length, 1); assert.equal(scopes[0]!.operation, JSON.stringify(value.turnPlan.operations[1]))
  })
  await check('mixed first-call body preserves the independently owned unknown-technique disclaimer', async () => {
    const { result, calls, compositions } = await replay(mixedMessage, mixed(), services)
    assert.ok(result.reply.includes(mixedGeneral)); assert.ok(result.reply.includes(safePublished))
    assert.match(result.reply, /No tengo información confirmada sobre «shock de keratina»/)
    assert.match(result.reply, /Keratina[\s\S]*No tengo una descripción publicada/)
    assert.doesNotMatch(result.reply, /¿De cuál de estos servicios querés información/)
    assert.equal(result.state.serviceRequest?.purpose, 'inquiry'); assert.equal(result.state.serviceRequest?.subject, 'shock de keratina')
    assert.equal(result.state.serviceRequest?.disposition, 'unverified_variant')
    assert.equal(result.catalogInformation?.generalKnowledgeAllowed, true); assert.equal(result.replyFacts?.[0]?.id, 'catalog')
    assert.ok(result.replyFacts?.some(fact => fact.id === 'procedure'))
    for (const fact of result.replyFacts?.filter(fact => fact.id !== 'catalog') ?? [])
      assert.equal(result.reply.split(fact.text).length - 1, 1, 'preserve every technical fact once')
    assert.equal(result.interpretation.replyRoute, 'first_call'); assert.equal(result.interpretation.copyMode, 'ai')
    assert.equal(calls, 1); assert.equal(compositions, 0)
  })
  await check('zero-ID projection never rescues absent evidence or malformed ownership', () => {
    for (const mutate of [
      (value: ReturnType<typeof zero>) => { value.communicativeActs.acts[0]!.evidence = 'Una consulta inexistente' },
      (value: ReturnType<typeof zero>) => { value.turnPlan.operations[0]!.evidence = 'Una consulta inexistente' },
      (value: ReturnType<typeof zero>) => { value.communicativeActs.acts[0]!.operationIndexes = [1] }
    ]) {
      const value = zero(); mutate(value); assert.throws(() => scope(value, zeroMessage, []))
    }
    for (const mutate of [
      (value: ReturnType<typeof zero>) => { value.communicativeActs.acts[0]!.confidence = .5 },
      (value: ReturnType<typeof zero>) => { value.turnPlan.operations[0]!.confidence = .5 },
      (value: ReturnType<typeof zero>) => { value.communicativeActs.acts[0]!.kind = 'request' },
      (value: ReturnType<typeof zero>) => { value.communicativeActs.acts[0]!.field = 'professional' }
    ]) {
      const value = zero(); mutate(value)
      let scopes: ReturnType<typeof scope> | undefined
      try { scopes = scope(value, zeroMessage, []) }
      catch (error) { assert.match(String(error), /invalid communicative acts|turn plan/i) }
      if (scopes) assert.equal(scopes.length, 0)
    }
  })
  await check('known identities and booking companions retain strict literal mention authority', () => {
    const known = zero(); known.turnPlan.operations[0]!.target.serviceIds = ['synthetic-keratin']
    assert.throws(() => scope(known, zeroMessage))
    const value = mixed(); value.turnPlan.operations[1]!.purpose = 'booking'; value.communicativeActs.acts[1]!.kind = 'request'
    assert.equal(scope(value, mixedMessage).length, 0, 'booking plan cannot grant explanatory-only copy authority')
  })
  await check('invalid companion owners cannot be hidden by a valid informative operation', () => {
    for (const mutate of [
      (value: ReturnType<typeof mixed>) => { value.communicativeActs.acts[1]!.kind = 'request' },
      (value: ReturnType<typeof mixed>) => { value.communicativeActs.acts[1]!.confidence = .5 },
      (value: ReturnType<typeof mixed>) => { value.communicativeActs.acts[1]!.operationIndexes = [] },
      (value: ReturnType<typeof mixed>) => {
        value.communicativeActs.acts[0]!.operationIndexes = [0, 1]
        value.communicativeActs.acts[1]!.operationIndexes = []
      }
    ]) {
      const value = mixed(); mutate(value); assert.equal(scope(value, mixedMessage).length, 0)
    }
  })
  await check('sources shape fact order and unsafe local claims remain fail-closed', () => {
    const target = { kind: 'service' as const, actions: [] as const, serviceIds: services.map(service => service.id), aspect: 'comparison' as const }
    const catalog = catalogInformation(target, services, true)
    const facts = [{ id: 'catalog', text: 'Información publicada.' }, { id: 'procedure', text: 'Técnica no confirmada.' }, { id: 'next', text: '¿Qué más querés saber?' }]
    const policy = replyContract('information', false, false, facts)
    for (const raw of [
      { ...draft(mixedGeneral, safePublished), factIds: ['catalog', 'next', 'procedure'] },
      { ...draft(mixedGeneral, safePublished), factIds: ['catalog', 'next'] },
      { ...draft(mixedGeneral, safePublished), variantChoices: [{ factId: 'procedure', variantId: 'foreign' }] },
      { ...draft(mixedGeneral, safePublished), extra: true },
      draft('Nuestro tratamiento utiliza keratina brasileña.', safePublished),
      draft('El procedimiento cuesta $999.', safePublished), draft('Ya reservé el turno.', safePublished)
    ]) assert.equal(validateReplyDraft(raw, facts, policy, services.map(service => service.name), catalog).validation.status, 'rejected')
    for (const quote of ['Descripción antigua no vigente', '']) {
      const raw = draft(mixedGeneral, safePublished); raw.catalogAnswer.blocks[1]!.sources[0]!.quote = quote
      assert.equal(validateReplyDraft(raw, facts, policy, [], catalog).validation.status, 'rejected')
    }
    const raw = draft(mixedGeneral, safePublished); raw.catalogAnswer.blocks[1]!.sources[0]!.serviceId = 'foreign'
    assert.equal(validateReplyDraft(raw, facts, policy, [], catalog).validation.status, 'rejected')
  })
  await check('original captured first body can use the existing bounded second composition with current facts', async () => {
    const value = mixed(); value.firstReply = draft(mixedGeneral, originalPublished)
    const { result, calls, compositions, compositionInputs } = await replay(mixedMessage, value, services, draft(mixedGeneral, safePublished))
    assert.equal(calls, 1); assert.equal(compositions, 1); assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyValidation?.firstCall.status, 'rejected')
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'unverified_value')
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'accepted')
    assert.equal(result.interpretation.replyRoute, 'second_call'); assert.equal(result.interpretation.copyMode, 'ai')
    assert.ok(result.reply.includes(mixedGeneral)); assert.ok(result.reply.includes(safePublished))
    assert.ok(!result.reply.includes(originalPublished)); assert.match(result.reply, /No tengo información confirmada sobre «shock de keratina»/)
    assert.deepEqual(compositionInputs[0]!.facts.map(fact => fact.id), ['catalog', 'procedure', 'next'])
    assert.equal(compositionInputs[0]!.catalogInformation?.generalKnowledgeAllowed, true)
    assert.equal(compositionInputs[0]!.intent, 'information')
    assert.equal(result.state.serviceRequest?.purpose, 'inquiry')
  })
  await check('a rejected second explanatory draft stays canonical without partial-body rescue or another call', async () => {
    const value = mixed(); value.firstReply = draft(mixedGeneral, originalPublished)
    const invalidSecond = draft('El procedimiento cuesta $999.', safePublished)
    const { result, calls, compositions } = await replay(mixedMessage, value, services, invalidSecond)
    assert.equal(calls, 1); assert.equal(compositions, 1); assert.equal(result.interpretation.aiCalls, 2)
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'unverified_value')
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'rejected')
    assert.ok(result.reply.includes(description), 'canonical description preserves the actual published caveat')
    assert.match(result.reply, /No tengo información confirmada sobre «shock de keratina»/)
    assert.ok(!result.reply.includes(mixedGeneral)); assert.ok(!result.reply.includes(safePublished))
    assert.doesNotMatch(result.reply, /999/); assert.notEqual(result.interpretation.copyMode, 'ai')
  })
  await check('captured negative caveat remains a separately documented semantic rejection', () => {
    const target = { kind: 'service' as const, actions: [] as const, serviceIds: services.map(service => service.id), aspect: 'comparison' as const }
    const facts = [{ id: 'catalog', text: description }, { id: 'next', text: '¿Qué más querés saber?' }]
    const result = validateReplyDraft(draft(mixedGeneral, originalPublished), facts, replyContract('information', false, false, facts), [], catalogInformation(target, services, true))
    assert.equal(result.validation.status, 'rejected'); assert.equal(result.validation.reason, 'unverified_value')
    assert.equal(result.text, null, 'original captured copy still does not pass this independent guard')
  })
  console.log('explanatory plan: ' + passed + ' PASS / ' + failures.length + ' FAIL (captured synthetic outputs; offline)')
  assert.deepEqual(failures, [], 'C7 explanatory plan integration regressions')
} finally {
  globalThis.fetch = original.fetch; http.request = original.request; https.request = original.httpsRequest
  http.get = original.get; https.get = original.httpsGet
}
