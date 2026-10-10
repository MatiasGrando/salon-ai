import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'
import { validateCatalogAnswer } from '../src/conversational-bot/catalog-information-answer.js'

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
  type ExplanatoryBlock = { kind: 'general' | 'published'; text: string; sources: Source[] }
  const general: ExplanatoryBlock = { kind: 'general', text: 'En general, un alisado busca modificar la forma del cabello; los tratamientos de keratina pueden orientarse al frizz y la suavidad. Los nombres comerciales no determinan una fórmula única.', sources: [] }
  const published = (id: string): ExplanatoryBlock => ({ kind: 'published', text: catalog.find(item => item.id === id)!.description!, sources: [source(id)] })
  const explanatory = (body: string, ids: string[], blocks: ExplanatoryBlock[], aspect = 'comparison') => ({
    ...owned(body, ids, aspect, null), firstReply: { ...frame(null), catalogAnswer: { blocks } }
  })
  await check('C3 distinguishes general explanation from loaded local descriptions in one call', async () => {
    const body = '¿Qué diferencia hay entre el alisado y el shock de keratina?'; const beforeAgenda = agenda
    const blocks = [general, published('straight'), published('keratin')]
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => explanatory(body, ['straight', 'keratin'], blocks))
    for (const block of blocks) assert.ok(result.reply.includes(block.text), 'both explanatory origins must reach the reply')
    assert.match(result.reply, /Información general.*orientativa/i); assert.match(result.reply, /Información (?:publicada )?del local/i)
    assert.match(result.reply, /(?:no confirma|no garantiza).*(?:local|negocio)/i)
    assert.equal(result.interpretation.aiCalls, 1); assert.equal(result.interpretation.replyRoute, 'first_call')
    assert.equal(result.choicePresentation, undefined); checkRead(result, initial, beforeAgenda)
  })
  await check('C3 missing description does not suppress general explanation or supported local data', async () => {
    const body = 'Comparame el alisado y el shock de keratina'; const beforeAgenda = agenda
    const missingCatalog = catalog.map(item => item.id === 'keratin' ? { ...item, description: null } : item)
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => missingCatalog },
      async () => explanatory(body, ['straight', 'keratin'], [general, published('straight')]))
    assert.ok(result.reply.includes(general.text)); assert.ok(result.reply.includes(catalog[2]!.description!))
    assert.match(result.reply, /Keratina[\s\S]*(?:no tengo|no hay|falta|sin).*(?:descripción|información)|(?:no tengo|no hay|falta).*Keratina/i)
    assert.ok(!result.reply.includes(catalog[1]!.description!), 'missing local properties cannot come from model memory')
    assert.equal(result.interpretation.aiCalls, 1); checkRead(result, initial, beforeAgenda)
  })
  await check('C3 valid mixed content can acknowledge comparison despite a missing local description', async () => {
    const body = 'Comparame el alisado y el shock de keratina'; const beforeAgenda = agenda
    const missingCatalog = catalog.map(item => item.id === 'keratin' ? { ...item, description: null } : item)
    const proposal = explanatory(body, ['straight', 'keratin'], [general, published('straight')])
    proposal.firstReply.opening = 'Te ayudo a comparar estas opciones.'
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => missingCatalog }, async () => proposal)
    assert.ok(result.reply.includes(proposal.firstReply.opening)); assert.ok(result.reply.includes(general.text))
    checkRead(result, initial, beforeAgenda)
    const invalid = { ...proposal, firstReply: { ...proposal.firstReply, catalogAnswer: { blocks: [
      { kind: 'general', text: 'Nuestro alisado te deja el pelo lacio.', sources: [] }
    ] } } }
    const denied = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => missingCatalog }, async () => invalid)
    assert.ok(!denied.reply.includes(proposal.firstReply.opening)); assert.ok(!denied.reply.includes(invalid.firstReply.catalogAnswer.blocks[0]!.text))
    checkRead(denied, initial, beforeAgenda)
  })
  await check('C3 general-only procedures need no invented catalog ID or mandatory second call', async () => {
    const body = 'Explicame en general qué diferencia hay entre un shock de keratina y una cauterización'; const beforeAgenda = agenda
    const block: ExplanatoryBlock = { kind: 'general', text: 'Los nombres de estos tratamientos pueden variar entre salones y productos; conviene distinguir su objetivo y composición antes de compararlos.', sources: [] }
    let calls = 0, responseCalls = 0
    const provider = Object.assign(async () => { calls++; return { ...explanatory(body, [], [block]), communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, confidence: 1, mention: 'shock de keratina', operationIndexes: [0] }] } } },
      { respond: async () => { responseCalls++; throw new Error('general explanation already accompanies interpretation') } })
    const result = await respondWithAiInterpreter(context, initial, body, port, provider)
    assert.ok(result.reply.includes(block.text)); assert.match(result.reply, /Información general.*orientativa/i)
    assert.doesNotMatch(result.reply, /De cuál de estos servicios|Qué servicio necesitás|Cuál de estas opciones/i)
    assert.equal(calls, 1); assert.equal(responseCalls, 0); assert.equal(result.interpretation.aiCalls, 1)
    assert.equal(result.choicePresentation, undefined); checkRead(result, initial, beforeAgenda)
  })
  await check('C4 current literal inquiry spans explain without requiring whole-message evidence', async () => {
    const span = 'Qué diferencia hay entre el alisado y el shock de keratina'
    const shortBody = 'Hola. ¿' + span + '? Explicame en general y qué ofrecen ustedes.'
    const longBody = shortBody + ' Quiero comprender esta información antes de decidir.'.repeat(8)
    assert.ok(longBody.length > 300, 'evidence limit must not become a whole-message limit')
    const beforeAgenda = agenda
    for (const [body, ownerEvidence] of [[shortBody, shortBody], [shortBody, span], [longBody, span]]) {
      const proposal = explanatory(body, ['straight', 'keratin'], [general, published('straight'), published('keratin')])
      proposal.turnPlan.operations[0]!.evidence = span
      proposal.communicativeActs.acts[0]!.evidence = ownerEvidence
      const result = await respondWithAiInterpreter(context, initial, body, port, async () => proposal)
      assert.ok(result.reply.includes(general.text), 'accepted literal spans must preserve the explanatory read: ' + JSON.stringify({ bodyLength: body!.length, ownerLength: ownerEvidence!.length, reply: result.reply, trace: result.interpretation.replyValidation }))
      assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.interpretation.replyRoute, 'first_call')
      assert.equal(result.choicePresentation, undefined)
      assert.doesNotMatch(result.reply, /De cuál de estos servicios|Qué servicio necesitás|Cuál de estas opciones/i)
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C4 a combined informative mention can cover both current service identities', async () => {
    const body = 'Qué diferencia hay entre el alisado y el shock de keratina'
    const beforeAgenda = agenda
    const proposal = explanatory(body, ['straight', 'keratin'], [general, published('straight'), published('keratin')])
    proposal.communicativeActs.acts[0]!.mention = 'el alisado y el shock de keratina' as any
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => proposal)
    assert.ok(result.reply.includes(general.text), 'a comparison mention is not a singleton service selection')
    assert.equal(result.choicePresentation, undefined); assert.equal(result.interpretation.replyRoute, 'first_call')
    checkRead(result, initial, beforeAgenda)
  })
  await check('C4 current span evidence remains literal and unique, not a fuzzy quote', async () => {
    const span = 'Qué diferencia hay entre el alisado y el shock de keratina'
    const beforeAgenda = agenda
    for (const [body, operationEvidence, ownerEvidence] of [
      ['Hola. ' + span, span, span.toLowerCase()],
      ['Hola. ' + span, 'Qué diferencia hay entre el alisado y Keratina', span],
      [span + '. ' + span, span, span],
      ['Hola. ' + span, span, 'el alisado']
    ]) {
      const proposal = explanatory(body!, ['straight', 'keratin'], [general, published('straight'), published('keratin')])
      proposal.turnPlan.operations[0]!.evidence = operationEvidence!
      proposal.communicativeActs.acts[0]!.evidence = ownerEvidence!
      const result = await respondWithAiInterpreter(context, initial, body!, port, async () => proposal)
      assert.ok(!result.reply.includes(general.text), 'altered or ambiguously repeated evidence grants no explanatory scope')
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C4 combined comparison mentions cannot smuggle an unrelated or unsupported identity', async () => {
    const beforeAgenda = agenda
    for (const body of [
      'Comparame el alisado y la cauterización',
      'Qué diferencia hay entre el alisado y el shock de keratina'
    ]) {
      const proposal = explanatory(body, ['straight', 'keratin'], [general, published('straight'), published('keratin')])
      proposal.communicativeActs.acts[0]!.mention = (body.includes('cauterización') ? 'el alisado y la cauterización' : 'el shock de keratina') as any
      const result = await respondWithAiInterpreter(context, initial, body, port, async () => proposal)
      assert.ok(!result.reply.includes(general.text), 'the mention must support every target identity, not an arbitrary candidate')
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C4 general explanations may describe variation across salons without claiming local practice', async () => {
    const body = 'Qué diferencia hay entre el alisado y el shock de keratina'
    const beforeAgenda = agenda
    const block: ExplanatoryBlock = { kind: 'general', text: 'En general, un alisado busca reducir ondas y modificar la forma del cabello; un shock de keratina suele describirse como un tratamiento de cuidado o acondicionamiento, aunque el nombre y sus efectos pueden variar según el producto y el salón. No se puede asumir que sea equivalente a un alisado.', sources: [] }
    const result = await respondWithAiInterpreter(context, initial, body, port,
      async () => explanatory(body, ['straight', 'keratin'], [block, published('straight'), published('keratin')]))
    assert.ok(result.reply.includes(block.text), 'generic variation is not attribution to this business')
    assert.match(result.reply, /Información general.*orientativa/i); checkRead(result, initial, beforeAgenda)
    for (const text of ['En este salón ofrecemos un shock de keratina.', 'El salón ofrece un shock de keratina.', 'El salón usa keratina brasileña para este servicio.']) {
      const denied = await respondWithAiInterpreter(context, initial, body, port,
        async () => explanatory(body, ['straight', 'keratin'], [{ kind: 'general', text, sources: [] }, published('straight'), published('keratin')]))
      assert.ok(!denied.reply.includes(text), 'actual local-attribution claims must remain rejected')
      checkRead(denied, initial, beforeAgenda)
    }
  })
  await check('C4 zero-ID explanatory evidence cannot be silently case-normalized or invented', async () => {
    const body = 'Explicame en general qué es una cauterización capilar y en qué se diferencia de un shock de keratina'
    const beforeAgenda = agenda
    for (const evidence of [body.replace('Explicame', 'explicame'), 'Diferencias generales entre tratamientos']) {
      const proposal = explanatory(body, [], [general])
      proposal.communicativeActs.acts[0]!.evidence = evidence
      const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => [] }, async () => proposal)
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.equal(result.interpretation.validation?.turnPlan?.cause, 'evidence')
      assert.ok(!result.reply.includes(general.text)); checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C3 displayed references explain without choosing or acquiring an option', async () => {
    const menuBody = 'Precio de Tratamiento y Keratina'
    const menu = await respondWithAiInterpreter(context, initial, menuBody, port, async () => owned(menuBody, ['care', 'keratin'], 'price', null))
    const body = 'Explicame en general la diferencia de esas opciones'; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, menu.state, body, port,
      async () => explanatory(body, ['care', 'keratin'], [general, published('care'), published('keratin')]))
    assert.ok(result.reply.includes(general.text)); assert.equal(result.choicePresentation, undefined)
    assert.doesNotMatch(result.reply, /Cuál de estas opciones|De cuál de estos servicios/i); checkRead(result, menu.state, beforeAgenda)
  })
  await check('C3 general blocks cannot impersonate local facts or source provenance', async () => {
    const body = 'Descripción de Keratina'; const beforeAgenda = agenda
    for (const block of [
      { kind: 'general', text: 'En este local usamos keratina brasileña y te dejamos el pelo lacio.', sources: [] },
      { kind: 'general', text: 'Nuestro tratamiento incluye lavado y usa productos certificados.', sources: [] },
      { kind: 'general', text: 'Keratina cuesta $1.', sources: [] },
      { kind: 'general', text: 'El procedimiento dura 45 minutos.', sources: [] },
      { kind: 'general', text: 'Tenemos disponibilidad y ya te reservé.', sources: [] },
      { kind: 'general', text: general.text, sources: [source('keratin')] },
      { kind: 'published', text: 'Keratina cura la alopecia.', sources: [{ ...source('keratin'), quote: 'Cura la alopecia.' }] },
      { kind: 'published', text: 'Keratina tiene una fórmula secreta.', sources: [] }
    ]) {
      const result = await respondWithAiInterpreter(context, initial, body, port,
        async () => explanatory(body, ['keratin'], [block as ExplanatoryBlock]))
      assert.ok(!result.reply.includes(block.text), 'invalid provenance or protected claim rejects free copy')
      assert.ok(result.reply.includes(catalog[1]!.description!), 'honest local fallback remains available')
      checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C3 general copy is opt-in explanatory information only, not a price or frame escape', async () => {
    const raw = { blocks: [general] }
    for (const aspect of ['price', 'duration', 'products', 'discount']) {
      assert.equal(validateCatalogAnswer(raw, { aspect, services: [], generalKnowledgeAllowed: true } as any, () => false), null)
    }
    assert.equal(validateCatalogAnswer(raw, { aspect: 'comparison', services: [] }, () => false), null,
      'unsourced copy requires a server-derived informative inquiry opt-in')
    const facts = [{ id: 'next', text: '¿En qué te puedo ayudar?' }]
    assert.notEqual(validateReplyDraft({ ...frame(null), catalogAnswer: raw }, facts,
      replyContract('social', false, false, facts), []).validation.status, 'accepted')
  })
  await check('C3 zero-ID explanation still needs a current high-confidence informative owner', async () => {
    const body = 'Explicame el shock de keratina'; const beforeAgenda = agenda
    for (const proposal of [
      { ...explanatory(body, [], [general]), communicativeActs: null },
      { ...explanatory(body, [], [general]), communicativeActs: { version: 1, acts: [{ kind: 'request', field: 'service', evidence: body, confidence: 1, mention: null, operationIndexes: [0] }] } },
      { ...explanatory(body, [], [general]), turnPlan: { version: 1, operations: [{ ...operation(body, [], 'description'), confidence: .5 }] } }
    ]) {
      const result = await respondWithAiInterpreter(context, initial, body, port, async () => proposal)
      assert.ok(!result.reply.includes(general.text)); checkRead(result, initial, beforeAgenda)
    }
  })
  await check('C3 block origin is a primitive explicit enum, never a coerced array or object', async () => {
    const local = { aspect: 'description' as const, services: [{ id: 'keratin', name: 'Keratina', description: catalog[1]!.description! }] }
    for (const kind of [['published'], { toString: 'published' }, 123, null]) {
      assert.equal(validateCatalogAnswer({ blocks: [{ kind, text: catalog[1]!.description!, sources: [source('keratin')] }] }, local, () => false), null)
    }
  })
  await check('C3 absent local descriptions stay explicit and available descriptions cannot be omitted', async () => {
    const body = 'Comparame Tratamiento y Keratina'; const beforeAgenda = agenda
    const missingCatalog = catalog.map(item => ['care', 'keratin'].includes(item.id) ? { ...item, description: null } : item)
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => missingCatalog },
      async () => explanatory(body, ['care', 'keratin'], [general]))
    assert.ok(result.reply.includes(general.text))
    for (const service of missingCatalog.slice(0, 2)) assert.ok(result.reply.includes(service.name + ':\nNo tengo una descripción publicada'))
    checkRead(result, initial, beforeAgenda)
    const omitted = await respondWithAiInterpreter(context, initial, body, port, async () => explanatory(body, ['care', 'keratin'], [general, published('care')]))
    assert.ok(!omitted.reply.includes(general.text)); assert.ok(omitted.reply.includes(catalog[1]!.description!))
    checkRead(omitted, initial, beforeAgenda)
  })
  await check('C3 mixed explanation does not weaken source freshness or current IDs', async () => {
    const body = 'Compará Tratamiento y Keratina'; const beforeAgenda = agenda
    const blocks = [general, published('care'), published('keratin')]
    const changedCatalog = catalog.map(item => item.id === 'keratin' ? { ...item, description: 'Sólo realizamos una evaluación previa.' } : item)
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => changedCatalog },
      async () => explanatory(body, ['care', 'keratin'], blocks))
    assert.ok(!result.reply.includes(blocks[2]!.text)); assert.ok(result.reply.includes(changedCatalog[1]!.description!)); checkRead(result, initial, beforeAgenda)
    const foreign = await respondWithAiInterpreter(context, initial, body, port,
      async () => explanatory(body, ['care', 'foreign'], blocks))
    assert.ok(!foreign.reply.includes(general.text)); checkRead(foreign, initial, beforeAgenda)
  })

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
  const allDescriptions: Block[] = catalog.slice(0, 3).map(service => ({ text: service.description!, sources: [source(service.id)] }))
  const procedureMenu = async () => {
    const body = 'Quería consultar sobre el alisado'
    return respondWithAiInterpreter(context, initial, body, port, async () => ({ ...base,
      turnPlan: { version: 1, operations: [{ kind: 'service_request', purpose: 'inquiry', disposition: 'alternatives',
        serviceIds: ['straight', 'care', 'keratin'], correction: false, continuation: false, basis: 'related_category', sourceQuote: null,
        evidence: 'el alisado', confidence: 1 }] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, mention: 'el alisado', confidence: 1, operationIndexes: [0] }] }, firstReply: null }))
  }
  await check('C1 habitual shortened names explain the model-proposed current services without asking for a selection', async () => {
    const body = '¿Qué diferencia hay entre el alisado y la keratina?'; const beforeAgenda = agenda
    const blocks = [allDescriptions[2]!, allDescriptions[1]!]
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => owned(body, ['straight', 'keratin'], 'comparison', blocks))
    for (const block of blocks) assert.ok(result.reply.includes(block.text), 'a habitual unambiguous label must not hide the current description')
    assert.doesNotMatch(result.reply, /Cuál de estas opciones|estas son las opciones del catálogo|De cuál de estos servicios/i)
    checkRead(result, initial, beforeAgenda)
  })
  await check('C1 full current unique aliases support explanation but never acquire a cart', async () => {
    const services = catalog.map(service => ({ ...service, aliases: service.id === 'straight' ? ['Laceado'] : service.id === 'keratin' ? ['Baño keratínico'] : [] }))
    const body = 'Comparame Laceado y Baño keratínico'; const beforeAgenda = agenda
    const blocks = [allDescriptions[2]!, allDescriptions[1]!]
    for (const mention of [null, 'Baño keratínico']) {
      const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => services }, async () => owned(body, ['straight', 'keratin'], 'comparison', blocks, mention))
      for (const block of blocks) assert.ok(result.reply.includes(block.text), 'aliases are current public identities, not invented technique equivalence')
      checkRead(result, initial, beforeAgenda)
    }
    const qualifiedBody = body + ', el método inventado'
    const denied = await respondWithAiInterpreter(context, initial, qualifiedBody, { ...port, catalog: async () => services }, async () => owned(qualifiedBody, ['straight', 'keratin'], 'comparison', blocks, 'método inventado'))
    for (const block of blocks) assert.ok(!denied.reply.includes(block.text), 'an unrecognized act identity cannot authorize current catalog copy')
    checkRead(denied, initial, beforeAgenda)
  })
  await check('C1 each of them compares all options from the actual current procedure menu', async () => {
    const menu = await procedureMenu()
    assert.equal(menu.state.serviceRequest?.disposition, 'alternatives'); assert.equal(menu.state.questionContext?.options.length, 3)
    const body = 'Quiero saber la diferencia de cada una de ellas para saber cuál me convendría hacerme'; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, menu.state, body, port, async () => owned(body, ['straight', 'care', 'keratin'], 'comparison', allDescriptions))
    for (const block of allDescriptions) assert.ok(result.reply.includes(block.text), 'the current displayed pool must support the model-proposed informational comparison')
    assert.doesNotMatch(result.reply, /estas son las opciones del catálogo|Cuál de estas opciones|— Quiero saber/)
    checkRead(result, menu.state, beforeAgenda)
  })
  await check('C1 an undocumented shock qualifier does not become an asserted technique or result', async () => {
    const body = 'que diferencia hay entre el alisado y el shock de keratina?'; const beforeAgenda = agenda
    const blocks = [allDescriptions[2]!, allDescriptions[1]!]
    const result = await respondWithAiInterpreter(context, initial, body, port, async () => owned(body, ['straight', 'keratin'], 'comparison', blocks))
    for (const block of blocks) assert.ok(result.reply.includes(block.text), 'explain only the current published generic descriptions')
    assert.doesNotMatch(result.reply, /shock.*(?:equivale|incluye|garantiza)|(?:equivale|incluye|garantiza).*shock|estas son las opciones del catálogo|Cuál de estas opciones/i)
    checkRead(result, initial, beforeAgenda)
  })
  await check('C1 ambiguous aliases cannot hide an unmentioned alternative through a proposed read ID', async () => {
    const services = catalog.map(service => ({ ...service, aliases: ['straight', 'care'].includes(service.id) ? ['Laceado'] : [] }))
    const body = 'Comparame Laceado y Keratina'; const blocks = [allDescriptions[2]!, allDescriptions[1]!]; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, initial, body, { ...port, catalog: async () => services }, async () => owned(body, ['straight', 'keratin'], 'comparison', blocks))
    assert.ok(!result.reply.includes(blocks[0]!.text), 'an ambiguous alias cannot authorize the arbitrarily selected service description')
    checkRead(result, initial, beforeAgenda)
  })
  await check('C1 old renamed procedure options cannot authorize a comparison by reference', async () => {
    const menu = await procedureMenu(); const body = 'Explicame la diferencia entre cada una'; const beforeAgenda = agenda
    const services = catalog.map(service => service.id === 'care' ? { ...service, name: 'Otro tratamiento vigente' } : service)
    const result = await respondWithAiInterpreter(context, menu.state, body, { ...port, catalog: async () => services }, async () => owned(body, ['straight', 'care', 'keratin'], 'comparison', allDescriptions))
    for (const block of allDescriptions) assert.ok(!result.reply.includes(block.text), 'a stale displayed identity cannot authorize source-backed copy')
    checkRead(result, menu.state, beforeAgenda)
  })
  await check('C1 IDs in an unrelated question do not become an explanatory referent', async () => {
    const menu = await procedureMenu(); const before = structuredClone(menu.state)
    before.questionContext!.question = '¿Con qué profesional querés atenderte?'
    const body = 'Explicame cada una'; const beforeAgenda = agenda
    const result = await respondWithAiInterpreter(context, before, body, port, async () => owned(body, ['straight', 'care', 'keratin'], 'comparison', allDescriptions))
    for (const block of allDescriptions) assert.ok(!result.reply.includes(block.text), 'only the actually matching current procedure question supplies identity context')
    checkRead(result, before, beforeAgenda)
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
    for (const schema of [requests[0].text.format.schema.properties.firstReply.properties.catalogAnswer, requests[1].text.format.schema.properties.catalogAnswer]) {
      const kinds = schema.properties.blocks.items.anyOf
      assert.equal(kinds.length, 2)
      assert.deepEqual(kinds.map((kind: any) => kind.properties.kind.enum[0]).sort(), ['general', 'published'])
      for (const kind of kinds) assert.ok(kind.required.includes('kind'))
    }
    for (const request of requests) assert.match(request.instructions, /general.*orientativ/i)
    assert.doesNotMatch(requests[0].instructions, /Para consultas sobre procedimientos o variantes usa kind service_request/)
    assert.match(requests[0].instructions, /Para verificar si el negocio ofrece un procedimiento o variante/)
    assert.match(requests[0].instructions, /Las explicaciones generales del rubro usan information/)
    for (const request of requests) { assert.equal(request.store, false); assert.match(request.instructions, /fuente|source/i) }
    assert.equal(JSON.parse(requests[0].input).services.find((item: any) => item.id === 'keratin').description, catalog[1]!.description)
  })
  console.log('catalog answer: ' + passed + ' PASS / ' + failures.length + ' FAIL (controlled proposals; no live model quality claim)')
  assert.deepEqual(failures, [], 'P19 source-backed catalog explanation regressions')
} finally {
  globalThis.fetch = original.fetch; http.request = original.request; https.request = original.httpsRequest; http.get = original.get; https.get = original.httpsGet
}
