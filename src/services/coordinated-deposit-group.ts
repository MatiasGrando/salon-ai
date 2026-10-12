import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { validateCustomerName } from '../bot-options/domain/customer-name-validation.js'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from './agenda-locks.js'
import { calculateBookingDepositTerms, hasCompleteDepositPaymentConfiguration, type BookingDepositTerms } from './deposit-operations.js'
import { canonicalJsonHash } from '../conversational-bot/canonical-json.js'
import { rescheduleFingerprint, type GroupRescheduleCommand } from '../conversational-bot/appointment-management.js'
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
export type CoordinatedDepositGroupState = { group: CoordinatedDepositGroup; depositStatus: string; currentExpiresAt: Date; dbNow: Date;
  currentAssignments: Array<{appointmentId:string;startAt:string;professionalId:string}>; cancellationReason?: 'CUSTOMER' | 'STAFF' }

/** Reconstruct operational assignments from the immutable F8 seal and completed,
 * append-only group amendments. Payment terms are never rewritten by a move. */
export type PaidAssignmentSeal = Pick<CoordinatedDepositGroup,'groupId'|'proposal'|'customerId'|'canonicalPhone'> & {members: Array<Pick<CoordinatedDepositMember,'appointmentId'|'visitId'|'depositId'>>}
export async function amendedPaidAssignments(tx: Pick<Prisma.TransactionClient,'$queryRaw'>, businessId: string, group: PaidAssignmentSeal) {
  const assignments = new Map(group.members.map((member, index) => [member.appointmentId, {
    startAt: group.proposal.terms.segments[index]!.startAt,
    professionalId: group.proposal.terms.segments[index]!.professionalId,
  }]))
  // Older NONE group moves wrote a completed parent/child receipt plus the
  // same immutable F9 history, without embedding the full before snapshot.
  // Only reconstruct those date-only moves from their scoped durable proofs.
  if(group.members.every(member=>member.depositId===null)) {
    const legacy=await tx.$queryRaw<Array<{operationKey:string;sessionId:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`
      SELECT "operationKey","sessionId",status,"requestHash","resultRef" FROM "BotOperation"
      WHERE "businessId"=${businessId} AND "sessionId"=${group.proposal.scope.sessionId} AND type='RESCHEDULE_APPOINTMENT_GROUP'
        AND "resultRef" LIKE '{"fingerprint":%' ORDER BY "updatedAt",id FOR UPDATE`)
    const candidates=[] as Array<{proofs:Array<{appointmentId:string;fromStartAt:Date;toStartAt:Date}>}>
    if(legacy.length>100) fail()
    for(const parent of legacy) {
      let receipt:Record<string,unknown>
      try{receipt=JSON.parse(parent.resultRef ?? '') as Record<string,unknown>}catch{continue}
      if(!object(receipt) || !Array.isArray(receipt.children) || !receipt.children.some((child:unknown)=>object(child) && assignments.has(String(child.id)))) continue
      if(parent.status!=='COMPLETED' || parent.sessionId!==group.proposal.scope.sessionId || !/^[a-f0-9]{64}$/.test(parent.requestHash) ||
        !text(receipt.nonce) || typeof receipt.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(receipt.fingerprint) ||
        receipt.children.length!==group.members.length || !Array.isArray(receipt.moves) || receipt.moves.length!==group.members.length ||
        parent.operationKey!=='reschedule-group:'+canonicalJsonHash([{businessId,customerId:group.customerId,sessionId:parent.sessionId,normalizedPhone:group.canonicalPhone},receipt.nonce,receipt.fingerprint])) fail()
      const proofs=[] as Array<{appointmentId:string;fromStartAt:Date;toStartAt:Date}>
      for(const member of group.members) {
        const children=receipt.children.filter((child:unknown)=>object(child) && child.id===member.appointmentId)
        const moves=receipt.moves.filter((move:unknown)=>object(move) && move.appointmentId===member.appointmentId)
        if(children.length!==1 || moves.length!==1) fail()
        const child=children[0] as Record<string,unknown>,move=moves[0] as Record<string,unknown>
        if(child.key!==parent.operationKey+':'+member.appointmentId || !text(move.newStartAt) || iso(move.newStartAt)!==move.newStartAt ||
          Object.keys(move).some(key=>!['appointmentId','newStartAt'].includes(key))) fail()
        const expectedHash=createHash('sha256').update(JSON.stringify({action:'RESCHEDULE_APPOINTMENT',businessId,normalizedPhone:group.canonicalPhone,
          sessionId:parent.sessionId,appointmentId:member.appointmentId,operationKey:child.key,actor:'bot-session:'+parent.sessionId,confirmed:true,newStartAt:move.newStartAt})).digest('hex')
        if(child.hash!==expectedHash) fail()
        const rows=await tx.$queryRaw<Array<{status:string;requestHash:string;resultRef:string;sessionId:string;appointmentId:string;actor:string;fromStartAt:Date;toStartAt:Date;fromProfessionalId:string|null;toProfessionalId:string|null;bookingDepositId:string|null;depositPreserved:boolean}>>(Prisma.sql`
          SELECT o.status,o."requestHash",o."resultRef",o."sessionId",h."appointmentId",h.actor,h."fromStartAt",h."toStartAt",h."fromProfessionalId",h."toProfessionalId",h."bookingDepositId",h."depositPreserved"
          FROM "BotOperation" o JOIN "AppointmentChangeHistory" h ON h."operationKey"=o."operationKey"
          WHERE o."operationKey"=${child.key as string} AND o."businessId"=${businessId} AND o.type='RESCHEDULE_APPOINTMENT' FOR UPDATE OF o,h`)
        const proof=rows[0]
        if(rows.length!==1 || !proof || proof.status!=='COMPLETED' || proof.requestHash!==expectedHash || proof.resultRef!==member.appointmentId ||
          proof.sessionId!==parent.sessionId || proof.appointmentId!==member.appointmentId || proof.actor!=='bot-session:'+parent.sessionId ||
          proof.fromProfessionalId!==null || proof.toProfessionalId!==null || proof.bookingDepositId!==null || proof.depositPreserved!==false ||
          iso(proof.toStartAt)!==move.newStartAt || !iso(proof.fromStartAt)) fail()
        proofs.push({appointmentId:member.appointmentId,fromStartAt:proof.fromStartAt,toStartAt:proof.toStartAt})
      }
      candidates.push({proofs})
    }
    while(candidates.length) {
      const ready=candidates.filter(candidate=>candidate.proofs.every(proof=>assignments.get(proof.appointmentId)?.startAt===iso(proof.fromStartAt)))
      if(ready.length!==1) fail()
      const next=ready[0]!
      for(const proof of next.proofs) assignments.get(proof.appointmentId)!.startAt=iso(proof.toStartAt)!
      candidates.splice(candidates.indexOf(next),1)
    }
  }
  const operations = await tx.$queryRaw<Array<{ operationKey: string; sessionId: string; status: string; requestHash: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "operationKey", "sessionId", status, "requestHash", "resultRef" FROM "BotOperation"
    WHERE "businessId"=${businessId} AND type='RESCHEDULE_APPOINTMENT_GROUP'
      AND "resultRef" LIKE ${'{"version":1,"groupId":"'+group.groupId+'"%'}
    ORDER BY "updatedAt", id FOR UPDATE`)
  if (operations.length > 100) fail()
  const pending=[...operations]
  while (pending.length) {
    // Operation timestamps can tie (and are deliberately frozen in fixtures).
    // The before-state chain, not insertion order, determines the next amendment.
    const ready=pending.filter(operation=>{
      try {
        const receipt=JSON.parse(operation.resultRef ?? '') as Record<string,unknown>
        const command=object(receipt) && object(receipt.command) ? receipt.command : null
        const snapshot=command && object(command.snapshot) ? command.snapshot : null
        return !!snapshot && Array.isArray(snapshot.members) && snapshot.members.length===group.members.length &&
          snapshot.members.every((member:unknown)=>object(member) && assignments.get(String(member.appointmentId))?.startAt===member.startAt &&
            assignments.get(String(member.appointmentId))?.professionalId===member.professionalId)
      } catch { return false }
    })
    if(ready.length!==1) fail()
    const operation=ready[0]!
    pending.splice(pending.indexOf(operation),1)
    if (operation.status !== 'COMPLETED' || !operation.resultRef) fail()
    let receipt: Record<string, unknown>
    try { receipt = JSON.parse(operation.resultRef) as Record<string, unknown> } catch { return fail() }
    if (!object(receipt) || receipt.version !== 1 || receipt.groupId !== group.groupId || !object(receipt.command) || !Array.isArray(receipt.children) ||
      receipt.children.length<1 || receipt.children.length>group.members.length || operation.requestHash !== canonicalJsonHash(receipt.command)) fail()
    const command = receipt.command as GroupRescheduleCommand
    try { if (command.kind!=='RESCHEDULE_APPOINTMENT_GROUP' || command.confirmed!==true || command.fingerprint!==rescheduleFingerprint(command.snapshot,command.moves,command.source)) fail() }
    catch { fail() }
    if (command.nonce!==receipt.nonce || command.fingerprint!==receipt.fingerprint) fail()
    const snapshot = command.snapshot as unknown as Record<string,unknown>
    if (snapshot.groupId !== group.groupId || !object(snapshot.scope) || snapshot.scope.businessId !== businessId ||
      snapshot.scope.sessionId !== operation.sessionId || (command.source!=='own_lookup' && operation.sessionId!==group.proposal.scope.sessionId) ||
      snapshot.scope.customerId!==group.customerId ||
      snapshot.scope.normalizedPhone!==group.canonicalPhone ||
      operation.operationKey!=='reschedule-group:'+canonicalJsonHash([snapshot.scope,command.nonce,command.fingerprint]) ||
      !Array.isArray(snapshot.members) || snapshot.members.length !== group.members.length ||
      !Array.isArray(command.moves) || command.moves.length !== group.members.length) fail()
    if (command.source==='own_lookup') {
      const owner=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        SELECT s.id FROM "BotSession" s
        JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
        JOIN "Customer" customer ON customer.id=${group.customerId} AND customer."businessId"=s."businessId"
          AND customer."normalizedPhone"=${group.canonicalPhone}
        WHERE s.id=${operation.sessionId} AND s."businessId"=${businessId}
          AND regexp_replace(c.phone,'[^0-9]','','g')=${group.canonicalPhone}
        FOR SHARE OF s,c,customer`)
      if(owner.length!==1) fail()
    }
    for (const [index,member] of group.members.entries()) {
      const before = snapshot.members.filter((candidate:unknown)=>object(candidate) && candidate.appointmentId === member.appointmentId)
      const move = command.moves.filter((candidate:unknown)=>object(candidate) && candidate.appointmentId === member.appointmentId)
      const children = receipt.children.filter((candidate:unknown)=>object(candidate) && candidate.appointmentId === member.appointmentId)
      if (before.length!==1 || move.length!==1 || children.length>1) fail()
      const previous=assignments.get(member.appointmentId)!, old=before[0] as Record<string,unknown>, next=move[0] as Record<string,unknown>
      const newProfessionalId=next.newProfessionalId ?? previous.professionalId
      const segment=group.proposal.terms.segments[index]!
      if (old.startAt!==previous.startAt || old.professionalId!==previous.professionalId || old.visitId!==member.visitId ||
        old.depositId!==member.depositId || old.depositStatus!==(member.depositId===null?null:'APPROVED') ||
        old.status!=='CONFIRMED' || old.visitStatus!=='CONFIRMED' || old.durationMinutes!==segment.durationMinutes ||
        !isDeepStrictEqual(old.serviceIds,[segment.serviceId]) || old.quotedPrice!==(segment.priceMode==='FIXED'?segment.priceMinor:null) ||
        old.manualDepositPaid!==false || old.manualDepositAmount!==null ||
        !text(next.newStartAt) || iso(next.newStartAt)!==next.newStartAt || !text(newProfessionalId)) fail()
      if(next.newStartAt===previous.startAt && newProfessionalId===previous.professionalId) {
        if(children.length!==0) fail()
        continue
      }
      if(children.length!==1) fail()
      const child=children[0] as Record<string,unknown>
      if (child.operationKey!==operation.operationKey+':'+member.appointmentId ||
        child.appointmentId!==member.appointmentId || child.fromStartAt!==previous.startAt || child.toStartAt!==next.newStartAt ||
        child.fromProfessionalId!==previous.professionalId || child.toProfessionalId!==newProfessionalId || child.depositId!==member.depositId ||
        child.requestHash!==canonicalJsonHash({groupOperationKey:operation.operationKey,appointmentId:member.appointmentId,
          fromStartAt:previous.startAt,toStartAt:next.newStartAt,fromProfessionalId:previous.professionalId,toProfessionalId:newProfessionalId,depositId:member.depositId})) fail()
      const proof=await tx.$queryRaw<Array<{status:string;requestHash:string;resultRef:string;sessionId:string;appointmentId:string;actor:string;fromStartAt:Date;toStartAt:Date;fromProfessionalId:string|null;toProfessionalId:string|null;bookingDepositId:string|null;depositPreserved:boolean}>>(Prisma.sql`
        SELECT o.status,o."requestHash",o."resultRef",o."sessionId",h."appointmentId",h.actor,h."fromStartAt",h."toStartAt",h."fromProfessionalId",h."toProfessionalId",h."bookingDepositId",h."depositPreserved"
        FROM "BotOperation" o JOIN "AppointmentChangeHistory" h ON h."operationKey"=o."operationKey"
        WHERE o."operationKey"=${child.operationKey as string} AND o."businessId"=${businessId} AND o.type='RESCHEDULE_APPOINTMENT'
        FOR UPDATE OF o,h`)
      if (proof.length!==1 || proof[0]!.status!=='COMPLETED' || proof[0]!.sessionId!==operation.sessionId ||
        proof[0]!.requestHash!==child.requestHash || proof[0]!.resultRef!==member.appointmentId || proof[0]!.appointmentId!==member.appointmentId ||
        proof[0]!.actor!=='bot-session:'+operation.sessionId || iso(proof[0]!.fromStartAt)!==previous.startAt ||
        iso(proof[0]!.toStartAt)!==next.newStartAt || proof[0]!.fromProfessionalId!==previous.professionalId ||
        proof[0]!.toProfessionalId!==newProfessionalId || proof[0]!.bookingDepositId!==member.depositId ||
        proof[0]!.depositPreserved!==(member.depositId!==null)) fail()
      assignments.set(member.appointmentId,{startAt:next.newStartAt as string,professionalId:newProfessionalId as string})
    }
  }
  return assignments
}

