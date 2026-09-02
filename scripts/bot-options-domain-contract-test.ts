import assert from 'node:assert/strict'
import {
  BOT_OPTIONS_ACTION_REQUIREMENTS,
  BOT_OPTIONS_ACTION_TYPES,
  CLIENT_CHOICE_ACTION_TYPES,
  CRM_ACTION_TYPES,
  SYSTEM_EVENT_ACTION_TYPES,
  isBotOptionsActionType,
  isClientChoiceAction,
  isCrmAction,
  isSystemEventAction,
  validateBotOptionsActionEnvelope,
  type BotOptionsActionEnvelope
} from '../src/bot-options/domain/actions.js'
import {
  BOT_OPTIONS_STATE_SCHEMA_VERSION,
  createInitialBotOptionsState,
  parseBotOptionsState,
  registerInvalidInput,
  resetInvalidStreak,
  validateBotOptionsState
} from '../src/bot-options/domain/state.js'

// ─── Clasificación de acciones ────────────────────────────────────────────────

assert.ok(BOT_OPTIONS_ACTION_TYPES.length >= 60)
const uniqueTypes = new Set(BOT_OPTIONS_ACTION_TYPES)
assert.equal(uniqueTypes.size, BOT_OPTIONS_ACTION_TYPES.length)

const clientSet: ReadonlySet<string> = new Set(CLIENT_CHOICE_ACTION_TYPES)
const systemSet: ReadonlySet<string> = new Set(SYSTEM_EVENT_ACTION_TYPES)
const crmSet: ReadonlySet<string> = new Set(CRM_ACTION_TYPES)
for (const type of BOT_OPTIONS_ACTION_TYPES) {
  const buckets = [clientSet.has(type), systemSet.has(type), crmSet.has(type)].filter(Boolean).length
  assert.equal(buckets, 1, `${type} debe pertenecer a exactamente una categoría`)
}

assert.equal(isClientChoiceAction('slot.select'), true)
assert.equal(isSystemEventAction('deposit.expired'), true)
assert.equal(isCrmAction('handoff.take'), true)
assert.equal(isBotOptionsActionType('menu.inventado'), false)
assert.equal(isBotOptionsActionType('booking.confirm'), true)

// Requisitos estáticos por acción.
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['category.select']?.entity, 'CATEGORY')
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['subcategory.select']?.entity, 'SUBCATEGORY')
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['professional.select']?.entity, 'PROFESSIONAL')
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['appointment.cancel_confirm']?.entity, 'APPOINTMENT')
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['date.select']?.requiresDate, true)
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['slot.select']?.requiresSlotStart, true)
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['slot.band']?.requiresSlotBand, true)
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['navigation.back']?.entity, undefined)
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['service.more_same_category']?.entity, undefined)
assert.equal(BOT_OPTIONS_ACTION_REQUIREMENTS['cart.open_remove']?.entity, undefined)

// ─── Validación de envelope: caso feliz mínimo ────────────────────────────────

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    engineKey: 'deterministic-options',
    engineVersion: 'v1',
    deploymentId: 'dep_1',
    deploymentGeneration: 3,
    businessId: 'biz_1',
    sessionId: 'ses_1',
    origin: 'WHATSAPP_CHOICE',
    promptId: 'pr_1',
    choiceToken: 'tok_default',
    actionType: 'menu.start_booking',
    entityRef: null,
    payload: null,
    expectedStateRevision: 7n,
    providerEventId: 'evt_1',
    providerMessageId: 'wamid.X',
    receivedAtIso: '2026-08-25T03:00:00Z',
    ...overrides
  }
}

const minimal = validateBotOptionsActionEnvelope(baseCandidate())
assert.equal(minimal.ok, true)
if (minimal.ok) {
  const envelope: BotOptionsActionEnvelope = minimal.envelope
  assert.equal(envelope.choiceToken, 'tok_default')
  assert.equal(envelope.expectedStateRevision, 7n)
  assert.equal(envelope.providerMessageId, 'wamid.X')
}

