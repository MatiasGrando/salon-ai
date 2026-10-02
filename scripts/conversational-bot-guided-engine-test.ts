import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialogueService, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseTurnPlan, type TurnOperation } from '../src/conversational-bot/turn-plan.js'
import { serviceConfigurationKey, resolveServiceEstimate, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import { resolveGuidance, renderGuidedEstimates } from '../src/conversational-bot/service-guidance.js'
import { selectionSummary } from '../src/conversational-bot/service-basket.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
const context = {businessId:'tenant',timezone:'America/Argentina/Buenos_Aires',dbNow:new Date('2026-10-02T15:00:00Z')}
const policy = (id:string):ServiceBookingPolicy => ({id,name:id,attentionMode:'GUIDED_ESTIMATE',price:85000,priceMode:'STARTING_AT',estimateAllowsBooking:true,estimateQuestion:'¿Qué largo tenés?',estimateOptions:[{id:'short',label:'Hasta los hombros',priceMin:85000,priceMax:95000,note:null},{id:'long',label:'Debajo de los hombros',priceMin:95000,priceMax:110000,note:'Según evaluación'}],estimateExplanation:'El precio depende del largo.',estimateDisclaimer:'Presupuesto estimado sujeto a evaluación.',requiresPhoto:false,validationEnabled:false,validationMessage:null,validationQuestion:null})
const cut:DialogueService={id:'cut',name:'Corte hombre',price:27000,durationMinutes:30,requiresConsultation:false}
const smooth:DialogueService={id:'smooth',name:'Servicio guiado',price:85000,priceMode:'STARTING_AT',durationMinutes:90,professionalDurationMinutes:90,customerDurationMinutes:150,requiresConsultation:false,bookingPolicy:policy('smooth')}
let catalog=[cut,smooth];let legacy=0,joint=0,verified=0
const professionals=[{id:'rama',name:'Ramiro',priority:0}]
const slot=(date:string)=>({date,time:'17:00',startAt:date+'T20:00:00.000Z',professionalId:'rama',professionalName:'Ramiro',band:'AFTERNOON' as const,occupiedMinutes:0})
const port:DialoguePort={catalog:async()=>catalog,availability:async(_service,date)=>{legacy++;return{professionals,slots:[slot(date)]}},availabilityBasket:async(services,date,_id,_selections)=>{joint++;verified++;return{ok:true,services,durationMinutes:services.reduce((n,s)=>n+s.durationMinutes!,0),customerDurationMinutes:services.reduce((n,s)=>n+(s.customerDurationMinutes??s.durationMinutes!),0),totalPrice:services.some(s=>s.bookingPolicy?.attentionMode==='GUIDED_ESTIMATE')?null:selectionSummary(services).totalPrice,professionals,slots:[slot(date)]}}}
const ev=(evidence:string)=>({evidence,confidence:.99})
const choose=(serviceId:string,optionId:string|null,evidence:string):TurnOperation=>({kind:'estimate',serviceId,optionId,...ev(evidence)})
const date:TurnOperation={kind:'date',expression:'mañana',...ev('mañana')}
const time:TurnOperation={kind:'time',value:'17:00',...ev('17hs')}
const name:TurnOperation={kind:'name',value:'Matias',...ev('Matias')}
const prof:TurnOperation={kind:'professional',mode:'specific',mention:'Ramiro',...ev('Ramiro')}
const service=(ids:string[],evidence:string):TurnOperation=>({kind:'service',mode:ids.length===1?'single':'multiple',serviceIds:ids,correction:false,...ev(evidence)})
const say=(state:DialogueState,message:string,operations:TurnOperation[],p=port)=>respond(context,state,message,p,{serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations}})
const initial=()=>initialDialogueState(context.businessId)
const first=await say(initial(),'corte y guiado mañana con Ramiro soy Matias',[service(['cut','smooth'],'corte y guiado'),date,prof,name])
assert.equal(first.state.pending,'estimate');assert.equal(first.proposal,null);assert.equal(legacy+joint+verified,0);assert.match(first.reply,/Qué largo tenés/);assert.match(first.reply,/Hasta los hombros/);assert.match(first.reply,/El precio depende/);assert.match(first.reply,/Presupuesto estimado/)
assert.equal(first.state.date,'2026-10-03');assert.equal(first.state.customerName,'Matias');assert.equal(first.state.professionalNameHint,'ramiro')
const chosen=await say(first.state,'hasta los hombros',[choose('smooth','short','hasta los hombros')])
assert.equal(chosen.state.pending,'time');assert.equal(legacy,0);assert.ok(verified>0)
assert.deepEqual(chosen.state.serviceEstimates?.smooth,{configurationKey:serviceConfigurationKey(policy('smooth')),optionId:'short'})
const proposal=await say(chosen.state,'17hs',[time])
assert.deepEqual(proposal.proposal?.serviceIds,['cut','smooth']);assert.equal(proposal.proposal?.durationMinutes,120);assert.equal(proposal.proposal?.customerDurationMinutes,180);assert.equal(proposal.proposal?.totalPrice,null)
assert.match(proposal.reply,/85\.000 a \$ 95\.000/);assert.match(proposal.reply,/Presupuesto estimado/);assert.match(proposal.reply,/Todavía no está reservado/);assert.doesNotMatch(proposal.reply,/Total[^\n]*112\.000/)
const repeat=await say(proposal.state,'hasta los hombros',[choose('smooth','short','hasta los hombros')])
assert.equal(repeat.state.slot?.startAt,proposal.state.slot?.startAt,'same configured selection is idempotent')
const change=await say(proposal.state,'debajo de los hombros',[choose('smooth','long','debajo de los hombros')])
assert.equal(change.state.slot,null);assert.equal(change.state.requestedTime,null);assert.equal(change.state.date,'2026-10-03');assert.equal(change.state.customerName,'Matias')
const info:TurnOperation={kind:'information',target:{kind:'business',actions:['HOURS']},...ev('horarios')}
const before=verified
const interleaved=await say(first.state,'horarios',[info],{...port,information:async()=>({businessId:'tenant',name:'Local',address:null,area:null,mapsUrl:null,website:null,bookingUrl:null,whatsapp:null,email:null,instagram:null,facebook:null,tiktok:null,description:null,hours:'9 a 20'})})
assert.equal(interleaved.state.pending,'estimate');assert.equal(verified,before);assert.match(interleaved.reply,/9 a 20/)
const invalid=await say(proposal.state,'opción inexistente',[choose('smooth','foreign','opción inexistente')])
assert.equal(invalid.proposal,null);assert.equal(invalid.state.pending,'estimate');assert.equal(invalid.state.slot,null);assert.match(invalid.reply,/opción|Qué largo/)
const removed={...policy('smooth'),estimateOptions:[{id:'new',label:'Nuevo largo',priceMin:100000,priceMax:110000,note:null}]}
catalog=[cut,{...smooth,bookingPolicy:removed}]
const stale=await say(proposal.state,'17hs',[time])
assert.equal(stale.state.pending,'estimate');assert.equal(stale.state.slot,null);assert.equal(stale.state.serviceEstimates?.smooth,undefined);assert.match(stale.reply,/Nuevo largo/)
catalog=[cut,smooth]
await assert.rejects(()=>say(first.state,'hasta los hombros',[choose('foreign','short','hasta los hombros')]),/catalog|estimate|guidance/)
const double={...smooth,id:'color',name:'Segundo guiado',bookingPolicy:policy('color')}
catalog=[cut,smooth,double]
const two=await say(initial(),'guiado y color',[service(['smooth','color'],'guiado y color')])
assert.equal(two.state.pending,'estimate')
const firstOnly=await say(two.state,'hasta los hombros',[choose('smooth','short','hasta los hombros')])
assert.equal(firstOnly.state.pending,'estimate');assert.equal(firstOnly.state.serviceEstimates?.color,undefined);assert.match(firstOnly.reply,/Segundo guiado/)
const both=await say(firstOnly.state,'debajo de los hombros mañana con Ramiro',[choose('color','long','debajo de los hombros'),date,prof])
assert.equal(both.state.pending,'time');assert.equal(Object.keys(both.state.serviceEstimates??{}).length,2)
catalog=[cut,{...smooth,customerDurationMinutes:90,bookingPolicy:{...policy('smooth'),estimateOptions:[],estimateQuestion:null}}]
const auto=await say(initial(),'guiado mañana con Ramiro',[service(['smooth'],'guiado'),date,prof])
assert.notEqual(auto.state.pending,'estimate');assert.deepEqual(auto.state.serviceEstimates?.smooth,{configurationKey:serviceConfigurationKey(catalog[1]!.bookingPolicy!),optionId:null})
for(const fields of [{estimateAllowsBooking:false},{requiresPhoto:true},{validationEnabled:true},{attentionMode:'QUOTE' as const},{attentionMode:'ADVISOR' as const}]){
 catalog=[cut,{...smooth,bookingPolicy:{...policy('smooth'),...fields}}]
 const denied=await say(initial(),'corte y guiado mañana',[service(['cut','smooth'],'corte y guiado'),date])
 assert.equal(denied.proposal,null);assert.equal(denied.state.slot,null);assert.match(denied.reply,/equipo|foto|validación|presupuesto/)
}
catalog=[cut,{...smooth,bookingPolicy:{...policy('smooth'),estimateOptions:null}}]
const malformed=await say(initial(),'guiado',[service(['smooth'],'guiado')])
assert.equal(malformed.proposal,null);assert.doesNotMatch(malformed.reply,/requiere una consulta/);assert.match(malformed.reply,/configuración|datos/)
catalog=[cut,smooth]
const absent=await say(chosen.state,'17hs',[time],{...port,availabilityBasket:undefined} as unknown as DialoguePort)
assert.equal(absent.proposal,null);assert.equal(absent.state.slot,null);assert.match(absent.reply,/verificar|disponibilidad/)
const original=initial();assert.equal(parseDialogueState(original,'tenant').serviceEstimates,undefined)
assert.deepEqual(parseDialogueState(proposal.state,'tenant'),proposal.state)
const persisted=projectConversationDraft(first.state,{businessId:'tenant',revision:1,engine:'conversational-booking-v1'} as any)
assert.equal(readConversationDraft(persisted,persisted.conversationDraft.policy,context.timezone).pending,'estimate')
assert.throws(()=>parseDialogueState({...proposal.state,serviceEstimates:{foreign:{configurationKey:'x',optionId:'short'}}},'tenant'),/estimate|guidance/)
assert.throws(()=>parseDialogueState({...proposal.state,serviceEstimates:{smooth:{configurationKey:'x',optionId:'short',priceMin:1}}},'tenant'),/estimate|guidance/)
assert.throws(()=>parseTurnPlan({version:1,operations:[choose('smooth','short','hasta los hombros'),choose('smooth','long','hasta los hombros')]},'hasta los hombros'),/duplicate/)
assert.throws(()=>parseTurnPlan({version:1,operations:[{...choose('smooth','short','hasta los hombros'),price:1}]},'hasta los hombros'),/keys/)
assert.deepEqual(resolveServiceEstimate(policy('smooth'),'short'),{optionId:'short',optionLabel:'Hasta los hombros',priceMin:85000,priceMax:95000})