/** Durable manifest authority wins over mutable appointment routing fields, even after tampering/deletion. */
export async function lockCoordinatedDepositGroupForDeposit(tx: Prisma.TransactionClient, target: {businessId:string;depositId:string}): Promise<CoordinatedDepositGroupState|null> {
  return lockCoordinatedDepositGroupForMember(tx,target.businessId,'depositId',target.depositId)
}
export async function lockCoordinatedDepositGroupForAppointment(tx: Prisma.TransactionClient, target: {businessId:string;appointmentId:string}): Promise<CoordinatedDepositGroupState|null> {
  return lockCoordinatedDepositGroupForMember(tx,target.businessId,'appointmentId',target.appointmentId)
}
async function lockCoordinatedDepositGroupForMember(tx:Prisma.TransactionClient,businessId:string,key:'depositId'|'appointmentId',id:string):Promise<CoordinatedDepositGroupState|null> {
  if(!text(businessId) || !text(id)) fail()
  // JSON membership is exact, parameterized and tenant scoped, not substring matching.
  // CASE protects unrelated legacy resultRef strings from being interpreted as JSON.
  const seals=await tx.$queryRaw<Array<{groupId:string}>>(Prisma.sql`
    SELECT (CASE WHEN type='HOLD_COORDINATED_DEPOSIT_GROUP' THEN "resultRef"::jsonb ELSE NULL END)->>'groupId' AS "groupId"
    FROM "BotOperation" WHERE "businessId"=${businessId} AND type='HOLD_COORDINATED_DEPOSIT_GROUP'
      AND (CASE WHEN type='HOLD_COORDINATED_DEPOSIT_GROUP' THEN "resultRef"::jsonb ELSE NULL END)->'members'
        @> jsonb_build_array(jsonb_build_object(${key}::text,${id}::text))`)
  if(seals.length>1) fail()
  if(seals[0]) {
    const state=await lockCoordinatedDepositGroupState(tx,{businessId,groupId:seals[0].groupId})
    if(!state.group.members.some(member=>member[key]===id)) fail()
    return state
  }
  const rows=key==='depositId'
    ? await tx.$queryRaw<Array<{groupId:string|null;origin:string;professionalId:string}>>(Prisma.sql`SELECT a."coordinationGroupId" AS "groupId",a.origin,a."professionalId" FROM "BookingDeposit" d JOIN "Appointment" a ON a.id=d."appointmentId" AND a."businessId"=d."businessId" WHERE d.id=${id} AND d."businessId"=${businessId}`)
    : await tx.$queryRaw<Array<{groupId:string|null;origin:string;professionalId:string}>>(Prisma.sql`SELECT "coordinationGroupId" AS "groupId",origin,"professionalId" FROM "Appointment" WHERE id=${id} AND "businessId"=${businessId}`)
  if(rows.some(row=>row.origin==='BOT' && row.groupId)) {
    if(rows.length!==1) fail()
    await assertRuntimeSingularDeposit(tx,{businessId,key,id,groupId:rows[0]!.groupId!,professionalId:rows[0]!.professionalId})
  }
  return null // Validated runtime singular and unrelated single/legacy aggregates use their own lifecycle.
}

