import assert from 'node:assert/strict'
import {
  createInitialBotOptionsState,
  type BotOptionsState
} from '../src/bot-options/domain/state.js'
import {
  transition,
  renderCurrentView,
  normalizeContext,
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

// F5.2: Menú sin progreso vuelve directo; con progreso exige descarte y Volver restaura en una interacción.
const directHome = transition(stateWith({ flow: 'BUSINESS_HOURS' }), act('navigation.home'), ctx())
assert.equal(directHome.outcome, 'APPLIED')
if (directHome.outcome === 'APPLIED') assert.equal(directHome.state.flow, 'MAIN_MENU')

const progressedCatalog = stateWith({
  flow: 'CATEGORY_SELECT',
  cart: [{ serviceId: 'srv_progress' }],
  catalogMode: 'BOOKING'
})
const askDiscard = transition(progressedCatalog, act('navigation.home'), ctx())
assert.equal(askDiscard.outcome, 'APPLIED')
if (askDiscard.outcome === 'APPLIED') {
  assert.equal(askDiscard.state.flow, 'DISCARD_CONFIRM')
  assert.equal(askDiscard.state.discardReturnFlow, 'CATEGORY_SELECT')
  assert.deepEqual(askDiscard.view.choices.map((choice) => choice.actionType), ['draft.restart', 'navigation.back'])
  const keepProgress = transition(askDiscard.state, act('navigation.back'), ctx())
  assert.equal(keepProgress.outcome, 'APPLIED')
  if (keepProgress.outcome === 'APPLIED') {
    assert.equal(keepProgress.state.flow, 'CATEGORY_SELECT')
    assert.equal(keepProgress.state.discardReturnFlow, null)
    assert.deepEqual(keepProgress.state.cart, [{ serviceId: 'srv_progress' }])
  }
  const discard = transition(askDiscard.state, act('draft.restart'), ctx())
  assert.equal(discard.outcome, 'APPLIED')
  if (discard.outcome === 'APPLIED') {
    assert.equal(discard.state.flow, 'MAIN_MENU')
    assert.deepEqual(discard.state.cart, [])
  }
}

const compactNavigation = transition(stateWith({ flow: 'SERVICE_SELECT' }), act('navigation.open'), ctx())
assert.equal(compactNavigation.outcome, 'APPLIED')
if (compactNavigation.outcome === 'APPLIED') {
  assert.equal(compactNavigation.state.presentation.kind, 'navigation_menu')
  assert.deepEqual(compactNavigation.view.choices.map((choice) => choice.actionType), [
    'navigation.back', 'navigation.home', 'handoff.request', 'navigation.close'
  ])
  const close = transition(compactNavigation.state, act('navigation.close'), ctx())
  assert.equal(close.outcome, 'APPLIED')
  if (close.outcome === 'APPLIED') assert.equal(close.state.flow, 'SERVICE_SELECT')
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

// ─── F5.5 — Conversión desde detalle de servicio ─────────────────────────────

// 1) Servicio reservable (no requiere consulta): service.book agrega al carrito.
const detailBookable = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_corte' } })
const bookResult = transition(
  detailBookable,
  act('service.book', { entityRef: { type: 'SERVICE', id: 'srv_corte' } }),
  ctx({
    serviceActive: true,
    serviceBookable: true,
    requiresConsultation: false,
    serviceCompatibleWithCart: true,
    serviceInCart: false,
    customerNameOnFile: 'Ana',
    labels: { serviceName: 'Corte' }
  })
)
assert.equal(bookResult.outcome, 'APPLIED')
if (bookResult.outcome === 'APPLIED') {
  assert.deepEqual(bookResult.state.cart, [{ serviceId: 'srv_corte' }])
  assert.ok(bookResult.state.flow === 'CART_REVIEW' || bookResult.state.flow === 'RECOMMENDATION_SELECT',
    'después de reservar va a CART_REVIEW o RECOMMENDATION_SELECT')
}

// 2) Servicio que requiere consulta: service.consult deriva a handoff con contexto.
const detailConsult = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_color' } })
const consultResult = transition(
  detailConsult,
  act('service.consult', { entityRef: { type: 'SERVICE', id: 'srv_color' } }),
  ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: true, labels: { serviceName: 'Coloración' } })
)
assert.equal(consultResult.outcome, 'HANDOFF')
if (consultResult.outcome === 'HANDOFF') {
  assert.equal(consultResult.state.flow, 'HANDOFF_QUEUED')
  assert.equal(consultResult.state.handoff, 'QUEUED')
  const handoffEffect = consultResult.effects.find((e) => e.kind === 'REQUEST_HUMAN_HANDOFF')
  assert.ok(handoffEffect, 'debe emitir REQUEST_HUMAN_HANDOFF')
  if (handoffEffect?.kind === 'REQUEST_HUMAN_HANDOFF') {
    assert.equal(handoffEffect.reason, 'servicio_requiere_consulta_previa')
    assert.equal(handoffEffect.detail, 'Coloración')
    assert.deepEqual(handoffEffect.context, { serviceId: 'srv_color' })
  }
}

