import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { canonicalJsonHash } from './canonical-json.js'
import { assertManagementDate, managementRescheduleOfferKey, type ManagementAvailabilityReader, type ManagementRescheduleOffer } from './appointment-management.js'
import { Prisma } from '../generated/prisma/client.js'
import { acquireBusinessAgendaLock, acquireAgendaHierarchy, lockAppointmentRows } from '../services/agenda-locks.js'
import { normalizePhone } from '../services/phone-normalization-service.js'
import { parseRuntimeBookingReservation, loadRuntimeDepositReceipt, runtimeBookingRequestHash, runtimeBookingChildInput, runtimeBookingChildRequestHash } from './prisma-conversational-booking.js'
import { cancelManageableAppointmentInTransaction, type CancelManageableAppointmentInput, type CancelManageableAppointmentResult } from '../bot-options/application/appointment-management.js'
import { rescheduleManageableAppointmentInTransaction, type RescheduleManageableAppointmentInput, type RescheduleManageableAppointmentResult } from '../bot-options/application/appointment-rescheduling.js'
import { assertManagementScope, assertCancellationSnapshot, cancellationFingerprint, managementIdentifier, GroupCancellationError, assertGroupMoves, rescheduleFingerprint, type GroupRescheduleCommand, type GroupMove, type CancellationSnapshot, type GroupCancellationCommand, type ManagementScope } from './appointment-management.js'

type Tx = Prisma.TransactionClient
type MemberRow = CancellationSnapshot['members'][number] & {
  businessId: string; customerId: string; groupId: string | null; dbNow: Date | string
  visitBusinessId: string | null; visitCustomerId: string | null; visitProfessionalId: string | null; visitStartAt: Date | string | null
  depositBusinessId: string | null; serviceBusinesses: string[]
}
export type GroupCancellationReceipt = { appointmentIds: string[]; replayed: boolean }
type ChildInput = CancelManageableAppointmentInput & { requestHash: string }
type Child = (tx: Tx, input: ChildInput) => Promise<CancelManageableAppointmentResult>
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const childHash = (scope: ManagementScope, appointmentId: string) => digest({ action: 'CANCEL_APPOINTMENT', businessId: scope.businessId, normalizedPhone: scope.normalizedPhone, sessionId: scope.sessionId, appointmentId, confirmed: true })
const iso = (value: Date | string) => new Date(value).toISOString()

