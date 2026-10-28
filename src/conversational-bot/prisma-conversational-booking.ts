import { resolveInstagramBotConfig } from '../config/instagram-bot.js'
import { lockInstagramRuntimeActorTx, runtimeChannelIdentityRecord, validRuntimeChannelIdentity, type RuntimeChannelIdentity } from './conversation-subject.js'
import { resolveBotOptionsConfig } from '../config/bot-options.js'
import { calculateBookingDepositTerms, hasCompleteDepositPaymentConfiguration, type BookingDepositTerms } from '../services/deposit-operations.js'
import { canonicalJsonHash } from './canonical-json.js'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'
import { confirmBookingWithoutDeposit, holdBookingWithDeposit, holdCoordinatedBookingWithDeposit, revalidateBookingWrite, type ConfirmBookingWithoutDepositInput } from '../services/booking-operations.js'
import { prismaHandoffEffectExecutor } from '../bot-options/infrastructure/prisma-handoff-effect-executor.js'
import { parseEstimateOptions, resolveServiceEstimate, type ServiceEstimate } from '../bot-options/domain/service-booking.js'
import { validateCustomerName } from '../bot-options/domain/customer-name-validation.js'
import { amendedPaidAssignments, lockCoordinatedDepositGroupState, coordinatedDepositRequestHash, verifyPendingCancellation, type CoordinatedDepositGroup } from '../services/coordinated-deposit-group.js'

export type RuntimeBookingSegment = {
  serviceId: string; serviceName: string; professionalId: string; professionalName: string
  startAt: string; endAt: string; durationMinutes: number; customerDurationMinutes: number
  priceMinor: number | null; priceMode: 'FIXED' | 'STARTING_AT'; configurationHash: string | null; estimate?: ServiceEstimate
}
export type RuntimeDepositPayment = { transferEnabled:boolean; alias:string|null; cbu:string|null; cvu:string|null; paymentLinkEnabled:boolean; paymentLink:string|null }
export type RuntimeDepositPresentation = { financial:BookingDepositTerms; payment:RuntimeDepositPayment }
export type RuntimeBookingPreparation = {presented:RuntimePresentedBooking;slot:import('./coordinated-booking.js').DialogueAvailabilitySlot} | {unavailable:'DEPOSITS_DISABLED'|'DEPOSIT_MULTISERVICE'|'PAYMENT_UNAVAILABLE'} | null
/** Server configuration, never an input/model authorization flag. */
export function runtimeDepositsEnabled(origin?:Pick<RuntimeBookingOrigin,'businessId'|'subject'>):boolean {
  if(origin?.subject){const instagram=resolveInstagramBotConfig(process.env);return instagram.enabled&&instagram.businessIds.includes(origin.businessId)}
  return resolveBotOptionsConfig(process.env).depositsCapabilityEnabled
}
export type RuntimeBookingTerms = {
  version: 1; businessId: string; timezone: string; date: string; customerName: string
  preference: { kind: 'any' } | { kind: 'specific'; id: string }
  segments: readonly RuntimeBookingSegment[]; totalPriceMinor: number | null; deposit?: RuntimeDepositPresentation
}
export type RuntimeShownScope = { businessId: string; sessionId: string; deploymentId: string; generation: number; revision: string; configurationId: string; dispatchFenceEpoch: number; handoffFenceEpoch: number }
export type RuntimePresentedBooking = { scope: RuntimeShownScope; version: 1; nonce: string; fingerprint: string; conditionsPresented: true; terms: RuntimeBookingTerms }
export type RuntimeBookingOrigin = {
  kind: 'RUNTIME'; businessId: string; sessionId: string; revision: bigint
  deploymentId: string; generation: number; configurationId: string; dispatchFenceEpoch: number; handoffFenceEpoch: number
  operationKey: string; newBookingAllowed: boolean
} & RuntimeChannelIdentity
export type RuntimeBookingInput = { origin: RuntimeBookingOrigin; presented: RuntimePresentedBooking; currentDraft: unknown
  consent: { confirmed: boolean; nonce: string; fingerprint: string } }
export type RuntimeBookingReceipt = { kind: 'COMMITTED'; coordinationGroupId: string; proposalNonce: string; fingerprint: string
  appointments: Array<{ segmentIndex: number; appointmentId: string; visitId: string }>; businessAddress?: string; currentSchedule?:Array<{appointmentId:string;startAt:string;professionalId:string;professionalName:string}> }
export type RuntimeHeldReceipt = Omit<RuntimeBookingReceipt,'kind'> & {kind:'HELD';operationKey:string;depositId:string;expiresAt:string;amount:number;depositStatus:'PENDING_PROOF'|'PENDING_RESUBMISSION'|'PROOF_RECEIVED'|'APPROVED'|'REJECTED'|'EXPIRED';cancellationReason?:'CUSTOMER'|'STAFF';coordinatedDepositGroup?:{version:1;groupId:string;requestHash:string};currentSchedule?:Array<{appointmentId:string;startAt:string;professionalId:string;professionalName:string}>}
export type RuntimeBookingResult = RuntimeBookingReceipt | RuntimeHeldReceipt | { kind: 'BLOCKED'; reason: 'SCOPE_REJECTED' | 'FINANCIAL_OR_GUIDANCE' } | { kind: 'REQUOTE' }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
export const runtimeBookingFingerprint = (terms: RuntimeBookingTerms): string => canonicalJsonHash(terms)
export function runtimeBookingRequestHash(o:RuntimeBookingOrigin,p:RuntimePresentedBooking):string {
  return canonicalJsonHash({presented:p,origin:{businessId:o.businessId,sessionId:o.sessionId,...runtimeChannelIdentityRecord(o),deploymentId:o.deploymentId,generation:o.generation,
    dispatchFenceEpoch:o.dispatchFenceEpoch,handoffFenceEpoch:o.handoffFenceEpoch,configurationId:o.configurationId,revision:String(o.revision)}})
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value)
const keys = (value: object, required: string[], optional: string[] = []) => required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key))
const money = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const blocked = (): RuntimeBookingResult => ({kind:'BLOCKED',reason:'SCOPE_REJECTED'})

