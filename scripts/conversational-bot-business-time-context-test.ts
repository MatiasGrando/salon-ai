import assert from 'node:assert/strict'
import { projectBusinessTimeContext } from '../src/conversational-bot/business-time-context.js'
import { approximateTimeRequest } from '../src/conversational-bot/time-preference.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

const context={businessId:'b',timezone:'UTC',dbNow:new Date('2026-10-08T09:00:00Z')}
const snapshot={businessId:'b',timezone:'UTC',stamp:'fixture',from:new Date('2026-10-08T00:00:00Z'),to:new Date('2026-10-12T00:00:00Z'),weeklyHours:[{dayOfWeek:5,startTime:'11:00',endTime:'20:00'}],globalBlocks:[]}
const body='Masomenos a las 5 tenés lugar?'
const times=approximateTimeRequest(body)!.candidateTimes
assert.deepEqual(projectBusinessTimeContext(snapshot,'2026-10-09',times)?.candidates,[{time:'05:00',status:'closed'},{time:'17:00',status:'open'}])
assert.equal(projectBusinessTimeContext(undefined,'2026-10-09',times),undefined)
assert.ok(projectBusinessTimeContext({...snapshot,globalBlocks:[{startAt:'2026-10-09T16:00:00Z',endAt:'2026-10-09T18:00:00Z'}]},'2026-10-09',times)?.candidates.some(c=>c.status==='unknown'),'unknown special hours never fabricate meaning')
const state={...initialDialogueState('b'),serviceId:'s',date:'2026-10-09',professional:{kind:'specific' as const,id:'p'},pending:'time' as const}
const slots=['16:30','17:00','17:30'].map(time=>({date:state.date,time,startAt:state.date+'T'+time+':00.000Z',professionalId:'p',professionalName:'Ana',band:'AFTERNOON' as const,occupiedMinutes:0}))
const port:DialoguePort={catalog:async()=>[{id:'s',name:'Corte',price:1000,durationMinutes:30,requiresConsultation:false}],businessTimeContext:(date,candidates)=>projectBusinessTimeContext(snapshot,date,candidates),availability:async()=>({professionals:[{id:'p',name:'Ana',priority:0}],slots})}
const provider:AiInterpretationProvider=async input=>{
  assert.deepEqual(input.businessTimeContext?.candidates,[{time:'05:00',status:'closed'},{time:'17:00',status:'open'}])
  return {intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations:[{kind:'time_preference',preference:{kind:'around',time:'17:00'},evidence:body,confidence:1}]},communicativeActs:{version:1,acts:[{kind:'request',field:'time',evidence:body,confidence:1,mention:null,operationIndexes:[0]}]}}
}
const response=await respondWithAiInterpreter(context,state,body,port,provider)
assert.equal(response.interpretation.mode,'ai')
assert.deepEqual(response.state.timePreference,{kind:'around',time:'17:00'})
assert.equal(response.state.slot,null,'an approximation offers alternatives, never selects a booking')
assert.equal(response.state.timeMeaningClarification,undefined,'closed AM counterpart is not offered as an ambiguity')
assert.equal(response.bookingCommand,undefined)
assert.match(response.reply,/17:00/)
console.log('business time meaning: PASS (known commercial scope, no occupancy authority, around choices, no network)')