async function readSnapshot(tx: Tx, scope: ManagementScope, appointmentId: string): Promise<CancellationSnapshot> {
  assertManagementScope(scope); managementIdentifier(appointmentId)
  const identity = await tx.$queryRaw<Array<{ phone: string }>>(Prisma.sql`
    SELECT co.phone FROM "BotSession" bs JOIN "Conversation" co ON co.id=bs."conversationId" AND co."businessId"=bs."businessId"
    JOIN "Customer" c ON c.id=${scope.customerId} AND c."businessId"=bs."businessId" AND c."normalizedPhone"=${scope.normalizedPhone}
    WHERE bs.id=${scope.sessionId} AND bs."businessId"=${scope.businessId}`)
  if (identity.length !== 1 || normalizePhone(identity[0]!.phone) !== scope.normalizedPhone) throw new GroupCancellationError('management ownership unavailable')
  const anchor = await tx.$queryRaw<Array<{ groupId: string | null }>>(Prisma.sql`
    SELECT "coordinationGroupId" AS "groupId" FROM "Appointment" WHERE id=${appointmentId} AND "businessId"=${scope.businessId} AND "customerId"=${scope.customerId}`)
  if (anchor.length !== 1) throw new GroupCancellationError('management ownership unavailable')
  const groupId = anchor[0]!.groupId
  // Do not filter ownership inside a group: an injected foreign member invalidates the complete group.
  const rows = await tx.$queryRaw<MemberRow[]>(Prisma.sql`
    SELECT a.id AS "appointmentId",a."businessId",a."customerId",a."coordinationGroupId" AS "groupId",a.version,a.status::text,
      a."professionalId",a."startAt",a."totalDurationMinutes" AS "durationMinutes",a."quotedPrice",a."manualDepositPaid",a."manualDepositAmount",
      COALESCE((SELECT sum(GREATEST(s.duration,COALESCE(s."customerDurationMax",s."customerDurationMin",s.duration)))::int FROM "Service" s WHERE s.id IN (SELECT i."serviceId" FROM "AppointmentServiceItem" i WHERE i."appointmentId"=a.id UNION SELECT a."serviceId")),a."totalDurationMinutes") AS "customerDurationMinutes",
      a."visitId",v.version AS "visitVersion",v.status::text AS "visitStatus",v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",
      v."professionalId" AS "visitProfessionalId",v."scheduledStartAt" AS "visitStartAt",
      d.id AS "depositId",d.status::text AS "depositStatus",d."businessId" AS "depositBusinessId",clock_timestamp() AS "dbNow",
      COALESCE((SELECT array_agg(i."serviceId" ORDER BY i."sortOrder") FROM "AppointmentServiceItem" i WHERE i."appointmentId"=a.id),ARRAY[a."serviceId"]) AS "serviceIds",
      ARRAY(SELECT s."businessId" FROM "Service" s WHERE s.id IN (SELECT i."serviceId" FROM "AppointmentServiceItem" i WHERE i."appointmentId"=a.id UNION SELECT a."serviceId")) AS "serviceBusinesses"
    FROM "Appointment" a LEFT JOIN "BookingVisit" v ON v.id=a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
    WHERE ${groupId === null ? Prisma.sql`a.id=${appointmentId}` : Prisma.sql`a."coordinationGroupId"=${groupId}`}
    ORDER BY a.id`)
  if (!rows.length || rows.some(row => row.businessId !== scope.businessId || row.customerId !== scope.customerId ||
    row.groupId !== groupId || row.serviceBusinesses.length !== row.serviceIds.length || row.serviceBusinesses.some(id=>id!==scope.businessId) ||
    (row.visitId !== null && (row.visitBusinessId !== scope.businessId || row.visitCustomerId !== scope.customerId || row.visitProfessionalId !== row.professionalId || row.visitStartAt === null || iso(row.visitStartAt) !== iso(row.startAt))) ||
    (row.depositId !== null && row.depositBusinessId !== scope.businessId))) throw new GroupCancellationError('group ownership or aggregate coherence mismatch')
  return { scope: {...scope}, groupId, dbNow: iso(rows[0]!.dbNow), members: rows.map(row => ({
    appointmentId: row.appointmentId, version: row.version, status: row.status, visitId: row.visitId, visitVersion: row.visitVersion, visitStatus: row.visitStatus,
    professionalId: row.professionalId, serviceIds: row.serviceIds, startAt: iso(row.startAt), durationMinutes: row.durationMinutes, customerDurationMinutes: row.customerDurationMinutes!, quotedPrice: row.quotedPrice,
    depositId: row.depositId, depositStatus: row.depositStatus, manualDepositPaid: row.manualDepositPaid, manualDepositAmount: row.manualDepositAmount
  })) }
}
export async function loadCancellationGroupSnapshot(tx: Tx, scope: ManagementScope, appointmentId: string): Promise<CancellationSnapshot> {
  const snapshot = await readSnapshot(tx,scope,appointmentId); assertCancellationSnapshot(snapshot); return snapshot
}

