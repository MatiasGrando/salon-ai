import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'
import { confirmBookingWithoutDeposit, revalidateBookingWrite, type ConfirmBookingWithoutDepositInput } from '../services/booking-operations.js'
import { prismaHandoffEffectExecutor } from '../bot-options/infrastructure/prisma-handoff-effect-executor.js'
import { parseEstimateOptions, resolveServiceEstimate, type ServiceEstimate } from '../bot-options/domain/service-booking.js'
import { validateCustomerName } from '../bot-options/domain/customer-name-validation.js'

export type RuntimeBookingSegment = {
  serviceId: string; serviceName: string; professionalId: string; professionalName: string
  startAt: string; endAt: string; durationMinutes: number; customerDurationMinutes: number
  priceMinor: number | null; priceMode: 'FIXED' | 'STARTING_AT'; configurationHash: string | null; estimate?: ServiceEstimate
}
export type RuntimeBookingTerms = {
  version: 1; businessId: string; timezone: string; date: string; customerName: string
  preference: { kind: 'any' } | { kind: 'specific'; id: string }
  segments: readonly RuntimeBookingSegment[]; totalPriceMinor: number | null
}
export type RuntimeShownScope = { businessId: string; sessionId: string; deploymentId: string; generation: number; revision: string; configurationId: string; dispatchFenceEpoch: number; handoffFenceEpoch: number }
export type RuntimePresentedBooking = { scope: RuntimeShownScope; version: 1; nonce: string; fingerprint: string; conditionsPresented: true; terms: RuntimeBookingTerms }
export type RuntimeBookingOrigin = {
  kind: 'RUNTIME'; businessId: string; sessionId: string; canonicalPhone: string; revision: bigint
  deploymentId: string; generation: number; configurationId: string; dispatchFenceEpoch: number; handoffFenceEpoch: number
  operationKey: string; newBookingAllowed: boolean
}
export type RuntimeBookingInput = { origin: RuntimeBookingOrigin; presented: RuntimePresentedBooking; currentDraft: unknown
  consent: { confirmed: boolean; nonce: string; fingerprint: string } }
type Receipt = { kind: 'COMMITTED'; coordinationGroupId: string; proposalNonce: string; fingerprint: string
  appointments: Array<{ segmentIndex: number; appointmentId: string; visitId: string }> }
export type RuntimeBookingResult = Receipt | { kind: 'BLOCKED'; reason: 'SCOPE_REJECTED' | 'FINANCIAL_OR_GUIDANCE' } | { kind: 'REQUOTE' }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
export const runtimeBookingFingerprint = (terms: RuntimeBookingTerms): string => hash(terms)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value)
const keys = (value: object, required: string[], optional: string[] = []) => required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key))
const money = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const blocked = (): RuntimeBookingResult => ({kind:'BLOCKED',reason:'SCOPE_REJECTED'})