// 3) Servicio ausente o desactivado concurrentemente: service.book NO usa snapshot stale.
const detailStale = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_ghost' } })
const staleResult = transition(
  detailStale,
  act('service.book', { entityRef: { type: 'SERVICE', id: 'srv_ghost' } }),
  ctx({
    serviceActive: false,
    serviceBookable: false,
    requiresConsultation: false,
    labels: { serviceName: 'Fantasma' }
  })
)
assert.equal(staleResult.outcome, 'RECOVERED')
if (staleResult.outcome === 'RECOVERED') {
  assert.equal(staleResult.reason, 'entity_inactive')
  assert.ok(staleResult.view.interactiveBody!.includes('ya no está disponible'))
}

// 4) Vista SERVICE_DETAIL ofrece Reservar cuando el servicio es reservable.
const viewBookable = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'svc-bookable' } })
const vbView = renderCurrentView(viewBookable, normalizeContext(ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: false, labels: { serviceName: 'Corte' } })))
{
  const bookChoice = vbView.choices.find((c) => c.actionType === 'service.book')
  assert.ok(bookChoice, 'vista reservable debe ofrecer service.book')
  assert.equal(bookChoice?.label, 'Reservar este servicio')
  assert.deepEqual(bookChoice?.entityRef, { type: 'SERVICE', id: 'svc-bookable' }, 'service.book choice carries entityRef')
  const consultChoice = vbView.choices.find((c) => c.actionType === 'service.consult')
  assert.ok(!consultChoice, 'vista reservable NO debe ofrecer service.consult')
}

// 5) Vista SERVICE_DETAIL ofrece Consultar cuando el servicio requiere consulta.
const viewConsult = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'svc-consult' } })
const vcView = renderCurrentView(viewConsult, normalizeContext(ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: true, labels: { serviceName: 'Coloración' } })))
{
  const consultChoice = vcView.choices.find((c) => c.actionType === 'service.consult')
  assert.ok(consultChoice, 'vista con consulta debe ofrecer service.consult')
  assert.equal(consultChoice?.label, 'Consultar con el equipo')
  assert.deepEqual(consultChoice?.entityRef, { type: 'SERVICE', id: 'svc-consult' }, 'service.consult choice carries entityRef')
  const bookChoice = vcView.choices.find((c) => c.actionType === 'service.book')
  assert.ok(!bookChoice, 'vista con consulta NO debe ofrecer service.book')
}

// 6) Vista SERVICE_DETAIL inactiva no ofrece acciones de conversión.
const viewInactive = stateWith({ flow: 'SERVICE_DETAIL' })
const viView = renderCurrentView(viewInactive, normalizeContext(ctx({ serviceActive: false, serviceBookable: false, requiresConsultation: false, labels: { serviceName: 'Desactivado' } })))
{
  const bookChoice = viView.choices.find((c) => c.actionType === 'service.book')
  const consultChoice = viView.choices.find((c) => c.actionType === 'service.consult')
  assert.ok(!bookChoice, 'vista inactiva NO debe ofrecer service.book')
  assert.ok(!consultChoice, 'vista inactiva NO debe ofrecer service.consult')
}

