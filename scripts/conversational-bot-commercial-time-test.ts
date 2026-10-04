import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { groundTemporalPlan } from '../src/conversational-bot/temporal-grounding.js'
const context = {businessId:'commercial-time',timezone:'America/Argentina/Buenos_Aires',dbNow:new Date('2026-10-04T15:00:00Z')}
const services = [{id:'cut',name:'Corte',price:10,durationMinutes:30,requiresConsultation:false}]
const selected: DialogueState = {...initialDialogueState(context.businessId),serviceId:'cut',date:'2026-10-06',professional:{kind:'specific',id:'p'},customerName:'Juan',pending:'time'}
const message = 'tipo 4 tenes lugar?'
const comment = 'de la tarde obviamente, quien se va a cortar a las 4 de la mañana'
const plan = (evidence:string) => ({version:1,operations:[{kind:'time_clarification',candidateTimes:['04:00','16:00'],evidence,confidence:1}]})
const legacy = {intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null}
let proofReads = 0
const businessTimeContext = (date:string,candidateTimes:readonly string[]) => {
  proofReads++
  return {businessId:context.businessId,timezone:context.timezone,date,candidateTimes:[...candidateTimes],candidates:candidateTimes.map(time=>({time,status:time==='16:00'?'open':'closed'}))}
}
const port: DialoguePort = {catalog:async()=>services,availability:async(_s,date)=>({professionals:[{id:'p',name:'Ana',priority:0}],slots:[{date,time:'16:00',startAt:date+'T19:00:00.000Z',professionalId:'p',professionalName:'Ana',band:'AFTERNOON',occupiedMinutes:0}]}),...{businessTimeContext}}
const first = await respondWithAiInterpreter(context,selected,message,port,async()=>({...legacy,turnPlan:plan('tipo 4')}))
assert.deepEqual(first.state.timePreference,{kind:'around',time:'16:00'},'business hours exclude AM, preserve approximate PM intention')
assert.equal(first.state.timeClarification,undefined)
assert.equal(first.state.slot,null);assert.equal(first.proposal,null);assert.equal(first.bookingCommand,undefined)
assert.equal(proofReads,1,'AI and engine reuse same daily proof')
const pending = {...selected,timeClarification:{candidateTimes:['04:00','16:00']}}
const continued = await respondWithAiInterpreter(context,pending,comment,port,async()=>({...legacy,turnPlan:plan('de la tarde')}))
assert.equal(continued.interpretation.mode,'ai','affirmative period evidence remains valid with rhetorical comment')
assert.equal(continued.state.date,'2026-10-06')
assert.deepEqual(continued.state.timePreference,{kind:'around',time:'16:00'})
assert.equal(continued.state.requestedTime,null);assert.equal(continued.state.slot,null);assert.equal(continued.proposal,null)
const fallback = await respond(context,pending,comment,port)
assert.equal(fallback.state.date,'2026-10-06','rhetorical morning is not tomorrow')
assert.deepEqual(fallback.state.timePreference,{kind:'around',time:'16:00'})
assert.equal(fallback.state.customerName,'Juan');assert.deepEqual(fallback.state.professional,selected.professional)
for (const text of ['no de la tarde','de la tarde?','de la tarde o de la mañana','de la tarde, mejor de la mañana','quien iría de la tarde','de la tarde, no, de la mañana','de la tarde, no, mejor por la mañana']) {
  const result = await respond(context,pending,text,port)
  assert.deepEqual(result.state.timeClarification,pending.timeClarification,text)
  assert.equal(result.state.date,selected.date);assert.equal(result.state.requestedTime,null);assert.equal(result.state.slot,null)
}
const morning = await respondWithAiInterpreter(context,pending,'de la mañana, no de la tarde',port,async()=>({...legacy,turnPlan:plan('de la mañana')}))
assert.equal(morning.interpretation.mode,'ai')
assert.deepEqual(morning.state.timePreference,{kind:'around',time:'04:00'},'explicit morning clarification overrides commercial plausibility, never selects a slot')
assert.equal(morning.state.date,selected.date);assert.equal(morning.state.requestedTime,null);assert.equal(morning.state.slot,null);assert.equal(morning.proposal,null)
const conservative = await respond(context,selected,message,{...port,businessTimeContext:undefined} as unknown as DialoguePort)
assert.deepEqual(conservative.state.timeClarification,{candidateTimes:['04:00','16:00']})
console.log('PASS commercial temporal grounding and contextual continuation')

