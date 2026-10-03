import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseTurnPlan, type TurnOperation } from '../src/conversational-bot/turn-plan.js'
import { basketServiceIds, selectionSummary, type BasketMutation } from '../src/conversational-bot/service-basket.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T15:00:00Z') }
const catalog: DialogueService[] = [
  { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 5000, requiresConsultation: false },
  { id: 'woman', name: 'Corte mujer', durationMinutes: 30, price: 6000, requiresConsultation: false },
  { id: 'barba', name: 'Corte y barba', durationMinutes: 45, price: 7000, requiresConsultation: false },
  { id: 'smooth', name: 'Alisado', durationMinutes: 90, price: 10000, requiresConsultation: false },
  { id: 'cream', name: 'Baño de crema', durationMinutes: 30, price: 3000, requiresConsultation: false }
]
let singles = 0, joint = 0
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
const slot = (date: string) => ({ date, time: '17:00', startAt: date + 'T20:00:00.000Z', professionalId: 'ramiro', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 })
const port: DialoguePort = {
  catalog: async () => catalog,
  availability: async (_service, date) => { singles++; return { professionals, slots: [slot(date)] } },
  availabilityBasket: async (services, date) => {
    joint++
    return { ok: true, services, durationMinutes: services.reduce((n, s) => n + s.durationMinutes!, 0), totalPrice: services.every(s => s.priceMode !== 'STARTING_AT' && s.price !== null) ? services.reduce((n,s) => n+s.price!,0) : null, professionals, slots: [slot(date)] }
  }
}
const ev = (evidence: string) => ({ evidence, confidence: .99 })
const member = (mode: 'single' | 'alternatives' | 'unresolved', serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...ev(evidence) })
const basket = (mutation: BasketMutation['mutation'], members: BasketMutation['members'], evidence: string, scope: BasketMutation['scope'] = 'all', targetMemberIds: string[] = []): TurnOperation => ({ kind: 'basket', mutation, members, scope, targetMemberIds, ...ev(evidence) })
const time: TurnOperation = { kind: 'time', value: '17:00', ...ev('17hs') }
const date: TurnOperation = { kind: 'date', expression: 'mañana', ...ev('mañana') }
const professional: TurnOperation = { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }
const name: TurnOperation = { kind: 'name', value: 'Matias', ...ev('Matias') }
const say = (state: DialogueState, message: string, operations: TurnOperation[], selectedPort = port) => respond(context, state, message, selectedPort, { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations } })
const initial = () => initialDialogueState(context.businessId)
const first = await say(initial(), 'soy Matias quiero corte y alisado mañana con Ramiro', [name, date, professional, basket('set', [member('alternatives', ['cut', 'woman', 'barba'], 'corte'), member('single', ['smooth'], 'alisado')], 'corte y alisado')])
assert.equal(first.proposal, null); assert.equal(joint, 0); assert.equal(singles, 0)
assert.equal(first.state.customerName, 'Matias'); assert.equal(first.state.date, '2026-10-02'); assert.equal(first.state.professionalNameHint, 'ramiro')
assert.equal(first.state.basket?.members.length, 2); assert.match(first.reply, /Cuál de estos servicios/); assert.match(first.reply, /Alisado/)
const groupId = first.state.basket!.members[0]!.memberId
const complete = await say(first.state, 'corte hombre', [basket('replace', [member('single', ['cut'], 'corte hombre')], 'corte hombre', 'members', [groupId])])
assert.deepEqual(basketServiceIds(complete.state), ['cut', 'smooth']); assert.equal(complete.state.serviceId, null)
assert.equal(complete.state.customerName, 'Matias'); assert.equal(complete.state.date, '2026-10-02'); assert.equal(singles, 0); assert.ok(joint > 0)
const proposed = await say(complete.state, '17hs', [time])
assert.deepEqual(proposed.proposal?.serviceIds, ['cut', 'smooth']); assert.equal(proposed.proposal?.durationMinutes, 120); assert.equal(proposed.proposal?.totalPrice, 15000)
assert.match(proposed.reply, /Corte hombre.*Alisado/); assert.match(proposed.reply, /120 min/); assert.match(proposed.reply, /Todavía no está reservado/)
const repeated = await say(proposed.state, 'corte hombre y alisado', [basket('set', [member('single', ['cut'], 'corte hombre'), member('single', ['smooth'], 'alisado')], 'corte hombre y alisado')])
assert.equal(repeated.state.slot?.startAt, proposed.state.slot?.startAt); assert.deepEqual(repeated.state.basket, proposed.state.basket)
const added = await say(proposed.state, 'agrega baño de crema', [basket('add', [member('single', ['cream'], 'baño de crema')], 'agrega baño de crema')])
assert.deepEqual(basketServiceIds(added.state), ['cut', 'smooth', 'cream']); assert.equal(added.state.slot, null); assert.equal(added.state.requestedTime, null)
assert.equal(added.state.customerName, 'Matias'); assert.equal(added.state.date, '2026-10-02'); assert.equal(added.proposal, null)
const removed = await say(added.state, 'quita alisado', [basket('remove', [], 'quita alisado', 'members', [added.state.basket!.members.find(m=>m.serviceIds.includes('smooth'))!.memberId])])
assert.deepEqual(basketServiceIds(removed.state), ['cut', 'cream'])
const replaced = await say(removed.state, 'mejor corte y barba', [basket('replace', [member('single', ['barba'], 'corte y barba')], 'mejor corte y barba', 'members', [removed.state.basket!.members.find(m=>m.serviceIds.includes('cut'))!.memberId])])
assert.deepEqual(basketServiceIds(replaced.state), ['barba', 'cream'])
const replaceAll = await say(replaced.state, 'solo alisado', [basket('replace', [member('single', ['smooth'], 'alisado')], 'solo alisado')])
assert.deepEqual(basketServiceIds(replaceAll.state), ['smooth']); assert.equal(replaceAll.state.serviceId, 'smooth')
const beforeSingles = singles
const blocked = await say(initial(), 'corte hombre y alisado mañana con Ramiro', [basket('set', [member('single', ['cut'], 'corte hombre'), member('single', ['smooth'], 'alisado')], 'corte hombre y alisado'), date, professional], { ...port, availabilityBasket: undefined } as unknown as DialoguePort)
assert.equal(blocked.proposal, null); assert.equal(blocked.state.slot, null); assert.equal(singles, beforeSingles); assert.match(blocked.reply, /No pude verificar|no está disponible/)
for (const reason of ['DOMAIN_REVIEW', 'COMBINATION_BLOCKED', 'NO_COMMON_PROFESSIONAL', 'UNSUPPORTED_OCCUPANCY'] as const) {
 const fail = await say(proposed.state, '17hs', [time], { ...port, availabilityBasket: async () => ({ ok: false, reason }) })
 assert.equal(fail.proposal, null); assert.equal(fail.state.slot, null); assert.doesNotMatch(fail.reply, /Propuesta:|Horarios disponibles/)
}
const stale = await say(proposed.state, '17hs', [time], { ...port, catalog: async () => catalog.filter(s=>s.id!=='smooth') })
assert.equal(stale.proposal, null); assert.equal(stale.state.slot, null); assert.equal(stale.state.basket?.members.length, 2); assert.match(stale.reply, /ya no está disponible/)
const review = await say(proposed.state, '17hs', [time], { ...port, catalog: async () => catalog.map(s=>s.id==='smooth'?{...s,requiresConsultation:true}:s) })
assert.equal(review.proposal, null); assert.equal(review.state.slot, null); assert.doesNotMatch(review.reply, /Propuesta:/)
const estimated = await say(proposed.state, '17hs', [time], { ...port, availabilityBasket: async (services, date) => ({ ok: true, services: services.map(s=>s.id==='smooth'?{...s,priceMode:'STARTING_AT'}:s), durationMinutes: 120, totalPrice: null, professionals, slots: [slot(date)] }) })
assert.equal(estimated.proposal?.totalPrice, null); assert.match(estimated.reply, /precio total a consultar/)
await assert.rejects(() => say(proposed.state, '17hs', [time], { ...port, availabilityBasket: async (_services,date)=>({ok:true,services:[catalog[0]!],durationMinutes:30,totalPrice:5000,professionals,slots:[slot(date)]}) }), /basket availability/)
const old = { ...initial(), serviceId:'cut',date:'2026-10-02',professional:{kind:'specific' as const,id:'ramiro'},slot:slot('2026-10-02'),requestedTime:'17:00',customerName:'Matias',pending:'proposal' as const }
assert.deepEqual(basketServiceIds(parseDialogueState(old,context.businessId)),['cut'])
assert.deepEqual(parseDialogueState(proposed.state,context.businessId),proposed.state)
const policy = { businessId:context.businessId, revision:1, engine:'conversational-booking-v1' } as any
const projection = projectConversationDraft(proposed.state,policy)
assert.deepEqual(projection.cart,[{serviceId:'cut'},{serviceId:'smooth'}]); assert.deepEqual(basketServiceIds(readConversationDraft(projection,policy,context.timezone)),['cut','smooth'])
assert.deepEqual(projectConversationDraft(first.state,policy).cart,[], 'unresolved basket cannot project a partial reservation')
assert.throws(()=>parseDialogueState({...proposed.state,businessId:'foreign'},context.businessId))
assert.throws(()=>parseDialogueState({...proposed.state,serviceId:'cut'},context.businessId),/basket|invariant/)
assert.throws(()=>parseDialogueState({...proposed.state,dialogueContext:{lastQuestion:'¿Cuál elegís?',presentedOffer:{businessId:context.businessId,serviceId:'cut',serviceIds:['cut'],durationMinutes:30,date:'2026-10-02',professionalId:'ramiro'}}},context.businessId),/offer/)
assert.throws(()=>parseTurnPlan({version:1,operations:[basket('set',[member('single',['foreign'],'alisado')],'alisado')]},'alisado',catalog.map(s=>s.id)),/catalog/)
await assert.rejects(()=>say(first.state,'corte hombre',[basket('replace',[member('single',['cut'],'corte hombre')],'corte hombre','members',['m999'])]),/basket/)
assert.throws(()=>parseTurnPlan({version:1,operations:[basket('set',Array.from({length:11},()=>member('unresolved',[],'corte')),'corte')]},'corte'),/basket|bound|limit/)
assert.throws(()=>parseTurnPlan({version:1,operations:[basket('set',[member('single',['cut'],'ausente')],'corte')]},'corte'),/evidence/)

