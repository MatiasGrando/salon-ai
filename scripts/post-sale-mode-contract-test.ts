import assert from 'node:assert/strict'
import {
  assertPostSaleManualTransition,
  canAutomaticPostSaleSend,
  isPostSaleTemplateEligible,
  normalizePostSaleMode
} from '../src/domain/communications/post-sale.js'

assert.equal(normalizePostSaleMode('MANUAL_ASSISTED'), 'MANUAL_ASSISTED')
assert.equal(normalizePostSaleMode(undefined, true), 'AUTOMATIC_API')
assert.equal(normalizePostSaleMode(undefined, false), 'PAUSED')

assert.equal(canAutomaticPostSaleSend('PENDING'), true)
assert.equal(canAutomaticPostSaleSend('FAILED'), true)
assert.equal(canAutomaticPostSaleSend('OPENED'), false, 'Abrir WhatsApp reserva el seguimiento para el operador')
assert.equal(canAutomaticPostSaleSend('PROCESSING'), false, 'Un seguimiento tomado por otro proceso no puede duplicarse')
assert.equal(canAutomaticPostSaleSend('SENT'), false, 'Un env\u00edo manual registrado no puede reenviarse por API')
assert.equal(canAutomaticPostSaleSend('RESPONDED'), false)
assert.equal(canAutomaticPostSaleSend('RESOLVED'), false)

assert.equal(isPostSaleTemplateEligible('MANUAL_ASSISTED', { status: 'DRAFT', category: 'MARKETING' }), true)
assert.equal(isPostSaleTemplateEligible('AUTOMATIC_API', { status: 'DRAFT', category: 'UTILITY' }), false)
assert.equal(isPostSaleTemplateEligible('AUTOMATIC_API', { status: 'APPROVED', category: 'MARKETING' }), false)
assert.equal(isPostSaleTemplateEligible('AUTOMATIC_API', { status: 'APPROVED', category: 'UTILITY' }), true)

assert.doesNotThrow(() => assertPostSaleManualTransition('PENDING', 'OPENED'))
assert.doesNotThrow(() => assertPostSaleManualTransition('OPENED', 'SENT'))
assert.doesNotThrow(() => assertPostSaleManualTransition('SENT', 'RESPONDED'))
assert.doesNotThrow(() => assertPostSaleManualTransition('RESPONDED', 'RESOLVED'))
assert.throws(() => assertPostSaleManualTransition('SENT', 'OPENED'))
assert.throws(() => assertPostSaleManualTransition('SKIPPED', 'SENT'))

console.log('Post-sale mode contract tests passed')