// 7) service.book en servicio que requiere consulta (sin nombre) still consulta handoff — safety net.
const detailConsultBook = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_color' } })
const consultBookResult = transition(
  detailConsultBook,
  act('service.book', { entityRef: { type: 'SERVICE', id: 'srv_color' } }),
  ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: true, labels: { serviceName: 'Coloración' } })
)
assert.equal(consultBookResult.outcome, 'HANDOFF')
if (consultBookResult.outcome === 'HANDOFF') {
  const handoffEffect = consultBookResult.effects.find((e) => e.kind === 'REQUEST_HUMAN_HANDOFF')
  assert.equal(handoffEffect?.kind, 'REQUEST_HUMAN_HANDOFF')
  if (handoffEffect?.kind === 'REQUEST_HUMAN_HANDOFF') {
    assert.equal(handoffEffect.reason, 'servicio_requiere_consulta_previa')
  }
}

// 8) service.book sin nombre en servicio reservable pide nombre primero.
const detailNoName = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_corte' } })
const noNameResult = transition(
  detailNoName,
  act('service.book', { entityRef: { type: 'SERVICE', id: 'srv_corte' } }),
  ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: false, customerNameOnFile: null })
)
assert.equal(noNameResult.outcome, 'APPLIED')
if (noNameResult.outcome === 'APPLIED') {
  assert.equal(noNameResult.state.flow, 'NAME_INPUT')
  assert.deepEqual(noNameResult.state.pendingEntityRef, { type: 'SERVICE', id: 'srv_corte' })
}

// 9) Una choice stale/forged no puede cambiar el servicio que originó el detalle.
const forgedDetailChoice = transition(
  stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_rendered' } }),
  act('service.consult', { entityRef: { type: 'SERVICE', id: 'srv_forged' } }),
  ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: true })
)
assert.equal(forgedDetailChoice.outcome, 'RECOVERED')
if (forgedDetailChoice.outcome === 'RECOVERED') {
  assert.equal(forgedDetailChoice.reason, 'entity_inactive')
  assert.equal(forgedDetailChoice.state.handoff, 'NONE')
}

// 10) service.consult sólo deriva si la revalidación vigente exige consulta.
const forgedConsultOnDirectService = transition(
  stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'srv_direct' } }),
  act('service.consult', { entityRef: { type: 'SERVICE', id: 'srv_direct' } }),
  ctx({ serviceActive: true, serviceBookable: true, requiresConsultation: false })
)
assert.equal(forgedConsultOnDirectService.outcome, 'RECOVERED')
if (forgedConsultOnDirectService.outcome === 'RECOVERED') {
  assert.equal(forgedConsultOnDirectService.reason, 'guard_failed')
  assert.equal(forgedConsultOnDirectService.state.handoff, 'NONE')
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
  assert.equal(coordinate.state.handoff, 'QUEUED')
  assert.deepEqual(coordinate.effects, [{ kind: 'REQUEST_HUMAN_HANDOFF', reason: 'coordinacion_multiprofesional', detail: 'Coloración', context: null }])
  si = coordinate.state
}

