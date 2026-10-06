import { createHash, randomUUID } from 'node:crypto'

/** Trusted runtime identity only. Simulator identities do not satisfy this contract. */
export type ManagementScope = { businessId: string; customerId: string; sessionId: string; normalizedPhone: string }
export type CancellationMember = {
  appointmentId: string; version: number; status: string; visitId: string | null; visitVersion: number | null; visitStatus: string | null
  professionalId: string; serviceIds: readonly string[]; startAt: string; durationMinutes: number; customerDurationMinutes?: number; quotedPrice: number | null
  depositId: string | null; depositStatus: string | null; manualDepositPaid: boolean; manualDepositAmount: number | null
}
export type CancellationSnapshot = { scope: ManagementScope; groupId: string | null; dbNow: string; members: readonly CancellationMember[] }
/** Separate from the prospective booking draft and its confirmation nonce. */
export type GroupCancellationProposal = { kind: 'GROUP_CANCELLATION_PROPOSAL'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot }
export type GroupCancellationCommand = { kind: 'CANCEL_APPOINTMENT_GROUP'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot; confirmed: true }

export class GroupCancellationError extends Error {
  constructor(message: string) { super(message); this.name = 'GroupCancellationError' }
}
export function managementIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 128 || /[\u0000-\u001f]/u.test(value)) throw new GroupCancellationError('invalid management identifier')
}
export function assertManagementScope(scope: ManagementScope) {
  for (const value of [scope.businessId, scope.customerId, scope.sessionId]) managementIdentifier(value)
  if (!/^[0-9]{8,15}$/.test(scope.normalizedPhone)) throw new GroupCancellationError('management requires a real normalized phone')
}
function instant(value: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new GroupCancellationError('invalid management instant')
  return Date.parse(value)
}
export function assertCancellationSnapshot(snapshot: CancellationSnapshot, cancelled = false, requireFuture = true) {
  assertManagementScope(snapshot.scope)
  const now = instant(snapshot.dbNow)
  if (snapshot.groupId !== null) managementIdentifier(snapshot.groupId)
  if (!snapshot.members.length || snapshot.members.length > 20) throw new GroupCancellationError('invalid group cardinality')
  if (snapshot.groupId === null && snapshot.members.length !== 1) throw new GroupCancellationError('ungrouped cancellation must be a singleton')
  const ids = new Set<string>(), visits = new Set<string>()
  for (const member of snapshot.members) {
    managementIdentifier(member.appointmentId); managementIdentifier(member.professionalId)
    if (ids.has(member.appointmentId)) throw new GroupCancellationError('duplicate group member')
    ids.add(member.appointmentId)
    if (!Number.isSafeInteger(member.version) || member.version < 0) throw new GroupCancellationError('invalid appointment version')
    if (member.status !== (cancelled ? 'CANCELLED' : 'CONFIRMED')) throw new GroupCancellationError('management requires confirmed appointments')
    if (!cancelled && requireFuture && instant(member.startAt) <= now) throw new GroupCancellationError('appointment must be future')
    instant(member.startAt)
    if (!Number.isSafeInteger(member.durationMinutes) || member.durationMinutes <= 0) throw new GroupCancellationError('invalid duration')
    if (member.customerDurationMinutes !== undefined && (!Number.isSafeInteger(member.customerDurationMinutes) || member.customerDurationMinutes < member.durationMinutes)) throw new GroupCancellationError('invalid customer duration')
    if (!member.serviceIds.length || new Set(member.serviceIds).size !== member.serviceIds.length) throw new GroupCancellationError('invalid services')
    member.serviceIds.forEach(managementIdentifier)
    if (member.visitId === null ? member.visitVersion !== null || member.visitStatus !== null :
      !Number.isSafeInteger(member.visitVersion) || member.visitVersion === null || member.visitVersion < 0 ||
      member.visitStatus !== (cancelled ? 'CANCELLED' : 'CONFIRMED')) throw new GroupCancellationError('incoherent visit snapshot')
    if (member.visitId !== null) {
      managementIdentifier(member.visitId)
      if (visits.has(member.visitId)) throw new GroupCancellationError('duplicate visit')
      visits.add(member.visitId)
    }
    if (member.depositId === null ? member.depositStatus !== null : !member.depositStatus) throw new GroupCancellationError('incoherent financial snapshot')
    if (member.depositId !== null) managementIdentifier(member.depositId)
    for (const money of [member.quotedPrice, member.manualDepositAmount]) if (money !== null && (!Number.isSafeInteger(money) || money < 0)) throw new GroupCancellationError('invalid financial amount')
    if (typeof member.manualDepositPaid !== 'boolean') throw new GroupCancellationError('invalid manual deposit flag')
  }
}
export function cancellationFingerprint(snapshot: CancellationSnapshot): string {
  assertCancellationSnapshot(snapshot)
  return createHash('sha256').update(JSON.stringify({ scope: snapshot.scope, groupId: snapshot.groupId,
    members: [...snapshot.members].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId)) })).digest('hex')
}
export function presentGroupCancellation(snapshot: CancellationSnapshot): GroupCancellationProposal {
  return { kind: 'GROUP_CANCELLATION_PROPOSAL', nonce: randomUUID(), fingerprint: cancellationFingerprint(snapshot), snapshot: structuredClone(snapshot) }
}
export function confirmGroupCancellation(proposal: GroupCancellationProposal, consent: { nonce: string; fingerprint: string }): GroupCancellationCommand {
  managementIdentifier(proposal.nonce)
  if (proposal.kind !== 'GROUP_CANCELLATION_PROPOSAL' || proposal.fingerprint !== cancellationFingerprint(proposal.snapshot)) throw new GroupCancellationError('proposal fingerprint mismatch')
  if (consent.nonce !== proposal.nonce || consent.fingerprint !== proposal.fingerprint) throw new GroupCancellationError('current management consent required')
  return { kind: 'CANCEL_APPOINTMENT_GROUP', nonce: proposal.nonce, fingerprint: proposal.fingerprint, snapshot: structuredClone(proposal.snapshot), confirmed: true }
}

