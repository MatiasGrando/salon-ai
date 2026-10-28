import { managementChannelIdentityRecord, type ManagementChannelIdentity } from './conversation-subject.js'
import { randomUUID } from 'node:crypto'
import { canonicalJsonHash } from './canonical-json.js'

/** Trusted runtime identity only. Simulator identities do not satisfy this contract. */
export type ManagementScope = { businessId: string; customerId: string; sessionId: string } & ManagementChannelIdentity
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
  try { managementChannelIdentityRecord(scope) } catch { throw new GroupCancellationError(scope.subject?'management requires a real channel identity':'management requires a real normalized phone') }
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
  return canonicalJsonHash({ scope: snapshot.scope, groupId: snapshot.groupId,
    members: [...snapshot.members].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId)) })
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

export type GroupMove = { appointmentId: string; newStartAt: string; newProfessionalId?: string }
export type GroupRescheduleProposal = { kind: 'GROUP_RESCHEDULE_PROPOSAL'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot; moves: readonly GroupMove[]; source?: 'own_lookup' }
export type GroupRescheduleCommand = { kind: 'RESCHEDULE_APPOINTMENT_GROUP'; nonce: string; fingerprint: string; snapshot: CancellationSnapshot; moves: readonly GroupMove[]; confirmed: true; source?: 'own_lookup' }

