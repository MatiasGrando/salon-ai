import assert from 'node:assert/strict'
import {
  classifyAppointmentManagementPolicy,
  classifyCancellationAggregate,
  classifyRescheduleAggregate,
  depositSnapshotMatchesCurrentPolicy,
  isWithinAppointmentManagementLeadWindow,
  validateCancellationInput,
  validateRescheduleInput
} from '../src/bot-options/application/appointment-management.js'

const now = new Date('2026-08-27T12:00:00.000Z')
assert.equal(isWithinAppointmentManagementLeadWindow(new Date('2026-08-27T13:00:00.000Z'), now, 60), true, 'the exact 60-minute boundary is allowed')
assert.equal(isWithinAppointmentManagementLeadWindow(new Date('2026-08-27T12:59:59.999Z'), now, 60), false, 'inside the lead window is denied')
assert.equal(isWithinAppointmentManagementLeadWindow(new Date('2026-08-27T13:00:00.001Z'), now, 60), true, 'outside the lead window is allowed')
assert.equal(isWithinAppointmentManagementLeadWindow(now, now, 0), true, 'zero is a valid independent policy')
assert.throws(() => isWithinAppointmentManagementLeadWindow(now, now, -1), /non-negative integer/)
assert.throws(() => isWithinAppointmentManagementLeadWindow(new Date('invalid'), now, 60), /valid instant/)

assert.deepEqual(classifyAppointmentManagementPolicy('LEGACY_CONFIRMED'), { cancel: 'AUTOMATIC', reschedule: 'AUTOMATIC' })
assert.deepEqual(classifyAppointmentManagementPolicy('WAITING_PROOF'), { cancel: 'AUTOMATIC', reschedule: 'AUTOMATIC' })
assert.deepEqual(classifyAppointmentManagementPolicy('RESUBMISSION_PENDING'), { cancel: 'AUTOMATIC', reschedule: 'AUTOMATIC' })
assert.deepEqual(classifyAppointmentManagementPolicy('UNDER_REVIEW'), { cancel: 'HANDOFF', reschedule: 'HANDOFF' })
assert.deepEqual(classifyAppointmentManagementPolicy('APPROVED'), { cancel: 'HANDOFF', reschedule: 'REQUIRES_DEPOSIT_MATCH' })
assert.throws(() => classifyAppointmentManagementPolicy('unknown' as never), /financial state is invalid/)

const cancellationBase = { appointmentStatus: 'CONFIRMED', visitStatus: null, depositStatus: null, hasVisit: false, depositVisitId: null, snapshotSealedAt: null, startAt: new Date('2026-08-27T13:00:00.000Z'), dbNow: now, cancellationLeadMinutes: 60, depositExpiresAt: null, holdExpiresAt: null }
assert.equal(classifyCancellationAggregate(cancellationBase), 'CANCEL', 'legacy confirmed appointments cancel automatically')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, startAt: new Date('2026-08-27T12:59:59.999Z') }), 'HANDOFF', 'inside the lead window is not auto-cancelled')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, startAt: new Date('2026-08-27T11:59:59.999Z') }), 'INELIGIBLE', 'past appointments are never handed off by the cancellation writer')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, appointmentStatus: 'PENDING', visitStatus: 'HELD', depositStatus: 'PENDING_PROOF', hasVisit: true, depositVisitId: 'visit', snapshotSealedAt: now, depositExpiresAt: new Date('2026-08-27T14:00:00.000Z'), holdExpiresAt: new Date('2026-08-27T14:00:00.000Z') }), 'CANCEL')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, appointmentStatus: 'PENDING', visitStatus: 'PENDING_PAYMENT_REVIEW', depositStatus: 'PROOF_RECEIVED', hasVisit: true, depositVisitId: 'visit', snapshotSealedAt: now, depositExpiresAt: new Date('2026-08-27T14:00:00.000Z'), holdExpiresAt: null }), 'HANDOFF')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, visitStatus: 'CONFIRMED', depositStatus: 'APPROVED', hasVisit: true, depositVisitId: 'visit', snapshotSealedAt: now, depositExpiresAt: new Date('2026-08-27T14:00:00.000Z'), holdExpiresAt: null }), 'HANDOFF')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, appointmentStatus: 'PENDING', visitStatus: 'HELD', depositStatus: 'PENDING_RESUBMISSION', hasVisit: false, depositVisitId: null, snapshotSealedAt: now, depositExpiresAt: new Date('2026-08-27T14:00:00.000Z'), holdExpiresAt: new Date('2026-08-27T14:00:00.000Z') }), 'HANDOFF')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, depositStatus: 'PENDING_PROOF', depositExpiresAt: new Date('2026-08-27T14:00:00.000Z') }), 'HANDOFF', 'a future legacy deposit without a visit is an incoherent aggregate and must hand off')
assert.equal(classifyCancellationAggregate({ ...cancellationBase, depositStatus: 'PENDING_PROOF', depositExpiresAt: new Date('2026-08-27T11:59:59.999Z') }), 'INELIGIBLE', 'an expired legacy deposit remains fail-closed')
const cancellationInput = { businessId: 'business', normalizedPhone: '5491112345678', sessionId: 'session', appointmentId: 'appointment', operationKey: 'cancel-1', confirmed: true as const }
assert.doesNotThrow(() => validateCancellationInput(cancellationInput))
assert.throws(() => validateCancellationInput({ ...cancellationInput, confirmed: false as never }), /confirmation is required/)
assert.throws(() => validateCancellationInput({ ...cancellationInput, operationKey: ' ' }), /nonblank normalized identifier/)

