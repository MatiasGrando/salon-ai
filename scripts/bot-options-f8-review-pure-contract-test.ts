import assert from 'node:assert/strict'
import { canStaffAccessRoute } from '../src/services/staff-permission-service.js'
import { depositReviewRequestHash, isDepositRejectionEligible, normalizeDepositRejection } from '../src/services/deposit-review-operation.js'
import { classifyDepositProofWrite } from '../src/services/deposit-proof-writer.js'
import { isDepositHoldExpiryEligible } from '../src/bot-options/application/expire-deposit-hold.js'

const reviewer = {
  role: 'STAFF', staffProfile: 'SECRETARY', professionalId: null, agendaScope: 'ALL' as const,
  canCreateAppointments: false, canEditAppointments: false, canCancelAppointments: false, canManageScheduleBlocks: false,
  canForceAppointments: false, canViewCustomers: false, canCreateCustomers: false, canEditCustomers: false,
  canManageCustomerNotes: false, canManageCustomerMarketing: false, canViewConversations: false, canReplyConversations: false,
  canManageDeposits: true, canViewOperationalReports: false, canViewFinancialAmounts: false
}

assert.equal(canStaffAccessRoute(reviewer, 'GET', '/crm/deposits'), true)
assert.equal(canStaffAccessRoute(reviewer, 'POST', '/crm/deposits/deposit-1/approve'), true)
assert.equal(canStaffAccessRoute({ ...reviewer, canManageDeposits: false }, 'GET', '/crm/deposits/deposit-1/proof'), false)
assert.deepEqual(normalizeDepositRejection({ reason: ' Comprobante ilegible ', mode: 'RESUBMISSION_ALLOWED' }), {
  reason: 'Comprobante ilegible', mode: 'RESUBMISSION_ALLOWED'
})
assert.throws(() => normalizeDepositRejection({ reason: ' ', mode: 'FINAL' }), /between 1 and 300/)
assert.throws(() => normalizeDepositRejection({ reason: 'x'.repeat(301), mode: 'FINAL' }), /between 1 and 300/)
assert.throws(() => normalizeDepositRejection({ reason: 'ok', mode: 'legacy' }), /mode is invalid/)
assert.equal(isDepositRejectionEligible({ depositStatus: 'PROOF_RECEIVED', visitStatus: 'PENDING_PAYMENT_REVIEW', appointmentStatus: 'PENDING', hasCurrentValidProof: true }), true)
assert.equal(isDepositRejectionEligible({ depositStatus: 'PROOF_RECEIVED', visitStatus: 'EXPIRED', appointmentStatus: 'PENDING', hasCurrentValidProof: true }), false)
const now = new Date('2026-08-27T12:00:00.000Z')
assert.deepEqual(classifyDepositProofWrite({ depositStatus: 'PENDING_RESUBMISSION', visitStatus: 'HELD', appointmentStatus: 'PENDING', expiresAt: new Date('2026-08-27T12:01:00.000Z'), holdExpiresAt: new Date('2026-08-27T12:01:00.000Z'), dbNow: now, proofCount: 1 }), { kind: 'RESUBMISSION' })
assert.equal(isDepositHoldExpiryEligible({ depositStatus: 'PENDING_RESUBMISSION', visitStatus: 'HELD', appointmentStatus: 'PENDING', dueAt: now, visitDueAt: now, dbNow: now }), true)
assert.equal(
  depositReviewRequestHash({ action: 'APPROVE', depositId: 'd1', actorUserId: 'u1' }),
  depositReviewRequestHash({ action: 'APPROVE', depositId: 'd1', actorUserId: 'u1' })
)
assert.notEqual(
  depositReviewRequestHash({ action: 'APPROVE', depositId: 'd1', actorUserId: 'u1' }),
  depositReviewRequestHash({ action: 'APPROVE', depositId: 'd1', actorUserId: 'u2' })
)
console.log('OK F8.8 pure: reviewer RBAC, explicit modes, resubmission proof/expiry state and request identity.')
