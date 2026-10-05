import assert from 'node:assert/strict'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { replyContract, validateReplyDraft, REPLY_CONTRACT_INSTRUCTIONS } from '../src/conversational-bot/reply-contract.js'

const context = { businessId: 'writing', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const state = initialDialogueState(context.businessId)
const base = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null }
const facts = [{ id: 'next', text: '¿En qué te puedo ayudar con el local?' }]
const contract = replyContract('social', true, false, facts)
const requests: { instructions: string; input: string; store: boolean }[] = []
const fetchImpl: typeof fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(base) }] }] }), { status: 200 })
}
await createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl })({ message: 'hola, cómo están, quería un turno', state, services: [], firstReplyFacts: facts, replyContract: contract }, new AbortController().signal)
await createOpenAiResponseProvider({ apiKey: 'fake-only', fetchImpl })({ message: 'hola', state, intent: 'other', facts, replyContract: contract }, new AbortController().signal)
// Captured draft structure: the live model put an elongated greeting in both parts.
const capturedGreeting = { salutation: 'greeting', opening: '¡Holaa!', factIds: ['next'], closing: null, variantChoices: null }
const rejectedGreeting = validateReplyDraft(capturedGreeting, facts, contract, [])
assert.equal(rejectedGreeting.validation.reason, 'identity_in_frame')
assert.equal(rejectedGreeting.text, null); assert.equal(rejectedGreeting.openingText, undefined)
for (const opening of ['¡Holaa!', '¡HOLAAA!', 'Hoooolaaa, gracias.', 'Buenas.', 'Bueeenas, gracias.', 'Buen día.', 'Buenos días.', 'Buenas tardes.', 'Buenas noches.', 'Bien, gracias. ¡Holaa!']) {
  for (const introduction of ['pending', 'complete', 'none']) {
    const policy = replyContract('social', introduction !== 'none', introduction === 'complete', facts)
    assert.equal(validateReplyDraft({ ...capturedGreeting, opening }, facts, policy, []).validation.reason, 'identity_in_frame', opening + '/' + introduction)
    assert.equal(validateReplyDraft({ opening, factIds: ['next'], closing: null }, facts, contract, []).validation.reason, 'identity_in_frame', 'legacy initial/' + opening)
  }
}
for (const opening of ['Bien, gracias por preguntar.', 'Gracias por tus buenas palabras.', 'Buenas palabras, gracias por tu cortesía.', 'Buenas ideas para seguir charlando.', 'Todo bien por acá; gracias por la cortesía.']) {
  assert.equal(validateReplyDraft({ ...capturedGreeting, opening }, facts, contract, []).validation.status, 'accepted')
}
// A typed greeting is not free identity text and must not discard a safe social response.
const greetingDraft = { salutation: 'greeting', opening: 'Bien, gracias por preguntar.', factIds: ['next'], closing: null }
assert.equal(validateReplyDraft(greetingDraft, facts, contract, []).validation.status, 'accepted')
assert.equal(validateReplyDraft(greetingDraft, facts, contract, []).text, 'Bien, gracias por preguntar.\n¿En qué te puedo ayudar con el local?')
assert.match(validateReplyDraft(greetingDraft, facts, replyContract('social', true, true, facts), []).text!, /^¡Hola!\nBien, gracias/)
for (const salutation of ['Soy Otra', true, {}, undefined]) assert.equal(validateReplyDraft({ ...greetingDraft, salutation }, facts, contract, []).validation.reason, 'invalid_shape')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Soy Otra' }, facts, contract, []).validation.reason, 'identity_in_frame')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Soy Otra' }, facts, replyContract('social', false, false, facts), []).validation.reason, 'identity_in_frame')
assert.equal(validateReplyDraft({ ...greetingDraft, opening: 'Reservado' }, facts, contract, []).validation.reason, 'unverified_action')
for (const request of requests) {
  assert.ok(request.instructions.includes(REPLY_CONTRACT_INSTRUCTIONS))
  assert.match(request.instructions, /Presentación del servidor:/)
  assert.match(request.instructions, /Respuesta social y reconocimiento:/)
  assert.match(request.instructions, /pregunta explícita de cortesía[^.]*respuesta social/i)
  assert.match(request.instructions, /saludo no sustituye[^.]*respuesta/i)
  assert.match(request.instructions, /Cuerpo material:/)
  assert.match(request.instructions, /Continuación pertinente:/)
  assert.deepEqual(JSON.parse(request.input).replyContract, contract)
  assert.equal(request.store, false)
}
assert.match(requests[0]!.instructions, /Primera llamada, cualquier intención:/)
assert.match(requests[0]!.instructions, /booking con operations vacío/)
assert.match(requests[0]!.instructions, /factIds originales/)
assert.match(requests[0]!.instructions, /no es necesario predecir la nueva pregunta/)

