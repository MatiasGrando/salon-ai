import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { decideContextWindow, CONTEXT_WINDOW_MS, customerActivityAt } from '../src/bot-options/domain/context-window.js'

const start = new Date('2026-08-30T18:00:00.000Z')
const expires = new Date(start.getTime() + 86_400_000)
const state = { ...createInitialBotOptionsState(), flow: 'BOOKING_SUMMARY' as const, booking: 'DRAFT' as const }
const base = { state, sessionStatus: 'ACTIVE', touchedAt: start, expiresAt: expires, activityAt: expires, isMedia: false }
assert.equal(CONTEXT_WINDOW_MS, 86_400_000)
assert.equal(decideContextWindow({ ...base, activityAt: new Date(expires.getTime() - 1) }), 'RENEW')
assert.equal(decideContextWindow(base), 'EXPIRE')
assert.equal(decideContextWindow({ ...base, activityAt: new Date(expires.getTime() + 1) }), 'EXPIRE')
assert.equal(decideContextWindow({ ...base, activityAt: new Date(start.getTime() - 1) }), 'UNCHANGED')
assert.equal(decideContextWindow({ ...base, activityAt: start }), 'UNCHANGED')
assert.equal(decideContextWindow({ ...base, touchedAt: null, expiresAt: null }), 'INITIALIZE', 'legacy sessions get a first-message grace period')
assert.equal(decideContextWindow({ ...base, touchedAt: start, expiresAt: null }), 'EXPIRE', 'missing deadline is reconstructed from customer activity')
for (const sessionStatus of ['HUMAN_QUEUED', 'HUMAN_TAKEN', 'CLOSED']) {
  assert.equal(decideContextWindow({ ...base, sessionStatus }), 'PROTECTED')
}
for (const booking of ['HELD', 'PENDING_PAYMENT_REVIEW'] as const) {
  assert.equal(decideContextWindow({ ...base, state: { ...state, booking } }), 'PROTECTED')
}
for (const deposit of ['PENDING_PROOF', 'PROOF_RECEIVED', 'REJECTED_RESUBMISSION_ALLOWED'] as const) {
  assert.equal(decideContextWindow({ ...base, state: { ...state, deposit } }), 'PROTECTED')
}
for (const handoff of ['QUEUED', 'TAKEN'] as const) {
  assert.equal(decideContextWindow({ ...base, state: { ...state, handoff } }), 'PROTECTED')
}
assert.equal(decideContextWindow({ ...base, state: { ...state, booking: 'CONFIRMED', deposit: 'APPROVED' } }), 'EXPIRE', 'confirmed durable entities are not the draft')
assert.equal(decideContextWindow({ ...base, isMedia: true }), 'PROTECTED', 'media/proofs must still reach their specialized handler')
assert.equal(customerActivityAt({ admittedAt: start, providerOccurredAt: expires }).getTime(), start.getTime(), 'future provider time is clamped')
assert.equal(customerActivityAt({ admittedAt: expires, providerOccurredAt: start }).getTime(), start.getTime(), 'delivery delay does not renew activity')
assert.equal(customerActivityAt({ admittedAt: start, providerOccurredAt: null }).getTime(), start.getTime())
assert.equal(customerActivityAt({ admittedAt: start, providerOccurredAt: new Date(NaN) }).getTime(), start.getTime())
// 24 elapsed hours, independent of local calendar/daylight saving boundaries.
const dst = new Date('2026-11-01T01:30:00-04:00')
assert.equal(decideContextWindow({ ...base, touchedAt: dst, expiresAt: new Date(dst.getTime() + CONTEXT_WINDOW_MS), activityAt: new Date('2026-11-02T00:30:00-05:00') }), 'EXPIRE')

const processor = readFileSync(new URL('../src/bot-options/application/process-provider-event-job.ts', import.meta.url), 'utf8')
assert.ok(processor.indexOf('await applyLazyContextWindowTx') < processor.indexOf('await classifier.classifyProviderEventTx'), 'expiry must precede interactive classification')
const admission = readFileSync(new URL('../src/bot-options/infrastructure/prisma-admission.ts', import.meta.url), 'utf8')
const webhook = admission.slice(admission.indexOf('async admitAuthoritative('), admission.indexOf('async classifyProviderEventTx('))
assert.doesNotMatch(webhook, /applyLazyContextWindow|draftExpiresAt/, 'no extra work in webhook')
console.log('OK context window: elapsed 24h, rolling activity, bootstrap, delayed events and protected flows.')
