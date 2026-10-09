import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respondConversationChoice, respond, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { expectedDialogueAnswer } from '../src/conversational-bot/dialogue-context.js'
import { TURN_PLAN_INTERPRETATION_GUIDE } from '../src/conversational-bot/turn-plan-interpretation-guide.js'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA } from '../src/conversational-bot/turn-plan.js'
import { admitCommunicativePlan, parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
import { planConversationChoiceView } from '../src/conversational-bot/runtime-choice-persistence.js'
import { resolveServiceRequest } from '../src/conversational-bot/service-request.js'
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
const context = { businessId: 'catalog-test', timezone: 'UTC', dbNow: new Date('2026-10-07T12:00:00Z') }
const state = { ...initialDialogueState(context.businessId), customerName: 'Ana', date: '2026-10-08' }
const base = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, firstReply: null, intakeReply: null }
const cut: DialogueService = { id: 'cut', name: 'Corte hombre', description: 'Corte con tijera o máquina.', durationMinutes: 30, price: 100, requiresConsultation: false }
const color: DialogueService = { id: 'color', name: 'Iluminación', description: 'Mechas y reflejos de color.', durationMinutes: 60, price: 500, priceMode: 'STARTING_AT', requiresConsultation: false,
  bookingPolicy: { id: 'color', name: 'Iluminación', attentionMode: 'GUIDED_ESTIMATE', price: 500, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
    estimateQuestion: '¿Qué largo tiene tu cabello?', estimateOptions: [{ id: 'short', label: 'Hasta los hombros', priceMin: 500, priceMax: 600, note: null }],
    estimateExplanation: 'El precio depende del largo.', estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null } }