// These fixtures verify delivery and safety, not the real model's language quality.
let agenda = 0, catalogReads = 0
const port: DialoguePort = {
  catalog: async () => { catalogReads++; return [{ id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false }] },
  identity: async () => ({ businessId: context.businessId, assistantName: 'Ada', businessName: 'Local', treatment: 'vos' }),
  availability: async () => { agenda++; throw new Error('agenda forbidden for acquisition') }
}
for (const shape of ['empty', 'null', 'absent']) for (const introduced of [false, true]) {
  let calls = 0
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++
    assert.equal(input.replyContract?.introduction, introduced ? 'server_complete' : 'server_pending')
    return { ...base, ...(shape === 'empty' ? { turnPlan: { version: 1, operations: [] } } : shape === 'null' ? { turnPlan: null } : {}),
      firstReply: { salutation: 'greeting', opening: 'Bien, gracias por preguntar. Te ayudo a buscar un turno.', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  }, { respond: async () => { calls++; throw new Error('a style call is forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, { ...state, introduced }, 'hola, cómo están, quería un turno', port, provider)
  assert.equal(calls, 1); assert.equal(result.interpretation.aiCalls, 1)
  assert.match(result.reply, /Bien, gracias por preguntar/); assert.match(result.reply, /¿Qué servicio necesitás\?/)
  assert.equal(result.reply.match(/Soy Ada, de Local/g)?.length ?? 0, introduced ? 0 : 1)
  assert.equal(result.reply.match(/hol+a/gi)?.length, 1)
  assert.doesNotMatch(result.reply, /No pude identificar|En qué.*ayudar/)
  assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.state.sandboxReservation, undefined)
}
assert.equal(agenda, 0); assert.equal(catalogReads, 6)
const original = { opening: 'Bien, gracias por preguntar.', closing: null, factIds: ['data', 'next'] }
const verified = [{ id: 'data', text: 'Dato verificado.' }, { id: 'next', text: '¿Qué día?' }]
const guard = replyContract('continuation', true, false, verified)
for (const [draft, reason] of [
  [{ ...original, opening: 'Soy Otra' }, 'identity_in_frame'],
  [{ ...original, opening: 'Hola, bien, gracias.' }, 'identity_in_frame'],
  [{ ...original, opening: 'Reservado' }, 'unverified_action'],
  [{ ...original, opening: 'Cuesta $100' }, 'unverified_value'],
  [{ ...original, opening: 'Corte' }, 'catalog_in_frame'],
  [{ ...original, factIds: ['next', 'data'] }, 'fact_order'],
  [{ ...original, factIds: ['foreign', 'next'] }, 'fact_membership'],
  [{ ...original, closing: '¿Confirmamos?' }, 'continuation_conflict']
] as const) assert.equal(validateReplyDraft(draft, verified, guard, ['Corte']).validation.reason, reason)
assert.equal(validateReplyDraft(original, verified, guard, ['Corte']).validation.status, 'accepted')
for (const scenario of ['pure-social', 'lateral-information', 'unsafe-identity']) {
  let calls = 0
  const introduced = scenario === 'lateral-information'
  const previous = introduced ? { ...state, introduced: true, serviceId: 'cut', date: '2026-10-04', customerName: 'Ana', pending: 'date' as const } : state
  const message = scenario === 'lateral-information' ? 'hola, cómo están, qué horarios tienen' : 'hola, cómo están'
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++
    return { ...base, intent: scenario === 'lateral-information' ? 'information' : 'other',
      turnPlan: { version: 1, operations: scenario === 'lateral-information' ? [
        { kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, evidence: 'horarios', confidence: 1 }
      ] : [] }, firstReply: { salutation: 'greeting', opening: scenario === 'unsafe-identity' ? 'Soy Otra, bien, gracias.' : 'Bien, gracias por preguntar.',
        closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  }, { respond: async () => { calls++; throw new Error('style call forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, previous, message, { ...port, information: async () => ({
    businessId: context.businessId, name: 'Local', address: null, area: null, mapsUrl: null, hours: 'Lunes: 09:00 a 18:00', website: null,
    bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null
  }) }, provider)
  assert.equal(calls, 1); assert.equal(result.reply.match(/hol+a/gi)?.length, 1)
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
  if (scenario === 'unsafe-identity') {
    assert.equal(result.interpretation.replyValidation?.firstCall.reason, 'identity_in_frame')
    assert.doesNotMatch(result.reply, /Otra|bien, gracias/)
  } else assert.match(result.reply, /Bien, gracias por preguntar/)
  if (introduced) {
    assert.doesNotMatch(result.reply, /Soy Ada/); assert.match(result.reply, /Lunes: 09:00 a 18:00/)
    assert.equal(result.state.serviceId, previous.serviceId); assert.equal(result.state.date, previous.date)
    assert.equal(result.state.customerName, previous.customerName)
  }
}
let capturedCalls = 0
const capturedProvider = Object.assign(async () => { capturedCalls++; return { ...base, intent: 'other', turnPlan: { version: 1, operations: [] }, firstReply: capturedGreeting } },
  { respond: async () => { capturedCalls++; throw new Error('no style retry after rejected framing') } }) as AiInterpretationProvider
const capturedResult = await respondWithAiInterpreter(context, state, 'holaa como están?', port, capturedProvider)
assert.equal(capturedCalls, 1); assert.equal(capturedResult.interpretation.aiCalls, 1)
assert.equal(capturedResult.interpretation.replyValidation?.firstCall.reason, 'identity_in_frame')
assert.equal(capturedResult.reply.match(/hol+a+/gi)?.length, 1)
assert.equal(capturedResult.state.serviceId, null); assert.equal(capturedResult.proposal, null)
assert.equal(capturedResult.bookingCommand, undefined); assert.equal(agenda, 0)

// Controlled regressions from the partial-acquisition capture, not new model comprehension.
let boundaryFailures=0
for(const introduced of [false,true])for(const withTime of [false,true]) {
  let partialCalls=0
  const partialProvider=Object.assign(async(input:AiInterpretationInput)=>{
    partialCalls++
    return {...base,turnPlan:{version:1,operations:[
      {kind:'date',expression:'mañana',value:'2026-10-04',evidence:'mañana',confidence:1},
      ...(withTime?[{kind:'time',value:'15:00',evidence:'15hs',confidence:1}]:[])]},
      firstReply:{salutation:introduced?null:'greeting',opening:'Bien, gracias por preguntar.',
        factIds:input.firstReplyFacts!.map(f=>f.id),closing:null}}
  },{respond:async()=>{partialCalls++;throw new Error('No aesthetic response call')}}) as AiInterpretationProvider
  const partialMessage=withTime?'quiero un turno mañana a las 15hs':'quiero un turno mañana'
  const partial=await respondWithAiInterpreter(context,{...state,introduced},partialMessage,port,partialProvider)
  try {
    assert.equal(partialCalls,1);assert.equal(partial.interpretation.aiCalls,1)
    assert.equal(partial.state.date,'2026-10-04');assert.equal(partial.state.serviceId,null)
    assert.equal(partial.state.requestedTime,withTime?'15:00':null)
    assert.match(partial.reply,/Bien, gracias por preguntar/);assert.match(partial.reply,/¿Qué servicio necesitás/)
    assert.equal(partial.interpretation.copyMode,'ai');assert.equal(partial.proposal,null)
  }catch(error){boundaryFailures++;console.error('FAIL partial acquisition '+introduced+'/'+withTime+': '+String(error))}
}
// Unsafe framing must remain canonical, not trigger a replacement style request.
for(const opening of ['Soy Otra','Cuesta $100','Corte']) {
  let unsafeCalls=0
  const unsafeProvider=Object.assign(async(input:AiInterpretationInput)=>{
    unsafeCalls++
    return {...base,turnPlan:{version:1,operations:[{kind:'date',expression:'mañana',
      value:'2026-10-04',evidence:'mañana',confidence:1}]},
      firstReply:{salutation:null,opening,factIds:input.firstReplyFacts!.map(f=>f.id),closing:null}}
  },{respond:async()=>{unsafeCalls++;throw new Error('No replacement style call')}}) as AiInterpretationProvider
  const unsafe=await respondWithAiInterpreter(context,state,'quiero un turno mañana',port,unsafeProvider)
  assert.equal(unsafeCalls,1);assert.equal(unsafe.state.date,'2026-10-04')
  assert(unsafe.interpretation.replyValidation)
  assert.equal(unsafe.interpretation.replyValidation.firstCall.status,'rejected')
  assert.equal(unsafe.interpretation.copyMode,'fallback');assert.match(unsafe.reply,/¿Qué servicio necesitás/)
  assert.equal(unsafe.bookingCommand,undefined);assert.equal(unsafe.proposal,null)
}
// A public professional request is an independent hint while service is still missing.
let professionalCalls=0
const professionalProvider=Object.assign(async(input:AiInterpretationInput)=>{
  professionalCalls++
  return {...base,turnPlan:{version:1,operations:[
    {kind:'date',expression:'mañana',value:'2026-10-04',evidence:'mañana',confidence:1},
    {kind:'professional',mode:'specific',mention:'Rama',evidence:'con Rama',confidence:1}]},
    communicativeActs:{version:1,acts:[
      {kind:'request',field:'date',evidence:'mañana',confidence:1,mention:null,operationIndexes:[0]},
      {kind:'request',field:'professional',evidence:'con Rama',confidence:1,mention:'Rama',operationIndexes:[1]}]},
    firstReply:{salutation:null,opening:'Te ayudo a buscarlo.',factIds:input.firstReplyFacts!.map(f=>f.id),closing:null}}
},{respond:async()=>{professionalCalls++;throw new Error('No aesthetic response call')}}) as AiInterpretationProvider
const professional=await respondWithAiInterpreter(context,{...state,introduced:true},'un turno con Rama mañana',port,professionalProvider)
assert.equal(professionalCalls,1);assert.equal(professional.state.professionalNameHint,'rama')
assert.equal(professional.state.date,'2026-10-04');assert.equal(professional.state.serviceId,null)
assert.equal(professional.interpretation.copyMode,'ai')
try {
  assert.match(requests[0]!.instructions,/Interpretación de entidades y contexto:/)
  assert.match(requests[0]!.instructions,/Evidencia literal mínima:/)
}catch(error){boundaryFailures++;console.error('FAIL modular entity guide: '+String(error))}
assert.equal(agenda,0)
assert.equal(boundaryFailures,0,'partial acquisition and modular guidance regressions')

// The captured numeric framing stays unsafe; a qualitative frame retains both entities.
const capturedOpening='¡Bien, gracias! Entiendo que estás buscando un turno para mañana, viernes, alrededor de las 18.'
assert.equal(validateReplyDraft({salutation:'greeting',opening:capturedOpening,factIds:['next'],closing:null},facts,contract,[]).validation.reason,'unverified_value')
assert.ok(REPLY_CONTRACT_INSTRUCTIONS.includes('Reconocimiento cualitativo:'),'shared briefing must separate acknowledgment from requested values')
let suffixCalls=0
const suffixProvider=Object.assign(async(input:AiInterpretationInput)=>{
  suffixCalls++
  return {...base,turnPlan:{version:1,operations:[
    {kind:'date',expression:'mañana viernes',value:'2026-08-28',evidence:'mañana viernes',confidence:.99},
    {kind:'time_preference',preference:{kind:'around',time:'18:00'},evidence:'a las 18 aprox',confidence:.99}]},
    firstReply:{salutation:'greeting',opening:'Bien, gracias por preguntar. Te ayudo con el turno.',factIds:input.firstReplyFacts!.map(f=>f.id),closing:null}}
},{respond:async()=>{suffixCalls++;throw new Error('No aesthetic response request')}}) as AiInterpretationProvider
const suffix=await respondWithAiInterpreter({...context,dbNow:new Date('2026-08-27T18:24:01.258Z')},state,
  'Buenas! Como va? Tendran turno para mañana viernes, a las 18 aprox?',port,suffixProvider)
assert.equal(suffix.interpretation.mode,'ai');assert.deepEqual(suffix.state.timePreference,{kind:'around',time:'18:00'})
assert.equal(suffix.state.date,'2026-08-28');assert.equal(suffixCalls,1);assert.equal(suffix.state.requestedTime,null)
assert.equal(suffix.proposal,null);assert.equal(suffix.bookingCommand,undefined)
assert.match(suffix.reply,/Bien, gracias por preguntar/);assert.match(suffix.reply,/¿Qué servicio necesitás/)

for (const kind of ['notice', 'pause', 'repair']) {
  assert.ok(requests[0]!.instructions.includes(kind), 'same interpretation request teaches nonoperative act ' + kind)
}
for (const [kind, message] of [['notice', 'Estoy llegando'], ['pause', 'Después sigo'], ['repair', 'No entendí la pregunta']] as const) {
  let calls = 0
  const provider = Object.assign(async () => {
    calls++
    return { ...base, intent: 'other', turnPlan: { version: 1, operations: [] },
      communicativeActs: { version: 1, acts: [{ kind, field: 'general', evidence: message, confidence: 1, mention: null, operationIndexes: [] }] },
      firstReply: null, intakeReply: null }
  }, { respond: async () => { calls++; throw new Error('nonoperative act needs no extra classifier or style request') } }) as AiInterpretationProvider
  const previous = { ...state, introduced: true }
  const result = await respondWithAiInterpreter(context, previous, message, port, provider)
  assert.equal(result.interpretation.mode, 'ai')
  assert.equal(calls, 1)
  assert.equal(result.interpretation.aiCalls, 1)
  assert.deepEqual(result.state, previous)
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined)
}
// The actual captured gratitude keeps its recognition with one server-owned question.
let gratitudeCalls = 0
const gratitudeProvider = Object.assign(async (input: AiInterpretationInput) => {
  gratitudeCalls++
  return { ...base, intent: 'other', turnPlan: { version: 1, operations: [] }, firstReply: {
    salutation: null, opening: '¡De nada! ' + input.firstReplyFacts!.find(fact => fact.id === 'next')!.text,
    factIds: input.firstReplyFacts!.map(fact => fact.id), closing: null, variantChoices: null
  } }
}, { respond: async () => { gratitudeCalls++; throw new Error('No aesthetic gratitude call') } }) as AiInterpretationProvider
const gratitude = await respondWithAiInterpreter(context, { ...state, introduced: true }, 'Gracias!', port, gratitudeProvider)
assert.equal(gratitudeCalls, 1); assert.equal(gratitude.interpretation.aiCalls, 1)
assert.match(gratitude.reply, /¡De nada!/)
assert.equal((gratitude.reply.match(/¿/g) ?? []).length, 1, 'known server continuation appears exactly once')
assert.equal(gratitude.interpretation.replyValidation?.firstCall.status, 'accepted')
assert.equal(gratitude.state.serviceId, null); assert.equal(gratitude.proposal, null); assert.equal(gratitude.bookingCommand, undefined)
let noticeCalls = 0
const noticeMessage = 'Ya llegué al local.'
const noticeProvider = Object.assign(async (input: AiInterpretationInput) => {
  noticeCalls++
  return { ...base, intent: 'other', turnPlan: { version: 1, operations: [] },
    communicativeActs: { version: 1, acts: [{ kind: 'notice', field: 'general', evidence: noticeMessage,
      confidence: 1, mention: null, operationIndexes: [] }] }, firstReply: {
      salutation: null, opening: '¡Gracias por avisar!', factIds: input.firstReplyFacts!.map(fact => fact.id),
      closing: null, variantChoices: null
    } }
}, { respond: async () => { noticeCalls++; throw new Error('No aesthetic notice call') } }) as AiInterpretationProvider
const notice = await respondWithAiInterpreter(context, { ...state, introduced: true }, noticeMessage, port, noticeProvider)
assert.equal(noticeCalls, 1); assert.equal(notice.interpretation.aiCalls, 1)
assert.equal((notice.reply.match(/Gracias por avisar/g) ?? []).length, 1, 'captured notice acknowledgment appears exactly once')
assert.equal(notice.state.serviceId, null); assert.equal(notice.proposal, null); assert.equal(notice.bookingCommand, undefined)
console.log('first-call writing guide: PASS (contract and offline delivery; model quality not evaluated)')
