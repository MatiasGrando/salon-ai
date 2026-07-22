import assert from 'node:assert/strict'
import {
  assertReminderManualTransition,
  canAutomaticReminderSend,
  isReminderTemplateEligible,
  normalizeReminderMode
} from '../src/domain/communications/reminder.js'

assert.equal(normalizeReminderMode('MANUAL_ASSISTED'), 'MANUAL_ASSISTED')
assert.equal(normalizeReminderMode(undefined, true), 'AUTOMATIC_API')
assert.equal(normalizeReminderMode(undefined, false), 'PAUSED')

assert.equal(isReminderTemplateEligible('MANUAL_ASSISTED', { status: 'DRAFT', category: 'UTILITY' }), true)
assert.equal(isReminderTemplateEligible('MANUAL_ASSISTED', { status: 'DRAFT', category: 'MARKETING' }), false)
assert.equal(isReminderTemplateEligible('AUTOMATIC_API', { status: 'DRAFT', category: 'UTILITY' }), false)
assert.equal(isReminderTemplateEligible('AUTOMATIC_API', { status: 'APPROVED', category: 'MARKETING' }), false)
assert.equal(isReminderTemplateEligible('AUTOMATIC_API', { status: 'APPROVED', category: 'UTILITY' }), true)

assert.equal(canAutomaticReminderSend('PENDING'), true)
assert.equal(canAutomaticReminderSend('FAILED'), true)
assert.equal(canAutomaticReminderSend('OPENED'), false, 'Abrir WhatsApp reserva el recordatorio para el operador')
assert.equal(canAutomaticReminderSend('SENT'), false, 'Un recordatorio manual enviado no se repite por API')

assert.doesNotThrow(() => assertReminderManualTransition('PENDING', 'OPENED'))
assert.doesNotThrow(() => assertReminderManualTransition('OPENED', 'SENT'))
assert.doesNotThrow(() => assertReminderManualTransition('FAILED', 'SENT'))
assert.throws(() => assertReminderManualTransition('SENT', 'OPENED'))

console.log('Reminder mode contract tests passed')
