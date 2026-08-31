import assert from 'node:assert/strict'
import {
  createInitialBotOptionsState,
  type BotOptionsState
} from '../src/bot-options/domain/state.js'
import {
  transition,
  mainMenuView,
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

const welcome = mainMenuView('Glow')
const approvedWelcome = [
  '¡Hola! 👋 Soy el asistente virtual de Glow.',
  '',
  'Desde este menú podés:',
  '✨ Sacar un turno.',
  '💅 Ver servicios y precios.',
  '🕒 Consultar horarios.',
  '📅 Ver, cambiar o cancelar un turno.',
  '💬 Hablar con alguien del equipo.',
  '',
  'Para empezar, elegí la opción que necesitás 👇'
].join('\n')
assert.equal(welcome.interactiveBody, approvedWelcome)
assert.deepEqual(welcome.informativeTexts, [], 'welcome must not be duplicated before the menu')
const welcomeScreen = renderWhatsAppScreen(welcome, { promptToken: 'w'.repeat(16) })
assert.equal(welcomeScreen.items.length, 1, 'welcome and menu travel together without a duplicate text message')
const welcomeItem = welcomeScreen.items[0]!
assert.equal(welcomeItem.type, 'interactive')
if (welcomeItem.type === 'interactive') {
  assert.equal(welcomeItem.body, approvedWelcome)
  assert.equal(welcomeItem.mode, 'list')
  assert.equal(welcomeItem.rows?.length, 5)
  assert.equal(welcomeItem.rows?.[3]?.title, 'Ver o cambiar un turno')
  assert.ok(welcomeItem.rows?.every((row) => [...row.title].length <= 24))
}
assert.deepEqual(welcomeScreen.choiceMappings.map((choice) => choice.actionType), welcome.choices.map((choice) => choice.actionType))
assert.equal(mainMenuView('Estética Lucía').interactiveBody, approvedWelcome.replace('Glow', 'Estética Lucía'))
assert.equal(mainMenuView().interactiveBody, '¿Qué querés hacer?')
assert.equal(renderCurrentView(menu, normalizeContext(ctx())).interactiveBody, '¿Qué querés hacer?', 'reset state alone must not repeat the introduction')
assert.deepEqual(welcome.choices.map(({ actionType, label }) => ({ actionType, label })), [
  { actionType: 'menu.start_booking', label: 'Sacar un turno' },
  { actionType: 'menu.browse_services', label: 'Ver servicios y precios' },
  { actionType: 'menu.business_hours', label: 'Consultar horarios' },
  { actionType: 'menu.manage_appointment', label: 'Ver o cambiar un turno' },
  { actionType: 'handoff.request', label: 'Hablar con el equipo' }
])

const askName = transition(menu, act('menu.start_booking'), ctx())
if (askName.outcome === 'RECOVERED') throw new Error('start_booking debía aplicar')
assert.equal(askName.state.flow, 'NAME_INPUT')

const knownName = transition(menu, act('menu.start_booking'), ctx({ customerNameOnFile: 'Martina' }))
if (!(knownName.outcome === 'APPLIED' || knownName.outcome === 'HANDOFF')) throw new Error('unreachable')
assert.equal((knownName as Extract<typeof knownName, { outcome: 'APPLIED' | 'HANDOFF' }>).state.flow, 'CATEGORY_SELECT')

const browsing = transition(menu, act('menu.browse_services'), ctx())
if (browsing.outcome === 'APPLIED') assert.equal(browsing.state.catalogMode, 'BROWSING')
else throw new Error('browse debía aplicar')

// Category copy lists only the current tenant-scoped page; selection remains interactive.
const categoryContext = normalizeContext(ctx({ labels: { catalogCategories: [
  { categoryId: 'cat_hair', label: 'Peluquería' },
  { categoryId: 'cat_nails', label: 'Uñas' }
] } }))
const bookingCategories = renderCurrentView(stateWith({ flow: 'CATEGORY_SELECT' }), categoryContext)
assert.equal(bookingCategories.interactiveBody, [
  '¡Vamos a sacar tu turno! ✨', '', '• Peluquería', '• Uñas', '',
  'Abrí el menú y elegí la categoría que te interesa 👇'
].join('\n'))
assert.deepEqual(bookingCategories.choices.filter((choice) => choice.actionType === 'category.select').map((choice) => choice.entityRef), [
  { type: 'CATEGORY', id: 'cat_hair' }, { type: 'CATEGORY', id: 'cat_nails' }
])
const browsingCategories = renderCurrentView(stateWith({ flow: 'CATEGORY_SELECT', catalogMode: 'BROWSING' }), categoryContext)
assert.equal(browsingCategories.interactiveBody, [
  'Conocé nuestros servicios ✨', '', '• Peluquería', '• Uñas', '',
  'Abrí el menú y elegí la categoría que te interesa 👇'
].join('\n'))
assert.deepEqual(browsingCategories.choices, bookingCategories.choices)
const nextCategoryPage = renderCurrentView(stateWith({ flow: 'CATEGORY_SELECT', presentation: { kind: 'catalog_page', cursor: 1 } }), normalizeContext(ctx({
  catalogCanPrevious: true, catalogCanNext: true,
  labels: { catalogCategories: [{ categoryId: 'other_tenant_category', label: 'Masajes' }] }
})))
assert.ok(nextCategoryPage.interactiveBody?.includes('• Masajes'))
assert.ok(!nextCategoryPage.interactiveBody?.includes('Peluquería'))
assert.ok(nextCategoryPage.choices.some((choice) => choice.actionType === 'catalog.previous_page'))
assert.ok(nextCategoryPage.choices.some((choice) => choice.actionType === 'catalog.next_page'))
const longCategoryLabel = 'Tratamientos especiales '.repeat(60).trim()
const longCategories = renderCurrentView(stateWith({ flow: 'CATEGORY_SELECT' }), normalizeContext(ctx({
  labels: { catalogCategories: [{ categoryId: 'long_category', label: longCategoryLabel }] }
})))
assert.ok(longCategories.interactiveBody?.includes(longCategoryLabel), 'full category names must not be silently truncated in the copy')
const longCategoryScreen = renderWhatsAppScreen(longCategories, { promptToken: 'c'.repeat(16) })
const renderedCategoryBody = longCategoryScreen.items.flatMap((item) => item.type === 'none' ? [] : [item.body])
assert.ok(renderedCategoryBody.every((body) => [...body].length <= 1024))
assert.equal(renderedCategoryBody.join(' ').replace(/\s+/g, ' ').trim(), longCategories.interactiveBody?.replace(/\s+/g, ' ').trim())
assert.equal(longCategoryScreen.items.at(-1)?.type, 'interactive')
assert.ok(longCategoryScreen.choiceMappings.some((choice) => choice.entityId === 'long_category'))

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
assert.equal(directHome.view.interactiveBody, '¿Qué querés hacer?', 'returning home must not repeat the introduction')

const progressedCatalog = stateWith({
  flow: 'CATEGORY_SELECT',
  cart: [{ serviceId: 'srv_progress' }],
  catalogMode: 'BOOKING'
})

for (const count of [0, 8, 9, 10, 15]) {
  const professionalSelectionState = stateWith({
    flow: 'PROFESSIONAL_SELECT', booking: 'DRAFT', cart: [{ serviceId: 'srv_corte' }],
    presentation: { kind: 'plain' }
  })
  const professionals = Array.from({ length: count }, (_, index) => ({ professionalId: `prof_${index}`, label: `Profesional ${index}` }))
  const firstPage = renderCurrentView(
    professionalSelectionState,
    normalizeContext(ctx({ labels: { bookingProfessionals: professionals } }))
  )
  assert.ok(firstPage.choices.length <= 10, `${count} profesionales no deben superar el límite de WhatsApp`)
  assert.ok(firstPage.choices.some((choice) => choice.actionType === 'professional.any'))
  assert.ok(firstPage.choices.some((choice) => choice.actionType === 'navigation.back'))
  assert.ok(firstPage.choices.some((choice) => choice.actionType === 'navigation.home'))
  assert.ok(firstPage.choices.some((choice) => choice.actionType === 'handoff.request'))
  if (count > 4) assert.ok(firstPage.choices.some((choice) => choice.actionType === 'professional.next_page'))
}

const pagedProfessionalState = stateWith({
  flow: 'PROFESSIONAL_SELECT', booking: 'DRAFT', cart: [{ serviceId: 'srv_corte' }],
  presentation: { kind: 'professional_list_page', cursor: 1 }
})
const bookingFifteenProfessionals = Array.from({ length: 15 }, (_, index) => ({ professionalId: `prof_${index}`, label: `Profesional ${index}` }))
const middleProfessionalPage = renderCurrentView(
  pagedProfessionalState,
  normalizeContext(ctx({ labels: { bookingProfessionals: bookingFifteenProfessionals } }))
)
assert.ok(middleProfessionalPage.choices.length <= 10)
assert.ok(middleProfessionalPage.choices.some((choice) => choice.actionType === 'professional.previous_page'))
assert.ok(middleProfessionalPage.choices.some((choice) => choice.actionType === 'professional.next_page'))
assert.ok(middleProfessionalPage.choices.some((choice) => choice.actionType === 'navigation.home'))

const bookingProfessionalsContext = normalizeContext(ctx({ labels: { bookingProfessionals: bookingFifteenProfessionals } }))
const advanceProfessionalPage = transition(
  stateWith({ flow: 'PROFESSIONAL_SELECT', booking: 'DRAFT', cart: [{ serviceId: 'srv_corte' }] }),
  act('professional.next_page'),
  bookingProfessionalsContext
)
assert.equal(advanceProfessionalPage.outcome, 'APPLIED')
if (advanceProfessionalPage.outcome === 'APPLIED') {
  assert.deepEqual(advanceProfessionalPage.state.presentation, { kind: 'professional_list_page', cursor: 1 })
  const returnProfessionalPage = transition(advanceProfessionalPage.state, act('professional.previous_page'), bookingProfessionalsContext)
  assert.equal(returnProfessionalPage.outcome, 'APPLIED')
  if (returnProfessionalPage.outcome === 'APPLIED') {
    assert.deepEqual(returnProfessionalPage.state.presentation, { kind: 'professional_list_page', cursor: 0 })
  }
}

for (const flow of ['RECOMMENDATION_SELECT', 'CART_REVIEW', 'DATE_SELECT', 'SLOT_SELECT', 'BOOKING_SUMMARY'] as const) {
  const view = renderCurrentView(
    stateWith({ flow, booking: 'DRAFT', cart: [{ serviceId: 'srv_corte' }] }),
    normalizeContext(ctx())
  )
  assert.ok(
    view.choices.some((choice) => choice.actionType === 'navigation.open' || choice.actionType === 'navigation.home'),
    `${flow} debe exponer navegación global`
  )
}
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
    assert.deepEqual(cancelWait.effects, [{ kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' }], 'customer cancellation carries no client-controlled handoff target')
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

const conflictBase = createInitialBotOptionsState()
const conflictPreservingCart = stateWith({
  flow: 'BOOKING_SUMMARY',
  booking: 'DRAFT',
  cart: [{ serviceId: 'slot-conflict-service' }],
  selections: {
    ...conflictBase.selections,
    professionalId: 'slot-conflict-professional',
    anyProfessional: false,
    date: '2026-08-27',
    slotStartAt: '2026-08-27T12:00:00.000Z'
  }
})
const preservedConflict = transition(
  conflictPreservingCart,
  act('booking.slot_conflict'),
  ctx({ labels: { availableSlots: [{ startAt: '2026-08-27T13:00:00.000Z', label: '13:00', band: 'AFTERNOON', professionalId: 'slot-conflict-professional' }] } })
)
if (preservedConflict.outcome !== 'APPLIED') throw new Error('booking slot conflict debe aplicar recuperación')
assert.deepEqual(preservedConflict.state.cart, conflictPreservingCart.cart, 'un slot ocupado no puede descartar el carrito')
assert.equal(preservedConflict.state.selections.professionalId, 'slot-conflict-professional', 'un slot ocupado conserva la preferencia profesional')
assert.equal(preservedConflict.state.selections.date, '2026-08-27', 'un slot ocupado conserva la fecha cuando quedan opciones')
assert.equal(preservedConflict.state.selections.slotStartAt, null, 'sólo el slot obsoleto se limpia')

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

// ─── F5.6 — Horario semanal informativo del negocio ──────────────────────────

// 1) BUSINESS_HOURS con texto de horario: envía informativeTexts
const hoursText = '*Lunes*: 09:00 a 18:00\n*Martes*: 09:00 a 18:00\n*Miércoles*: 09:00 a 18:00\n*Jueves*: 09:00 a 18:00\n*Viernes*: 09:00 a 18:00\n*Sábado*: 10:00 a 14:00\n*Domingo*: Cerrado'
const hoursViewWithContext = renderCurrentView(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  normalizeContext(ctx({ labels: { businessWeeklyHoursText: hoursText } }))
)
assert.equal(hoursViewWithContext.informativeTexts.length, 1, 'debe tener 1 informativeText')
assert.equal(hoursViewWithContext.informativeTexts[0], hoursText, 'informativeText debe ser el horario')
assert.equal(hoursViewWithContext.choices.length, 2, 'debe tener 2 choices')
assert.deepEqual(
  hoursViewWithContext.choices.map((c) => c.actionType),
  ['hours.professional', 'hours.search_availability'],
  'choices de BUSINESS_HOURS'
)
console.log('OK F5.6: BUSINESS_HOURS con texto informativo')

// 2) BUSINESS_HOURS sin texto: no agrega informativeTexts vacíos
const hoursViewEmpty = renderCurrentView(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  normalizeContext(ctx())
)
assert.equal(hoursViewEmpty.informativeTexts.length, 0, 'sin texto no agrega informativeTexts')
assert.equal(hoursViewEmpty.interactiveBody, '¿Qué querés ver?', 'interactiveBody unchanged')
console.log('OK F5.6: BUSINESS_HOURS sin texto informativo')

// 3) Transición menú → BUSINESS_HOURS genera nuevo estado
const hoursTransition = transition(
  createInitialBotOptionsState(),
  act('menu.business_hours'),
  ctx()
)
assert.equal(hoursTransition.outcome, 'APPLIED')
if (hoursTransition.outcome === 'APPLIED') {
  assert.equal(hoursTransition.state.flow, 'BUSINESS_HOURS')
  assert.equal(hoursTransition.state.invalidStreak, 0, 'acción válida reinicia streak')
}
console.log('OK F5.6: transición menú → BUSINESS_HOURS')

// 4) Volver desde BUSINESS_HOURS regresa a MAIN_MENU
const backFromHours = transition(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  act('navigation.back'),
  ctx()
)
assert.equal(backFromHours.outcome, 'APPLIED')
if (backFromHours.outcome === 'APPLIED') {
  assert.equal(backFromHours.state.flow, 'MAIN_MENU')
}
console.log('OK F5.6: back desde BUSINESS_HOURS → MAIN_MENU')

// 5) hours.professional desde BUSINESS_HOURS → PROFESSIONAL_HOURS_SELECT
const toProHours = transition(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  act('hours.professional'),
  ctx({ professionalSelectable: true })
)
assert.equal(toProHours.outcome, 'APPLIED')
if (toProHours.outcome === 'APPLIED') {
  assert.equal(toProHours.state.flow, 'PROFESSIONAL_HOURS_SELECT')
}
console.log('OK F5.6: hours.professional → PROFESSIONAL_HOURS_SELECT')

// 6) hours.search_availability desde BUSINESS_HOURS inicia booking path
const searchAvail = transition(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  act('hours.search_availability'),
  ctx({ customerNameOnFile: 'Ana' })
)
assert.equal(searchAvail.outcome, 'APPLIED')
if (searchAvail.outcome === 'APPLIED') {
  assert.ok(
    searchAvail.state.flow === 'CATEGORY_SELECT' || searchAvail.state.flow === 'NAME_INPUT',
    'search_availability inicia booking path'
  )
}
console.log('OK F5.6: hours.search_availability inicia booking path')

// 7) BUSINESS_HOURS no crea draft ni revela agenda
// (validación estática: la vista no contiene entityRef ni payload de appointment)
const hoursChoices = renderCurrentView(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  normalizeContext(ctx())
)
for (const choice of hoursChoices.choices) {
  assert.ok(!choice.entityRef, `choice ${choice.actionType} no debe tener entityRef`)
  assert.ok(!choice.payload, `choice ${choice.actionType} no debe tener payload`)
}
console.log('OK F5.6: BUSINESS_HOURS no crea draft ni revela agenda')

// ─── F5.7 — Horario semanal de profesionales ─────────────────────────────────

// 1) PROFESSIONAL_HOURS_SELECT stores pendingEntityRef as PROFESSIONAL type
const profSelectState = stateWith({ flow: 'PROFESSIONAL_HOURS_SELECT' })
const profSelectResult = transition(
  profSelectState,
  act('hours.professional_select', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalActive: true, professionalBookable: true, labels: { professionalName: 'Ana' } })
)
assert.equal(profSelectResult.outcome, 'APPLIED')
if (profSelectResult.outcome === 'APPLIED') {
  assert.equal(profSelectResult.state.flow, 'PROFESSIONAL_HOURS_DETAIL')
  assert.deepEqual(profSelectResult.state.pendingEntityRef, { type: 'PROFESSIONAL', id: 'prof_ana' },
    'pendingEntityRef stores PROFESSIONAL type, not SERVICE')
}
console.log('OK F5.7: pendingEntityRef stores PROFESSIONAL type')

// 2) PROFESSIONAL_HOURS_DETAIL choices carry entityRef
const profDetailState = stateWith({
  flow: 'PROFESSIONAL_HOURS_DETAIL',
  pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' }
})
const profDetailView = renderCurrentView(profDetailState, normalizeContext(ctx({
  professionalActive: true, professionalBookable: true, labels: { professionalName: 'Ana' }
})))
const searchChoice = profDetailView.choices.find((c) => c.actionType === 'hours.professional_search_availability')
assert.ok(searchChoice, 'reservable: has professional_search_availability choice')
assert.deepEqual(searchChoice?.entityRef, { type: 'PROFESSIONAL', id: 'prof_ana' },
  'professional_search_availability carries PROFESSIONAL entityRef')

const nonBookableDetailView = renderCurrentView(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_carlos' } }),
  normalizeContext(ctx({ professionalActive: true, professionalBookable: false, labels: { professionalName: 'Carlos' } }))
)
const consultChoice = nonBookableDetailView.choices.find((c) => c.actionType === 'hours.professional_consult_human')
assert.ok(consultChoice, 'no reservable: has professional_consult_human choice')
assert.deepEqual(consultChoice?.entityRef, { type: 'PROFESSIONAL', id: 'prof_carlos' },
  'professional_consult_human carries PROFESSIONAL entityRef')
console.log('OK F5.7: PROFESSIONAL_HOURS_DETAIL choices carry entityRef')

// 3) hours.professional_consult_human from detail triggers handoff
const consultHumanResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalActive: true, labels: { professionalName: 'Ana' } })
)
assert.equal(consultHumanResult.outcome, 'HANDOFF')
if (consultHumanResult.outcome === 'HANDOFF') {
  assert.equal(consultHumanResult.state.flow, 'HANDOFF_QUEUED')
  assert.equal(consultHumanResult.state.handoff, 'QUEUED')
  const handoffEffect = consultHumanResult.effects.find((e) => e.kind === 'REQUEST_HUMAN_HANDOFF')
  assert.ok(handoffEffect, 'must emit REQUEST_HUMAN_HANDOFF')
  if (handoffEffect?.kind === 'REQUEST_HUMAN_HANDOFF') {
    assert.equal(handoffEffect.reason, 'profesional_no_reservable_por_bot')
  }
}
console.log('OK F5.7: hours.professional_consult_human triggers handoff')

