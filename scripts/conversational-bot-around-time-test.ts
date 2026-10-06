import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { issueChoiceQuestion, parseChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
import assert from 'node:assert/strict'
import { parseTimePreference, classifyTemporalRequest, literalClockMeaning } from '../src/conversational-bot/time-preference.js'
import { initialDialogueState, parseDialogueState, respondConversationChoice, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { buildRequestedStartEvidence } from '../src/bot-options/application/requested-start-evidence.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { presentAvailability } from '../src/conversational-bot/availability-presentation.js'
const ctx = { businessId: 'around-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const services = [{ id: 'cut', name: 'Corte', durationMinutes: 30, price: 100, requiresConsultation: false }]
const slot = (time: string) => ({ time, date: '2026-10-04', startAt: '2026-10-04T' + String(Number(time.slice(0,2))+3).padStart(2,'0') + time.slice(2) + ':00Z', professionalId: 'ramiro', professionalName: 'Ramiro', occupiedMinutes: 0, band: 'AFTERNOON' as const })
let times = ['13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00']
let calls = 0
const port: DialoguePort = { catalog: async () => services, availability: async () => { calls++; return { professionals: [{id:'ramiro',name:'Ramiro',priority:0}], slots: times.map(slot) } } }
const base = (): DialogueState => ({ ...initialDialogueState(ctx.businessId), serviceId:'cut', date:'2026-10-04', professional:{kind:'specific',id:'ramiro'}, customerName:'Matías', pending:'time', timePreference:{kind:'band',band:'AFTERNOON'} })
const pref = (preference: unknown, evidence: string) => ({ kind:'time_preference',preference,evidence,confidence:1 })
const plan = (...operations: object[]) => ({version:1,operations})
const act = (kind: string, field: string, evidence: string, operationIndexes: number[]) => ({kind,field,evidence,operationIndexes,mention:null,confidence:1})
const clarification = (evidence: string) => ({kind:'time_clarification',candidateTimes:['05:00','17:00'],evidence,confidence:1})
const provider = (turnPlan: unknown, acts?: object[]): AiInterpretationProvider => async () => ({intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan,...(acts?{communicativeActs:{version:1,acts}}:{})})
assert.deepEqual(parseTimePreference({kind:'around',time:'17:00'}), {kind:'around',time:'17:00'})
assert.equal(classifyTemporalRequest('tipo 5')?.kind,'ambiguous')
assert.deepEqual(classifyTemporalRequest('tipo 5 de la tarde'),{kind:'preference',preference:{kind:'around',time:'17:00'}})
const scope = { businessId:ctx.businessId,serviceIds:['cut'],date:'2026-10-04',professionalId:'ramiro' }
const show = (cursor=0) => presentAvailability({scope,read:{fresh:true,scope,slots:times.map(slot)},now:ctx.dbNow,timezone:ctx.timezone,preference:{kind:'around',time:'17:00'} as any,cursor})
assert.deepEqual(show().choices.filter(c=>c.kind==='slot').map(c=>c.slot.time),['17:00','16:30','17:30'])
assert.equal(show().hasMore,true)
assert.deepEqual(show(1).choices.filter(c=>c.kind==='slot').map(c=>c.slot.time),['16:00','18:00','15:30'])
for (const output of [plan(pref({kind:'band',band:'AFTERNOON'},'tipo 5')),plan(clarification('tipo 5')),plan({kind:'time',value:'17:00',evidence:'tipo 5',confidence:1}),plan(pref({kind:'around',time:'05:00'},'tipo 5'))]) {
 const response = await respondWithAiInterpreter(ctx,base(),'tipo 5',port,provider(output,[act('request','time','tipo 5',[0])]))
 assert.equal(response.state.requestedTime,null)
 assert.equal(response.state.slot,null)
 assert.deepEqual(response.state.timePreference,{kind:'around',time:'17:00'})
 assert.deepEqual(response.choicePresentation?.choices.filter(c=>c.operation.kind==='slot').map(c=>c.operation.kind==='slot'?c.operation.time:null),['17:00','16:30','17:30'])
 assert.equal(response.proposal,null)
}
const legacyNoopCalls=calls
const legacyNoop=await respondWithAiInterpreter(ctx,base(),'tipo 5',port,provider(plan()))
assert.deepEqual(legacyNoop.state.timePreference,{kind:'band',band:'AFTERNOON'},'a legacy no-op does not authorize replacing an existing preference')
assert.equal(legacyNoop.state.slot,null);assert.equal(legacyNoop.bookingCommand,undefined)
assert.equal(calls,legacyNoopCalls)
const ambiguous = {...base()};delete ambiguous.timePreference
const before=calls
const unclear=await respondWithAiInterpreter(ctx,ambiguous,'tipo 5, soy María',port,provider(plan(pref({kind:'band',band:'AFTERNOON'},'tipo 5'),{kind:'name',value:'María',evidence:'María',confidence:1}),[act('request','time','tipo 5',[0]),act('change','name','soy María',[1])]))
assert.equal(unclear.state.customerName,'María')
assert.equal(unclear.state.slot,null)
assert.equal(unclear.state.requestedTime,null)
assert.equal(calls,before,'ambiguity cannot use free slots as identity authority')
assert.match(unclear.reply,/mañana.*tarde|tarde.*mañana/)
assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(unclear.state)),ctx.businessId),unclear.state)
times=['17:00']
const one=await respondWithAiInterpreter(ctx,base(),'tipo 5',port,provider(plan(pref({kind:'around',time:'17:00'},'tipo 5')),[act('request','time','tipo 5',[0])]))
assert.equal(one.state.slot,null)
assert.equal(one.proposal,null)
assert.equal(one.bookingCommand,undefined)
assert.deepEqual(parseDialogueState(one.state,ctx.businessId),one.state)