/** Hash of the current service configuration, not of an AI quote or suggested ID. */
export function runtimeServiceConfigurationHash(service: Record<string, unknown>): string {
  return canonicalJsonHash(['bookingOrderPriority','attentionMode','price','priceMode','estimateAllowsBooking','estimateQuestion','estimateOptions','estimateExplanation','estimateDisclaimer',
    'requiresPhoto','validationEnabled','validationMessage','validationQuestion','customerDurationMin','customerDurationMax','depositMode','depositValue'].map(key=>service[key]??null))
}
function validPresented(p: unknown): p is RuntimePresentedBooking {
  if (!object(p) || !keys(p,['scope','version','nonce','fingerprint','conditionsPresented','terms']) || p.version !== 1 || p.conditionsPresented !== true ||
    typeof p.nonce!=='string' || typeof p.fingerprint!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.nonce) || !/^[a-f0-9]{64}$/.test(p.fingerprint)) return false
  if(!object(p.scope) || !keys(p.scope,['businessId','sessionId','deploymentId','generation','revision','configurationId','dispatchFenceEpoch','handoffFenceEpoch']) ||
    ![p.scope.businessId,p.scope.sessionId,p.scope.deploymentId,p.scope.configurationId].every(value=>text(value)) || typeof p.scope.revision!=='string' || !/^\d+$/.test(p.scope.revision) ||
    ![p.scope.generation,p.scope.dispatchFenceEpoch,p.scope.handoffFenceEpoch].every(value=>typeof value==='number' && Number.isSafeInteger(value)&&value>=0)) return false
  const t=p.terms, name=object(t) && typeof t.customerName==='string' ? validateCustomerName(t.customerName) : null
  if (!object(t) || !keys(t,['version','businessId','timezone','date','customerName','preference','segments','totalPriceMinor'],['deposit']) || t.version!==1 ||
    !text(t.businessId) || !text(t.timezone) || typeof t.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !name?.ok || name.normalized!==t.customerName ||
    !object(t.preference) || !(t.preference.kind==='any' && keys(t.preference,['kind']) || t.preference.kind==='specific' && keys(t.preference,['kind','id']) && text(t.preference.id)) ||
    !Array.isArray(t.segments) || !t.segments.length || t.segments.length>8 || !money(t.totalPriceMinor) || JSON.stringify(p).length>12000) return false
  let previousEnd: string | null=null, total=0, fixed=true
  for(const s of t.segments) {
    if(!object(s) || !keys(s,['serviceId','serviceName','professionalId','professionalName','startAt','endAt','durationMinutes','customerDurationMinutes','priceMinor','priceMode','configurationHash'],['estimate']) ||
      ![s.serviceId,s.serviceName,s.professionalId,s.professionalName].every(value=>text(value)) || !instant(s.startAt) || !instant(s.endAt) ||
      typeof s.durationMinutes!=='number' || !Number.isSafeInteger(s.durationMinutes) || s.durationMinutes<=0 || s.durationMinutes>720 || typeof s.customerDurationMinutes!=='number' || !Number.isSafeInteger(s.customerDurationMinutes) ||
      s.customerDurationMinutes<s.durationMinutes || s.customerDurationMinutes>720 || Date.parse(s.endAt)-Date.parse(s.startAt)!==Math.max(s.durationMinutes,s.customerDurationMinutes)*60000 ||
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
    if(s.priceMode==='FIXED' && s.priceMinor!==null) total+=s.priceMinor
    else fixed=false
    previousEnd=s.endAt
  }
  if (t.deposit!==undefined && !validDepositPresentation(t.deposit,t.segments as RuntimeBookingSegment[])) return false
  return t.totalPriceMinor===(fixed?total:null) && p.fingerprint===canonicalJsonHash(t)
}
function validDepositPresentation(value:unknown,segments:readonly RuntimeBookingSegment[]):value is RuntimeDepositPresentation {
  if(!object(value)||!keys(value,['financial','payment'])||!object(value.financial)||!object(value.payment))return false
  const f=value.financial,p=value.payment
  if(!keys(f,['lines','amount','ttlMinutes','ttlProvenance'])||!Array.isArray(f.lines)||!f.lines.length||f.lines.length>segments.length||
     typeof f.ttlMinutes!=='number'||!Number.isSafeInteger(f.ttlMinutes)||f.ttlMinutes<=0||f.ttlMinutes>43200||
     !['BUSINESS_POLICY','DEFAULT_120'].includes(String(f.ttlProvenance)))return false
  let previous=-1
  for(const line of f.lines) {
    if(!object(line)||!keys(line,['serviceId','sortOrder','serviceName','mode','configuredValue','baseAmount','amount'])||
       typeof line.sortOrder!=='number'||!Number.isSafeInteger(line.sortOrder)||line.sortOrder<=previous||
       line.sortOrder>=segments.length||line.serviceId!==segments[line.sortOrder]?.serviceId||
       line.serviceName!==segments[line.sortOrder]?.serviceName||!['FIXED','PERCENTAGE'].includes(String(line.mode))||
       typeof line.configuredValue!=='number'||!Number.isSafeInteger(line.configuredValue))return false
    previous=line.sortOrder
  }
  if(!keys(p,['transferEnabled','alias','cbu','cvu','paymentLinkEnabled','paymentLink'])||typeof p.transferEnabled!=='boolean'||typeof p.paymentLinkEnabled!=='boolean'||
     ![p.alias,p.cbu,p.cvu,p.paymentLink].every(v=>v===null||text(v,1000)))return false
  if(p.paymentLink!==null){try{const url=new URL(String(p.paymentLink));if(url.protocol!=='https:'||url.username||url.password)return false}catch{return false}}
  try {
    const canonical=calculateBookingDepositTerms({services:segments.map((segment,index)=>{
      const line=(f.lines as BookingDepositTerms['lines']).find(line=>line.sortOrder===index)
      return {id:segment.serviceId,name:segment.serviceName,price:segment.priceMinor,priceMode:segment.priceMode,
        depositMode:line?.mode??'NONE',depositValue:line?.configuredValue??null}
    }),businessDepositHoldMinutes:f.ttlProvenance==='DEFAULT_120'?null:f.ttlMinutes})
    return isDeepStrictEqual(f,canonical)&&hasCompleteDepositPaymentConfiguration(p as RuntimeDepositPayment)
  }catch{return false}
}
/** Current uncached canonical financial terms; NONE companions are included only in service order. */
export async function prepareRuntimeDeposit(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,businessId:string,
  service:Record<string,unknown>|readonly Record<string,unknown>[],segment:RuntimeBookingSegment|readonly RuntimeBookingSegment[],lock=false):Promise<RuntimeDepositPresentation|null> {
  const services=Array.isArray(service)?service:[service],segments=Array.isArray(segment)?segment:[segment]
  if(services.length!==segments.length||!services.length)return null
  const settings=await tx.$queryRaw<Array<{depositHoldMinutes:number|null}>>(Prisma.sql`/* runtime-booking-deposit-settings */ SELECT "depositHoldMinutes" FROM "BusinessBotOptionsSettings" WHERE "businessId"=${businessId} ${lock?Prisma.sql`FOR SHARE`:Prisma.empty}`)
  const payment=await tx.$queryRaw<RuntimeDepositPayment[]>(Prisma.sql`/* runtime-booking-deposit-payment */ SELECT "transferEnabled",alias,cbu,cvu,"paymentLinkEnabled","paymentLink" FROM "BusinessPaymentSettings" WHERE "businessId"=${businessId} ${lock?Prisma.sql`FOR SHARE`:Prisma.empty}`)
  if(settings.length!==1||payment.length!==1)return null
  try {
    const deposit={financial:calculateBookingDepositTerms({services:segments.map((s,index)=>({
      id:s.serviceId,name:s.serviceName,price:s.priceMinor,priceMode:s.priceMode,
      depositMode:services[index]!.depositMode as 'NONE'|'FIXED'|'PERCENTAGE',depositValue:services[index]!.depositValue as number|null
    })),businessDepositHoldMinutes:settings[0]!.depositHoldMinutes}),payment:payment[0]!}
    return validDepositPresentation(deposit,segments)?deposit:null
  }catch{return null}
}
/** Bounded parsing only: this is not booking or consent authority. */
export function parseRuntimePresentedBooking(value: unknown): RuntimePresentedBooking | null {
  return validPresented(value) ? structuredClone(value) : null
}
function validDraft(draft: unknown, p: RuntimePresentedBooking): boolean {
  if(!object(draft) || !object(draft.bookingReservation) || !isDeepStrictEqual(draft.bookingReservation.presented,p) ||
    draft.businessId!==p.terms.businessId || draft.customerName!==p.terms.customerName || draft.date!==p.terms.date || draft.pending!=='proposal' ||
    !isDeepStrictEqual(draft.professional,p.terms.preference) || draft.referral || draft.serviceRequest || draft.editRequest || draft.professionalReference ||
    !object(draft.slot) || draft.slot.startAt!==p.terms.segments[0]!.startAt) return false
  const ids: unknown[]=draft.basket===undefined && text(draft.serviceId)?[draft.serviceId]:[]
  if(draft.basket!==undefined && (!object(draft.basket)||!Array.isArray(draft.basket.members)))return false
  for(const member of object(draft.basket)&&Array.isArray(draft.basket.members)?draft.basket.members:[]) {
    if(!object(member) || member.mode!=='single' || !Array.isArray(member.serviceIds) || member.serviceIds.length!==1) return false
    ids.push(member.serviceIds[0])
  }
  if(!isDeepStrictEqual(ids,p.terms.segments.map(s=>s.serviceId))) return false
  if(p.terms.segments.length===1) return draft.slot.professionalId===p.terms.segments[0]!.professionalId && draft.slot.professionalName===p.terms.segments[0]!.professionalName
  if(!object(draft.slot.coordination)) return false
  const segments=p.terms.segments.map(({priceMinor,priceMode,configurationHash,estimate,...segment})=>segment)
  return isDeepStrictEqual(draft.slot.coordination.segments,segments)
}
type ScopeRow={phone?:string;state:unknown;customerId:string|null;customerName:string|null;businessAddress?:string|null}
async function lockScope(tx: Prisma.TransactionClient, o: RuntimeBookingOrigin): Promise<ScopeRow | undefined> {
  if(o.subject)return lockInstagramRuntimeActorTx(tx,o)
  const rows=await tx.$queryRaw<ScopeRow[]>(Prisma.sql`
    /* runtime-booking-scope */
    SELECT c."phone",s."state",customer."id" AS "customerId",customer."name" AS "customerName",b."publicAddress" AS "businessAddress"
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
/** Pure projection only; the caller must independently establish every write guard. */
export function runtimeBookingChildInput(p:RuntimePresentedBooking,key:string,index:number,newBookingAllowed:boolean):ConfirmBookingWithoutDepositInput {
  if(!validPresented(p)||!text(key,256)||!Number.isSafeInteger(index)||index<0||index>=p.terms.segments.length)throw new Error('invalid runtime child proof')
  const s=p.terms.segments[index]!
  const estimate=s.estimate?{optionId:s.estimate.optionId,optionLabel:s.estimate.optionLabel,priceMin:s.estimate.priceMin,priceMax:s.estimate.priceMax}:undefined
  return {businessId:p.scope.businessId,sessionId:p.scope.sessionId,operationKey:childKey(key,index),newBookingAllowed,
    services:[{serviceId:s.serviceId,name:s.serviceName,durationMinutes:s.durationMinutes,priceMinor:s.priceMinor,priceMode:s.priceMode,...(estimate?{estimate}:{})}],
    professional:{professionalId:s.professionalId,name:s.professionalName,assignedByBalancer:false},date:p.terms.date,slotStartAt:s.startAt,totalDurationMinutes:s.durationMinutes,
    totalPriceMinor:s.priceMode==='FIXED'?s.priceMinor:null}
}
function childInput(input:RuntimeBookingInput,key:string,index:number):ConfirmBookingWithoutDepositInput {
  return {...runtimeBookingChildInput(input.presented,key,index,input.origin.newBookingAllowed),...(input.origin.subject?{subject:input.origin.subject}:{})}
}
/** F7's persisted legacy payload/order remains unchanged; only verify its durable child receipt. */
export function runtimeBookingChildRequestHash(input: ConfirmBookingWithoutDepositInput, depositRequired = false): string {
  return hash({services:input.services,professional:input.professional,date:input.date,slotStartAt:input.slotStartAt,totalDurationMinutes:input.totalDurationMinutes,totalPriceMinor:input.totalPriceMinor,...(depositRequired?{depositRequired:true}:{})})
}
async function replay(tx: Prisma.TransactionClient, input: RuntimeBookingInput, key: string, requestHash: string, customerId: string | null): Promise<RuntimeBookingReceipt | null> {
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
  const appointments:RuntimeBookingReceipt['appointments']=[]
  for(const [index,segment] of input.presented.terms.segments.entries()) {
    const ops=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`SELECT * FROM "BotOperation" WHERE "operationKey"=${childKey(key,index)+':CONFIRM_VISIT'} FOR UPDATE`)
    const op=ops[0], member=members.find(m=>m.visitId===op?.resultRef), price=segment.priceMode==='FIXED'?segment.priceMinor:null
    if(ops.length!==1 || !op || op.businessId!==input.origin.businessId || op.sessionId!==input.origin.sessionId || op.type!=='CONFIRM_VISIT' || op.status!=='COMPLETED' || op.requestHash!==runtimeBookingChildRequestHash(childInput(input,key,index)) || !member ||
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
    !validRuntimeChannelIdentity(o) || typeof o.revision!=='bigint' || o.revision<0n ||
    ![o.generation,o.dispatchFenceEpoch,o.handoffFenceEpoch].every(value=>Number.isSafeInteger(value)&&value>=0) ||
    !validPresented(p) || !isDeepStrictEqual(p.scope,{businessId:o.businessId,sessionId:o.sessionId,deploymentId:o.deploymentId,generation:o.generation,revision:String(o.revision),configurationId:o.configurationId,dispatchFenceEpoch:o.dispatchFenceEpoch,handoffFenceEpoch:o.handoffFenceEpoch}) || o.businessId!==p.terms.businessId || !validDraft(input.currentDraft,p) ||
    input.consent?.confirmed!==true || input.consent.nonce!==p.nonce || input.consent.fingerprint!==p.fingerprint) return blocked()
  const scope=await lockScope(tx,o)
  if(!scope || (!o.subject && !/^\+?[\d\s().-]+$/.test(scope.phone??'')) || !object(scope.state) || !object(scope.state.conversationDraft) ||
    !isDeepStrictEqual(scope.state.conversationDraft.dialogue,input.currentDraft) || !['NONE','DRAFT'].includes(String(scope.state.booking)) ||
    scope.state.deposit!=='NONE' || scope.state.handoff!=='NONE') return blocked()
  const key='conversation-booking:'+o.operationKey+':'+p.nonce
  const requestHash=runtimeBookingRequestHash(o,p)
  await acquireAgendaHierarchy(tx,{businessId:o.businessId,professionalIds:p.terms.segments.map(s=>s.professionalId)})
  const prior=p.terms.deposit && p.terms.segments.length>1
    ? await replayCoordinatedRuntimeDeposit(tx,input,key,scope.customerId)
    : p.terms.deposit ? await replayRuntimeDeposit(tx,input,key,requestHash,scope.customerId) : await replay(tx,input,key,requestHash,scope.customerId)
  if(prior) return {...prior,...(text(scope.businessAddress,1000)?{businessAddress:scope.businessAddress}:{})}
  if(!o.newBookingAllowed) return blocked()
  if(p.terms.deposit && !runtimeDepositsEnabled(o))return {kind:'BLOCKED',reason:'FINANCIAL_OR_GUIDANCE'}
  const clocks=await tx.$queryRaw<Array<{timezone:string;dbNow:Date;bookingLeadTimeHours:number;bookingHorizonDays:number}>>(Prisma.sql`SELECT timezone,"bookingLeadTimeHours","bookingHorizonDays",clock_timestamp() AS "dbNow" FROM "BusinessBotOptionsSettings" WHERE "businessId"=${o.businessId}`)
  const settings=clocks[0]
  if(!settings || settings.timezone!==p.terms.timezone) return {kind:'REQUOTE'}
  const allIds=[...new Set(p.terms.segments.map(s=>s.serviceId))]
  const rules=await tx.$queryRaw<Array<{count:number}>>(Prisma.sql`SELECT count(*)::int AS count FROM "ServiceCombinationRule" WHERE "businessId"=${o.businessId} AND "serviceAId" IN (${Prisma.join(allIds)}) AND "serviceBId" IN (${Prisma.join(allIds)}) AND policy<>'ALLOWED'::"ServiceCombinationPolicy"`)
  if((rules[0]?.count??0)>0) return {kind:'BLOCKED',reason:'FINANCIAL_OR_GUIDANCE'}
  const canonicalServices:Record<string,unknown>[]=[]
  for(const segment of p.terms.segments) {
    const validation=await revalidateBookingWrite(tx,{businessId:o.businessId,professionalId:segment.professionalId,professionalIdsToLock:p.terms.segments.map(s=>s.professionalId),
      serviceIds:[segment.serviceId],startAt:new Date(segment.startAt),timezone:settings.timezone,dbNow:new Date(settings.dbNow)})
    const s=validation.orderedServices[0]!
    if((s.depositMode!=='NONE')!==Boolean(p.terms.deposit?.financial.lines.some(line=>line.serviceId===segment.serviceId)) || s.requiresPhoto || s.validationEnabled || !['DIRECT_BOOKING','GUIDED_ESTIMATE'].includes(s.attentionMode) ||
      s.attentionMode==='GUIDED_ESTIMATE' && !s.estimateAllowsBooking) return {kind:'BLOCKED',reason:'FINANCIAL_OR_GUIDANCE'}
    const estimate=s.attentionMode==='GUIDED_ESTIMATE' ? resolveServiceEstimate({...s,estimateOptions:parseEstimateOptions(s.estimateOptions)},segment.estimate?.optionId??null) : null
    if(validation.conflicts.length || validation.professional.name!==segment.professionalName || !validation.professional.acceptsBotBookings ||
      validation.professionalDuration!==segment.durationMinutes || validation.customerDuration!==segment.customerDurationMinutes ||
      s.name!==segment.serviceName || s.duration!==segment.durationMinutes || (estimate?.priceMin??s.price)!==segment.priceMinor ||
      (estimate?'STARTING_AT':s.priceMode)!==segment.priceMode || !isDeepStrictEqual(estimate??undefined,segment.estimate) ||
      s.attentionMode==='GUIDED_ESTIMATE' && !estimate ||
      segment.configurationHash!==runtimeServiceConfigurationHash(s)) return {kind:'REQUOTE'}
    canonicalServices.push(s)
    const catalogs=await tx.$queryRaw<Array<{count:number}>>(Prisma.sql`SELECT count(*)::int AS count FROM "Service" s JOIN "ServiceCategory" c ON c.id=s."catalogCategoryId" AND c."businessId"=s."businessId" AND c."isActive"=true WHERE s.id=${segment.serviceId} AND s."businessId"=${o.businessId} AND s."isActive"=true AND s."isBookable"=true`)
    const windows=await tx.$queryRaw<Array<{valid:boolean}>>(Prisma.sql`SELECT (${new Date(segment.startAt)} >= clock_timestamp()+make_interval(hours=>${settings.bookingLeadTimeHours})
      AND (${new Date(segment.startAt)} AT TIME ZONE ${settings.timezone})::date < (clock_timestamp() AT TIME ZONE ${settings.timezone})::date+${settings.bookingHorizonDays}::int
      AND extract(minute FROM (${new Date(segment.startAt)} AT TIME ZONE ${settings.timezone}))::int % 30=0 AND extract(second FROM ${new Date(segment.startAt)}::timestamptz)=0) AS valid`)
    if(catalogs[0]?.count!==1 || windows[0]?.valid!==true) return {kind:'REQUOTE'}
  }
  if(p.terms.deposit && !isDeepStrictEqual(await prepareRuntimeDeposit(tx,o.businessId,canonicalServices,p.terms.segments,true),p.terms.deposit))return {kind:'REQUOTE'}
  // From here onward, never turn a failed child into a normal return: the caller must roll back.
  if(p.terms.deposit && p.terms.segments.length>1) {
    if(scope.customerName!==p.terms.customerName || !scope.customerId) await prismaHandoffEffectExecutor(tx,{businessId:o.businessId,sessionId:o.sessionId,operationKey:key,
      ...(o.subject?{subject:o.subject}:{}),effects:[{kind:'PERSIST_CUSTOMER_NAME',name:p.terms.customerName}]})
    // The shared core owns the only parent operation and every child hold.
    const group=await holdCoordinatedBookingWithDeposit(tx,{origin:o,proposal:p,currentDraft:input.currentDraft,consent:input.consent})
    return coordinatedRuntimeReceipt(group,'PENDING_PROOF',group.expiresAt,text(scope.businessAddress,1000)?scope.businessAddress:undefined)
  }
  const groupId=randomUUID()
  const operationType=p.terms.deposit?'HOLD_VISIT_WITH_DEPOSIT':'CONFIRM_VISIT'
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${key},${operationType},${o.businessId},${o.sessionId},'STARTED',${requestHash},${groupId},clock_timestamp())`)
  if(scope.customerName!==p.terms.customerName || !scope.customerId) await prismaHandoffEffectExecutor(tx,{businessId:o.businessId,sessionId:o.sessionId,operationKey:key,
    ...(o.subject?{subject:o.subject}:{}),effects:[{kind:'PERSIST_CUSTOMER_NAME',name:p.terms.customerName}]})
  const appointments:RuntimeBookingReceipt['appointments']=[]
  let held:Awaited<ReturnType<typeof holdBookingWithDeposit>>|undefined
  for(const [index,s] of p.terms.segments.entries()) {
    const result=p.terms.deposit ? await holdBookingWithDeposit(tx,childInput(input,key,index)) : await confirmBookingWithoutDeposit(tx,childInput(input,key,index))
    if(result.kind==='HELD')held=result
    if(result.kind==='SLOT_CONFLICT') throw new Error('runtime booking child conflict; rollback required')
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=${groupId} WHERE id=${result.appointmentId} AND "businessId"=${o.businessId} AND "visitId"=${result.visitId}`)
    if(changed!==1) throw new Error('runtime booking group linkage failure; rollback required')
    appointments.push({segmentIndex:index,appointmentId:result.appointmentId,visitId:result.visitId})
  }
  const completed=await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"updatedAt"=clock_timestamp() WHERE "operationKey"=${key} AND "requestHash"=${requestHash} AND status='STARTED'`)
  if(completed!==1) throw new Error('runtime booking completion failure; rollback required')
  if(held?.kind==='HELD')return {kind:'HELD',operationKey:key,depositId:held.depositId,expiresAt:held.expiresAt.toISOString(),amount:held.amount,depositStatus:'PENDING_PROOF',coordinationGroupId:groupId,proposalNonce:p.nonce,fingerprint:p.fingerprint,appointments,...(text(scope.businessAddress,1000)?{businessAddress:scope.businessAddress}:{})}
  return {kind:'COMMITTED',coordinationGroupId:groupId,proposalNonce:p.nonce,fingerprint:p.fingerprint,appointments,...(text(scope.businessAddress,1000)?{businessAddress:scope.businessAddress}:{})}
}


