import assert from 'node:assert/strict'
import {
  assertReminderManualTransition,
  canAutomaticReminderSend,
  isReminderTemplateEligible,
  normalizeReminderMode,
  normalizeReminderVariable
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
assert.throws(() => assertReminderManualTransition('PENDING', 'SENT'))
assert.throws(() => assertReminderManualTransition('FAILED', 'SENT'))
assert.throws(() => assertReminderManualTransition('SENT', 'OPENED'))

assert.equal(normalizeReminderVariable('usuario'), 'nombre_cliente')
assert.equal(normalizeReminderVariable('Dia'), 'fecha_turno')
assert.equal(normalizeReminderVariable('d\u00eda'), 'fecha_turno')
assert.equal(normalizeReminderVariable('FECHA'), 'fecha_turno')
assert.equal(normalizeReminderVariable('hora'), 'hora_turno')
assert.equal(normalizeReminderVariable('Profesional'), 'profesional')

console.log('Reminder mode contract tests passed')