// ─── Rechazos del envelope ────────────────────────────────────────────────────

function firstFailure(candidate: Record<string, unknown>) {
  const result = validateBotOptionsActionEnvelope(candidate)
  assert.equal(
    result.ok,
    false,
    `se esperaba rechazo para ${JSON.stringify(candidate, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}`
  )
  if (!result.ok) return result.failures[0]!
  throw new Error('unreachable')
}

assert.deepEqual(firstFailure(baseCandidate({ schemaVersion: 2 })), {
  field: 'schemaVersion',
  reason: 'unsupported_version'
})
assert.deepEqual(firstFailure(baseCandidate({ engineKey: 'otro' })), {
  field: 'engineKey',
  reason: 'unknown_engine'
})
assert.deepEqual(firstFailure(baseCandidate({ actionType: 'no.existe' })), {
  field: 'actionType',
  reason: 'unknown_action_type'
})
assert.deepEqual(firstFailure(baseCandidate({ sessionId: '   ' })), {
  field: 'sessionId',
  reason: 'required'
})

// Elección del cliente exige choiceToken; evento de sistema lo prohíbe.
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'slot.select', payload: { startAt: '2026-09-02T15:00:00-03:00' }, choiceToken: null })),
  { field: 'choiceToken', reason: 'required_for_client_choice' }
)
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'deposit.expired', origin: 'SYSTEM', promptId: null })),
  { field: 'choiceToken', reason: 'forbidden_for_non_choice' }
)

// Los IDs de prompt/proveedor dependen del origen, no se fuerzan a CRM/sistema.
const systemWithoutProvider = validateBotOptionsActionEnvelope(
  baseCandidate({
    actionType: 'deposit.expired',
    origin: 'SYSTEM',
    promptId: null,
    choiceToken: null,
    providerEventId: null
  })
)
assert.equal(systemWithoutProvider.ok, true)
const crmWithoutProvider = validateBotOptionsActionEnvelope(
  baseCandidate({
    actionType: 'handoff.take',
    origin: 'CRM',
    promptId: null,
    choiceToken: null,
    providerEventId: null
  })
)
assert.equal(crmWithoutProvider.ok, true)
assert.deepEqual(firstFailure(baseCandidate({ origin: 'CRM' })), {
  field: 'origin',
  reason: 'action_origin_mismatch'
})
assert.deepEqual(firstFailure(baseCandidate({ deploymentGeneration: -1 })), {
  field: 'deploymentGeneration',
  reason: 'invalid_generation'
})

// Entidad requerida y entidad inesperada.
assert.deepEqual(firstFailure(baseCandidate({ actionType: 'category.select', choiceToken: 't' })), {
  field: 'entityRef',
  reason: 'required'
})
assert.deepEqual(
  firstFailure(
    baseCandidate({
      actionType: 'category.select',
      choiceToken: 't',
      entityRef: { type: 'SERVICE', id: 'srv_1' }
    })
  ),
  { field: 'entityRef', reason: 'required' }
)
assert.deepEqual(firstFailure(baseCandidate({ entityRef: { type: 'SERVICE', id: 'srv_1' } })), {
  field: 'entityRef',
  reason: 'unexpected_entity'
})
assert.equal(validateBotOptionsActionEnvelope(baseCandidate({
  actionType: 'subcategory.select',
  entityRef: { type: 'SUBCATEGORY', id: 'sub_1' }
})).ok, true)
assert.deepEqual(firstFailure(baseCandidate({
  actionType: 'subcategory.select',
  entityRef: { type: 'SERVICE', id: 'sub_1' }
})), { field: 'entityRef', reason: 'required' })