const afternoon=await respondWithAiInterpreter(ctx,unclear.state,'de la tarde',port,provider(plan(pref({kind:'band',band:'AFTERNOON'},'de la tarde')),[act('answer','time','de la tarde',[0])]))
assert.deepEqual(afternoon.state.timePreference,{kind:'around',time:'17:00'})
assert.equal(afternoon.state.timeClarification,undefined)
assert.equal(afternoon.state.slot,null)
const lateral=await respondWithAiInterpreter(ctx,unclear.state,'soy Lucía',port,provider(plan({kind:'name',value:'Lucía',evidence:'Lucía',confidence:1}),[act('change','name','soy Lucía',[0])]))
assert.equal(lateral.state.customerName,'Lucía')
assert.deepEqual(lateral.state.timeClarification,unclear.state.timeClarification)
assert.match(lateral.reply,/mañana.*tarde/)
const fallback: AiInterpretationProvider=async()=>{throw Error('offline')}
const recovered=await respondWithAiInterpreter(ctx,base(),'tipo 5',port,fallback)
assert.deepEqual(recovered.state.timePreference,{kind:'around',time:'17:00'})
assert.equal(recovered.state.slot,null)
times=['16:30','18:00']
let tamper=false
const scoped: DialoguePort={catalog:port.catalog,availability:async(_service,date,_professional,temporal)=>{
 assert.equal(temporal?.requestedTime,null)
 assert.deepEqual(temporal?.preference,{kind:'around',time:'17:00'})
 const requestedStartEvidence=buildRequestedStartEvidence({
  businessId:tamper?'foreign-tenant':ctx.businessId,serviceIds:['cut'],durationMinutes:30,customerDurationMinutes:30,
  requestedStart:{date,time:'17:00'},dbNow:ctx.dbNow,settings:{timezone:ctx.timezone,horizonDays:7,leadTimeHours:0,morningCutTime:'12:00',eveningCutTime:'18:00'},
  professionals:[{id:'ramiro',name:'Ramiro',priority:0}],businessHours:[{ownerId:tamper?'foreign-tenant':ctx.businessId,dayOfWeek:0,startTime:'10:00',endTime:'20:00'}],
  professionalHours:[{ownerId:'ramiro',dayOfWeek:0,startTime:'10:00',endTime:'20:00'}],blocks:[],busy:[{professionalId:'ramiro',startAt:new Date('2026-10-04T20:00:00Z'),duration:30}]
 })
 return {professionals:[{id:'ramiro',name:'Ramiro',priority:0}],slots:times.map(slot),...(requestedStartEvidence?{requestedStartEvidence}:{})}
}}
const busy=await respondWithAiInterpreter(ctx,base(),'tipo 5',scoped,provider(plan(clarification('tipo 5')),[act('request','time','tipo 5',[0])]))
assert.match(busy.reply,/17:00.*turno ocupado/)
assert.doesNotMatch(busy.reply,/no tiene jornada|no atiende/)
assert.equal(busy.state.date,'2026-10-04')
assert.deepEqual(busy.state.timePreference,{kind:'around',time:'17:00'})
tamper=true
const noProof=await respondWithAiInterpreter(ctx,base(),'tipo 5',scoped,provider(plan(clarification('tipo 5')),[act('request','time','tipo 5',[0])]))
assert.match(noProof.reply,/17:00/)
assert.doesNotMatch(noProof.reply,/turno ocupado|bloqueo|fuera de.*jornada|no tiene jornada/)
assert.equal(noProof.state.slot,null)
assert.doesNotMatch(JSON.stringify(noProof.interpretation),/foreign-tenant|17:00|ramiro|Matías/)

