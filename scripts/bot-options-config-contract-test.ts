import assert from 'node:assert/strict'
import { resolveBotOptionsConfig } from '../src/config/bot-options.js'

assert.deepEqual(resolveBotOptionsConfig({}), {
  shadowAdmissionEnabled: false,
  authoritativeProcessingEnabled: false,
  workersEnabled: false,
  senderEnabled: false,
  bookingCapabilityEnabled: false,
  depositsCapabilityEnabled: false,
  appointmentManagementCapabilityEnabled: false,
  handoffCapabilityEnabled: false
})

const shadowOnly = resolveBotOptionsConfig({ BOT_OPTIONS_SHADOW_ADMISSION_ENABLED: 'true' })
assert.equal(shadowOnly.shadowAdmissionEnabled, true)
assert.equal(shadowOnly.authoritativeProcessingEnabled, false)

const authoritative = resolveBotOptionsConfig({
  BOT_OPTIONS_SHADOW_ADMISSION_ENABLED: 'true',
  BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED: 'true',
  BOT_OPTIONS_WORKERS_ENABLED: 'true',
  BOT_OPTIONS_SENDER_ENABLED: 'true',
  BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED: 'true',
  BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED: 'true',
  BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED: 'true',
  BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED: 'true'
})
assert.equal(authoritative.workersEnabled, true)
assert.equal(authoritative.senderEnabled, true)
assert.equal(authoritative.bookingCapabilityEnabled, true)
assert.equal(authoritative.depositsCapabilityEnabled, true)
assert.equal(authoritative.appointmentManagementCapabilityEnabled, true)
assert.equal(authoritative.handoffCapabilityEnabled, true)
assert.equal('routingEnabled' in authoritative, false, 'routing is controlled by deployment pointers, not capability config')

for (const dependent of [
  'BOT_OPTIONS_WORKERS_ENABLED',
  'BOT_OPTIONS_SENDER_ENABLED',
  'BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED',
  'BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED',
  'BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED',
  'BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED'
]) {
  assert.throws(
    () => resolveBotOptionsConfig({ [dependent]: 'true' }),
    /require BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=true/,
    `${dependent} must not run without authoritative processing`
  )
}

for (const field of [
  'BOT_OPTIONS_SHADOW_ADMISSION_ENABLED',
  'BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED',
  'BOT_OPTIONS_WORKERS_ENABLED',
  'BOT_OPTIONS_SENDER_ENABLED',
  'BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED',
  'BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED',
  'BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED',
  'BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED'
]) {
  for (const invalid of ['', 'TRUE', '1', 'yes', ' false ']) {
    assert.throws(() => resolveBotOptionsConfig({ [field]: invalid }), new RegExp(`${field} must be exactly`))
  }
}

console.log('OK bot-options config: defaults OFF and dependency validation are strict.')