// Payloads: fecha, bloque y franja con formato canónico.
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'date.select', choiceToken: 't', payload: {} })),
  { field: 'payload.date', reason: 'required' }
)
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'date.select', choiceToken: 't', payload: { date: '02/09/2026' } })),
  { field: 'payload.date', reason: 'invalid_format' }
)
assert.deepEqual(
  firstFailure(
    baseCandidate({
      actionType: 'date.select',
      choiceToken: 't',
      payload: { date: '2026-09-02', extra: true }
    })
  ),
  { field: 'payload.date', reason: 'unexpected_field' }
)
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'slot.select', choiceToken: 't', payload: { startAt: '2026-09-02 15:00' } })),
  { field: 'payload.startAt', reason: 'invalid_format' }
)
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'slot.band', choiceToken: 't', payload: { band: 'SIESTA' } })),
  { field: 'payload.band', reason: 'unknown_band' }
)
assert.deepEqual(
  firstFailure(baseCandidate({ actionType: 'navigation.back', choiceToken: 't', payload: { date: '2026-09-02' } })),
  { field: 'payload.date', reason: 'unexpected_field' }
)

// Revisión de estado esperada: sólo bigint no negativo.
assert.deepEqual(firstFailure(baseCandidate({ expectedStateRevision: 7 })), {
  field: 'expectedStateRevision',
  reason: 'invalid_revision'
})
assert.deepEqual(firstFailure(baseCandidate({ expectedStateRevision: -1n })), {
  field: 'expectedStateRevision',
  reason: 'invalid_revision'
})

// Envelope válido completo con entidad y payload.
const full = validateBotOptionsActionEnvelope(
  baseCandidate({
    actionType: 'appointment.slot_select',
    choiceToken: 'tok9',
    entityRef: { type: 'APPOINTMENT', id: 'apt_1' },
    payload: { startAt: '2026-09-02T15:00:00-03:00' },
    expectedStateRevision: 41n
  })
)
assert.equal(full.ok, true)
if (full.ok) {
  assert.equal(full.envelope.entityRef?.type, 'APPOINTMENT')
  assert.equal(full.envelope.payload?.startAt, '2026-09-02T15:00:00-03:00')
  assert.equal(full.envelope.expectedStateRevision, 41n)
}

// Rechazos de seña desde CRM siempre llevan motivo; reenvío además lleva plazo.
assert.deepEqual(
  firstFailure(baseCandidate({
    actionType: 'deposit.reject_resubmission',
    origin: 'CRM',
    promptId: null,
    choiceToken: null,
    providerEventId: null,
    payload: null
  })),
  { field: 'payload.reason', reason: 'required' }
)
const rejectionWithDeadline = validateBotOptionsActionEnvelope(baseCandidate({
  actionType: 'deposit.reject_resubmission',
  origin: 'CRM',
  promptId: null,
  choiceToken: null,
  providerEventId: null,
  payload: { reason: 'Comprobante ilegible', resubmissionDeadlineIso: '2026-08-25T15:00:00Z' }
}))
assert.equal(rejectionWithDeadline.ok, true)
assert.equal(validateBotOptionsActionEnvelope(baseCandidate({
  payload: { conflictChoiceToken: 'choice_a' }
})).ok, true, 'una confirmación de conflicto conserva provenance en una acción cliente normal')
assert.deepEqual(
  firstFailure(baseCandidate({
    actionType: 'deposit.reject_final',
    origin: 'CRM',
    promptId: null,
    choiceToken: null,
    providerEventId: null,
    payload: null
  })),
  { field: 'payload.reason', reason: 'required' }
)

// ─── Estado inicial e invariantes ────────────────────────────────────────────

const initial = createInitialBotOptionsState()
assert.equal(validateBotOptionsState(initial).ok, true)

const parsed = parseBotOptionsState(JSON.parse(JSON.stringify(initial)))
assert.equal(parsed.ok, true)
if (parsed.ok) {
  assert.equal(parsed.state.flow, 'MAIN_MENU')
  assert.equal(parsed.state.deposit, 'NONE')
}

function stateWith(overrides: Record<string, unknown>, base: Record<string, unknown> = {}) {
  const seed = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>
  const merged = { ...seed, ...base, ...overrides }
  return merged
}