/** Hash of the current service configuration, not of an AI quote or suggested ID. */
export function runtimeServiceConfigurationHash(service: Record<string, unknown>): string {
  return hash(['attentionMode','price','priceMode','estimateAllowsBooking','estimateQuestion','estimateOptions','estimateExplanation','estimateDisclaimer',
    'requiresPhoto','validationEnabled','validationMessage','validationQuestion','customerDurationMin','customerDurationMax','depositMode','depositValue'].map(key=>service[key]??null))
}
function validPresented(p: RuntimePresentedBooking): boolean {
  if (!object(p) || !keys(p,['scope','version','nonce','fingerprint','conditionsPresented','terms']) || p.version !== 1 || p.conditionsPresented !== true ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.nonce) || !/^[a-f0-9]{64}$/.test(p.fingerprint)) return false
  if(!object(p.scope) || !keys(p.scope,['businessId','sessionId','deploymentId','generation','revision','configurationId','dispatchFenceEpoch','handoffFenceEpoch']) ||
    ![p.scope.businessId,p.scope.sessionId,p.scope.deploymentId,p.scope.configurationId].every(value=>text(value)) || !/^\d+$/.test(p.scope.revision) ||
    ![p.scope.generation,p.scope.dispatchFenceEpoch,p.scope.handoffFenceEpoch].every(value=>Number.isSafeInteger(value)&&value>=0)) return false
  const t=p.terms, name=object(t) && typeof t.customerName==='string' ? validateCustomerName(t.customerName) : null
  if (!object(t) || !keys(t,['version','businessId','timezone','date','customerName','preference','segments','totalPriceMinor']) || t.version!==1 ||
    !text(t.businessId) || !text(t.timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !name?.ok || name.normalized!==t.customerName ||
    !object(t.preference) || !(t.preference.kind==='any' && keys(t.preference,['kind']) || t.preference.kind==='specific' && keys(t.preference,['kind','id']) && text(t.preference.id)) ||
    !Array.isArray(t.segments) || !t.segments.length || t.segments.length>8 || !money(t.totalPriceMinor) || JSON.stringify(p).length>12000) return false
  let previousEnd: string | null=null
  for(const s of t.segments) {
    if(!object(s) || !keys(s,['serviceId','serviceName','professionalId','professionalName','startAt','endAt','durationMinutes','customerDurationMinutes','priceMinor','priceMode','configurationHash'],['estimate']) ||
      ![s.serviceId,s.serviceName,s.professionalId,s.professionalName].every(value=>text(value)) || !instant(s.startAt) || !instant(s.endAt) ||
      typeof s.durationMinutes!=='number' || !Number.isSafeInteger(s.durationMinutes) || s.durationMinutes<=0 || s.durationMinutes>720 || typeof s.customerDurationMinutes!=='number' || !Number.isSafeInteger(s.customerDurationMinutes) ||
      s.customerDurationMinutes<s.durationMinutes || s.customerDurationMinutes>720 || Date.parse(s.endAt)-Date.parse(s.startAt)!==s.durationMinutes*60000 ||
      previousEnd!==null && previousEnd!==s.startAt || !money(s.priceMinor) || typeof s.priceMode!=='string' || !['FIXED','STARTING_AT'].includes(s.priceMode) ||
      s.configurationHash!==null && (typeof s.configurationHash!=='string' || !/^[a-f0-9]{64}$/.test(s.configurationHash))) return false
    if(s.estimate && (!object(s.estimate) || !keys(s.estimate,['optionId','optionLabel','priceMin','priceMax']) ||
      s.estimate.optionId!==null && !text(s.estimate.optionId) || s.estimate.optionLabel!==null && !text(s.estimate.optionLabel) ||
      !money(s.estimate.priceMin) || s.estimate.priceMin===null || !money(s.estimate.priceMax) ||
      s.estimate.priceMax!==null && s.estimate.priceMax<s.estimate.priceMin)) return false
    if(t.preference.kind==='specific' && t.preference.id!==s.professionalId) return false
    try {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:t.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(s.startAt))
      const part=(kind:string)=>parts.find(p=>p.type===kind)?.value
      if([part('year'),part('month'),part('day')].join('-')!==t.date) return false
    } catch {return false}
    previousEnd=s.endAt
  }
  const total=t.segments.every(s=>s.priceMode==='FIXED' && s.priceMinor!==null) ? t.segments.reduce((sum,s)=>sum+s.priceMinor!,0) : null
  return t.totalPriceMinor===total && p.fingerprint===runtimeBookingFingerprint(t)
}
function validDraft(draft: unknown, p: RuntimePresentedBooking): boolean {
  if(!object(draft) || !object(draft.bookingReservation) || !isDeepStrictEqual(draft.bookingReservation.presented,p) ||
    draft.businessId!==p.terms.businessId || draft.customerName!==p.terms.customerName || draft.date!==p.terms.date || draft.pending!=='proposal' ||
    !isDeepStrictEqual(draft.professional,p.terms.preference) || draft.referral || draft.serviceRequest || draft.editRequest || draft.professionalReference ||
    !object(draft.basket) || !Array.isArray(draft.basket.members) || !object(draft.slot) || draft.slot.startAt!==p.terms.segments[0]!.startAt) return false
  const ids: unknown[]=[]
  for(const member of draft.basket.members) {
    if(!object(member) || member.mode!=='single' || !Array.isArray(member.serviceIds) || member.serviceIds.length!==1) return false
    ids.push(member.serviceIds[0])
  }
  if(!isDeepStrictEqual(ids,p.terms.segments.map(s=>s.serviceId))) return false
  if(p.terms.segments.length===1) return draft.slot.professionalId===p.terms.segments[0]!.professionalId && draft.slot.professionalName===p.terms.segments[0]!.professionalName
  if(!object(draft.slot.coordination)) return false
  const segments=p.terms.segments.map(({priceMinor,priceMode,configurationHash,estimate,...segment})=>segment)
  return isDeepStrictEqual(draft.slot.coordination.segments,segments)
}
type ScopeRow={phone:string;state:unknown;customerId:string|null;customerName:string|null}
async function lockScope(tx: Prisma.TransactionClient, o: RuntimeBookingOrigin): Promise<ScopeRow | undefined> {
  const rows=await tx.$queryRaw<ScopeRow[]>(Prisma.sql`
    /* runtime-booking-scope */
    SELECT c."phone",s."state",customer."id" AS "customerId",customer."name" AS "customerName"
    FROM "BotSession" s JOIN "Conversation" c ON c."id"=s."conversationId" AND c."businessId"=s."businessId"
    JOIN "BotChannelDeployment" d ON d."id"=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg."id"=d."activeConfigurationId" AND cfg."businessId"=d."businessId"
    JOIN "Business" b ON b."id"=s."businessId"
    LEFT JOIN "Customer" customer ON customer."businessId"=s."businessId" AND customer."normalizedPhone"=${o.canonicalPhone}
    WHERE s."id"=${o.sessionId} AND s."businessId"=${o.businessId} AND s."revision"=${o.revision}
      AND s."status"='ACTIVE' AND s."handoffClaimsPausedAt" IS NULL AND s."handoffFenceEpoch"=${o.handoffFenceEpoch}
      AND s."deploymentId"=${o.deploymentId} AND s."deploymentGeneration"=${o.generation}
      AND d."generation"=${o.generation} AND d."dispatchFenceEpoch"=${o.dispatchFenceEpoch} AND d."claimsPausedAt" IS NULL
      AND d."channel"='WHATSAPP' AND d."activeConfigurationId"=${o.configurationId} AND cfg."status"='ACTIVE'
      AND d."legacyDispatchCoverageVersion">=1 AND b."botEnabled"=true
      AND regexp_replace(c."phone",'[^0-9]','','g')=${o.canonicalPhone}
    FOR UPDATE OF s,c FOR SHARE OF d,cfg,b
  `)
  return rows.length===1 ? rows[0] : undefined
}
const childKey=(key:string,index:number)=>key+':segment:'+index
function childInput(input: RuntimeBookingInput, key: string, index: number): ConfirmBookingWithoutDepositInput {
  const s=input.presented.terms.segments[index]!,o=input.origin
  return {businessId:o.businessId,sessionId:o.sessionId,operationKey:childKey(key,index),newBookingAllowed:o.newBookingAllowed,
    services:[{serviceId:s.serviceId,name:s.serviceName,durationMinutes:s.durationMinutes,priceMinor:s.priceMinor,priceMode:s.priceMode,...(s.estimate?{estimate:s.estimate}:{})}],
    professional:{professionalId:s.professionalId,name:s.professionalName,assignedByBalancer:false},date:input.presented.terms.date,slotStartAt:s.startAt,totalDurationMinutes:s.durationMinutes,
    totalPriceMinor:s.priceMode==='FIXED'?s.priceMinor:null}
}
/** F7's persisted legacy payload/order remains unchanged; only verify its durable child receipt. */
function childHash(input: ConfirmBookingWithoutDepositInput): string {
  return hash({services:input.services,professional:input.professional,date:input.date,slotStartAt:input.slotStartAt,totalDurationMinutes:input.totalDurationMinutes,totalPriceMinor:input.totalPriceMinor})
}
async function replay(tx: Prisma.TransactionClient, input: RuntimeBookingInput, key: string, requestHash: string, customerId: string | null): Promise<Receipt | null> {
  const rows=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`SELECT * FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE`)
  const parent=rows[0]
  if(!parent) return null
  if(rows.length!==1 || parent.businessId!==input.origin.businessId || parent.sessionId!==input.origin.sessionId || parent.type!=='CONFIRM_VISIT' ||
    parent.status!=='COMPLETED' || parent.requestHash!==requestHash || !parent.resultRef || !customerId) throw new Error('runtime booking replay scope mismatch')
  const members=await tx.$queryRaw<Array<{appointmentId:string;visitId:string;serviceId:string;professionalId:string;startAt:Date;duration:number;customerId:string;quotedPrice:number|null;businessId:string;status:string;visitStatus:string;visitSession:string;visitCustomer:string;visitProfessional:string;visitStart:Date;visitDuration:number;visitPrice:number|null}>>(Prisma.sql`
    SELECT a."id" AS "appointmentId",a."visitId",a."serviceId",a."professionalId",a."startAt",a."totalDurationMinutes" AS duration,a."customerId",a."quotedPrice",a."businessId",a."status",
      v."status" AS "visitStatus",v."sessionId" AS "visitSession",v."customerId" AS "visitCustomer",v."professionalId" AS "visitProfessional",
      v."scheduledStartAt" AS "visitStart",v."totalDurationMinutes" AS "visitDuration",v."totalPrice" AS "visitPrice"
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id"=a."visitId" AND v."businessId"=a."businessId"
    WHERE a."coordinationGroupId"=${parent.resultRef} FOR UPDATE OF a,v
  `)
  if(members.length!==input.presented.terms.segments.length) throw new Error('runtime booking replay membership mismatch')
  const appointments:Receipt['appointments']=[]
  for(const [index,segment] of input.presented.terms.segments.entries()) {
    const ops=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`SELECT * FROM "BotOperation" WHERE "operationKey"=${childKey(key,index)+':CONFIRM_VISIT'} FOR UPDATE`)
    const op=ops[0], member=members.find(m=>m.visitId===op?.resultRef), price=segment.priceMode==='FIXED'?segment.priceMinor:null
    if(ops.length!==1 || !op || op.businessId!==input.origin.businessId || op.sessionId!==input.origin.sessionId || op.type!=='CONFIRM_VISIT' || op.status!=='COMPLETED' || op.requestHash!==childHash(childInput(input,key,index)) || !member ||
      member.businessId!==input.origin.businessId || member.customerId!==customerId || member.visitCustomer!==customerId || member.serviceId!==segment.serviceId ||
      member.professionalId!==segment.professionalId || member.visitProfessional!==segment.professionalId || member.status!=='CONFIRMED' || member.visitStatus!=='CONFIRMED' ||
      member.visitSession!==input.origin.sessionId || new Date(member.startAt).toISOString()!==segment.startAt || new Date(member.visitStart).toISOString()!==segment.startAt ||
      member.duration!==segment.durationMinutes || member.visitDuration!==segment.durationMinutes || member.quotedPrice!==price || member.visitPrice!==price) throw new Error('runtime booking child replay mismatch')
    const items=await tx.$queryRaw<Array<{serviceId:string;sortOrder:number;durationMinutes:number;price:number|null}>>(Prisma.sql`SELECT "serviceId","sortOrder","durationMinutes",price FROM "AppointmentServiceItem" WHERE "appointmentId"=${member.appointmentId} ORDER BY "sortOrder"`)
    if(!isDeepStrictEqual(items,[{serviceId:segment.serviceId,sortOrder:0,durationMinutes:segment.durationMinutes,price:segment.priceMinor}]) ||
      appointments.some(a=>a.visitId===member.visitId)) throw new Error('runtime booking child items replay mismatch')
    appointments.push({segmentIndex:index,appointmentId:member.appointmentId,visitId:member.visitId})
  }
  return {kind:'COMMITTED',coordinationGroupId:parent.resultRef,proposalNonce:input.presented.nonce,fingerprint:input.presented.fingerprint,appointments}
}