const noOptions = {...smooth,customerDurationMinutes:90,bookingPolicy:{...policy('smooth'),estimateOptions:[],estimateQuestion:null}}
catalog=[cut,noOptions]
const earlyTime=await say(initial(),'guiado mañana 17hs con Ramiro soy Matias',[service(['smooth'],'guiado'),date,time,prof,name])
assert.equal(earlyTime.proposal?.startAt,slot('2026-10-03').startAt,'the automatic base estimate preserves independently specified time')
catalog=[cut,smooth]
const optionAndTime=await say(first.state,'hasta los hombros 17hs',[choose('smooth','short','hasta los hombros'),time])
assert.equal(optionAndTime.proposal?.durationMinutes,120)
const reread=await say(proposal.state,'horarios',[info],{...port,information:async()=>({businessId:'tenant',name:'Local',address:null,area:null,mapsUrl:null,website:null,bookingUrl:null,whatsapp:null,email:null,instagram:null,facebook:null,tiktok:null,description:null,hours:'9 a 20'})})
assert.deepEqual(reread.state.serviceEstimates,proposal.state.serviceEstimates);assert.equal(reread.proposal,null)
assert.deepEqual(parseDialogueState({...initial(),serviceEstimates:null},'tenant').serviceEstimates,{})
for(const bad of [
 {...policy('smooth'),estimateOptions:[{id:'short',label:'Opción',priceMin:-1,priceMax:10,note:null}]},
 {...policy('smooth'),estimateQuestion:null},
 {...policy('smooth'),estimateDisclaimer:'x'.repeat(2001)},
 {...policy('smooth'),estimateOptions:Array.from({length:13},(_,n)=>({id:String(n),label:'Opción',priceMin:10,priceMax:20,note:null}))},
 {...policy('smooth'),attentionMode:'toString'}
]) {
 catalog=[cut,{...smooth,bookingPolicy:bad as ServiceBookingPolicy}]
 const failed=await say(initial(),'guiado',[service(['smooth'],'guiado')]);assert.equal(failed.proposal,null);assert.match(failed.reply,/configuración|datos/);assert.doesNotMatch(failed.reply,/requiere una consulta/)
}
catalog=[cut,smooth]
const missingDual=await say(chosen.state,'17hs',[time],{...port,availabilityBasket:async(services,date)=>({ok:true,services,durationMinutes:120,totalPrice:null,professionals,slots:[slot(date)]})})
assert.equal(missingDual.proposal,null);assert.equal(missingDual.state.slot,null)
await assert.rejects(()=>say(chosen.state,'17hs',[time],{...port,availabilityBasket:async(services,date)=>({ok:true,services,durationMinutes:120,customerDurationMinutes:120,totalPrice:null,professionals,slots:[slot(date)]})}),/customer duration/)