const tint: DialogueService = { id: 'tint', name: 'Coloración', description: 'Cambio de color completo.', durationMinutes: 60, price: 400, requiresConsultation: false }
const catalog = [cut, color, tint]
const request = (evidence: string, ids: string[], purpose: 'booking' | 'inquiry' = 'booking', disposition = 'unverified_variant', basis = 'related_category') => ({
  kind: 'service_request', evidence, confidence: 1, purpose, disposition, basis, serviceIds: ids, sourceQuote: null, correction: false, continuation: false
})
let passed = 0, failed = 0, agenda = 0
async function check(label: string, run: () => Promise<void> | void) {
  try { await run(); passed++; console.log('PASS ' + label) } catch (error) { failed++; console.error('FAIL ' + label + ': ' + String(error)) }
}
function makePort(services: DialogueService[] = catalog): DialoguePort {
  return { catalog: async () => services, availability: async () => { agenda++; throw new Error('agenda forbidden during clarification') },
    information: async () => ({ businessId: context.businessId, name: 'Local', address: 'Calle 100', area: null, mapsUrl: null, hours: null,
      website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null }) }
}
async function say(message: string, operations: object[], previous: DialogueState = state, services = catalog, communicativeActs?: object) {
  let calls = 0
  const provider = Object.assign(async (_input: AiInterpretationInput) => {
    calls++; return { ...base, ...(communicativeActs ? { communicativeActs } : {}), turnPlan: { version: 1, operations }, firstReply: { salutation: null, opening: 'Claro, te ayudo.', factIds: null, closing: null, variantChoices: null } }
  }, { respond: async () => { calls++; throw new Error('extra comparison/style call forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, previous, message, makePort(services), provider)
  assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1)
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  return result
}

const referenceOp = (message: string, serviceId = 'color') => ({ kind: 'service_reference', action: 'confirm', serviceId, evidence: message, confidence: 1 })
const referenceActs = (message: string, kind = 'answer', field = 'service') => ({ version: 1, acts: [{ kind, field, evidence: message, confidence: 1, mention: null, operationIndexes: [0] }] })
const reference = (message: string, previous: DialogueState, services = catalog) => say(message, [referenceOp(message)], previous, services, referenceActs(message))
await check('one related candidate is visible and clarified, never selected or handed off', async () => {
  const result = await say('quería unas mechas', [request('mechas', ['color'])])
  assert.match(result.reply, /Iluminación/); assert.match(result.reply, /relacionad|referís|resultado/)
  assert.doesNotMatch(result.reply, /consultarlo con el equipo|¿Querés consultarlo|te derivé|no (?:lo )?hacemos/)
  assert.equal(result.state.serviceId, null); assert.equal(result.state.referral?.status, 'offered')
  assert.equal(result.state.serviceRequest?.disposition, 'unverified_variant')
  assert.equal(result.state.date, state.date); assert.equal(result.state.customerName, state.customerName)
})
await check('several existing candidates are shown without manufacturing a category', async () => {
  const result = await say('quiero cambiar el color', [request('cambiar el color', ['color', 'tint'])])
  assert.match(result.reply, /Iluminación/); assert.match(result.reply, /Coloración/)
  assert.match(result.reply, /resultado|opcion|opción/); assert.doesNotMatch(result.reply, /¿Querés consultarlo/)
  assert.equal(result.state.serviceId, null); assert.deepEqual(result.state.serviceRequest?.serviceIds, ['color', 'tint'])
})
for (const purpose of ['booking', 'inquiry'] as const) await check('no match asks for the desired result first: ' + purpose, async () => {
  const result = await say('quiero un procedimiento nuevo', [request('procedimiento nuevo', [], purpose)])
  assert.match(result.reply, /resultado|buscás|buscas/)
  assert.doesNotMatch(result.reply, /¿Querés consultarlo|¿Qué otra información necesitás|no (?:lo )?hacemos/)
  assert.equal(result.state.serviceId, null); assert.notEqual(result.state.referral?.status, 'pending')
})
for (const [name, description, evidence] of [
  ['Revisión de frenos', 'Diagnóstico y mantenimiento del sistema de frenado.', 'ruido al frenar'],
  ['Masaje relajante', 'Tratamiento de tensión muscular y relajación.', 'relajar la espalda']
]) await check('catalog comparison is not hair-specific: ' + name, async () => {
  const service = { ...cut, id: 'related', name: name!, description: description! }
  const result = await say(evidence!, [request(evidence!, ['related'])], state, [service])
  assert.ok(result.reply.includes(name!)); assert.equal(result.state.serviceId, null)
  assert.doesNotMatch(result.reply, /Iluminación|consultarlo con el equipo/)
})
await check('current candidate name explicitly selected continues into its actual estimate', async () => {
  const initial = await say('quiero unas mechas', [request('mechas', ['color'])])
  const selected = await say('Iluminación', [request('Iluminación', ['color'], 'booking', 'clear', 'exact_public_name')], initial.state)
  assert.equal(selected.state.serviceId, 'color'); assert.equal(selected.state.serviceRequest, undefined)
  assert.equal(selected.state.referral, undefined); assert.equal(selected.state.pending, 'estimate')
  assert.match(selected.reply, /¿Qué largo tiene tu cabello/); assert.match(selected.reply, /500/); assert.match(selected.reply, /600/)
})
await check('yes to an unverified technique does not prove the variant', async () => {
  const initial = await say('quiero un color arcoíris', [request('color arcoíris', ['color'])])
  const yes = await say('sí', [{ ...request('sí', ['color'], 'booking', 'clear'), continuation: true }], initial.state)
  assert.equal(yes.state.serviceId, null); assert.ok(yes.state.serviceRequest)
  assert.doesNotMatch(yes.reply, /requiere.*foto|reservado|confirmé/)
})
await check('literal documented variant resolves; fabricated quote still fails', async () => {
  const good = await say('quiero mechas', [{ ...request('mechas', ['color'], 'booking', 'clear', 'documented_variant'), sourceQuote: color.description }])
  assert.equal(good.state.serviceId, 'color'); assert.equal(good.state.pending, 'estimate')
  const bad = await say('quiero arcoíris', [{ ...request('arcoíris', ['color'], 'booking', 'clear', 'documented_variant'), sourceQuote: 'Hacemos arcoíris.' }])
  assert.equal(bad.state.serviceId, null); assert.ok(bad.state.serviceRequest)
})
await check('inquiry and lateral reading preserve the existing basket, identity and date', async () => {
  const previous: DialogueState = { ...state, serviceId: 'cut', basket: { version: 1, nextMemberId: 2,
    members: [{ memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: 'Corte hombre' }] } }
  const result = await say('hacen unas mechas', [request('mechas', ['color'], 'inquiry')], previous)
  assert.deepEqual(result.state.basket, previous.basket); assert.equal(result.state.serviceId, 'cut')
  const lateral = await say('dónde están', [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, evidence: 'dónde están', confidence: 1 }], result.state)
  assert.match(lateral.reply, /Calle 100/); assert.deepEqual(lateral.state.serviceRequest, result.state.serviceRequest)
  assert.equal(lateral.state.date, previous.date); assert.equal(lateral.state.customerName, previous.customerName)
})
await check('clarification keeps explicit consultation and resume operational without automatic queue', async () => {
  const initial = await say('quería unas mechas', [request('mechas', ['color'])])
  const consult = await say('consultar al equipo', [{ kind: 'referral', action: 'consult', evidence: 'consultar al equipo', confidence: 1 }], initial.state)
  assert.equal(consult.state.referral?.status, 'pending')
  const resumed = await say('volver al bot', [{ kind: 'referral', action: 'resume', evidence: 'volver al bot', confidence: 1 }], consult.state)
  assert.equal(resumed.state.referral, undefined); assert.ok(resumed.state.serviceRequest)
  assert.match(resumed.reply, /Iluminación/); assert.doesNotMatch(resumed.reply, /¿Querés consultarlo/)
})
await check('stale or foreign catalog identity cannot be selected', async () => {
  const initial = await say('quiero unas mechas', [request('mechas', ['color'])])
  const removed = await say('sigo consultando', [], initial.state, [cut, tint])
  assert.deepEqual(removed.state.serviceRequest?.serviceIds, [])
  assert.doesNotMatch(removed.reply, /Iluminación/); assert.equal(removed.state.serviceId, null)
  assert.throws(() => parseDialogueState({ ...initial.state, serviceRequest: { ...initial.state.serviceRequest, businessId: 'foreign' } }, context.businessId), /scope/)
  assert.throws(() => resolveServiceRequest({ purpose: 'booking', disposition: 'clear', serviceIds: ['foreign'], correction: false,
    continuation: false, basis: 'exact_public_name', sourceQuote: null }, 'mechas', 1, catalog), /catalog/)
})
await check('actual provider receives all current catalog descriptions and comparison guidance in one request', async () => {
  let calls = 0, payload: Record<string, any> | undefined
  const provider = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
    calls++; payload = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      ...base, turnPlan: { version: 1, operations: [request('mechas', ['color'])] },
      firstReply: { salutation: null, opening: 'Claro, te ayudo.', factIds: null, closing: null, variantChoices: null }
    }) }] }] }), { status: 200 })
  } })
  const result = await respondWithAiInterpreter(context, state, 'quiero unas mechas', makePort(), provider)
  assert.equal(calls, 1); assert.equal(result.interpretation.mode, 'ai'); assert.match(result.reply, /Iluminación/)
  const input = JSON.parse(payload!.input)
  assert.deepEqual(input.services.map((service: { id: string }) => service.id), catalog.map(service => service.id))
  assert.equal(input.services[1].description, color.description)
  assert.match(payload!.instructions, /Comparación con el catálogo actual:/)
  assert.match(payload!.instructions, /sin coincidencias|sin candidatos/)
  assert.deepEqual(payload!.text.format.schema.properties.turnPlan.anyOf[0], TURN_PLAN_JSON_SCHEMA);
  assert.ok(JSON.stringify(payload!.text.format.schema).includes('select'));
  assert.equal(payload!.store, false); assert.equal(result.state.serviceId, null)
})