/** Caller must own the transaction and propagate every error outside it. No catches or nested transactions. */
export async function cancelGroupInTransaction(tx: Tx, command: GroupCancellationCommand, child: Child = cancelManageableAppointmentInTransaction): Promise<GroupCancellationReceipt> {
  if (command.kind !== 'CANCEL_APPOINTMENT_GROUP' || command.confirmed !== true || command.fingerprint !== cancellationFingerprint(command.snapshot)) throw new GroupCancellationError('current consent/snapshot mismatch')
  managementIdentifier(command.nonce)
  const scope=command.snapshot.scope, members=[...command.snapshot.members].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId))
  const key='cancel-group:'+canonicalJsonHash([scope,command.nonce,command.fingerprint]), hash=canonicalJsonHash(command)
  const locked=await lockManagedGroup(tx,scope,members[0]!.appointmentId)
  const receipt={ fingerprint:command.fingerprint, nonce:command.nonce, appointmentIds:members.map(m=>m.appointmentId),
    children:members.map(m=>({key:key+':'+m.appointmentId,id:m.appointmentId,hash:childHash(scope,m.appointmentId)})) }
  const prior=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`
    SELECT "businessId","sessionId",type,status,"requestHash","resultRef" FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE`)
  if(prior.length) {
    const p=prior[0]!
    if(p.businessId!==scope.businessId || p.sessionId!==scope.sessionId || p.type!=='CANCEL_APPOINTMENT_GROUP' || p.status!=='COMPLETED' || p.requestHash!==hash || p.resultRef!==JSON.stringify(receipt)) throw new GroupCancellationError('group replay mismatch')
    assertCancellationSnapshot(locked,true)
    const expected=members.map(m=>({...m,status:'CANCELLED',version:m.version+1,visitStatus:m.visitId?'CANCELLED':null,visitVersion:m.visitVersion===null?null:m.visitVersion+1}))
    if(locked.groupId!==command.snapshot.groupId || !isDeepStrictEqual(locked.members,expected)) throw new GroupCancellationError('group replay durable membership mismatch')
    for(const c of receipt.children) {
      const operations=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "BotOperation" WHERE "operationKey"=${c.key} AND "businessId"=${scope.businessId} AND "sessionId"=${scope.sessionId} AND type='CANCEL_APPOINTMENT' AND status='COMPLETED' AND "requestHash"=${c.hash} AND "resultRef"=${c.id} FOR UPDATE`)
      if(operations.length!==1) throw new GroupCancellationError('child replay missing or foreign')
    }
    return {appointmentIds:receipt.appointmentIds,replayed:true}
  }
  if(cancellationFingerprint(locked)!==command.fingerprint) throw new GroupCancellationError('group snapshot changed; new consent required')
  // Financial uncertainty blocks the group before any child; F9 remains the final policy authority.
  if(locked.members.some(m=>m.manualDepositPaid || m.manualDepositAmount!==null || m.depositId!==null)) throw new GroupCancellationError('HANDOFF: group financial review required')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","updatedAt") VALUES (${randomUUID()},${key},'CANCEL_APPOINTMENT_GROUP',${scope.businessId},${scope.sessionId},'STARTED',${hash},clock_timestamp())`)
  for(const c of receipt.children) {
    const result=await child(tx,{businessId:scope.businessId,normalizedPhone:scope.normalizedPhone,sessionId:scope.sessionId,appointmentId:c.id,operationKey:c.key,confirmed:true,requestHash:c.hash})
    if(result.outcome!=='CANCELLED' || result.replayed) throw new GroupCancellationError('group child '+result.outcome+'; rollback required')
  }
  const completed=await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"resultRef"=${JSON.stringify(receipt)},"updatedAt"=clock_timestamp() WHERE "operationKey"=${key} AND status='STARTED' AND "requestHash"=${hash}`)
  if(completed!==1) throw new GroupCancellationError('group completion fence failed')
  return {appointmentIds:receipt.appointmentIds,replayed:false}
}

async function lockManagedGroup(tx: Tx,scope: ManagementScope,appointmentId: string): Promise<CancellationSnapshot> {
  await acquireBusinessAgendaLock(tx,scope.businessId)
  const current=await readSnapshot(tx,scope,appointmentId)
  await acquireAgendaHierarchy(tx,{businessId:scope.businessId,professionalIds:current.members.map(m=>m.professionalId)})
  await lockAppointmentRows(tx,{businessId:scope.businessId,appointmentIds:current.members.map(m=>m.appointmentId)})
  await tx.$queryRaw(Prisma.sql`SELECT v.id FROM "BookingVisit" v WHERE v.id IN (${Prisma.join(current.members.flatMap(m=>m.visitId?[m.visitId]:[]).concat(['']))}) ORDER BY v.id FOR UPDATE OF v`)
  await tx.$queryRaw(Prisma.sql`SELECT d.id FROM "BookingDeposit" d WHERE d."appointmentId" IN (${Prisma.join(current.members.map(m=>m.appointmentId))}) ORDER BY d.id FOR UPDATE OF d`)
  return readSnapshot(tx,scope,appointmentId)
}

type RescheduleChild = (tx: Tx,input: RescheduleManageableAppointmentInput) => Promise<RescheduleManageableAppointmentResult>
export type GroupRescheduleReceipt = {appointmentIds:string[];moves:readonly GroupMove[];replayed:boolean}

/** The same caller-owned atomic boundary as cancellation; no legacy exclusion override. */
export async function rescheduleGroupInTransaction(tx: Tx,command: GroupRescheduleCommand,
  child: RescheduleChild = rescheduleManageableAppointmentInTransaction): Promise<GroupRescheduleReceipt> {
  if(command.kind!=='RESCHEDULE_APPOINTMENT_GROUP' || command.confirmed!==true ||
    command.fingerprint!==rescheduleFingerprint(command.snapshot,command.moves)) throw new GroupCancellationError('current reschedule consent/snapshot mismatch')
  managementIdentifier(command.nonce)
  const scope=command.snapshot.scope, members=[...command.snapshot.members].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId))
  const key='reschedule-group:'+canonicalJsonHash([scope,command.nonce,command.fingerprint]), hash=canonicalJsonHash(command)
  const locked=await lockManagedGroup(tx,scope,members[0]!.appointmentId)
  const children=members.map(member=>{
    const move=command.moves.find(m=>m.appointmentId===member.appointmentId)!
    const input={businessId:scope.businessId,normalizedPhone:scope.normalizedPhone,sessionId:scope.sessionId,appointmentId:member.appointmentId,
      operationKey:key+':'+member.appointmentId,actor:'bot-session:'+scope.sessionId,confirmed:true as const,newStartAt:move.newStartAt}
    return {input,hash:digest({action:'RESCHEDULE_APPOINTMENT',...input})}
  })
  const receipt={fingerprint:command.fingerprint,nonce:command.nonce,moves:children.map(c=>({appointmentId:c.input.appointmentId,newStartAt:c.input.newStartAt})),
    children:children.map(c=>({key:c.input.operationKey,id:c.input.appointmentId,hash:c.hash}))}
  const prior=await tx.$queryRaw<Array<{businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`
    SELECT "businessId","sessionId",type,status,"requestHash","resultRef" FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE`)
  if(prior.length) {
    const p=prior[0]!
    if(p.businessId!==scope.businessId || p.sessionId!==scope.sessionId || p.type!=='RESCHEDULE_APPOINTMENT_GROUP' || p.status!=='COMPLETED' ||
      p.requestHash!==hash || p.resultRef!==JSON.stringify(receipt)) throw new GroupCancellationError('reschedule replay mismatch')
    // A durable replay is not permission for a new future write.
    assertCancellationSnapshot(locked,false,false)
    const expected=members.map(member=>({...member,startAt:command.moves.find(m=>m.appointmentId===member.appointmentId)!.newStartAt,
      version:member.version+1,visitVersion:member.visitVersion===null?null:member.visitVersion+1}))
    if(locked.groupId!==command.snapshot.groupId || !isDeepStrictEqual(locked.members,expected)) throw new GroupCancellationError('reschedule replay durable membership mismatch')
    for(const c of children) {
      const rows=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        SELECT o.id FROM "BotOperation" o JOIN "AppointmentChangeHistory" h ON h."operationKey"=o."operationKey"
        WHERE o."operationKey"=${c.input.operationKey} AND o."businessId"=${scope.businessId} AND o."sessionId"=${scope.sessionId}
          AND o.type='RESCHEDULE_APPOINTMENT' AND o.status='COMPLETED' AND o."requestHash"=${c.hash} AND o."resultRef"=${c.input.appointmentId}
          AND h."appointmentId"=${c.input.appointmentId} AND h.actor=${c.input.actor} AND h."fromStartAt"=${new Date(members.find(m=>m.appointmentId===c.input.appointmentId)!.startAt)}
          AND h."toStartAt"=${new Date(c.input.newStartAt)} AND h."bookingDepositId" IS NULL AND h."depositPreserved"=false FOR UPDATE OF o,h`)
      if(rows.length!==1) throw new GroupCancellationError('reschedule child replay/history mismatch')
    }
    return {appointmentIds:members.map(m=>m.appointmentId),moves:receipt.moves,replayed:true}
  }
  if(cancellationFingerprint(locked)!==cancellationFingerprint(command.snapshot)) throw new GroupCancellationError('group snapshot changed; new consent required')
  assertGroupMoves(locked,command.moves)
  if(locked.members.some(m=>m.manualDepositPaid || m.manualDepositAmount!==null || m.depositId!==null)) throw new GroupCancellationError('HANDOFF: group financial review required')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","updatedAt")
    VALUES (${randomUUID()},${key},'RESCHEDULE_APPOINTMENT_GROUP',${scope.businessId},${scope.sessionId},'STARTED',${hash},clock_timestamp())`)
  for(const c of children) {
    const result=await child(tx,c.input)
    if(result.outcome!=='RESCHEDULED' || result.replayed || result.appointmentId!==c.input.appointmentId ||
      result.newStartAt!==c.input.newStartAt || result.depositPreserved) throw new GroupCancellationError('group child '+result.outcome+'; rollback required')
  }
  const completed=await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"resultRef"=${JSON.stringify(receipt)},"updatedAt"=clock_timestamp()
    WHERE "operationKey"=${key} AND status='STARTED' AND "requestHash"=${hash}`)
  if(completed!==1) throw new GroupCancellationError('reschedule completion fence failed')
  return {appointmentIds:members.map(m=>m.appointmentId),moves:receipt.moves,replayed:false}
}
export type RuntimeManagementContext = { businessId: string; sessionId: string; canonicalPhone: string; expectedRevision: bigint }
const managementRecord = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exactManagementKeys = (value: Record<string,unknown>, expected: readonly string[]) => Object.keys(value).sort().join(',') === [...expected].sort().join(',')

