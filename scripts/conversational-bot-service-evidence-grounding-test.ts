import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { groundServicePlan, serviceEvidenceMeaning } from '../src/conversational-bot/service-evidence-grounding.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
const services = ['Corte hombre', 'Corte mujer', 'Corte y color', 'Alisado'].map((name, i) => ({ id: ['men','women','colour','straight'][i]!, name, durationMinutes: 30, price: 100, requiresConsultation: false }))
const ctx = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const op = (kind: string, evidence: string, fields: object, confidence = 1) => ({ kind, evidence, confidence, ...fields })
const svc = (evidence: string, id = 'men', confidence = 1) => op('service', evidence, { mode: 'single', serviceIds: [id], correction: false }, confidence)
const plan = (...operations: object[]) => ({ version: 1, operations })
const member = (evidence: string, id: string) => ({ mode: 'single', serviceIds: [id], evidence, confidence: 1 })
async function say(message: string, turnPlan: unknown, extra: object = {}) {
  let agenda = 0
  const port: DialoguePort = { catalog: async () => services, availability: async () => { agenda++; return { professionals: [], slots: [] } } }
  const provider: AiInterpretationProvider = async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, ...extra, turnPlan })
  const response = await respondWithAiInterpreter(ctx, initialDialogueState('tenant'), message, port, provider)
  return { response, agenda }
}
assert.throws(() => parseTurnPlan(plan(svc('un corte')), 'uncorte'), /evidence/)
for (const [message, evidence] of [['uncorte','un corte'], ['uncorte','uncorte'], ['un corte','un corte'], ['un corte','uncorte'], ['quiero uncorte','quiero un corte']]) {
  const { response, agenda } = await say(message!, plan(svc(evidence!)))
  assert.equal(response.interpretation.mode, 'ai', message + '/' + evidence)
  assert.equal(response.state.serviceId, null, 'generic corte must never choose hombre')
  assert.deepEqual(response.state.basket?.members[0]?.serviceIds, ['men','women','colour'])
  assert.equal(response.state.basket?.members[0]?.evidence, message)
  assert.equal(agenda, 0)
}
for (const cut of ['uncorte','un corte']) {
  const { response } = await say('quiero ' + cut + ' y alisado mañana, soy Matías', plan(
    op('basket', 'quiero un corte y alisado', { mutation: 'set', scope: 'all', targetMemberIds: [], members: [member('un corte','men'), member('alisado','straight')] }),
    op('date','mañana',{ expression: 'mañana', value: '2026-10-04' }),
    op('name','Matías',{ value: 'Matías' })
  ))
  assert.equal(response.interpretation.mode, 'ai')
  assert.equal(response.state.serviceId, null)
  assert.equal(response.state.date, '2026-10-04')
  assert.equal(response.state.customerName, 'Matías')
  assert.deepEqual(response.state.basket?.members.map(m => m.serviceIds), [['men','women','colour'],['straight']])
  assert.equal(response.state.basket?.members[0]?.evidence, cut)
  assert.match(response.reply, /Alisado/)
}
for (const [message,evidence,id] of [['alis ado','alisado','straight'],['alis ado','alis ado','straight'],['cortehombre','corte hombre','men']]) {
  const { response } = await say(message!, plan(svc(evidence!,id!)))
  assert.equal(response.interpretation.mode,'ai')
  assert.equal(response.state.basket?.members[0]?.evidence,message)
}
const bad: [string,unknown,string,object?][] = [
 ['uncorte',plan(svc('un masaje')),'evidence'],
 ['uncorte',plan(svc('un corte','foreign-private')),'catalog'],
 ['alis ado',plan(svc('alisado','men')),'catalog'],
 ['uncorte',plan(svc('un corte','straight')),'catalog'],
 ['uncorte',plan(svc('un corte','men',0.4)),'evidence'],
 ['no quiero uncorte',plan(svc('un corte')),'evidence'],
 ['uncorte y uncorte',plan(svc('un corte')),'evidence'],
 ['no quería uncorte',plan(svc('uncorte')),'evidence'],
 ['noqueria uncorte',plan(svc('no queria un corte')),'evidence'],
 ['u ncorte',plan(svc('un corte')),'evidence'],
 ['uncorte unalisado',plan(svc('un corte un alisado')),'evidence'],
 ['supercorte',plan(svc('super corte')),'evidence'],
 ['cort ehombre',plan(svc('corte hombre')),'evidence'],
 ['un corte',plan(svc('un corte'),svc('un corte')),'conflict'],
 ['uncorte',{ version: 2, operations: [] },'shape'],
 ['uncorte',plan(op('service','un corte',{mode:'single',serviceIds:[],correction:false})),'shape'],
 ['uncorte',plan(op('service','un corte',{mode:'alternatives',serviceIds:['men','men'],correction:false})),'shape'],
 ['uncorte',plan(svc('un corte')),'conflict',{ serviceId: 'men',serviceEvidence: 'uncorte' }],
 ['soy Ma tías',plan(op('name','Matías',{value:'Matías'})),'evidence'],
 ['ma ñana',plan(op('date','mañana',{expression:'mañana',value:'2026-10-04'})),'evidence'],
 ['a las die z',plan(op('time','diez',{value:'10:00'})),'evidence'],
 ['si confirmar',plan(op('confirm_proposal','siconfirmar',{})),'evidence'],
 ['Alisado básico',plan(op('estimate','básico',{serviceId:'straight',optionId:'foreign-option'})),'estimate']
]
for (const [text,p,cause,extra] of bad) {
 const { response } = await say(text,p,extra)
 assert.equal(response.interpretation.reason,'invalid_output',text)
 assert.equal((response.interpretation.validation?.turnPlan as any)?.cause,cause,text)
 assert.doesNotMatch(JSON.stringify(response.interpretation),/foreign-private|foreign-option|Matías|uncorte|alisado/i)
 assert.equal(response.proposal,null)
}
const raw = plan(svc('un corte'))
const original = structuredClone(raw)
const grounded = groundServicePlan(raw, 'uncorte', services)
assert.deepEqual(raw, original, 'never mutate the provider payload')
assert.equal((grounded as { operations: { evidence: string }[] }).operations[0]!.evidence, 'uncorte')
assert.equal(serviceEvidenceMeaning('uncorte', services), 'un corte')
for (const source of ['uncorte', 'alis ado', 'cortehombre', 'uncorte unalisado']) {
 const meaning = serviceEvidenceMeaning(source, services)
 assert.equal(serviceEvidenceMeaning(meaning, services), meaning, 'meaning must not compound boundary edits')
}
assert.equal(serviceEvidenceMeaning('uncorte unalisado', services), 'uncorte unalisado')
const collidingCatalog = [...services, { id: 'joined', name: 'Uncorte' }]
assert.equal(serviceEvidenceMeaning('uncorte', collidingCatalog), 'uncorte', 'an exact catalog word must not be split into another service')
assert.throws(() => groundServicePlan(plan(svc('un corte')), 'uncorte', collidingCatalog), /evidence/)
console.log('service evidence grounding: offline PASS')