await check('related reference answer is not a variant, booking selection or team consent', async () => {
  const initial = await say('quería mechas con gorra', [request('mechas con gorra', ['color'])])
  assert.equal(initial.state.serviceRequest?.candidateName, color.name)
  assert.match(expectedDialogueAnswer(initial.state).question, /referís|resultado/)
  assert.equal(initial.state.questionContext?.matchCandidateIds, undefined)
  const answer = await reference('sí me refiero a ese', initial.state)
  assert.equal((answer.state.serviceRequest as any)?.referenceConfirmed, true)
  assert.equal(answer.state.serviceRequest?.request, 'mechas con gorra')
  assert.equal(answer.state.serviceRequest?.disposition, 'unverified_variant')
  assert.equal(answer.state.serviceId, null)
  assert.notEqual(answer.state.referral?.status, 'pending')
  assert.match(answer.reply, /Iluminación/)
  assert.match(answer.reply, /no tengo confirmado|no está confirmad/i)
  assert.match(answer.reply, /servicio publicado|consultar.*equipo/)
  assert.doesNotMatch(answer.reply, /consulto con el equipo|Qué dato querés elegir|reservado/)
  assert.equal((answer.reply.match(/\?/g) ?? []).length, 1)
  assert.equal(parseDialogueState(JSON.parse(JSON.stringify(answer.state)), context.businessId).serviceRequest?.request, 'mechas con gorra')
})
await check('reference confirmation needs the actual live question and current catalog name', async () => {
  const initial = await say('quería mechas con gorra', [request('mechas con gorra', ['color'])])
  for (const message of ['sí', 'no, ese no', 'sí pero depende', '¿sí me refiero a ese?', 'si me refiero a ese y reservá']) {
    const response = await say(message, [], initial.state)
    assert.notEqual((response.state.serviceRequest as any)?.referenceConfirmed, true, message)
  }
  const noQuestion = { ...initial.state }; delete noQuestion.questionContext
  assert.notEqual((await reference('sí me refiero a ese', noQuestion)).state.serviceRequest?.referenceConfirmed, true)
  const renamed = await reference('sí me refiero a ese', initial.state, [cut, { ...color, name: 'Nombre nuevo' }, tint])
  assert.notEqual((renamed.state.serviceRequest as any)?.referenceConfirmed, true)
  const removed = await reference('sí me refiero a ese', initial.state, [cut, tint])
  assert.notEqual((removed.state.serviceRequest as any)?.referenceConfirmed, true)
})
await check('reference answer coexists with semantic continuation, and selection stays explicit', async () => {
  const initial = await say('quería mechas con gorra', [request('mechas con gorra', ['color'])])
  const response = await reference('sí me refiero a ese', initial.state)
  assert.equal((response.state.serviceRequest as any)?.referenceConfirmed, true)
  assert.equal(response.state.serviceId, null)
  const selected = await say('Iluminación', [request('Iluminación', ['color'], 'booking', 'clear', 'exact_public_name')], response.state)
  assert.equal(selected.state.serviceId, color.id)
  assert.equal(selected.state.serviceRequest, undefined)
  assert.equal(selected.state.pending, 'estimate')
})
await check('a side query owns its displayed question; it does not confirm the old reference', async () => {
  const initial = await say('mechas con gorra', [request('mechas con gorra', ['color'])])
  const lateral = await say('dónde están', [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, evidence: 'dónde están', confidence: 1 }], initial.state)
  const staleQuestion = { ...lateral.state, questionContext: { ...initial.state.questionContext!, question: '¿Qué día preferís?' } }
  assert.notEqual((await reference('sí me refiero a ese', staleQuestion)).state.serviceRequest?.referenceConfirmed, true)
})
await check('semantic reference has exact schema, current evidence and answer ownership', async () => {
  const message = 'exactamente, esa categoría es la que digo'
  const initial = await say('mechas con gorra', [request('mechas con gorra', ['color'])])
  const response = await reference(message, initial.state)
  assert.equal(response.state.serviceRequest?.referenceConfirmed, true)
  assert.notEqual((await say('sí me refiero a ese', [], initial.state)).state.serviceRequest?.referenceConfirmed, true)
  const plan = parseTurnPlan({ version: 1, operations: [referenceOp(message)] }, message, ['color'])
  assert.ok(JSON.stringify(TURN_PLAN_JSON_SCHEMA).includes('service_reference'))
  for (const invalid of [{ ...referenceOp(message), action: 'consult' }, { ...referenceOp(message), serviceId: 'foreign' }, { ...referenceOp(message), referenceConfirmed: true }, { ...referenceOp(message), evidence: 'otro mensaje' }]) assert.throws(() => parseTurnPlan({ version: 1, operations: [invalid] }, message, ['color']))
  for (const acts of [null, referenceActs(message, 'request'), referenceActs(message, 'uncertain'), referenceActs(message, 'answer', 'professional')]) {
    const metadata = parseCommunicativeActs(acts, message, 1, plan)
    assert.equal(admitCommunicativePlan(metadata, plan, plan, message, initial.state, catalog).plan.operations.length, 0)
  }
  const stale = { ...initial.state, questionContext: { ...initial.state.questionContext!, options: [{ id: 'tint', label: tint.name }] } }
  assert.notEqual((await reference(message, stale)).state.serviceRequest?.referenceConfirmed, true)
})
await check('reference semantics do not authorize direct callers and preserve independent information', async () => {
  const initial = await say('mechas con gorra', [request('mechas con gorra', ['color'])])
  const message = 'sí, ese, y dónde están'
  const direct = await respond(context, initial.state, message, makePort(), { intent: 'booking', serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [referenceOp(message)] } } as any)
  assert.notEqual(direct.state.serviceRequest?.referenceConfirmed, true)
  assert.equal(direct.state.serviceId, null); assert.equal(direct.handoffCommand, undefined)
  const acts = { version: 1, acts: [
    { kind: 'answer', field: 'service', evidence: 'sí, ese', confidence: 1, mention: null, operationIndexes: [0] },
    { kind: 'inquiry', field: 'general', evidence: 'dónde están', confidence: 1, mention: null, operationIndexes: [1] }
  ] }
  const result = await say(message, [referenceOp('sí, ese'), { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, evidence: 'dónde están', confidence: 1 }], initial.state, catalog, acts)
  assert.equal(result.state.serviceRequest?.referenceConfirmed, true)
  assert.match(result.reply, /Calle 100/)
  assert.equal(result.state.date, initial.state.date); assert.equal(result.state.customerName, initial.state.customerName)
  const foreign = { ...initial.state, serviceRequest: { ...initial.state.serviceRequest!, businessId: 'foreign' } }
  assert.throws(() => parseDialogueState(foreign, context.businessId))
})
await check('actual three-turn choice continues the published service without proving the technique', async () => {
  for (const representation of ['service', 'service_request']) {
    const initial = await say('Quería mechas con gorra', [request('mechas con gorra', ['cut', 'tint', 'color'])])
    const focusedMessage = 'Sí quería algo como la iluminación'
    const focused = await say(focusedMessage, [{ ...request('iluminación', ['color']), continuation: true }], initial.state)
    assert.equal(focused.state.serviceRequest?.request, 'mechas con gorra')
    const message = 'Sí a Iluminación'
    const operation = representation === 'service'
      ? { kind: 'service', mode: 'single', serviceIds: ['color'], correction: false, evidence: 'Iluminación', confidence: 1 }
      : request('Iluminación', ['color'], 'booking', 'clear', 'exact_public_name')
    const selected = await say(message, [operation], focused.state, catalog, referenceActs(message))
    assert.equal(selected.state.serviceId, color.id)
    assert.equal(selected.state.pending, 'estimate'); assert.equal(selected.state.serviceRequest, undefined)
    assert.equal(selected.state.referral, undefined)
    assert.equal(selected.state.date, initial.state.date); assert.equal(selected.state.customerName, initial.state.customerName)
    assert.match(selected.reply, /Perfecto.*Iluminación/)
    assert.match(selected.reply, /no tengo confirmado.*mechas con gorra/i)
    assert.match(selected.reply, /¿Qué largo tiene tu cabello/)
    assert.doesNotMatch(selected.reply, /Qué servicio querés elegir|Querés elegir el servicio publicado|consulto con el equipo|sí hacemos/)
  }
})
await check('explicit composition preserves companions while choosing a published candidate', async () => {
  const prior = { ...state, date: null }
  const cutSelected = await say('Corte hombre', [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'Corte hombre', confidence: 1 }], prior)
  const initial = await say('quiero además mechas con gorra', [request('mechas con gorra', ['color'])], cutSelected.state, catalog, referenceActs('quiero además mechas con gorra', 'request'))
  assert.equal(initial.state.serviceRequest?.request, 'mechas con gorra')
  const message = 'Sumá Iluminación'
  const selected = await say(message, [{ kind: 'basket', mutation: 'add', scope: 'all', targetMemberIds: [],
    members: [{ mode: 'single', serviceIds: ['color'], evidence: 'Iluminación', confidence: 1 }], evidence: message, confidence: 1 }],
    initial.state, catalog, { version: 1, acts: [{ kind: 'request', field: 'service', evidence: message, confidence: 1, mention: 'Iluminación', operationIndexes: [0] }] })
  assert.deepEqual(selected.state.basket?.members.flatMap(member => member.serviceIds), ['cut', 'color'])
  assert.equal(selected.state.pending, 'estimate')
  assert.match(selected.reply, /no tengo confirmado.*mechas con gorra/i)
})
await check('service choice guidance separates current published choice from unverified technique and reference', () => {
  assert.match(TURN_PLAN_INTERPRETATION_GUIDE, /Elección del servicio publicado/)
  assert.match(TURN_PLAN_INTERPRETATION_GUIDE, /continuation true/)
  assert.match(TURN_PLAN_INTERPRETATION_GUIDE, /service.*single/)
})
await check('a current contextual choice can advance on the second turn without a third confirmation', async () => {
  const initial = await say('Quería mechas con gorra', [request('mechas con gorra', ['cut', 'tint', 'color'])])
  const message = 'Sí quería algo como la iluminación'
  const selected = await say(message, [{ kind: 'service', mode: 'single', serviceIds: ['color'], correction: false, evidence: 'iluminación', confidence: 1 }],
    initial.state, catalog, referenceActs(message))
  assert.equal(selected.state.serviceId, color.id); assert.equal(selected.state.pending, 'estimate')
  assert.match(selected.reply, /no tengo confirmado.*mechas con gorra/i)
  assert.match(selected.reply, /¿Qué largo tiene tu cabello/)
  assert.equal(selected.state.referral, undefined)
})
await check('uncertain historical or foreign authority cannot choose the related service', async () => {
  const initial = await say('mechas con gorra', [request('mechas con gorra', ['color'])])
  for (const kind of ['uncertain', 'reference', 'inquiry']) {
    const message = 'Iluminación'
    const rejected = await say(message, [{ kind: 'service', mode: 'single', serviceIds: ['color'], correction: false, evidence: message, confidence: 1 }],
      initial.state, catalog, referenceActs(message, kind))
    assert.equal(rejected.state.serviceId, null)
    assert.equal(rejected.state.serviceRequest?.request, 'mechas con gorra')
    assert.doesNotMatch(rejected.reply, /Perfecto, seguimos con Iluminación/)
  }
})