for (const [text, output] of [
 ['tipo 17',plan(pref({kind:'around',time:'17:00'},'evidence-private-fake'))],
 ['hola',plan(pref({kind:'around',time:'17:00'},'hola'))]
]) {
 const rejected=await respondWithAiInterpreter(ctx,base(),text as string,port,provider(output))
 if(text==='hola') {
  assert.equal(rejected.interpretation.mode,'ai'); assert.equal(rejected.interpretation.reason,null)
  assert.deepEqual(rejected.interpretation.temporalGrounding,{outcome:'field_rejected',field:'time',reason:'unproven_approximation'})
  assert.deepEqual(rejected.state.timePreference,base().timePreference)
  assert.equal(rejected.state.timeMeaningClarification,undefined)
  assert.equal(rejected.bookingCommand,undefined)
 } else assert.equal(rejected.interpretation.reason,'invalid_output')
 assert.equal(rejected.state.slot,null)
 assert.doesNotMatch(JSON.stringify(rejected.interpretation),/evidence-private-fake/)
}
const explicit=await respondWithAiInterpreter(ctx,base(),'tipo 17',port,provider(plan(pref({kind:'band',band:'AFTERNOON'},'tipo 17')),[act('request','time','tipo 17',[0])]))
assert.deepEqual(explicit.state.timePreference,{kind:'around',time:'17:00'})
assert.equal(explicit.state.slot,null)

const beforeWeak=calls
const weak=await respondWithAiInterpreter(ctx,base(),'tipo 5',port,provider(plan({...pref({kind:'around',time:'17:00'},'tipo 5'),confidence:0.4}),[act('request','time','tipo 5',[0])]))
assert.equal(calls,beforeWeak)
assert.equal(weak.state.slot,null)
assert.match(weak.reply,/No pude confirmar/)
const spaced=await respondWithAiInterpreter(ctx,base(),'  tipo   5  ',port,provider(plan(clarification('tipo   5')),[act('request','time','tipo   5',[0])]))
assert.equal(spaced.interpretation.mode,'ai')
assert.deepEqual(spaced.state.timePreference,{kind:'around',time:'17:00'})