const {projectBusinessTimeContext,commercialTimeCandidate,temporalPlanDate} = await import('../src/conversational-bot/business-time-context.js')
const snapshot = {businessId:context.businessId,timezone:context.timezone,stamp:'a'.repeat(64),from:new Date('2026-10-04T03:00:00Z'),to:new Date('2026-11-03T03:00:00Z'),weeklyHours:[{dayOfWeek:2,startTime:'11:00',endTime:'20:00'}],globalBlocks:[]}
const candidates = ['04:00','16:00']
const scoped = {businessId:context.businessId,timezone:context.timezone,date:selected.date}
assert.equal(commercialTimeCandidate(projectBusinessTimeContext(snapshot,selected.date!,candidates),scoped,candidates),'16:00')
for (const changed of [
 {...snapshot,weeklyHours:[]},
 {...snapshot,weeklyHours:[{dayOfWeek:2,startTime:'00:00',endTime:'20:00'}]},
 {...snapshot,weeklyHours:[{dayOfWeek:2,startTime:'22:00',endTime:'06:00'}]},
 {...snapshot,weeklyHours:[{dayOfWeek:2,startTime:'00:00',endTime:'24:00'}]},
 {...snapshot,weeklyHours:null},
 {...snapshot,globalBlocks:[{startAt:'2026-10-06T06:00:00.000Z',endAt:'2026-10-06T08:00:00.000Z'}]},
 {...snapshot,globalBlocks:[{startAt:'2026-10-06T18:00:00.000Z',endAt:'2026-10-06T20:00:00.000Z'}]},
 {...snapshot,to:new Date('2026-10-06T10:00:00Z')},
 {...snapshot,timezone:'not/a-zone'}
]) assert.equal(commercialTimeCandidate(projectBusinessTimeContext(changed,selected.date!,candidates),scoped,candidates),null)
const proof = projectBusinessTimeContext(snapshot,selected.date!,candidates)!
for (const changed of [{...proof,businessId:'foreign'},{...proof,timezone:'UTC'},{...proof,date:'2026-10-05'},{...proof,candidateTimes:['05:00','17:00']},{...proof,candidates:[{time:'04:00',status:'unknown'},{time:'16:00',status:'open'}]}]) {
 const result=await respond(context,selected,message,{...port,businessTimeContext:()=>changed} as DialoguePort)
 assert.deepEqual(result.state.timeClarification,{candidateTimes:candidates})
}
assert.equal(temporalPlanDate({operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',confidence:1}]},selected.date,'2026-10-04'),'2026-10-07')
assert.equal(temporalPlanDate({operations:[{kind:'date',expression:'miércoles',value:'2026-10-06',confidence:1}]},selected.date,'2026-10-04'),null)
const nextDate = await respond(context,selected,'miércoles tipo 4',[port][0]!,{intent:'booking',serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',evidence:'miércoles',confidence:1},{kind:'time_clarification',candidateTimes:candidates,evidence:'tipo 4',confidence:1}]}})
assert.equal(nextDate.state.date,'2026-10-07')
assert.equal(nextDate.state.slot,null)
let nextProofDate: string | undefined
const correctedDay = await respondWithAiInterpreter(context,selected,'miércoles tipo 4', {...port,businessTimeContext:(date,times)=>{
 nextProofDate=date
 return projectBusinessTimeContext(snapshot,date,times)
}}, async()=>({...legacy,turnPlan:{version:1,operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',evidence:'miércoles',confidence:1},{kind:'time_clarification',candidateTimes:candidates,evidence:'tipo 4',confidence:1}]}}))
assert.equal(correctedDay.interpretation.mode,'ai');assert.equal(correctedDay.state.date,'2026-10-07')
assert.equal(nextProofDate,'2026-10-07','date correction uses proof for prospective day, never Tuesday proof')
assert.deepEqual(correctedDay.state.timeClarification,{candidateTimes:candidates})
assert.equal(correctedDay.state.timePreference,undefined);assert.equal(correctedDay.state.slot,null);assert.equal(correctedDay.proposal,null)
let pendingProviderDate: string | undefined
const pendingDayChange = await respondWithAiInterpreter(context,pending,'miércoles tipo 4', {...port,businessTimeContext:(date,times)=>projectBusinessTimeContext(snapshot,date,times)}, async input=>{
 pendingProviderDate=input.businessTimeContext?.date
 return {...legacy,turnPlan:{version:1,operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',evidence:'miércoles',confidence:1},{kind:'time_clarification',candidateTimes:candidates,evidence:'tipo 4',confidence:1}]}}
})
assert.equal(pendingProviderDate,'2026-10-07','model never receives old daily proof during prospective date correction')
assert.equal(pendingDayChange.state.date,'2026-10-07');assert.deepEqual(pendingDayChange.state.timeClarification,{candidateTimes:candidates})
assert.equal(pendingDayChange.state.slot,null);assert.equal(pendingDayChange.proposal,null)
const explicit = await respond(context,selected,'a las 04 AM',port,{intent:'booking',serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations:[{kind:'time',value:'04:00',evidence:'a las 04 AM',confidence:1}]}})
assert.equal(explicit.state.requestedTime,'04:00');assert.equal(explicit.state.slot,null);assert.equal(explicit.proposal,null)
const dateChanged = await respond(context,pending,'miércoles',port)
assert.equal(dateChanged.state.date,'2026-10-07');assert.equal(dateChanged.state.customerName,'Juan')
const nameChanged = await respond(context,pending,'soy Pedro',port)
assert.equal(nameChanged.state.customerName,'Pedro');assert.equal(nameChanged.state.date,'2026-10-06')
const negated = await respondWithAiInterpreter(context,pending,'no de la tarde',port,async()=>({...legacy,turnPlan:{version:1,operations:[{kind:'time_preference',preference:{kind:'band',band:'AFTERNOON'},evidence:'de la tarde',confidence:1}]}}))
assert.deepEqual(negated.state.timeClarification,pending.timeClarification,'negated period cannot be accepted as band')
assert.equal(negated.state.date,selected.date)
console.log('PASS conservative public scope, exceptions, explicit AM and genuine typed changes')

const {createOpenAiInterpretationProvider} = await import('../src/conversational-bot/openai-interpretation-provider.js')
let request: any
const provider = createOpenAiInterpretationProvider({apiKey:'offline-only',fetchImpl:async(_url,init)=>{
 request=JSON.parse(String(init?.body))
 return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...legacy,turnPlan:plan('tipo 4')})}]}]}),{status:200})
}})
const roundtrip = await respondWithAiInterpreter(context,selected,message,{...port,businessTimeContext:(date,times)=>({...businessTimeContext(date,times),privateNote:'NEVER EXPOSE'})} as DialoguePort,provider)
const sent=JSON.parse(request.input)
assert.deepEqual(Object.keys(sent.businessTimeContext).sort(),['businessId','candidateTimes','candidates','date','timezone'])
assert.doesNotMatch(JSON.stringify(sent.businessTimeContext),/NEVER EXPOSE|note|slots|professional/i)
assert.deepEqual(roundtrip.state.timePreference,{kind:'around',time:'16:00'})
assert.match(request.instructions,/businessTimeContext/);assert.match(request.instructions,/retórico/)
for(const proofValue of [undefined,{...proof,candidates:[null,null]}]){
 const unsafe = await respondWithAiInterpreter(context,selected,message,{...port,businessTimeContext:()=>proofValue} as DialoguePort,async()=>({...legacy,turnPlan:plan('tipo 4')}))
 assert.deepEqual(unsafe.state.timeClarification,{candidateTimes:candidates})
}
const occupied = await respondWithAiInterpreter(context,selected,message,{...port,availability:async()=>({professionals:[{id:'p',name:'Ana',priority:0}],slots:[]})},async()=>({...legacy,turnPlan:plan('tipo 4')}))
assert.deepEqual(occupied.state.timePreference,{kind:'around',time:'16:00'},'occupancy cannot alter commercial meaning')
assert.equal(occupied.state.slot,null);assert.equal(occupied.proposal,null)
const foldProof=projectBusinessTimeContext({...snapshot,timezone:'America/New_York',from:new Date('2026-10-30T00:00:00Z'),to:new Date('2026-11-03T00:00:00Z'),weeklyHours:[{dayOfWeek:0,startTime:'00:00',endTime:'20:00'}]},'2026-11-01',['01:30','13:30'])
assert.equal(foldProof?.candidates[0]?.status,'unknown','DST fold cannot prove a unique wall-clock instant')
assert.equal(commercialTimeCandidate(foldProof,{...scoped,timezone:'America/New_York',date:'2026-11-01'},['01:30','13:30']),null)
console.log('PASS bounded provider roundtrip, false proof, occupancy independence and DST')