// Cached commercial metadata may lag the adapter's fresh scoped catalog validation.
const freshServices=[cut,{...smooth,bookingPolicy:{...policy('smooth'),estimateQuestion:'¿Qué largo tiene actualmente?',estimateOptions:[{id:'updated',label:'Largo actualizado',priceMin:120000,priceMax:130000,note:null}]}}]
let freshCatalogReads=0,freshAvailabilityReads=0
const freshPort:DialoguePort={...port,catalog:async()=>{freshCatalogReads++;return [cut,smooth]},availabilityBasket:async()=>{freshAvailabilityReads++;return {ok:false,reason:'GUIDANCE_REQUIRED',services:freshServices}}}
const refreshed=await say(proposal.state,'17hs',[time],freshPort)
assert.equal(refreshed.state.pending,'estimate','fresh guide reopens configured question rather than generic consultation')
assert.equal(refreshed.state.slot,null);assert.equal(refreshed.state.requestedTime,null);assert.equal(refreshed.proposal,null)
assert.equal(refreshed.state.dialogueContext?.presentedOffer,null);assert.equal(refreshed.state.dialogueContext?.lastQuestion,'¿Qué largo tiene actualmente?')
assert.equal(refreshed.state.serviceEstimates?.smooth,undefined);assert.match(refreshed.reply,/Largo actualizado/)
assert.deepEqual(refreshed.state.basket,proposal.state.basket);assert.equal(refreshed.state.customerName,'Matias');assert.equal(refreshed.state.date,'2026-10-03')
assert.deepEqual(refreshed.state.professional,proposal.state.professional);assert.equal(freshCatalogReads,1);assert.equal(freshAvailabilityReads,1)
assert.deepEqual(parseDialogueState(refreshed.state,'tenant'),refreshed.state)
for(const invalidServices of [[freshServices[1]!],[cut,{...freshServices[1]!,id:'foreign'}],[cut,cut],freshServices.toReversed()]){
 await assert.rejects(()=>say(proposal.state,'17hs',[time],{...port,availabilityBasket:async()=>({ok:false,reason:'GUIDANCE_REQUIRED',services:invalidServices})}),/fresh|guidance/)
}
for(const override of [{requiresPhoto:true},{validationEnabled:true},{estimateAllowsBooking:false},{estimateOptions:null}]){
 const badFresh=[cut,{...smooth,bookingPolicy:{...policy('smooth'),...override}}]
 const deniedFresh=await say(proposal.state,'17hs',[time],{...port,availabilityBasket:async()=>({ok:false,reason:'GUIDANCE_REQUIRED',services:badFresh})})
 assert.equal(deniedFresh.proposal,null);assert.equal(deniedFresh.state.slot,null);assert.equal(deniedFresh.state.pending,'service');assert.deepEqual(deniedFresh.state.basket,proposal.state.basket)
 assert.match(deniedFresh.reply,/foto|validación|presupuesto|configuración/)
}
assert.equal(first.state.dialogueContext?.lastQuestion,policy('smooth').estimateQuestion,'configured question survives disclaimer after it')
// Automatic base estimates can be derived from verified fresh data, never stale human choices.
catalog=[cut,noOptions]
const updatedAutomatic={...noOptions,price:92000,bookingPolicy:{...noOptions.bookingPolicy,price:92000,estimateDisclaimer:'Condición actualizada.'}}
const freshAuto=await say(earlyTime.state,'17hs',[time],{...port,availabilityBasket:async(_services,date)=>({ok:true,services:[updatedAutomatic],durationMinutes:90,customerDurationMinutes:90,totalPrice:null,professionals,slots:[slot(date)]})})
assert.equal(freshAuto.state.pending,'time');assert.equal(freshAuto.state.slot,null);assert.equal(freshAuto.state.requestedTime,null,'updated configuration invalidates old time/offer')
assert.equal(freshAuto.state.customerName,'Matias');assert.equal(freshAuto.state.date,'2026-10-03')
assert.deepEqual(freshAuto.state.serviceEstimates?.smooth,{configurationKey:serviceConfigurationKey(updatedAutomatic.bookingPolicy),optionId:null})
const autoProposal=await say(freshAuto.state,'17hs',[time],{...port,catalog:async()=>[cut,updatedAutomatic],availabilityBasket:async(_services,date)=>({ok:true,services:[updatedAutomatic],durationMinutes:90,customerDurationMinutes:90,totalPrice:null,professionals,slots:[slot(date)]})})
assert.equal(autoProposal.proposal?.estimates?.smooth?.priceMin,92000);assert.match(autoProposal.reply,/92\.000/);assert.match(autoProposal.reply,/Condición actualizada/);assert.doesNotMatch(autoProposal.reply,/85\.000/)
const directFresh={...noOptions,priceMode:'FIXED' as const,bookingPolicy:{...noOptions.bookingPolicy,attentionMode:'DIRECT_BOOKING' as const,priceMode:'FIXED' as const}}
const becameDirect=await say(earlyTime.state,'17hs',[time],{...port,availabilityBasket:async(_services,date)=>({ok:true,services:[directFresh],durationMinutes:90,customerDurationMinutes:90,totalPrice:85000,professionals,slots:[slot(date)]})})
assert.equal(becameDirect.state.pending,'time');assert.equal(becameDirect.state.serviceEstimates?.smooth,undefined)
catalog=[cut,smooth]
await assert.rejects(()=>say(proposal.state,'17hs',[time],{...port,availabilityBasket:async(_services,date)=>({ok:true,services:freshServices,durationMinutes:120,customerDurationMinutes:180,totalPrice:null,professionals,slots:[slot(date)]})}),/guidance/)
for(const reason of ['PHOTO_REQUIRED','VALIDATION_REQUIRED','ESTIMATE_NOT_BOOKABLE','INVALID_CONFIGURATION','DOMAIN_REVIEW'] as const){
 const result=await say(proposal.state,'17hs',[time],{...port,availabilityBasket:async()=>({ok:false,reason})})
 assert.equal(result.proposal,null);assert.equal(result.state.slot,null);assert.deepEqual(result.state.basket,proposal.state.basket);assert.match(result.reply,/foto|validación|presupuesto|configuración|consulta/)
}
// Opaque IDs must remain own map keys, never inherited Object members or prototype setters.
assert.equal(renderGuidedEstimates([{...cut,id:'constructor'}],{}),'')
for(const id of ['constructor','__proto__']){
 const special={...smooth,id,bookingPolicy:policy(id)}
 const map=resolveGuidance([special],Object.fromEntries([[id,{configurationKey:serviceConfigurationKey(special.bookingPolicy),optionId:'short'}]]))
 assert.equal(map.pending,null);assert.equal(Object.hasOwn(map.selections,id),true);assert.equal(Object.hasOwn(map.estimates,id),true)
 assert.equal(map.estimates[id]?.priceMin,85000)
 catalog=[special]
 const specialQuestion=await say(initial(),'guiado mañana con Ramiro',[service([id],'guiado'),date,prof])
 const specialChoice=await say(specialQuestion.state,'hasta los hombros',[choose(id,'short','hasta los hombros')])
 assert.equal(specialChoice.state.pending,'time');assert.equal(Object.hasOwn(specialChoice.state.serviceEstimates!,id),true)
}
const reverseChoices=Object.fromEntries(['color','smooth'].map(id=>[id,{configurationKey:serviceConfigurationKey(policy(id)),optionId:'short'}]))
assert.equal(resolveGuidance([smooth,double],reverseChoices).changed,false,'choice map order does not invalidate identical configured decisions')
catalog=[cut,smooth]
const spuriousRefresh=await say(proposal.state,'17hs',[time],{...port,availabilityBasket:async()=>({ok:false,reason:'GUIDANCE_REQUIRED',services:[cut,smooth]})})
assert.equal(spuriousRefresh.proposal,null);assert.equal(spuriousRefresh.state.slot,null);assert.match(spuriousRefresh.reply,/verificar la disponibilidad/)
const directCut={...cut,priceMode:'FIXED' as const,bookingPolicy:{...policy('cut'),attentionMode:'DIRECT_BOOKING' as const,price:27000,priceMode:'FIXED' as const,estimateQuestion:null,estimateOptions:[]}}
const changedCut={...directCut,bookingPolicy:{...policy('cut'),price:27000,priceMode:'FIXED' as const}}
let bypassLegacy=0,explicitJoint=0
const directToGuided=await say(initial(),'corte mañana con Ramiro',[service(['cut'],'corte'),date,prof],{...port,catalog:async()=>[directCut],availability:async(_service,date)=>{bypassLegacy++;return {professionals,slots:[slot(date)]}},availabilityBasket:async()=>{explicitJoint++;return {ok:false,reason:'GUIDANCE_REQUIRED',services:[changedCut]}}})
assert.equal(directToGuided.state.pending,'estimate','explicit direct policy is fresh-checked before legacy agenda can lose the changed guide')
assert.equal(bypassLegacy,0);assert.equal(explicitJoint,1);assert.equal(directToGuided.state.date,'2026-10-03');assert.equal(directToGuided.proposal,null)
const autoChangedCut={...directCut,bookingPolicy:{...policy('cut'),price:27000,estimateOptions:[],estimateQuestion:null},priceMode:'STARTING_AT' as const}
const missingFreshGuidedProof=await say(initial(),'corte mañana con Ramiro soy Matias 17hs',[service(['cut'],'corte'),date,prof,name,time],{...port,catalog:async()=>[directCut],availabilityBasket:async(_services,date)=>({ok:true,services:[autoChangedCut],durationMinutes:30,totalPrice:null,professionals,slots:[slot(date)]})})
assert.equal(missingFreshGuidedProof.proposal,null);assert.equal(missingFreshGuidedProof.state.slot,null)
// Merchant paragraphs can carry ordinary CRM line breaks, not arbitrary control characters.
const multilinePolicy={...policy('smooth'),
 estimateExplanation:'El importe depende del largo.\nConsultá las condiciones.',
 estimateDisclaimer:'Estimado sujeto a evaluación.\r\nDescuento:\tconsultar.',
 validationMessage:'Primera condición.\nSegunda condición.'}