times=['13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00']
const firstPage=await respondWithAiInterpreter(ctx,base(),'tipo 5',port,provider(plan(clarification('tipo 5')),[act('request','time','tipo 5',[0])]))
const pageOperation=firstPage.choicePresentation?.choices.find(c=>c.operation.kind==='page')!.operation
assert.ok(pageOperation)
const page=await respondConversationChoice(ctx,firstPage.state,pageOperation,port)
assert.deepEqual(page.choicePresentation?.choices.filter(c=>c.operation.kind==='slot').map(c=>c.operation.kind==='slot'?c.operation.time:null),['16:00','18:00','15:30'])
assert.deepEqual(page.state.timePreference,{kind:'around',time:'17:00'})
assert.equal(page.state.slot,null)
const choiceScope={businessId:ctx.businessId,conversationKey:'conversation',policyKey:'qa',policyGeneration:1,revision:'1'}
const question=issueChoiceQuestion(choiceScope,firstPage.state,firstPage.choicePresentation!)
assert.deepEqual(parseChoiceQuestion(JSON.parse(JSON.stringify(question))),question)
const publicQuestion=publicChoiceQuestion(question)
const chosen=resolveChoice(question,choiceScope,firstPage.state,publicQuestion.choices[0]!.id)
assert.equal(chosen.operation.kind,'slot')
assert.throws(()=>resolveChoice(question,{...choiceScope,revision:'2'},firstPage.state,publicQuestion.choices[0]!.id))
assert.throws(()=>resolveChoice(question,{...choiceScope,businessId:'foreign'},firstPage.state,publicQuestion.choices[0]!.id))
times=['18:00']
await assert.rejects(()=>respondConversationChoice(ctx,firstPage.state,chosen.operation,port),/unavailable|disponible/i)
const mixedText='Corte mañana tipo 5, soy Julia'
const mixed=await respondWithAiInterpreter(ctx,initialDialogueState(ctx.businessId),mixedText,port,provider(plan(
 {kind:'service',mode:'single',serviceIds:['cut'],correction:false,evidence:'Corte',confidence:1},
 {kind:'date',expression:'mañana',value:'2026-10-04',evidence:'mañana',confidence:1},
 {kind:'name',value:'Julia',evidence:'Julia',confidence:1},
 pref({kind:'band',band:'AFTERNOON'},'tipo 5')
),[act('request','service','Corte',[0]),act('request','date','mañana',[1]),act('request','name','soy Julia',[2]),act('request','time','tipo 5',[3])]))
assert.equal(mixed.state.serviceId,'cut')
assert.equal(mixed.state.date,'2026-10-04')
assert.equal(mixed.state.customerName,'Julia')
assert.deepEqual(mixed.state.timeClarification,{candidateTimes:['05:00','17:00']})
assert.equal(mixed.state.slot,null)


let request: any
const http=createOpenAiInterpretationProvider({apiKey:'fake-only',fetchImpl:async(_url,init)=>{
 request=JSON.parse(String(init?.body))
 return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:plan()})}]}]}),{status:200})
}})
await http({message:'tipo 5',state:unclear.state,services},new AbortController().signal)
assert.match(request.instructions,/around\/time/)
assert.match(request.instructions,/time_clarification/)
assert.deepEqual(JSON.parse(request.input).timeClarification,{candidateTimes:['05:00','17:00']})
const operationSchema=request.text.format.schema.properties.turnPlan.anyOf[0].properties.operations.items.anyOf
assert.ok(operationSchema.some((schema:any)=>schema.properties.kind.enum.includes('time_clarification')))
assert.ok(operationSchema.find((schema:any)=>schema.properties.kind.enum.includes('time_preference')).properties.preference.anyOf.some((schema:any)=>schema.properties.kind.enum.includes('around')))

console.log('around temporal preference: offline PASS')