/** Load server-persisted booking authority, not an appointment ID proposed by a customer/model.
 * Original booking proof is immutable; current terms/versions come from the locked aggregate.
 * The caller owns this transaction and its current runtime/CAS guards. No effects or consent here.
 */
export async function loadOwnConfirmedRuntimeGroupSnapshot(tx: Tx, context: RuntimeManagementContext): Promise<CancellationSnapshot> {
  if (!managementRecord(context) || !exactManagementKeys(context,['businessId','sessionId','canonicalPhone','expectedRevision']) ||
      typeof context.expectedRevision !== 'bigint' || context.expectedRevision < 0n || !/^[0-9]{10,15}$/.test(context.canonicalPhone)) throw new GroupCancellationError('invalid current management scope')
  managementIdentifier(context.businessId); managementIdentifier(context.sessionId)
  const sessions = await tx.$queryRaw<Array<{phone:string;customerId:string;state:unknown}>>(Prisma.sql`
    SELECT co.phone,c.id AS "customerId",bs.state FROM "BotSession" bs
    JOIN "Conversation" co ON co.id=bs."conversationId" AND co."businessId"=bs."businessId"
    JOIN "Customer" c ON c."businessId"=bs."businessId" AND c."normalizedPhone"=${context.canonicalPhone}
    WHERE bs.id=${context.sessionId} AND bs."businessId"=${context.businessId} AND bs.revision=${context.expectedRevision} AND bs.status='ACTIVE'
    FOR UPDATE OF bs,co FOR SHARE OF c`)
  const session=sessions[0]
  if (sessions.length!==1 || !session || !/^\+?[\d\s().-]+$/.test(session.phone) || normalizePhone(session.phone)!==context.canonicalPhone ||
      !managementRecord(session.state) || session.state.booking!=='CONFIRMED' || session.state.deposit!=='NONE' || session.state.handoff!=='NONE' ||
      !managementRecord(session.state.conversationDraft) || !managementRecord(session.state.conversationDraft.dialogue) || session.state.conversationDraft.dialogue.businessId!==context.businessId) throw new GroupCancellationError('current management ownership unavailable')
  let reservation: ReturnType<typeof parseRuntimeBookingReservation>
  try { reservation=parseRuntimeBookingReservation(session.state.conversationDraft.dialogue.bookingReservation ?? session.state.conversationDraft.dialogue.completedBooking,context.businessId) }
  catch { throw new GroupCancellationError('invalid confirmed runtime receipt') }
  const presented=reservation.presented,receipt=reservation.receipt
  if (!receipt || presented.scope.sessionId!==context.sessionId) throw new GroupCancellationError('runtime receipt scope mismatch')
  managementIdentifier(receipt.coordinationGroupId)
  const appointmentIds=new Set<string>(),visitIds=new Set<string>()
  for (const member of receipt.appointments) {
    managementIdentifier(member.appointmentId); managementIdentifier(member.visitId)
    appointmentIds.add(member.appointmentId); visitIds.add(member.visitId)
  }
  const scope:ManagementScope={businessId:context.businessId,sessionId:context.sessionId,customerId:session.customerId,normalizedPhone:context.canonicalPhone}
  const snapshot=await lockManagedGroup(tx,scope,receipt.appointments[0]!.appointmentId)
  assertCancellationSnapshot(snapshot)
  if (snapshot.groupId!==receipt.coordinationGroupId || snapshot.members.length!==receipt.appointments.length || snapshot.members.some(m=>!appointmentIds.has(m.appointmentId))) throw new GroupCancellationError('runtime receipt group membership mismatch')
  const parents=await tx.$queryRaw<Array<{operationKey:string;businessId:string;sessionId:string;type:string;status:string;requestHash:string}>>(Prisma.sql`
    SELECT "operationKey","businessId","sessionId",type,status,"requestHash" FROM "BotOperation"
    WHERE "resultRef"=${receipt.coordinationGroupId} AND type='CONFIRM_VISIT' ORDER BY "operationKey" FOR UPDATE`)
  const parent=parents[0], prefix='conversation-booking:',suffix=':'+presented.nonce, original=presented.scope
  const requestHash=runtimeBookingRequestHash({ ...original,kind:'RUNTIME',canonicalPhone:context.canonicalPhone,
    revision:BigInt(original.revision),operationKey:parent?.operationKey ?? '',newBookingAllowed:false },presented)
  if (parents.length!==1 || !parent || parent.businessId!==context.businessId || parent.sessionId!==context.sessionId || parent.type!=='CONFIRM_VISIT' ||
      parent.status!=='COMPLETED' || parent.requestHash!==requestHash || !parent.operationKey.startsWith(prefix) || !parent.operationKey.endsWith(suffix)) throw new GroupCancellationError('runtime parent receipt mismatch')
  managementIdentifier(parent.operationKey.slice(prefix.length,-suffix.length))
  const childPrefix=parent.operationKey+':segment:'
  const children=await tx.$queryRaw<Array<{operationKey:string;businessId:string;sessionId:string;type:string;status:string;requestHash:string;resultRef:string|null}>>(Prisma.sql`
    SELECT "operationKey","businessId","sessionId",type,status,"requestHash","resultRef" FROM "BotOperation"
    WHERE left("operationKey",length(${childPrefix}))=${childPrefix} ORDER BY "operationKey" FOR UPDATE`)
  if (children.length!==receipt.appointments.length) throw new GroupCancellationError('runtime child receipt membership mismatch')
  for (const [index,entry] of receipt.appointments.entries()) {
    const segment=presented.terms.segments[index]!, member=snapshot.members.find(m=>m.appointmentId===entry.appointmentId)
    const key=childPrefix+index+':CONFIRM_VISIT',child=children.find(c=>c.operationKey===key)
    // Pure shared projection only; false never confers a new-booking capability.
    const childRequestHash=runtimeBookingChildRequestHash(runtimeBookingChildInput(presented,parent.operationKey,index,false))
    if (!child || child.businessId!==context.businessId || child.sessionId!==context.sessionId || child.type!=='CONFIRM_VISIT' || child.status!=='COMPLETED' ||
        child.requestHash!==childRequestHash || child.resultRef!==entry.visitId || !member || member.visitId!==entry.visitId || member.professionalId!==segment.professionalId ||
        !isDeepStrictEqual(member.serviceIds,[segment.serviceId]) || member.durationMinutes!==segment.durationMinutes || member.quotedPrice!==(segment.priceMode==='FIXED'?segment.priceMinor:null)) throw new GroupCancellationError('runtime child receipt mismatch')
  }
  const visits=await tx.$queryRaw<Array<{id:string;sessionId:string}>>(Prisma.sql`SELECT id,"sessionId" FROM "BookingVisit" WHERE id IN (${Prisma.join([...visitIds])}) ORDER BY id FOR UPDATE`)
  if (visits.length!==visitIds.size || visits.some(v=>!visitIds.has(v.id) || v.sessionId!==context.sessionId)) throw new GroupCancellationError('runtime visit session mismatch')
  return snapshot
}
/** Cancellation handoff only: approved deposits are read, never canceled or edited. */
export async function loadOwnConfirmedCancellationHandoffSnapshot(tx: Tx, context: RuntimeManagementContext): Promise<CancellationSnapshot> {
  if (!managementRecord(context) || !exactManagementKeys(context,['businessId','sessionId','canonicalPhone','expectedRevision']) ||
      typeof context.expectedRevision !== 'bigint' || context.expectedRevision < 0n || !/^[0-9]{10,15}$/.test(context.canonicalPhone)) throw new GroupCancellationError('invalid current handoff scope')
  managementIdentifier(context.businessId); managementIdentifier(context.sessionId)
  const sessions=await tx.$queryRaw<Array<{phone:string;customerId:string;state:unknown}>>(Prisma.sql`
    SELECT co.phone,c.id AS "customerId",bs.state FROM "BotSession" bs
    JOIN "Conversation" co ON co.id=bs."conversationId" AND co."businessId"=bs."businessId"
    JOIN "Customer" c ON c."businessId"=bs."businessId" AND c."normalizedPhone"=${context.canonicalPhone}
    WHERE bs.id=${context.sessionId} AND bs."businessId"=${context.businessId} AND bs.revision=${context.expectedRevision} AND bs.status='ACTIVE'
    FOR UPDATE OF bs,co FOR SHARE OF c`)
  const session=sessions[0]
  if (sessions.length!==1 || !session || normalizePhone(session.phone)!==context.canonicalPhone ||
      !managementRecord(session.state) || session.state.booking!=='CONFIRMED' || session.state.handoff!=='NONE') throw new GroupCancellationError('current handoff ownership unavailable')
  if (session.state.deposit==='NONE') return loadOwnConfirmedRuntimeGroupSnapshot(tx,context)
  if (session.state.deposit!=='APPROVED' || !managementRecord(session.state.conversationDraft) ||
      !managementRecord(session.state.conversationDraft.dialogue)) throw new GroupCancellationError('approved deposit handoff unavailable')
  let reservation: ReturnType<typeof parseRuntimeBookingReservation>
  try { reservation=parseRuntimeBookingReservation(session.state.conversationDraft.dialogue.bookingReservation ?? session.state.conversationDraft.dialogue.completedBooking,context.businessId) }
  catch { throw new GroupCancellationError('invalid approved runtime receipt') }
  const receipt=reservation.receipt
  if (receipt?.kind!=='HELD' || receipt.depositStatus!=='APPROVED' || reservation.presented.scope.sessionId!==context.sessionId) throw new GroupCancellationError('approved receipt mismatch')
  const actual=await loadRuntimeDepositReceipt(tx,{businessId:context.businessId,sessionId:context.sessionId,
    canonicalPhone:context.canonicalPhone,expectedRevision:context.expectedRevision},reservation)
  if (actual?.depositStatus!=='APPROVED' || actual.coordinationGroupId!==receipt.coordinationGroupId) throw new GroupCancellationError('approved deposit not verified')
  const scope:ManagementScope={businessId:context.businessId,sessionId:context.sessionId,customerId:session.customerId,normalizedPhone:context.canonicalPhone}
  const snapshot=await lockManagedGroup(tx,scope,receipt.appointments[0]!.appointmentId)
  assertCancellationSnapshot(snapshot)
  if (snapshot.groupId!==receipt.coordinationGroupId || snapshot.members.length!==receipt.appointments.length ||
      !snapshot.members.some(member=>member.depositId===receipt.depositId && member.depositStatus==='APPROVED') ||
      receipt.appointments.some((entry,index)=>{
        const member=snapshot.members.find(item=>item.appointmentId===entry.appointmentId),segment=reservation.presented.terms.segments[index]
        return !member || !segment || member.visitId!==entry.visitId || member.professionalId!==segment.professionalId ||
          !isDeepStrictEqual(member.serviceIds,[segment.serviceId]) || member.durationMinutes!==segment.durationMinutes
      })) throw new GroupCancellationError('approved group membership changed')
  return snapshot
}
/** Read-only candidate construction. Reader is server-owned and queried for each actual assignment.
 * These offers are not effects authority; C2 rechecks live policy and snapshots in the caller transaction.
 */
