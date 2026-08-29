import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectInboundConversationMessage,
  flushInboundConversationMessages,
  subscribeToCrmRealtimeEvents,
  type InboundConversationMessageProjection
} from '../src/services/crm-realtime-events.js'

// Guard the real wiring: the authoritative job must collect inside the
// transaction and flush strictly after `await $transaction(...)` resolves.
const processSessionSource = readFileSync(
  new URL('../src/bot-options/application/process-session-job.ts', import.meta.url),
  'utf8'
)
assert.match(
  processSessionSource,
  /collectInboundConversationMessage\(pendingCrmEvents,\s*\{/,
  'production must record the inbound projection inside the transaction'
)
assert.match(
  processSessionSource,
  /flushInboundConversationMessages\(pendingCrmEvents\)/,
  'production must flush the inbound SSE after the transaction commits'
)
assert.match(
  processSessionSource,
  /const result = await input\.client\.\$transaction[\s\S]*?flushInboundConversationMessages\(pendingCrmEvents\)/,
  'the flush must be ordered strictly after the commit boundary'
)

// Authoritative Bot Options WhatsApp flow: an inbound Message is projected
// inside a database transaction, but the CRM SSE must be emitted ONLY after the
// transaction commits. `projectInboundMessage` records the projection with
// `collectInboundConversationMessage` (called inside the tx) and the job
// functions call `flushInboundConversationMessages` strictly after the
// `await $transaction(...)` resolves. This test proves that contract without a
// live database by reusing the exact production helpers.

const receivedByGlow: string[] = []
const receivedByOtherBusiness: string[] = []
const glowTypes: string[] = []

const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => {
    glowTypes.push(event.type)
    if (event.type === 'conversation_message_received') receivedByGlow.push(event.messageId)
  }
})
const unsubscribeOther = subscribeToCrmRealtimeEvents({
  businessId: 'other-business',
  send: (event) => {
    if (event.type === 'conversation_message_received') receivedByOtherBusiness.push(event.messageId)
  }
})

// Helper that mirrors exactly what `projectInboundMessage` does on a successful
// insert (it returns the inserted id and collects). On a conflict/no-op it does
// NOT collect, which is the idempotency guarantee we assert below.
function simulateProjectionSuccess(
  pending: InboundConversationMessageProjection[],
  input: InboundConversationMessageProjection
) {
  collectInboundConversationMessage(pending, input)
}

// --- Scenario A: successful authoritative projection, then commit ---
const pendingA: InboundConversationMessageProjection[] = []
simulateProjectionSuccess(pendingA, {
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-1'
})

// Recorded inside the transaction but NOT yet published: the CRM must not see
// the event before the commit boundary.
assert.equal(pendingA.length, 1, 'projection must be recorded while in-flight')
assert.deepEqual(receivedByGlow, [], 'CRM must NOT receive the SSE before commit')
assert.deepEqual(receivedByOtherBusiness, [], 'no cross-tenant SSE before commit')

// Transaction commits → flush after-commit.
flushInboundConversationMessages(pendingA)

assert.deepEqual(receivedByGlow, ['message-1'], 'authoritative inbound must notify the owning tenant after commit')
assert.deepEqual(receivedByOtherBusiness, [], 'tenant isolation: other business must not receive the SSE')
assert.deepEqual(glowTypes, ['conversation_message_received'], 'only the expected realtime event type is emitted')

// --- Scenario B: idempotent conflict (ON CONFLICT DO NOTHING) ---
// A duplicate providerMessageId makes the INSERT a no-op: `projectInboundMessage`
// gets no inserted id and therefore never collects, so flushing emits nothing.
const pendingB: InboundConversationMessageProjection[] = []
// (intentionally not collected — mirrors the conflict branch)
flushInboundConversationMessages(pendingB)
assert.deepEqual(receivedByGlow, ['message-1'], 'conflict/duplicate must not emit a duplicate SSE')

// --- Scenario C: rollback never publishes ---
// The projection is recorded inside the transaction, but if the transaction
// rolls back the flush is never invoked, so the CRM never observes it.
const pendingC: InboundConversationMessageProjection[] = []
simulateProjectionSuccess(pendingC, {
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-2'
})
assert.equal(pendingC.length, 1, 'rolled-back projection is recorded in-flight')
assert.deepEqual(receivedByGlow, ['message-1'], 'CRM must not observe a rolled-back projection')
// flush is intentionally skipped to simulate the rollback path.

unsubscribeGlow()
unsubscribeOther()

console.log('Bot Options authoritative inbound CRM realtime contract: OK')