// S: current literal clocks prove their values, not just a valid HH:mm shape.
const semanticClockFailures: string[] = []
async function clockCheck(label: string, check: () => void | Promise<void>) {
 try { await check(); console.log('PASS semantic clock ' + label) }
 catch(error) { semanticClockFailures.push(label + ': ' + String(error)); console.error('RED semantic clock ' + label + ': ' + String(error)) }
}
const literals = [
 ['1330','13:00','13:30'], ['1130','11:00','11:30'], ['17hs','18:00','17:00'],
 ['las19','18:00','19:00'], ['13:30','13:00','13:30']
] as const
await clockCheck('public strict parser rejects different values', () => {
 for(const [evidence,wrong] of literals) assert.throws(()=>parseTurnPlan(plan({kind:'time',value:wrong,evidence,confidence:1}),evidence))
 assert.throws(()=>parseTurnPlan(plan({kind:'time',value:'13:00',evidence:'13',confidence:1}),'13:30'),'a shortened quote cannot erase minutes')
})
await clockCheck('same clocks are accepted without selecting a preference', async () => {
 times=['11:30','13:30','17:00','19:00']
 for(const [evidence,_wrong,correct] of literals) {
  const result=await respondWithAiInterpreter(ctx,base(),evidence,port,provider(plan({kind:'time',value:correct,evidence,confidence:1}),[act('change','time',evidence,[0])]))
  assert.equal(result.interpretation.mode,'ai');assert.equal(result.state.requestedTime,correct)
  assert.equal(result.state.slot?.time,correct);assert.equal(result.bookingCommand,undefined)
 }
})
await clockCheck('known alternatives cannot be reduced to a branch', async () => {
 times=['13:30','14:00']
 for(const [message,evidence] of [['13:30/14:00','13:30'],['13:30 o 14:00','13:30'],['a las13:30 o a las14:00','a las13:30']] as const) {
  const before=calls
  const result=await respondWithAiInterpreter(ctx,base(),message,port,provider(plan({kind:'time',value:'13:30',evidence,confidence:1}),[act('change','time',message,[0])]))
  assert.equal(result.interpretation.mode,'ai')
  assert.deepEqual(result.interpretation.temporalGrounding,{outcome:'field_rejected',field:'time',reason:'clock_alternatives'})
  assert.equal(result.state.timeMeaningClarification,true);assert.equal(result.state.timeClarification,undefined)
  assert.equal(result.state.requestedTime,null);assert.equal(result.state.slot,null)
  assert.equal(result.proposal,null);assert.equal(result.bookingCommand,undefined);assert.equal(calls,before)
  assert.doesNotMatch(result.reply,/mañana o de la tarde|mañana.*tarde.*refer/i)
 }
})
await clockCheck('twelve-hour literals do not prove a morning clock', () => {
 for(const text of ['5','a las5','5hs','5:30','a las11']) assert.deepEqual(literalClockMeaning(text,text),{kind:'unknown'})
 assert.doesNotThrow(()=>parseTurnPlan(plan({kind:'time',value:'11:00',evidence:'11',confidence:1}),'11'))
})
await clockCheck('explicit periods prove the converted clock without changing twelve-hour approximation', async () => {
 for(const [evidence,correct,wrong] of [['a las5pm','17:00','18:00'],['a las11:00am','11:00','23:00'],['a las5 de la tarde','17:00','05:00']] as const) {
  assert.throws(()=>parseTurnPlan(plan({kind:'time',value:wrong,evidence,confidence:1}),evidence))
  times=[correct]
  const result=await respondWithAiInterpreter(ctx,base(),evidence,port,provider(plan({kind:'time',value:correct,evidence,confidence:1}),[act('change','time',evidence,[0])]))
  assert.equal(result.interpretation.mode,'ai');assert.equal(result.state.slot?.time,correct);assert.equal(result.bookingCommand,undefined)
  const mismatch=await respondWithAiInterpreter(ctx,base(),evidence,port,provider(plan({kind:'time',value:wrong,evidence,confidence:1}),[act('change','time',evidence,[0])]))
  assert.deepEqual(mismatch.interpretation.temporalGrounding,{outcome:'field_rejected',field:'time',reason:'clock_value_mismatch'})
  assert.equal(mismatch.state.slot,null);assert.equal(mismatch.state.timeMeaningClarification,true)
 }
 times=['17:30']
 const approximate=await respondWithAiInterpreter(ctx,base(),'tipo 5:30',port,provider(plan({kind:'time',value:'17:30',evidence:'tipo 5:30',confidence:1}),[act('change','time','tipo 5:30',[0])]))
 assert.deepEqual(approximate.state.timePreference,{kind:'around',time:'17:30'});assert.equal(approximate.state.slot,null)
})
await clockCheck('history negation ranges and approximation are not slash alternatives', async () => {
 times=['14:00']
 for(const message of ['Antes venía a las13:30; ahora quiero a las14:00','No a las13:30; mejor a las14:00']) {
  const evidence='a las14:00'
  const result=await respondWithAiInterpreter(ctx,base(),message,port,provider(plan({kind:'time',value:'14:00',evidence,confidence:1}),[act('change','time',evidence,[0])]))
  assert.equal(result.interpretation.mode,'ai');assert.equal(result.state.slot?.time,'14:00')
 }
 const interval={kind:'range',from:'13:00',to:'18:00',fromInclusive:true,toInclusive:false} as const
 const rangeText='después de las13 y antes de las18'
 const ranged=await respondWithAiInterpreter(ctx,base(),rangeText,port,provider(plan(pref(interval,rangeText)),[act('change','time',rangeText,[0])]))
 assert.deepEqual(ranged.state.timePreference,interval);assert.equal(ranged.state.slot,null)
 const around=await respondWithAiInterpreter(ctx,base(),'alrededor de las11:00',port,provider(plan(pref({kind:'around',time:'11:00'},'alrededor de las11:00')),[act('change','time','alrededor de las11:00',[0])]))
 assert.deepEqual(around.state.timePreference,{kind:'around',time:'11:00'});assert.equal(around.state.slot,null)
})
if(semanticClockFailures.length)throw Error('Semantic clock failures: '+semanticClockFailures.join('\n'))