const multilineService={...smooth,bookingPolicy:multilinePolicy}
catalog=[cut,multilineService]
const multilineQuestion=await say(initial(),'guiado mañana con Ramiro',[service(['smooth'],'guiado'),date,prof])
assert.equal(multilineQuestion.state.pending,'estimate','legitimate multiline merchant configuration must remain usable')
assert.ok(multilineQuestion.reply.includes(multilinePolicy.estimateExplanation));assert.ok(multilineQuestion.reply.includes(multilinePolicy.estimateDisclaimer))
const multilineChoice=await say(multilineQuestion.state,'hasta los hombros',[choose('smooth','short','hasta los hombros')])
assert.equal(multilineChoice.state.pending,'time');assert.deepEqual(parseDialogueState(multilineChoice.state,'tenant'),multilineChoice.state)
for(const key of ['estimateExplanation','estimateDisclaimer','validationMessage'] as const){
 for(const control of ['\u0000','\u000b','\u001b']){
  catalog=[{...smooth,bookingPolicy:{...policy('smooth'),[key]:'Texto'+control}}]
  const denied=await say(initial(),'guiado',[service(['smooth'],'guiado')]);assert.equal(denied.proposal,null);assert.match(denied.reply,/configuración/)
 }
}
for(const key of ['name','estimateQuestion','validationQuestion'] as const){
 catalog=[{...smooth,bookingPolicy:{...policy('smooth'),[key]:'Texto\ncontinuación'}}]
 const denied=await say(initial(),'guiado',[service(['smooth'],'guiado')]);assert.match(denied.reply,/configuración/)
}
// An exact guided companion accepts its own answer while a different basket member is ambiguous.
const woman={...cut,id:'woman',name:'Corte mujer'}
catalog=[cut,woman,smooth,double]
const mixedOperation:TurnOperation={kind:'basket',mutation:'set',scope:'all',targetMemberIds:[],members:[
 {mode:'alternatives',serviceIds:['cut','woman'],...ev('corte')},
 {mode:'single',serviceIds:['smooth'],...ev('guiado')}],...ev('corte y guiado')}
