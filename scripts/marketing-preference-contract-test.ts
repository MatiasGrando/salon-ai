import assert from 'node:assert/strict'
import {
  defaultMarketingPreferenceData,
  shouldApplyMarketingOptOut,
  type MarketingOptOutUnderstanding
} from '../src/services/marketing-preference-service.js'

const now = new Date('2026-08-03T20:00:00.000Z')
assert.deepEqual(defaultMarketingPreferenceData(now), {
  status: 'ACTIVE',
  source: 'DEFAULT',
  optedInAt: now
})

for (const message of [
  'BAJA',
  'stop',
  'No quiero recibir más promociones',
  'Por favor sáquenme de las promos',
  'No me envíen publicidad'
]) {
  assert.equal(shouldApplyMarketingOptOut(message), true, message)
}

for (const message of [
  'No',
  'Gracias',
  'Quiero cancelar mi turno',
  'No quiero ese servicio',
  '¿Tienen promociones?'
]) {
  assert.equal(shouldApplyMarketingOptOut(message), false, message)
}

const semanticOptOut: MarketingOptOutUnderstanding = {
  action: 'opt_out',
  confidence: 0.94,
  evidence: 'borrenme de esa lista'
}
assert.equal(shouldApplyMarketingOptOut('Por favor, bórrenme de esa lista', semanticOptOut), true)
assert.equal(shouldApplyMarketingOptOut('Quiero cancelar mi turno', {
  ...semanticOptOut,
  evidence: 'cancelar mi turno'
}), false)
assert.equal(shouldApplyMarketingOptOut('Por favor, bórrenme de esa lista', {
  ...semanticOptOut,
  confidence: 0.6
}), false)
assert.equal(shouldApplyMarketingOptOut('Un mensaje sin esa evidencia', semanticOptOut), false)

console.log('Marketing preference contract tests passed')
