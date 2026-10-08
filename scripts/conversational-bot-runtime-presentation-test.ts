import assert from 'node:assert/strict'
import { Prisma } from '../src/generated/prisma/client.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { coordinationKey } from '../src/conversational-bot/coordinated-booking.js'
import { parseRuntimePresentedBooking, runtimeServiceConfigurationHash, type RuntimeShownScope } from '../src/conversational-bot/prisma-conversational-booking.js'

import { serviceConfigurationKey, parseEstimateOptions } from '../src/bot-options/domain/service-booking.js'

const scope:RuntimeShownScope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,revision:'5',configurationId:'cfg',dispatchFenceEpoch:3,handoffFenceEpoch:4}
const rows=[{id:'s1',businessId:'b',name:'Corte',duration:30,customerDurationMin:null,customerDurationMax:null,price:1000,priceMode:'FIXED',isActive:true,isBookable:true,attentionMode:'DIRECT_BOOKING',requiresPhoto:false,validationEnabled:false,estimateAllowsBooking:false,depositMode:'NONE',depositValue:null},
  {id:'s2',businessId:'b',name:'Crema',duration:30,customerDurationMin:45,customerDurationMax:45,price:2000,priceMode:'FIXED',isActive:true,isBookable:true,attentionMode:'DIRECT_BOOKING',requiresPhoto:false,validationEnabled:false,estimateAllowsBooking:false,depositMode:'NONE',depositValue:null}]
const state=initialDialogueState('b')
Object.assign(state,{customerName:'Ana',date:'2026-10-07',professional:{kind:'any'},pending:'proposal',basket:{version:1,nextMemberId:3,members:[
  {memberId:'m1',mode:'single',serviceIds:['s1'],evidence:'Corte'},{memberId:'m2',mode:'single',serviceIds:['s2'],evidence:'Crema'}]},
  slot:{date:'2026-10-07',time:'10:00',startAt:'2026-10-07T13:00:00.000Z',professionalId:'p1',professionalName:'Elisa',band:'MORNING',occupiedMinutes:60}})
type Mode='okay'|'foreign'|'missing'|'deposit'|'photo'|'pro'|'scope'|'guided'
function fixture(mode:Mode='okay') {
  const services=structuredClone(rows)
  if(mode==='foreign')services[1]!.businessId='other'
  if(mode==='missing')services.pop()
  if(mode==='deposit')services[1]!.depositMode='FIXED'
  if(mode==='photo')services[1]!.requiresPhoto=true
  if(mode==='guided')Object.assign(services[1]!,{attentionMode:'GUIDED_ESTIMATE',estimateAllowsBooking:true,priceMode:'STARTING_AT',estimateOptions:[{id:'option',label:'Largo',priceMin:3000,priceMax:4000}]})
  const queries:Prisma.Sql[]=[]
  const client={$queryRaw:async(q:Prisma.Sql)=>{
    queries.push(q)
    if(q.text.includes('CURRENT_TIMESTAMP AS now'))return [{timezone:'America/Argentina/Buenos_Aires',bookingHorizonDays:30,bookingLeadTimeHours:0,morningCutTime:'12:00',eveningCutTime:'19:00',now:new Date('2026-10-06T15:00:00Z')}]
    if(q.text.includes('runtime-booking-presentation-scope'))return mode==='scope'?[]:[{phone:'5491112345678',timezone:'America/Argentina/Buenos_Aires'}]
    if(q.text.includes('runtime-booking-presentation-services'))return services.filter(s=>q.values.includes(s.id))
    if(q.text.includes('runtime-booking-presentation-professionals'))return rows.filter(s=>q.values.includes(s.id)).map(s=>({serviceId:s.id,professionalId:'p1',professionalName:mode==='pro'?'Changed':'Elisa'}))
    throw new Error('unexpected read '+q.text)
  }}
  return {client:client as unknown as Parameters<typeof createPrismaDialoguePort>[0],queries,services}
}
const fx=fixture(), {port,context}=await createPrismaDialoguePort(fx.client,'b')
assert.equal(context.sandboxBooking,undefined)
const before=structuredClone(state)
const preparation=await port.prepareRuntimeBooking(state,scope)
assert.ok(preparation && 'presented' in preparation)
assert.deepEqual(state,before,'preparation does not mutate draft')
assert.equal(preparation.presented.scope.revision,'5')
assert.equal(preparation.presented.terms.segments.length,2)
assert.equal(preparation.presented.terms.segments[1]!.endAt,'2026-10-07T14:15:00.000Z')
assert.equal(preparation.presented.terms.segments[1]!.customerDurationMinutes,45)
assert.equal(preparation.presented.terms.totalPriceMinor,3000)
assert.equal(preparation.presented.terms.segments[1]!.configurationHash,runtimeServiceConfigurationHash(rows[1]!))
assert.equal(preparation.slot.coordination?.key,coordinationKey('b',preparation.slot.coordination!.segments))
assert.deepEqual(parseRuntimePresentedBooking(preparation.presented),preparation.presented)
assert.equal(parseRuntimePresentedBooking({...preparation.presented,unknown:true}),null)
assert.equal(parseRuntimePresentedBooking({...preparation.presented,fingerprint:'a'.repeat(64)}),null)
for(const mode of ['foreign','missing','deposit','photo','pro','scope','guided'] as const) {
  const f=fixture(mode),p=(await createPrismaDialoguePort(f.client,'b')).port
  assert.deepEqual(await p.prepareRuntimeBooking(state,scope),mode==='deposit'?{unavailable:'DEPOSIT_MULTISERVICE'}:null,mode)
  assert.ok(f.queries.every(q=>!q.text.includes('INSERT')&&!q.text.includes('UPDATE')),'read-only preparation')
}