/** Caller owns the complete claim/CAS/outbox transaction. Any failure after a write MUST escape it. */
export async function executePrismaConversationBooking(tx: Prisma.TransactionClient, input: RuntimeBookingInput): Promise<RuntimeBookingResult> {
  const {origin:o,presented:p}=input
  if(!object(o) || o.kind!=='RUNTIME' || ![o.businessId,o.sessionId,o.deploymentId,o.configurationId,o.operationKey].every(value=>text(value)) ||
    !/^\d{10,15}$/.test(o.canonicalPhone) || typeof o.revision!=='bigint' || o.revision<0n ||
    ![o.generation,o.dispatchFenceEpoch,o.handoffFenceEpoch].every(value=>Number.isSafeInteger(value)&&value>=0) ||
    !validPresented(p) || !isDeepStrictEqual(p.scope,{businessId:o.businessId,sessionId:o.sessionId,deploymentId:o.deploymentId,generation:o.generation,revision:String(o.revision),configurationId:o.configurationId,dispatchFenceEpoch:o.dispatchFenceEpoch,handoffFenceEpoch:o.handoffFenceEpoch}) || o.businessId!==p.terms.businessId || !validDraft(input.currentDraft,p) ||
    input.consent?.confirmed!==true || input.consent.nonce!==p.nonce || input.consent.fingerprint!==p.fingerprint) return blocked()
  const scope=await lockScope(tx,o)
  if(!scope || !/^\+?[\d\s().-]+$/.test(scope.phone) || !object(scope.state) || !object(scope.state.conversationDraft) ||
    !isDeepStrictEqual(scope.state.conversationDraft.dialogue,input.currentDraft) || !['NONE','DRAFT'].includes(String(scope.state.booking)) ||
    scope.state.deposit!=='NONE' || scope.state.handoff!=='NONE') return blocked()
  const key='conversation-booking:'+o.operationKey+':'+p.nonce
  const requestHash=hash({presented:p,origin:{businessId:o.businessId,sessionId:o.sessionId,canonicalPhone:o.canonicalPhone,deploymentId:o.deploymentId,generation:o.generation,
    dispatchFenceEpoch:o.dispatchFenceEpoch,handoffFenceEpoch:o.handoffFenceEpoch,configurationId:o.configurationId,revision:String(o.revision)}})
  await acquireAgendaHierarchy(tx,{businessId:o.businessId,professionalIds:p.terms.segments.map(s=>s.professionalId)})
  const prior=await replay(tx,input,key,requestHash,scope.customerId)
  if(prior) return prior
  if(!o.newBookingAllowed) return blocked()
  const clocks=await tx.$queryRaw<Array<{timezone:string;dbNow:Date;bookingLeadTimeHours:number;bookingHorizonDays:number}>>(Prisma.sql`SELECT timezone,"bookingLeadTimeHours","bookingHorizonDays",clock_timestamp() AS "dbNow" FROM "BusinessBotOptionsSettings" WHERE "businessId"=${o.businessId}`)
  const settings=clocks[0]
  if(!settings || settings.timezone!==p.terms.timezone) return {kind:'REQUOTE'}
  const allIds=[...new Set(p.terms.segments.map(s=>s.serviceId))]
  const rules=await tx.$queryRaw<Array<{count:number}>>(Prisma.sql`SELECT count(*)::int AS count FROM "ServiceCombinationRule" WHERE "businessId"=${o.businessId} AND "serviceAId" IN (${Prisma.join(allIds)}) AND "serviceBId" IN (${Prisma.join(allIds)}) AND policy<>'ALLOWED'::"ServiceCombinationPolicy"`)
  if((rules[0]?.count??0)>0) return {kind:'BLOCKED',reason:'FINANCIAL_OR_GUIDANCE'}
  for(const segment of p.terms.segments) {
    const validation=await revalidateBookingWrite(tx,{businessId:o.businessId,professionalId:segment.professionalId,professionalIdsToLock:p.terms.segments.map(s=>s.professionalId),
      serviceIds:[segment.serviceId],startAt:new Date(segment.startAt),timezone:settings.timezone,dbNow:new Date(settings.dbNow)})
    const s=validation.orderedServices[0]!
    if(s.depositMode!=='NONE' || s.requiresPhoto || s.validationEnabled || !['DIRECT_BOOKING','GUIDED_ESTIMATE'].includes(s.attentionMode) ||
      s.attentionMode==='GUIDED_ESTIMATE' && !s.estimateAllowsBooking) return {kind:'BLOCKED',reason:'FINANCIAL_OR_GUIDANCE'}
    const estimate=s.attentionMode==='GUIDED_ESTIMATE' ? resolveServiceEstimate({...s,estimateOptions:parseEstimateOptions(s.estimateOptions)},segment.estimate?.optionId??null) : null
    if(validation.conflicts.length || validation.professional.name!==segment.professionalName || !validation.professional.acceptsBotBookings ||
      validation.professionalDuration!==segment.durationMinutes || validation.customerDuration!==segment.customerDurationMinutes ||
      s.name!==segment.serviceName || s.duration!==segment.durationMinutes || (estimate?.priceMin??s.price)!==segment.priceMinor ||
      (estimate?'STARTING_AT':s.priceMode)!==segment.priceMode || !isDeepStrictEqual(estimate??undefined,segment.estimate) ||
      s.attentionMode==='GUIDED_ESTIMATE' && !estimate ||
      segment.configurationHash!==runtimeServiceConfigurationHash(s)) return {kind:'REQUOTE'}
    const catalogs=await tx.$queryRaw<Array<{count:number}>>(Prisma.sql`SELECT count(*)::int AS count FROM "Service" s JOIN "ServiceCategory" c ON c.id=s."catalogCategoryId" AND c."businessId"=s."businessId" AND c."isActive"=true WHERE s.id=${segment.serviceId} AND s."businessId"=${o.businessId} AND s."isActive"=true AND s."isBookable"=true`)
    const windows=await tx.$queryRaw<Array<{valid:boolean}>>(Prisma.sql`SELECT (${new Date(segment.startAt)} >= clock_timestamp()+make_interval(hours=>${settings.bookingLeadTimeHours})
      AND (${new Date(segment.startAt)} AT TIME ZONE ${settings.timezone})::date < (clock_timestamp() AT TIME ZONE ${settings.timezone})::date+${settings.bookingHorizonDays}::int
      AND extract(minute FROM (${new Date(segment.startAt)} AT TIME ZONE ${settings.timezone}))::int % 30=0 AND extract(second FROM ${new Date(segment.startAt)}::timestamptz)=0) AS valid`)
    if(catalogs[0]?.count!==1 || windows[0]?.valid!==true) return {kind:'REQUOTE'}
  }
  // From here onward, never turn a failed child into a normal return: the caller must roll back.
  const groupId=randomUUID()
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${key},'CONFIRM_VISIT',${o.businessId},${o.sessionId},'STARTED',${requestHash},${groupId},clock_timestamp())`)
  if(scope.customerName!==p.terms.customerName || !scope.customerId) await prismaHandoffEffectExecutor(tx,{businessId:o.businessId,sessionId:o.sessionId,operationKey:key,
    effects:[{kind:'PERSIST_CUSTOMER_NAME',name:p.terms.customerName}]})
  const appointments:Receipt['appointments']=[]
  for(const [index,s] of p.terms.segments.entries()) {
    const result=await confirmBookingWithoutDeposit(tx,childInput(input,key,index))
    if(result.kind!=='CONFIRMED') throw new Error('runtime booking child conflict; rollback required')
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=${groupId} WHERE id=${result.appointmentId} AND "businessId"=${o.businessId} AND "visitId"=${result.visitId}`)
    if(changed!==1) throw new Error('runtime booking group linkage failure; rollback required')
    appointments.push({segmentIndex:index,appointmentId:result.appointmentId,visitId:result.visitId})
  }
  const completed=await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"updatedAt"=clock_timestamp() WHERE "operationKey"=${key} AND "requestHash"=${requestHash} AND status='STARTED'`)
  if(completed!==1) throw new Error('runtime booking completion failure; rollback required')
  return {kind:'COMMITTED',coordinationGroupId:groupId,proposalNonce:p.nonce,fingerprint:p.fingerprint,appointments}
}
