import assert from 'node:assert/strict'
import {
  createInitialBotOptionsState,
  type BotOptionsState
} from '../src/bot-options/domain/state.js'
import {
  transition,
  type NormalizedAction,
  type TransitionContext
} from '../src/bot-options/domain/transition.js'

const NOW = '2026-08-25T12:00:00Z'

function ctx(overrides: Partial<TransitionContext> = {}): Partial<TransitionContext> & Pick<TransitionContext, 'dbNowIso'> {
  return { dbNowIso: NOW, ...overrides }
}

function act(actionType: NormalizedAction['actionType'], extra: Partial<NormalizedAction> = {}): NormalizedAction {
  return { actionType, entityRef: null, payload: null, ...extra }
}

function service(id: string): NormalizedAction {
  return act('service.select', { entityRef: { type: 'SERVICE', id } })
}

let seq = 0
function stateWith(patch: Partial<BotOptionsState>): BotOptionsState {
  seq += 1
  void seq
  return { ...createInitialBotOptionsState(), ...patch }
}

// ─── Menú principal ───────────────────────────────────────────────────────────

const menu = createInitialBotOptionsState()

const askName = transition(menu, act('menu.start_booking'), ctx())
if (askName.outcome === 'RECOVERED') throw new Error('start_booking debía aplicar')
assert.equal(askName.state.flow, 'NAME_INPUT')

const knownName = transition(menu, act('menu.start_booking'), ctx({ customerNameOnFile: 'Martina' }))
if (!(knownName.outcome === 'APPLIED' || knownName.outcome === 'HANDOFF')) throw new Error('unreachable')
assert.equal((knownName as Extract<typeof knownName, { outcome: 'APPLIED' | 'HANDOFF' }>).state.flow, 'CATEGORY_SELECT')

const browsing = transition(menu, act('menu.browse_services'), ctx())
if (browsing.outcome === 'APPLIED') assert.equal(browsing.state.catalogMode, 'BROWSING')
else throw new Error('browse debía aplicar')

const hours = transition(menu, act('menu.business_hours'), ctx())
if (hours.outcome === 'APPLIED') assert.equal(hours.state.flow, 'BUSINESS_HOURS')
else throw new Error('hours debía aplicar')

const noAppointments = transition(menu, act('menu.manage_appointment'), ctx({ appointmentsExist: false }))
assert.equal(noAppointments.outcome, 'RECOVERED')
if (noAppointments.outcome === 'RECOVERED') {
  assert.equal(noAppointments.reason, 'guard_failed')
  assert.deepEqual(
    noAppointments.view.choices.map((choice) => choice.actionType),
    ['menu.start_booking']
  )
}

// ─── Nombre ───────────────────────────────────────────────────────────────────

const named = transition(stateWith({ flow: 'NAME_INPUT' }), act('name.submit', { payload: { name: 'Ana María' } }), ctx())
assert.equal(named.outcome, 'APPLIED')
if (named.outcome === 'APPLIED') {
  assert.equal(named.state.flow, 'NAME_CONFIRM')
  assert.equal(named.state.nameCandidate, 'Ana María')
}

const badName = transition(stateWith({ flow: 'NAME_INPUT' }), act('name.submit', { payload: {} }), ctx())
assert.equal(badName.outcome, 'RECOVERED')
assert.equal(badName.state.invalidStreak, 1)

const confirmedName = transition(
  stateWith({ flow: 'NAME_CONFIRM', nameCandidate: 'Ana María' }),
  act('name.confirm'),
  ctx()
)
assert.equal(confirmedName.outcome, 'APPLIED')
if (confirmedName.outcome === 'APPLIED') {
  assert.equal(confirmedName.state.flow, 'CATEGORY_SELECT')
  assert.deepEqual(confirmedName.effects, [{ kind: 'PERSIST_CUSTOMER_NAME', name: 'Ana María' }])
}

// ─── Recorrido de reserva sin seña ────────────────────────────────────────────