// 4) hours.professional_consult_human fails if professional not active (stale)
const staleConsultResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ghost' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ghost' } }),
  ctx({ professionalActive: false })
)
assert.equal(staleConsultResult.outcome, 'RECOVERED')
if (staleConsultResult.outcome === 'RECOVERED') {
  assert.equal(staleConsultResult.reason, 'entity_inactive')
}
console.log('OK F5.7: hours.professional_consult_human fails on stale professional')

// 5) hours.professional_search_availability from detail fails if not bookable
const notBookableSearchResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_carlos' } }),
  act('hours.professional_search_availability', { entityRef: { type: 'PROFESSIONAL', id: 'prof_carlos' } }),
  ctx({ professionalBookable: false, professionalActive: true })
)
assert.equal(notBookableSearchResult.outcome, 'RECOVERED')
if (notBookableSearchResult.outcome === 'RECOVERED') {
  assert.equal(notBookableSearchResult.reason, 'guard_failed')
}
console.log('OK F5.7: hours.professional_search_availability fails if not bookable')

// 6) hours.professional_search_availability from detail does NOT mutate draft/booking selections
const searchAvailResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.professional_search_availability', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalBookable: true, professionalActive: true, customerNameOnFile: 'Test' })
)
assert.ok(searchAvailResult.outcome === 'APPLIED' || searchAvailResult.outcome === 'HANDOFF')
if (searchAvailResult.outcome === 'APPLIED') {
  assert.equal(searchAvailResult.state.booking, 'NONE', 'booking NOT mutated')
  assert.equal(searchAvailResult.state.deposit, 'NONE', 'deposit NOT mutated')
}
console.log('OK F5.7: hours.professional_search_availability does NOT mutate draft/booking')

