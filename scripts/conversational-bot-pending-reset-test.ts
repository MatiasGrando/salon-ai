import assert from 'node:assert/strict'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'
import { choiceDraftFingerprint, parseChoiceQuestion, parseConversationChoiceOperation, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
import { resolveConversationChoicePayload, planConversationChoiceView } from '../src/conversational-bot/runtime-choice-persistence.js'

// Native confirmation only: no AI, network, credentials, database or financial mutations.
const scope = { businessId: 'barber-test', conversationKey: 'current-session', policyKey: 'configuration', policyGeneration: 2, revision: '8' }
const receipt = { kind: 'HELD', coordinationGroupId: 'current-group', operationKey: 'current-hold',
  proposalNonce: '80caf805-d965-4918-bd1a-7295fcc0325c', fingerprint: 'a'.repeat(64), depositStatus: 'PENDING_PROOF' }
const draft = { businessId: scope.businessId, bookingReservation: { receipt }, customerName: 'Ana' }
const operation = (confirm: boolean) => ({ kind: 'pending_deposit_reset', confirm,
  proposalNonce: receipt.proposalNonce, receiptFingerprint: canonicalJsonHash(receipt) })
const nonce = 'question_nonce_current_01', yes = 'confirm_choice_current_01', no = 'keep_choice_current_0001'
const questionValue = () => ({ version: 1, scope, draftFingerprint: choiceDraftFingerprint(draft), nonce,
  kind: 'proposal', title: 'Pedido pendiente', choices: [
    { token: yes, label: 'Cancelar y reiniciar', operation: operation(true) },
    { token: no, label: 'Mantener pedido', operation: operation(false) }
  ] })
const actionId = (token: string) => `c1.${nonce}.${token}`
const failures: string[] = []; let passed = 0
async function check(label: string, run: () => void) {
  try { run(); passed++; console.log('PASS pending reset ' + label) }
  catch (error) { failures.push(label); console.error('RED pending reset ' + label + ': ' + String(error)) }
}
for (const confirm of [false, true]) await check('closed purpose operation ' + confirm, () => {
  assert.deepEqual(parseConversationChoiceOperation(operation(confirm)), operation(confirm))
})
await check('offer carries both native choices without financial consent', () => {
  const original = structuredClone(draft), question = parseChoiceQuestion(questionValue())
  const visible = publicChoiceQuestion(question)
  assert.equal(visible.mode, 'buttons')
  assert.deepEqual(visible.choices.map(choice => choice.title), ['Cancelar y reiniciar', 'Mantener pedido'])
  const plan = planConversationChoiceView({ question, reply: 'Tenés una seña pendiente. ¿Querés cancelar todo el pedido y reiniciar?', transitionId: 'offer-only' })
  assert.equal(plan.choiceRows.length, 2)
  assert.ok(plan.choiceRows.every(choice => choice.actionType === 'conversation.choice'))
  assert.deepEqual(draft, original, 'rendering an offer cannot reset or cancel the order')
})
for (const confirm of [false, true]) await check('current native choice resolves exact purpose ' + confirm, () => {
  const question = parseChoiceQuestion(questionValue())
  const payload = { question, choiceId: actionId(confirm ? yes : no) }
  assert.deepEqual(resolveConversationChoicePayload(payload, scope, draft).operation, operation(confirm))
  assert.notEqual(resolveConversationChoicePayload(payload, scope, draft).operation.kind, 'confirm', 'pending cancellation never becomes booking confirmation')
})
for (const [label, changed] of [
  ['business', { businessId: 'foreign-business' }], ['session', { conversationKey: 'foreign-session' }],
  ['generation', { policyGeneration: 3 }], ['revision', { revision: '9' }], ['policy', { policyKey: 'foreign-policy' }]
] as const) await check('stale ' + label + ' cannot authorize cancellation', () => {
  const question = parseChoiceQuestion(questionValue())
  assert.throws(() => resolveChoice(question, { ...scope, ...changed }, draft, actionId(yes)), /stale/)
})
await check('changed receipt or customer draft cannot authorize cancellation', () => {
  const question = parseChoiceQuestion(questionValue())
  for (const altered of [
    { ...draft, bookingReservation: { receipt: { ...receipt, coordinationGroupId: 'foreign-group' } } },
    { ...draft, bookingReservation: { receipt: { ...receipt, depositStatus: 'PROOF_RECEIVED' } } },
    { ...draft, customerName: 'Different customer' }
  ]) assert.throws(() => resolveChoice(question, scope, altered, actionId(yes)), /stale/)
})
await check('wrong prompt nonce or unissued choice cannot authorize cancellation', () => {
  const question = parseChoiceQuestion(questionValue())
  assert.throws(() => resolveChoice(question, scope, draft, 'c1.other_question_current01.' + yes), /stale/)
  assert.throws(() => resolveChoice(question, scope, draft, actionId('unissued_choice_current01')), /unknown/)
})
await check('operation rejects missing purpose binding or extra authority fields', () => {
  assert.deepEqual(parseConversationChoiceOperation(operation(true)), operation(true), 'positive schema must be supported before these negative guards count')
  for (const changed of [
    { ...operation(true), confirm: 'yes' }, { ...operation(true), proposalNonce: '' },
    { ...operation(true), receiptFingerprint: 'not-a-fingerprint' }, { ...operation(true), actor: 'STAFF' },
    { ...operation(true), appointmentIds: ['foreign'] }
  ]) assert.throws(() => parseConversationChoiceOperation(changed))
})
console.log('Pending reset choice contract: ' + passed + ' passed; ' + failures.length + ' failed')
assert.deepEqual(failures, [])