let s = createInitialBotOptionsState()
let r = transition(s, act('menu.start_booking'), ctx({ customerNameOnFile: 'Ana' }))
s = r.outcome !== 'RECOVERED' ? r.state : s
assert.equal(s.flow, 'CATEGORY_SELECT')

r = transition(
  s,
  act('category.select', { entityRef: { type: 'CATEGORY', id: 'cat_1' } }),
  ctx({ categoryActive: true, categoryHasServices: true })
)
if (r.outcome === 'RECOVERED') throw new Error('categoría válida debía aplicar')
s = r.state
assert.equal(s.flow, 'SERVICE_SELECT')

r = transition(s, service('srv_corte'), ctx({ serviceActive: true, serviceBookable: true, serviceCompatibleWithCart: true }))

r = transition(
  s,
  service('srv_corte'),
  ctx({ serviceActive: true, serviceBookable: true, serviceCompatibleWithCart: true, hasRecommendations: true })
)
assert.equal(r.outcome, 'APPLIED')
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.flow, 'RECOMMENDATION_SELECT')
assert.deepEqual(s.cart, [{ serviceId: 'srv_corte' }])

r = transition(s, act('recommendation.skip'), ctx({ hasRecommendations: true }))
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.flow, 'CART_REVIEW')

r = transition(s, act('cart.continue'), ctx({ professionalCommonExists: true }))
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.flow, 'PROFESSIONAL_SELECT')
assert.equal(s.selections.professionalId, null)

r = transition(s, act('professional.any'), ctx())
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.selections.anyProfessional, true)
assert.equal(s.flow, 'DATE_SELECT')

r = transition(s, act('date.select', { payload: { date: '2026-09-02' } }), ctx({ dateAvailable: true }))
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.selections.date, '2026-09-02')
assert.equal(s.flow, 'SLOT_SELECT')

const slotPayload = { startAt: '2026-09-02T15:00:00-03:00' }
r = transition(s, act('slot.select', { payload: slotPayload }), ctx({ slotAvailable: true }))
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.flow, 'BOOKING_SUMMARY')
assert.equal(s.selections.slotStartAt, slotPayload.startAt)

// Volver desde el resumen borra el horario y regresa a horarios.
r = transition(s, act('navigation.back'), ctx())
assert.equal(r.outcome, 'APPLIED')
if (r.outcome === 'APPLIED') s = r.state
assert.equal(s.flow, 'SLOT_SELECT')
assert.equal(s.selections.slotStartAt, null)

r = transition(s, act('slot.select', { payload: slotPayload }), ctx({ slotAvailable: true }))
if (r.outcome === 'APPLIED') s = r.state

const confirmed = transition(
  s,
  act('booking.confirm'),
  ctx({
    slotStillAvailableAtConfirm: true,
    confirmVisitSnapshot: {
      services: [
        { serviceId: 'srv_corte', name: 'Corte', durationMinutes: 45, priceMinor: 2000000, priceMode: 'FIXED' }
      ],
      professional: { professionalId: 'pro_tamara', name: 'Tamara', assignedByBalancer: true },
      totalDurationMinutes: 45,
      totalPriceMinor: 2000000
    },
    labels: { professionalName: 'Tamara' }
  })
)
assert.equal(confirmed.outcome, 'APPLIED')
if (confirmed.outcome === 'APPLIED') {
  assert.equal(confirmed.state.flow, 'BOOKING_CONFIRMED')
  assert.equal(confirmed.state.booking, 'CONFIRMED')
  assert.equal(confirmed.effects[0]?.kind, 'CONFIRM_VISIT')
}

// ─── Servicio incompatible ────────────────────────────────────────────────────

let si = stateWith({
  flow: 'SERVICE_SELECT',
  cart: [{ serviceId: 'srv_corte' }]
})
const incompatible = transition(si, service('srv_color'), ctx({ serviceActive: true, serviceBookable: true, serviceCompatibleWithCart: false }))
assert.equal(incompatible.outcome, 'APPLIED')
if (incompatible.outcome === 'APPLIED') si = incompatible.state
assert.equal(si.flow, 'INCOMPATIBLE_SERVICE_DECISION')
assert.deepEqual(si.pendingEntityRef, { type: 'SERVICE', id: 'srv_color' })