// Dependency changes retain independent preferences while invalidating computed selection.
const changedWithTime = await say(proposed.state, 'agrega baño de crema a las 17hs', [basket('add', [member('single', ['cream'], 'baño de crema')], 'agrega baño de crema'), time])
assert.deepEqual(changedWithTime.proposal?.serviceIds, ['cut','smooth','cream']); assert.equal(changedWithTime.proposal?.durationMinutes,150); assert.equal(changedWithTime.proposal?.customerName,'Matias')
assert.equal(changedWithTime.state.professional?.kind === 'specific' ? changedWithTime.state.professional.id : null,'ramiro')
const duplicateAdd = await say(proposed.state,'agrega alisado',[basket('add',[member('single',['smooth'],'alisado')],'agrega alisado')])
assert.deepEqual(duplicateAdd.state.basket,proposed.state.basket); assert.equal(duplicateAdd.state.slot?.startAt,proposed.state.slot?.startAt)
const empty = await say(proposed.state,'quita todo',[basket('remove',[],'quita todo')])
assert.deepEqual(basketServiceIds(empty.state),[]); assert.equal(empty.state.pending,'service'); assert.equal(empty.state.date,'2026-10-02'); assert.equal(empty.state.customerName,'Matias'); assert.equal(empty.proposal,null)
const reviewGroup = await say(initial(),'corte y alisado',[basket('set',[member('alternatives',['cut','woman','barba'],'corte'),member('single',['smooth'],'alisado')],'corte y alisado')],{...port,catalog:async()=>catalog.map(s=>s.id==='smooth'?{...s,requiresConsultation:true}:s)})
assert.equal(reviewGroup.state.basket?.members.length,2); assert.equal(reviewGroup.proposal,null); assert.match(reviewGroup.reply,/Alisado/)
const secondGroup = await say(initial(),'corte y tratamiento',[basket('set',[member('alternatives',['cut','woman'],'corte'),member('alternatives',['smooth','cream'],'tratamiento')],'corte y tratamiento')])
const resolvedFirstGroup = await say(secondGroup.state,'corte hombre',[basket('replace',[member('single',['cut'],'corte hombre')],'corte hombre','members',[secondGroup.state.basket!.members[0]!.memberId])])
assert.equal(resolvedFirstGroup.state.basket?.members.length,2); assert.equal(resolvedFirstGroup.state.basket?.members[1]?.mode,'alternatives'); assert.equal(resolvedFirstGroup.proposal,null)
assert.match(resolvedFirstGroup.reply,/Corte hombre/)
const asymmetry = await say(proposed.state,'17hs',[time],{...port,catalog:async()=>catalog.map(s=>s.id==='smooth'?{...s,professionalDurationMinutes:90,customerDurationMinutes:120}:s)})
assert.equal(asymmetry.proposal,null,'unsupported occupancy cannot become a shorter joint proposal'); assert.doesNotMatch(asymmetry.reply,/Horarios disponibles|Propuesta:/)


