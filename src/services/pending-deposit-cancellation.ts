import {lockInstagramRuntimeActorTx,validRuntimeChannelIdentity,type RuntimeChannelIdentity} from '../conversational-bot/conversation-subject.js'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { canonicalJsonHash } from '../conversational-bot/canonical-json.js'
import { acquireAgendaHierarchy } from './agenda-locks.js'
import { lockCoordinatedDepositGroupForAppointment } from './coordinated-deposit-group.js'
import { resolveBusinessScope, type BusinessAuthorizationUser } from './business-authorization.js'
import { staffCanUseProfessional, type StaffAuthorizationUser } from './staff-permission-service.js'

export type PendingDepositCancellationActor =
  | ({ kind: 'CUSTOMER'; sessionId: string; expectedRevision: bigint;
      expectedReceipt: { groupId: string; operationKey: string; proposalNonce: string; fingerprint: string } } & RuntimeChannelIdentity)
  | { kind: 'STAFF'; user: BusinessAuthorizationUser & StaffAuthorizationUser }
export type PendingDepositCancellationMember = {
  appointmentId: string; visitId: string; professionalId: string; appointmentVersion: number; visitVersion: number;
  depositId: string | null; amount: number | null; expiresAt: string | null; holdExpiresAt: string
}
export type PendingDepositCancellationSnapshot = {
  version: 1; businessId: string; appointmentId: string; groupId: string | null; sessionId: string;
  actor: { kind: 'CUSTOMER' | 'STAFF'; id: string }; members: PendingDepositCancellationMember[];
  receipt: Record<string, unknown> | null;
  fingerprint: string
}
export class PendingDepositCancellationError extends Error {
  constructor(public readonly code: 'NOT_ELIGIBLE' | 'OWNERSHIP' | 'CONSENT' | 'STALE' | 'UNCERTAIN') {
    super('Pending deposit cancellation: ' + code); this.name = 'PendingDepositCancellationError'
  }
}
const fail = (code: PendingDepositCancellationError['code']): never => { throw new PendingDepositCancellationError(code) }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v)
const iso = (v: unknown) => { try { return (v instanceof Date ? v : new Date(String(v))).toISOString() } catch { return fail('UNCERTAIN') } }
const actorIdentity = (a: PendingDepositCancellationActor) => ({ kind: a.kind, id: a.kind === 'CUSTOMER' ? a.sessionId : a.user.id })
const requestHash = (snapshot: PendingDepositCancellationSnapshot) => canonicalJsonHash({ action: 'CANCEL_PENDING_DEPOSIT_GROUP', snapshot, confirmed: true })
type MemberRow = PendingDepositCancellationMember & {
  businessId: string; customerId: string; visitBusinessId: string; visitCustomerId: string; visitProfessionalId: string;
  sessionId: string; appointmentStatus: string; visitStatus: string; depositStatus: string | null;
  depositBusinessId: string | null; depositVisitId: string | null; snapshotSealedAt: Date | null; dbNow: Date
}
async function authorizeStaff(tx: Prisma.TransactionClient, businessId: string, actor: PendingDepositCancellationActor) {
  if (actor.kind !== 'STAFF') return
  const user = actor.user
  if (!text(user.id) || user.role === 'STAFF' && user.canCancelAppointments !== true) fail('OWNERSHIP')
  const scope = resolveBusinessScope(user)
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT b.id FROM "Business" b JOIN "User" u ON u.id=${user.id} AND u.role::text=${user.role}
    WHERE b.id=${businessId} AND ${scope.kind === 'all' ? Prisma.sql`true` : scope.kind === 'assigned'
      ? Prisma.sql`b."accountAdminId"=${scope.userId}` : Prisma.sql`b.id=${scope.businessId}`}
    FOR SHARE OF b,u`)
  if (rows.length !== 1) fail('OWNERSHIP')
}
async function memberRows(tx: Prisma.TransactionClient, businessId: string, appointmentId: string) {
  await acquireAgendaHierarchy(tx, { businessId, professionalIds: [] })
  const anchor = await tx.$queryRaw<Array<{ groupId: string | null }>>(Prisma.sql`
    /* pending-cancel-anchor */ SELECT "coordinationGroupId" AS "groupId" FROM "Appointment" WHERE id=${appointmentId} AND "businessId"=${businessId}`)
  if (anchor.length !== 1) fail('OWNERSHIP')
  const groupId = anchor[0]!.groupId
  const ids = await tx.$queryRaw<Array<{ id: string; professionalId: string; businessId: string }>>(Prisma.sql`
    /* pending-cancel-member-ids */ SELECT id,"professionalId","businessId" FROM "Appointment"
    WHERE ${groupId ? Prisma.sql`"coordinationGroupId"=${groupId}` : Prisma.sql`id=${appointmentId}`} ORDER BY id`)
  if (!ids.length || ids.length > 8 || ids.some(r => r.businessId !== businessId)) fail('UNCERTAIN')
  await acquireAgendaHierarchy(tx, { businessId, professionalIds: ids.map(r => r.professionalId) })
  const rows = await tx.$queryRaw<MemberRow[]>(Prisma.sql`
    /* pending-cancel-members */ SELECT a.id AS "appointmentId",a."visitId",a."professionalId",a."businessId",a."customerId",a.version AS "appointmentVersion",a.status AS "appointmentStatus",
      v."businessId" AS "visitBusinessId",v."customerId" AS "visitCustomerId",v."professionalId" AS "visitProfessionalId",v."sessionId",v.version AS "visitVersion",v.status AS "visitStatus",v."holdExpiresAt",
      d.id AS "depositId",d."businessId" AS "depositBusinessId",d."visitId" AS "depositVisitId",d.amount,d."expiresAt",d.status AS "depositStatus",d."snapshotSealedAt",clock_timestamp() AS "dbNow"
    FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
    WHERE a.id IN (${Prisma.join(ids.map(r => r.id))}) ORDER BY a.id FOR UPDATE OF a,v`)
  if (rows.length !== ids.length || rows.some(r => r.businessId !== businessId || r.visitBusinessId !== businessId ||
    r.visitCustomerId !== r.customerId || r.visitProfessionalId !== r.professionalId || r.sessionId !== rows[0]!.sessionId || r.customerId !== rows[0]!.customerId ||
    r.depositId && (r.depositBusinessId !== businessId || r.depositVisitId !== r.visitId || !r.snapshotSealedAt))) fail('UNCERTAIN')
  const depositIds = rows.flatMap(r => r.depositId ? [r.depositId] : [])
  if (!depositIds.length) fail('NOT_ELIGIBLE')
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "BookingDeposit" WHERE id IN (${Prisma.join(depositIds)}) ORDER BY id FOR UPDATE`)
  return { rows, groupId }
}
async function currentCustomerReceipt(tx: Prisma.TransactionClient, businessId: string, rows: MemberRow[], actor: PendingDepositCancellationActor) {
  if (actor.kind !== 'CUSTOMER') return null
  if (!text(actor.sessionId) || !validRuntimeChannelIdentity(actor) || typeof actor.expectedRevision !== 'bigint' || actor.expectedRevision < 0n) fail('OWNERSHIP')
  const instagramActor=actor.subject?await lockInstagramRuntimeActorTx(tx,{businessId,sessionId:actor.sessionId,subject:actor.subject,revision:actor.expectedRevision}):null
  const found = await tx.$queryRaw<Array<{ state: unknown; generation: number; configurationId: string; deploymentId: string; dispatchFenceEpoch: number; handoffFenceEpoch: number }>>(Prisma.sql`
    /* pending-cancel-session */ SELECT s.state,d.generation,d."activeConfigurationId" AS "configurationId",s."deploymentId",d."dispatchFenceEpoch",s."handoffFenceEpoch"
    FROM "BotSession" s ${actor.subject?Prisma.empty:Prisma.sql`JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"`}
    JOIN "Customer" customer ON customer.id=${rows[0]!.customerId} AND customer."businessId"=s."businessId"
    JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=s."businessId"
    JOIN "Business" b ON b.id=s."businessId"
    WHERE s.id=${actor.sessionId} AND s.id=${rows[0]!.sessionId} AND s."businessId"=${businessId} AND s.revision=${actor.expectedRevision}
      AND s.status='ACTIVE' AND s."handoffClaimsPausedAt" IS NULL AND d."claimsPausedAt" IS NULL AND cfg.status='ACTIVE'
      AND s."deploymentGeneration"=d.generation AND d.channel=${actor.subject?'INSTAGRAM':'WHATSAPP'}::"BotChannel" AND d."legacyDispatchCoverageVersion">=1 AND b."botEnabled"=true
      AND d."engineKey"='deterministic-options' AND cfg.definition->'conversation'='{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb
      AND ${actor.subject?Prisma.sql`${instagramActor?.customerId===rows[0]!.customerId}`:Prisma.sql`customer."normalizedPhone"=${actor.canonicalPhone} AND regexp_replace(c.phone,'[^0-9]','','g')=${actor.canonicalPhone}`}
    FOR UPDATE OF s FOR SHARE OF ${actor.subject?Prisma.sql`customer,d,cfg,b`:Prisma.sql`c,customer,d,cfg,b`}`)
  const row = found[0], state = row?.state
  if (found.length !== 1 || !row || !object(state) || state.booking !== 'HELD' || state.deposit !== 'PENDING_PROOF' || state.handoff !== 'NONE') fail('OWNERSHIP')
  const container = state.conversationDraft
  const dialogue = object(container) ? container.dialogue : null
  const reservation = object(dialogue) ? dialogue.bookingReservation : null
  const receipt = object(reservation) ? reservation.receipt : null
  const presented = object(reservation) ? reservation.presented : null
  const scope = object(presented) ? presented.scope : null
  if (!object(receipt) || !object(scope) || receipt.kind !== 'HELD' || receipt.depositStatus !== 'PENDING_PROOF' ||
    receipt.coordinationGroupId !== actor.expectedReceipt.groupId || receipt.operationKey !== actor.expectedReceipt.operationKey ||
    receipt.proposalNonce !== actor.expectedReceipt.proposalNonce || receipt.fingerprint !== actor.expectedReceipt.fingerprint ||
    scope.businessId !== businessId || scope.sessionId !== actor.sessionId || scope.deploymentId !== row.deploymentId ||
    scope.generation !== row.generation || scope.configurationId !== row.configurationId || scope.dispatchFenceEpoch !== row.dispatchFenceEpoch ||
    scope.handoffFenceEpoch !== row.handoffFenceEpoch || !/^\d+$/.test(String(scope.revision)) || BigInt(String(scope.revision)) > actor.expectedRevision ||
    !object(presented) || presented.nonce !== receipt.proposalNonce || presented.fingerprint !== receipt.fingerprint) fail('STALE')
  if (!Array.isArray(receipt.appointments) || !isDeepStrictEqual(receipt.appointments.map(m => object(m) ? m.appointmentId : null).sort(),rows.map(r => r.appointmentId).sort()) ||
    !rows.some(r => r.depositId === receipt.depositId)) fail('UNCERTAIN')
  return { ...actor.expectedReceipt, receiptHash: canonicalJsonHash(receipt), deploymentId: row.deploymentId, generation: row.generation,
    configurationId: row.configurationId, revision: String(actor.expectedRevision), dispatchFenceEpoch: row.dispatchFenceEpoch, handoffFenceEpoch: row.handoffFenceEpoch }
}
async function assertNoProofInFlight(tx: Prisma.TransactionClient, businessId: string, rows: MemberRow[], groupId: string | null) {
  const depositIds = rows.flatMap(r => r.depositId ? [r.depositId] : [])
  const proofs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    /* pending-cancel-proofs */ SELECT id FROM "BookingDepositProof" WHERE "businessId"=${businessId} AND "depositId" IN (${Prisma.join(depositIds)}) AND kind<>'LATE' FOR SHARE`)
  if (proofs.length) fail('NOT_ELIGIBLE')
  // Durable receipt work is distinct from the current cancellation PROCESS_INBOX job.
  // Lock the inbox rows; a worker must revalidate the cancelled financial state later.
  const jobs = await tx.$queryRaw<Array<{ id: string; binding: unknown }>>(Prisma.sql`
    /* pending-cancel-proof-jobs */ SELECT j.id,i."entityRef" AS binding FROM "BotJob" j JOIN "BotActionInbox" i ON (i."providerEventId"=j."aggregateId" OR i.id=j."aggregateId") AND i."businessId"=j."businessId"
    WHERE j."businessId"=${businessId} AND j.kind='RECEIVE_DEPOSIT_PROOF' AND j.status IN ('READY','RETRY','LEASED') AND i."sessionId"=${rows[0]!.sessionId}
      AND (i."entityRef"->>'depositId' IN (${Prisma.join(depositIds)}) OR i."entityRef"->>'coordinationGroupId'=${groupId})
    ORDER BY i.id FOR SHARE OF i`)
  if (jobs.length) fail('UNCERTAIN')
}
/** Read uncached under the same transaction used for cancellation/reset/output. No lifecycle writes. */
export async function loadPendingDepositCancellationTx(tx: Prisma.TransactionClient, input: {
  businessId: string; appointmentId: string; actor: PendingDepositCancellationActor
}): Promise<PendingDepositCancellationSnapshot> {
  if (!text(input.businessId) || !text(input.appointmentId) || !input.actor || !['STAFF','CUSTOMER'].includes(input.actor.kind)) fail('OWNERSHIP')
  await authorizeStaff(tx, input.businessId, input.actor)
  const { rows, groupId } = await memberRows(tx, input.businessId, input.appointmentId)
  if (input.actor.kind === 'STAFF' && rows.some(r => !staffCanUseProfessional(input.actor.kind === 'STAFF' ? input.actor.user : {} as never,r.professionalId))) fail('OWNERSHIP')
  if (rows.some(r => r.appointmentStatus !== 'PENDING' || r.visitStatus !== 'HELD' || !r.holdExpiresAt || new Date(r.holdExpiresAt).getTime() <= new Date(r.dbNow).getTime() ||
    r.depositId && (r.depositStatus !== 'PENDING_PROOF' || !r.expiresAt || iso(r.expiresAt) !== iso(r.holdExpiresAt)))) fail('NOT_ELIGIBLE')
  const authority = await lockCoordinatedDepositGroupForAppointment(tx, { businessId: input.businessId, appointmentId: input.appointmentId })
  if (groupId && rows.length > 1 && !authority || authority && authority.depositStatus !== 'PENDING_PROOF') fail('UNCERTAIN')
  const receipt = await currentCustomerReceipt(tx, input.businessId, rows, input.actor)
  if (authority && receipt && (receipt.operationKey !== authority.group.operationKey || receipt.proposalNonce !== authority.group.proposal.nonce || receipt.fingerprint !== authority.group.proposal.fingerprint)) fail('STALE')
  await assertNoProofInFlight(tx,input.businessId,rows,groupId)
  const content = { version: 1 as const, businessId: input.businessId, appointmentId: input.appointmentId, groupId, sessionId: rows[0]!.sessionId,
    actor: actorIdentity(input.actor), receipt, members: rows.map(r => ({ appointmentId: r.appointmentId, visitId: r.visitId, professionalId: r.professionalId,
      appointmentVersion: r.appointmentVersion, visitVersion: r.visitVersion, depositId: r.depositId, amount: r.amount,
      expiresAt: r.expiresAt ? iso(r.expiresAt) : null, holdExpiresAt: iso(r.holdExpiresAt) })) }
  return { ...content, fingerprint: canonicalJsonHash(content) }
}
/** Caller owns the transaction. Never swallow errors after a partial write. */
export async function cancelPendingDepositInTransaction(tx: Prisma.TransactionClient, input: {
  snapshot: PendingDepositCancellationSnapshot; actor: PendingDepositCancellationActor; confirmed: boolean; operationKey: string
}): Promise<{ outcome: 'CANCELLED'; appointmentIds: string[]; depositIds: string[]; replayed: boolean }> {
  if (input.confirmed !== true) fail('CONSENT')
  const snapshot = input.snapshot, { fingerprint, ...content } = snapshot
  if (!text(input.operationKey,256) || snapshot.version !== 1 || !/^[a-f0-9]{64}$/.test(fingerprint) ||
    fingerprint !== canonicalJsonHash(content) || !isDeepStrictEqual(snapshot.actor,actorIdentity(input.actor)) || JSON.stringify(snapshot).length > 16000) fail('STALE')
  await authorizeStaff(tx,snapshot.businessId,input.actor)
  await memberRows(tx,snapshot.businessId,snapshot.appointmentId)
  const existing = await tx.$queryRaw<Array<{ businessId: string; sessionId: string; status: string; requestHash: string; type: string; resultRef: string }>>(Prisma.sql`
    /* pending-cancel-operation */ SELECT "businessId","sessionId",status,"requestHash",type,"resultRef" FROM "BotOperation" WHERE "operationKey"=${input.operationKey} FOR UPDATE`)
  const appointmentIds = snapshot.members.map(m => m.appointmentId), depositIds = snapshot.members.flatMap(m => m.depositId ? [m.depositId] : [])
  if (existing.length) {
    const previous = existing[0]!
    if (existing.length !== 1 || previous.businessId !== snapshot.businessId || previous.sessionId !== snapshot.sessionId || previous.type !== 'CANCEL_PENDING_DEPOSIT_GROUP' ||
      previous.status !== 'COMPLETED' || previous.requestHash !== requestHash(snapshot)) fail('STALE')
    let result: unknown; try { result = JSON.parse(previous.resultRef) } catch { return fail('UNCERTAIN') }
    if (!object(result) || !isDeepStrictEqual(result.snapshot,snapshot)) fail('UNCERTAIN')
    const { rows } = await memberRows(tx,snapshot.businessId,snapshot.appointmentId)
    if (rows.length !== snapshot.members.length || rows.some(r => {
      const m = snapshot.members.find(x => x.appointmentId === r.appointmentId)
      return !m || r.appointmentStatus !== 'CANCELLED' || r.visitStatus !== 'CANCELLED' || r.appointmentVersion !== m.appointmentVersion + 1 ||
        r.visitVersion !== m.visitVersion + 1 || r.depositId !== m.depositId || r.depositId && r.depositStatus !== 'REJECTED'
    })) fail('UNCERTAIN')
    if (input.actor.kind === 'STAFF' && rows.some(r => !staffCanUseProfessional(input.actor.kind === 'STAFF' ? input.actor.user : {} as never,r.professionalId))) fail('OWNERSHIP')
    await lockCoordinatedDepositGroupForAppointment(tx,{businessId:snapshot.businessId,appointmentId:snapshot.appointmentId})
    return { outcome: 'CANCELLED', appointmentIds, depositIds, replayed: true }
  }
  const actual = await loadPendingDepositCancellationTx(tx,{ businessId: snapshot.businessId, appointmentId: snapshot.appointmentId, actor: input.actor })
  if (!isDeepStrictEqual(actual,snapshot)) fail('STALE')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash")
    VALUES (${randomUUID()},${input.operationKey},'CANCEL_PENDING_DEPOSIT_GROUP',${snapshot.businessId},${snapshot.sessionId},'STARTED',${requestHash(snapshot)})`)
  const auditIds: string[] = []
  for (const depositId of depositIds) {
    if (input.actor.kind === 'STAFF') {
      const id = randomUUID(); auditIds.push(id)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "StaffAuditLog" (id,"businessId","userId",action,"entityType","entityId",method,path)
        VALUES (${id},${snapshot.businessId},${input.actor.user.id},'CANCEL_PENDING_DEPOSIT_GROUP','BookingDeposit',${depositId},'DELETE','/appointments')`)
    }
    const reason = input.actor.kind === 'STAFF' ? 'CANCELLED_BY_STAFF' : 'CANCELLED_BY_CUSTOMER'
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET status='REJECTED',"reviewedAt"=clock_timestamp(),"rejectionReason"=${reason}
      WHERE id=${depositId} AND "businessId"=${snapshot.businessId} AND status='PENDING_PROOF'`)
    if (changed !== 1) fail('STALE')
  }
  for (const member of snapshot.members) {
    if (await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET status='CANCELLED',version=version+1,"updatedAt"=clock_timestamp()
      WHERE id=${member.visitId} AND "businessId"=${snapshot.businessId} AND status='HELD' AND version=${member.visitVersion}`) !== 1) fail('STALE')
    if (await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET status='CANCELLED',version=version+1
      WHERE id=${member.appointmentId} AND "businessId"=${snapshot.businessId} AND status='PENDING' AND version=${member.appointmentVersion}`) !== 1) fail('STALE')
  }
  await tx.$executeRaw(Prisma.sql`UPDATE "BotJob" SET status='DONE',"updatedAt"=clock_timestamp() WHERE id IN (
    SELECT id FROM "BotJob" WHERE "businessId"=${snapshot.businessId} AND kind='EXPIRE_DEPOSIT' AND "aggregateId" IN (${Prisma.join(depositIds)})
      AND status IN ('READY','RETRY') ORDER BY id FOR UPDATE SKIP LOCKED)`)
  const result = { version: 1, snapshot, appointmentIds, depositIds, auditIds }
  const completed = await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"resultRef"=${JSON.stringify(result)},"updatedAt"=clock_timestamp()
    WHERE "operationKey"=${input.operationKey} AND status='STARTED' AND "requestHash"=${requestHash(snapshot)}`)
  if (completed !== 1) fail('STALE')
  await lockCoordinatedDepositGroupForAppointment(tx,{businessId:snapshot.businessId,appointmentId:snapshot.appointmentId})
  return { outcome: 'CANCELLED', appointmentIds, depositIds, replayed: false }
}
