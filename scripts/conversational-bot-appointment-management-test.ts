import assert from 'node:assert/strict'
import { presentGroupReschedule, confirmGroupReschedule, assertGroupMoves, presentGroupCancellation, confirmGroupCancellation, cancellationFingerprint, assertCancellationSnapshot, type CancellationSnapshot } from '../src/conversational-bot/appointment-management.js'

const original: CancellationSnapshot & {scope:{normalizedPhone:string;subject?:never}} = { scope: { businessId: 'business', customerId: 'customer', sessionId: 'session', normalizedPhone: '5491112345678' },
  groupId: 'group', dbNow: '2026-10-06T10:00:00.000Z', members: ['a','b'].map((id,index) => ({
    appointmentId: id, version: 3, status: 'CONFIRMED', visitId: 'v-'+id, visitVersion: 2, visitStatus: 'CONFIRMED',
    professionalId: 'p-'+index, serviceIds: ['s-'+index], startAt: '2026-10-07T15:00:00.000Z', durationMinutes: 30,
    quotedPrice: 1000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null
  })) }
const before = structuredClone(original), p = presentGroupCancellation(original)
const command = confirmGroupCancellation(p, { nonce: p.nonce, fingerprint: p.fingerprint })
assert.equal(command.kind, 'CANCEL_APPOINTMENT_GROUP')
assert.deepEqual(command.snapshot, original)
assert.deepEqual(original, before)
assert.notEqual(presentGroupCancellation(original).nonce, p.nonce)
assert.throws(() => confirmGroupCancellation(p, { nonce: 'foreign', fingerprint: p.fingerprint }), /consent/)
assert.throws(() => confirmGroupCancellation(p, { nonce: p.nonce, fingerprint: 'wrong' }), /consent/)
assert.throws(() => confirmGroupCancellation({ ...p, snapshot: { ...original, groupId: 'foreign' } }, { nonce: p.nonce, fingerprint: p.fingerprint }), /fingerprint/)
assert.notEqual(cancellationFingerprint({ ...original, members: [{ ...original.members[0]!, version: 4 }, original.members[1]!] }), p.fingerprint)
assert.equal(cancellationFingerprint({ ...original, dbNow: '2026-10-06T11:00:00.000Z' }), p.fingerprint)
for (const [snapshot, message] of [
  [{ ...original, members: [original.members[0]!,original.members[0]!] }, /duplicate/],
  [{ ...original, scope: { ...original.scope, normalizedPhone: 'demo:preview:user' } }, /phone/],
  [{ ...original, members: [{ ...original.members[0]!, visitVersion: null }] }, /visit/],
  [{ ...original, members: [{ ...original.members[0]!, status: 'CANCELLED' }] }, /confirmed/],
  [{ ...original, dbNow: '2026-10-08T10:00:00.000Z' }, /future/],
  [{ ...original, groupId: null }, /singleton/],
  [{ ...original, members: [{ ...original.members[0]!, serviceIds: [] }] }, /services/]
] as const) assert.throws(() => assertCancellationSnapshot(snapshot), message)
console.log('appointment management domain: PASS')

const moves = [{appointmentId:'a',newStartAt:'2026-10-08T15:00:00.000Z'},{appointmentId:'b',newStartAt:'2026-10-08T15:30:00.000Z'}]
const rp=presentGroupReschedule(original,moves)
const rc=confirmGroupReschedule(rp,{nonce:rp.nonce,fingerprint:rp.fingerprint})
assert.equal(rc.kind,'RESCHEDULE_APPOINTMENT_GROUP')
assert.deepEqual(rc.moves,moves)
assert.deepEqual(original,before)
assert.throws(()=>confirmGroupReschedule(rp,{nonce:'wrong',fingerprint:rp.fingerprint}),/consent/)
assert.throws(()=>confirmGroupReschedule({...rp,moves:[{...moves[0]!,newStartAt:'2026-10-09T15:00:00.000Z'},moves[1]!]},{nonce:rp.nonce,fingerprint:rp.fingerprint}),/fingerprint/)
assert.throws(()=>assertGroupMoves(original,moves.slice(0,1)),/coverage/)
assert.throws(()=>assertGroupMoves(original,[moves[0]!,moves[0]!]),/coverage/)
assert.throws(()=>assertGroupMoves(original,[moves[0]!,{...moves[1]!,appointmentId:'foreign'}]),/coverage/)
assert.throws(()=>assertGroupMoves(original,[moves[0]!,{...moves[1]!,newStartAt:moves[0]!.newStartAt}]),/overlap/)
assert.throws(()=>assertGroupMoves({...original,members:[original.members[0]!,{...original.members[1]!,startAt:'2026-10-07T15:30:00.000Z'}]},[{...moves[0]!,newStartAt:'2026-10-07T15:30:00.000Z'},moves[1]!]),/original/)
assert.throws(()=>assertGroupMoves(original,[{...moves[0]!,newStartAt:'2026-10-05T15:00:00.000Z'},moves[1]!]),/future/)
assert.throws(()=>assertGroupMoves({...original,members:[{...original.members[0]!,customerDurationMinutes:90},original.members[1]!] },moves),/overlap/)
console.log('group reschedule domain: PASS')
