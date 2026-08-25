import assert from 'node:assert/strict'
import {
  defaultMarketingPreferenceData,
  hasMarketingOptOutCandidate,
  shouldApplyMarketingOptOut,
  shouldDeferMarketingOptOutReply,
  type MarketingOptOutUnderstanding
} from '../src/services/marketing-preference-service.js'
import { readFileSync } from 'node:fs'

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
  assert.equal(hasMarketingOptOutCandidate(message), false, message)
}

for (const message of ['Sí', 'Sí por favor', 'Dale', 'Confirmo', 'Reservar']) {
  assert.equal(shouldApplyMarketingOptOut(message), false, message)
  assert.equal(hasMarketingOptOutCandidate(message), false, message)
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

assert.equal(shouldDeferMarketingOptOutReply('CONFIRM'), true)
assert.equal(shouldDeferMarketingOptOutReply('AWAITING_DEPOSIT'), true)
assert.equal(shouldDeferMarketingOptOutReply('START'), false)

const webhookSource = readFileSync('src/services/whatsapp-webhook-service.ts', 'utf8')
const optOutMethod = webhookSource.slice(
  webhookSource.indexOf('private async applyMarketingOptOut'),
  webhookSource.indexOf('private async isDefaultBusinessAiEnabled')
)
assert.ok(
  optOutMethod.indexOf('hasMarketingOptOutCandidate') < optOutMethod.indexOf('prisma.customer.findFirst'),
  'Debe descartar mensajes comunes antes de consultar clientes'
)
assert.match(optOutMethod, /normalizedPhone/)
assert.match(optOutMethod, /legacyCustomers/)

console.log('Marketing preference contract tests passed')