const coordinate = transition(si, act('recommendation.add'), ctx({ labels: { serviceName: 'Coloración' } }))
assert.equal(coordinate.outcome, 'HANDOFF')
if (coordinate.outcome === 'HANDOFF') {
  assert.equal(coordinate.state.flow, 'HANDOFF_QUEUED')
  assert.deepEqual(coordinate.effects, [{ kind: 'REQUEST_HUMAN_HANDOFF', reason: 'coordinacion_multiprofesional', detail: 'Coloración' }])
  si = coordinate.state
}

const cancelWait = transition(si, act('handoff.cancel'), ctx())
assert.equal(cancelWait.outcome, 'APPLIED')
if (cancelWait.outcome === 'APPLIED') {
  // Vuelve al paso pausado conservando el carrito y la propuesta pendiente.
  assert.equal(cancelWait.state.handoffReturnFlow, null)
}

// ─── Seña ─────────────────────────────────────────────────────────────────────

let sd = stateWith({
  flow: 'BOOKING_SUMMARY',
  cart: [{ serviceId: 'srv_color' }],
  selections: {
    categoryId: null,
    professionalId: 'pro_1',
    anyProfessional: false,
    date: '2026-09-02',
    slotStartAt: slotPayload.startAt
  }
})

const held = transition(
  sd,
  act('booking.confirm'),
  ctx({
    slotStillAvailableAtConfirm: true,
    depositRequired: true,
    paymentConfigComplete: true,
    depositRequest: { amountMinor: 2600000, holdExpiresAtIso: '2026-08-25T14:00:00Z' },
    confirmVisitSnapshot: {
      services: [{ serviceId: 'srv_color', name: 'Coloración', durationMinutes: 90, priceMinor: 8000000, priceMode: 'FIXED' }],
      professional: { professionalId: 'pro_lucia', name: 'Lucía', assignedByBalancer: false },
      totalDurationMinutes: 90,
      totalPriceMinor: 8000000
    }
  })
)
assert.equal(held.outcome, 'APPLIED')
if (held.outcome === 'APPLIED') sd = held.state
assert.equal(sd.flow, 'DEPOSIT_INSTRUCTIONS')
assert.equal(sd.booking, 'HELD')
assert.equal(sd.deposit, 'PENDING_PROOF')
assert.equal(held.outcome === 'APPLIED' && held.effects[0]?.kind, 'HOLD_VISIT_WITH_DEPOSIT')

const proof = transition(sd, act('deposit.proof_received'), ctx())
if (proof.outcome === 'APPLIED') sd = proof.state
assert.equal(sd.flow, 'DEPOSIT_REVIEW')
assert.equal(sd.deposit, 'PROOF_RECEIVED')
assert.equal(sd.booking, 'PENDING_PAYMENT_REVIEW')

const homeDuringReview = transition(sd, act('navigation.home'), ctx())
if (homeDuringReview.outcome === 'RECOVERED') throw new Error('home en revisión debía aplicar')
assert.equal(homeDuringReview.state.flow, 'MAIN_MENU')
assert.equal(homeDuringReview.state.deposit, 'PROOF_RECEIVED', 'la revisión sigue viva desde el menú')

const approved = transition(homeDuringReview.state, act('deposit.approve'), ctx())
if (approved.outcome === 'RECOVERED') throw new Error('approve debía aplicar')
assert.equal(approved.state.deposit, 'APPROVED')
assert.equal(approved.state.booking, 'CONFIRMED')
assert.equal(approved.state.flow, 'BOOKING_CONFIRMED')