const cancelWait = transition(si, act('handoff.cancel'), ctx())
assert.equal(cancelWait.outcome, 'APPLIED')
if (cancelWait.outcome === 'APPLIED') {
  // Vuelve al paso pausado conservando el carrito y la propuesta pendiente.
  assert.equal(cancelWait.state.handoffReturnFlow, null)
  assert.equal(cancelWait.state.handoff, 'NONE')
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
    slotStartAt: slotPayload.startAt,
    appointmentId: null
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

const rejectionMissingReason = transition(sd, act('deposit.reject_resubmission'), ctx())
assert.equal(rejectionMissingReason.outcome, 'RECOVERED')
const resubmission = transition(
  sd,
  act('deposit.reject_resubmission', {
    payload: {
      reason: 'Comprobante ilegible',
      resubmissionDeadlineIso: '2026-08-25T14:00:00Z'
    }
  }),
  ctx()
)
assert.equal(resubmission.outcome, 'APPLIED')
if (resubmission.outcome === 'APPLIED') {
  assert.equal(resubmission.state.deposit, 'REJECTED_RESUBMISSION_ALLOWED')
  assert.equal(resubmission.state.booking, 'HELD')
  assert.deepEqual(resubmission.effects[0], {
    kind: 'REJECT_DEPOSIT_FOR_RESUBMISSION',
    reason: 'Comprobante ilegible',
    resubmissionExpiresAtIso: '2026-08-25T14:00:00Z'
  })
}
const finalMissingReason = transition(sd, act('deposit.reject_final'), ctx())
assert.equal(finalMissingReason.outcome, 'RECOVERED')

const homeDuringReview = transition(sd, act('navigation.home'), ctx())
if (homeDuringReview.outcome === 'RECOVERED') throw new Error('home en revisión debía aplicar')
assert.equal(homeDuringReview.state.flow, 'MAIN_MENU')
assert.equal(homeDuringReview.state.deposit, 'PROOF_RECEIVED', 'la revisión sigue viva desde el menú')

const approved = transition(homeDuringReview.state, act('deposit.approve'), ctx())
if (approved.outcome === 'RECOVERED') throw new Error('approve debía aplicar')
assert.equal(approved.state.deposit, 'APPROVED')
assert.equal(approved.state.booking, 'CONFIRMED')
assert.equal(approved.state.flow, 'BOOKING_CONFIRMED')
assert.equal(approved.effects[0]?.kind, 'APPROVE_DEPOSIT')

const requestedHandoff = transition(createInitialBotOptionsState(), act('handoff.request'), ctx())
if (requestedHandoff.outcome === 'RECOVERED') throw new Error('handoff.request debía aplicar')
assert.equal(requestedHandoff.state.flow, 'HANDOFF_QUEUED')
assert.equal(requestedHandoff.state.handoff, 'QUEUED')
const takenHandoff = transition(requestedHandoff.state, act('handoff.take'), ctx())
if (takenHandoff.outcome === 'RECOVERED') throw new Error('handoff.take debía aplicar')
assert.equal(takenHandoff.effects[0]?.kind, 'TAKE_HUMAN_HANDOFF')
const resolvedHandoff = transition(takenHandoff.state, act('handoff.resolve_home'), ctx())
if (resolvedHandoff.outcome === 'RECOVERED') throw new Error('handoff.resolve_home debía aplicar')
assert.deepEqual(resolvedHandoff.effects[0], { kind: 'RESOLVE_HANDOFF', mode: 'HOME' })

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

// F3.6: una acción válida reinicia el contador dentro del nuevo estado.
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

// ─── Conflicto de slot en resumen ─────────────────────────────────────────────

const conflict = transition(sd, act('booking.slot_conflict', { payload: { startAt: slotPayload.startAt } }), ctx())
if (conflict.outcome === 'APPLIED') {
  assert.equal(conflict.state.flow, 'SLOT_SELECT')
  assert.equal(conflict.state.selections.slotStartAt, null)
}

// ─── Reprogramación conserva turno, fecha y slot seleccionados ────────────────

const appointmentId = 'apt_1'
let sa = stateWith({ flow: 'APPOINTMENT_LIST' })
let ar = transition(
  sa,
  act('appointment.select', { entityRef: { type: 'APPOINTMENT', id: appointmentId } }),
  ctx({ appointmentOwnedAndFuture: true })
)
if (ar.outcome === 'APPLIED') sa = ar.state
assert.equal(sa.selections.appointmentId, appointmentId)

ar = transition(
  sa,
  act('appointment.reschedule', { entityRef: { type: 'APPOINTMENT', id: appointmentId } }),
  ctx({ appointmentOwnedAndFuture: true, rescheduleAllowed: true })
)
if (ar.outcome === 'APPLIED') sa = ar.state
assert.equal(sa.flow, 'APPOINTMENT_RESCHEDULE_DATE')

ar = transition(
  sa,
  act('appointment.date_select', {
    entityRef: { type: 'APPOINTMENT', id: appointmentId },
    payload: { date: '2026-09-03' }
  }),
  ctx({ rescheduleDateAvailable: true })
)
if (ar.outcome === 'APPLIED') sa = ar.state
assert.equal(sa.selections.date, '2026-09-03')

const newSlot = '2026-09-03T16:00:00-03:00'
ar = transition(
  sa,
  act('appointment.slot_select', {
    entityRef: { type: 'APPOINTMENT', id: appointmentId },
    payload: { startAt: newSlot }
  }),
  ctx({ rescheduleSlotAvailable: true })
)
if (ar.outcome === 'APPLIED') sa = ar.state
assert.equal(sa.selections.slotStartAt, newSlot)

ar = transition(
  sa,
  act('appointment.reschedule_confirm', { entityRef: { type: 'APPOINTMENT', id: appointmentId } }),
  ctx({ rescheduleSlotAvailable: true, approvedDepositTransferable: true })
)
assert.equal(ar.outcome, 'APPLIED')
if (ar.outcome === 'APPLIED') {
  const swap = ar.effects.find((effect) => effect.kind === 'SWAP_APPOINTMENT_SLOT')
  assert.ok(swap && swap.kind === 'SWAP_APPOINTMENT_SLOT')
  assert.equal(swap.newSlotStartAt, newSlot)
  assert.equal(swap.appointmentId, appointmentId)
}

// ─── F5.5 Round-trip: entityRef survives renderWhatsAppScreen → choiceMappings ──

import { renderWhatsAppScreen } from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import { generatePromptToken } from '../src/bot-options/domain/prompt-tokens.js'

// SERVICE_DETAIL view with entityRef on book choice
const rtState = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'svc_rt' } })
const rtView = renderCurrentView(rtState, normalizeContext(ctx({
  serviceActive: true, serviceBookable: true, requiresConsultation: false,
  labels: { serviceName: 'Corte RT' }
})))
const rtRendered = renderWhatsAppScreen(rtView, { promptToken: generatePromptToken() })