const selectOp = (evidence: string, serviceId = 'color') => ({ kind: 'service_reference', action: 'select', serviceId, evidence, confidence: 1 })
await check('contextual public choice applies the actual anaphoric AI operation', async () => {
  const initial=await say('quería mechas con gorra',[request('mechas con gorra',['color'])])
  const message='Sí a ese servicio'
  const selected=await say(message,[selectOp(message)],initial.state,catalog,referenceActs(message))
  assert.equal(selected.interpretation.mode,'ai');assert.equal(selected.state.serviceId,'color')
  assert.equal(selected.state.pending,'estimate');assert.equal(selected.state.serviceRequest,undefined)
  assert.equal(selected.state.referral,undefined)
  assert.match(selected.reply,/no tengo confirmado.*mechas con gorra/i)
  assert.match(selected.reply,/¿Qué largo tiene tu cabello/)
  assert.doesNotMatch(selected.reply,/¿Querés elegir el servicio publicado|consulto con el equipo/)
})
await check('contextual choice schema keeps consent and catalog strict',()=>{
  const message='Sí, ese servicio'
  assert.equal((parseTurnPlan({version:1,operations:[selectOp(message)]},message,['color']).operations[0] as any).action,'select')
  for(const invalid of [{...selectOp(message),serviceId:'foreign'},{...selectOp(message),action:'reserve'},{...selectOp(message),evidence:'invented'}])
    assert.throws(()=>parseTurnPlan({version:1,operations:[invalid]},message,['color']))
  assert.throws(()=>parseTurnPlan({version:1,operations:[selectOp(message),{kind:'confirm_proposal',evidence:message,confidence:1}]},message,['color']))
})
await check('related candidates always include native options and a final question',async()=>{
  for(const count of [1,2,3,4,10]){
    const services=Array.from({length:count},(_,index)=>({...cut,id:'s'+index,name:'Servicio '+index}))
    const result=await say('busco un tratamiento',[request('tratamiento',services.map(s=>s.id))],{...state,date:null,customerName:null},services)
    assert.equal(result.choicePresentation?.choices.length,count)
    const question=issueChoiceQuestion({businessId:context.businessId,conversationKey:'c',policyKey:'p',policyGeneration:1,revision:'1'},result.state,result.choicePresentation!)
    assert.equal(publicChoiceQuestion(question).mode,count<=3?'buttons':'list')
    const transport=planConversationChoiceView({question,reply:result.reply,transitionId:'t'})
    assert.equal((transport.outboxRows.find(row=>row.item.type==='interactive')!.item as any).mode,count<=3?'buttons':'list')
    assert.equal(transport.choiceRows.length,count)
    assert.ok(result.reply.includes(result.state.questionContext!.question))
    assert.equal((result.reply.match(/\?/g)??[]).length,1)
  }
  const services=[{...cut,name:'Un servicio publicado con nombre largo'}]
  const result=await say('un tratamiento',[request('tratamiento',['cut'])],state,services)
  const q=issueChoiceQuestion({businessId:context.businessId,conversationKey:'c',policyKey:'p',policyGeneration:1,revision:'1'},result.state,result.choicePresentation!)
  assert.equal(publicChoiceQuestion(q).mode,'list')
})
await check('prepared framing retains material next for a procedure without booking fields',async()=>{
  const result=await say('quería mechas con gorra',[request('mechas con gorra',['color'])],{...state,date:null,customerName:null})
  assert.equal(result.interpretation.replyRoute,'first_call');assert.match(result.reply,/Claro, te ayudo/)
  assert.ok(result.reply.includes(result.state.questionContext!.question))
  assert.equal(result.replyFacts?.at(-1)?.id,'next');assert.equal(result.replyFacts?.at(-1)?.text,result.state.questionContext!.question)
})
await check('contextual and clicked candidates preserve selected companions',async()=>{
  for(const representation of ['contextual','literal','request','clicked']){
    const prior=await say('Corte hombre',[{kind:'service',mode:'single',serviceIds:['cut'],correction:false,evidence:'Corte hombre',confidence:1}],{...state,date:null})
    const initial=await say('además quiero mechas con gorra',[request('mechas con gorra',['color'])],prior.state,catalog,referenceActs('además quiero mechas con gorra','request'))
    assert.equal(initial.state.questionContext?.role,'service')
    const message=representation==='contextual'?'Sí a ese servicio':'Iluminación'
    const operation=representation==='contextual'?selectOp(message):representation==='literal'
      ?{kind:'service',mode:'single',serviceIds:['color'],correction:false,evidence:message,confidence:1}
      :request(message,['color'],'booking','clear','exact_public_name')
    const chosen=representation==='clicked'?await respondConversationChoice(context,initial.state,initial.choicePresentation!.choices[0]!.operation,makePort())
      :await say(message,[operation],initial.state,catalog,referenceActs(message))
    assert.deepEqual(chosen.state.basket?.members.flatMap(m=>m.serviceIds),['cut','color'])
    assert.equal(chosen.state.pending,'estimate');assert.equal(chosen.state.serviceRequest,undefined)
    assert.match(chosen.reply,/no tengo confirmado.*mechas con gorra/i)
  }
})
await check('candidate click rejects renamed removed stale or foreign options',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  const choice=initial.choicePresentation!.choices[0]!.operation
  for(const services of [[cut,tint],[cut,{...color,name:'Nombre nuevo'},tint]])
    await assert.rejects(()=>respondConversationChoice(context,initial.state,choice,makePort(services)),/unavailable|disponible/i)
  const stale={...initial.state,questionContext:{...initial.state.questionContext!,question:'¿Qué día preferís?'}}
  await assert.rejects(()=>respondConversationChoice(context,stale,choice,makePort()),/unavailable|disponible/i)
  const scope={businessId:context.businessId,conversationKey:'c',policyKey:'p',policyGeneration:1,revision:'1'}
  const q=issueChoiceQuestion(scope,initial.state,initial.choicePresentation!)
  const action=publicChoiceQuestion(q).choices[0]!.id
  for(const changed of [{...scope,businessId:'foreign'},{...scope,revision:'2'}])
    assert.throws(()=>resolveChoice(q,changed,initial.state,action),/stale/)
})
await check('contextual select requires sole current answer ownership and a fresh booking question',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  for(const kind of ['uncertain','inquiry','reference','request']){
    const message=kind==='uncertain'?'sí pero depende':'Sí a ese servicio'
    assert.equal((await say(message,[selectOp(message)],initial.state,catalog,referenceActs(message,kind))).state.serviceId,null)
  }
  for(const broken of [
    {...initial.state,questionContext:undefined},
    {...initial.state,questionContext:{...initial.state.questionContext!,question:'¿Qué día preferís?'}},
    {...initial.state,serviceRequest:{...initial.state.serviceRequest!,purpose:'inquiry' as const}},
    {...initial.state,questionContext:{...initial.state.questionContext!,options:[{id:'color',label:'Nombre anterior'}]}}
  ]){
    const message='Sí a ese servicio'
    assert.equal((await say(message,[selectOp(message)],broken,catalog,referenceActs(message))).state.serviceId,null)
  }
  const message='Sí a ese servicio'
  const direct=await respond(context,initial.state,message,makePort(),{intent:'booking',serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations:[selectOp(message)]}} as any)
  assert.equal(direct.state.serviceId,null)
  assert.equal((await say(message,[selectOp(message)],initial.state,[cut,{...color,name:'Nombre nuevo'},tint],referenceActs(message))).state.serviceId,null)
})
await check('several-candidate anaphora cannot select by model confidence alone',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['cut','tint','color'])])
  const message='Sí a ese servicio'
  assert.equal((await say(message,[selectOp(message)],initial.state,catalog,referenceActs(message))).state.serviceId,null)
})


