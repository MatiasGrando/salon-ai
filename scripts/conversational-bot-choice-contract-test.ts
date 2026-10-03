import assert from 'node:assert/strict'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice, parseChoiceQuestion, type ChoiceScope } from '../src/conversational-bot/choices.js'

const scope: ChoiceScope = { businessId: 'qa', conversationKey: 'demo:preview:admin:one', policyKey: 'preview-v1', policyGeneration: 1, revision: '1' }
const draft = { businessId: 'qa', pending: 'professional', serviceId: 'cut', date: '2026-10-03' }
let sequence = 0
const token = () => `server_token_${String(++sequence).padStart(8, '0')}`
const issued = issueChoiceQuestion(scope, draft, {
  kind: 'professional', title: 'Elegí un profesional', choices: [
    { label: 'Cualquier profesional', operation: { kind: 'any_professional' } },
    { label: 'Ramiro', operation: { kind: 'professional', professionalId: 'rama' } }
  ]
}, token)
const dto = publicChoiceQuestion(issued)
assert.equal(dto.kind, 'professional')
assert.equal(dto.mode, 'list', 'long button labels keep their full meaning in a list')
assert.deepEqual(dto.choices.map(choice => choice.title), ['Cualquier profesional', 'Ramiro'])
assert.match(dto.choices[0]!.id, /^c1\.[\w-]+\.[\w-]+$/)
assert.doesNotMatch(JSON.stringify(dto), /professionalId|conversationKey|draftFingerprint|policyKey/)
const selected = resolveChoice(issued, scope, draft, dto.choices[1]!.id)
assert.deepEqual(selected.operation, { kind: 'professional', professionalId: 'rama' })
assert.equal(selected.label, 'Ramiro')
if (selected.operation.kind === 'professional') selected.operation.professionalId = 'mutated'
assert.deepEqual(resolveChoice(issued, scope, draft, dto.choices[1]!.id).operation, { kind: 'professional', professionalId: 'rama' })
assert.deepEqual(parseChoiceQuestion(structuredClone(issued)), issued)
const jsonbOrderedDraft = Object.fromEntries(Object.entries(draft).reverse())
const jsonbOrderedQuestion = { ...issued, scope: Object.fromEntries(Object.entries(issued.scope).reverse()) }
assert.deepEqual(resolveChoice(jsonbOrderedQuestion, scope, jsonbOrderedDraft, dto.choices[1]!.id).operation,
  { kind: 'professional', professionalId: 'rama' }, 'JSONB key order does not invalidate an unchanged draft')

for (const patch of [{ businessId: 'foreign' }, { conversationKey: 'other-chat' }, { policyKey: 'other-policy' }, { policyGeneration: 2 }, { revision: '2' }]) {
  assert.throws(() => resolveChoice(issued, { ...scope, ...patch }, draft, dto.choices[1]!.id), /stale|scope/)
}
assert.throws(() => resolveChoice(issued, scope, { ...draft, date: '2026-10-04' }, dto.choices[1]!.id), /stale/)
for (const id of ['', 'b1.legacy.choice', 'c1.not-issued.token', dto.choices[1]!.id + '.extra', 'x'.repeat(300)]) {
  assert.throws(() => resolveChoice(issued, scope, draft, id), /invalid|stale|unknown/)
}
assert.throws(() => parseChoiceQuestion({ ...issued, injected: true }), /invalid/)
assert.throws(() => parseChoiceQuestion({ ...issued, choices: [{ ...issued.choices[0], operation: { kind: 'booking.confirm' } }] }), /invalid/)
assert.throws(() => issueChoiceQuestion(scope, draft, { kind: 'professional', title: 'Choose', choices: Array.from({ length: 11 }, (_, i) => ({ label: `Professional ${i}`, operation: { kind: 'professional' as const, professionalId: `p${i}` } })) }, token), /invalid|limit/)
assert.throws(() => issueChoiceQuestion(scope, draft, { kind: 'professional', title: 'Choose', choices: [{ label: 'Injected\u0000title', operation: { kind: 'any_professional' } }] }, token), /invalid/)
assert.throws(() => issueChoiceQuestion(scope, draft, { kind: 'date', title: 'Choose', choices: [{ label: 'Invalid', operation: { kind: 'date', date: '2026-02-31' } }] }, token), /invalid/)
assert.throws(() => issueChoiceQuestion(scope, draft, { kind: 'professional', title: 'Choose', choices: [{ label: 'Any', operation: { kind: 'any_professional' } }] }, () => 'constant_token_12345'), /duplicate/)
assert.throws(() => issueChoiceQuestion({ ...scope, revision: '01' }, draft, { kind: 'professional', title: 'Choose', choices: [] }, token), /invalid/)

const allOperations = [
  { kind: 'service', serviceId: 'cut', targetMemberId: 'm1' },
  { kind: 'date', date: '2026-10-03' },
  { kind: 'slot', date: '2026-10-03', time: '17:00', startAt: '2026-10-03T20:00:00.000Z', professionalId: 'rama' },
  { kind: 'preference', preference: { kind: 'band', band: 'AFTERNOON' } },
  { kind: 'estimate', serviceId: 'smooth', optionId: 'long', configurationKey: 'fresh-key' },
  { kind: 'confirm', nonce: 'proposal_nonce_123456' },
  { kind: 'page', questionKind: 'slots', cursor: 1 }
] as const
for (const operation of allOperations) {
  const question = issueChoiceQuestion(scope, draft, { kind: 'slot', title: 'Choose', choices: [{ label: 'A server option', operation }] }, token)
  assert.deepEqual(resolveChoice(question, scope, draft, publicChoiceQuestion(question).choices[0]!.id).operation, operation)
}
const configured = issueChoiceQuestion(scope, draft, { kind: 'estimate', title: 'Choose', choices: [{ label: 'Configured option', operation: { kind: 'estimate', serviceId: 'smooth', optionId: 'long', configurationKey: 'k'.repeat(6000) } }] }, token)
assert.equal(publicChoiceQuestion(configured).mode, 'buttons')
console.log('conversational server choices contract: OK')