// Must have at least one choice mapping
assert.ok(rtRendered.choiceMappings.length > 0, 'round-trip must produce choiceMappings')

// Find the service.book mapping
const bookMapping = rtRendered.choiceMappings.find((m) => m.actionType === 'service.book')
assert.ok(bookMapping, 'round-trip must have service.book mapping')
assert.equal(bookMapping.entityType, 'SERVICE', 'entityType must be SERVICE')
assert.equal(bookMapping.entityId, 'svc_rt', 'entityId must match')
assert.equal(bookMapping.actionType, 'service.book', 'actionType preserved')
assert.equal(bookMapping.labelSnapshot, 'Reservar este servicio', 'labelSnapshot preserved')

// SERVICE_DETAIL view with entityRef on consult choice
const rtConsultState = stateWith({ flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE', id: 'svc_rt_consult' } })
const rtConsultView = renderCurrentView(rtConsultState, normalizeContext(ctx({
  serviceActive: true, serviceBookable: true, requiresConsultation: true,
  labels: { serviceName: 'Coloración RT' }
})))
const rtConsultRendered = renderWhatsAppScreen(rtConsultView, { promptToken: generatePromptToken() })
const consultMapping = rtConsultRendered.choiceMappings.find((m) => m.actionType === 'service.consult')
assert.ok(consultMapping, 'round-trip must have service.consult mapping')
assert.equal(consultMapping.entityType, 'SERVICE', 'consult entityType must be SERVICE')
assert.equal(consultMapping.entityId, 'svc_rt_consult', 'consult entityId must match')

console.log('OK bot-options transition: round-trip entityRef survives renderWhatsAppScreen → choiceMappings.')

console.log('OK bot-options transition: navegación, reserva, señas, escalación y silencio cumplen el contrato.')
