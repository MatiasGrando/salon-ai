import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider, type InterpretationDiagnostics } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import type { ConversationAiDiagnostic } from '../src/conversational-bot/whatsapp-ai.js'
const context={businessId:'standard',timezone:'America/Argentina/Buenos_Aires',dbNow:new Date('2026-10-03T12:00:00Z')}
const port:DialoguePort={catalog:async()=>[{id:'cut',name:'Corte',price:12000,durationMinutes:30,requiresConsultation:false}],availability:async()=>{throw new Error('agenda forbidden')},identity:async()=>({businessId:context.businessId,assistantName:'Alba',businessName:'Local',treatment:'vos',greetingEmoji:'😊'})}
globalThis.fetch=(()=>{throw new Error('network forbidden')}) as typeof fetch
const base={intent:'other',serviceId:null,serviceEvidence:null,professionalMention:null}
const initial=()=>initialDialogueState(context.businessId)
const service={kind:'service',mode:'single',serviceIds:['cut'],correction:false,evidence:'Corte',confidence:.99}
async function say(state:DialogueState,message:string,operations:object[]=[],raw?:unknown,selectedPort:DialoguePort=port){
 let calls=0
 const provider=Object.assign(async(input:AiInterpretationInput)=>{calls++;return {...base,turnPlan:{version:1,operations},firstReply:raw===undefined?{opening:'Bien, gracias por preguntar.',closing:null,factIds:input.firstReplyFacts?.map(f=>f.id)??[],variantChoices:null}:raw}}, {respond:async()=>{calls++;throw new Error('style call forbidden')}}) as AiInterpretationProvider
 const result=await respondWithAiInterpreter(context,state,message,selectedPort,provider)
 assert.equal(calls,1);assert.equal(result.interpretation.aiCalls,1);return result
}
const cases:{name:string;run:()=>Promise<void>|void}[]=[]
const test=(name:string,run:()=>Promise<void>|void)=>cases.push({name,run})
test('initial social answer and single introduction',async()=>{
 const first=await say(initial(),'hola, cómo están')
 assert.match(first.reply,/Soy Alba, de Local/);assert.match(first.reply,/Bien, gracias/);assert.match(first.reply,/ayudar/)
 assert.equal(first.reply.match(/hol+a/gi)?.length,1)
 const second=await say(first.state,'cómo están')
 assert.doesNotMatch(second.reply,/Soy Alba/);assert.match(second.reply,/Bien, gracias/)
 assert.equal(second.interpretation.copyMode,'ai')
 const third=await say(second.state,'Corte',[service])
 assert.doesNotMatch(third.reply,/Soy Alba/);assert.equal(third.state.serviceId,'cut')
})
test('social plus concrete prepared pending uses server body',async()=>{
 const result=await say(initial(),'hola cómo están, quiero Corte',[service])
 assert.match(result.reply,/Bien, gracias/);assert.match(result.reply,/Corte/);assert.match(result.reply,/día/)
 assert.doesNotMatch(result.reply,/En qué.*ayudar|qué servicio necesitás/i)
 assert.equal(result.reply.match(/hol+a/gi)?.length,1);assert.equal(result.state.serviceId,'cut');assert.equal(result.state.pending,'date')
 assert.equal(result.proposal,null);assert.equal(result.bookingCommand,undefined)
})
test('prepared null draft is intentional',async()=>{
 const result=await say(initial(),'Corte',[service],null)
 assert.equal(result.interpretation.copyMode,'prepared');assert.equal(result.interpretation.copyReason,null)
 assert.equal(result.interpretation.deliveryOrigin,'prepared');assert.match(result.reply,/Corte/);assert.match(result.reply,/día/)
})
test('canonical booking menu has only configured hello',async()=>{
 const result=await respondWithAiInterpreter(context,initial(),'hola quiero reservar',port,async()=>({...base,intent:'booking',turnPlan:null,firstReply:null}))
 assert.equal(result.reply.match(/hol+a/gi)?.length,1);assert.match(result.reply,/Qué servicio necesitás/);assert.doesNotMatch(result.reply,/Te ayudo con tu turno/)
})
test('invalid shape or material frame is never rescued',async()=>{
 for(const raw of [
 {opening:'Bien, gracias.',factIds:'bad',closing:null},
 {opening:'Bien, gracias.',factIds:[],closing:null,extra:true},
 {opening:'Precio $90',factIds:[],closing:null},
 {opening:'Tenemos disponibilidad mañana',factIds:[],closing:null},
 {opening:'Soy Otra',factIds:[],closing:null},
 {opening:'Confirmé el turno',factIds:[],closing:null},
 {opening:'Hola, bien.',factIds:[],closing:null},
 {opening:'Bien.',factIds:[],closing:'Precio $90'},
 {opening:'Bien.',factIds:[],closing:null,variantChoices:[{factId:'alien',variantId:'invented'}]}
 ]){
 const result=await say(initial(),'Corte',[service],raw)
 assert.doesNotMatch(result.reply,/Bien|90|disponibilidad|Otra|Confirmé/)
 assert.equal(result.state.serviceId,'cut');assert.equal(result.interpretation.replyValidation?.firstCall.status,'rejected')
 assert.doesNotMatch(JSON.stringify(result.interpretation.replyValidation),/standard|Alba|Corte|alien|90/)
 }
})
test('full draft keeps membership ordering and pending opening',()=>{
 const facts=[{id:'data',text:'Hecho.'},{id:'next',text:'¿Qué día?'}]
 const contract=replyContract('continuation',true,false,facts)
 const draft={opening:'Bien, gracias.',factIds:['data','next'],closing:null}
 const result=validateReplyDraft(draft,facts,contract,[])
 assert.equal(result.validation.status,'accepted');assert.match(result.text!,/Bien, gracias/);assert.equal(result.modelFraming,true)
 assert.equal(validateReplyDraft({...draft,factIds:['next','data']},facts,contract,[]).validation.reason,'fact_order')
 assert.equal(validateReplyDraft({...draft,opening:'Hola, bien.'},facts,contract,[]).validation.status,'rejected')
})
test('social answer survives prepared neutral acknowledgment',async()=>{
 const policy={id:'cut',name:'Corte',attentionMode:'GUIDED_ESTIMATE' as const,price:12000,priceMode:'STARTING_AT' as const,estimateAllowsBooking:true,estimateQuestion:'¿Qué largo tenés?',estimateOptions:[{id:'short',label:'Corto',priceMin:12000,priceMax:15000,note:null}],estimateExplanation:'Depende del largo.',estimateDisclaimer:'Sujeto a evaluación.',requiresPhoto:false,validationEnabled:false,validationMessage:null,validationQuestion:null}
 const guidedPort:DialoguePort={...port,catalog:async()=>[{id:'cut',name:'Corte',price:12000,priceMode:'STARTING_AT',durationMinutes:30,requiresConsultation:false,bookingPolicy:policy}]}
 const state:DialogueState={...initial(),introduced:true,serviceId:'cut',pending:'estimate',customerName:'Ana'}
 const name={kind:'name',value:'Eva',evidence:'Eva',confidence:.99}
 const result=await say(state,'cómo están, mi nombre es Eva',[name],undefined,guidedPort)
 assert.match(result.reply,/Bien, gracias/);assert.match(result.reply,/actualicé el nombre a Eva/i)
 assert.equal(result.state.customerName,'Eva');assert.equal(result.state.serviceId,'cut')
 assert.equal(result.reply.match(/actualicé el nombre/gi)?.length,1)
 assert.match(result.reply,/12.000/);assert.match(result.reply,/Sujeto a evaluación/);assert.ok(result.reply.endsWith('¿Qué largo tenés?'))
 const unsafe=await say(state,'mi nombre es Eva',[name],{opening:'Actualicé el nombre a Eva',factIds:result.replyFacts?.filter(f=>f.id!=='acknowledgment').map(f=>f.id),closing:null},guidedPort)
 assert.equal(unsafe.reply.match(/actualicé el nombre/gi)?.length,1);assert.equal(unsafe.interpretation.replyValidation?.firstCall.status,'rejected')
})
test('deterministic menu and preview keep identity and prepared provenance',async()=>{
 const direct=await respond(context,initial(),'hola quiero reservar',port)
 assert.equal(direct.reply.match(/hol+a/gi)?.length,1);assert.match(direct.reply,/Qué servicio necesitás/)
 let delivered=''
 const preview=await runConversationalPreview({load:async()=>initial(),save:async(_phone,_inbound,reply)=>{delivered=reply},createPort:async()=>({context,port}),interpretationProvider:async()=>({...base,turnPlan:{version:1,operations:[service]},firstReply:null})},context.businessId,'offline-only','Corte')
 assert.equal(delivered,preview.reply);assert.match(preview.reply,/Corte/);assert.doesNotMatch(preview.reply,/Respaldo|fallback/)
 const diagnostic=preview.interpretation as InterpretationDiagnostics
 assert.equal(diagnostic.copyMode,'prepared');assert.equal(diagnostic.copyReason,null)
 const channelCopyMode:ConversationAiDiagnostic['copyMode']=diagnostic.copyMode
 assert.equal(channelCopyMode,'prepared')
})
let failures=0
for(const item of cases){try{await item.run();console.log('PASS '+item.name)}catch(error){failures++;console.error('FAIL '+item.name,error)}}
assert.equal(failures,0)