// 7) Round-trip: PROFESSIONAL entityRef survives renderWhatsAppScreen
const rtProfState = stateWith({
  flow: 'PROFESSIONAL_HOURS_DETAIL',
  pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_rt' }
})
const rtProfView = renderCurrentView(rtProfState, normalizeContext(ctx({
  professionalActive: true, professionalBookable: true, labels: { professionalName: 'RT Prof' }
})))
const rtProfRendered = renderWhatsAppScreen(rtProfView, { promptToken: generatePromptToken() })
const rtSearchMapping = rtProfRendered.choiceMappings.find((m) => m.actionType === 'hours.professional_search_availability')
assert.ok(rtSearchMapping, 'round-trip: hours.professional_search_availability mapping exists')
assert.equal(rtSearchMapping?.entityType, 'PROFESSIONAL', 'round-trip: entityType is PROFESSIONAL')
assert.equal(rtSearchMapping?.entityId, 'prof_rt', 'round-trip: entityId matches')
console.log('OK F5.7: round-trip PROFESSIONAL entityRef survives renderWhatsAppScreen')

// 8) hours.choose_other_professional clears pendingEntityRef
const chooseOtherResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.choose_other_professional'),
  ctx()
)
assert.equal(chooseOtherResult.outcome, 'APPLIED')
if (chooseOtherResult.outcome === 'APPLIED') {
  assert.equal(chooseOtherResult.state.flow, 'PROFESSIONAL_HOURS_SELECT')
  assert.equal(chooseOtherResult.state.pendingEntityRef, null, 'pendingEntityRef cleared')
}
console.log('OK F5.7: hours.choose_other_professional clears pendingEntityRef')

// 9) PROFESSIONAL_HOURS_DETAIL inactive professional → recovery
const inactiveProfResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_inactive' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_inactive' } }),
  ctx({ professionalActive: false })
)
assert.equal(inactiveProfResult.outcome, 'RECOVERED')
console.log('OK F5.7: inactive professional → recovery')

