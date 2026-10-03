import assert from 'node:assert/strict'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { readPreviewChoiceState, storePreviewChoiceState, nextPreviewRevision, resolvePreviewChoice, PreviewChoiceError } from '../src/conversational-bot/preview-choice.js'

const draft = { schemaVersion: 1, businessId: 'qa', pending: 'date', serviceId: 'cut' }
const scope = { businessId: 'qa', conversationKey: 'demo:preview:admin:one', policyKey: 'preview-v1', policyGeneration: 1, revision: '1' }
let id = 0
const question = issueChoiceQuestion(scope, draft, { kind: 'date', title: 'Elegí una fecha', choices: [{ label: 'Sábado 03/10', operation: { kind: 'date', date: '2026-10-03' } }] }, () => `question_token_${String(++id).padStart(8, '0')}`)
assert.deepEqual(readPreviewChoiceState(draft), { draft, revision: '0', question: null })
assert.deepEqual(readPreviewChoiceState(null), { draft: null, revision: '0', question: null })
const stored = storePreviewChoiceState(draft, '1', question)
assert.equal(stored.businessId, 'qa', 'legacy top-level draft readers remain compatible')
assert.equal(stored.previewChoiceContext.revision, '1')
assert.deepEqual(readPreviewChoiceState(stored), { draft, revision: '1', question })
assert.equal(nextPreviewRevision('1'), '2')
const choiceId = publicChoiceQuestion(question).choices[0]!.id
assert.deepEqual(resolvePreviewChoice(stored, scope, choiceId), { label: 'Sábado 03/10', operation: { kind: 'date', date: '2026-10-03' } })
assert.throws(() => resolvePreviewChoice(storePreviewChoiceState(draft, '2', null), { ...scope, revision: '2' }, choiceId), PreviewChoiceError)
assert.throws(() => resolvePreviewChoice(stored, { ...scope, conversationKey: 'other-chat' }, choiceId), PreviewChoiceError)
assert.throws(() => resolvePreviewChoice(stored, scope, 'b1.old.choice'), PreviewChoiceError)
assert.throws(() => storePreviewChoiceState(draft, '2', question), /revision/)
assert.throws(() => storePreviewChoiceState({ ...draft, serviceId: 'new' }, '1', question), /draft/)
assert.throws(() => readPreviewChoiceState({ ...draft, previewChoiceContext: { version: 1, revision: '1', question: { arbitrary: true } } }), /invalid/)
assert.throws(() => readPreviewChoiceState({ ...draft, previewChoiceContext: { version: 1, revision: '1', question: null, arbitrary: true } }), /invalid/)
assert.throws(() => nextPreviewRevision('9223372036854775807'), /revision/)
assert.equal(Object.hasOwn(readPreviewChoiceState(stored).draft!, 'previewChoiceContext'), false, 'private ledger never reaches the engine/public draft')
console.log('conversational preview choice ledger: OK')
