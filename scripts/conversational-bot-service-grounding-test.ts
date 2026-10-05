import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'

const context = { businessId: 'grounding-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-04T12:00:00Z') }
const cut: DialogueService = { id: 'cut', name: 'Corte hombre', aliases: ['Corte masculino'], durationMinutes: 30, requiresConsultation: false, price: 100 }
const smooth: DialogueService = { id: 'smooth', name: 'Alisado', durationMinutes: 90, requiresConsultation: false, price: 200 }
const lights: DialogueService = { id: 'lights', name: 'Iluminación', description: 'Mechas y balayage', durationMinutes: 60, requiresConsultation: true, price: 500 }
let services = [cut, smooth, lights]
let agendaCalls = 0
const port: DialoguePort = { catalog: async () => services, availability: async () => { agendaCalls++; return { professionals: [], slots: [] } } }
const initial = () => initialDialogueState(context.businessId)
const ev = (evidence: string, confidence = 1) => ({ evidence, confidence })
const single = (id: string, evidence: string, confidence = 1, correction = false) => ({ kind: 'service', mode: 'single', serviceIds: [id], correction, ...ev(evidence, confidence) })
const basket = (...members: object[]) => ({ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members, ...ev('cortee hombre y Alisado') })
const request = (evidence: string, purpose = 'inquiry', disposition = 'clear', basis = 'semantic_equivalent', serviceIds = ['lights'], sourceQuote: string | null = null, continuation = false) => ({ kind: 'service_request', purpose, disposition, basis, serviceIds, sourceQuote, correction: false, continuation, ...ev(evidence) })
const say = (state: DialogueState, message: string, ...operations: object[]) => respondWithAiInterpreter(context, state, message, port, async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations } }))
const legacy = (message: string, evidence: string, id = 'lights', certain = true) => respondWithAiInterpreter(context, initial(), message, port, async () => ({ intent: 'booking', serviceId: id, serviceEvidence: evidence, professionalMention: null, serviceConfidence: certain ? 'certain' : 'uncertain' }))
const noEffect = (result: Awaited<ReturnType<typeof say>>, before: number) => { assert.equal(agendaCalls, before); assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.state.sandboxReservation, undefined) }
let failures = 0
async function check(name: string, test: () => Promise<void>) {
  services = [cut, smooth, lights]
  try { await test(); console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error))) }
}
await check('captured exact standalone service is not widened to a composite catalog neighbor', async () => {
  services=[{...cut,id:'beard',name:'Barba',aliases:[]},{...cut,id:'combo',name:'Corte y barba',aliases:[]}]
  const before=agendaCalls
  const result=await say({...initial(),serviceId:'combo',pending:'date'},'Es solo barba',
    {kind:'basket',mutation:'set',scope:'all',targetMemberIds:[],members:[
      {mode:'single',serviceIds:['beard'],...ev('barba',.99)}],...ev('Es solo barba',.99)})
  assert.equal(result.state.serviceId,'beard')
  assert.deepEqual(result.state.basket?.members.map(m=>m.serviceIds),[['beard']])
  noEffect(result,before)
})
await check('bounded full-label typo agrees with validated AI identity and retains original evidence', async () => {
  const result = await say(initial(), 'cortee hombre', single('cut', 'cortee hombre'))
  assert.equal(result.state.serviceId, 'cut')
  assert.equal(selectionBasket(result.state).members[0]?.evidence, 'cortee hombre')
  assert.equal(result.interpretation.reason, null)
  assert.equal(result.state.pending, 'date')
})
await check('typed typo basket preserves companion date name and original member evidence', async () => {
  const result = await say(initial(), 'cortee hombre y Alisado mañana soy Matías', basket(
    { mode: 'single', serviceIds: ['cut'], ...ev('cortee hombre') }, { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }),
    { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
  assert.deepEqual(selectionBasket(result.state).members.map(member => member.serviceIds), [['cut'], ['smooth']])
  assert.equal(result.state.basket?.members[0]?.evidence, 'cortee hombre')
  assert.equal(result.state.date, '2026-10-05'); assert.equal(result.state.customerName, 'Matías')
})
await check('generic category includes all fresh matches and never swallows companion', async () => {
  services = [cut, { ...cut, id: 'woman', name: 'Corte mujer', aliases: [] }, { ...cut, id: 'beard', name: 'Corte y barba', aliases: [] }, smooth]
  const result = await say(initial(), 'un corte y Alisado mañana soy Matías', { ...basket(
    { mode: 'single', serviceIds: ['cut'], ...ev('un corte') }, { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }), evidence: 'un corte y Alisado' },
    { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
  assert.deepEqual(result.state.basket?.members[0]?.serviceIds, ['cut', 'woman', 'beard'])
  assert.equal(result.state.basket?.members[1]?.serviceIds[0], 'smooth')
  assert.match(result.reply, /Corte hombre/); assert.match(result.reply, /Corte mujer/); assert.match(result.reply, /Corte y barba/)
  assert.equal(result.state.date, '2026-10-05'); assert.equal(result.state.customerName, 'Matías')
})
await check('aliases are fresh public data, not enduring private synonyms', async () => {
  const accepted = await say(initial(), 'Corte masculino', single('cut', 'Corte masculino'))
  assert.equal(accepted.state.serviceId, 'cut')
  services = [{ ...cut, aliases: [] }, smooth, lights]
  const removed = await say(initial(), 'Corte masculino', single('cut', 'Corte masculino'))
  assert.equal(removed.state.serviceId, null)
  assert.match(removed.reply, /Corte hombre/); assert.match(removed.reply, /referís|continuar/)
})
await check('presented short answer binds target member and expires renamed labels', async () => {
  services = [cut, { ...cut, id: 'woman', name: 'Corte mujer', aliases: [] }, smooth]
  const alternatives = await say(initial(), 'un corte y Alisado', { ...basket(
    { mode: 'alternatives', serviceIds: ['cut', 'woman'], ...ev('un corte') }, { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }), evidence: 'un corte y Alisado' })
  const answered = await say(alternatives.state, 'hombre', single('cut', 'hombre'))
  assert.deepEqual(answered.state.basket?.members.flatMap(member => member.serviceIds), ['cut', 'smooth'])
  services = [{ ...cut, name: 'Tratamiento nuevo', aliases: [] }, { ...cut, id: 'woman', name: 'Corte mujer', aliases: [] }, smooth]
  const stale = await say(alternatives.state, 'hombre', single('cut', 'hombre'))
  assert.equal(stale.state.serviceId, null)
  assert.equal(stale.state.basket?.members.some(member => member.mode === 'single' && member.serviceIds.includes('cut')), false)
})
await check('undocumented paraphrase becomes concrete identity question, not invalid output', async () => {
  const before = agendaCalls
  const result = await say(initial(), 'quiero cortarme el pelo', single('cut', 'cortarme el pelo'))
  assert.equal(result.state.serviceId, null); assert.equal(result.interpretation.reason, null)
  assert.match(result.reply, /cortarme el pelo/); assert.match(result.reply, /Corte hombre/); assert.match(result.reply, /referís|continuar/)
  noEffect(result, before)
})
await check('published claritos resolves; unpublished asks exact identity without claiming procedure or policy', async () => {
  services = [cut, smooth, { ...lights, aliases: ['claritos'], requiresConsultation: false }]
  const published = await legacy('quiero claritos', 'claritos')
  assert.equal(published.state.serviceId, 'lights')
  services = [cut, smooth, lights]
  const before = agendaCalls
  const unpublished = await say(initial(), '¿Hacen claritos?', request('claritos'))
  assert.equal(unpublished.state.serviceId, null); assert.equal(unpublished.interpretation.reason, null)
  assert.match(unpublished.reply, /claritos/); assert.match(unpublished.reply, /Iluminación/); assert.match(unpublished.reply, /no tengo información confirmada/i)
  assert.doesNotMatch(unpublished.reply, /foto|requiere consulta|deriv|lo hacemos|ofrecemos claritos/i)
  assert.equal(unpublished.state.referral, undefined); noEffect(unpublished, before)
  const confirmed = await say(unpublished.state, 'sí', request('sí', 'booking', 'clear', 'exact_public_name', ['lights'], null, true))
  assert.equal(confirmed.state.serviceId, null); assert.equal(confirmed.state.serviceRequest, undefined)
  assert.equal(confirmed.state.informationFocus?.serviceId, 'lights'); assert.match(confirmed.reply, /Iluminación/)
  noEffect(confirmed, before)
})
await check('legacy semantic inquiry keeps exact request and identity confirmation read-only', async () => {
  const before = agendaCalls
  const ask = await respondWithAiInterpreter(context, initial(), '¿Hacen claritos?', port, async () => ({ intent: 'information', serviceId: 'lights', serviceEvidence: 'claritos', professionalMention: null, serviceConfidence: 'certain' }))
  assert.equal(ask.state.serviceId, null)
  assert.match(ask.reply, /claritos/); assert.match(ask.reply, /Iluminación/); assert.match(ask.reply, /no tengo información confirmada/i)
  assert.equal(ask.state.serviceRequest?.purpose, 'inquiry'); noEffect(ask, before)
  const accepted = await say(ask.state, 'sí', request('sí', 'booking', 'clear', 'exact_public_name', ['lights'], null, true))
  assert.equal(accepted.state.serviceId, null); assert.equal(accepted.state.serviceRequest, undefined)
  noEffect(accepted, before)
})
await check('basket uncertain identity retains candidate, explicit yes replaces only unresolved member', async () => {
  const before = agendaCalls
  const result = await say(initial(), 'cortarme el pelo y Alisado mañana soy Matías', { ...basket(
    { mode: 'single', serviceIds: ['cut'], ...ev('cortarme el pelo') }, { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }), evidence: 'cortarme el pelo y Alisado' },
    { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
  assert.equal(result.state.basket?.members[0]?.mode, 'unresolved')
  assert.deepEqual(result.state.questionContext?.matchCandidateIds, ['cut'])
  assert.equal(result.state.questionContext?.matchTargetMemberId, result.state.basket?.members[0]?.memberId)
  assert.match(result.reply, /cortarme el pelo/); assert.match(result.reply, /Corte hombre/); assert.match(result.reply, /Alisado/)
  noEffect(result, before)
  services = [{ ...cut, name: 'Nuevo procedimiento', aliases: [] }, smooth, lights]
  const stale = await say(result.state, 'sí')
  assert.equal(stale.state.basket?.members[0]?.mode, 'unresolved', 'renamed candidate cannot be confirmed from stale question metadata')
  assert.equal(stale.state.basket?.members[1]?.serviceIds[0], 'smooth')
  assert.equal(stale.state.date, '2026-10-05'); assert.equal(stale.state.customerName, 'Matías')
  noEffect(stale, before)
  services = [cut, smooth, lights]
  const contradicted = await say(result.state, 'sí pero no Corte hombre')
  assert.equal(contradicted.state.basket?.members[0]?.mode, 'unresolved')
  assert.equal(contradicted.state.basket?.members[1]?.serviceIds[0], 'smooth')
  noEffect(contradicted, before)
  const confirmed = await say(result.state, 'sí')
  assert.deepEqual(confirmed.state.basket?.members.flatMap(member => member.serviceIds), ['cut', 'smooth'])
  assert.equal(confirmed.state.date, '2026-10-05'); assert.equal(confirmed.state.customerName, 'Matías')
  assert.equal(confirmed.proposal, null)
})
await check('documented quote must support same current source, never invented or foreign proof', async () => {
  const proven = await say(initial(), 'balayage', request('balayage', 'inquiry', 'clear', 'documented_variant', ['lights'], 'Mechas y balayage'))
  assert.equal(proven.state.serviceRequest, undefined); assert.match(proven.reply, /Iluminación/)
  const fake = await say(initial(), 'claritos', request('claritos', 'inquiry', 'clear', 'documented_variant', ['lights'], 'Mechas y claritos'))
  assert.ok(fake.state.serviceRequest); assert.equal(fake.state.serviceId, null)
  services = [cut, { ...smooth, description: 'Mechas y claritos' }, lights]
  const foreign = await say(initial(), 'claritos', request('claritos', 'inquiry', 'clear', 'documented_variant', ['lights'], 'Mechas y claritos'))
  assert.ok(foreign.state.serviceRequest); assert.equal(foreign.state.serviceId, null)
})
await check('published negative-looking qualifier is catalog data, not a lexical veto', async () => {
  const formal = { ...smooth, name: 'Alisado (sin formol)' }
  services = [cut, formal, lights]
  const actual = await say(initial(), 'Alisado sin formol', single('smooth', 'Alisado sin formol'))
  assert.equal(actual.state.serviceId, 'smooth')
  const typo = await say(initial(), 'Alisadoo sin formol', single('smooth', 'Alisadoo sin formol'))
  assert.equal(typo.state.serviceId, 'smooth')
  const excluded = await say(initial(), 'sin el servicio Alisado sin formol', single('smooth', 'sin el servicio Alisado sin formol'))
  assert.equal(excluded.state.serviceId, null)
})
await check('legacy absent confidence exact name remains supported, explicit uncertainty still asks', async () => {
  const provider = (confidence?: string) => async () => ({ intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte hombre', professionalMention: null, ...(confidence ? { serviceConfidence: confidence } : {}) })
  const exact = await respondWithAiInterpreter(context, initial(), 'Corte hombre', port, provider())
  assert.equal(exact.state.serviceId, 'cut')
  const uncertain = await respondWithAiInterpreter(context, initial(), 'Corte hombre', port, provider('uncertain'))
  assert.equal(uncertain.state.serviceId, null); assert.match(uncertain.reply, /Corte hombre/)
})
await check('retained unique category is scoped to fresh draft labels, not all catalog or stale names', async () => {
  services = [cut, { ...cut, id: 'woman', name: 'Corte mujer', aliases: [] }, smooth]
  const state: DialogueState = { ...initial(), pending: 'date', basket: { version: 1, nextMemberId: 3, members: [
    { memberId: 'm1', mode: 'single', serviceIds: ['woman'], evidence: 'Corte mujer' },
    { memberId: 'm2', mode: 'single', serviceIds: ['smooth'], evidence: 'Alisado' }
  ] } }
  const op = { ...basket({ mode: 'single', serviceIds: ['woman'], ...ev('corte') }), mutation: 'replace', evidence: 'mejor sólo el corte' }
  const retained = await say(state, 'mejor sólo el corte', op)
  assert.deepEqual(retained.state.basket?.members.flatMap(member => member.serviceIds), ['woman'])
  services = [cut, { ...cut, id: 'woman', name: 'Procedimiento nuevo', aliases: [] }, smooth]
  const renamed = await say(state, 'mejor sólo el corte', op)
  assert.equal(renamed.state.basket?.members[0]?.mode, 'unresolved')
  assert.equal(renamed.state.serviceId, null)
})
await check('negative conditional weak foreign provider and correction guards remain independent', async () => {
  for (const evidence of ['no corte hombre', 'quizás corte hombre', 'corte francés', 'corte arcoíris', 'cortee hombre extra']) {
    const result = await say(initial(), evidence, single('cut', evidence))
    assert.equal(result.state.serviceId, null, evidence)
  }
  const weak = await say(initial(), 'cortee hombre', single('cut', 'cortee hombre', 0.4))
  assert.equal(weak.state.serviceId, null)
  const foreign = await say(initial(), 'cortee hombre', single('foreign', 'cortee hombre'))
  assert.equal(foreign.interpretation.reason, 'invalid_output'); assert.equal(foreign.state.serviceId, null)
  const corrected = await say({ ...initial(), serviceId: 'smooth' }, 'no mejor cortee hombre', single('cut', 'cortee hombre', 1, true))
  assert.equal(corrected.state.serviceId, 'cut', 'negating previous selection does not negate the new literal evidence')
  const prior = await say(initial(), 'Alisado mañana soy Matías', single('smooth', 'Alisado'), { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
  const fallback = await respondWithAiInterpreter(context, prior.state, 'cortee hombre', port, async () => { throw new Error('offline provider') })
  assert.equal(fallback.interpretation.reason, 'provider_error'); assert.equal(fallback.state.serviceId, 'smooth')
  assert.equal(fallback.state.date, '2026-10-05'); assert.equal(fallback.state.customerName, 'Matías')
  assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(fallback.state)), context.businessId), fallback.state)
})
assert.equal(failures, 0, `${failures} service grounding regression cases failed`)
console.log('service grounding causal cases PASS')
