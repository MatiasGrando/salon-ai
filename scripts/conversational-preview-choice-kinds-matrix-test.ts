import assert from 'node:assert/strict'
import { issueChoiceQuestion, publicChoiceQuestion, type ConversationChoiceKind, type ConversationChoiceOperation } from '../src/conversational-bot/choices.js'
import { readPreviewChoiceState, resolvePreviewChoice, storePreviewChoiceState, nextPreviewRevision, PreviewChoiceError } from '../src/conversational-bot/preview-choice.js'

const operations: { kind: ConversationChoiceKind; label: string; operation: ConversationChoiceOperation }[] = [
  { kind: 'service', label: 'Corte mujer', operation: { kind: 'service', serviceId: 'woman' } },
  { kind: 'service', label: 'Corte mujer del grupo', operation: { kind: 'service', serviceId: 'woman', targetMemberId: 'm1' } },
  { kind: 'date', label: 'Sábado 03/10', operation: { kind: 'date', date: '2026-10-03' } },
  { kind: 'professional', label: 'Ramiro', operation: { kind: 'professional', professionalId: 'rama' } },
  { kind: 'professional', label: 'Cualquier profesional', operation: { kind: 'any_professional' } },
  { kind: 'slot', label: '18:00 con Ramiro', operation: { kind: 'slot', date: '2026-10-03', time: '18:00', startAt: '2026-10-03T21:00:00.000Z', professionalId: 'rama' } },
  { kind: 'preference', label: 'Por la noche', operation: { kind: 'preference', preference: { kind: 'band', band: 'EVENING' } } },
  { kind: 'preference', label: 'Cualquier horario', operation: { kind: 'preference', preference: { kind: 'any' } } },
  { kind: 'estimate', label: 'Karsell', operation: { kind: 'estimate', serviceId: 'cream', optionId: 'karsell', configurationKey: 'fresh-key' } },
  { kind: 'slot', label: 'Más horarios', operation: { kind: 'page', questionKind: 'slots', cursor: 1 } },
  { kind: 'professional', label: 'Más profesionales', operation: { kind: 'page', questionKind: 'professionals', cursor: 1 } },
  { kind: 'date', label: 'Más fechas', operation: { kind: 'page', questionKind: 'dates', cursor: 1 } },
  { kind: 'proposal', label: 'Confirmar', operation: { kind: 'confirm', nonce: 'verified_nonce_123456' } }
]
let sequence = 0
const token = () => `matrix_token_${String(++sequence).padStart(12, '0')}`
for (const [index, item] of operations.entries()) {
  const scope = { businessId: 'qa', conversationKey: `demo:preview:admin:${index}`, policyKey: 'preview:v1', policyGeneration: 1, revision: '1' }
  const draft = { businessId: 'qa', selectedService: 'woman', step: item.kind }
  const question = issueChoiceQuestion(scope, draft, { kind: item.kind, title: 'Elegí una opción', choices: [{ label: item.label, operation: item.operation }] }, token)
  const stored = storePreviewChoiceState(draft, '1', question)
  const button = publicChoiceQuestion(question).choices[0]!
  assert.equal(button.title, item.label)
  assert.deepEqual(resolvePreviewChoice(stored, scope, button.id), { label: item.label, operation: item.operation }, item.kind + '/' + item.operation.kind)
  assert.equal(readPreviewChoiceState(stored).revision, '1')
  const cloned = structuredClone(stored)
  cloned.selectedService = 'other'
  assert.throws(() => resolvePreviewChoice(cloned, scope, button.id), PreviewChoiceError, 'draft mutation invalidates every kind')
  assert.throws(() => resolvePreviewChoice(stored, { ...scope, conversationKey: 'foreign' }, button.id), PreviewChoiceError)
  assert.throws(() => resolvePreviewChoice(stored, { ...scope, policyGeneration: 2 }, button.id), PreviewChoiceError)
  assert.throws(() => resolvePreviewChoice(storePreviewChoiceState(draft, nextPreviewRevision('1'), null), { ...scope, revision: '2' }, button.id), PreviewChoiceError)
  assert.throws(() => resolvePreviewChoice(stored, scope, 'c1.' + token() + '.' + token()), PreviewChoiceError)
}
console.log('PASS full preview operation-kind ledger matrix: current, stale, foreign, nonce')