const legacyClarified = await respond(context, first.state, 'corte hombre', port, {serviceId:'cut',candidateIds:[],correction:false,intent:'booking'})
assert.deepEqual(basketServiceIds(legacyClarified.state),['cut','smooth']); assert.match(legacyClarified.reply,/tengo algunos horarios disponibles/)
const onlyGroup = await say(initial(),'corte mañana con Ramiro',[basket('set',[member('alternatives',['cut','woman'],'corte')],'corte'),date,professional])
const onlyLegacyResolved = await respond(context,onlyGroup.state,'corte hombre',port,{serviceId:'cut',candidateIds:[],correction:false,intent:'booking'})
assert.deepEqual(basketServiceIds(onlyLegacyResolved.state),['cut']); assert.equal(onlyLegacyResolved.state.pending,'time','legacy clarification of a single group continues progression')


const unknowns = await say(initial(),'masaje y color especial',[basket('set',[member('unresolved',[],'masaje'),member('unresolved',[],'color especial')],'masaje y color especial')])
assert.equal(unknowns.state.basket?.members.length,2)
const addUnknown = await say(unknowns.state,'también peinado especial',[basket('add',[member('unresolved',[],'peinado especial')],'también peinado especial')])
assert.equal(addUnknown.state.basket?.members.length,3,'distinct unrecognized members are retained, not deduplicated into one')
const luz = { id:'luz',name:'Luz',priority:0 }
const incompatible = await say(proposed.state,'agrega baño de crema',[basket('add',[member('single',['cream'],'baño de crema')],'agrega baño de crema')],{...port,availabilityBasket:async(services,date)=>({ok:true,services,...{durationMinutes:150,totalPrice:18000},professionals:[luz],slots:[{...slot(date),professionalId:'luz',professionalName:'Luz'}]})})
assert.equal(incompatible.state.professional,null);assert.equal(incompatible.state.date,'2026-10-02');assert.equal(incompatible.state.customerName,'Matias');assert.equal(incompatible.state.pending,'professional');assert.equal(incompatible.proposal,null)