const rescheduleBase = {
  appointmentStatus: 'CONFIRMED', visitStatus: null, depositStatus: null, hasVisit: false,
  visitBelongsToSession: false, visitCoherent: false, depositCoherent: false, depositSnapshotMatches: false,
  originalStartAt: new Date('2026-08-27T13:00:00.000Z'), newStartAt: new Date('2026-08-27T14:00:00.000Z'),
  dbNow: now, rescheduleLeadMinutes: 60, depositExpiresAt: null, holdExpiresAt: null
}
assert.equal(classifyRescheduleAggregate(rescheduleBase), 'RESCHEDULE', 'legacy confirmed without deposit is automatic at the exact lead boundary')
assert.equal(classifyRescheduleAggregate({ ...rescheduleBase, originalStartAt: new Date('2026-08-27T12:59:59.999Z') }), 'HANDOFF')
assert.equal(classifyRescheduleAggregate({ ...rescheduleBase, newStartAt: rescheduleBase.originalStartAt }), 'INELIGIBLE', 'same instant is never a history event')
assert.equal(classifyRescheduleAggregate({ ...rescheduleBase, appointmentStatus: 'CANCELLED' }), 'INELIGIBLE')
assert.equal(classifyRescheduleAggregate({ ...rescheduleBase, hasVisit: true, visitBelongsToSession: true, visitCoherent: true, visitStatus: 'CONFIRMED' }), 'RESCHEDULE', 'coherent F7 no-deposit visit is automatic')
const held = {
  ...rescheduleBase, appointmentStatus: 'PENDING', visitStatus: 'HELD', depositStatus: 'PENDING_PROOF',
  hasVisit: true, visitBelongsToSession: true, visitCoherent: true, depositCoherent: true, depositSnapshotMatches: true,
  depositExpiresAt: new Date('2026-08-27T15:00:00.000Z'), holdExpiresAt: new Date('2026-08-27T15:00:00.000Z')
}
assert.equal(classifyRescheduleAggregate(held), 'RESCHEDULE')
assert.equal(classifyRescheduleAggregate({ ...held, depositExpiresAt: now }), 'INELIGIBLE', 'due TTL is never extended')
assert.equal(classifyRescheduleAggregate({ ...held, originalStartAt: new Date('2026-08-27T12:30:00.000Z'), depositExpiresAt: now }), 'INELIGIBLE', 'due TTL remains ineligible even inside the lead window')
assert.equal(classifyRescheduleAggregate({ ...held, depositSnapshotMatches: false }), 'HANDOFF')
assert.equal(classifyRescheduleAggregate({ ...held, appointmentStatus: 'CONFIRMED', visitStatus: 'CONFIRMED', depositStatus: 'APPROVED', depositExpiresAt: null, holdExpiresAt: null }), 'RESCHEDULE')
assert.equal(classifyRescheduleAggregate({ ...held, visitStatus: 'PENDING_PAYMENT_REVIEW', depositStatus: 'PROOF_RECEIVED' }), 'HANDOFF')