/** Keep every group member represented, even when only one professional changes. */
export function assertGroupMoves(snapshot: CancellationSnapshot, moves: readonly GroupMove[]) {
  assertCancellationSnapshot(snapshot)
  if (moves.length !== snapshot.members.length || new Set(moves.map(m=>m.appointmentId)).size !== moves.length ||
    moves.some(m=>!snapshot.members.some(member=>member.appointmentId===m.appointmentId))) throw new GroupCancellationError('reschedule coverage mismatch')
  if (!moves.some(move => {
    const member = snapshot.members.find(m => m.appointmentId === move.appointmentId)!
    return move.newStartAt !== member.startAt || move.newProfessionalId !== undefined
  })) throw new GroupCancellationError('reschedule must be changed')
  const intervals=moves.map(move=>{
    const member=snapshot.members.find(m=>m.appointmentId===move.appointmentId)!
    const start=instant(move.newStartAt)
    if (move.newProfessionalId !== undefined) {
      managementIdentifier(move.newProfessionalId)
      if (move.newProfessionalId === member.professionalId) throw new GroupCancellationError('unchanged professional must be omitted')
    }
    if(start<=instant(snapshot.dbNow)) throw new GroupCancellationError('reschedule must be future')
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
export function rescheduleFingerprint(snapshot: CancellationSnapshot, moves: readonly GroupMove[], source?: 'own_lookup') {
  if (source !== undefined && source !== 'own_lookup') throw new GroupCancellationError('invalid management source')
  assertGroupMoves(snapshot,moves)
  return canonicalJsonHash({snapshot:cancellationFingerprint(snapshot), ...(source ? {source} : {}),
    moves:[...moves].sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId))})
}
export function presentGroupReschedule(snapshot: CancellationSnapshot, moves: readonly GroupMove[], source?: 'own_lookup'): GroupRescheduleProposal {
  return {kind:'GROUP_RESCHEDULE_PROPOSAL',nonce:randomUUID(),fingerprint:rescheduleFingerprint(snapshot,moves,source),snapshot:structuredClone(snapshot),moves:structuredClone(moves),...(source ? {source} : {})}
}
export function confirmGroupReschedule(proposal: GroupRescheduleProposal, consent: {nonce:string;fingerprint:string}): GroupRescheduleCommand {
  managementIdentifier(proposal.nonce)
  if(proposal.kind!=='GROUP_RESCHEDULE_PROPOSAL' || proposal.fingerprint!==rescheduleFingerprint(proposal.snapshot,proposal.moves,proposal.source)) throw new GroupCancellationError('reschedule fingerprint mismatch')
  if(consent.nonce!==proposal.nonce || consent.fingerprint!==proposal.fingerprint) throw new GroupCancellationError('current management consent required')
  return {...structuredClone(proposal),kind:'RESCHEDULE_APPOINTMENT_GROUP',confirmed:true}
}
export type ManagementRescheduleOffer = { key: string; date: string; moves: readonly GroupMove[] }
/** Server-only sidecar: never a booking draft, model instruction, or effects capability. */
export type AppointmentManagementContext = {
  version: 1; action: 'CANCEL' | 'RESCHEDULE'; snapshot: CancellationSnapshot
  proposal?: GroupCancellationProposal | GroupRescheduleProposal; offers?: readonly ManagementRescheduleOffer[]; source?: 'own_lookup'
}
export type ManagementSlotEvidence = {
  date: string; startAt: string; professionalId: string; serviceIds: readonly string[]
  durationMinutes: number; customerDurationMinutes: number
}
export type ManagementAvailabilityReader = (member: CancellationMember, date: string, professionalId: string) => Promise<readonly ManagementSlotEvidence[]>
function managementRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GroupCancellationError('invalid management shape')
}
function managementKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new GroupCancellationError('invalid management keys')
}
export function assertManagementDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00.000Z')) || new Date(date + 'T00:00:00.000Z').toISOString().slice(0, 10) !== date) throw new GroupCancellationError('invalid management date')
}
function exactSnapshot(value: unknown): asserts value is CancellationSnapshot {
  managementRecord(value); managementKeys(value, ['scope', 'groupId', 'dbNow', 'members'])
  managementRecord(value.scope); managementKeys(value.scope, ['businessId', 'customerId', 'sessionId', value.scope.subject?'subject':'normalizedPhone'])
  if (!Array.isArray(value.members)) throw new GroupCancellationError('invalid group members')
  for (const member of value.members) {
    managementRecord(member)
    managementKeys(member, ['appointmentId', 'version', 'status', 'visitId', 'visitVersion', 'visitStatus', 'professionalId', 'serviceIds', 'startAt', 'durationMinutes', 'quotedPrice', 'depositId', 'depositStatus', 'manualDepositPaid', 'manualDepositAmount'], ['customerDurationMinutes'])
  }
  assertCancellationSnapshot(value as unknown as CancellationSnapshot)
}
export function managementRescheduleOfferKey(snapshot: CancellationSnapshot, date: string, moves: readonly GroupMove[]): string {
  assertManagementDate(date); assertGroupMoves(snapshot, moves)
  const offset = instant(moves[0]!.newStartAt) - instant(snapshot.members.find(member => member.appointmentId === moves[0]!.appointmentId)!.startAt)
  if (moves.some(move => instant(move.newStartAt) - instant(snapshot.members.find(member => member.appointmentId === move.appointmentId)!.startAt) !== offset)) throw new GroupCancellationError('group offer offsets changed')
  return canonicalJsonHash({ snapshot: cancellationFingerprint(snapshot), date, moves: [...moves].sort((a, b) => a.appointmentId.localeCompare(b.appointmentId)) })
}
function assertManagementOffers(snapshot: CancellationSnapshot, offers: unknown): asserts offers is readonly ManagementRescheduleOffer[] {
  if (!Array.isArray(offers) || offers.length > 10) throw new GroupCancellationError('invalid offers bound')
  const keys = new Set<string>()
  for (const offer of offers) {
    managementRecord(offer); managementKeys(offer, ['key', 'date', 'moves'])
    if (!Array.isArray(offer.moves)) throw new GroupCancellationError('invalid offer moves')
      for (const move of offer.moves) { managementRecord(move); managementKeys(move, ['appointmentId', 'newStartAt'], ['newProfessionalId']) }
    if (offer.key !== managementRescheduleOfferKey(snapshot, offer.date as string, offer.moves as GroupMove[])) throw new GroupCancellationError('offer fingerprint mismatch')
    if (keys.has(offer.key as string)) throw new GroupCancellationError('duplicate offer')
    keys.add(offer.key as string)
  }
}
export function parseAppointmentManagement(value: unknown, businessId: string, sessionId: string): AppointmentManagementContext {
  managementRecord(value); managementKeys(value, ['version', 'action', 'snapshot'], ['proposal', 'offers', 'source'])
  if (value.source !== undefined && (value.source !== 'own_lookup' || value.action !== 'RESCHEDULE')) throw new GroupCancellationError('invalid management source')
  if (JSON.stringify(value).length > 16384 || value.version !== 1 || !['CANCEL', 'RESCHEDULE'].includes(value.action as string)) throw new GroupCancellationError('invalid management context bound/action')
  exactSnapshot(value.snapshot)
  if (value.snapshot.scope.businessId !== businessId || value.snapshot.scope.sessionId !== sessionId) throw new GroupCancellationError('management scope mismatch')
  if (value.action === 'CANCEL' && (value.proposal === undefined || value.offers !== undefined)) throw new GroupCancellationError('invalid cancellation context')
  if (value.offers !== undefined) assertManagementOffers(value.snapshot, value.offers)
  if (value.proposal !== undefined) {
    const proposal = value.proposal
    managementRecord(proposal); managementKeys(proposal, ['kind', 'nonce', 'fingerprint', 'snapshot'], value.action === 'RESCHEDULE' ? ['moves', 'source'] : [])
    if (proposal.source !== value.source) throw new GroupCancellationError('management source mismatch')
    exactSnapshot(proposal.snapshot)
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(proposal.nonce as string) || canonicalJsonHash(proposal.snapshot) !== canonicalJsonHash(value.snapshot)) throw new GroupCancellationError('management proposal/snapshot mismatch')
    const consent = { nonce: proposal.nonce as string, fingerprint: proposal.fingerprint as string }
    if (value.action === 'CANCEL') confirmGroupCancellation(proposal as unknown as GroupCancellationProposal, consent)
    else {
      if (!Array.isArray(proposal.moves)) throw new GroupCancellationError('management selection required')
      for (const move of proposal.moves) { managementRecord(move); managementKeys(move, ['appointmentId', 'newStartAt'], ['newProfessionalId']) }
      confirmGroupReschedule(proposal as unknown as GroupRescheduleProposal, consent)
      if (!value.offers || !(value.offers as ManagementRescheduleOffer[]).some(offer => canonicalJsonHash(offer.moves) === canonicalJsonHash(proposal.moves))) throw new GroupCancellationError('management offer selection mismatch')
    }
  }
  return structuredClone(value) as unknown as AppointmentManagementContext
}
export function beginAppointmentManagement(action: AppointmentManagementContext['action'], snapshot: CancellationSnapshot, source?: 'own_lookup'): AppointmentManagementContext {
  const context: AppointmentManagementContext = { version: 1, action, snapshot: structuredClone(snapshot), ...(source ? {source} : {}), ...(action === 'CANCEL' ? { proposal: presentGroupCancellation(snapshot) } : {}) }
  return parseAppointmentManagement(context, snapshot.scope.businessId, snapshot.scope.sessionId)
}
export function attachManagementRescheduleOffers(context: AppointmentManagementContext, offers: readonly ManagementRescheduleOffer[]): AppointmentManagementContext {
  const current = parseAppointmentManagement(context, context.snapshot.scope.businessId, context.snapshot.scope.sessionId)
  if (current.action !== 'RESCHEDULE') throw new GroupCancellationError('reschedule context required')
  delete current.proposal
  current.offers = structuredClone(offers)
  return parseAppointmentManagement(current, current.snapshot.scope.businessId, current.snapshot.scope.sessionId)
}
export function selectManagementRescheduleOffer(context: AppointmentManagementContext, key: string): AppointmentManagementContext {
  const current = parseAppointmentManagement(context, context.snapshot.scope.businessId, context.snapshot.scope.sessionId)
  if (current.action !== 'RESCHEDULE') throw new GroupCancellationError('reschedule context required')
  const offer = current.offers?.find(item => item.key === key)
  if (!offer) throw new GroupCancellationError('current management offer selection required')
  current.proposal = presentGroupReschedule(current.snapshot, offer.moves, current.source)
  return parseAppointmentManagement(current, current.snapshot.scope.businessId, current.snapshot.scope.sessionId)
}
export function confirmAppointmentManagement(context: AppointmentManagementContext, consent: { nonce: string; fingerprint: string }): GroupCancellationCommand | GroupRescheduleCommand {
  const current = parseAppointmentManagement(context, context.snapshot.scope.businessId, context.snapshot.scope.sessionId)
  if (!current.proposal) throw new GroupCancellationError('management proposal selection required')
  return current.proposal.kind === 'GROUP_CANCELLATION_PROPOSAL' ? confirmGroupCancellation(current.proposal, consent) : confirmGroupReschedule(current.proposal, consent)
}
