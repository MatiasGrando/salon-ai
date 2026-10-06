import assert from 'node:assert/strict'
import { presentGroupCancellation, confirmGroupCancellation, cancellationFingerprint, assertCancellationSnapshot, type CancellationSnapshot } from '../src/conversational-bot/appointment-management.js'

const original: CancellationSnapshot = { scope: { businessId: 'business', customerId: 'customer', sessionId: 'session', normalizedPhone: '5491112345678' },
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
