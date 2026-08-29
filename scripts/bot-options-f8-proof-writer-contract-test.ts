import assert from 'node:assert/strict'
import { classifyDepositProofWrite } from '../src/services/deposit-proof-writer.js'

const dbNow = new Date('2026-08-27T12:00:00.000Z')
const active = {
  depositStatus: 'PENDING_PROOF', visitStatus: 'HELD', appointmentStatus: 'PENDING',
  expiresAt: new Date('2026-08-27T12:00:00.001Z'), holdExpiresAt: new Date('2026-08-27T12:00:00.001Z'), dbNow, proofCount: 0
}
assert.deepEqual(classifyDepositProofWrite(active), { kind: 'INITIAL' })
assert.deepEqual(classifyDepositProofWrite({ ...active, proofCount: 1 }), { kind: 'RESUBMISSION' })
assert.deepEqual(classifyDepositProofWrite({ ...active, expiresAt: dbNow }), { kind: 'LATE' }, 'deadline equality is late; the DB clock owns the boundary')
assert.deepEqual(classifyDepositProofWrite({ ...active, holdExpiresAt: null }), { kind: 'LATE' })
assert.deepEqual(classifyDepositProofWrite({ ...active, depositStatus: 'EXPIRED', visitStatus: 'EXPIRED', appointmentStatus: 'CANCELLED' }), { kind: 'LATE' })
for (const state of [
  { depositStatus: 'PROOF_RECEIVED' },
  { visitStatus: 'PENDING_PAYMENT_REVIEW' },
  { appointmentStatus: 'CONFIRMED' },
  { depositStatus: 'EXPIRED', visitStatus: 'HELD', appointmentStatus: 'PENDING' }
]) {
  assert.equal(classifyDepositProofWrite({ ...active, ...state }), null, `must not reopen or mutate ${JSON.stringify(state)}`)
}

console.log('OK F8.5 pure: only a current fully-held aggregate receives INITIAL/RESUBMISSION; every expiry path is append-only LATE.')
