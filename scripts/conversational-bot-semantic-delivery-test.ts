import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, respond, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { appliedChangeAcknowledgment } from '../src/conversational-bot/draft-delivery.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import type { ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
const context = { businessId: 'offline', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T15:00:00Z') }
const policy: ServiceBookingPolicy = { id:'color',name:'Coloración',attentionMode:'GUIDED_ESTIMATE',price:100,priceMode:'STARTING_AT',estimateAllowsBooking:true,estimateQuestion:'¿Qué largo tenés?',estimateOptions:[{id:'short',label:'Largo corto',priceMin:100,priceMax:150,note:null}],estimateExplanation:'El precio depende del largo.',estimateDisclaimer:'Sujeto a evaluación.',requiresPhoto:false,validationEnabled:false,validationMessage:null,validationQuestion:null }
const services: DialogueService[] = [
 {id:'cut-m',name:'Corte hombre',price:100,durationMinutes:30,requiresConsultation:false},
 {id:'cut-w',name:'Corte mujer',price:120,durationMinutes:30,requiresConsultation:false},
 {id:'color',name:'Coloración',price:100,priceMode:'STARTING_AT',durationMinutes:90,requiresConsultation:false,bookingPolicy:policy},
 {id:'bath',name:'Baño de crema',price:70,durationMinutes:30,requiresConsultation:false}
]
let agenda = 0
const port: DialoguePort = { catalog:async()=>services, availability:async()=>{agenda++;return { professionals:[],slots:[] }} }
const initial = () => initialDialogueState(context.businessId)
const ev = (evidence:string) => ({evidence,confidence:.99})
const member = (mode:'single'|'alternatives'|'unresolved',serviceIds:string[],evidence:string) => ({mode,serviceIds,...ev(evidence)})
const basket = (members:ReturnType<typeof member>[],evidence:string,mutation:'set'|'replace'='set') => ({kind:'basket',mutation,scope:'all',targetMemberIds:[],members,...ev(evidence)})
const candidate = (operations:object[],intent='other') => ({intent,serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations}})
async function say(state:DialogueState,message:string,operations:object[]=[],intent='other',framing=true,identity=false) {
 let calls=0
 const provider = Object.assign(async(input:AiInterpretationInput)=>{calls++;return {...candidate(operations,intent),...(['mejor sólo el corte','mejor sólo Corte hombre','mejor Corte mujer'].includes(message) ? { communicativeActs: { version: 1, acts: [{ kind: 'change', field: 'service', evidence: message, mention: null, confidence: .99, operationIndexes: [0] }] } } : {}),firstReply:{opening:framing?'Bien, gracias por preguntar.':null,closing:null,factIds:input.firstReplyFacts?.map(f=>f.id)??[],variantChoices:null}}},
 {respond:async(input:{facts:readonly {id:string;text:string}[]})=>{calls++;return {opening:null,closing:null,factIds:input.facts.map(f=>f.id),variantChoices:null}}}) as AiInterpretationProvider
 const response=await respondWithAiInterpreter(context,state,message,identity?{...port,identity:async()=>({businessId:context.businessId,assistantName:'Asistente',businessName:'Local',treatment:'vos'})}:port,provider)
 return {response,calls}
}
const cases: {name:string;run:()=>Promise<void>|void}[]=[]
const test=(name:string,run:()=>Promise<void>|void)=>cases.push({name,run})
for(const message of ['hola','hola que tal chicos como estan','hola como estan muchachos','holis']) test('social '+message,async()=>{
 const {response,calls}=await say(initial(),message)
 assert.equal(calls,1);assert.doesNotMatch(response.reply,/No pude identificar/);assert.match(response.reply,/ayudar/)
 assert.equal(response.state.serviceId,null);assert.equal(response.proposal,null)
 assert.equal(response.interpretation.replyValidation?.firstCall.status,'accepted')
})
test('social continuation keeps every pending field',async()=>{
 for(const pending of ['service','professional','estimate'] as const){
  const state:DialogueState={...initial(),serviceId:'cut-w',pending,date:'2026-10-04',customerName:'Ana'}
  const {response,calls}=await say(state,'holis')
  assert.equal(calls,1);assert.doesNotMatch(response.reply,/No pude identificar/)
  assert.equal(response.state.serviceId,'cut-w');assert.equal(response.state.date,state.date);assert.equal(response.state.customerName,'Ana')
 }
})
test('intro is once and protects identity',async()=>{
 const first=await say(initial(),'hola como estan muchachos',[], 'other',true,true)
 assert.equal(first.calls,1);assert.equal(first.response.state.introduced,true)
 assert.equal(first.response.reply.match(/Soy Asistente/g)?.length,1)
 const next=await say(first.response.state,'holis',[],'other',true,true)
 assert.equal(next.calls,1);assert.doesNotMatch(next.response.reply,/Soy Asistente/)
})
test('other cannot suppress verified booking or unknown service',async()=>{
 const selected=await say(initial(),'Corte mujer',[{kind:'service',mode:'single',serviceIds:['cut-w'],correction:false,...ev('Corte mujer')}])
 assert.equal(selected.response.state.serviceId,'cut-w')
 const beforeUnknown=agenda
 const unknown=await say(initial(),'servicio inexistente',[{kind:'service',mode:'unresolved',serviceIds:[],correction:false,...ev('servicio inexistente')}])
 assert.match(unknown.response.reply,/No tengo información confirmada sobre «servicio inexistente»/)
 assert.match(unknown.response.reply,/resultado que buscás/)
 assert.doesNotMatch(unknown.response.reply,/¿Querés consultarlo/,'unknown procedure clarifies the desired result before a generic referral')
 assert.doesNotMatch(unknown.response.reply,/no (?:lo )?hacemos|foto|requiere consulta|reservado/i)
 assert.equal(unknown.response.state.serviceId,null);assert.equal(unknown.response.proposal,null)
 assert.equal(unknown.response.bookingCommand,undefined);assert.equal(unknown.response.state.sandboxReservation,undefined)
 assert.equal(agenda,beforeUnknown,'unknown procedure does not invoke agenda or booking effects')
 const booking=await say(initial(),'quiero reservar',[],'booking')
 assert.match(booking.response.reply,/¿Qué servicio necesitás\\?/);assert.doesNotMatch(booking.response.reply,/No pude identificar/)
 assert.equal(booking.calls,1);assert.equal(booking.response.proposal,null)
})
test('initial fields are acquired not changes',()=>{
 const before=initial(),after:DialogueState={...before,date:'2026-10-04',customerName:'Ana',requestedTime:'13:00',professional:{kind:'any'}}
 assert.equal(appliedChangeAcknowledgment(before,after,services,{changedFields:['date','name','time','professional'],appliedFields:['date','name','time','professional'],requestedChanges:[],rejectedProfessionalPreference:false}),'')
 assert.match(appliedChangeAcknowledgment({...before,date:'2026-10-03'},after,services,{changedFields:['date'],appliedFields:['date'],requestedChanges:[],rejectedProfessionalPreference:false}),/cambié/)
})
test('partial basket describes whole request before asking one group',async()=>{
 const response=await say(initial(),'corte y Coloración',[basket([member('alternatives',['cut-m','cut-w'],'corte'),member('single',['color'],'Coloración')],'corte y Coloración')],'booking')
 assert.match(response.response.reply,/corte y Coloración/i)
 assert.ok(response.response.reply.indexOf('Coloración')<response.response.reply.indexOf('¿'))
 assert.match(response.response.reply,/Corte hombre/);assert.match(response.response.reply,/Corte mujer/)
 assert.equal(response.calls,1,'prepared clarification does not need another style call')
 assert.equal(selectionBasket(response.response.state).members[1]?.serviceIds[0],'color')
 const chosen=await say(response.response.state,'Corte mujer',[{...basket([member('single',['cut-w'],'Corte mujer')],'Corte mujer','replace'),scope:'members',targetMemberIds:[selectionBasket(response.response.state).members[0]!.memberId]}],'booking')
 // Closed answer is scoped to the displayed group, not to its companion.
 assert.deepEqual(selectionBasket(chosen.response.state).members.flatMap(m=>m.serviceIds),['cut-w','color'])
 assert.equal(chosen.response.state.pending,'estimate',JSON.stringify({reply:chosen.response.reply,diagnostic:chosen.response.interpretation,estimates:chosen.response.state.serviceEstimates}));assert.match(chosen.response.reply,/Qué largo/)
})
test('unique retained draft reference wins before catalog expansion',async()=>{
 const state:DialogueState={...initial(),pending:'date',basket:{version:1,nextMemberId:3,members:[{memberId:'m1',mode:'single',serviceIds:['cut-w'],evidence:'Corte mujer'},{memberId:'m2',mode:'single',serviceIds:['bath'],evidence:'Baño de crema'}]}}
 const result=await say(state,'mejor sólo el corte',[basket([member('single',['cut-w'],'corte')],'mejor sólo el corte','replace')],'booking')
 assert.deepEqual(selectionBasket(result.response.state).members.flatMap(m=>m.serviceIds),['cut-w'])
 const ambiguous={...state,basket:{...state.basket!,members:[...state.basket!.members,{memberId:'m3',mode:'single' as const,serviceIds:['cut-m'],evidence:'Corte hombre'}],nextMemberId:4}}
 const uncertain=await say(ambiguous,'mejor sólo el corte',[basket([member('single',['cut-w'],'corte')],'mejor sólo el corte','replace')],'booking')
 assert.equal(selectionBasket(uncertain.response.state).members[0]?.mode,'alternatives')
 const explicit=await say(state,'mejor sólo Corte hombre',[basket([member('single',['cut-m'],'Corte hombre')],'mejor sólo Corte hombre','replace')],'booking')
 assert.deepEqual(selectionBasket(explicit.response.state).members.flatMap(m=>m.serviceIds),['cut-m'])
})
test('accepted canonical composition has honest provenance',async()=>{
 const stable=await say(initial(),'holis',[],'other',false)
 assert.equal(stable.calls,1)
 assert.equal(stable.response.interpretation.replyValidation?.firstCall.status,'accepted')
 assert.equal((stable.response.interpretation as unknown as {deliveryOrigin:string}).deliveryOrigin,'validated_canonical')
})
test('unsafe social drafting never buys a second call',async()=>{
 let calls=0
 const provider=Object.assign(async(input:AiInterpretationInput)=>{calls++;return {...candidate([]),firstReply:{opening:'Confirmé tu turno gratis por $50',closing:null,factIds:input.firstReplyFacts!.map(f=>f.id),variantChoices:null}}},
 {respond:async()=>{calls++;throw new Error('style retry is forbidden')}}) as AiInterpretationProvider
 const response=await respondWithAiInterpreter(context,initial(),'holis',port,provider)
 assert.equal(calls,1);assert.equal(response.proposal,null);assert.equal(response.state.serviceId,null)
 assert.doesNotMatch(response.reply,/Confirmé|gratis|50/)
 assert.equal(response.interpretation.replyValidation?.firstCall.status,'rejected')
 assert.equal(response.interpretation.deliveryOrigin,'server_fallback')
})
test('partial acknowledgment does not duplicate prepared transitions',async()=>{
 const state:DialogueState={...initial(),serviceId:'bath',pending:'date',date:'2026-10-04'}
 const changed=await say(state,'mejor Corte mujer',[basket([member('single',['cut-w'],'Corte mujer')],'Corte mujer','replace')],'booking')
 assert.equal(selectionBasket(changed.response.state).members[0]?.serviceIds[0],'cut-w')
 assert.match(changed.response.reply,/seguimos sólo con Corte mujer/i)
 assert.ok((changed.response.reply.match(/Perfecto/g)??[]).length<=1)
 assert.equal(changed.response.reply.match(/[?¿]/g)?.length,2,'one missing-field question')
})
let failures=0
for(const item of cases){try{await item.run();console.log('PASS '+item.name)}catch(error){failures++;console.error('FAIL '+item.name,error)}}
assert.ok(agenda <= 2,'only legitimate booking progression may query agenda')
assert.equal(failures,0)