import assert from 'node:assert/strict'
import { createSimulatorBookingIdentity, isSimulatorAppointmentId, isSimulatorCustomerId, isSimulatorRecipient, isSimulatorBookingCommunication } from '../src/services/simulator-booking-scope.js'
import { buildManualWhatsAppUrl, buildManualWhatsAppAppUrl } from '../src/domain/communications/communication.js'

const scope = { businessId: 'barber', conversationId: 'qa-one', proposalRevision: 'revision-one', proposalFingerprint: 'proposal-one' }
const identity = createSimulatorBookingIdentity(scope)
assert.deepEqual(createSimulatorBookingIdentity(scope), identity)
assert.notEqual(createSimulatorBookingIdentity({ ...scope, proposalFingerprint: 'proposal-two' }).appointmentId, identity.appointmentId)
assert.equal(createSimulatorBookingIdentity({ ...scope, proposalFingerprint: 'proposal-two' }).customerId, identity.customerId)
for (const change of [{ businessId: 'other' }, { conversationId: 'other' }]) {
  const alternate = createSimulatorBookingIdentity({ ...scope, ...change })
  assert.notEqual(alternate.appointmentId, identity.appointmentId)
  assert.notEqual(alternate.customerId, identity.customerId)
}
for (const key of ['businessId', 'conversationId', 'proposalRevision', 'proposalFingerprint'] as const) {
  assert.throws(() => createSimulatorBookingIdentity({ ...scope, [key]: '' }))
  assert.throws(() => createSimulatorBookingIdentity({ ...scope, [key]: 'x'.repeat(257) }))
}
assert.notEqual(createSimulatorBookingIdentity({ ...scope, proposalRevision: 'revision-two' }).appointmentId, identity.appointmentId)
assert.equal(isSimulatorAppointmentId(identity.appointmentId), true)
assert.equal(isSimulatorCustomerId(identity.customerId), true)
assert.equal(isSimulatorRecipient(identity.customerPhone), true)
for (const value of ['simqa_appointment_', ' SIMQA_APPOINTMENT_forged ']) assert.equal(isSimulatorAppointmentId(value), true)
for (const value of ['simqa_customer_', ' SIMQA_CUSTOMER_forged ']) assert.equal(isSimulatorCustomerId(value), true)
for (const value of ['simqa:customer:', ' SIMQA:CUSTOMER:5491112345678 ']) assert.equal(isSimulatorRecipient(value), true)
assert.equal(isSimulatorBookingCommunication({ appointmentId: identity.appointmentId, phone: '5491112345678' }), true)
assert.equal(isSimulatorBookingCommunication({ appointmentId: 'normal', customerId: identity.customerId, phone: '5491112345678' }), true)
assert.equal(isSimulatorBookingCommunication({ appointmentId: 'normal', phone: identity.customerPhone }), true)
assert.equal(isSimulatorBookingCommunication({ appointmentId: 'barber-real', customerId: 'real', phone: '5491112345678' }), false)
assert.equal(isSimulatorAppointmentId(null), false)
assert.equal(isSimulatorRecipient(null), false)
for (const phone of [identity.customerPhone, ' SIMQA:CUSTOMER:5491112345678 ']) {
  assert.throws(() => buildManualWhatsAppUrl(phone, 'hola'), /simulador/i)
  assert.throws(() => buildManualWhatsAppAppUrl(phone, 'hola'), /simulador/i)
}
assert.equal(buildManualWhatsAppUrl('5491112345678', 'hola'), 'https://wa.me/5491112345678?text=hola')
console.log('simulator-booking-scope: PASS')