await check('already confirmed context still accepts a current published choice without reset',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  const confirmed=await reference('sí me refiero a ese',initial.state)
  assert.equal(confirmed.state.serviceRequest?.referenceConfirmed,true)
  const message='Sí a ese servicio'
  const selected=await say(message,[selectOp(message)],confirmed.state,catalog,referenceActs(message))
  assert.equal(selected.state.serviceId,'color');assert.equal(selected.state.pending,'estimate')
  assert.equal(selected.state.serviceRequest,undefined)
  assert.ok(selected.turnOutcome?.appliedFields.includes('service'))
  assert.match(selected.reply,/no tengo confirmado.*mechas con gorra/i)
  assert.match(selected.reply,/¿Qué largo tiene tu cabello/)
})
await check('contextual choice resolves its pending member and retains an independent selected service',async()=>{
  const prior={...state,basket:{version:1 as const,nextMemberId:3,members:[
    {memberId:'m1',mode:'single' as const,serviceIds:['cut'],evidence:'Corte hombre'},
    {memberId:'m2',mode:'unresolved' as const,serviceIds:[],evidence:'mechas con gorra'}
  ]}}
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])],prior,catalog,referenceActs('mechas con gorra','request'))
  const previous=initial.state
  for(const clicked of [false,true]){
    const message='Sí a ese servicio'
    const selected=clicked?await respondConversationChoice(context,previous,initial.choicePresentation!.choices[0]!.operation,makePort())
      :await say(message,[selectOp(message)],previous,catalog,referenceActs(message))
    assert.deepEqual(selected.state.basket?.members.map(m=>[m.memberId,m.mode,m.serviceIds]),[
      ['m1','single',['cut']],['m3','single',['color']]
    ])
    assert.equal(selected.state.pending,'estimate');assert.equal(selected.state.referral,undefined)
  }
})
await check('inquiry candidate clicks read published information without acquiring the service',async()=>{
  const previous={...state,serviceId:'cut',basket:{version:1 as const,nextMemberId:2,members:[
    {memberId:'m1',mode:'single' as const,serviceIds:['cut'],evidence:'Corte hombre'}
  ]}}
  const initial=await say('hacen mechas con gorra',[request('mechas con gorra',['color'],'inquiry')],previous)
  assert.equal(initial.choicePresentation?.choices.length,1)
  const selected=await respondConversationChoice(context,initial.state,initial.choicePresentation!.choices[0]!.operation,makePort())
  assert.equal(selected.state.serviceId,'cut');assert.deepEqual(selected.state.basket,previous.basket)
  assert.equal(selected.state.date,previous.date);assert.equal(selected.state.customerName,previous.customerName)
  assert.equal(selected.bookingCommand,undefined);assert.equal(selected.handoffCommand,undefined)
  assert.match(selected.reply,/No tengo confirmado.*mechas con gorra/)
})
await check('every candidate disposition delivers exactly its stored final question',async()=>{
  for(const disposition of ['alternatives','needs_detail','unverified_variant']){
    const initial=await say('tratamiento',[request('tratamiento',['color','tint'],'booking',disposition)],{...state,date:null})
    assert.equal((initial.reply.match(/\?/g)??[]).length,1)
    assert.ok(initial.reply.includes(initial.state.questionContext!.question))
    assert.equal(initial.replyFacts?.at(-1)?.text,initial.state.questionContext!.question)
  }
})
await check('negative conditional and low-confidence ownership cannot acquire a candidate',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  for(const message of ['no, ese servicio no','si hacen esa técnica, sí','quizás ese servicio']){
    const selected=await say(message,[selectOp(message)],initial.state,catalog,referenceActs(message,'uncertain'))
    assert.equal(selected.state.serviceId,null);assert.equal(selected.state.serviceRequest?.request,'mechas con gorra')
  }
  const message='Sí a ese servicio'
  const selected=await say(message,[{...selectOp(message),confidence:.84}],initial.state,catalog,referenceActs(message))
  assert.equal(selected.state.serviceId,null)
  const noOwner=await say(message,[selectOp(message)],initial.state)
  assert.equal(noOwner.state.serviceId,null)
})



