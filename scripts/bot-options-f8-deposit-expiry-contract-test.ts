import assert from 'node:assert/strict'
import { isDepositHoldExpiryEligible } from '../src/bot-options/application/expire-deposit-hold.js'

const dbNow = new Date('2026-08-27T12:00:00.000Z')
const eligible = {
  depositStatus: 'PENDING_PROOF', visitStatus: 'HELD', appointmentStatus: 'PENDING',
  dueAt: new Date('2026-08-27T11:59:59.999Z'), visitDueAt: new Date('2026-08-27T12:00:00.000Z'), dbNow
}
assert.equal(isDepositHoldExpiryEligible(eligible), true, 'only a fully-held, due aggregate may be released')

for (const change of [
  { depositStatus: 'PROOF_RECEIVED' },
  { depositStatus: 'APPROVED' },
  { visitStatus: 'PENDING_PAYMENT_REVIEW' },
  { visitStatus: 'CONFIRMED' },
  { appointmentStatus: 'CONFIRMED' },
  { dueAt: new Date('2026-08-27T12:00:00.001Z') },
  { visitDueAt: new Date('2026-08-27T12:00:00.001Z') },
  { visitDueAt: null }
]) {
  assert.equal(isDepositHoldExpiryEligible({ ...eligible, ...change }), false, `must fail closed for ${JSON.stringify(change)}`)
}

console.log('OK F8.6 pure: expiry requires all three original held states and both DB deadlines; proof/confirmation races fail closed.')
