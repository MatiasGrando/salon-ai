import assert from 'node:assert/strict'
import * as domain from '../src/conversational-bot/appointment-management.js'
import * as adapter from '../src/conversational-bot/prisma-appointment-management.js'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'
import type { CancellationSnapshot, GroupMove, GroupCancellationProposal, GroupRescheduleProposal, GroupCancellationCommand, GroupRescheduleCommand } from '../src/conversational-bot/appointment-management.js'

type Offer = { key: string; date: string; moves: readonly GroupMove[] }
type Context = { version: 1; action: 'CANCEL' | 'RESCHEDULE'; snapshot: CancellationSnapshot; proposal?: GroupCancellationProposal | GroupRescheduleProposal; offers?: readonly Offer[] }
type SlotEvidence = { date: string; startAt: string; professionalId: string; serviceIds: readonly string[]; durationMinutes: number; customerDurationMinutes: number }
type Reader = (member: CancellationSnapshot['members'][number], date: string) => Promise<readonly SlotEvidence[]>
// Proposed server-only API, intentionally absent at the observed RED boundary.
const begin = Reflect.get(domain, 'beginAppointmentManagement') as (action: Context['action'], snapshot: CancellationSnapshot) => Context
const parse = Reflect.get(domain, 'parseAppointmentManagement') as (value: unknown, businessId: string, sessionId: string) => Context
const attach = Reflect.get(domain, 'attachManagementRescheduleOffers') as (context: Context, offers: readonly Offer[]) => Context
const select = Reflect.get(domain, 'selectManagementRescheduleOffer') as (context: Context, key: string) => Context
const confirm = Reflect.get(domain, 'confirmAppointmentManagement') as (context: Context, consent: { nonce: string; fingerprint: string }) => GroupCancellationCommand | GroupRescheduleCommand
const prepare = Reflect.get(adapter, 'prepareGroupRescheduleOffers') as (snapshot: CancellationSnapshot, date: string, reader: Reader) => Promise<readonly Offer[]>

const snapshot: CancellationSnapshot = {
  scope: { businessId: 'business', customerId: 'customer', sessionId: 'session', normalizedPhone: '5491112345678' },
  groupId: 'group', dbNow: '2026-10-07T10:00:00.000Z',
  members: ['a', 'b'].map((id, index) => ({
    appointmentId: id, version: 3, status: 'CONFIRMED', visitId: 'visit-' + id, visitVersion: 2, visitStatus: 'CONFIRMED',
    professionalId: 'professional-' + index, serviceIds: ['service-' + index], startAt: index ? '2026-10-08T15:45:00.000Z' : '2026-10-08T15:00:00.000Z',
    durationMinutes: index ? 45 : 30, customerDurationMinutes: index ? 60 : 45, quotedPrice: 1000,
    depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null
  }))
}
const original = structuredClone(snapshot)
const moves = snapshot.members.map(member => ({ appointmentId: member.appointmentId, newStartAt: member.startAt.replace('2026-10-08', '2026-10-09') }))
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, jsonbOrder(item)]))
  return value
}
function slot(member: CancellationSnapshot['members'][number], date: string, startAt: string): SlotEvidence {
  return { date, startAt, professionalId: member.professionalId, serviceIds: [...member.serviceIds], durationMinutes: member.durationMinutes, customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes }
}
const reader: Reader = async (member, date) => [slot(member, date, member.startAt.replace('2026-10-08', date))]
let failures = 0, passed = 0
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error))) }
}

