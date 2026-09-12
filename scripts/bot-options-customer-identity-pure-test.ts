import assert from 'node:assert/strict'
import { validateBotOptionsActionEnvelope } from '../src/bot-options/domain/actions.js'
import { validateCustomerName } from '../src/bot-options/domain/customer-name-validation.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { transition, type TransitionContext } from '../src/bot-options/domain/transition.js'

const NOW = '2026-08-26T12:00:00Z'
const ctx = (overrides: Partial<TransitionContext> = {}): Partial<TransitionContext> & Pick<TransitionContext, 'dbNowIso'> => ({
  dbNowIso: NOW,
  ...overrides
})

const accepted: Array<[string, string]> = [
  ['Martina García', 'Martina García'],
  ['  Juan  Pérez  ', 'Juan Pérez'],
  ["Ana-María O'Connor", "Ana-María O'Connor"],
  ['Ñoño', 'Ñoño'],
  ['Jose\u0301', 'José'],
  ['L\u2019Oréal', 'L\u2019Oréal'],
  ['María José–Luis', 'María José–Luis'],
  ['J. K. Rowling', 'J. K. Rowling'],
  ['Иван Петров', 'Иван Петров'],
  ['佐藤花子', '佐藤花子'],
  ['김철수', '김철수'],
  ['محمد علي', 'محمد علي'],
  ['किरण', 'किरण'],
  ['A'.repeat(80), 'A'.repeat(80)],
  ['Li', 'Li']
]

for (const [input, normalized] of accepted) {
  const result = validateCustomerName(input)
  assert.deepEqual(result, { ok: true, normalized }, `debe aceptar ${JSON.stringify(input)}`)
}

const rejected = [
  '', ' ', 'A', 'A'.repeat(81), 'Juan123', '12345', 'Juan 😀', '🔥fire🔥',
  'https://example.com', 'www.google.com', 'user@example.com',
  'Juan\tPérez', 'Juan\nPérez', 'Juan\rPérez', 'Juan\u2028Pérez',
  'Juan\u00a0Pérez', 'Juan\u200dPérez', 'Juan\u200cPérez', 'Juan\u00adPérez',
  '\u0301Ana', 'Ana \u0301María', '...', '---', "'''", '. . .',
  'Juan...', "L'Oréal'''", 'A---B', 'Ana−María', 'Ana′María'
]

for (const input of rejected) {
  const result = validateCustomerName(input)
  assert.equal(result.ok, false, `debe rechazar ${JSON.stringify(input)}`)
}

const nameEnvelope = (name: string) => ({
  schemaVersion: 1,
  engineKey: 'deterministic-options',
  engineVersion: 'v1',
  deploymentId: 'deployment',
  deploymentGeneration: 1,
  businessId: 'business',
  sessionId: 'session',
  origin: 'SYSTEM',
  actionType: 'name.submit',
  entityRef: null,
  payload: { name },
  expectedStateRevision: 0n,
  providerMessageId: null,
  providerEventId: null,
  promptId: null,
  choiceToken: null,
  receivedAtIso: NOW
})

const normalizedAction = validateBotOptionsActionEnvelope(nameEnvelope('  Ana-Mari\u0301a  O\u2019Connor  '))
assert.equal(normalizedAction.ok, true)
if (normalizedAction.ok) assert.deepEqual(normalizedAction.envelope.payload, { name: 'Ana-María O’Connor' })

for (const name of ['Ana\tMaría', 'Ana\nMaría', 'Ana\u200dMaría', '\u0301Ana']) {
  const action = validateBotOptionsActionEnvelope(nameEnvelope(name))
  assert.equal(action.ok, false, `admisión debe rechazar ${JSON.stringify(name)}`)
}

const initial = createInitialBotOptionsState()
const unknown = transition(initial, { actionType: 'menu.start_booking', entityRef: null, payload: null }, ctx())
assert.equal(unknown.outcome, 'APPLIED')
assert.equal(unknown.state.flow, 'CATEGORY_SELECT', 'el nombre desconocido no debe bloquear el inicio de la reserva')

const known = transition(initial, { actionType: 'menu.start_booking', entityRef: null, payload: null }, ctx({ customerNameOnFile: 'Martina' }))
assert.equal(known.outcome, 'APPLIED')
assert.equal(known.state.flow, 'CATEGORY_SELECT')

const pendingBooking = {
  ...initial,
  flow: 'NAME_INPUT' as const,
  booking: 'DRAFT' as const,
  cart: [{ serviceId: 'cut' }],
  selections: {
    ...initial.selections,
    anyProfessional: true,
    date: '2026-08-30',
    slotStartAt: '2026-08-30T15:00:00Z',
    provisionalProfessionalId: 'p1'
  }
}
const invalidSubmit = transition(
  pendingBooking,
  { actionType: 'name.submit', entityRef: null, payload: { name: 'Ana\tMaría' } },
  ctx()
)
assert.notEqual(invalidSubmit.outcome, 'APPLIED')
assert.equal(invalidSubmit.state.flow, 'NAME_INPUT')
assert.equal(invalidSubmit.state.nameCandidate, null)
assert.equal(invalidSubmit.state.selections.slotStartAt, pendingBooking.selections.slotStartAt, 'un nombre inválido no pierde el slot')
const bookingContext = ctx({
  slotStillAvailableAtConfirm: true,
  confirmVisitSnapshot: {
    services: [{ serviceId: 'cut', name: 'Corte', durationMinutes: 30, priceMinor: 15000, priceMode: 'FIXED' }],
    professional: { professionalId: 'p1', name: 'Lucas', assignedByBalancer: true },
    totalDurationMinutes: 30,
    totalPriceMinor: 15000
  }
})
const validSubmit = transition(
  pendingBooking,
  { actionType: 'name.submit', entityRef: null, payload: { name: '  ana-mari\u0301a O\u2019Connor  ' } },
  bookingContext
)
assert.equal(validSubmit.outcome, 'APPLIED')
assert.equal(validSubmit.state.flow, 'MAIN_MENU', 'un nombre válido completa la reserva sin NAME_CONFIRM')
assert.equal(validSubmit.state.nameCandidate, null)
if (validSubmit.outcome === 'APPLIED') {
  assert.deepEqual(validSubmit.effects.map((effect) => effect.kind), ['PERSIST_CUSTOMER_NAME', 'CONFIRM_VISIT'])
}

const legacyConfirm = transition(
  { ...pendingBooking, flow: 'NAME_CONFIRM', nameCandidate: 'Ana María' },
  { actionType: 'name.confirm', entityRef: null, payload: null },
  bookingContext
)
assert.equal(legacyConfirm.outcome, 'APPLIED', 'un prompt durable NAME_CONFIRM debe continuar de forma segura')
if (legacyConfirm.outcome === 'APPLIED') assert.deepEqual(legacyConfirm.effects.map((effect) => effect.kind), ['PERSIST_CUSTOMER_NAME', 'CONFIRM_VISIT'])

const legacyView = transition(
  { ...initial, flow: 'NAME_CONFIRM', nameCandidate: 'Ana María' },
  { actionType: 'system.reprompt', entityRef: null, payload: null },
  ctx()
)
assert.equal(legacyView.view.choices.some((choice) => choice.actionType === 'name.confirm'), false, 'NAME_CONFIRM durable no vuelve a mostrar Sí, es correcto')

console.log('OK F6.1/F6.2 pure: Unicode/NFC, nombre al final y confirmación directa compatible con sesiones legacy.')
