import assert from 'node:assert/strict'
import { serviceEstimatesEqual } from '../src/bot-options/domain/service-booking.js'

const canonical = { optionId: 'long', optionLabel: '30 cm', priceMin: 80000, priceMax: null }
const reordered = { priceMax: null, priceMin: 80000, optionLabel: '30 cm', optionId: 'long' }

assert.equal(serviceEstimatesEqual(canonical, reordered), true, 'JSON/JSONB property order must not change estimate equality')
assert.equal(serviceEstimatesEqual(canonical, { ...canonical, priceMin: 81000 }), false)
assert.equal(serviceEstimatesEqual(canonical, undefined), false)
assert.equal(serviceEstimatesEqual(null, null), true)

console.log('Service estimate equality contract: OK')
