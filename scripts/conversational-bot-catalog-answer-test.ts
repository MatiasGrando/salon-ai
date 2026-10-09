import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'

// Only local provider doubles. Citations prove source provenance, not universal semantic entailment.
const original = { fetch: globalThis.fetch, request: http.request, httpsRequest: https.request, get: http.get, httpsGet: https.get }
const forbidden = () => { throw new Error('external transport forbidden in catalog-answer regression') }
globalThis.fetch = forbidden; http.request = forbidden as typeof http.request; https.request = forbidden as typeof https.request
http.get = forbidden as typeof http.get; https.get = forbidden as typeof https.get
const context = { businessId: 'catalog-answer', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-09T18:00:00Z') }
const catalog: DialogueService[] = [
  { id: 'care', name: 'Tratamiento', description: 'Tratamiento hidratante que aporta suavidad. No cambia la forma natural del pelo.', price: 18000, durationMinutes: 40, requiresConsultation: false },
  { id: 'keratin', name: 'Keratina', description: 'Keratina reduce el frizz y facilita el peinado. El resultado varía según el cabello.', price: 32000, durationMinutes: 60, requiresConsultation: false },
  { id: 'straight', name: 'Alisado sin formol', description: 'Alisado para reducir ondas. Requiere evaluación del cabello antes de confirmar el procedimiento.', price: 45000, durationMinutes: 90, requiresConsultation: true },
  { id: 'cut', name: 'Corte', description: 'Corte con tijera.', price: 12000, durationMinutes: 30, requiresConsultation: false }
]
const base = { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null }
const initial = initialDialogueState(context.businessId)
let agenda = 0
const port: DialoguePort = { catalog: async () => catalog,
  availability: async () => { agenda++; return { professionals: [], slots: [] } },
  availabilityBasket: async () => { agenda++; return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' } } }
type Source = { serviceId: string; field: 'description'; quote: string }
type Block = { text: string; sources: Source[] }
const source = (id: string): Source => ({ serviceId: id, field: 'description', quote: catalog.find(item => item.id === id)!.description! })
const comparison: Block[] = [
  { text: 'Tratamiento apunta a hidratar y dejar el pelo suave, sin cambiar su forma natural.', sources: [source('care')] },
  { text: 'Keratina se orienta a reducir el frizz y hacer más fácil el peinado; el resultado depende del cabello.', sources: [source('keratin')] }
]
const frame = (blocks: Block[] | null) => ({ salutation: null, opening: 'Claro, te explico.', factIds: null, closing: null, variantChoices: null,
  catalogAnswer: blocks === null ? null : { blocks } })
const operation = (body: string, ids: string[], aspect: string) => ({ kind: 'information', evidence: body, confidence: 1,
  target: { kind: 'service', actions: [], serviceIds: ids, aspect } })
const owned = (body: string, ids: string[], aspect: string, blocks: Block[] | null, mention: string | null = null) => ({ ...base,
  turnPlan: { version: 1, operations: [operation(body, ids, aspect)] },
  communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, confidence: 1, mention, operationIndexes: [0] }] },
  firstReply: frame(blocks) })