// 10) P0 cart contamination: pendingEntityRef PROFESSIONAL in name.confirm must NOT enter cart
const profNameConfirmState = stateWith({
  flow: 'NAME_CONFIRM',
  nameCandidate: 'Juan',
  pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' }
})
const profNameConfirmResult = transition(
  profNameConfirmState,
  act('name.confirm'),
  ctx({ professionalActive: true, professionalBookable: true, labels: { professionalName: 'Ana' } })
)
assert.equal(profNameConfirmResult.outcome, 'APPLIED')
if (profNameConfirmResult.outcome === 'APPLIED') {
  assert.equal(profNameConfirmResult.state.cart.length, 0, 'PROFESSIONAL pending must NOT enter cart')
  assert.equal(profNameConfirmResult.state.pendingEntityRef, null, 'pendingEntityRef cleared')
  assert.equal(profNameConfirmResult.state.flow, 'CATEGORY_SELECT', 'goes to CATEGORY_SELECT, not RECOMMENDATION_SELECT')
}
console.log('OK F5.7: pendingEntityRef PROFESSIONAL in name.confirm does NOT enter cart')

// 11) P0 cart: pendingEntityRef SERVICE in name.confirm still enters cart (regression)
const svcNameConfirmState = stateWith({
  flow: 'NAME_CONFIRM',
  nameCandidate: 'Juan',
  pendingEntityRef: { type: 'SERVICE', id: 'svc_1' }
})
const svcNameConfirmResult = transition(
  svcNameConfirmState,
  act('name.confirm'),
  ctx({ serviceCompatibleWithCart: true })
)
assert.equal(svcNameConfirmResult.outcome, 'APPLIED')
if (svcNameConfirmResult.outcome === 'APPLIED') {
  assert.equal(svcNameConfirmResult.state.cart.length, 1, 'SERVICE pending enters cart')
  assert.equal(svcNameConfirmResult.state.cart[0]!.serviceId, 'svc_1')
  assert.equal(svcNameConfirmResult.state.pendingEntityRef, null, 'pendingEntityRef cleared')
}
console.log('OK F5.7: pendingEntityRef SERVICE in name.confirm enters cart (regression)')

// 12) P0 mismatch: professional_consult_human with forged entityRef fails closed
const forgedConsultResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_real' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_forged' } }),
  ctx({ professionalActive: true })
)
assert.equal(forgedConsultResult.outcome, 'RECOVERED')
if (forgedConsultResult.outcome === 'RECOVERED') {
  assert.equal(forgedConsultResult.reason, 'stale_ref', 'forged ref produces stale_ref recovery')
}
console.log('OK F5.7: professional_consult_human with forged entityRef → stale_ref recovery')

// 13) P0 mismatch: professional_search_availability with forged entityRef fails closed
const forgedSearchResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_real' } }),
  act('hours.professional_search_availability', { entityRef: { type: 'PROFESSIONAL', id: 'prof_forged' } }),
  ctx({ professionalActive: true, professionalBookable: true })
)
assert.equal(forgedSearchResult.outcome, 'RECOVERED')
if (forgedSearchResult.outcome === 'RECOVERED') {
  assert.equal(forgedSearchResult.reason, 'stale_ref', 'forged ref produces stale_ref recovery')
}
console.log('OK F5.7: professional_search_availability with forged entityRef → stale_ref recovery')

// 14) P0 handoff audit: professional_consult_human produces REQUEST_HUMAN_HANDOFF with {professionalId}
const handoffAuditResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalActive: true, professionalBookable: false, labels: { professionalName: 'Ana' } })
)
assert.ok(handoffAuditResult.outcome === 'HANDOFF' || handoffAuditResult.outcome === 'APPLIED', 'outcome is HANDOFF or APPLIED')
const handoffEffect = handoffAuditResult.effects.find((e) => e.kind === 'REQUEST_HUMAN_HANDOFF')
assert.ok(handoffEffect, 'has REQUEST_HUMAN_HANDOFF effect')
if (handoffEffect?.kind === 'REQUEST_HUMAN_HANDOFF') {
  assert.deepEqual(handoffEffect.context, { professionalId: 'prof_ana' }, 'context is {professionalId}')
  assert.equal(handoffEffect.reason, 'profesional_no_reservable_por_bot', 'reason is correct')
}
console.log('OK F5.7: professional_consult_human handoff audit has {professionalId} context')

// 15) P0 handoff audit: professional_search_availability does NOT produce handoff with {professionalId}
const searchHandoffResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.professional_search_availability', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalActive: true, professionalBookable: true, customerNameOnFile: 'Test' })
)
if (searchHandoffResult.outcome === 'APPLIED') {
  const handoffEffect = searchHandoffResult.effects.find((e) => e.kind === 'REQUEST_HUMAN_HANDOFF')
  assert.ok(!handoffEffect, 'professional_search_availability must NOT produce REQUEST_HUMAN_HANDOFF')
}
console.log('OK F5.7: professional_search_availability does NOT produce handoff')

// 16) P0 professional_consult_human requires !professionalBookable (forged opposite fails closed)
const consultBookableResult = transition(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('hours.professional_consult_human', { entityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  ctx({ professionalActive: true, professionalBookable: true, labels: { professionalName: 'Ana' } })
)
assert.equal(consultBookableResult.outcome, 'RECOVERED', 'professional_consult_human on bookable prof is rejected')
console.log('OK F5.7: professional_consult_human on bookable professional → rejected')

// 17) P0 name.confirm with PROFESSIONAL pending goes to CATEGORY_SELECT (not booking path)
const nameConfirmProfResult = transition(
  stateWith({ flow: 'NAME_CONFIRM', nameCandidate: 'María', pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_ana' } }),
  act('name.confirm'),
  ctx({ professionalActive: true, professionalBookable: true, labels: { professionalName: 'Ana' } })
)
assert.equal(nameConfirmProfResult.outcome, 'APPLIED')
if (nameConfirmProfResult.outcome === 'APPLIED') {
  assert.equal(nameConfirmProfResult.state.flow, 'CATEGORY_SELECT', 'PROFESSIONAL pending → CATEGORY_SELECT')
  assert.equal(nameConfirmProfResult.state.selections.professionalId, null, 'professionalId NOT set in selections')
  assert.equal(nameConfirmProfResult.state.pendingEntityRef, null, 'pendingEntityRef cleared')
}
console.log('OK F5.7: name.confirm with PROFESSIONAL pending → CATEGORY_SELECT (not booking path)')

// ═══ 18) Domain contract: normalizeBotOptionsAction validates entity requirements ═══

import { validateBotOptionsActionEnvelope, BOT_OPTIONS_ACTION_REQUIREMENTS } from '../src/bot-options/domain/actions.js'

function makeEnvelope(actionType: string, entityRef: unknown = null) {
  return {
    schemaVersion: 1,
    engineKey: 'deterministic-options',
    engineVersion: 'v1',
    deploymentId: 'dep_test',
    businessId: 'biz_test',
    sessionId: 'sess_test',
    deploymentGeneration: 0,
    actionType,
    origin: 'WHATSAPP_CHOICE',
    promptId: 'prompt_test',
    choiceToken: 'token_test',
    providerEventId: 'evt_test',
    entityRef,
    payload: null,
    expectedStateRevision: 0n,
    receivedAtIso: '2026-08-26T12:00:00Z'
  }
}

// a) hours.search_availability (general, no entity) — entity null is valid
const generalSearch = validateBotOptionsActionEnvelope(makeEnvelope('hours.search_availability', null))
assert.ok(generalSearch.ok, 'hours.search_availability with null entity is valid')
console.log('OK F5.7 domain: hours.search_availability with null entity passes normalization')

// b) hours.professional_search_availability with PROFESSIONAL entity — valid
const profSearch = validateBotOptionsActionEnvelope(makeEnvelope('hours.professional_search_availability', { type: 'PROFESSIONAL', id: 'p1' }))
assert.ok(profSearch.ok, 'hours.professional_search_availability with PROFESSIONAL entity is valid')
console.log('OK F5.7 domain: hours.professional_search_availability with PROFESSIONAL passes normalization')

// c) hours.professional_consult_human with PROFESSIONAL entity — valid
const profConsult = validateBotOptionsActionEnvelope(makeEnvelope('hours.professional_consult_human', { type: 'PROFESSIONAL', id: 'p1' }))
assert.ok(profConsult.ok, 'hours.professional_consult_human with PROFESSIONAL entity is valid')
console.log('OK F5.7 domain: hours.professional_consult_human with PROFESSIONAL passes normalization')

// d) hours.professional_search_availability WITHOUT entity — rejected required
const profSearchNoEntity = validateBotOptionsActionEnvelope(makeEnvelope('hours.professional_search_availability', null))
assert.ok(!profSearchNoEntity.ok, 'hours.professional_search_availability without entity is rejected')
if (!profSearchNoEntity.ok) {
  const entityFailure = profSearchNoEntity.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'required', 'reason is required')
}
console.log('OK F5.7 domain: hours.professional_search_availability without entity → rejected required')

// e) hours.professional_consult_human WITHOUT entity — rejected required
const profConsultNoEntity = validateBotOptionsActionEnvelope(makeEnvelope('hours.professional_consult_human', null))
assert.ok(!profConsultNoEntity.ok, 'hours.professional_consult_human without entity is rejected')
if (!profConsultNoEntity.ok) {
  const entityFailure = profConsultNoEntity.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'required', 'reason is required')
}
console.log('OK F5.7 domain: hours.professional_consult_human without entity → rejected required')

// f) hours.professional_search_availability with SERVICE entity — rejected required (wrong type)
const profSearchWrongType = validateBotOptionsActionEnvelope(makeEnvelope('hours.professional_search_availability', { type: 'SERVICE', id: 's1' }))
assert.ok(!profSearchWrongType.ok, 'hours.professional_search_availability with SERVICE entity is rejected')
if (!profSearchWrongType.ok) {
  const entityFailure = profSearchWrongType.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'required', 'reason is required (wrong type)')
}
console.log('OK F5.7 domain: hours.professional_search_availability with SERVICE entity → rejected')

// g) hours.search_availability (general) WITH entity — rejected unexpected_entity
const generalSearchWithEntity = validateBotOptionsActionEnvelope(makeEnvelope('hours.search_availability', { type: 'PROFESSIONAL', id: 'p1' }))
assert.ok(!generalSearchWithEntity.ok, 'hours.search_availability with entity is rejected')
if (!generalSearchWithEntity.ok) {
  const entityFailure = generalSearchWithEntity.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'unexpected_entity', 'reason is unexpected_entity')
}
console.log('OK F5.7 domain: hours.search_availability with entity → rejected unexpected_entity')