// Menú principal durante espera de comprobante abre cancelación protegida.
let sw = stateWith({ flow: 'DEPOSIT_INSTRUCTIONS', deposit: 'PENDING_PROOF', booking: 'HELD' })
sw.cart = [{ serviceId: 'srv_x' }]
const protectedHome = transition(sw, act('navigation.home'), ctx())
if (protectedHome.outcome === 'APPLIED') {
  assert.equal(protectedHome.state.flow, 'DEPOSIT_CANCEL_CONFIRM')
}
const cancelHold = transition(
  protectedHome.outcome === 'APPLIED' ? protectedHome.state : sw,
  act('deposit.cancel_confirm'),
  ctx()
)
if (cancelHold.outcome === 'APPLIED') {
  assert.equal(cancelHold.state.flow, 'MAIN_MENU')
  assert.equal(cancelHold.state.booking, 'CANCELLED')
  assert.equal(cancelHold.effects[0]?.kind, 'RELEASE_HOLD')
}

// ─── Escalación gradual ───────────────────────────────────────────────────────

let se = createInitialBotOptionsState()
for (let i = 0; i < 2; i += 1) {
  const step = transition(se, act('slot.select', { payload: { startAt: 'x' } }), ctx())
  assert.equal(step.outcome, 'RECOVERED')
  se = step.state
}
assert.equal(se.invalidStreak, 2)
const third = transition(se, act('slot.select', { payload: { startAt: 'x' } }), ctx())
assert.equal(third.outcome, 'HANDOFF')
if (third.outcome === 'HANDOFF') assert.equal(third.state.flow, 'HANDOFF_QUEUED')

// F4.8: una acción válida reinicia el contador dentro del nuevo estado.
let sr = createInitialBotOptionsState()
const firstInvalid = transition(sr, act('slot.select', { payload: { startAt: 'x' } }), ctx())
sr = firstInvalid.state
assert.equal(sr.invalidStreak, 1)
const validNow = transition(sr, act('menu.browse_services'), ctx({ categoryActive: true, categoryHasServices: true }))
if (validNow.outcome === 'APPLIED') sr = validNow.state
assert.equal(sr.invalidStreak, 0, 'la acción válida reinicia el contador')
// Y la cuenta vuelve a empezar por estado: dos errores nuevos recién destacan humano.
const again1 = transition(sr, act('slot.select', { payload: { startAt: 'x' } }), ctx())
assert.equal(again1.state.invalidStreak, 1)
const again2 = transition(again1.state, act('slot.select', { payload: { startAt: 'x' } }), ctx())
assert.equal(again2.outcome, 'RECOVERED')
if (again2.outcome === 'RECOVERED') {
  assert.equal(again2.state.invalidStreak, 2)
  assert.ok(again2.view.choices.some((choice) => choice.actionType === 'handoff.request'), 'segundo intento destaca atención humana')
}

// ─── Silencio con atención tomada ─────────────────────────────────────────────

const taken = stateWith({ flow: 'HANDOFF_TAKEN', handoff: 'TAKEN' })
const silent = transition(taken, act('menu.start_booking'), ctx())
assert.equal(silent.outcome, 'RECOVERED')
if (silent.outcome === 'RECOVERED') assert.equal(silent.respond, false)

// ─── Cutover: estado viejo arranca limpio ─────────────────────────────────────

const stale = transition(
  stateWith({ flow: 'CART_REVIEW', cart: [{ serviceId: 'srv_viejo' }] }),
  act('input.stale_cutover'),
  ctx()
)
if (stale.outcome === 'APPLIED') {
  assert.equal(stale.state.flow, 'MAIN_MENU')
  assert.deepEqual(stale.state.cart, [])
}

// ─── Conflicto de slot en resumen ─────────────────────────────────────────────

const conflict = transition(sd, act('booking.slot_conflict', { payload: { startAt: slotPayload.startAt } }), ctx())
if (conflict.outcome === 'APPLIED') {
  assert.equal(conflict.state.flow, 'SLOT_SELECT')
  assert.equal(conflict.state.selections.slotStartAt, null)
}

console.log('OK bot-options transition: navegación, reserva, señas, escalación y silencio cumplen el contrato.')