export type GroupMove = { appointmentId: string; newStartAt: string }
export type GroupRescheduleProposal = { kind: 'GROUP_RESCHEDULE_PROPOSAL'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot; moves: readonly GroupMove[] }
export type GroupRescheduleCommand = { kind: 'RESCHEDULE_APPOINTMENT_GROUP'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot; moves: readonly GroupMove[]; confirmed: true }

/** Conservative scope: retain assignments and never cross another member's original interval. */
export function assertGroupMoves(snapshot: CancellationSnapshot, moves: readonly GroupMove[]) {
  assertCancellationSnapshot(snapshot)
  if (moves.length !== snapshot.members.length || new Set(moves.map(m=>m.appointmentId)).size !== moves.length ||
    moves.some(m=>!snapshot.members.some(member=>member.appointmentId===m.appointmentId))) throw new GroupCancellationError('reschedule coverage mismatch')
  const intervals=moves.map(move=>{
    const member=snapshot.members.find(m=>m.appointmentId===move.appointmentId)!
    const start=instant(move.newStartAt)
    if(start<=instant(snapshot.dbNow) || move.newStartAt===member.startAt) throw new GroupCancellationError('reschedule must be future and changed')
    return {id:move.appointmentId,start,end:start+Math.max(member.durationMinutes,member.customerDurationMinutes ?? member.durationMinutes)*60000}
  })
  for(const [index,interval] of intervals.entries()) {
    for(const other of intervals.slice(index+1)) if(interval.start<other.end && other.start<interval.end) throw new GroupCancellationError('new group intervals overlap')
    for(const original of snapshot.members) {
      if(original.appointmentId===interval.id) continue
      const start=instant(original.startAt), end=start+Math.max(original.durationMinutes,original.customerDurationMinutes ?? original.durationMinutes)*60000
      if(interval.start<end && start<interval.end) throw new GroupCancellationError('target crosses another original interval; shifts/swaps unsupported')
    }
  }
}
export function rescheduleFingerprint(snapshot: CancellationSnapshot, moves: readonly GroupMove[]) {
  assertGroupMoves(snapshot,moves)
  return createHash('sha256').update(JSON.stringify({snapshot:cancellationFingerprint(snapshot),
    moves:[...moves].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId))})).digest('hex')
}
export function presentGroupReschedule(snapshot: CancellationSnapshot, moves: readonly GroupMove[]): GroupRescheduleProposal {
  return {kind:'GROUP_RESCHEDULE_PROPOSAL',nonce:randomUUID(),fingerprint:rescheduleFingerprint(snapshot,moves),snapshot:structuredClone(snapshot),moves:structuredClone(moves)}
}
export function confirmGroupReschedule(proposal: GroupRescheduleProposal, consent: {nonce:string;fingerprint:string}): GroupRescheduleCommand {
  managementIdentifier(proposal.nonce)
  if(proposal.kind!=='GROUP_RESCHEDULE_PROPOSAL' || proposal.fingerprint!==rescheduleFingerprint(proposal.snapshot,proposal.moves)) throw new GroupCancellationError('reschedule fingerprint mismatch')
  if(consent.nonce!==proposal.nonce || consent.fingerprint!==proposal.fingerprint) throw new GroupCancellationError('current management consent required')
  return {...structuredClone(proposal),kind:'RESCHEDULE_APPOINTMENT_GROUP',confirmed:true}
}
