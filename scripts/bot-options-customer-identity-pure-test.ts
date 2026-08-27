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
assert.equal(unknown.state.flow, 'NAME_INPUT')

const known = transition(initial, { actionType: 'menu.start_booking', entityRef: null, payload: null }, ctx({ customerNameOnFile: 'Martina' }))
assert.equal(known.outcome, 'APPLIED')
assert.equal(known.state.flow, 'CATEGORY_SELECT')

const invalidSubmit = transition(
  { ...initial, flow: 'NAME_INPUT' },
  { actionType: 'name.submit', entityRef: null, payload: { name: 'Ana\tMaría' } },
  ctx()
)
assert.notEqual(invalidSubmit.outcome, 'APPLIED')
assert.equal(invalidSubmit.state.flow, 'NAME_INPUT')
assert.equal(invalidSubmit.state.nameCandidate, null)

const validSubmit = transition(
  { ...initial, flow: 'NAME_INPUT' },
  { actionType: 'name.submit', entityRef: null, payload: { name: '  ana-mari\u0301a O\u2019Connor  ' } },
  ctx()
)
assert.equal(validSubmit.outcome, 'APPLIED')
assert.equal(validSubmit.state.flow, 'NAME_CONFIRM')
assert.equal(validSubmit.state.nameCandidate, 'ana-maría O’Connor', 'NFC debe conservar casing')
if (validSubmit.outcome === 'APPLIED') {
  assert.deepEqual(validSubmit.effects, [], 'name.submit sólo guarda candidato en estado; cero efectos persistentes')
}

const confirmed = transition(validSubmit.state, { actionType: 'name.confirm', entityRef: null, payload: null }, ctx())
assert.equal(confirmed.outcome, 'APPLIED')
if (confirmed.outcome === 'APPLIED') {
  assert.deepEqual(confirmed.effects, [{ kind: 'PERSIST_CUSTOMER_NAME', name: 'ana-maría O’Connor' }])
}

console.log('OK F6.1/F6.2 pure: Unicode/NFC, controles, compuerta de nombre y cero efectos antes de confirmar.')