await check('copied candidate question from another basket cannot select or click',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  const changed={...initial.state,basket:{version:1 as const,nextMemberId:3,members:[
    {memberId:'m1',mode:'single' as const,serviceIds:['cut'],evidence:'Corte hombre'},
    {memberId:'m2',mode:'single' as const,serviceIds:['tint'],evidence:'Coloración'}
  ]}}
  const message='Sí a ese servicio'
  const selected=await say(message,[selectOp(message)],changed,catalog,referenceActs(message))
  assert.deepEqual(selected.state.basket,changed.basket)
  assert.equal(selected.state.serviceRequest?.referenceConfirmed,undefined)
  await assert.rejects(()=>respondConversationChoice(context,changed,initial.choicePresentation!.choices[0]!.operation,makePort()),/no longer available/)
})
await check('new candidate clarification suspends an old proposal and remains a valid draft for a click',async()=>{
  const sandbox={...context,sandboxBooking:true}
  const port={...makePort(),availability:async()=>({
    professionals:[{id:'ana',name:'Ana',priority:0}],
    slots:[{date:'2026-10-08',time:'17:00',startAt:'2026-10-08T17:00:00.000Z',
      professionalId:'ana',professionalName:'Ana',band:'AFTERNOON' as const,occupiedMinutes:0}]
  })}
  const shown=await respond(sandbox,state,'Corte hombre con cualquiera a las 17',port,{
    serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations:[
      {kind:'service',mode:'single',serviceIds:['cut'],correction:false,evidence:'Corte hombre',confidence:1},
      {kind:'professional',mode:'any',evidence:'cualquiera',confidence:1},
      {kind:'time',value:'17:00',evidence:'17',confidence:1}
    ]}
  })
  assert.ok(shown.state.sandboxReservation);assert.equal(shown.state.pending,'proposal')
  const evidence='además quiero mechas con gorra'
  const provider=(async()=>({...base,communicativeActs:referenceActs(evidence,'request'),
    turnPlan:{version:1,operations:[request('mechas con gorra',['color'])]}})) as AiInterpretationProvider
  const clarified=await respondWithAiInterpreter(sandbox,shown.state,evidence,port,provider)
  assert.equal(clarified.state.pending,'service')
  assert.equal(clarified.state.sandboxReservation,undefined)
  assert.deepEqual(parseDialogueState(clarified.state,context.businessId),clarified.state)
  await assert.rejects(()=>respondConversationChoice(sandbox,clarified.state,{
    kind:'confirm',nonce:shown.state.sandboxReservation!.presented.nonce
  },port),/no longer available/)
  const selected=await respondConversationChoice(sandbox,clarified.state,clarified.choicePresentation!.choices[0]!.operation,port)
  assert.deepEqual(selected.state.basket?.members.flatMap(member=>member.serviceIds),['cut','color'])
  assert.equal(selected.state.pending,'estimate');assert.equal(selected.state.sandboxReservation,undefined)
  assert.deepEqual(parseDialogueState(selected.state,context.businessId),selected.state)
})

