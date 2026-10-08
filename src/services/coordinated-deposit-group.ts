import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { validateCustomerName } from '../bot-options/domain/customer-name-validation.js'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from './agenda-locks.js'
import { calculateBookingDepositTerms, hasCompleteDepositPaymentConfiguration, type BookingDepositTerms } from './deposit-operations.js'
import { canonicalJsonHash } from '../conversational-bot/canonical-json.js'
import type { RuntimeBookingInput, RuntimeBookingOrigin, RuntimePresentedBooking, RuntimeBookingSegment } from '../conversational-bot/prisma-conversational-booking.js'

export type CoordinatedDepositInput = { origin: RuntimeBookingOrigin; proposal: RuntimePresentedBooking; currentDraft: unknown; consent: RuntimeBookingInput['consent'] }
export type CoordinatedDepositMember = { segmentIndex: number; appointmentId: string; visitId: string; depositId: string | null; amount: number; childOperationKey: string; childRequestHash: string }
export type CoordinatedDepositGroup = { version: 1; groupId: string; operationKey: string; requestHash: string; customerId: string; canonicalPhone: string; proposal: RuntimePresentedBooking; expiresAt: string; amount: number; anchorDepositId: string; members: CoordinatedDepositMember[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v)
const iso = (v: unknown) => { try { return (v instanceof Date ? v : new Date(String(v))).toISOString() } catch { return null } }
function fail(): never { throw new Error('coordinated deposit group scope, terms or membership mismatch') }
export const coordinatedDepositOperationKey = (o: RuntimeBookingOrigin, p: RuntimePresentedBooking) => 'conversation-booking:' + o.operationKey + ':' + p.nonce
export const coordinatedDepositRequestHash = (o: RuntimeBookingOrigin, p: RuntimePresentedBooking) => canonicalJsonHash({ proposal: p, origin: { ...p.scope, canonicalPhone: o.canonicalPhone } })
export function coordinatedServiceConfigurationHash(service: Record<string, unknown>): string {
  return canonicalJsonHash(['attentionMode','price','priceMode','estimateAllowsBooking','estimateQuestion','estimateOptions','estimateExplanation','estimateDisclaimer',
    'requiresPhoto','validationEnabled','validationMessage','validationQuestion','customerDurationMin','customerDurationMax','depositMode','depositValue'].map(key => service[key] ?? null))
}
function validCoordinatedSegment(s:unknown):s is RuntimeBookingSegment {
  if (!object(s)) return false
  return [s.serviceId,s.serviceName,s.professionalId,s.professionalName].every(v=>text(v)) &&
    typeof s.startAt==='string' && typeof s.endAt==='string' && iso(s.startAt)===s.startAt && iso(s.endAt)===s.endAt &&
    typeof s.durationMinutes==='number' && Number.isSafeInteger(s.durationMinutes) && s.durationMinutes>0 &&
    typeof s.customerDurationMinutes==='number' && Number.isSafeInteger(s.customerDurationMinutes) &&
    s.customerDurationMinutes>=s.durationMinutes && s.customerDurationMinutes<=720 &&
    Date.parse(s.endAt)-Date.parse(s.startAt)===s.customerDurationMinutes*60000 &&
    typeof s.priceMode==='string' && ['FIXED','STARTING_AT'].includes(s.priceMode) &&
    (s.priceMinor===null || typeof s.priceMinor==='number' && Number.isSafeInteger(s.priceMinor) && s.priceMinor>=0) &&
    typeof s.configurationHash==='string' && /^[a-f0-9]{64}$/.test(s.configurationHash)
}

/** Bounded server proof; it is not sufficient authority without locked session/catalog revalidation. */
export function assertCoordinatedDepositInput(input: CoordinatedDepositInput): void {
  const p = input.proposal, o = input.origin, t = p?.terms
  if (o.kind !== 'RUNTIME' || !p || p.version !== 1 || p.conditionsPresented !== true || !object(t) || t.version !== 1 ||
      !text(t.businessId) || !validateCustomerName(t.customerName).ok || !text(t.timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
      !t.deposit || !Array.isArray(t.segments) || t.segments.length < 2 || t.segments.length > 8 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.nonce) ||
      p.fingerprint !== canonicalJsonHash(t) || JSON.stringify(p).length > 16000 ||
      input.consent.confirmed !== true || input.consent.nonce !== p.nonce || input.consent.fingerprint !== p.fingerprint ||
      !p.scope || ![o.businessId,o.sessionId,o.deploymentId,o.configurationId].every(v=>text(v)) ||
      !Number.isSafeInteger(o.generation) || o.generation<1 || ![o.dispatchFenceEpoch,o.handoffFenceEpoch].every(v=>Number.isSafeInteger(v)&&v>=0) ||
      !/^\d+$/.test(String(o.revision)) || !/^\d{10,15}$/.test(o.canonicalPhone) || !text(o.operationKey, 256) || t.businessId !== o.businessId ||
      !isDeepStrictEqual(p.scope, { businessId: o.businessId, sessionId: o.sessionId, deploymentId: o.deploymentId, generation: o.generation,
        revision: String(o.revision), configurationId: o.configurationId, dispatchFenceEpoch: o.dispatchFenceEpoch, handoffFenceEpoch: o.handoffFenceEpoch })) fail()
  if (!object(t.preference) || !(t.preference.kind==='any' || t.preference.kind==='specific' && text(t.preference.id))) fail()
  const ids = new Set<string>()
  let previousEnd: string | null = null
  for (const candidate of t.segments) {
    if (!validCoordinatedSegment(candidate)) fail()
    const s:RuntimeBookingSegment=candidate
    if (ids.has(s.serviceId) || previousEnd!==null && previousEnd!==s.startAt) fail()
    ids.add(s.serviceId); previousEnd=s.endAt
  }
  const total = t.segments.every(s => s.priceMode === 'FIXED' && s.priceMinor !== null) ? t.segments.reduce((n,s) => n + s.priceMinor!, 0) : null
  if (total!==null && !Number.isSafeInteger(total) || t.totalPriceMinor !== total || !object(input.currentDraft) || !object(input.currentDraft.bookingReservation) ||
      !isDeepStrictEqual(input.currentDraft.bookingReservation.presented, p) || input.currentDraft.businessId !== t.businessId ||
      input.currentDraft.customerName !== t.customerName || input.currentDraft.date !== t.date || input.currentDraft.pending !== 'proposal' ||
      !isDeepStrictEqual(input.currentDraft.professional,t.preference) || !object(input.currentDraft.basket) || !Array.isArray(input.currentDraft.basket.members) ||
      !isDeepStrictEqual(input.currentDraft.basket.members.map(m => object(m) && m.mode === 'single' && Array.isArray(m.serviceIds) && m.serviceIds.length === 1 ? m.serviceIds[0] : null), [...ids]) ||
      !object(input.currentDraft.slot) || input.currentDraft.slot.startAt !== t.segments[0]!.startAt ||
      input.currentDraft.referral || input.currentDraft.serviceRequest || input.currentDraft.editRequest || input.currentDraft.professionalReference) fail()
}
/** Reuse the business -> sorted professional hierarchy; no provider calls in this transaction. */
export async function lockCoordinatedDepositOrigin(tx: Prisma.TransactionClient, input: CoordinatedDepositInput): Promise<string> {
  assertCoordinatedDepositInput(input)
  const o = input.origin, p = input.proposal
  await acquireAgendaHierarchy(tx, { businessId: o.businessId, professionalIds: p.terms.segments.map(s => s.professionalId) })
  const rows = await tx.$queryRaw<Array<{ customerId: string; state: unknown }>>(Prisma.sql`
    SELECT customer.id AS "customerId", s.state
    FROM "BotSession" s JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
    JOIN "Customer" customer ON customer."businessId"=s."businessId" AND customer."normalizedPhone"=${o.canonicalPhone}
    JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=s."businessId"
    JOIN "Business" b ON b.id=s."businessId"
    WHERE s.id=${o.sessionId} AND s."businessId"=${o.businessId} AND s.revision=${o.revision} AND s.status='ACTIVE'
      AND s."handoffClaimsPausedAt" IS NULL AND s."handoffFenceEpoch"=${o.handoffFenceEpoch}
      AND s."deploymentId"=${o.deploymentId} AND s."deploymentGeneration"=${o.generation}
      AND d.generation=${o.generation} AND d."dispatchFenceEpoch"=${o.dispatchFenceEpoch} AND d."claimsPausedAt" IS NULL
      AND d.channel='WHATSAPP' AND d."activeConfigurationId"=${o.configurationId} AND cfg.status='ACTIVE'
      AND d."legacyDispatchCoverageVersion">=1 AND b."botEnabled"=true
      AND regexp_replace(c.phone,'[^0-9]','','g')=${o.canonicalPhone}
    FOR UPDATE OF s,c,customer FOR SHARE OF d,cfg,b
  `)
  const row = rows[0]
  if (rows.length !== 1 || !row || !object(row.state) || !['NONE','DRAFT'].includes(String(row.state.booking)) ||
      row.state.deposit !== 'NONE' || row.state.handoff !== 'NONE' || !object(row.state.conversationDraft) ||
      !isDeepStrictEqual(row.state.conversationDraft.dialogue, input.currentDraft)) fail()
  return row.customerId
}
/** Financial snapshot is uncached and tenant-scoped, with exactly the existing F8 rules. */
export async function revalidateCoordinatedDepositFinancial(tx: Prisma.TransactionClient, p: RuntimePresentedBooking,
  services: readonly Record<string,unknown>[]): Promise<{ financial: BookingDepositTerms; dbNow: Date }> {
  const settings = await tx.$queryRaw<Array<{ depositHoldMinutes: number | null; dbNow: Date; timezone: string }>>(Prisma.sql`
    SELECT "depositHoldMinutes", timezone, clock_timestamp() AS "dbNow" FROM "BusinessBotOptionsSettings" WHERE "businessId"=${p.scope.businessId} FOR SHARE`)
  const payments = await tx.$queryRaw<Array<NonNullable<RuntimePresentedBooking['terms']['deposit']>['payment']>>(Prisma.sql`
    SELECT "transferEnabled",alias,cbu,cvu,"paymentLinkEnabled","paymentLink" FROM "BusinessPaymentSettings" WHERE "businessId"=${p.scope.businessId} FOR SHARE`)
  if (settings.length !== 1 || settings[0]!.timezone !== p.terms.timezone || payments.length !== 1 || !hasCompleteDepositPaymentConfiguration(payments[0]!) ||
      !isDeepStrictEqual(payments[0],p.terms.deposit!.payment)) fail()
  const payment = payments[0]!
  if (typeof payment.transferEnabled!=='boolean' || typeof payment.paymentLinkEnabled!=='boolean' ||
      ![payment.alias,payment.cbu,payment.cvu,payment.paymentLink].every(v=>v===null || text(v,1000))) fail()
  if (payment.paymentLink!==null) {
    try { const url=new URL(payment.paymentLink); if(url.protocol!=='https:' || url.username || url.password) fail() } catch { fail() }
  }
  const financial = calculateBookingDepositTerms({ services: services.map((s,i) => ({ id: String(s.id), name: String(s.name),
    price: p.terms.segments[i]!.priceMinor, priceMode: p.terms.segments[i]!.priceMode, depositMode: s.depositMode as 'NONE'|'FIXED'|'PERCENTAGE', depositValue: s.depositValue as number|null })),
    businessDepositHoldMinutes: settings[0]!.depositHoldMinutes })
  if (financial.ttlMinutes > 43200 || !isDeepStrictEqual(financial,p.terms.deposit!.financial)) fail()
  return { financial, dbNow: new Date(settings[0]!.dbNow) }
}
/** Same stable F7/F8 child payload/order as the primitive, plus its bounded private group proof. */
function expectedChildHash(group:CoordinatedDepositGroup,index:number,depositRequired:boolean):string {
  const s=group.proposal.terms.segments[index]!
  const payload={services:[{serviceId:s.serviceId,name:s.serviceName,durationMinutes:s.durationMinutes,priceMinor:s.priceMinor,priceMode:s.priceMode,...(s.estimate?{estimate:s.estimate}:{})}],
    professional:{professionalId:s.professionalId,name:s.professionalName,assignedByBalancer:false},date:group.proposal.terms.date,slotStartAt:s.startAt,
    totalDurationMinutes:s.durationMinutes,totalPriceMinor:s.priceMode==='FIXED'?s.priceMinor:null,...(depositRequired?{depositRequired:true}:{}),
    groupHold:{groupId:group.groupId,expiresAt:group.expiresAt,proposalFingerprint:group.proposal.fingerprint}}
  return createHash('sha256').update(JSON.stringify(payload),'utf8').digest('hex')
}

/** Verify the sealed manifest and EVERY group member before lifecycle/replay can trust it. */
export async function lockCoordinatedDepositGroup(tx: Prisma.TransactionClient, target: { businessId: string; groupId: string }): Promise<CoordinatedDepositGroup> {
  if (!text(target.businessId) || !/^[a-f0-9-]{36}$/.test(target.groupId)) fail()
  await acquireAgendaHierarchy(tx,{businessId:target.businessId,professionalIds:[]})
  const ops = await tx.$queryRaw<Array<{ operationKey: string; requestHash: string; resultRef: string; status: string }>>(Prisma.sql`
    SELECT "operationKey","requestHash","resultRef",status FROM "BotOperation"
    WHERE "businessId"=${target.businessId} AND type='HOLD_COORDINATED_DEPOSIT_GROUP'
      AND "resultRef" LIKE ${'%"groupId":"'+target.groupId+'"%'} FOR UPDATE`)
  if (ops.length !== 1 || ops[0]!.status !== 'COMPLETED') fail()
  let group: CoordinatedDepositGroup
  try { group = JSON.parse(ops[0]!.resultRef) as CoordinatedDepositGroup } catch { return fail() }
  const p = group.proposal
  if (group.version !== 1 || group.groupId !== target.groupId || group.operationKey !== ops[0]!.operationKey ||
      group.requestHash !== canonicalJsonHash({proposal:p,origin:{...p?.scope,canonicalPhone:group.canonicalPhone}}) || group.requestHash !== ops[0]!.requestHash || p?.scope.businessId !== target.businessId || p.fingerprint !== canonicalJsonHash(p.terms) ||
      group.amount !== p.terms.deposit?.financial.amount || iso(group.expiresAt) !== group.expiresAt ||
      JSON.stringify(group).length>24000 || !text(group.customerId) || !/^\d{10,15}$/.test(group.canonicalPhone) || !Array.isArray(group.members) || group.members.length !== p.terms.segments.length || group.members.length < 2 || group.members.length > 8) fail()
  await acquireAgendaHierarchy(tx,{businessId:target.businessId,professionalIds:p.terms.segments.map(s=>s.professionalId)})
  // Intentionally do NOT filter tenant/customer within a group: injected members invalidate ALL.
  const rows = await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT a.id AS "appointmentId",a."businessId",a."customerId",a."professionalId",a."serviceId",a."startAt",a."totalDurationMinutes",a."quotedPrice",a.status AS "appointmentStatus",
      a."visitId",v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",v."professionalId" AS "visitProfessionalId",v."sessionId",v."scheduledStartAt",v."totalDurationMinutes" AS "visitDuration",v."totalPrice",v."holdExpiresAt",v.status AS "visitStatus",
      d.id AS "depositId",d."businessId" AS "depositBusinessId",d."visitId" AS "depositVisitId",d."conversationId",d.source,d.amount,d.status AS "depositStatus",d."expiresAt",d."holdTtlMinutes",d."holdTtlProvenance",d."snapshotSealedAt"
    FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
    WHERE a."coordinationGroupId"=${target.groupId} ORDER BY a.id FOR UPDATE OF a,v`)
  if (rows.length !== group.members.length) fail()
  const customer = await tx.$queryRaw<Array<{ conversationId: string }>>(Prisma.sql`
    SELECT c.id AS "conversationId" FROM "BotSession" s JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
    JOIN "Customer" customer ON customer.id=${group.customerId} AND customer."businessId"=s."businessId" AND customer."normalizedPhone"=${group.canonicalPhone}
    WHERE s.id=${p.scope.sessionId} AND s."businessId"=${target.businessId} AND regexp_replace(c.phone,'[^0-9]','','g')=${group.canonicalPhone} FOR SHARE OF s,c,customer`)
  if (customer.length !== 1) fail()
  const financialIds=group.members.flatMap(m=>m.depositId?[m.depositId]:[])
  if (financialIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "BookingDeposit" WHERE id IN (${Prisma.join(financialIds)}) AND "businessId"=${target.businessId} ORDER BY id FOR UPDATE`)
  const ids = new Set<string>(), visits = new Set<string>(), deposits = new Set<string>()
  for (const [i, m] of group.members.entries()) {
    const segment: RuntimeBookingSegment = p.terms.segments[i]!, row = rows.find(r=>r.appointmentId===m.appointmentId)
    if (m.segmentIndex !== i || !text(m.appointmentId) || !text(m.visitId) || ids.has(m.appointmentId) || visits.has(m.visitId) ||
        !row || row.businessId !== target.businessId || row.customerId !== group.customerId || row.visitBusinessId !== target.businessId || row.visitCustomerId !== group.customerId ||
        row.sessionId !== p.scope.sessionId || row.visitId !== m.visitId || row.professionalId !== segment.professionalId || row.visitProfessionalId !== segment.professionalId ||
        row.serviceId !== segment.serviceId || iso(row.startAt) !== segment.startAt || iso(row.scheduledStartAt) !== segment.startAt ||
        row.totalDurationMinutes !== segment.durationMinutes || row.visitDuration !== segment.durationMinutes ||
        row.quotedPrice !== (segment.priceMode==='FIXED'?segment.priceMinor:null) || row.totalPrice !== (segment.priceMode==='FIXED'?segment.priceMinor:null) ||
        iso(row.holdExpiresAt) !== group.expiresAt || row.appointmentStatus !== 'PENDING' || row.visitStatus !== 'HELD') fail()
    ids.add(m.appointmentId); visits.add(m.visitId)
    const hasDeposit=p.terms.deposit!.financial.lines.some(l=>l.serviceId===segment.serviceId)
    if (m.childRequestHash!==expectedChildHash(group,i,hasDeposit) || m.childOperationKey!==group.operationKey+':segment:'+i+':'+(hasDeposit?'HOLD_VISIT_WITH_DEPOSIT':'HOLD_GROUP_COMPANION')) fail()
    const child = await tx.$queryRaw<Array<{ requestHash:string; resultRef:string; status:string; businessId:string; sessionId:string; type:string }>>(Prisma.sql`
      SELECT "requestHash","resultRef",status,"businessId","sessionId",type FROM "BotOperation" WHERE "operationKey"=${m.childOperationKey} FOR UPDATE`)
    if (child.length!==1 || child[0]!.type!==(hasDeposit?'HOLD_VISIT_WITH_DEPOSIT':'HOLD_GROUP_COMPANION') || child[0]!.status!=='COMPLETED' || child[0]!.businessId!==target.businessId || child[0]!.sessionId!==p.scope.sessionId || child[0]!.resultRef!==m.visitId || child[0]!.requestHash!==m.childRequestHash) fail()
    const items = await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`SELECT "serviceId","sortOrder","durationMinutes",price FROM "AppointmentServiceItem" WHERE "appointmentId"=${m.appointmentId} ORDER BY "sortOrder"`)
    if (!isDeepStrictEqual(items,[{serviceId:segment.serviceId,sortOrder:0,durationMinutes:segment.durationMinutes,price:segment.priceMinor}])) fail()
    const financialLine = p.terms.deposit!.financial.lines.find(l=>l.serviceId===segment.serviceId)
    if (financialLine) {
      if (!text(m.depositId) || deposits.has(m.depositId) || row.depositId!==m.depositId || row.depositBusinessId!==target.businessId || row.depositVisitId!==m.visitId ||
          row.conversationId!==customer[0]!.conversationId || row.source!=='WHATSAPP' || row.amount!==m.amount || m.amount!==financialLine.amount ||
          iso(row.expiresAt)!==group.expiresAt || row.holdTtlMinutes!==p.terms.deposit!.financial.ttlMinutes || row.holdTtlProvenance!==p.terms.deposit!.financial.ttlProvenance ||
          !row.snapshotSealedAt || row.depositStatus!=='PENDING_PROOF') fail()
      deposits.add(m.depositId)
      const lines = await tx.$queryRaw<BookingDepositTerms['lines']>(Prisma.sql`SELECT "serviceId","sortOrder","serviceName",mode,"configuredValue","baseAmount",amount FROM "BookingDepositLine" WHERE "businessId"=${target.businessId} AND "depositId"=${m.depositId} ORDER BY "sortOrder"`)
      if (!isDeepStrictEqual(lines,[{...financialLine,sortOrder:0}])) fail()
    } else if (m.depositId!==null || row.depositId!==null || m.amount!==0) fail()
  }
  if (group.anchorDepositId!==group.members.find(m=>m.depositId!==null)?.depositId || group.members.reduce((sum,m)=>sum+m.amount,0)!==group.amount || deposits.size!==p.terms.deposit!.financial.lines.length) fail()
  return group
}