export async function prepareGroupRescheduleOffers(snapshot: CancellationSnapshot, date: string,
  reader: ManagementAvailabilityReader): Promise<readonly ManagementRescheduleOffer[]> {
  assertCancellationSnapshot(snapshot); assertManagementDate(date)
  const members = [...snapshot.members].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.appointmentId.localeCompare(b.appointmentId))
  const options = await Promise.all(members.map(async member => {
    const slots = await reader(structuredClone(member), date)
    if (!Array.isArray(slots) || slots.length > 1000) throw new GroupCancellationError('invalid assignment availability bound')
    for (const slot of slots) {
      if (slot.date !== date || !Number.isFinite(Date.parse(slot.startAt)) || new Date(slot.startAt).toISOString() !== slot.startAt ||
        slot.professionalId !== member.professionalId || !isDeepStrictEqual(slot.serviceIds, member.serviceIds) ||
        slot.durationMinutes !== member.durationMinutes || slot.customerDurationMinutes !== (member.customerDurationMinutes ?? member.durationMinutes)) throw new GroupCancellationError('assignment availability proof mismatch')
    }
    return slots
  }))
  const offers: ManagementRescheduleOffer[] = [], seen = new Set<string>()
  for (const slot of options[0]!) {
    const delta = Date.parse(slot.startAt) - Date.parse(members[0]!.startAt)
    const moves = snapshot.members.map(member => ({ appointmentId: member.appointmentId, newStartAt: new Date(Date.parse(member.startAt) + delta).toISOString() }))
    if (!members.every((member, index) => options[index]!.some(option => option.startAt === moves.find(move => move.appointmentId === member.appointmentId)!.newStartAt))) continue
    // Only a known conservative C2 rejection excludes a candidate; reader/shape errors propagate.
    try { assertGroupMoves(snapshot, moves) }
    catch (error) { if (error instanceof GroupCancellationError) continue; throw error }
    const key = managementRescheduleOfferKey(snapshot, date, moves)
    if (!seen.has(key)) { offers.push({ key, date, moves }); seen.add(key) }
    if (offers.length === 10) break
  }
  return offers
}
