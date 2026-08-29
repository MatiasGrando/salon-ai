import assert from 'node:assert/strict'
import { buildCartSnapshot, canAddService, cartChangeInvalidatesAvailability, formatCartSummary } from '../src/bot-options/application/cart-operations.js'
import {
  bandForMinute, chooseBalancedProfessional, formatSlotOffset, localDateTimeToInstants, paginate,
  validateAvailabilitySettings
} from '../src/bot-options/application/availability-queries.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { transition } from '../src/bot-options/domain/transition.js'

const cut = { id: 'cut', name: 'Corte', durationMinutes: 30, priceMinor: 1500, priceMode: 'FIXED' as const, professionalIds: ['p1', 'p2'] }
const color = { id: 'color', name: 'Color', durationMinutes: 45, priceMinor: 3000, priceMode: 'STARTING_AT' as const, professionalIds: ['p2', 'p3'] }
const nails = { id: 'nails', name: 'Uñas', durationMinutes: 60, priceMinor: null, priceMode: 'FIXED' as const, professionalIds: ['p4'] }

const one = buildCartSnapshot([cut])
assert.deepEqual(one.commonProfessionalIds, ['p1', 'p2'])
assert.equal(one.totalDurationMinutes, 30)
assert.equal(one.totalPriceMinor, 1500)
assert.match(
  formatCartSummary(buildCartSnapshot([{ ...cut, priceMinor: 40_000 }])),
  /Precio total: \$40\.000,00/,
  'el resumen debe formatear la unidad canónica en pesos sin dividirla por cien'
)
const combined = canAddService({ current: one, proposed: color })
assert.equal(combined.ok, true)
if (combined.ok) {
  assert.deepEqual(combined.snapshot.commonProfessionalIds, ['p2'])
  assert.equal(combined.snapshot.totalDurationMinutes, 75, 'duración real no múltiplo de 30 debe conservarse')
  assert.equal(combined.snapshot.totalPriceMinor, null, 'un precio Desde no puede convertirse en total fijo')
}
assert.deepEqual(canAddService({ current: one, proposed: nails }), { ok: false, reason: 'NO_COMMON_PROFESSIONAL' })
assert.deepEqual(canAddService({ current: one, proposed: color, pairPolicies: new Map([['color:cut', 'REVIEW_REQUIRED']]) }), { ok: false, reason: 'REVIEW_REQUIRED' })
assert.equal(cartChangeInvalidatesAvailability(['cut'], ['cut', 'color']), true)
assert.equal(cartChangeInvalidatesAvailability(['cut'], ['cut']), false)

const settings = validateAvailabilitySettings({ timezone: 'America/New_York', horizonDays: 30, leadTimeHours: 0, morningCutTime: '12:30', eveningCutTime: '16:30' })
assert.equal(bandForMinute(12 * 60 + 29, settings), 'MORNING')
assert.equal(bandForMinute(12 * 60 + 30, settings), 'AFTERNOON')
assert.equal(bandForMinute(16 * 60 + 29, settings), 'AFTERNOON')
assert.equal(bandForMinute(16 * 60 + 30, settings), 'EVENING')
assert.throws(() => validateAvailabilitySettings({ ...settings, horizonDays: 91 }), /horizon/)
assert.throws(() => validateAvailabilitySettings({ ...settings, leadTimeHours: 720 }), /lead time/)
assert.throws(() => validateAvailabilitySettings({ ...settings, morningCutTime: '18:00', eveningCutTime: '12:00' }), /cuts/)

assert.equal(localDateTimeToInstants('2026-03-08', 2 * 60 + 30, 'America/New_York').length, 0, 'gap DST no debe inventar 02:30')
const fold = localDateTimeToInstants('2026-11-01', 1 * 60 + 30, 'America/New_York')
assert.equal(fold.length, 2, 'fold DST debe representar ambos instantes reales')
assert.notEqual(formatSlotOffset(fold[0]!.toISOString(), 'America/New_York'), formatSlotOffset(fold[1]!.toISOString(), 'America/New_York'), 'horarios repetidos deben poder distinguir su offset')

const chosen = chooseBalancedProfessional([
  { professional: { id: 'p3', name: 'Tres', priority: 10 }, occupiedMinutes: 60 },
  { professional: { id: 'p2', name: 'Dos', priority: 20 }, occupiedMinutes: 30 },
  { professional: { id: 'p1', name: 'Uno', priority: 20 }, occupiedMinutes: 30 }
])
assert.equal(chosen?.professional.id, 'p1', 'carga → prioridad → ID estable')
assert.deepEqual(paginate(Array.from({ length: 17 }, (_, index) => index), 1, 8), { items: [8, 9, 10, 11, 12, 13, 14, 15], hasPrevious: true, hasNext: true })

const recommendationState = { ...createInitialBotOptionsState(), flow: 'RECOMMENDATION_SELECT' as const, booking: 'DRAFT' as const, cart: [{ serviceId: 'cut' }] }
const incompatible = transition(recommendationState, { actionType: 'recommendation.add', entityRef: { type: 'SERVICE', id: 'nails' }, payload: null }, {
  dbNowIso: '2026-08-26T12:00:00Z', recommendedServiceAvailable: true, recommendedCompatibleWithCart: false
})
assert.equal(incompatible.outcome, 'APPLIED')
assert.equal(incompatible.state.flow, 'INCOMPATIBLE_SERVICE_DECISION')
assert.deepEqual(incompatible.state.cart, [{ serviceId: 'cut' }], 'complemento incompatible queda separado')
const skipped = transition(recommendationState, { actionType: 'recommendation.skip', entityRef: null, payload: null }, {
  dbNowIso: '2026-08-26T12:00:00Z', recommendedServiceId: 'color'
})
assert.deepEqual(skipped.state.rejectedRecommendationIds, ['color'])
assert.deepEqual(skipped.state.cart, [{ serviceId: 'cut' }], 'rechazar recomendación no muta carrito')

const professionalState = { ...recommendationState, flow: 'PROFESSIONAL_SELECT' as const }
const exhausted = transition(professionalState, { actionType: 'professional.any', entityRef: null, payload: null }, {
  dbNowIso: '2026-08-26T12:00:00Z', noAvailabilityInHorizon: true
})
assert.equal(exhausted.outcome, 'HANDOFF')
if (exhausted.outcome === 'HANDOFF') {
  assert.deepEqual(exhausted.effects.map((effect) => effect.kind), ['REQUEST_HUMAN_HANDOFF', 'EMIT_OPERATIONAL_ALERT'])
}

const slotState = {
  ...recommendationState,
  flow: 'SLOT_SELECT' as const,
  selections: { ...recommendationState.selections, anyProfessional: true, date: '2026-08-30' }
}
const toSummary = transition(slotState, { actionType: 'slot.select', entityRef: null, payload: { startAt: '2026-08-30T15:00:00Z' } }, {
  dbNowIso: '2026-08-26T12:00:00Z', slotAvailable: true,
  confirmVisitSnapshot: { services: [], professional: { professionalId: 'p1', name: 'Uno', assignedByBalancer: true }, totalDurationMinutes: 30, totalPriceMinor: 1500 }
})
assert.equal(toSummary.outcome, 'APPLIED')
if (toSummary.outcome === 'APPLIED') assert.deepEqual(toSummary.effects, [], 'llegar al resumen no crea efectos de agenda')

console.log('OK F6.3–F6.8 pure: carrito, invalidación, configuración, cortes, DST, paginación y balance determinístico.')