const overflowServices = catalog.filter(s => s.id === 'cut' || s.id === 'smooth').map(s => ({...s, price: s.id === 'cut' ? 10 : Number.MAX_SAFE_INTEGER}))
assert.deepEqual(selectionSummary(overflowServices),{durationMinutes:120,totalPrice:null},'a non-representable aggregate never advertises a fabricated fixed price')
assert.deepEqual(selectionSummary([catalog[0]!,catalog[3]!]),{durationMinutes:120,totalPrice:15000})
assert.equal(selectionSummary([{...catalog[0]!,priceMode:'STARTING_AT'},catalog[3]!]).totalPrice,null)
assert.equal(selectionSummary([{...catalog[0]!,price:null},catalog[3]!]).totalPrice,null)
const overflowProposal = await say(proposed.state,'17hs',[time],{...port,catalog:async()=>[...catalog.filter(s=>s.id!=='cut'&&s.id!=='smooth'),...overflowServices],availabilityBasket:async(services,date)=>({ok:true,services,durationMinutes:120,totalPrice:null,professionals,slots:[slot(date)]})})
assert.deepEqual(overflowProposal.proposal?.serviceIds,['cut','smooth']);assert.equal(overflowProposal.proposal?.durationMinutes,120);assert.equal(overflowProposal.proposal?.totalPrice,null);assert.match(overflowProposal.reply,/precio total a consultar/)

console.log('conversational basket: mixed ambiguity, mutations, joint proposal, scope and fail-closed PASS')
