import assert from 'node:assert/strict'
import { respond, respondConversationChoice, initialDialogueState, parseDialogueState, type DialogueService, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { summarizeAvailability } from '../src/conversational-bot/ai-diagnostics.js'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
import type { AvailabilityExplanation, AvailabilityCause } from '../src/bot-options/application/availability-evidence.js'
const context = { businessId:'tenant-recovery', timezone:'America/Argentina/Buenos_Aires', dbNow:new Date('2026-10-03T12:00:00Z') }
const services: DialogueService[] = [
  {id:'cut',name:'Corte',durationMinutes:30,price:100,requiresConsultation:false},
  {id:'bath',name:'Baño',durationMinutes:30,price:150,requiresConsultation:false}
]
const professionals = [{id:'p1',name:'Cin',priority:0},{id:'p2',name:'Sebastián',priority:1}]
const slot = (date:string,time:string,id='p1') => ({date,time,startAt:date+'T'+String(Number(time.slice(0,2))+3).padStart(2,'0')+time.slice(2)+':00.000Z',
  professionalId:id,professionalName:professionals.find(p=>p.id===id)!.name,band:'AFTERNOON' as const,occupiedMinutes:0})
const selected: DialogueState = {...initialDialogueState(context.businessId), pending:'time', basket:{version:1,nextMemberId:3,members:[
  {memberId:'m1',mode:'single',serviceIds:['cut'],evidence:'corte'},{memberId:'m2',mode:'single',serviceIds:['bath'],evidence:'baño'}]},
  date:'2026-10-04',professional:{kind:'specific',id:'p1'},requestedTime:'17:00',customerName:'Matías'}
let queries=0, dateQueries=0
const port = (explanation?:AvailabilityExplanation, slots:ReturnType<typeof slot>[]=[]):DialoguePort => ({
  catalog:async()=>services,
  availability:async()=>{throw new Error('joint selection must stay joint')},
  verifiedDateChoices:async()=>{dateQueries++;throw new Error('do not query again to explain the same snapshot')},
  availabilityBasket:async(requested,date,preferred)=>{
    queries++;assert.equal(date,selected.date);assert.equal(preferred,'p1','same query must diagnose the requested professional')
    return {ok:true,services:requested,durationMinutes:60,totalPrice:250,professionals,slots,...(explanation?{explanation}:{})}
  }
})
const say = (state:DialogueState,p:DialoguePort) => respond(context,state,'Matías',p,{serviceId:null,candidateIds:[],correction:false,
  intent:'booking',turnPlan:{version:1,operations:[{kind:'name',value:'Matías',evidence:'Matías',confidence:1}]}})
const fragments:Record<AvailabilityCause,RegExp> = {
  BUSINESS_CLOSED:/local.*(?:no atiende|cerrado)/i, PROFESSIONAL_NOT_WORKING:/Cin.*(?:no atiende|no trabaja|jornada)/i,
  NO_COMPATIBLE_WINDOW:/jornada|atención.*coincid/i, DURATION_DOES_NOT_FIT:/duración|tiempo.*completo/i,
  LEAD_TIME:/anticipación/i, BLOCKED:/bloque/i, BUSY:/ocupad/i, NO_SLOTS:/no.*horarios|no.*disponibilidad/i,
  DATE_PAST:/pasó/, OUTSIDE_HORIZON:/hasta|rango|período|anticipación/i, PREFERENCE_NO_MATCH:/preferencia/i
}
for(const cause of Object.keys(fragments) as AvailabilityCause[]){
  if(cause==='DATE_PAST'||cause==='PREFERENCE_NO_MATCH')continue
  const before=queries
  const response=await say(selected,port({date:selected.date!,reasons:[cause],otherProfessionals:[],nextDates:[]}))
  assert.equal(queries,before+1);assert.equal(dateQueries,0)
  assert.equal(response.state.date,selected.date,'keep requested date as context, not an available slot')
  assert.deepEqual(response.state.professional,selected.professional);assert.equal(response.state.customerName,selected.customerName)
  assert.equal(response.state.requestedTime,selected.requestedTime);assert.equal(response.state.slot,null);assert.equal(response.proposal,null)
  assert.equal(response.state.pending,'date');assert.deepEqual(response.state.basket,selected.basket)
  assert.match(response.reply,/Corte \+ Baño/);assert.match(response.reply,/04\/10/);assert.match(response.reply,fragments[cause])
  assert.equal(response.availability?.reason,cause);assert.deepEqual(summarizeAvailability(response.availability),response.availability)
  assert.deepEqual(parseDialogueState(response.state,context.businessId,context.timezone),response.state)
  const count=queries
  const noop=await respond(context,response.state,'hola',port(),{serviceId:null,candidateIds:[],correction:false,intent:'other',turnPlan:{version:1,operations:[]}})
  assert.equal(queries,count);assert.equal(noop.state.date,selected.date);assert.equal(noop.proposal,null);assert.equal(noop.availability,undefined)
}
const alternatives:AvailabilityExplanation={date:selected.date!,reasons:['PROFESSIONAL_NOT_WORKING'],
  otherProfessionals:[slot(selected.date!,'17:00','p2')],nextDates:[slot('2026-10-05','17:00')]}
const alternativeResponse=await say(selected,port(alternatives))
assert.equal(alternativeResponse.state.professional?.kind,'specific');assert.equal((alternativeResponse.state.professional as {id:string}).id,'p1')
assert.match(alternativeResponse.reply,/Sebastián/);assert.match(alternativeResponse.reply,/05\/10/);assert.equal(alternativeResponse.state.slot,null)
assert.equal(alternativeResponse.choicePresentation?.choices.some(choice=>choice.operation.kind==='date'),true)
assert.equal(alternativeResponse.choicePresentation?.choices.some(choice=>choice.operation.kind==='professional'),false,'suggestions must not silently become chosen professionals')
await assert.rejects(()=>say(selected,port({...alternatives,date:'2026-10-05'})),/availability explanation/)
await assert.rejects(()=>say(selected,port({...alternatives,otherProfessionals:[{...slot(selected.date!,'17:00','p2'),professionalName:'Foreign'}]})),/availability explanation/)
const unknown=await say(selected,port())
assert.equal(unknown.availability?.reason,null);assert.doesNotMatch(unknown.reply,/cerrado|ocupad|no trabaja/i);assert.equal(unknown.state.date,selected.date)
const preferenceState:DialogueState={...selected,date:'2026-10-04',requestedTime:null,timePreference:{kind:'after',time:'18:00'}}
const preference=await say(preferenceState,port({date:selected.date!,reasons:[],otherProfessionals:[],nextDates:[]},[slot(selected.date!,'17:00')]))
assert.equal(preference.availability?.reason,'PREFERENCE_NO_MATCH');assert.equal(preference.state.date,selected.date)
assert.deepEqual(preference.state.timePreference,preferenceState.timePreference);assert.equal(preference.state.slot,null);assert.equal(preference.proposal,null)
assert.match(preference.reply,/17:00/);assert.match(preference.reply,/Corte \+ Baño/);assert.match(preference.reply,/04\/10/)
assert.equal(preference.choicePresentation?.choices.some(choice=>choice.operation.kind==='slot'),true)
const past={...selected,date:'2026-10-02',requestedTime:null}
const pastQueries=queries
const pastResponse=await say(past,port())
assert.equal(queries,pastQueries);assert.equal(pastResponse.state.date,past.date);assert.equal(pastResponse.availability?.reason,'DATE_PAST')
assert.equal(pastResponse.state.pending,'date');assert.equal(pastResponse.proposal,null)
const scope={businessId:context.businessId,conversationKey:'qa',policyKey:'qa-policy',policyGeneration:1,revision:'2'}
function resolveLatest(response:Awaited<ReturnType<typeof say>>,kind:'date'|'slot'){
  const presentation=response.choicePresentation!
  const question=issueChoiceQuestion(scope,response.state,presentation)
  const index=presentation.choices.findIndex(choice=>choice.operation.kind===kind)
  assert.ok(index>=0)
  return resolveChoice(question,scope,response.state,publicChoiceQuestion(question).choices[index]!.id).operation
}
const slotChosen=await respondConversationChoice(context,preference.state,resolveLatest(preference,'slot'),
  port({date:selected.date!,reasons:[],otherProfessionals:[],nextDates:[]},[slot(selected.date!,'17:00')]))
assert.equal(slotChosen.state.requestedTime,'17:00');assert.equal(slotChosen.state.timePreference,undefined)
assert.equal(slotChosen.state.slot?.time,'17:00');assert.ok(slotChosen.proposal)
let freshDateCalls=0
const chosenDatePort:DialoguePort={catalog:async()=>services,availability:async()=>{throw new Error('joint only')},
  verifiedDateChoices:async(_services,preferred)=>{freshDateCalls++;assert.equal(preferred,'p1');return {ok:true,services,durationMinutes:60,totalPrice:250,professionals,slots:alternatives.nextDates}},
  availabilityBasket:async(_services,date,preferred)=>{assert.equal(date,'2026-10-05');assert.equal(preferred,'p1');return {ok:true,services,durationMinutes:60,totalPrice:250,professionals,slots:alternatives.nextDates}}}
const dateChosen=await respondConversationChoice(context,alternativeResponse.state,resolveLatest(alternativeResponse,'date'),chosenDatePort)
assert.equal(freshDateCalls,1);assert.equal(dateChosen.state.date,'2026-10-05');assert.deepEqual(dateChosen.state.professional,selected.professional)
assert.equal(dateChosen.state.requestedTime,null);assert.equal(dateChosen.proposal,null);assert.equal(dateChosen.state.pending,'time')
const anyState:DialogueState={...selected,professional:{kind:'any'},requestedTime:null}
const mixedPort:DialoguePort={...port(),availabilityBasket:async(requested,date,preferred)=>{
  assert.equal(preferred,undefined)
  return {ok:true,services:requested,durationMinutes:60,totalPrice:250,professionals,slots:[],explanation:{date,reasons:['PROFESSIONAL_NOT_WORKING','BUSY'],otherProfessionals:[],nextDates:[]}}
}}
const mixed=await say(anyState,mixedPort)
assert.match(mixed.reply,/uno o más.*profesionales/i);assert.doesNotMatch(mixed.reply,/Los profesionales compatibles no tiene/)
const offered=await say(anyState,{...mixedPort,availabilityBasket:async(requested)=>({ok:true,services:requested,durationMinutes:60,totalPrice:250,professionals,slots:[slot(selected.date!,'17:00','p2')]})})
assert.deepEqual(offered.state.professional,{kind:'any'});assert.equal(offered.state.slot,null);assert.equal(offered.proposal,null)
assert.match(offered.reply,/Sebastián/)
console.log('availability recovery: verified reasons, preserved draft, bounded suggestions, no duplicate query PASS')