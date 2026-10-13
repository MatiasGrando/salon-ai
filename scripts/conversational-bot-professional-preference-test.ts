import assert from 'node:assert/strict'
import { respond, initialDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
const context = { businessId:'tenant',timezone:'America/Argentina/Buenos_Aires',dbNow:new Date('2026-10-01T12:00:00Z') }
const services = [{id:'cut',name:'Corte',durationMinutes:30,price:100,requiresConsultation:false},{id:'straight',name:'Alisado',durationMinutes:60,price:200,requiresConsultation:false}]
const cin = {id:'cin',name:'Cin',priority:0}, ramiro={id:'ramiro',name:'Ramiro',priority:1}
const state: DialogueState = {...initialDialogueState('tenant'),pending:'professional',basket:{version:1,nextMemberId:3,members:[{memberId:'m1',mode:'single',serviceIds:['cut'],evidence:'corte'},{memberId:'m2',mode:'single',serviceIds:['straight'],evidence:'alisado'}]},date:'2026-10-02',requestedTime:null,timePreference:{kind:'after',time:'15:00'},customerName:'Matias'}
let queries: (string|undefined)[]=[]
const proof = {businessId:'tenant',serviceIds:['cut','straight'],professional:ramiro,cause:'SERVICE_MISMATCH',missingServices:[{id:'straight',name:'Alisado'}]}
const port:DialoguePort={catalog:async()=>services,professionalInformation:async()=>({businessId:'tenant',complete:true,professionals:[cin,ramiro].map(p=>({...p,services:[],schedule:null}))}),availability:async()=>{throw Error('joint only')},availabilityBasket:async(requested,date,id)=>{queries.push(id);return id==='ramiro'?{ok:false,reason:'PREFERRED_PROFESSIONAL_INCOMPATIBLE',professionals:[cin],professionalFailure:proof} as any:{ok:true,services:requested,durationMinutes:90,totalPrice:300,professionals:[cin],slots:[]}}}
const response=await respond(context,state,'con Ramiro',port,{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'})
assert.doesNotMatch(response.reply,/No encuentro/i,'public existing identity must reach fresh eligibility, not become unknown')
assert.match(response.reply,/Ramiro.*Alisado/s)
assert.deepEqual(response.state.professional,{kind:'specific',id:'ramiro'})
assert.deepEqual(response.state.basket,state.basket);assert.equal(response.state.date,state.date);assert.deepEqual(response.state.timePreference,state.timePreference)
assert.equal(response.state.slot,null);assert.equal(response.proposal,null);assert.equal(response.state.pending,'professional')
assert.ok(queries.includes('ramiro'))
assert.ok(response.choicePresentation?.choices.some(c=>c.operation.kind==='professional' && c.operation.professionalId==='cin'))
const restricted=await respond(context,state,'con Ramiro',{...port,availabilityBasket:async(requested,date,id)=>id ? ({ok:false,reason:'PREFERRED_PROFESSIONAL_INCOMPATIBLE',professionals:[cin],professionalFailure:{...proof,cause:'BOOKING_RESTRICTED',missingServices:[]}} as any) : {ok:true,services:requested,durationMinutes:90,totalPrice:300,professionals:[cin],slots:[]}},{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'})
assert.match(restricted.reply,/Ramiro.*(?:equipo|canal|reserva)/s);assert.doesNotMatch(restricted.reply,/no realiza|no ofrece/)
const ambiguous=await respond(context,state,'con Ramiro',{...port,professionalInformation:async()=>({businessId:'tenant',complete:true,professionals:[{...ramiro,name:'Ramiro Perez',services:[],schedule:null},{id:'ramiro2',name:'Ramiro Lopez',services:[],schedule:null}]})},{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'})
assert.equal(ambiguous.state.professional,null);assert.equal(ambiguous.proposal,null)
await assert.rejects(()=>respond(context,state,'con Ramiro',{...port,professionalInformation:async()=>({businessId:'foreign',complete:true,professionals:[]})},{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'}),/professional.*scope/)
console.log('professional preference identity/fresh authority, restriction, draft preservation, ambiguity, tenant PASS')
import { respondConversationChoice } from '../src/conversational-bot/engine.js'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
const scope={businessId:'tenant',conversationKey:'qa',policyKey:'qa',policyGeneration:1,revision:'1'}
const question=issueChoiceQuestion(scope,response.state,response.choicePresentation!)
const publicQuestion=publicChoiceQuestion(question)
const cinIndex=response.choicePresentation!.choices.findIndex(c=>c.operation.kind==='professional' && c.operation.professionalId==='cin')
const cinOperation=resolveChoice(question,scope,response.state,publicQuestion.choices[cinIndex]!.id).operation
const chosen=await respondConversationChoice(context,response.state,cinOperation,port)
assert.deepEqual(chosen.state.professional,{kind:'specific',id:'cin'},'explicit verified alternative must escape rejected preference')
const information=await respond(context,state,'Ramiro no atiende?',port,{serviceId:null,candidateIds:[],correction:false,intent:'information',informationTarget:{kind:'professional',actions:[],mention:'Ramiro',serviceIds:[],date:null,weekday:null,aspect:'overview'}})
assert.match(information.reply,/Ramiro.*Alisado/s,'contextual information must explain fresh basket compatibility')
assert.equal(information.state.professional,null,'a professional question is not a preference change')
assert.deepEqual(information.state.basket,state.basket);assert.equal(information.state.date,state.date);assert.deepEqual(information.state.timePreference,state.timePreference)
assert.equal(information.proposal,null)
const inquiryState: DialogueState = {...state,professional:{kind:'specific',id:'tamara'},pending:'time',requestedTime:'16:00',slot:null}
delete inquiryState.timePreference
const gasparSlots = ['16:00','15:30','16:30'].map(time=>({date:inquiryState.date!,time,startAt:'2026-10-02T'+String(Number(time.slice(0,2))+3).padStart(2,'0')+time.slice(2)+':00.000Z',professionalId:'gaspar',professionalName:'Gaspar',band:'AFTERNOON' as const,occupiedMinutes:0}))
let inquiryAvailabilityCalls=0
const availabilityInquiry=await respond(context,inquiryState,'y con Gaspar tiene disponibilidad?',{
  ...port,
  professionalInformation:async()=>({businessId:'tenant',complete:true,professionals:[{id:'gaspar',name:'Gaspar',services:[],schedule:null}]}),
  availabilityBasket:async(requested,date,professionalId,_estimates,temporal)=>{
    inquiryAvailabilityCalls++;assert.equal(date,inquiryState.date);assert.equal(professionalId,'gaspar')
    assert.deepEqual(requested.map(service=>service.id),['cut','straight']);assert.equal(temporal?.requestedTime,'16:00')
    return {ok:true,services:requested,durationMinutes:90,totalPrice:300,professionals:[{id:'gaspar',name:'Gaspar',priority:0}],slots:gasparSlots}
  }
},{serviceId:null,candidateIds:[],correction:false,intent:'information',informationTarget:{kind:'professional',actions:[],mention:'Gaspar',serviceIds:[],date:inquiryState.date,weekday:null,aspect:'availability'}})
assert.equal(inquiryAvailabilityCalls,1,'a schedule inquiry should check fresh slots for the named alternative')
assert.deepEqual(availabilityInquiry.state.professional,inquiryState.professional,'availability inquiry must not replace the selected professional')
assert.equal(availabilityInquiry.state.date,inquiryState.date);assert.equal(availabilityInquiry.state.requestedTime,'16:00')
assert.deepEqual(availabilityInquiry.state.basket,inquiryState.basket);assert.equal(availabilityInquiry.proposal,null)
assert.match(availabilityInquiry.reply,/Gaspar/)
assert.equal(availabilityInquiry.choicePresentation?.kind,'slot','actual slots should be selectable')
assert.deepEqual(availabilityInquiry.choicePresentation?.choices.map(choice=>choice.operation.kind),['slot'])
assert.deepEqual(availabilityInquiry.choicePresentation?.choices.map(choice=>choice.operation.kind==='slot'?choice.operation.professionalId:null),['gaspar'])
assert.deepEqual(availabilityInquiry.choicePresentation?.choices.map(choice=>choice.operation.kind==='slot'?choice.operation.time:null),['16:00'])
const alternateQuestion=issueChoiceQuestion(scope,availabilityInquiry.state,availabilityInquiry.choicePresentation!)
const alternatePublic=publicChoiceQuestion(alternateQuestion)
const alternateOption=resolveChoice(alternateQuestion,scope,availabilityInquiry.state,alternatePublic.choices[0]!.id).operation
const explicitAlternativeQueries: string[]=[]
const selectedAlternate=await respondConversationChoice(context,availabilityInquiry.state,alternateOption,{
  ...port,
  availabilityBasket:async(requested,date,professionalId,_estimates,temporal)=>{
    explicitAlternativeQueries.push(String(professionalId));assert.equal(date,inquiryState.date);assert.equal(temporal?.requestedTime,'16:00')
    return {ok:true,services:requested,durationMinutes:90,totalPrice:300,professionals:[{id:'gaspar',name:'Gaspar',priority:0}],slots:gasparSlots}
  }
})
assert.ok(explicitAlternativeQueries.length>=1,'an explicit slot selection must revalidate the alternate professional live')
assert.ok(explicitAlternativeQueries.every(id=>id==='gaspar'),'every fresh check after choosing must retain the explicitly selected alternative')
assert.deepEqual(selectedAlternate.state.professional,{kind:'specific',id:'gaspar'},'only clicking a fresh alternate slot adopts that professional')
assert.equal(selectedAlternate.state.slot?.professionalId,'gaspar')
import { professionalFailureMessage } from '../src/conversational-bot/professional-preference.js'
for(const bad of [{...proof,businessId:'foreign'},{...proof,serviceIds:['cut']},{...proof,missingServices:[{id:'straight',name:'Foreign name'}]},{...proof,missingServices:[{id:'foreign',name:'Alisado'}]}]) assert.throws(()=>professionalFailureMessage(bad as any,'tenant',services,'ramiro'),/eligibility proof scope/)
const emptyAlternatives=await respond(context,state,'con Ramiro',{...port,availabilityBasket:async(_selected,_date,id)=>id?{ok:false,reason:'PREFERRED_PROFESSIONAL_INCOMPATIBLE',professionals:[],professionalFailure:proof} as any:{ok:false,reason:'NO_COMMON_PROFESSIONAL'}},{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'})
assert.match(emptyAlternatives.reply,/Ramiro.*Alisado/s);assert.deepEqual(emptyAlternatives.state.professional,{kind:'specific',id:'ramiro'});assert.equal(emptyAlternatives.proposal,null)

const unknown=await respond(context,state,'con Inventado',port,{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Inventado'})
assert.equal(unknown.state.professional,null);assert.equal(unknown.proposal,null);assert.match(unknown.reply,/No encuentro/)
for(const cause of ['PROFESSIONAL_NOT_WORKING','BUSY','BLOCKED'] as const){
  const compatiblePort:DialoguePort={...port,availabilityBasket:async(requested,date,id)=>({ok:true,services:requested,durationMinutes:90,totalPrice:300,professionals:[cin,ramiro],slots:[],explanation:{date,reasons:[cause],otherProfessionals:[],nextDates:[]}})}
  const current=await respond(context,state,'con Ramiro',compatiblePort,{serviceId:null,candidateIds:[],correction:false,intent:'booking',professionalMention:'Ramiro'})
  assert.deepEqual(current.state.professional,{kind:'specific',id:'ramiro'});assert.equal(current.state.date,state.date);assert.equal(current.availability?.reason,cause);assert.equal(current.proposal,null);assert.doesNotMatch(current.reply,/No encuentro/)
}
console.log('professional preference follow-on choice, lateral fresh verdict, proof/name guards, unknown, no-alternative and eligible calendar causes PASS')