const completeSelection = {
  selections: {
    categoryId: 'cat_1',
    professionalId: 'pro_1',
    anyProfessional: false,
    date: '2026-09-02',
    slotStartAt: '2026-09-02T15:00:00-03:00',
    appointmentId: null
  }
}
const anyProfessionalSelection = {
  selections: {
    categoryId: 'cat_1',
    professionalId: null,
    anyProfessional: true,
    date: '2026-09-02',
    slotStartAt: '2026-09-02T15:00:00-03:00',
    appointmentId: null
  }
}
const cartWithOne = { cart: [{ serviceId: 'srv_corte' }] }

function invariantOf(state: Record<string, unknown>) {
  const result = validateBotOptionsState(state)
  assert.equal(result.ok, false, 'se esperaba violación de invariante')
  if (!result.ok) return result.invariant
  throw new Error('unreachable')
}

// Versión desconocida jamás se interpreta parcialmente.
assert.deepEqual(parseBotOptionsState({ ...JSON.parse(JSON.stringify(initial)), schemaVersion: 99 }), {
  ok: false,
  invariant: 'schema_version_known'
})

assert.equal(invariantOf(stateWith({ invalidStreak: 4 })), 'invalid_streak_range')

assert.equal(
  invariantOf(stateWith({ cart: [{ serviceId: 'srv_a' }, { serviceId: 'srv_a' }] }, completeSelection)),
  'cart_unique_services'
)

const incompleteSelection = {
  selections: {
    categoryId: 'cat_1',
    professionalId: 'pro_1',
    anyProfessional: false,
    date: null,
    slotStartAt: null,
    appointmentId: null
  }
}

assert.equal(invariantOf(stateWith({ booking: 'CONFIRMED' })), 'booking_requires_complete_selection')
assert.equal(
  invariantOf(stateWith({ booking: 'HELD', ...cartWithOne, ...incompleteSelection })),
  'booking_requires_complete_selection',
  'sin fecha/horario la reserva activa es inválida'
)
assert.equal(validateBotOptionsState(stateWith({ booking: 'CONFIRMED', ...cartWithOne }, completeSelection)).ok, true)
assert.equal(
  validateBotOptionsState(stateWith({ booking: 'HELD', ...cartWithOne }, anyProfessionalSelection)).ok,
  true,
  '"cualquier profesional" también completa la selección'
)

assert.equal(invariantOf(stateWith({ deposit: 'PENDING_PROOF', booking: 'DRAFT', ...cartWithOne }, completeSelection)), 'deposit_requires_active_booking')
assert.equal(invariantOf(stateWith({ deposit: 'APPROVED', booking: 'HELD', ...cartWithOne }, completeSelection)), 'approved_deposit_implies_confirmed_booking')
assert.equal(invariantOf(stateWith({ deposit: 'PROOF_RECEIVED', booking: 'HELD', ...cartWithOne }, completeSelection)), 'proof_review_implies_proof_received')
assert.equal(invariantOf(stateWith({ deposit: 'REJECTED_FINAL', booking: 'CONFIRMED', ...cartWithOne }, completeSelection)), 'rejected_final_or_expired_not_confirmed')
assert.equal(invariantOf(stateWith({ deposit: 'EXPIRED', booking: 'HELD', ...cartWithOne }, completeSelection)), 'rejected_final_or_expired_not_confirmed')

// Flujo y región deben contar la misma historia.
assert.equal(invariantOf(stateWith({ flow: 'DEPOSIT_INSTRUCTIONS', deposit: 'PROOF_RECEIVED', booking: 'PENDING_PAYMENT_REVIEW', ...cartWithOne }, completeSelection)), 'deposit_instructions_flow_matches_deposit_region')
assert.equal(invariantOf(stateWith({ flow: 'DEPOSIT_REVIEW', deposit: 'PENDING_PROOF', booking: 'HELD', ...cartWithOne }, completeSelection)), 'deposit_review_flow_matches_deposit_region')
assert.equal(invariantOf(stateWith({ flow: 'BOOKING_CONFIRMED', booking: 'PENDING_PAYMENT_REVIEW', deposit: 'PROOF_RECEIVED', ...cartWithOne }, completeSelection)), 'confirmed_flow_matches_booking_region')