// h) hours.consult_human (general) WITH entity — rejected unexpected_entity
const generalConsultWithEntity = validateBotOptionsActionEnvelope(makeEnvelope('hours.consult_human', { type: 'PROFESSIONAL', id: 'p1' }))
assert.ok(!generalConsultWithEntity.ok, 'hours.consult_human with entity is rejected')
if (!generalConsultWithEntity.ok) {
  const entityFailure = generalConsultWithEntity.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'unexpected_entity', 'reason is unexpected_entity')
}
console.log('OK F5.7 domain: hours.consult_human with entity → rejected unexpected_entity')

// i) hours.choose_other_professional without entity — valid
const chooseOther = validateBotOptionsActionEnvelope(makeEnvelope('hours.choose_other_professional', null))
assert.ok(chooseOther.ok, 'hours.choose_other_professional without entity is valid')
console.log('OK F5.7 domain: hours.choose_other_professional without entity passes normalization')

// j) hours.choose_other_professional WITH entity — rejected unexpected_entity
const chooseOtherWithEntity = validateBotOptionsActionEnvelope(makeEnvelope('hours.choose_other_professional', { type: 'PROFESSIONAL', id: 'p1' }))
assert.ok(!chooseOtherWithEntity.ok, 'hours.choose_other_professional with entity is rejected')
if (!chooseOtherWithEntity.ok) {
  const entityFailure = chooseOtherWithEntity.failures.find((f) => f.field === 'entityRef')
  assert.ok(entityFailure, 'has entityRef failure')
  assert.equal(entityFailure?.reason, 'unexpected_entity', 'reason is unexpected_entity')
}
console.log('OK F5.7 domain: hours.choose_other_professional with entity → rejected unexpected_entity')

// 19) 15 profesionales: páginas contextuales 7/7/1, límites y entityRef estables
const fifteenProfessionals = Array.from({ length: 15 }, (_, index) => ({
  professionalId: `prof_${String(index + 1).padStart(2, '0')}`,
  label: `Profesional ${String(index + 1).padStart(2, '0')}`
}))
const paginationContext = normalizeContext(ctx({ labels: { professionalCatalog: fifteenProfessionals } }))
for (const [cursor, expectedCount] of [[0, 7], [1, 7], [2, 1]] as const) {
  const pageState = stateWith({
    flow: 'PROFESSIONAL_HOURS_SELECT',
    presentation: cursor === 0 ? { kind: 'plain' } : { kind: 'professional_list_page', cursor }
  })
  const pageView = renderCurrentView(pageState, paginationContext)
  const professionalChoices = pageView.choices.filter((choice) => choice.actionType === 'hours.professional_select')
  assert.equal(professionalChoices.length, expectedCount, `page ${cursor + 1}: professional count`)
  assert.ok(pageView.choices.length <= 10, `page ${cursor + 1}: WhatsApp list limit`)
  for (const choice of professionalChoices) {
    assert.equal(choice.entityRef?.type, 'PROFESSIONAL', `page ${cursor + 1}: exact entity type`)
    assert.ok(choice.entityRef?.id.startsWith('prof_'), `page ${cursor + 1}: stable professional id`)
  }
}
console.log('OK F5.7: 15 profesionales paginate 7/7/1 within limits with stable entityRef')

// 20) La guarda de BUSINESS_HOURS exige al menos un profesional visible
const noProfessionalsResult = transition(
  stateWith({ flow: 'BUSINESS_HOURS' }),
  act('hours.professional'),
  ctx({ professionalSelectable: false })
)
assert.equal(noProfessionalsResult.outcome, 'RECOVERED')
if (noProfessionalsResult.outcome === 'RECOVERED') assert.equal(noProfessionalsResult.reason, 'guard_failed')
console.log('OK F5.7: hours.professional fails closed without visible professionals')

// 21) Volver desde detalle invalida profesional consultado y conserva página
const backFromProfessionalDetail = transition(
  stateWith({
    flow: 'PROFESSIONAL_HOURS_DETAIL',
    pendingEntityRef: { type: 'PROFESSIONAL', id: 'prof_10' },
    presentation: { kind: 'professional_list_page', cursor: 1 }
  }),
  act('navigation.back'),
  ctx({ labels: { professionalCatalog: fifteenProfessionals } })
)
assert.equal(backFromProfessionalDetail.outcome, 'APPLIED')
if (backFromProfessionalDetail.outcome === 'APPLIED') {
  assert.equal(backFromProfessionalDetail.state.flow, 'PROFESSIONAL_HOURS_SELECT')
  assert.equal(backFromProfessionalDetail.state.pendingEntityRef, null)
  assert.deepEqual(backFromProfessionalDetail.state.presentation, { kind: 'professional_list_page', cursor: 1 })
  assert.equal(
    backFromProfessionalDetail.view.choices.filter((choice) => choice.actionType === 'hours.professional_select').length,
    7
  )
}
console.log('OK F5.7: navigation.back detail → same list page and clears consulted professional')

// 22) Un detalle corrupto/stale nunca renderiza acciones que requieren entityRef
const missingProfessionalRefView = renderCurrentView(
  stateWith({ flow: 'PROFESSIONAL_HOURS_DETAIL', pendingEntityRef: null }),
  normalizeContext(ctx({ professionalActive: true, professionalBookable: true }))
)
assert.ok(!missingProfessionalRefView.choices.some((choice) =>
  choice.actionType === 'hours.professional_search_availability' ||
  choice.actionType === 'hours.professional_consult_human'
))
assert.ok(missingProfessionalRefView.choices.length <= 10)
console.log('OK F5.7: detail without PROFESSIONAL ref emits no entity-required action')

