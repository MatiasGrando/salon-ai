import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireBusinessAgendaLock, acquireAgendaHierarchy, lockAppointmentRows } from '../services/agenda-locks.js'
import { normalizePhone } from '../services/phone-normalization-service.js'
import { cancelManageableAppointmentInTransaction, type CancelManageableAppointmentInput, type CancelManageableAppointmentResult } from '../bot-options/application/appointment-management.js'
import { assertManagementScope, assertCancellationSnapshot, cancellationFingerprint, managementIdentifier, GroupCancellationError, type CancellationSnapshot, type GroupCancellationCommand, type ManagementScope } from './appointment-management.js'

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
    professionalId: row.professionalId, serviceIds: row.serviceIds, startAt: iso(row.startAt), durationMinutes: row.durationMinutes, quotedPrice: row.quotedPrice,
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
  const key='cancel-group:'+digest([scope,command.nonce,command.fingerprint]), hash=digest(command)
  await acquireBusinessAgendaLock(tx,scope.businessId)
  const current=await readSnapshot(tx,scope,members[0]!.appointmentId)
  await acquireAgendaHierarchy(tx,{businessId:scope.businessId,professionalIds:current.members.map(m=>m.professionalId)})
  await lockAppointmentRows(tx,{businessId:scope.businessId,appointmentIds:current.members.map(m=>m.appointmentId)})
  await tx.$queryRaw(Prisma.sql`SELECT v.id FROM "BookingVisit" v WHERE v.id IN (${Prisma.join(current.members.flatMap(m=>m.visitId?[m.visitId]:[]).concat(['']))}) ORDER BY v.id FOR UPDATE OF v`)
  await tx.$queryRaw(Prisma.sql`SELECT d.id FROM "BookingDeposit" d WHERE d."appointmentId" IN (${Prisma.join(current.members.map(m=>m.appointmentId))}) ORDER BY d.id FOR UPDATE OF d`)
  const locked=await readSnapshot(tx,scope,members[0]!.appointmentId)
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