/** Runtime singular holds use a coordination UUID too, but NOT a coordinated
 * manifest. Verify their durable parent/child lineage without relying on a
 * conversation sidecar that may disappear after payment or a later conversation.
 * The parent stores no proposal: hashes are checked for format, not falsely
 * described as recomputed here. The singular lifecycle retains snapshot/state guards.
 */
async function assertRuntimeSingularDeposit(tx:Prisma.TransactionClient,target:{businessId:string;key:'depositId'|'appointmentId';id:string;groupId:string;professionalId:string}) {
  const {businessId,groupId}=target
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(groupId) || !text(target.professionalId)) fail()
  await acquireAgendaHierarchy(tx,{businessId,professionalIds:[target.professionalId]})
  // No tenant/member filters: a second or foreign member invalidates singular authority.
  const members=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT a.id AS "appointmentId",a.origin,a."businessId",a."customerId",a."professionalId",a."visitId",
      v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",v."professionalId" AS "visitProfessionalId",v."sessionId",
      d.id AS "depositId",d."businessId" AS "depositBusinessId",d."visitId" AS "depositVisitId",d."conversationId",d.source
    FROM "Appointment" a LEFT JOIN "BookingVisit" v ON v.id=a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
    WHERE a."coordinationGroupId"=${groupId} ORDER BY a.id`)
  if(members.length!==1) fail()
  const member=members[0]!
  if(member.origin!=='BOT' || member.businessId!==businessId || member.visitBusinessId!==businessId || member.depositBusinessId!==businessId ||
      ![member.appointmentId,member.visitId,member.depositId,member.customerId,member.sessionId,member.conversationId].every(v=>text(v)) ||
      member.customerId!==member.visitCustomerId || member.professionalId!==target.professionalId || member.visitProfessionalId!==target.professionalId ||
      member.depositVisitId!==member.visitId || member.source!=='WHATSAPP' || member[target.key]!==target.id) fail()
  const owners=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
    SELECT s.id FROM "BotSession" s JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
    JOIN "Customer" customer ON customer.id=${member.customerId} AND customer."businessId"=s."businessId"
    JOIN "Professional" p ON p.id=${target.professionalId} AND p."businessId"=s."businessId"
    WHERE s.id=${member.sessionId} AND s."businessId"=${businessId} AND c.id=${member.conversationId}
      AND customer."normalizedPhone"=regexp_replace(c.phone,'[^0-9]','','g') FOR SHARE OF s,c,customer,p`)
  if(owners.length!==1) fail()
  const parents=await tx.$queryRaw<Array<{operationKey:string;sessionId:string;requestHash:string;status:string}>>(Prisma.sql`
    SELECT "operationKey","sessionId","requestHash",status FROM "BotOperation"
    WHERE "businessId"=${businessId} AND type='HOLD_VISIT_WITH_DEPOSIT' AND "resultRef"=${groupId} FOR UPDATE`)
  const parent=parents[0]
  if(parents.length!==1 || !parent || parent.status!=='COMPLETED' || parent.sessionId!==member.sessionId || !text(parent.operationKey,256) ||
      !parent.operationKey.startsWith('conversation-booking:') || !/^[a-f0-9]{64}$/.test(parent.requestHash)) fail()
  const children=await tx.$queryRaw<Array<{businessId:string;sessionId:string;requestHash:string;status:string;type:string;resultRef:string}>>(Prisma.sql`
    SELECT "businessId","sessionId","requestHash",status,type,"resultRef" FROM "BotOperation"
    WHERE "operationKey"=${parent.operationKey+':segment:0:HOLD_VISIT_WITH_DEPOSIT'} FOR UPDATE`)
  const child=children[0]
  if(children.length!==1 || !child || child.businessId!==businessId || child.sessionId!==member.sessionId || child.status!=='COMPLETED' ||
      child.type!=='HOLD_VISIT_WITH_DEPOSIT' || child.resultRef!==member.visitId || !/^[a-f0-9]{64}$/.test(child.requestHash)) fail()
}