const agendaBeforePartial=joint+legacy
const mixedRequest=await say(initial(),'corte y guiado mañana con Ramiro soy Matias',[mixedOperation,date,prof,name])
const partialChoice=await say(mixedRequest.state,'hasta los hombros',[choose('smooth','short','hasta los hombros')])
assert.equal(partialChoice.state.pending,'service');assert.equal(partialChoice.proposal,null);assert.equal(partialChoice.state.slot,null)
assert.equal(joint+legacy,agendaBeforePartial,'partial service basket never queries agenda')
assert.deepEqual(partialChoice.state.serviceEstimates?.smooth,{configurationKey:serviceConfigurationKey(policy('smooth')),optionId:'short'})
assert.equal(partialChoice.state.date,'2026-10-03');assert.equal(partialChoice.state.customerName,'Matias');assert.equal(partialChoice.state.professionalNameHint,'ramiro')
assert.match(partialChoice.reply,/Corte hombre/);assert.match(partialChoice.reply,/Corte mujer/)
const partialSnapshot=projectConversationDraft(partialChoice.state,{businessId:'tenant',revision:1,engine:'conversational-booking-v1'} as any)
assert.deepEqual(readConversationDraft(partialSnapshot,partialSnapshot.conversationDraft.policy,context.timezone).serviceEstimates,partialChoice.state.serviceEstimates)
const clarifiedAfterChoice=await say(partialChoice.state,'corte hombre',[service(['cut'],'corte hombre')])
assert.equal(clarifiedAfterChoice.state.pending,'time');assert.deepEqual(clarifiedAfterChoice.state.serviceEstimates,partialChoice.state.serviceEstimates)
assert.doesNotMatch(clarifiedAfterChoice.reply,/Qué largo/)
const together=await say(mixedRequest.state,'corte hombre y hasta los hombros',[service(['cut'],'corte hombre'),choose('smooth','short','hasta los hombros')])
assert.equal(together.state.pending,'time');assert.equal(together.state.serviceEstimates?.smooth?.optionId,'short')
const unsafeAlternative:TurnOperation={...mixedOperation,members:[{mode:'alternatives',serviceIds:['cut','color'],...ev('corte')},{mode:'single',serviceIds:['smooth'],...ev('guiado')}]}
const unchosenGuide=await say(initial(),'corte y guiado',[unsafeAlternative])
await assert.rejects(()=>say(unchosenGuide.state,'hasta los hombros',[choose('color','short','hasta los hombros')]),/guidance service target/)
assert.equal(unchosenGuide.state.serviceEstimates?.color,undefined)
console.log('guided service motor: configured estimates, per-service state, dual capacity, stale choice and safe proposal PASS')