console.log('OK bot-options transition: F5.7 professional hours contracts pass.')

// ─── F9.6 — Navegación/recuperación de turnos (tabla APPOINTMENT_*) ────────────

// (0) Helper local: selección base de turno con selections completos.
function appointmentState(flow: BotOptionsState['flow'], patch: Partial<BotOptionsState['selections']> = {}): BotOptionsState {
  return stateWith({
    flow,
    selections: { ...createInitialBotOptionsState().selections, ...patch }
  })
}

// (1) Back conserva el turno seleccionado (origen APPOINTMENT_RESCHEDULE_*).
{
  const appointmentId = 'apt_back_1'
  let s = appointmentState('APPOINTMENT_LIST')
  let r = transition(s, act('appointment.select', { entityRef: { type: 'APPOINTMENT', id: appointmentId } }), ctx({ appointmentOwnedAndFuture: true }))
  if (r.outcome === 'APPLIED') s = r.state
  assert.equal(s.selections.appointmentId, appointmentId, 'select conserva el turno')
  r = transition(s, act('appointment.reschedule', { entityRef: { type: 'APPOINTMENT', id: appointmentId } }), ctx({ appointmentOwnedAndFuture: true, rescheduleAllowed: true }))
  if (r.outcome === 'APPLIED') s = r.state
  assert.equal(s.flow, 'APPOINTMENT_RESCHEDULE_DATE')
  const back = transition(s, act('navigation.back'), ctx())
  assert.equal(back.outcome, 'APPLIED')
  if (back.outcome === 'APPLIED') {
    assert.equal(back.state.flow, 'APPOINTMENT_DETAIL', 'Back desde reschedule vuelve al detalle')
    assert.equal(back.state.selections.appointmentId, appointmentId, 'Back conserva el turno seleccionado')
  }
}
console.log('OK F9.6: navigation.back conserva el turno seleccionado')

// (1) APPOINTMENT_DETAIL renderiza acciones tipadas para el turno seleccionado;
// una selección ausente no expone acciones que el normalizador rechazaría.
{
  const appointmentId = 'apt_detail_1'
  const detailState = appointmentState('APPOINTMENT_DETAIL', { appointmentId })
  const detailView = renderCurrentView(detailState, normalizeContext(ctx()))
  for (const actionType of ['appointment.cancel', 'appointment.reschedule'] as const) {
    const choice = detailView.choices.find((item) => item.actionType === actionType)
    assert.ok(choice, `${actionType} se renderiza para el turno seleccionado`)
    assert.deepEqual(choice!.entityRef, { type: 'APPOINTMENT', id: appointmentId }, `${actionType} conserva el entityRef seleccionado`)
  }

  const cancelChoice = detailView.choices.find((item) => item.actionType === 'appointment.cancel')!
  const cancel = transition(detailState, act(cancelChoice.actionType, { entityRef: cancelChoice.entityRef! }), ctx({ appointmentOwnedAndFuture: true, cancellationAllowed: true }))
  assert.equal(cancel.outcome, 'APPLIED', 'appointment.cancel renderizado aplica')
  if (cancel.outcome === 'APPLIED') assert.equal(cancel.state.flow, 'APPOINTMENT_CANCEL_CONFIRM')

  const rescheduleChoice = detailView.choices.find((item) => item.actionType === 'appointment.reschedule')!
  const reschedule = transition(detailState, act(rescheduleChoice.actionType, { entityRef: rescheduleChoice.entityRef! }), ctx({ appointmentOwnedAndFuture: true, rescheduleAllowed: true }))
  assert.equal(reschedule.outcome, 'APPLIED', 'appointment.reschedule renderizado aplica')
  if (reschedule.outcome === 'APPLIED') assert.equal(reschedule.state.flow, 'APPOINTMENT_RESCHEDULE_DATE')

  const missingSelectionView = renderCurrentView(appointmentState('APPOINTMENT_DETAIL'), normalizeContext(ctx()))
  assert.ok(!missingSelectionView.choices.some((choice) =>
    choice.actionType === 'appointment.cancel' || choice.actionType === 'appointment.reschedule'
  ), 'detalle sin turno no expone acciones con entityRef obligatorio')
}
console.log('OK F9.6: APPOINTMENT_DETAIL conserva entityRef y no expone acciones sin selección')

// (1) Las confirmaciones llevan el turno seleccionado, normalizan y alcanzan sus transiciones existentes.
{
  const appointmentId = 'apt_confirm_1'
  const cancelState = appointmentState('APPOINTMENT_CANCEL_CONFIRM', { appointmentId })
  const cancelChoice = renderCurrentView(cancelState, normalizeContext(ctx())).choices.find((choice) => choice.actionType === 'appointment.cancel_confirm')
  assert.ok(cancelChoice, 'cancel_confirm se renderiza con turno seleccionado')
  assert.deepEqual(cancelChoice!.entityRef, { type: 'APPOINTMENT', id: appointmentId }, 'cancel_confirm conserva entityRef')
  const normalizedCancel = validateBotOptionsActionEnvelope(makeEnvelope(cancelChoice!.actionType, cancelChoice!.entityRef))
  assert.ok(normalizedCancel.ok, 'cancel_confirm renderizado pasa normalización')
  const cancel = transition(cancelState, act(cancelChoice!.actionType, { entityRef: cancelChoice!.entityRef! }), ctx({ cancellationAllowed: true }))
  assert.equal(cancel.outcome, 'APPLIED', 'cancel_confirm renderizado aplica')
  if (cancel.outcome === 'APPLIED') {
    assert.equal(cancel.state.flow, 'APPOINTMENT_LIST')
    assert.deepEqual(cancel.effects, [{ kind: 'CANCEL_BOOKING', appointmentId, reason: 'cliente_cancelo_por_bot' }], 'cancel effect carries the already validated appointment identity')
  }

  const rescheduleState = appointmentState('APPOINTMENT_RESCHEDULE_SUMMARY', {
    appointmentId,
    date: '2026-09-10',
    slotStartAt: '2026-09-10T16:00:00-03:00'
  })
  const rescheduleChoice = renderCurrentView(rescheduleState, normalizeContext(ctx())).choices.find((choice) => choice.actionType === 'appointment.reschedule_confirm')
  assert.ok(rescheduleChoice, 'reschedule_confirm se renderiza con turno seleccionado')
  assert.deepEqual(rescheduleChoice!.entityRef, { type: 'APPOINTMENT', id: appointmentId }, 'reschedule_confirm conserva entityRef')
  const normalizedReschedule = validateBotOptionsActionEnvelope(makeEnvelope(rescheduleChoice!.actionType, rescheduleChoice!.entityRef))
  assert.ok(normalizedReschedule.ok, 'reschedule_confirm renderizado pasa normalización')
  const reschedule = transition(rescheduleState, act(rescheduleChoice!.actionType, { entityRef: rescheduleChoice!.entityRef! }), ctx({ rescheduleSlotAvailable: true }))
  assert.equal(reschedule.outcome, 'APPLIED', 'reschedule_confirm renderizado aplica')
  if (reschedule.outcome === 'APPLIED') assert.equal(reschedule.state.flow, 'APPOINTMENT_DETAIL')

  const missingCancel = renderCurrentView(appointmentState('APPOINTMENT_CANCEL_CONFIRM'), normalizeContext(ctx()))
  assert.ok(!missingCancel.choices.some((choice) => choice.actionType === 'appointment.cancel_confirm'), 'cancel confirm sin turno no expone acción con entityRef obligatorio')
  const missingReschedule = renderCurrentView(appointmentState('APPOINTMENT_RESCHEDULE_SUMMARY'), normalizeContext(ctx()))
  assert.ok(!missingReschedule.choices.some((choice) => choice.actionType === 'appointment.reschedule_confirm'), 'reschedule confirm sin turno no expone acción con entityRef obligatorio')
}
console.log('OK F9.6: confirmaciones conservan entityRef, normalizan y aplican')

