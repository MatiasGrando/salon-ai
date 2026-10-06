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
const act = (kind: string, field: string, evidence: string, operationIndexes: number[]) => ({kind,field,evidence,operationIndexes,mention:null,confidence:1})
const currentDayChange = {version:1,acts:[act('change','date','miércoles',[0]),act('request','time','tipo 4',[1])]}
const currentPeriod = (evidence: string) => ({version:1,acts:[act('answer','time',evidence,[0])]})
let proofReads = 0
const businessTimeContext: NonNullable<DialoguePort['businessTimeContext']> = (date,candidateTimes) => {
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
const continued = await respondWithAiInterpreter(context,pending,comment,port,async()=>({...legacy,communicativeActs:currentPeriod('de la tarde'),turnPlan:plan('de la tarde')}))
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
const morning = await respondWithAiInterpreter(context,pending,'de la mañana, no de la tarde',port,async()=>({...legacy,communicativeActs:currentPeriod('de la mañana'),turnPlan:plan('de la mañana')}))
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
}}, async()=>({...legacy,communicativeActs:currentDayChange,turnPlan:{version:1,operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',evidence:'miércoles',confidence:1},{kind:'time_clarification',candidateTimes:candidates,evidence:'tipo 4',confidence:1}]}}))
assert.equal(correctedDay.interpretation.mode,'ai');assert.equal(correctedDay.state.date,'2026-10-07')
assert.equal(nextProofDate,'2026-10-07','date correction uses proof for prospective day, never Tuesday proof')
assert.deepEqual(correctedDay.state.timeClarification,{candidateTimes:candidates})
assert.equal(correctedDay.state.timePreference,undefined);assert.equal(correctedDay.state.slot,null);assert.equal(correctedDay.proposal,null)
let pendingProviderDate: string | undefined
const pendingDayChange = await respondWithAiInterpreter(context,pending,'miércoles tipo 4', {...port,businessTimeContext:(date,times)=>projectBusinessTimeContext(snapshot,date,times)}, async input=>{
 pendingProviderDate=input.businessTimeContext?.date
 return {...legacy,communicativeActs:currentDayChange,turnPlan:{version:1,operations:[{kind:'date',expression:'miércoles',value:'2026-10-07',evidence:'miércoles',confidence:1},{kind:'time_clarification',candidateTimes:candidates,evidence:'tipo 4',confidence:1}]}}
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


// Q captured V11: an admitted precise approximation must replace an actual selected 17:00 slot.
const preciseChangeBody = 'En vez de ese horario, prefiero alrededor de las 11:00 del mismo día.'
const preciseChangeEvidence = 'alrededor de las 11:00'
let preciseProviderCalls = 0, preciseAgendaReads = 0, preciseProofReads = 0
const precisePort: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date) => {
    preciseAgendaReads++
    return {
      professionals: [{id:'p',name:'Leo',priority:0}],
      slots: ['11:00','17:00'].map(time => ({
        date, time, startAt: date + 'T' + (time === '11:00' ? '14' : '20') + ':00:00.000Z',
        professionalId:'p', professionalName:'Leo', band:'AFTERNOON' as const, occupiedMinutes:0
      }))
    }
  },
  businessTimeContext: () => { preciseProofReads++; return undefined }
}
const preciseBase: DialogueState = {
  ...selected,
  basket: {version:1,nextMemberId:2,members:[{memberId:'m1',mode:'single',serviceIds:['cut'],evidence:'Corte'}]}
}
const preciseBaseBefore = structuredClone(preciseBase)
const selectedSeventeen = await respondWithAiInterpreter(context, preciseBase, 'a las 17:00', precisePort, async () => ({
  ...legacy,
  turnPlan:{version:1,operations:[{kind:'time',value:'17:00',evidence:'a las 17:00',confidence:0.99}]},
  communicativeActs:{version:1,acts:[{...act('answer','time','a las 17:00',[0]),confidence:0.99}]}
}))
assert.equal(selectedSeventeen.interpretation.mode,'ai')
assert.equal(selectedSeventeen.state.slot?.time,'17:00', 'the prior selection came from a fresh real offer')
assert.equal(selectedSeventeen.state.requestedTime,'17:00')
assert.deepEqual(preciseBase,preciseBaseBefore)
const precisePrior = structuredClone(selectedSeventeen.state)
const preciseCandidate = {
  ...legacy,
  turnPlan:{version:1,operations:[{kind:'time_preference',preference:{kind:'around',time:'11:00'},evidence:preciseChangeEvidence,confidence:0.99}]},
  communicativeActs:{version:1,acts:[{...act('change','time',preciseChangeBody,[0]),confidence:0.99}]}
}
const preciseCandidateBefore = structuredClone(preciseCandidate)
const beforePreciseAgenda = preciseAgendaReads, beforePreciseProof = preciseProofReads
const preciseChanged = await respondWithAiInterpreter(context, selectedSeventeen.state, preciseChangeBody, precisePort, async () => {
  preciseProviderCalls++
  return preciseCandidate
})
assert.equal(preciseChanged.interpretation.mode,'ai')
assert.deepEqual(preciseChanged.state.timePreference,{kind:'around',time:'11:00'})
assert.equal(preciseChanged.state.timeClarification,undefined)
assert.equal(preciseChanged.state.timeMeaningClarification,undefined)
assert.equal(preciseChanged.state.slot,null)
assert.equal(preciseChanged.state.requestedTime,null)
assert.equal(preciseChanged.state.date,precisePrior.date)
assert.deepEqual(preciseChanged.state.professional,precisePrior.professional)
assert.equal(preciseChanged.state.professionalNameHint,precisePrior.professionalNameHint)
assert.equal(preciseChanged.state.customerName,precisePrior.customerName)
assert.equal(preciseChanged.state.serviceId,precisePrior.serviceId)
assert.deepEqual(preciseChanged.state.basket,precisePrior.basket)
assert.deepEqual(preciseChanged.state.serviceEstimates,precisePrior.serviceEstimates)
assert.deepEqual(preciseChanged.state.informationFocus,precisePrior.informationFocus)
assert.equal(preciseChanged.state.pending,'time')
assert.equal(preciseChanged.state.questionContext?.role,'time')
assert.equal(preciseChanged.state.questionContext?.scope,JSON.stringify({
  basket:precisePrior.basket!.members.map(member => [member.memberId,member.mode,member.serviceIds]),
  date:precisePrior.date,professional:precisePrior.professional
}), 'the new time question uses the preserved basket/date/professional scope')
assert.equal(preciseChanged.proposal,null)
assert.equal(preciseChanged.bookingCommand,undefined)
assert.equal(preciseChanged.state.sandboxReservation,undefined)
assert.doesNotMatch(preciseChanged.reply,/mañana.*tarde|tarde.*mañana|23:00/)
assert.equal(preciseProviderCalls,1)
assert.equal(preciseAgendaReads-beforePreciseAgenda,1,'only the ordinary fresh offer query is needed')
assert.equal(preciseProofReads-beforePreciseProof,0,'an explicit HH:mm anchor needs no commercial meridiem proof')
assert.deepEqual(selectedSeventeen.state,precisePrior)
assert.deepEqual(preciseCandidate,preciseCandidateBefore)
console.log('PASS Q public precise approximation replaces real exact slot without selecting or booking')

for (const [body, time] of [['tipo 11:00pm','23:00'],['tipo 5:30pm','17:30'],['tipo 17','17:00']] as const) {
  const agendaBefore = preciseAgendaReads, proofBefore = preciseProofReads
  let calls = 0
  const unambiguous = await respondWithAiInterpreter(context,precisePrior,body,precisePort,async () => {
    calls++
    return {
      ...legacy,
      turnPlan:{version:1,operations:[{kind:'time_preference',preference:{kind:'around',time},evidence:body,confidence:0.99}]},
      communicativeActs:{version:1,acts:[{...act('change','time',body,[0]),confidence:0.99}]}
    }
  })
  assert.equal(unambiguous.interpretation.mode,'ai',body)
  assert.deepEqual(unambiguous.state.timePreference,{kind:'around',time},body)
  assert.equal(unambiguous.state.timeClarification,undefined,body)
  assert.equal(unambiguous.state.slot,null,body)
  assert.equal(unambiguous.state.requestedTime,null,body)
  assert.equal(unambiguous.proposal,null,body)
  assert.equal(unambiguous.bookingCommand,undefined,body)
  assert.equal(calls,1,body)
  assert.equal(preciseProofReads-proofBefore,0,'explicit period or 24-hour number needs no meridiem proof: ' + body)
  assert.equal(preciseAgendaReads-agendaBefore,1,body)
}
console.log('PASS Q explicit period and 24-hour number skip commercial proof; ambiguous pair controls remain unchanged')