const guided=fixture('guided'), guidedPort=(await createPrismaDialoguePort(guided.client,'b')).port
const staleEstimate=structuredClone(state)
staleEstimate.serviceEstimates={s2:{configurationKey:'stale',optionId:'option'}}
assert.equal(await guidedPort.prepareRuntimeBooking(staleEstimate,scope),null,'published option alone does not replace current configuration proof')

const currentEstimate=structuredClone(staleEstimate)
currentEstimate.serviceEstimates!.s2!.configurationKey=serviceConfigurationKey({id:'s2',name:'Crema',attentionMode:'GUIDED_ESTIMATE',price:2000,priceMode:'STARTING_AT',estimateAllowsBooking:true,
  estimateQuestion:null,estimateOptions:parseEstimateOptions([{id:'option',label:'Largo',priceMin:3000,priceMax:4000}]),estimateExplanation:null,estimateDisclaimer:null,
  requiresPhoto:false,validationEnabled:false,validationMessage:null,validationQuestion:null})
const guidedPrepared=await guidedPort.prepareRuntimeBooking(currentEstimate,scope)
assert.ok(guidedPrepared && 'presented' in guidedPrepared)
assert.equal(guidedPrepared.presented.terms.totalPriceMinor,null)
assert.deepEqual(guidedPrepared.presented.terms.segments[1]!.estimate,{optionId:'option',optionLabel:'Largo',priceMin:3000,priceMax:4000})
const malformed=structuredClone(state)
malformed.slot!.professionalName='Foreign'
assert.equal(await port.prepareRuntimeBooking(malformed,scope),null)
assert.equal(await port.prepareRuntimeBooking(state,{...scope,businessId:'foreign'}),null)
const coordinated=structuredClone(state)
coordinated.slot=preparation.slot
const coordinatedPreparation=await port.prepareRuntimeBooking(coordinated,scope)
assert.ok(coordinatedPreparation && 'presented' in coordinatedPreparation)
assert.deepEqual(coordinatedPreparation.presented.terms,preparation.presented.terms,'actual coordinated assignment preserved')
const corrupted=structuredClone(coordinated)
corrupted.slot!.coordination!.segments[1]!.professionalId='foreign'
assert.equal(await port.prepareRuntimeBooking(corrupted,scope),null)
const single=structuredClone(state)
single.basket!.members=single.basket!.members.slice(0,1);single.serviceId='s1';single.slot!.occupiedMinutes=30
const one=await port.prepareRuntimeBooking(single,scope)
assert.ok(one && 'presented' in one);assert.equal(one.slot.coordination,undefined);assert.equal(one.presented.terms.segments.length,1)
assert.notEqual(one.presented.nonce,preparation.presented.nonce)
const idleProfessional=structuredClone(single)
idleProfessional.slot!.occupiedMinutes=0

const depFixture=fixture()
Object.assign(depFixture.services[0]!,{depositMode:'FIXED',depositValue:100})
const depClient={...depFixture.client,$queryRaw:async(q:Prisma.Sql)=>{
  if(q.text.includes('runtime-booking-deposit-'))assert.doesNotMatch(q.text,/FOR SHARE/,'public presentation snapshot is read-only')
  if(q.text.includes('runtime-booking-deposit-settings'))return [{depositHoldMinutes:60}]
  if(q.text.includes('runtime-booking-deposit-payment'))return [{transferEnabled:true,alias:'salon.test',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}]
  return depFixture.client.$queryRaw(q)
}}
const previousCapability=process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED, previousAuthoritative=process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED
process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED='true';process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='true'
try {
  const depPort=(await createPrismaDialoguePort(depClient as unknown as Parameters<typeof createPrismaDialoguePort>[0],'b')).port
  const heldPreparation=await depPort.prepareRuntimeBooking(single,scope)
  assert.ok(heldPreparation && 'presented' in heldPreparation,'singular fixed deposit is prepared from real financial terms')
  assert.equal(heldPreparation.presented.terms.deposit?.financial.amount,100)
  assert.equal(heldPreparation.presented.terms.deposit?.financial.ttlMinutes,60)
  assert.equal(heldPreparation.presented.terms.deposit?.payment.alias,'salon.test')
  assert.equal(heldPreparation.presented.terms.segments[0]!.durationMinutes,30)
  process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='false'
  assert.deepEqual(await depPort.prepareRuntimeBooking(idleProfessional,scope),{unavailable:'DEPOSITS_DISABLED'})
} finally {
  if(previousCapability===undefined)delete process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED;else process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED=previousCapability
  if(previousAuthoritative===undefined)delete process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED;else process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=previousAuthoritative
}
assert.ok(await port.prepareRuntimeBooking(idleProfessional,scope),'daily occupied load is not the duration of this booking')
console.log('runtime presentation: PASS (fresh server proof, common/coordinated, extended customer duration; no network or writes)')