async function main() {
  await check('C1/C2 fingerprints survive JSONB order without changing proof values', () => {
    assert.equal(canonicalJsonHash(snapshot), canonicalJsonHash(jsonbOrder(snapshot)))
    assert.equal(domain.cancellationFingerprint(snapshot), domain.cancellationFingerprint(jsonbOrder(snapshot) as CancellationSnapshot))
    const proposal = domain.presentGroupReschedule(snapshot, moves)
    const roundtrip = jsonbOrder(proposal) as GroupRescheduleProposal
    assert.deepEqual(domain.confirmGroupReschedule(roundtrip, { nonce: proposal.nonce, fingerprint: proposal.fingerprint }).moves, moves)
  })
  await check('scoped cancellation context roundtrip and separate consent', () => {
    assert.equal(typeof begin, 'function', 'management context API is not implemented')
    const context = begin('CANCEL', snapshot)
    assert.equal(context.version, 1)
    assert.equal(context.action, 'CANCEL')
    assert.deepEqual(context.snapshot, original)
    const proposal = context.proposal!
    assert.equal(proposal.kind, 'GROUP_CANCELLATION_PROPOSAL')
    const restored = parse(jsonbOrder(context), 'business', 'session')
    assert.deepEqual(restored, context)
    assert.equal(confirm(restored, { nonce: proposal.nonce, fingerprint: proposal.fingerprint }).kind, 'CANCEL_APPOINTMENT_GROUP')
    assert.throws(() => confirm(restored, { nonce: 'booking-draft-nonce', fingerprint: proposal.fingerprint }), /consent|nonce/)
    assert.throws(() => confirm(restored, { nonce: proposal.nonce, fingerprint: 'wrong' }), /consent|fingerprint/)
    assert.notEqual(begin('CANCEL', snapshot).proposal!.nonce, proposal.nonce)
    assert.deepEqual(snapshot, original)
  })
  await check('parser rejects foreign, incomplete, altered or overbounded management contexts', () => {
    const context = begin('CANCEL', snapshot)
    assert.throws(() => parse(context, 'foreign', 'session'), /scope|business|tenant/)
    assert.throws(() => parse(context, 'business', 'foreign'), /scope|session/)
    for (const invalid of [
      { ...context, arbitraryAppointmentId: 'foreign' }, { ...context, version: 2 }, { ...context, action: 'CREATE_BOOKING' },
      { ...context, snapshot: { ...snapshot, groupId: 'foreign' } },
      { ...context, snapshot: { ...snapshot, members: snapshot.members.slice(0, 1) } },
      { ...context, snapshot: { ...snapshot, members: [{ ...snapshot.members[0]!, version: 4 }, snapshot.members[1]!] } },
      { ...context, snapshot: { ...snapshot, members: [{ ...snapshot.members[0]!, unknown: true }, snapshot.members[1]!] } },
      { ...context, proposal: { ...context.proposal!, nonce: 'invalid nonce with control\n' } },
      { ...context, offers: [] }
    ]) assert.throws(() => parse(invalid, 'business', 'session'))
    assert.throws(() => begin('CANCEL', { ...snapshot, scope: { ...snapshot.scope, normalizedPhone: 'demo:qa' } }), /phone/)
    assert.throws(() => begin('RESCHEDULE', { ...snapshot, members: Array.from({ length: 21 }, (_, index) => ({ ...snapshot.members[0]!, appointmentId: 'a-' + index, visitId: 'v-' + index })) }), /cardinality|bound/)
    assert.deepEqual(snapshot, original)
  })
  await check('rescheduling reads ALL actual assignments and intersects offsets', async () => {
    assert.equal(typeof prepare, 'function', 'management availability API is not implemented')
    const calls: Array<{ id: string; professional: string; services: readonly string[]; date: string }> = []
    const offers = await prepare(snapshot, '2026-10-09', async (member, date) => {
      calls.push({ id: member.appointmentId, professional: member.professionalId, services: [...member.serviceIds], date })
      return reader(member, date)
    })
    assert.deepEqual(calls, snapshot.members.map(member => ({ id: member.appointmentId, professional: member.professionalId, services: member.serviceIds, date: '2026-10-09' })))
    assert.equal(offers.length, 1)
    assert.deepEqual(offers[0]!.moves, moves)
    assert.equal(offers[0]!.date, '2026-10-09')
    domain.assertGroupMoves(snapshot, offers[0]!.moves)
    assert.deepEqual(snapshot, original)
  })
  await check('reschedule proposal needs server offer selection and fresh separate consent', async () => {
    const context = begin('RESCHEDULE', snapshot)
    assert.equal(context.proposal, undefined)
    assert.throws(() => confirm(context, { nonce: 'old', fingerprint: 'old' }), /proposal|selection|consent/)
    const offers = await prepare(snapshot, '2026-10-09', reader)
    const shown = attach(context, offers)
    assert.equal(shown.proposal, undefined)
    assert.throws(() => select(shown, 'foreign'), /offer|selection/)
    const selected = select(shown, offers[0]!.key)
    assert.equal(selected.proposal!.kind, 'GROUP_RESCHEDULE_PROPOSAL')
    assert.equal(confirm(parse(jsonbOrder(selected), 'business', 'session'), { nonce: selected.proposal!.nonce, fingerprint: selected.proposal!.fingerprint }).kind, 'RESCHEDULE_APPOINTMENT_GROUP')
    assert.deepEqual((selected.proposal as GroupRescheduleProposal).moves, moves)
    assert.deepEqual(context, beginContextWithoutProposal(snapshot))
    assert.equal(shown.proposal, undefined)
    const other = begin('CANCEL', snapshot).proposal!
    assert.throws(() => confirm(selected, { nonce: other.nonce, fingerprint: other.fingerprint }), /consent|fingerprint/)
    assert.throws(() => parse({ ...selected, proposal: { ...selected.proposal!, moves: moves.slice(0, 1) } }, 'business', 'session'), /coverage|fingerprint/)
    assert.deepEqual(snapshot, original)
  })
  await check('no partial offers when one assignment or offset is unavailable', async () => {
    assert.deepEqual(await prepare(snapshot, '2026-10-09', async (member, date) => member.appointmentId === 'b' ? [] : reader(member, date)), [])
    assert.deepEqual(await prepare(snapshot, '2026-10-09', async (member, date) => [slot(member, date, member.appointmentId === 'b' ? '2026-10-09T16:00:00.000Z' : '2026-10-09T15:00:00.000Z')]), [])
    assert.deepEqual(snapshot, original)
  })
  await check('foreign assignment, duration, date and service proofs cannot become offers', async () => {
    for (const change of [
      { professionalId: 'foreign' }, { serviceIds: ['foreign'] }, { durationMinutes: 1 }, { customerDurationMinutes: 1 }, { date: '2026-10-10' }
    ]) await assert.rejects(() => prepare(snapshot, '2026-10-09', async (member, date) => [{ ...slot(member, date, member.startAt.replace('2026-10-08', date)), ...change }]), /assignment|proof|duration|date|service/)
    await assert.rejects(() => prepare(snapshot, '2026-99-99', reader), /date/)
    await assert.rejects(() => prepare(snapshot, '2026-10-09', async () => { throw new Error('reader failed') }), /reader failed/)
    assert.deepEqual(snapshot, original)
  })
  await check('C2 conservative guards apply BEFORE any group offer', async () => {
    const unsafe = { ...snapshot, members: [snapshot.members[0]!, { ...snapshot.members[1]!, startAt: '2026-10-08T16:00:00.000Z' }] }
    assert.deepEqual(await prepare(unsafe, '2026-10-08', async (member, date) => [slot(member, date, member.appointmentId === 'a' ? '2026-10-08T15:45:00.000Z' : '2026-10-08T16:45:00.000Z')]), [])
    const overlapping = { ...snapshot, members: [{ ...snapshot.members[0]!, customerDurationMinutes: 90 }, snapshot.members[1]!] }
    assert.deepEqual(await prepare(overlapping, '2026-10-09', reader), [])
    const offers = await prepare(snapshot, '2026-10-09', reader), context = begin('RESCHEDULE', snapshot)
    assert.throws(() => attach(context, [{ ...offers[0]!, moves: moves.slice(0, 1) }]), /coverage|offer|fingerprint/)
    assert.throws(() => attach(context, [{ ...offers[0]!, moves: [{ ...moves[0]!, appointmentId: 'foreign' }, moves[1]!] }]), /coverage|offer|fingerprint/)
    assert.throws(() => attach(context, [{ ...offers[0]!, key: 'forged' }]), /offer|fingerprint/)
    assert.throws(() => attach(context, [offers[0]!, offers[0]!]), /duplicate|offer/)
    assert.deepEqual(snapshot, original)
  })
  console.log(`management context: ${passed} PASS / ${failures} FAIL`)
  if (failures) process.exitCode = 1
}
function beginContextWithoutProposal(value: CancellationSnapshot): Context {
  return { version: 1, action: 'RESCHEDULE', snapshot: structuredClone(value) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