// El parser no castea regiones desconocidas como si fueran válidas.
assert.equal(invariantOf(stateWith({ booking: 'MAGIC' })), 'region_status_known')
assert.equal(invariantOf(stateWith({ deposit: 'REJECTED' })), 'region_status_known')
assert.equal(invariantOf(stateWith({ handoff: 'HUMAN_QUEUED' })), 'region_status_known')
assert.equal(invariantOf(stateWith({ flow: 'HANDOFF_QUEUED', handoff: 'NONE' })), 'handoff_flow_consistency')
assert.equal(invariantOf(stateWith({ flow: 'MAIN_MENU', handoff: 'QUEUED' })), 'handoff_flow_consistency')

for (const requiredField of [
  'discardReturnFlow',
  'handoffReturnFlow',
  'catalogMode',
  'nameCandidate',
  'pendingEntityRef',
  'rejectedRecommendationIds'
] as const) {
  const persisted = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>
  delete persisted[requiredField]
  assert.equal(
    parseBotOptionsState(persisted).ok,
    false,
    `el parser no puede castear un estado sin ${requiredField}`
  )
}
const missingProfessional = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>
delete (missingProfessional['selections'] as Record<string, unknown>)['professionalId']
assert.equal(parseBotOptionsState(missingProfessional).ok, false)

assert.equal(
  invariantOf(stateWith({ flow: 'CART_REVIEW', handoff: 'TAKEN', ...cartWithOne }, completeSelection)),
  'handoff_taken_blocks_functional_flows'
)

assert.equal(
  invariantOf(
    stateWith(
      { selections: { categoryId: null, professionalId: 'pro_1', anyProfessional: true, date: null, slotStartAt: null, appointmentId: null } }
    )
  ),
  'professional_exclusive_selection'
)

assert.equal(invariantOf(stateWith({ presentation: { kind: 'holi' } })), 'presentation_kind_allowed')
assert.equal(invariantOf(stateWith({ presentation: { kind: 'catalog_page', cursor: -1 } })), 'presentation_kind_allowed')
assert.equal(validateBotOptionsState(stateWith({ presentation: { kind: 'catalog_page', cursor: 3 } })).ok, true)
assert.equal(validateBotOptionsState(stateWith({ presentation: { kind: 'catalog_page', cursor: 0, parentServiceId: 'sub_1' } })).ok, true)
assert.equal(invariantOf(stateWith({ presentation: { kind: 'catalog_page', cursor: 0, parentServiceId: ' sub_1 ' } })), 'presentation_kind_allowed')
assert.equal(validateBotOptionsState(stateWith({ presentation: { kind: 'slot_band', band: 'AFTERNOON' } })).ok, true)

// ─── Escalación gradual de inválidos ─────────────────────────────────────────

let escalating = registerInvalidInput(initial)
assert.equal(escalating.escalation, 'none')
assert.equal(escalating.state.invalidStreak, 1)

escalating = registerInvalidInput(escalating.state)
assert.equal(escalating.escalation, 'highlight_human')
assert.equal(escalating.state.invalidStreak, 2)

escalating = registerInvalidInput(escalating.state)
assert.equal(escalating.escalation, 'auto_handoff')
assert.equal(escalating.state.invalidStreak, 3)

escalating = registerInvalidInput(escalating.state)
assert.equal(escalating.state.invalidStreak, 3, 'el contador no supera tres')

const reset = resetInvalidStreak(escalating.state)
assert.equal(reset.invalidStreak, 0)
assert.equal(resetInvalidStreak(initial), initial, 'reset sin cambios devuelve el mismo objeto')

console.log('OK bot-options domain: acciones, estado e invariantes cumplen el contrato.')
