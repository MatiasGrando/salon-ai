import assert from 'node:assert/strict'
import {
  assertPostSaleManualTransition,
  canAutomaticPostSaleSend,
  isPostSaleTemplateEligible,
  normalizePostSaleMode,
  partitionLatestPostSales
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

const partition = partitionLatestPostSales([
  { id: 'old-a', businessId: 'business', customerId: 'customer-a', scheduledFor: new Date('2026-07-10T12:00:00Z') },
  { id: 'new-a', businessId: 'business', customerId: 'customer-a', scheduledFor: new Date('2026-07-12T12:00:00Z') },
  { id: 'only-b', businessId: 'business', customerId: 'customer-b', scheduledFor: new Date('2026-07-11T12:00:00Z') }
])
assert.deepEqual(partition.activeIds, ['new-a', 'only-b'])
assert.deepEqual(partition.supersededIds, ['old-a'])

const reservedManual = partitionLatestPostSales([
  { id: 'opened', businessId: 'business', customerId: 'customer', status: 'OPENED', scheduledFor: new Date('2026-07-10T12:00:00Z') },
  { id: 'new-pending', businessId: 'business', customerId: 'customer', status: 'PENDING', scheduledFor: new Date('2026-07-12T12:00:00Z') }
])
assert.deepEqual(reservedManual.activeIds, ['opened'], 'WhatsApp abierto conserva la gesti\u00f3n manual y bloquea otro contacto')
assert.deepEqual(reservedManual.supersededIds, [], 'El seguimiento nuevo espera hasta que finalice la gesti\u00f3n abierta')

const reservedProcessing = partitionLatestPostSales([
  { id: 'processing', businessId: 'business', customerId: 'customer', status: 'PROCESSING', scheduledFor: new Date('2026-07-10T12:00:00Z') },
  { id: 'other-pending', businessId: 'business', customerId: 'customer', status: 'PENDING', scheduledFor: new Date('2026-07-12T12:00:00Z') }
])
assert.deepEqual(reservedProcessing.activeIds, ['processing'])
assert.deepEqual(reservedProcessing.supersededIds, [], 'Un proceso en curso bloquea otro env\u00edo del mismo cliente')

assert.doesNotThrow(() => assertPostSaleManualTransition('PENDING', 'OPENED'))
assert.doesNotThrow(() => assertPostSaleManualTransition('OPENED', 'SENT'))
assert.doesNotThrow(() => assertPostSaleManualTransition('SENT', 'RESPONDED'))
assert.doesNotThrow(() => assertPostSaleManualTransition('RESPONDED', 'RESOLVED'))
assert.throws(() => assertPostSaleManualTransition('SENT', 'OPENED'))
assert.throws(() => assertPostSaleManualTransition('SKIPPED', 'SENT'))

console.log('Post-sale mode contract tests passed')
