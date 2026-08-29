import assert from 'node:assert/strict'
import {
  calculateBookingDepositTerms,
  hasCompleteDepositPaymentConfiguration
} from '../src/services/deposit-operations.js'

const terms = calculateBookingDepositTerms({
  businessDepositHoldMinutes: null,
  services: [
    { id: 'cut', name: 'Corte original', price: 5_000, priceMode: 'FIXED', depositMode: 'PERCENTAGE', depositValue: 20 },
    { id: 'wash', name: 'Lavado original', price: 1_500, priceMode: 'FIXED', depositMode: 'NONE', depositValue: null },
    { id: 'color', name: 'Color original', price: 3_000, priceMode: 'FIXED', depositMode: 'FIXED', depositValue: 700 }
  ]
})

assert.deepEqual(terms, {
  ttlMinutes: 120,
  ttlProvenance: 'DEFAULT_120',
  amount: 1_700,
  lines: [
    { serviceId: 'cut', sortOrder: 0, serviceName: 'Corte original', mode: 'PERCENTAGE', configuredValue: 20, baseAmount: 5_000, amount: 1_000 },
    { serviceId: 'color', sortOrder: 2, serviceName: 'Color original', mode: 'FIXED', configuredValue: 700, baseAmount: null, amount: 700 }
  ]
}, 'the snapshot preserves selected-service order and values independently from later catalog edits')

assert.equal(calculateBookingDepositTerms({
  businessDepositHoldMinutes: 45,
  services: [{ id: 'fixed', name: 'Fijo', price: null, priceMode: 'STARTING_AT', depositMode: 'FIXED', depositValue: 500 }]
}).ttlProvenance, 'BUSINESS_POLICY')

for (const input of [
  { businessDepositHoldMinutes: 0, services: [{ id: 'x', name: 'X', price: 1, priceMode: 'FIXED' as const, depositMode: 'FIXED' as const, depositValue: 1 }] },
  { businessDepositHoldMinutes: null, services: [{ id: 'x', name: 'X', price: null, priceMode: 'STARTING_AT' as const, depositMode: 'PERCENTAGE' as const, depositValue: 10 }] },
  { businessDepositHoldMinutes: null, services: [{ id: 'x', name: 'X', price: 1, priceMode: 'FIXED' as const, depositMode: 'NONE' as const, depositValue: null }] }
]) {
  assert.throws(() => calculateBookingDepositTerms(input), /(deposit TTL policy is invalid|deposit rule is invalid|deposit hold requires|percentage deposit requires)/)
}

assert.equal(hasCompleteDepositPaymentConfiguration({ transferEnabled: true, alias: 'alias', cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null }), true)
assert.equal(hasCompleteDepositPaymentConfiguration({ transferEnabled: true, alias: null, cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null }), false)

console.log('OK F8.2: immutable per-service terms, explicit TTL provenance, invalid configuration and payment fail-closed.')