await check('current published selection has one acknowledgment, with technique caveat intact',async()=>{
  const initial=await say('mechas con gorra',[request('mechas con gorra',['color'])])
  const message='Sí a ese servicio'
  const provider:AiInterpretationProvider=async()=>({...base,communicativeActs:referenceActs(message),turnPlan:{version:1,operations:[selectOp(message)]},firstReply:{salutation:null,opening:'Perfecto, te ayudo con eso.',factIds:null,closing:null}})
  const selected=await respondWithAiInterpreter(context,initial.state,message,makePort(),provider)
  assert.equal((selected.reply.match(/Perfecto/g)??[]).length,1,'one server-owned selection acknowledgment, not two conversational openings')
  assert.match(selected.reply,/Iluminación/);assert.match(selected.reply,/No tengo confirmado.*mechas con gorra/)
  assert.equal(selected.state.pending,'estimate');assert.equal(selected.bookingCommand,undefined)
})
// P18: controlled semantic proposals test the motor, not live model understanding.
for (const representation of ['literal', 'clicked']) await check('P18 category choice resolves without an undocumented-technique warning: ' + representation, async () => {
  const woman = { ...cut, id: 'woman', name: 'Corte mujer' }
  const services = [cut, woman]
  const initial = await say('quiero corte', [request('corte', ['cut', 'woman'], 'booking', 'alternatives')],
    initialDialogueState(context.businessId), services)
  const selected = representation === 'clicked'
    ? await respondConversationChoice(context, initial.state, initial.choicePresentation!.choices[0]!.operation, makePort(services))
    : await say('Corte hombre', [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false,
      evidence: 'Corte hombre', confidence: 1 }], initial.state, services, referenceActs('Corte hombre'))
  assert.equal(selected.state.serviceId, 'cut')
  assert.equal(selected.state.serviceRequest, undefined)
  assert.doesNotMatch(selected.reply, /No tengo confirmado|incluye.*corte|En qué.*ayudar/i)
  assert.equal(selected.proposal, null)
  assert.equal(selected.bookingCommand, undefined)
  assert.equal((selected.reply.match(/Perfecto/g) ?? []).length, 1, 'one owner acknowledges the applied choice')
  assert.ok(selected.replyFacts?.every(fact => fact.text.trim().length > 0) ?? true, 'prepared category facts cannot contain an empty acknowledgment')
})
await check('P18 extracted subject cannot silently discard a requested technique qualifier', async () => {
  const evidence = 'mechas con gorra'
  const result = await say('quiero ' + evidence, [{ ...request(evidence, ['color'], 'booking', 'clear'),
    subject: 'mechas', aspect: null }], initialDialogueState(context.businessId))
  assert.equal(result.state.serviceId, null)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
  assert.doesNotMatch(result.reply, /hacemos.*mechas|incluye.*mechas|seguimos con Iluminación/i)
  if (result.state.serviceRequest) assert.match(result.state.serviceRequest.request, /con gorra/)
})
await check('P18 a shortened category subject cannot erase the requested French-cut qualifier', async () => {
  const result = await say('quiero corte francés', [{ ...request('corte francés', ['cut'], 'booking', 'clear', 'semantic_equivalent'),
    subject: 'corte', aspect: null }], initialDialogueState(context.businessId))
  assert.equal(result.state.serviceId, null)
  assert.equal(result.state.basket, undefined)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
  assert.doesNotMatch(result.reply, /hacemos.*corte francés|seguimos con Corte hombre/i)
  if (result.state.serviceRequest) assert.match(result.state.serviceRequest.request, /corte francés/)
})
await check('P18 request schema admits a grounded object and aspect but rejects fabricated objects', () => {
  const message = 'Quería saber cuánto salía hacerme un balayage'
  const operation = { ...request('cuánto salía hacerme un balayage', ['color'], 'inquiry'), subject: 'balayage', aspect: 'price' }
  const parsed = parseTurnPlan({ version: 1, operations: [operation] }, message, catalog.map(service => service.id))
  assert.equal((parsed.operations[0] as any).subject, 'balayage')
  assert.equal((parsed.operations[0] as any).aspect, 'price')
  for (const invalid of [{ ...operation, subject: 'balayage inventado' }, { ...operation, aspect: 'invented' }])
    assert.throws(() => parseTurnPlan({ version: 1, operations: [invalid] }, message, catalog.map(service => service.id)))
})
await check('P18 courtesy and concrete inquiry replace generic help with the grounded question', async () => {
  const message = 'Cómo va? Quería averiguar para hacerme un balayage'
  const operation = request('balayage', ['color'], 'inquiry')
  let providerCalls = 0
  const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), message, makePort(), async () => {
    providerCalls++
    return { ...base, intent: 'information', turnPlan: { version: 1, operations: [operation] },
      communicativeActs: { version: 1, acts: [
        { kind: 'social', field: 'general', evidence: 'Cómo va', confidence: 1, mention: null, operationIndexes: [] },
        { kind: 'inquiry', field: 'service', evidence: 'Quería averiguar para hacerme un balayage', confidence: 1,
          mention: 'balayage', operationIndexes: [0] }
      ] }, firstReply: { salutation: null, opening: 'Bien, gracias. Te ayudo con esa consulta.', factIds: null, closing: null } }
  })
  assert.equal(providerCalls, 1)
  assert.equal(result.interpretation.mode, 'ai')
  assert.match(result.reply, /Bien, gracias/)
  assert.match(result.reply, /balayage/)
  assert.match(result.reply, /Iluminación/)
  assert.doesNotMatch(result.reply, /En qué.*ayudar|Qué servicio necesitás/i)
  assert.equal((result.reply.match(/Te ayudo/g) ?? []).length, 1)
  assert.equal(result.state.serviceId, null)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
})
assert.equal(agenda, 0, 'clarification and budget steps never query agenda or reserve')
console.log('catalog comparison: ' + passed + ' PASS / ' + failed + ' FAIL (simulated semantics, 0 HTTP)')
if (failed) process.exitCode = 1