export type RuntimeBookingReservation = { presented: RuntimePresentedBooking; receipt?: RuntimeBookingReceipt | RuntimeHeldReceipt }
/** Persisted server proof is bounded, never permission for a fresh write. */
function validateRuntimeBookingReservation(value: unknown, businessId: string): asserts value is RuntimeBookingReservation {
  if (!object(value) || !keys(value,['presented'],['receipt']) || !validPresented(value.presented) ||
    value.presented.scope.businessId!==businessId || value.presented.terms.businessId!==businessId) throw new Error('invalid runtime reservation')
  const p=value.presented, r=value.receipt
  if (r!==undefined) {
    if (!object(r) || !keys(r,['kind','coordinationGroupId','proposalNonce','fingerprint','appointments'],r.kind==='HELD'?['businessAddress','operationKey','depositId','expiresAt','amount','depositStatus','coordinatedDepositGroup','cancellationReason','currentSchedule']:['businessAddress','currentSchedule']) ||
      !['COMMITTED','HELD'].includes(String(r.kind)) || !text(r.coordinationGroupId) || r.proposalNonce!==p.nonce || r.fingerprint!==p.fingerprint ||
      r.businessAddress!==undefined && !text(r.businessAddress,1000) || !Array.isArray(r.appointments) || r.appointments.length!==p.terms.segments.length) throw new Error('invalid runtime receipt')
    if(r.kind==='COMMITTED' && p.terms.deposit || r.kind==='HELD' && (!p.terms.deposit||!text(r.operationKey,256)||!text(r.depositId)||!instant(r.expiresAt)||r.amount!==p.terms.deposit.financial.amount||!['PENDING_PROOF','PENDING_RESUBMISSION','PROOF_RECEIVED','APPROVED','REJECTED','EXPIRED'].includes(String(r.depositStatus))))throw new Error('invalid runtime financial receipt')
    if(r.cancellationReason!==undefined && (r.kind!=='HELD' || r.depositStatus!=='REJECTED' || typeof r.cancellationReason!=='string' || !['CUSTOMER','STAFF'].includes(r.cancellationReason)))throw new Error('invalid runtime cancellation reason')
    if(r.kind==='HELD' && p.terms.segments.length>1) {
      const seal=r.coordinatedDepositGroup
      if(!object(seal)||!keys(seal,['version','groupId','requestHash'])||seal.version!==1||
        seal.groupId!==r.coordinationGroupId||typeof seal.groupId!=='string'||!text(seal.groupId)||
        typeof seal.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(seal.requestHash))throw new Error('invalid coordinated financial receipt seal')
    } else if(r.coordinatedDepositGroup!==undefined)throw new Error('unexpected coordinated financial receipt seal')
    if(r.currentSchedule!==undefined && (!Array.isArray(r.currentSchedule) || r.currentSchedule.length!==r.appointments.length ||
      r.currentSchedule.some((entry,index)=>!object(entry) || !keys(entry,['appointmentId','startAt','professionalId','professionalName']) ||
        entry.appointmentId!==r.appointments[index]?.appointmentId || !instant(entry.startAt) || !text(entry.professionalId) || !text(entry.professionalName))))
      throw new Error('invalid operational schedule')
    const ids=new Set<string>(), visits=new Set<string>()
    for (const [index,member] of r.appointments.entries()) {
      if (!object(member) || !keys(member,['segmentIndex','appointmentId','visitId']) || member.segmentIndex!==index ||
        !text(member.appointmentId) || !text(member.visitId) || ids.has(member.appointmentId) || visits.has(member.visitId)) throw new Error('invalid runtime receipt members')
      ids.add(member.appointmentId); visits.add(member.visitId)
    }
  }
  return
}
export function parseRuntimeBookingReservation(value: unknown, businessId: string): RuntimeBookingReservation {
  validateRuntimeBookingReservation(value,businessId)
  return structuredClone(value)
}
export function runtimeProposalMatchesState(p: RuntimePresentedBooking, draft: unknown): boolean { return validPresented(p) && validDraft(draft,p) }
function runtimeBookingDetail(p: RuntimePresentedBooking): string {
  const date = new Intl.DateTimeFormat('es-AR', { timeZone: p.terms.timezone, year: 'numeric', day: '2-digit', month: '2-digit' })
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: p.terms.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const money = (amount: number) => '$' + amount.toLocaleString('es-AR')
  const dates = p.terms.segments.map(segment => date.format(new Date(segment.startAt)))
  const commonDate = new Set(dates).size === 1 ? dates[0]! : null
  const lines = p.terms.segments.map((segment, index) => {
    const price = segment.estimate
      ? (segment.estimate.optionLabel ? segment.estimate.optionLabel + ' · ' : '') + 'Estimado ' + (segment.estimate.priceMax === null
        ? 'desde ' + money(segment.estimate.priceMin) : money(segment.estimate.priceMin) + ' a ' + money(segment.estimate.priceMax))
      : segment.priceMinor === null ? 'Precio a confirmar' : (segment.priceMode === 'STARTING_AT' ? 'Desde ' : '') + money(segment.priceMinor)
    return [segment.serviceName + ' con ' + segment.professionalName,
      (commonDate ? '' : dates[index] + ' · ') + time.format(new Date(segment.startAt)),
      'Duración: ' + segment.customerDurationMinutes + ' min', 'Precio: ' + price].join('\n')
  })
  return p.terms.customerName + ':' + (commonDate ? '\nFecha: ' + commonDate : '') + '\n\n' + lines.join('\n\n') + '\n\n' +
    (p.terms.totalPriceMinor === null ? 'Total a consultar.' : 'Total: ' + money(p.terms.totalPriceMinor))
}
/** Shared sealed-detail presentation for the canonical approval notification. */
export function runtimeApprovedBookingReply(p: RuntimePresentedBooking, address?: string): string {
  return 'Aprobamos el comprobante y tu reserva quedó confirmada.\n\n' + runtimeBookingDetail(p) +
    (p.terms.deposit ? '\n\nSeña' + (p.terms.segments.length > 1 ? ' conjunta' : '') + ': $' + p.terms.deposit.financial.amount.toLocaleString('es-AR') : '') +
    (address ? '\n\nTe esperamos en ' + address : '\n\nTe esperamos.')
}
export function runtimeBookingSummary(p: RuntimePresentedBooking): string {
  const deposit = p.terms.deposit
  const conditions = deposit ? [
    'Seña requerida: $' + deposit.financial.amount.toLocaleString('es-AR'),
    'Al aceptar, el horario se mantiene por ' + deposit.financial.ttlMinutes + ' minutos para enviar el comprobante.',
    ...(p.terms.segments.length > 1 ? ['Es una seña conjunta: enviá un único comprobante para todos los servicios.'] : []),
    'Todavía no está confirmado.'
  ].join('\n') : 'Sin seña requerida.'
  return 'Propuesta para ' + runtimeBookingDetail(p) + '\n\n' + conditions + '\n\nLa disponibilidad se verifica otra vez al confirmar.'
}
export function runtimeBookingReceiptReply(reservation: RuntimeBookingReservation): string {
  if(!reservation.receipt) throw new Error('runtime receipt required')
  const current=reservation.receipt.currentSchedule
  const presented=current ? {...reservation.presented,terms:{...reservation.presented.terms,
    segments:reservation.presented.terms.segments.map((segment,index)=>({...segment,startAt:current[index]!.startAt,
      endAt:new Date(Date.parse(current[index]!.startAt)+segment.customerDurationMinutes*60000).toISOString(),
      professionalId:current[index]!.professionalId,professionalName:current[index]!.professionalName}))}} : reservation.presented
  if(reservation.receipt.kind==='HELD') {
    const r=reservation.receipt
    if(r.depositStatus==='EXPIRED')return 'Venció el plazo de la seña. La reserva no está confirmada; no inicié otra reserva.'
    if(r.depositStatus==='REJECTED' && r.cancellationReason)return 'El pedido fue cancelado'+(r.cancellationReason==='STAFF'?' por el equipo':'')+'. El horario fue liberado; podemos comenzar un pedido nuevo.'
    if(r.depositStatus==='REJECTED')return 'El equipo rechazó el pago. La reserva no está confirmada; consultá al equipo antes de continuar.'
    if(r.depositStatus==='PROOF_RECEIVED')return 'Recibimos tu comprobante. El equipo debe validarlo; la reserva todavía no está confirmada.'
    if(r.depositStatus!=='APPROVED')return 'Mantuvimos provisionalmente el horario. La reserva todavía no está confirmada.\n\n'+runtimeBookingDetail(presented)+'\n\nSeña: $'+r.amount.toLocaleString('es-AR')+'\nEnviá el comprobante'+(reservation.presented.terms.segments.length>1?' único para todos los servicios':'')+' antes de '+new Intl.DateTimeFormat('es-AR',{timeZone:reservation.presented.terms.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(r.expiresAt))+'.\n'+runtimeDepositPaymentReply(reservation.presented.terms.deposit!.payment)+(r.depositStatus==='PENDING_RESUBMISSION'?'\nEl equipo necesita un nuevo comprobante.':'')
  }
  return 'La reserva fue confirmada.\n\n'+runtimeBookingDetail(presented)+(reservation.receipt.businessAddress?'\nTe esperamos en '+reservation.receipt.businessAddress:'')
}

function runtimeDepositPaymentReply(p:RuntimeDepositPayment):string {
  return [p.transferEnabled ? ['Transferencia:',p.alias?'Alias: '+p.alias:'',p.cbu?'CBU: '+p.cbu:'',p.cvu?'CVU: '+p.cvu:''].filter(Boolean).join('\n') : '',
    p.paymentLinkEnabled?'Link de pago: '+p.paymentLink:''].filter(Boolean).join('\n')
}
/** A held receipt is not payment authority: read scoped durable financial state on every later turn. */
export async function loadRuntimeDepositReceipt(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,scope:{businessId:string;sessionId:string;expectedRevision:bigint}&RuntimeChannelIdentity,reservation:RuntimeBookingReservation):Promise<RuntimeHeldReceipt|null> {
  const p=reservation.presented,r=reservation.receipt
  if(!r||r.kind!=='HELD'||!p.terms.deposit||p.scope.businessId!==scope.businessId||p.scope.sessionId!==scope.sessionId||!validRuntimeChannelIdentity(scope))return null
  const instagramActor=scope.subject?await lockInstagramRuntimeActorTx(tx,{businessId:scope.businessId,sessionId:scope.sessionId,subject:scope.subject,revision:scope.expectedRevision}):null
  if(scope.subject&&!instagramActor?.customerId)return null
  if(p.terms.segments.length>1) {
    try {
      parseRuntimeBookingReservation(reservation,scope.businessId)
      // Keep the core's business -> professional -> session locking order.
      const live=await lockCoordinatedDepositGroupState(tx as Prisma.TransactionClient,{businessId:scope.businessId,groupId:r.coordinationGroupId})
      const owners=scope.subject?(instagramActor?[instagramActor]:[]):await tx.$queryRaw<Array<{businessAddress:string|null}>>(Prisma.sql`
        /* runtime-booking-coordinated-deposit-scope */
        SELECT b."publicAddress" AS "businessAddress" FROM "BotSession" s
        JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
        JOIN "Business" b ON b.id=s."businessId"
        WHERE s.id=${scope.sessionId} AND s."businessId"=${scope.businessId} AND s.revision=${scope.expectedRevision}
          AND s.status='ACTIVE' AND regexp_replace(c.phone,'[^0-9]','','g')=${scope.canonicalPhone}
        FOR SHARE OF s,c,b`)
      if(owners.length!==1)return null
      const g=live.group,seal=r.coordinatedDepositGroup
      if(!seal||seal.version!==1||seal.groupId!==g.groupId||seal.requestHash!==g.requestHash||
        g.operationKey!==r.operationKey||g.anchorDepositId!==r.depositId||!isDeepStrictEqual(runtimeChannelIdentityRecord(g),runtimeChannelIdentityRecord(scope))||
        g.amount!==r.amount||!isDeepStrictEqual(g.proposal,p)||
        !isDeepStrictEqual(g.members.map(({segmentIndex,appointmentId,visitId})=>({segmentIndex,appointmentId,visitId})),r.appointments))return null
      const professionals=await tx.$queryRaw<Array<{id:string;name:string}>>(Prisma.sql`
        SELECT id,name FROM "Professional" WHERE "businessId"=${scope.businessId} AND id IN (${Prisma.join(live.currentAssignments.map(a=>a.professionalId))})`)
      if(new Set(professionals.map(pro=>pro.id)).size!==new Set(live.currentAssignments.map(a=>a.professionalId)).size)return null
      const currentSchedule=live.currentAssignments.map(a=>({appointmentId:a.appointmentId,startAt:a.startAt,
        professionalId:a.professionalId,professionalName:professionals.find(pro=>pro.id===a.professionalId)!.name}))
      return {...coordinatedRuntimeReceipt(g,live.depositStatus as RuntimeHeldReceipt['depositStatus'],
        live.currentExpiresAt.toISOString(),text(owners[0]!.businessAddress,1000)?owners[0]!.businessAddress:undefined,live.cancellationReason),...(live.depositStatus==='APPROVED'?{currentSchedule}:{})}
    }catch{return null}
  }
  const rows=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    /* runtime-booking-deposit-receipt */
    SELECT customer.id AS "customerId",a.id AS "appointmentId",a.version AS "appointmentVersion",a."visitId",a."serviceId",a."professionalId",a."startAt",a."totalDurationMinutes" AS duration,a."quotedPrice",a.status AS "appointmentStatus",
      v.status AS "visitStatus",v.version AS "visitVersion",v."holdExpiresAt",v."scheduledStartAt",v."totalDurationMinutes" AS "visitDuration",v."totalPrice" AS "visitPrice",d.id AS "depositId",d.amount,d."expiresAt",d."rejectionReason",d.status AS "depositStatus",d."holdTtlMinutes",d."holdTtlProvenance",d."snapshotSealedAt",
      parent."requestHash" AS "parentHash",child."requestHash" AS "childHash",b."publicAddress" AS "businessAddress"
    FROM "BotSession" s ${scope.subject?Prisma.empty:Prisma.sql`JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"`}
    JOIN "Customer" customer ON customer."businessId"=s."businessId" AND ${scope.subject?Prisma.sql`customer.id=${instagramActor!.customerId}`:Prisma.sql`customer."normalizedPhone"=${scope.canonicalPhone}`}
    JOIN "Business" b ON b.id=s."businessId"
    JOIN "BookingVisit" v ON v."businessId"=s."businessId" AND v."sessionId"=s.id AND v."customerId"=customer.id
    JOIN "Appointment" a ON a."businessId"=v."businessId" AND a."visitId"=v.id AND a."customerId"=customer.id AND a."professionalId"=v."professionalId"
    JOIN "BookingDeposit" d ON d."businessId"=v."businessId" AND d."visitId"=v.id AND d."appointmentId"=a.id AND ${scope.subject?Prisma.sql`d."conversationId" IS NULL AND d.source='INSTAGRAM'`:Prisma.sql`d."conversationId"=c.id AND d.source='WHATSAPP'`}
    JOIN "BotOperation" parent ON parent."operationKey"=${r.operationKey} AND parent."businessId"=s."businessId" AND parent."sessionId"=s.id AND parent.status='COMPLETED' AND parent.type='HOLD_VISIT_WITH_DEPOSIT' AND parent."resultRef"=a."coordinationGroupId"
    JOIN "BotOperation" child ON child."operationKey"=${childKey(r.operationKey,0)+':HOLD_VISIT_WITH_DEPOSIT'} AND child."businessId"=s."businessId" AND child."sessionId"=s.id AND child.status='COMPLETED' AND child.type='HOLD_VISIT_WITH_DEPOSIT' AND child."resultRef"=v.id
    WHERE s.id=${scope.sessionId} AND s."businessId"=${scope.businessId} AND s.revision=${scope.expectedRevision} AND s.status='ACTIVE'
      AND ${scope.subject?Prisma.sql`true`:Prisma.sql`regexp_replace(c.phone,'[^0-9]','','g')=${scope.canonicalPhone}`} AND d.id=${r.depositId}
      AND a.id=${r.appointments[0]!.appointmentId} AND v.id=${r.appointments[0]!.visitId} AND a."coordinationGroupId"=${r.coordinationGroupId}
    FOR SHARE OF s,customer,v,a,d,parent,child ${scope.subject?Prisma.empty:Prisma.sql`,c`}
  `)
  if(rows.length!==1)return null
  const row=rows[0]!,segment=p.terms.segments[0]!,financial=p.terms.deposit.financial
  const status=String(row.depositStatus)
  // A proof is not payment authority. Before approval the immutable seal is
  // the only assignment we may trust; paid amendments are projected only once
  // the durable deposit status is APPROVED.
  let assignment: {startAt:string;professionalId:string}={startAt:segment.startAt,professionalId:segment.professionalId}
  if(status==='APPROVED') {
    try {
      const verified=await amendedPaidAssignments(tx,scope.businessId,{groupId:r.coordinationGroupId,proposal:p,
        customerId:String(row.customerId),...runtimeChannelIdentityRecord(scope),
        members:[{appointmentId:r.appointments[0]!.appointmentId,visitId:r.appointments[0]!.visitId,depositId:r.depositId}]})
      const amended=verified.get(r.appointments[0]!.appointmentId)
      if(!amended)return null
      assignment=amended
    } catch {return null}
  }
  const original:RuntimeBookingOrigin={kind:'RUNTIME',...p.scope,revision:BigInt(p.scope.revision),...runtimeChannelIdentityRecord(scope),operationKey:'read',newBookingAllowed:false}
  const date=(v:unknown)=>{try{return (v instanceof Date?v:new Date(String(v))).toISOString()}catch{return null}}
  if(row.parentHash!==runtimeBookingRequestHash(original,p)||row.childHash!==runtimeBookingChildRequestHash(runtimeBookingChildInput(p,r.operationKey,0,false),true)||
    row.serviceId!==segment.serviceId||row.professionalId!==assignment.professionalId||date(row.startAt)!==assignment.startAt||date(row.scheduledStartAt)!==assignment.startAt||row.duration!==segment.durationMinutes||row.visitDuration!==segment.durationMinutes||
    row.quotedPrice!==(segment.priceMode==='FIXED'?segment.priceMinor:null)||row.visitPrice!==(segment.priceMode==='FIXED'?segment.priceMinor:null)||row.amount!==financial.amount||row.holdTtlMinutes!==financial.ttlMinutes||row.holdTtlProvenance!==financial.ttlProvenance||!row.snapshotSealedAt||date(row.expiresAt)!==r.expiresAt)return null
  const pairs:Record<string,readonly string[]>={PENDING_PROOF:['HELD','PENDING'],PENDING_RESUBMISSION:['HELD','PENDING'],PROOF_RECEIVED:['PENDING_PAYMENT_REVIEW','PENDING'],APPROVED:['CONFIRMED','CONFIRMED'],REJECTED:['CANCELLED','CANCELLED'],EXPIRED:['EXPIRED','CANCELLED']}
  const pair=pairs[status]
  if(!pair||row.visitStatus!==pair[0]||row.appointmentStatus!==pair[1])return null
  const lines=await tx.$queryRaw<BookingDepositTerms['lines']>(Prisma.sql`SELECT "serviceId","sortOrder","serviceName",mode,"configuredValue","baseAmount",amount FROM "BookingDepositLine" WHERE "businessId"=${scope.businessId} AND "depositId"=${r.depositId} ORDER BY "sortOrder"`)
  const items=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`SELECT "serviceId","sortOrder","durationMinutes",price FROM "AppointmentServiceItem" WHERE "appointmentId"=${r.appointments[0]!.appointmentId} ORDER BY "sortOrder"`)
  if(!isDeepStrictEqual(lines,financial.lines)||!isDeepStrictEqual(items,[{serviceId:segment.serviceId,sortOrder:0,durationMinutes:segment.durationMinutes,price:segment.priceMinor}]))return null
  let cancellationReason:RuntimeHeldReceipt['cancellationReason']
  if(status==='REJECTED' && ['CANCELLED_BY_CUSTOMER','CANCELLED_BY_STAFF'].includes(String(row.rejectionReason))) {
    try { cancellationReason=await verifyPendingCancellation(tx,scope.businessId,
      {groupId:r.coordinationGroupId,operationKey:r.operationKey,proposal:p},rows) } catch { return null }
  }
  // Persisted hints never survive a durable refresh without cancellation authority.
  const {cancellationReason:discardedReason,...receipt}=r
  let currentSchedule:RuntimeHeldReceipt['currentSchedule']
  if(status==='APPROVED') {
    const pros=await tx.$queryRaw<Array<{name:string}>>(Prisma.sql`SELECT name FROM "Professional" WHERE id=${assignment.professionalId} AND "businessId"=${scope.businessId}`)
    if(pros.length!==1 || !text(pros[0]!.name))return null
    currentSchedule=[{appointmentId:r.appointments[0]!.appointmentId,...assignment,professionalName:pros[0]!.name}]
  }
  return {...receipt,...(currentSchedule?{currentSchedule}:{}),depositStatus:status as RuntimeHeldReceipt['depositStatus'],...(cancellationReason?{cancellationReason}:{}),...(text(row.businessAddress,1000)?{businessAddress:row.businessAddress}:{})}
}
async function replayRuntimeDeposit(tx:Prisma.TransactionClient,input:RuntimeBookingInput,key:string,requestHash:string,customerId:string|null):Promise<RuntimeHeldReceipt|null> {
  const ops=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`SELECT * FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE`)
  if(!ops.length)return null
  const parent=ops[0]!
  if(ops.length!==1||parent.businessId!==input.origin.businessId||parent.sessionId!==input.origin.sessionId||parent.type!=='HOLD_VISIT_WITH_DEPOSIT'||parent.status!=='COMPLETED'||parent.requestHash!==requestHash||!parent.resultRef||!customerId)throw new Error('runtime deposit replay scope mismatch')
  const rows=await tx.$queryRaw<Array<{appointmentId:string;visitId:string;depositId:string;amount:number;expiresAt:Date}>>(Prisma.sql`SELECT a.id AS "appointmentId",a."visitId",d.id AS "depositId",d.amount,d."expiresAt" FROM "Appointment" a JOIN "BookingDeposit" d ON d."appointmentId"=a.id AND d."businessId"=a."businessId" WHERE a."businessId"=${input.origin.businessId} AND a."coordinationGroupId"=${parent.resultRef}`)
  if(rows.length!==1)throw new Error('runtime deposit replay membership mismatch')
  const row=rows[0]!,p=input.presented
  const receipt:RuntimeHeldReceipt={kind:'HELD',coordinationGroupId:parent.resultRef,operationKey:key,proposalNonce:p.nonce,fingerprint:p.fingerprint,appointments:[{segmentIndex:0,appointmentId:row.appointmentId,visitId:row.visitId}],depositId:row.depositId,expiresAt:new Date(row.expiresAt).toISOString(),amount:row.amount,depositStatus:'PENDING_PROOF'}
  const actual=await loadRuntimeDepositReceipt(tx,{businessId:input.origin.businessId,sessionId:input.origin.sessionId,...runtimeChannelIdentityRecord(input.origin),expectedRevision:input.origin.revision},{presented:p,receipt})
  if(!actual)throw new Error('runtime deposit replay receipt mismatch')
  return actual
}


/** The durable seal is a pointer, not a second copy of financial authority. */
function coordinatedRuntimeReceipt(group:CoordinatedDepositGroup,status:RuntimeHeldReceipt['depositStatus'],
  expiresAt:string,businessAddress?:string,cancellationReason?:RuntimeHeldReceipt['cancellationReason']):RuntimeHeldReceipt {
  return {kind:'HELD',coordinationGroupId:group.groupId,operationKey:group.operationKey,
    proposalNonce:group.proposal.nonce,fingerprint:group.proposal.fingerprint,
    appointments:group.members.map(({segmentIndex,appointmentId,visitId})=>({segmentIndex,appointmentId,visitId})),
    depositId:group.anchorDepositId,amount:group.amount,expiresAt,depositStatus:status,
    ...(cancellationReason?{cancellationReason}:{}),
    coordinatedDepositGroup:{version:1,groupId:group.groupId,requestHash:group.requestHash},
    ...(businessAddress?{businessAddress}:{})}
}
async function replayCoordinatedRuntimeDeposit(tx:Prisma.TransactionClient,input:RuntimeBookingInput,key:string,customerId:string|null):Promise<RuntimeHeldReceipt|null> {
  const ops=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`SELECT * FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE`)
  if(!ops.length)return null
  const parent=ops[0]!,o=input.origin
  if(ops.length!==1||parent.businessId!==o.businessId||parent.sessionId!==o.sessionId||
    parent.type!=='HOLD_COORDINATED_DEPOSIT_GROUP'||parent.status!=='COMPLETED'||
    parent.requestHash!==coordinatedDepositRequestHash(o,input.presented)||!parent.resultRef||!customerId)throw new Error('runtime coordinated deposit replay scope mismatch')
  let group:CoordinatedDepositGroup
  try{group=JSON.parse(parent.resultRef) as CoordinatedDepositGroup}catch{throw new Error('runtime coordinated deposit replay manifest mismatch')}
  if(group.customerId!==customerId)throw new Error('runtime coordinated deposit replay customer mismatch')
  const receipt=coordinatedRuntimeReceipt(group,'PENDING_PROOF',group.expiresAt)
  const actual=await loadRuntimeDepositReceipt(tx,{businessId:o.businessId,sessionId:o.sessionId,
    ...runtimeChannelIdentityRecord(o),expectedRevision:o.revision},{presented:input.presented,receipt})
  if(!actual)throw new Error('runtime coordinated deposit replay membership mismatch')
  return actual
}