const currentServices = [{ id: 'service', name: 'Current display name', price: 1000, priceMode: 'FIXED' as const, depositMode: 'PERCENTAGE' as const, depositValue: 20 }]
const financial = {
  services: currentServices,
  appointmentItems: [{ serviceId: 'service', sortOrder: 0, price: 1000 }],
  lines: [{ serviceId: 'service', sortOrder: 0, mode: 'PERCENTAGE', configuredValue: 20, baseAmount: 1000, amount: 200 }],
  appointmentQuotedPrice: 1000, visitTotalPrice: 1000, depositMode: 'FIXED', depositConfiguredValue: 200,
  depositBaseAmount: null, depositAmount: 200, depositHoldTtlMinutes: 90,
  depositHoldTtlProvenance: 'BUSINESS_POLICY', businessDepositHoldMinutes: 90
}
assert.equal(depositSnapshotMatchesCurrentPolicy(financial), true, 'display names do not participate in policy equality')
assert.equal(depositSnapshotMatchesCurrentPolicy({ ...financial, depositAmount: 201 }), false)
assert.equal(depositSnapshotMatchesCurrentPolicy({ ...financial, services: [{ ...currentServices[0]!, priceMode: 'STARTING_AT' }] }), false, 'STARTING_AT is never guessed')
assert.equal(depositSnapshotMatchesCurrentPolicy({ ...financial, businessDepositHoldMinutes: 91 }), false, 'changed TTL policy hands off without extension')

const mixedFinancial = {
  services: [
    { id: 'deposit-service', name: 'Deposit service', price: 1000, priceMode: 'FIXED' as const, depositMode: 'FIXED' as const, depositValue: 200 },
    { id: 'no-deposit-service', name: 'No deposit service', price: 500, priceMode: 'FIXED' as const, depositMode: 'NONE' as const, depositValue: null }
  ],
  appointmentItems: [
    { serviceId: 'deposit-service', sortOrder: 0, price: 1000 },
    { serviceId: 'no-deposit-service', sortOrder: 1, price: 500 }
  ],
  lines: [{ serviceId: 'deposit-service', sortOrder: 0, mode: 'FIXED', configuredValue: 200, baseAmount: null, amount: 200 }],
  appointmentQuotedPrice: 1500, visitTotalPrice: 1500, depositMode: 'FIXED', depositConfiguredValue: 200,
  depositBaseAmount: null, depositAmount: 200, depositHoldTtlMinutes: 90,
  depositHoldTtlProvenance: 'BUSINESS_POLICY', businessDepositHoldMinutes: 90
}
assert.equal(depositSnapshotMatchesCurrentPolicy(mixedFinancial), true, 'NONE services participate in ordered service equality without inventing deposit lines')
assert.equal(depositSnapshotMatchesCurrentPolicy({ ...mixedFinancial, lines: [...mixedFinancial.lines, { serviceId: 'no-deposit-service', sortOrder: 1, mode: 'NONE', configuredValue: 0, baseAmount: null, amount: 0 }] }), false, 'unexpected lines for NONE services fail exact equality')

const rescheduleInput = { businessId: 'business', normalizedPhone: '5491112345678', sessionId: 'session', appointmentId: 'appointment', operationKey: 'reschedule-1', actor: 'customer:5491112345678', confirmed: true as const, newStartAt: '2026-08-27T14:00:00.000Z' }
assert.equal(validateRescheduleInput(rescheduleInput).toISOString(), rescheduleInput.newStartAt)
assert.throws(() => validateRescheduleInput({ ...rescheduleInput, actor: ' ' }), /actor must be a nonblank/)
assert.throws(() => validateRescheduleInput({ ...rescheduleInput, newStartAt: '2026-08-27 14:00:00' }), /canonical ISO instant/)
assert.throws(() => validateRescheduleInput({ ...rescheduleInput, confirmed: false as never }), /confirmation is required/)

console.log('OK F9 pure policy: exact lead boundaries, reschedule input/state gate and sealed financial equality.')