const checkRead = (result: Awaited<ReturnType<typeof respondWithAiInterpreter>>, before: DialogueState, callsBefore: number) => {
  assert.deepEqual(selectionBasket(result.state), selectionBasket(before), 'catalog explanation cannot acquire or replace a cart member')
  for (const field of ['serviceId', 'date', 'datePreferences', 'professional', 'professionalNameHint', 'requestedTime', 'requestedTimeMode',
    'timePreference', 'slot', 'customerName', 'serviceEstimates', 'serviceRequest', 'referral', 'sandboxReservation', 'bookingReservation', 'pending'] as const)
    assert.deepEqual(result.state[field], before[field], 'catalog read preserves draft/consent: ' + field)
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  assert.equal(agenda, callsBefore, 'catalog facts do not query appointments')
}
const failures: string[] = []; let passed = 0
const check = async (name: string, run: () => Promise<void>) => {
  try { await run(); passed++; console.log('PASS catalog answer ' + name) }
  catch (error) { failures.push(name); console.error('RED catalog answer ' + name + ': ' + String(error)) }
}
try {
  await check('two named services receive a useful paraphrased comparison in the first call', async () => {
    const body = '¿Cuál es la diferencia entre Tratamiento y Keratina?'
    let input: AiInterpretationInput | undefined, calls = 0; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, port, async value => { input = value; calls++; return owned(body, ['care', 'keratin'], 'comparison', comparison) })
    assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1); assert.equal(result.interpretation.replyRoute, 'first_call')
    assert.equal(result.interpretation.mode, 'ai'); assert.equal(input!.services.find(item => item.id === 'care')!.description, catalog[0]!.description)
    assert.equal(input!.services.find(item => item.id === 'keratin')!.description, catalog[1]!.description)
    for (const block of comparison) assert.ok(result.reply.includes(block.text), 'source-specific paraphrase must reach the real reply')
    assert.doesNotMatch(result.reply, /No tengo información confirmada sobre «Tratamiento y Keratina»|De cuál de estos servicios|Qué servicio necesitás/i)
    assert.equal(result.choicePresentation?.choices.some(choice => choice.label.toLowerCase() === 'reservar') ?? false, false, 'comparison does not choose a booking target')
    checkRead(result, initial, beforeAgenda)
  })
  await check('a correctly owned lowercase comparison still reads current facts without optional model copy', async () => {
    const body = 'cual es la diferencia entre tratamiento y keratina'; const beforeAgenda = agenda
    for (const firstReply of [null, frame(null)]) {
      let calls = 0, compositions = 0
      const provider = Object.assign(async () => {
        calls++; return { ...owned(body, ['care', 'keratin'], 'comparison', null), firstReply }
      }, { respond: async () => { compositions++; throw new Error('unchanged catalog cannot require a second model call') } })
      const result = await respondWithAiInterpreter(context, initial, body, port, provider)
      assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1); assert.equal(compositions, 0)
      for (const service of catalog.slice(0, 2)) assert.ok(result.reply.includes(service.description!), 'valid read cannot depend on optional copy')
      assert.doesNotMatch(result.reply, /De cuál de estos servicios|Qué servicio necesitás/i)
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('a reference to a produced fresh informative pool compares it without selecting a booking target', async () => {
    const menuBody = 'Precio de Tratamiento y Keratina'
    const menu = await respondWithAiInterpreter(context, initial, menuBody, port, async () => owned(menuBody, ['care', 'keratin'], 'price', null))
    assert.equal(menu.state.informationFocus?.options.length, 2)
    const body = '¿Qué diferencia hay entre esos dos?'; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, menu.state, body, port, async () => owned(body, ['care', 'keratin'], 'comparison', comparison))
    for (const block of comparison) assert.ok(result.reply.includes(block.text))
    assert.equal(result.interpretation.aiCalls, 1); checkRead(result, menu.state, beforeAgenda)
    assert.equal(result.choicePresentation?.choices.some(choice => choice.label.toLowerCase() === 'reservar') ?? false, false)
    const renamed = catalog.map(service => service.id === 'keratin' ? { ...service, name: 'Nueva prestación' } : service)
    const stale = await respondWithAiInterpreter(context, menu.state, body, { ...port, catalog: async () => renamed }, async () => owned(body, ['care', 'keratin'], 'comparison', comparison))
    for (const block of comparison) assert.ok(!stale.reply.includes(block.text))
    checkRead(stale, menu.state, beforeAgenda)
  })
  await check('general explanation is not a special two-product phrase or a verbatim fact-membership requirement', async () => {
    const body = 'Explicame para qué sirve Keratina y qué límite tiene'
    const blocks = [comparison[1]!]; let calls = 0; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => { calls++; return owned(body, ['keratin'], 'description', blocks, 'Keratina') })
    assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1)
    assert.ok(result.reply.includes(blocks[0]!.text)); assert.doesNotMatch(result.reply, /Qué dato o variante querés precisar/)
    checkRead(result, initial, beforeAgenda)
  })
  await check('another catalog domain uses the same general explanation contract', async () => {
    const services: DialogueService[] = [
      { ...catalog[0]!, id: 'brakes', name: 'Revisión de frenos', description: 'Se inspeccionan pastillas y discos; no incluye cambio de piezas.' },
      { ...catalog[1]!, id: 'alignment', name: 'Alineación', description: 'Se ajusta la geometría de las ruedas; se evalúa el estado previo.' }
    ]
    const body = 'Compará Revisión de frenos y Alineación para entender qué hace cada uno'
    const blocks: Block[] = [
      { text: 'Revisión de frenos revisa pastillas y discos, pero cambiar piezas no está incluido.', sources: [{ serviceId: 'brakes', field: 'description', quote: services[0]!.description! }] },
      { text: 'Alineación ajusta la geometría de las ruedas y requiere mirar su estado previo.', sources: [{ serviceId: 'alignment', field: 'description', quote: services[1]!.description! }] }
    ]
    const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => services }, async () => owned(body, ['brakes', 'alignment'], 'comparison', blocks))
    for (const block of blocks) assert.ok(result.reply.includes(block.text))
    assert.equal(result.interpretation.aiCalls, 1); checkRead(result, initial, beforeAgenda)
  })
  await check('orientation from published descriptions never selects or guarantees a result', async () => {
    const body = 'Quiero entender qué opciones ayudan con el frizz: Tratamiento y Keratina'
    const blocks: Block[] = [{ text: 'Para el frizz, Keratina es la opción cuya descripción lo menciona; Tratamiento describe hidratación y suavidad, no un cambio de forma.', sources: [source('care'), source('keratin')] }]
    const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => owned(body, ['care', 'keratin'], 'recommendation', blocks))
    assert.ok(result.reply.includes(blocks[0]!.text)); checkRead(result, initial, beforeAgenda)
    assert.equal(result.choicePresentation?.choices.some(choice => choice.label.toLowerCase() === 'reservar') ?? false, false)
  })
  await check('false quotes foreign IDs and unsupported economic or medical copy use an honest informative fallback', async () => {
    const body = 'Descripción de Keratina'; const beforeAgenda = agenda
    for (const block of [
      { text: 'Keratina cura la alopecia.', sources: [{ ...source('keratin'), quote: 'Cura la alopecia.' }] },
      { text: 'Keratina cura la alopecia.', sources: [{ ...source('keratin'), serviceId: 'foreign' }] },
      { text: 'Keratina cuesta $1, hay lugar hoy y ya te reservé.', sources: [source('keratin')] },
      { text: 'Keratina garantiza curar la alopecia.', sources: [source('keratin')] },
      { text: 'Keratina tiene el precio más barato.', sources: [source('keratin')] },
      { text: 'Keratina tiene lugar hoy.', sources: [source('keratin')] },
      { text: 'La propuesta sigue pendiente.', sources: [source('keratin')] },
      { text: '¿Querés reservarlo?', sources: [source('keratin')] }
    ]) {
      const result = await respondWithAiInterpreter(context, initial, body, port, async () => owned(body, ['keratin'], 'description', [block], 'Keratina'))
      assert.ok(!result.reply.includes(block.text), 'economic, agenda and workflow claims remain server-owned')
      assert.doesNotMatch(result.reply, /alopecia|cuesta \$1|hay lugar hoy|ya te reservé/)
      assert.match(result.reply, /Keratina.*[\s\S]*reduce el frizz/, 'rejected free copy does not hide the available description')
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('missing description is visible instead of invented comparison benefits', async () => {
    const body = '¿Cuál es la diferencia entre Tratamiento y Keratina?'; const beforeAgenda = agenda
    const missingCatalog = catalog.map(item => item.id === 'keratin' ? { ...item, description: null } : item)
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => missingCatalog }, async () => owned(body, ['care', 'keratin'], 'comparison', comparison))
    assert.match(result.reply, /Tratamiento[\s\S]*hidratante|hidrataci[oó]n/)
    assert.match(result.reply, /Keratina[\s\S]*(?:no tengo|no hay|falta|sin).*(?:descripci[oó]n|informaci[oó]n)|(?:no tengo|no hay|falta).*[\s\S]*Keratina/i)
    assert.ok(!result.reply.includes(comparison[1]!.text)); checkRead(result, initial, beforeAgenda)
  })
  await check('changed retired and renamed sources never reuse a historical comparison', async () => {
    const body = 'Descripción de Keratina'; const beforeAgenda = agenda
    for (const [index, current] of [
      catalog.map(item => item.id === 'keratin' ? { ...item, description: 'Sólo se realiza evaluación previa.' } : item),
      catalog.map(item => item.id === 'keratin' ? { ...item, name: 'Servicio retirado' } : item),
      catalog.filter(item => item.id !== 'keratin')
    ].entries()) {
      const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => current }, async () => owned(body, ['keratin'], 'description', [comparison[1]!], 'Keratina'))
      assert.ok(!result.reply.includes(comparison[1]!.text))
      if (index === 1) assert.match(result.reply, /Servicio retirado|(?:no tengo|no encuentro|no hay|no pude|no está).*Keratina/i)
      else assert.doesNotMatch(result.reply, /reduce el frizz/)
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('framing does not promise a comparison when the delivered body has no support', async () => {
    const facts = [{ id: 'information', text: 'No hay una descripción publicada para comparar estos servicios.' },
      { id: 'next', text: '¿Sobre qué servicio querés consultar?' }]
    const result = validateReplyDraft({ salutation: null, opening: 'Te cuento la diferencia.', factIds: null, closing: null, variantChoices: null },
      facts, replyContract('information', false, false, facts), [])
    const delivered = result.text ?? facts.map(fact => fact.text).join('\n')
    assert.doesNotMatch(delivered, /Te cuento la diferencia/)
    for (const fact of facts) assert.ok(delivered.includes(fact.text))
    assert.equal(delivered.split(facts[1]!.text).length - 1, 1)
  })
  await check('framing does not repeat proposal status already owned by the canonical body', async () => {
    const facts = [{ id: 'status', text: 'La propuesta sigue pendiente; todavía falta tu confirmación.' },
      { id: 'next', text: '¿Querés confirmar esta propuesta?' }]
    const result = validateReplyDraft({ salutation: null, opening: 'Todavía no; la propuesta sigue pendiente.', factIds: null, closing: null, variantChoices: null },
      facts, replyContract('clarification', false, false, facts), [])
    const delivered = result.text ?? facts.map(fact => fact.text).join('\n')
    assert.equal(delivered.toLowerCase().split('la propuesta sigue pendiente').length - 1, 1)
    for (const fact of facts) assert.ok(delivered.includes(fact.text))
    assert.equal(delivered.split(facts[1]!.text).length - 1, 1)
  })
  await check('qualified unverified requests cannot acquire or assert an undocumented technique through copy', async () => {
    const body = '¿Keratina sin formol garantiza dejarlo lacio?'; const beforeAgenda = agenda
    const blocks: Block[] = [{ text: 'Keratina sin formol te garantiza el pelo lacio.', sources: [{ ...source('keratin'), quote: 'Keratina sin formol te garantiza el pelo lacio.' }] }]
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => ({ ...base,
      turnPlan: { version: 1, operations: [{ kind: 'service_request', purpose: 'inquiry', disposition: 'unverified_variant', serviceIds: ['keratin'],
        correction: false, continuation: false, basis: 'related_category', sourceQuote: null, subject: 'Keratina sin formol', aspect: 'description', evidence: body, confidence: 1 }] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, mention: 'Keratina sin formol', confidence: 1, operationIndexes: [0] }] }, firstReply: frame(blocks) }))
    assert.doesNotMatch(result.reply, /te garantiza el pelo lacio/)
    assert.match(result.state.serviceRequest?.request ?? result.reply, /sin formol/)
    assert.deepEqual(selectionBasket(result.state), selectionBasket(initial)); assert.equal(result.state.serviceId, null)
    assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(agenda, beforeAgenda)
  })
  await check('singleton configured variant comparison keeps its existing published facts', async () => {
    const service: DialogueService = { ...catalog[0]!, id: 'cream', name: 'Baño de crema', bookingPolicy: {
      id: 'cream', name: 'Baño de crema', attentionMode: 'GUIDED_ESTIMATE', price: 18000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
      estimateQuestion: '¿Qué producto elegís?', estimateOptions: [
        { id: 'a', label: 'Producto A', priceMin: 18000, priceMax: null, note: 'Opción hidratante.' },
        { id: 'b', label: 'Producto B', priceMin: 25000, priceMax: null, note: 'Opción nutritiva.' } ],
      estimateExplanation: 'Elegí una opción.', estimateDisclaimer: 'Sujeto a evaluación.', requiresPhoto: false,
      validationEnabled: false, validationMessage: null, validationQuestion: null } }
    const body = 'Comparación de Baño de crema'; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => [service] }, async () => ({ ...base,
      turnPlan: { version: 1, operations: [operation(body, ['cream'], 'comparison')] } }))
    assert.match(result.reply, /Producto A/); assert.match(result.reply, /Producto B/); assert.match(result.reply, /hidratante/); assert.match(result.reply, /nutritiva/)
    checkRead(result, initial, beforeAgenda)
  })
  await check('both provider schemas expose bounded source-backed catalog copy without changing booking operations', async () => {
    const requests: any[] = []; const body = 'Descripción de Keratina'
    const fetchImpl: typeof fetch = async (_url, options) => { requests.push(JSON.parse(String(options?.body)))
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(base) }] }] }), { status: 200 }) }
    await createOpenAiInterpretationProvider({ apiKey: 'fake-local-only', fetchImpl })({ message: body, state: initial, services: catalog }, new AbortController().signal)
    await createOpenAiResponseProvider({ apiKey: 'fake-local-only', fetchImpl })({ message: body, intent: 'information', state: initial,
      facts: [{ id: 'service', text: catalog[1]!.description! }] }, new AbortController().signal)
    assert.ok(requests[0].text.format.schema.properties.firstReply.properties.catalogAnswer)
    assert.ok(requests[1].text.format.schema.properties.catalogAnswer)
    for (const request of requests) { assert.equal(request.store, false); assert.match(request.instructions, /fuente|source/i) }
    assert.equal(JSON.parse(requests[0].input).services.find((item: any) => item.id === 'keratin').description, catalog[1]!.description)
  })
  console.log('catalog answer: ' + passed + ' PASS / ' + failures.length + ' FAIL (controlled proposals; no live model quality claim)')
  assert.deepEqual(failures, [], 'P19 source-backed catalog explanation regressions')
} finally {
  globalThis.fetch = original.fetch; http.request = original.request; https.request = original.httpsRequest; http.get = original.get; https.get = original.httpsGet
}