// (1) Un entityRef de otro turno nunca puede retargetear cancelación/reprogramación.
for (const actionType of ['appointment.cancel', 'appointment.reschedule'] as const) {
  const selected = appointmentState('APPOINTMENT_DETAIL', {
    appointmentId: 'apt_selected_1',
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const forged = transition(
    selected,
    act(actionType, { entityRef: { type: 'APPOINTMENT', id: 'apt_forged_1' } }),
    ctx({ appointmentOwnedAndFuture: true, cancellationAllowed: true, rescheduleAllowed: true })
  )
  assert.equal(forged.outcome, 'RECOVERED', `${actionType} con otro turno se rechaza`)
  if (forged.outcome === 'RECOVERED') {
    assert.deepEqual(forged.state, selected, `${actionType} forjado no altera estado funcional`)
    assert.equal('effects' in forged, false, `${actionType} forjado no emite efectos`)
  }
}
console.log('OK F9.6: entityRef forjado no retargetea acciones de APPOINTMENT_DETAIL')

// (1) appointment.slot_conflict — mismo día: RESCHEDULE_SLOT, limpia SOLO slot.
{
  const appointmentId = 'apt_conflict_same_1'
  const s = appointmentState('APPOINTMENT_RESCHEDULE_SUMMARY', {
    appointmentId,
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const sameDay = [
    { startAt: '2026-09-10T16:00:00-03:00', label: '16:00', band: 'AFTERNOON' as const, professionalId: 'p1' }
  ]
  const r = transition(s, act('appointment.slot_conflict', { entityRef: { type: 'APPOINTMENT', id: appointmentId }, payload: { startAt: '2026-09-10T15:00:00-03:00' } }), ctx({ labels: { availableSlots: sameDay } }))
  assert.equal(r.outcome, 'APPLIED', 'slot_conflict aplica recuperación')
  if (r.outcome === 'APPLIED') {
    assert.equal(r.state.flow, 'APPOINTMENT_RESCHEDULE_SLOT', 'mismo día → RESCHEDULE_SLOT')
    assert.equal(r.state.selections.appointmentId, appointmentId, 'preserva appointmentId')
    assert.equal(r.state.selections.date, '2026-09-10', 'preserva fecha cuando hay opciones del mismo día')
    assert.equal(r.state.selections.slotStartAt, null, 'limpia sólo el slot')
    assert.deepEqual(r.effects, [], 'slot_conflict no emite efectos')
    assert.equal(r.view.bodyKind, 'recovery', 'vista de recuperación')
    assert.ok(r.view.interactiveBody!.includes('mismo día'), 'mensaje de mismo día')
    const slotChoice = r.view.choices.find((c) => c.actionType === 'appointment.slot_select')
    assert.ok(slotChoice, 'la vista ofrece slot_select interactivo')
    assert.equal(slotChoice!.payload!.startAt, '2026-09-10T16:00:00-03:00')
    assert.deepEqual(slotChoice!.entityRef, { type: 'APPOINTMENT', id: appointmentId }, 'la opción lleva el turno original')
  }
}
console.log('OK F9.6: appointment.slot_conflict (mismo día) → RESCHEDULE_SLOT, preserva turno/fecha, cero efectos')

// (1) appointment.slot_conflict — día agotado: RESCHEDULE_DATE, limpia fecha+slot.
{
  const appointmentId = 'apt_conflict_exhausted_1'
  const s = appointmentState('APPOINTMENT_RESCHEDULE_SUMMARY', {
    appointmentId,
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const r = transition(
    s,
    act('appointment.slot_conflict', { entityRef: { type: 'APPOINTMENT', id: appointmentId }, payload: { startAt: '2026-09-10T15:00:00-03:00' } }),
    ctx({
      labels: {
        availableSlots: [],
        availableDates: [{ date: '2026-09-12', label: '12 sep' }]
      }
    })
  )
  assert.equal(r.outcome, 'APPLIED', 'slot_conflict aplica recuperación')
  if (r.outcome === 'APPLIED') {
    assert.equal(r.state.flow, 'APPOINTMENT_RESCHEDULE_DATE', 'sin opciones del día → RESCHEDULE_DATE')
    assert.equal(r.state.selections.appointmentId, appointmentId, 'preserva appointmentId')
    assert.equal(r.state.selections.date, null, 'limpia fecha')
    assert.equal(r.state.selections.slotStartAt, null, 'limpia slot')
    assert.deepEqual(r.effects, [], 'slot_conflict no emite efectos')
    assert.ok(r.view.interactiveBody!.includes('otra fecha'), 'mensaje de día agotado')
    const dateChoice = r.view.choices.find((c) => c.actionType === 'appointment.date_select')
    assert.ok(dateChoice, 'la vista ofrece date_select interactivo')
    assert.equal(dateChoice!.payload!.date, '2026-09-12')
    assert.deepEqual(dateChoice!.entityRef, { type: 'APPOINTMENT', id: appointmentId }, 'la opción lleva el turno original')
  }
}
console.log('OK F9.6: appointment.slot_conflict (día agotado) → RESCHEDULE_DATE, limpia fecha+slot, cero efectos')

// (1) appointment.slot_conflict exige el turno seleccionado; eventos faltantes o forjados no invalidan otra propuesta.
for (const entityRef of [null, { type: 'APPOINTMENT' as const, id: 'apt_conflict_forged_1' }]) {
  const selected = appointmentState('APPOINTMENT_RESCHEDULE_SUMMARY', {
    appointmentId: 'apt_conflict_selected_1',
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const rejected = transition(
    selected,
    act('appointment.slot_conflict', { entityRef, payload: { startAt: '2026-09-10T15:00:00-03:00' } }),
    ctx({ labels: { availableSlots: [{ startAt: '2026-09-10T16:00:00-03:00', label: '16:00', band: 'AFTERNOON', professionalId: 'p1' }] } })
  )
  assert.equal(rejected.outcome, 'RECOVERED', 'slot_conflict sin/mal entityRef se rechaza')
  if (rejected.outcome === 'RECOVERED') {
    assert.equal(rejected.reason, 'stale_ref')
    assert.deepEqual(rejected.state, selected, 'slot_conflict sin/mal entityRef no altera estado funcional')
    assert.equal('effects' in rejected, false, 'slot_conflict sin/mal entityRef no emite efectos')
  }
}
console.log('OK F9.6: appointment.slot_conflict exige entityRef del turno seleccionado')

// (1) appointment.slot_conflict fuera de contexto no muta la selección funcional.
// Nota: el guard cae en escalateInvalid (incrementa invalidStreak por diseño),
// pero no altera flow ni selecciones ni emite efectos.
{
  const s = stateWith({ flow: 'MAIN_MENU' })
  const r = transition(s, act('appointment.slot_conflict'), ctx())
  assert.equal(r.outcome, 'RECOVERED', 'slot_conflict fuera de reschedule no aplica')
  if (r.outcome === 'RECOVERED') {
    assert.equal(r.state.flow, 'MAIN_MENU', 'flow inalterado')
    assert.equal(r.state.selections.appointmentId, null, 'selección inalterada')
    assert.equal('effects' in r, false, 'recuperación no trae efectos')
  }
}
console.log('OK F9.6: appointment.slot_conflict fuera de contexto no muta la selección')

// (2) appointment.stale — con turnos: reconstruye la lista, limpia selección, cero efectos.
{
  const appointmentId = 'apt_stale_list_1'
  const s = appointmentState('APPOINTMENT_DETAIL', {
    appointmentId,
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const r = transition(s, act('appointment.stale'), ctx({ appointmentsExist: true }))
  assert.equal(r.outcome, 'APPLIED', 'stale aplica recuperación')
  if (r.outcome === 'APPLIED') {
    assert.equal(r.state.flow, 'APPOINTMENT_LIST', 'stale con turnos → reconstruye lista')
    assert.equal(r.state.selections.appointmentId, null, 'limpia appointment')
    assert.equal(r.state.selections.date, null, 'limpia date')
    assert.equal(r.state.selections.slotStartAt, null, 'limpia slot')
    assert.deepEqual(r.effects, [], 'stale no emite efectos')
  }
}
console.log('OK F9.6: appointment.stale (con turnos) → APPOINTMENT_LIST, limpia selección, cero efectos')

// (2) appointment.stale — sin turnos: vuelve al menú principal.
{
  const s = appointmentState('APPOINTMENT_RESCHEDULE_SLOT', {
    appointmentId: 'apt_gone_1',
    date: '2026-09-10',
    slotStartAt: '2026-09-10T15:00:00-03:00'
  })
  const r = transition(s, act('appointment.stale'), ctx({ appointmentsExist: false }))
  assert.equal(r.outcome, 'APPLIED', 'stale aplica recuperación')
  if (r.outcome === 'APPLIED') {
    assert.equal(r.state.flow, 'MAIN_MENU', 'stale sin turnos → menú principal')
    assert.equal(r.state.selections.appointmentId, null, 'limpia appointment')
    assert.deepEqual(r.effects, [], 'stale no emite efectos')
  }
}
console.log('OK F9.6: appointment.stale (sin turnos) → MAIN_MENU, limpia selección, cero efectos')

// (3) F9.1/F9.6 — La lista renderiza los turnos provistos con entityRef/acción correctos.
{
  const appointments = [
    { appointmentId: 'apt_render_1', label: 'Corte · 27 ago 15:00' },
    { appointmentId: 'apt_render_2', label: 'Coloración · 30 ago 11:00' }
  ]
  const listView = renderCurrentView(
    appointmentState('APPOINTMENT_LIST'),
    normalizeContext(ctx({ labels: { manageableAppointments: appointments } }))
  )
  assert.equal(listView.bodyKind, 'menu', 'la lista es una vista de menú')
  const selectChoices = listView.choices.filter((choice) => choice.actionType === 'appointment.select')
  assert.equal(selectChoices.length, 2, 'una opción appointment.select por turno provisto')
  for (const choice of selectChoices) {
    assert.equal(choice.actionType, 'appointment.select', 'acción es appointment.select')
    assert.equal(choice.entityRef?.type, 'APPOINTMENT', 'entityRef es APPOINTMENT')
    const match = appointments.find((appointment) => appointment.appointmentId === choice.entityRef?.id)
    assert.ok(match, 'entityRef.id coincide con un turno provisto')
    assert.equal(choice.label, match?.label, 'la etiqueta mostrada coincide con la del turno')
  }
}
console.log('OK F9.6: la lista renderiza los turnos provistos con entityRef/acción correctos')

// (3) Round-trip: seleccionar un ítem por su id lleva al detalle conservando el id.
{
  const appointments = [
    { appointmentId: 'apt_rt_1', label: 'Corte' },
    { appointmentId: 'apt_rt_2', label: 'Coloración' }
  ]
  const s = appointmentState('APPOINTMENT_LIST')
  const r = transition(
    s,
    act('appointment.select', { entityRef: { type: 'APPOINTMENT', id: 'apt_rt_2' } }),
    ctx({ appointmentOwnedAndFuture: true, labels: { manageableAppointments: appointments } })
  )
  assert.equal(r.outcome, 'APPLIED', 'seleccionar un turno aplica')
  if (r.outcome === 'APPLIED') {
    assert.equal(r.state.flow, 'APPOINTMENT_DETAIL', 'la selección lleva al detalle')
    assert.equal(r.state.selections.appointmentId, 'apt_rt_2', 'conserva el id del turno elegido')
    assert.deepEqual(r.effects, [], 'appointment.select no emite efectos')
  }
}
console.log('OK F9.6: appointment.select por id lleva al detalle (round-trip)')

// (3) F9.7 prerequisite — cada vista recibe sólo su página SQL keyset (7 filas),
// persiste el cursor next y nunca excede la capacidad WhatsApp.
{
  const firstAfter = { startAt: '2026-09-10T10:00:00.000Z', appointmentId: 'apt_cursor_7' }
  const secondAfter = { startAt: '2026-09-11T10:00:00.000Z', appointmentId: 'apt_cursor_14' }
  const firstPage = Array.from({ length: 7 }, (_, index) => ({ appointmentId: `apt_${index + 1}`, label: `Turno ${index + 1}` }))
  const secondPage = Array.from({ length: 7 }, (_, index) => ({ appointmentId: `apt_${index + 8}`, label: `Turno ${index + 8}` }))
  const current = stateWith({
    flow: 'APPOINTMENT_LIST',
    presentation: { kind: 'appointment_list_page', cursor: 0, after: null, next: firstAfter }
  })
  const first = renderCurrentView(current, normalizeContext(ctx({
    appointmentsCanNext: true,
    appointmentListPage: { after: null, next: firstAfter },
    labels: { manageableAppointments: firstPage }
  })))
  assert.ok(first.choices.length <= 10, 'primera página no excede capacidad 10')
  assert.equal(first.choices.filter((choice) => choice.actionType === 'appointment.select').length, 7, 'renderiza sólo las siete filas del page size SQL')
  assert.ok(first.choices.some((choice) => choice.actionType === 'appointment.next_page'), 'next depende del cursor keyset durable')

  const next = transition(current, act('appointment.next_page'), ctx({
    appointmentsCanNext: true,
    appointmentListPage: { after: firstAfter, next: secondAfter },
    labels: { manageableAppointments: secondPage }
  }))
  assert.equal(next.outcome, 'APPLIED', 'next con cursor matching aplica')
  if (next.outcome === 'APPLIED') {
    assert.deepEqual(next.state.presentation, { kind: 'appointment_list_page', cursor: 1, after: firstAfter, next: secondAfter }, 'persiste after/next de la página SQL nueva')
    assert.ok(next.view.choices.length <= 10, 'segunda página no excede capacidad 10')
    const secondIds = next.view.choices.filter((choice) => choice.actionType === 'appointment.select').map((choice) => choice.entityRef!.id)
    assert.ok(!secondIds.some((id) => firstPage.some((appointment) => appointment.appointmentId === id)), 'no repite filas de la página anterior')
  }
  const stale = transition(current, act('appointment.next_page'), ctx({
    appointmentsCanNext: true,
    appointmentListPage: { after: { ...firstAfter, appointmentId: 'forged' }, next: secondAfter },
    labels: { manageableAppointments: secondPage }
  }))
  assert.equal(stale.outcome, 'RECOVERED', 'cursor de contexto que no coincide falla cerrado')

  // Una selección de página 2 no puede perder su cursor al empezar a
  // reprogramar: el runtime debe poder revalidar ESE turno, no sólo la página 1.
  const selected = transition(next.outcome === 'APPLIED' ? next.state : current,
    act('appointment.select', { entityRef: { type: 'APPOINTMENT', id: 'apt_8' } }),
    ctx({ appointmentOwnedAndFuture: true, appointmentListPage: { after: firstAfter, next: secondAfter }, labels: { manageableAppointments: secondPage } }))
  assert.equal(selected.outcome, 'APPLIED', 'seleccionar turno de segunda página aplica')
  if (selected.outcome === 'APPLIED') {
    const reschedule = transition(selected.state,
      act('appointment.reschedule', { entityRef: { type: 'APPOINTMENT', id: 'apt_8' } }),
      ctx({ appointmentOwnedAndFuture: true, rescheduleAllowed: true }))
    assert.equal(reschedule.outcome, 'APPLIED', 'reprogramar turno de segunda página aplica')
    if (reschedule.outcome === 'APPLIED') {
      assert.deepEqual(reschedule.state.presentation, { kind: 'appointment_list_page', cursor: 1, after: firstAfter, next: secondAfter }, 'reprogramación preserva cursor keyset de origen')
    }
  }
}
console.log('OK F9.7 prerequisite: paginación keyset durable sin carga total ni salto de filas')

console.log('OK bot-options transition: F9.6 appointment navigation/recovery contracts pass.')