/** Durable financial authority for a singular paid appointment after the chat
 * that created it has been reset. This intentionally returns only the sealed
 * F8 facts and original session identity; it never reconstructs a presented
 * booking or rewrites its receipt. */
export async function lockRuntimeSingularApprovedDeposit(tx:Prisma.TransactionClient,target:{businessId:string;appointmentId:string}) {
  await lockCoordinatedDepositGroupForAppointment(tx,target)
  const rows=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT a.id AS "appointmentId",a.origin,a.status AS "appointmentStatus",a."businessId",a."customerId",a."professionalId",a."visitId",a."coordinationGroupId",
      v.status AS "visitStatus",v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",v."sessionId",
      d.id AS "depositId",d.status AS "depositStatus",d.source,d.amount,d."snapshotSealedAt",d."visitId" AS "depositVisitId",d."conversationId",d.mode,d."configuredValue",d."baseAmount",d."expiresAt",d."holdTtlMinutes",d."holdTtlProvenance"
    FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" AND v."businessId"=a."businessId"
    JOIN "BookingDeposit" d ON d."appointmentId"=a.id AND d."businessId"=a."businessId"
    WHERE a.id=${target.appointmentId} AND a."businessId"=${target.businessId}
    FOR UPDATE OF a,v,d`)
  const row=rows[0]
  if(rows.length!==1 || !row || row.origin!=='BOT' || row.appointmentStatus!=='CONFIRMED' || row.visitStatus!=='CONFIRMED' ||
    row.visitBusinessId!==target.businessId || row.customerId!==row.visitCustomerId || row.depositVisitId!==row.visitId || row.source!=='WHATSAPP' ||
    row.depositStatus!=='APPROVED' || !text(row.coordinationGroupId) || !text(row.sessionId) || !text(row.conversationId) || !row.snapshotSealedAt ||
    !Number.isSafeInteger(row.amount) || Number(row.amount)<0) fail()
  const lines=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT "serviceId","sortOrder","serviceName",mode,"configuredValue","baseAmount",amount FROM "BookingDepositLine"
    WHERE "businessId"=${target.businessId} AND "depositId"=${row.depositId} ORDER BY "sortOrder" FOR UPDATE`)
  if(!lines.length || lines.some((line,index)=>line.sortOrder!==index || !text(line.serviceId) || !text(line.serviceName) || !Number.isSafeInteger(line.amount)) ||
    lines.reduce((sum,line)=>sum+Number(line.amount),0)!==Number(row.amount)) fail()
  const proofs=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT id,sequence,kind,"validationStatus","validatorVersion","validatedAt","receivedAt","sourceMimeType","sourceByteSize","derivedMimeType","derivedByteSize","sourceSha256","derivedSha256","providerEventId","providerMessageId","providerMediaId", "purgedAt","purgeReason"
    FROM "BookingDepositProof" WHERE "businessId"=${target.businessId} AND "depositId"=${row.depositId} ORDER BY sequence FOR UPDATE`)
  if(!proofs.length || proofs.some((proof,index)=>proof.sequence!==index+1 || proof.validationStatus!=='VALID' || !text(proof.sourceSha256) || !text(proof.derivedSha256))) fail()
  const audits=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT a.id AS "auditId",a."proofId",a.action,a."actorUserId",a."createdAt",a."operationKey",o.status AS "operationStatus",o.type AS "operationType",o."resultRef",o."requestHash",o."sessionId" AS "operationSessionId"
    FROM "BookingDepositReviewAudit" a JOIN "BotOperation" o ON o."businessId"=a."businessId" AND o."operationKey"=a."operationKey"
    WHERE a."businessId"=${target.businessId} AND a."depositId"=${row.depositId} ORDER BY a."createdAt" DESC,a.id DESC LIMIT 1 FOR UPDATE OF a,o`)
  const audit=audits[0]
  if(audits.length!==1 || !audit || audit.action!=='APPROVED' || audit.proofId!==proofs.at(-1)!.id || !text(audit.actorUserId) ||
    audit.operationStatus!=='COMPLETED' || audit.operationType!=='APPROVE_DEPOSIT_PROOF' || audit.resultRef!==audit.auditId || !/^[a-f0-9]{64}$/.test(String(audit.requestHash)) ||
    audit.operationSessionId!==row.sessionId) fail()
  const cash=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT * FROM "CashEntry" WHERE "businessId"=${target.businessId} AND "bookingDepositId"=${row.depositId} ORDER BY id FOR UPDATE`)
  const deposit={id:row.depositId,businessId:row.businessId,appointmentId:row.appointmentId,conversationId:row.conversationId,visitId:row.depositVisitId,
    source:row.source,amount:row.amount,status:row.depositStatus,snapshotSealedAt:row.snapshotSealedAt,mode:row.mode,configuredValue:row.configuredValue,
    baseAmount:row.baseAmount,expiresAt:row.expiresAt,holdTtlMinutes:row.holdTtlMinutes,holdTtlProvenance:row.holdTtlProvenance}
  return {groupId:row.coordinationGroupId,originalSessionId:row.sessionId,customerId:row.customerId,appointmentId:row.appointmentId,
    visitId:row.visitId,depositId:row.depositId,amount:Number(row.amount),deposit,lines,proofs,audit,cash}
}


export async function lockCoordinatedDepositGroup(tx: Prisma.TransactionClient, target: { businessId: string; groupId: string }): Promise<CoordinatedDepositGroup> {
  const state=await lockCoordinatedDepositGroupState(tx,target)
  if(state.depositStatus!=='PENDING_PROOF') fail()
  return state.group
}

/** Immutable manifest and live operational state are separate: renewing TTL never rewrites child hashes. */
export async function lockCoordinatedDepositGroupState(tx: Prisma.TransactionClient, target: { businessId: string; groupId: string }): Promise<CoordinatedDepositGroupState> {
  if (!text(target.businessId) || !/^[a-f0-9-]{36}$/.test(target.groupId)) fail()
  await acquireAgendaHierarchy(tx,{businessId:target.businessId,professionalIds:[]})
  const ops = await tx.$queryRaw<Array<{ operationKey: string; requestHash: string; resultRef: string; status: string }>>(Prisma.sql`
    SELECT "operationKey","requestHash","resultRef",status FROM "BotOperation"
    WHERE "businessId"=${target.businessId} AND type='HOLD_COORDINATED_DEPOSIT_GROUP'
      AND (CASE WHEN type='HOLD_COORDINATED_DEPOSIT_GROUP' THEN "resultRef"::jsonb ELSE NULL END)->>'groupId'=${target.groupId} FOR UPDATE`)
  if (ops.length !== 1 || ops[0]!.status !== 'COMPLETED') fail()
  let group: CoordinatedDepositGroup
  try { group = JSON.parse(ops[0]!.resultRef) as CoordinatedDepositGroup } catch { return fail() }
  const p = group.proposal
  if (group.version !== 1 || group.groupId !== target.groupId || group.operationKey !== ops[0]!.operationKey ||
      group.requestHash !== canonicalJsonHash({proposal:p,origin:{...p?.scope,canonicalPhone:group.canonicalPhone}}) || group.requestHash !== ops[0]!.requestHash || p?.scope.businessId !== target.businessId || p.fingerprint !== canonicalJsonHash(p.terms) ||
      group.amount !== p.terms.deposit?.financial.amount || iso(group.expiresAt) !== group.expiresAt ||
      JSON.stringify(group).length>24000 || !text(group.customerId) || !/^\d{10,15}$/.test(group.canonicalPhone) || !Array.isArray(group.members) || group.members.length !== p.terms.segments.length || group.members.length < 2 || group.members.length > 8) fail()
  const currentProfessionals=await tx.$queryRaw<Array<{professionalId:string}>>(Prisma.sql`
    SELECT "professionalId" FROM "Appointment" WHERE "coordinationGroupId"=${target.groupId}`)
  await acquireAgendaHierarchy(tx,{businessId:target.businessId,professionalIds:[...p.terms.segments.map(s=>s.professionalId),...currentProfessionals.map(r=>r.professionalId)]})
  // Intentionally do NOT filter tenant/customer within a group: injected members invalidate ALL.
  const rows = await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`
    SELECT a.id AS "appointmentId",a.origin,a."businessId",a."customerId",a."professionalId",a."serviceId",a."startAt",a."totalDurationMinutes",a."quotedPrice",a.status AS "appointmentStatus",a.version AS "appointmentVersion",
      a."visitId",v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",v."professionalId" AS "visitProfessionalId",v."sessionId",v."scheduledStartAt",v."totalDurationMinutes" AS "visitDuration",v."totalPrice",v."holdExpiresAt",v.status AS "visitStatus",v.version AS "visitVersion",
      d.id AS "depositId",d."businessId" AS "depositBusinessId",d."visitId" AS "depositVisitId",d."conversationId",d.source,d.amount,d.status AS "depositStatus",d."expiresAt",d."holdTtlMinutes",d."holdTtlProvenance",d."snapshotSealedAt",d."rejectionReason"
    FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
    WHERE a."coordinationGroupId"=${target.groupId} ORDER BY a.id FOR UPDATE OF a,v`)
  if (rows.length !== group.members.length) fail()
  const assignments=await amendedPaidAssignments(tx,target.businessId,group)
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
        !row || row.origin!=='BOT' || row.businessId !== target.businessId || row.customerId !== group.customerId || row.visitBusinessId !== target.businessId || row.visitCustomerId !== group.customerId ||
        row.sessionId !== p.scope.sessionId || row.visitId !== m.visitId || row.professionalId !== assignments.get(m.appointmentId)?.professionalId || row.visitProfessionalId !== assignments.get(m.appointmentId)?.professionalId ||
        row.serviceId !== segment.serviceId || iso(row.startAt) !== assignments.get(m.appointmentId)?.startAt || iso(row.scheduledStartAt) !== assignments.get(m.appointmentId)?.startAt ||
        row.totalDurationMinutes !== segment.durationMinutes || row.visitDuration !== segment.durationMinutes ||
        row.quotedPrice !== (segment.priceMode==='FIXED'?segment.priceMinor:null) || row.totalPrice !== (segment.priceMode==='FIXED'?segment.priceMinor:null)) fail()
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
          row.holdTtlMinutes!==p.terms.deposit!.financial.ttlMinutes || row.holdTtlProvenance!==p.terms.deposit!.financial.ttlProvenance ||
          !row.snapshotSealedAt) fail()
      deposits.add(m.depositId)
      const lines = await tx.$queryRaw<BookingDepositTerms['lines']>(Prisma.sql`SELECT "serviceId","sortOrder","serviceName",mode,"configuredValue","baseAmount",amount FROM "BookingDepositLine" WHERE "businessId"=${target.businessId} AND "depositId"=${m.depositId} ORDER BY "sortOrder"`)
      if (!isDeepStrictEqual(lines,[{...financialLine,sortOrder:0}])) fail()
    } else if (m.depositId!==null || row.depositId!==null || m.amount!==0) fail()
  }
  if (group.anchorDepositId!==group.members.find(m=>m.depositId!==null)?.depositId || group.members.reduce((sum,m)=>sum+m.amount,0)!==group.amount || deposits.size!==p.terms.deposit!.financial.lines.length) fail()
  const financialRows=rows.filter(r=>r.depositId!==null)
  const status=String(financialRows[0]!.depositStatus), expiry=iso(financialRows[0]!.expiresAt)
  const states:Record<string,[string,string]>={PENDING_PROOF:['HELD','PENDING'],PENDING_RESUBMISSION:['HELD','PENDING'],PROOF_RECEIVED:['PENDING_PAYMENT_REVIEW','PENDING'],APPROVED:['CONFIRMED','CONFIRMED'],REJECTED:['CANCELLED','CANCELLED'],EXPIRED:['EXPIRED','CANCELLED']}
  if(!expiry || !states[status] || financialRows.some(r=>r.depositStatus!==status || iso(r.expiresAt)!==expiry) ||
      rows.some(r=>r.visitStatus!==states[status]![0] || r.appointmentStatus!==states[status]![1]) ||
      !['REJECTED'].includes(status) && rows.some(r=>iso(r.holdExpiresAt)!==expiry) || status==='PENDING_PROOF' && expiry!==group.expiresAt) fail()
  // An operational renewal must be justified by each obligation's immutable review audit.
  if(expiry!==group.expiresAt || status==='PENDING_RESUBMISSION') {
    for(const m of group.members.filter(m=>m.depositId)) {
      const audit=await tx.$queryRaw<Array<{createdAt:Date}>>(Prisma.sql`SELECT "createdAt" FROM "BookingDepositReviewAudit"
        WHERE "businessId"=${target.businessId} AND "depositId"=${m.depositId} AND action='RESUBMISSION_ALLOWED' ORDER BY "createdAt" DESC,id DESC LIMIT 1`)
      if(audit.length!==1 || new Date(audit[0]!.createdAt).getTime()+p.terms.deposit!.financial.ttlMinutes*60000!==Date.parse(expiry)) fail()
    }
  }
  const cancellationReason = status==='REJECTED' && financialRows.every(r=>['CANCELLED_BY_CUSTOMER','CANCELLED_BY_STAFF'].includes(String(r.rejectionReason)))
    ? await verifyPendingCancellation(tx,target.businessId,group,rows) : undefined
  // Internal evidence copies represent ONE receipt event, never independent payments.
  let proofIdentity:string|undefined
  let reviewIdentity:string|undefined
  for(const m of group.members.filter(m=>m.depositId)) {
    const proofs=await tx.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`SELECT id,sequence,kind,"validationStatus","validatorVersion","validatedAt","receivedAt","sourceMimeType","sourceByteSize","derivedMimeType","derivedByteSize","sourceSha256","derivedSha256","providerEventId","providerMessageId","providerMediaId"
      FROM "BookingDepositProof" WHERE "businessId"=${target.businessId} AND "depositId"=${m.depositId} ORDER BY sequence`)
    if(['PROOF_RECEIVED','APPROVED','REJECTED','PENDING_RESUBMISSION'].includes(status) && !cancellationReason && !proofs.length || proofs.some(p=>p.validationStatus!=='VALID')) fail()
    const identity=JSON.stringify(proofs.map(({id,...facts})=>facts))
    if((status==='PENDING_PROOF' || cancellationReason) && proofs.some(p=>p.kind!=='LATE')) fail()
    if(['APPROVED','REJECTED','PENDING_RESUBMISSION'].includes(status) && !cancellationReason) {
      const expected=status==='APPROVED'?'APPROVED':status==='REJECTED'?'FINAL_REJECTED':'RESUBMISSION_ALLOWED'
      const audits=await tx.$queryRaw<Array<{proofId:string;actorUserId:string;createdAt:Date;action:string;operationStatus:string;resultRef:string;auditId:string;type:string}>>(Prisma.sql`
        SELECT a."proofId",a."actorUserId",a."createdAt",a.action,o.status AS "operationStatus",o."resultRef",a.id AS "auditId",o.type
        FROM "BookingDepositReviewAudit" a JOIN "BotOperation" o ON o."operationKey"=a."operationKey" AND o."businessId"=a."businessId"
        WHERE a."businessId"=${target.businessId} AND a."depositId"=${m.depositId} ORDER BY a."createdAt" DESC,a.id DESC LIMIT 1`)
      const audit=audits[0]
      if(audits.length!==1 || !audit || audit.action!==expected || audit.proofId!==proofs.at(-1)?.id || audit.operationStatus!=='COMPLETED' || audit.resultRef!==audit.auditId || audit.type!==(status==='APPROVED'?'APPROVE_DEPOSIT_PROOF':'REJECT_DEPOSIT_PROOF')) fail()
      const review=JSON.stringify([audit.action,audit.actorUserId,iso(audit.createdAt)])
      if(reviewIdentity!==undefined && reviewIdentity!==review) fail()
      reviewIdentity=review
    }
    if(status==='EXPIRED') {
      const audits=await tx.$queryRaw<Array<{dueAt:Date;reason:string;expiredAt:Date}>>(Prisma.sql`SELECT "dueAt",reason,"expiredAt" FROM "BookingDepositExpiryAudit" WHERE "businessId"=${target.businessId} AND "depositId"=${m.depositId}`)
      if(audits.length!==1 || iso(audits[0]!.dueAt)!==expiry || audits[0]!.reason!=='HOLD_TTL_EXPIRED' || !iso(audits[0]!.expiredAt)) fail()
    }
    if(proofIdentity!==undefined && identity!==proofIdentity) fail()
    proofIdentity=identity
  }
  const clock=await tx.$queryRaw<Array<{dbNow:Date}>>(Prisma.sql`SELECT clock_timestamp() AS "dbNow"`)
  return {group,depositStatus:status,currentExpiresAt:new Date(expiry),dbNow:new Date(clock[0]!.dbNow),
    currentAssignments:group.members.map(m=>({appointmentId:m.appointmentId,...assignments.get(m.appointmentId)!})),
    ...(cancellationReason?{cancellationReason}:{})}
}

/** Cancellation has its own durable authority, never a fabricated payment review. */
export async function verifyPendingCancellation(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,businessId:string,
  group:Pick<CoordinatedDepositGroup,'groupId'|'operationKey'> & {proposal:Pick<RuntimePresentedBooking,'scope'|'nonce'|'fingerprint'>},
  rows:Record<string,unknown>[]):Promise<'CUSTOMER'|'STAFF'> {
  const operations=await tx.$queryRaw<Array<{requestHash:string;resultRef:string;sessionId:string;status:string}>>(Prisma.sql`
    SELECT "requestHash","resultRef","sessionId",status FROM "BotOperation"
    WHERE "businessId"=${businessId} AND type='CANCEL_PENDING_DEPOSIT_GROUP'
      AND (CASE WHEN type='CANCEL_PENDING_DEPOSIT_GROUP' THEN "resultRef"::jsonb ELSE NULL END)->'snapshot'->>'groupId'=${group.groupId} FOR UPDATE`)
  if(operations.length!==1) fail()
  const operation=operations[0]!
  let result:unknown;try{result=JSON.parse(operation.resultRef)}catch{return fail()}
  if(!object(result) || result.version!==1 || !object(result.snapshot) || !Array.isArray(result.auditIds)) fail()
  const snapshot=result.snapshot, actor=snapshot.actor
  if(!object(actor) || !['CUSTOMER','STAFF'].includes(String(actor.kind)) || !text(actor.id) || snapshot.version!==1 ||
    snapshot.businessId!==businessId || snapshot.groupId!==group.groupId || snapshot.sessionId!==group.proposal.scope.sessionId ||
    operation.sessionId!==snapshot.sessionId || operation.status!=='COMPLETED' || !Array.isArray(snapshot.members) || snapshot.members.length!==rows.length ||
    !text(snapshot.fingerprint) || JSON.stringify(result).length>20000) fail()
  const {fingerprint,...content}=snapshot
  if(fingerprint!==canonicalJsonHash(content) || operation.requestHash!==canonicalJsonHash({action:'CANCEL_PENDING_DEPOSIT_GROUP',snapshot,confirmed:true})) fail()
  const members=snapshot.members
  for(const row of rows) {
    const matches=members.filter(m=>object(m)&&m.appointmentId===row.appointmentId)
    const member=matches[0]
    if(matches.length!==1 || !object(member) || member.visitId!==row.visitId || member.professionalId!==row.professionalId || member.holdExpiresAt!==iso(row.holdExpiresAt) ||
      typeof member.appointmentVersion!=='number' || typeof member.visitVersion!=='number' ||
      row.appointmentVersion!==member.appointmentVersion+1 || row.visitVersion!==member.visitVersion+1 || member.depositId!==row.depositId ||
      (row.depositId && (member.amount!==row.amount || member.expiresAt!==iso(row.expiresAt) ||
        row.rejectionReason!==(actor.kind==='STAFF'?'CANCELLED_BY_STAFF':'CANCELLED_BY_CUSTOMER')))) fail()
  }
  const depositIds=rows.flatMap(r=>r.depositId?[r.depositId]:[])
  if(!isDeepStrictEqual(result.appointmentIds, members.map(m=>object(m)?m.appointmentId:null)) ||
    !isDeepStrictEqual(result.depositIds,members.flatMap(m=>object(m)&&m.depositId?[m.depositId]:[]))) fail()
  if(actor.kind==='STAFF') {
    if(result.auditIds.length!==depositIds.length || !result.auditIds.every(v=>text(v))) fail()
    const audits=await tx.$queryRaw<Array<{userId:string;entityId:string}>>(Prisma.sql`
      SELECT "userId","entityId" FROM "StaffAuditLog" WHERE id IN (${Prisma.join(result.auditIds as string[])})
        AND "businessId"=${businessId} AND action='CANCEL_PENDING_DEPOSIT_GROUP' AND "entityType"='BookingDeposit' AND method='DELETE' FOR SHARE`)
    if(audits.length!==depositIds.length || audits.some(a=>a.userId!==actor.id) ||
      !isDeepStrictEqual(audits.map(a=>a.entityId).sort(),depositIds.sort())) fail()
  } else if(actor.id!==group.proposal.scope.sessionId || result.auditIds.length!==0 || !object(snapshot.receipt) ||
    snapshot.receipt.groupId!==group.groupId || snapshot.receipt.operationKey!==group.operationKey ||
    snapshot.receipt.proposalNonce!==group.proposal.nonce || snapshot.receipt.fingerprint!==group.proposal.fingerprint) fail()
  return actor.kind as 'CUSTOMER'|'STAFF'
}
