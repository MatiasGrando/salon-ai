import assert from 'node:assert/strict'
import { processConversationInbox } from '../src/conversational-bot/process-inbox-job.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../src/bot-options/domain/state.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
import type { ConversationPolicy } from '../src/conversational-bot/runtime-policy.js'

// Strict local transport double, reusing the public runtime entry and its real state/reconciliation helpers.
// It is not a SQL/concurrency test, does not load .env and has no real provider or database.
type Query = { sql: string; values: unknown[] }
const originalPolicy: ConversationPolicy = { businessId: 'tenant', deploymentId: 'dep', generation: 1, configurationId: 'cfg' }
const activePolicy: ConversationPolicy = { ...originalPolicy, configurationId: 'cfg-new' }
const oldDraft = { ...initialDialogueState('tenant'), customerName: 'Previous customer', serviceId: 'cut', pending: 'date' as const }
const baseState = projectConversationDraft(oldDraft, originalPolicy)
function fixture(state: unknown, policy = activePolicy) {
  const now = new Date('2026-10-18T12:00:00Z')
  let session = { sessionId: 'session', conversationId: 'conversation', revision: 4n, status: 'ACTIVE', state: structuredClone(state),
    businessTimezone: 'UTC', handoffFenceEpoch: 0, handoffClaimsPausedAt: null, deploymentId: 'dep', deploymentGeneration: 1 }
  const row = { ...policy, customerCode: 'WX-NEW', configurationBusinessId: 'tenant', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
    definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } }, id: 'inbox', actionType: 'input.initial', expectedRevision: null,
    deploymentGeneration: policy.generation, fenceEpoch: 1, payload: { fromPhone: '5491112345678', textBody: 'hola', messageType: 'text', contextWindowEvaluated: true },
    providerEventId: 'event', providerMessageId: 'message', providerPhoneNumberId: 'channel', status: 'ADMITTED', dbNow: now, businessTimezone: 'UTC',
    admittedAt: now, providerOccurredAt: now, botEnabled: true, projectedConversationId: 'conversation' }
  const statements: Query[] = [], replies: string[] = [], aiInputs: Array<{ message: string; state: unknown }> = []
  let inTransaction = false, consumed = 0
  const client = {
    async $transaction<T>(body: (tx: unknown) => Promise<T>) {
      assert.equal(inTransaction, false)
      const before = structuredClone({ session, status: row.status, replies })
      inTransaction = true
      try { return await body(client) }
      catch (error) { session = before.session; row.status = before.status; replies.splice(0, replies.length, ...before.replies); throw error }
      finally { inTransaction = false }
    },
    async $queryRaw(query: Query) {
      statements.push(query)
      const sql = query.sql
      if (sql.includes('conversation-policy')) return [row]
      if (sql.includes('conversation-target')) return [{ fenceEpoch: 1, phone: row.payload.fromPhone }]
      if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
      if (sql.includes('conversation-claims-assert')) return [{ jobCount: 1n, dispatchCount: 1n }]
      if (sql.includes('conversation-feature-lock') || sql.includes('conversation-terminal-inbox-reconcile')) return []
      if (sql.includes('conversation-inbox-lock')) return [structuredClone(row)]
      if (sql.includes('consolidation-inbox-identity')) return [{ phone: row.payload.fromPhone }]
      if (sql.includes('conversation-choice-policy-guard')) return [{ actionType: row.actionType }]
      if (sql.includes('conversation-order')) return [{ blocked: false }]
      if (sql.includes('consolidation-previous')) return []
      if (sql.includes('consolidation-candidates')) return [{ id: row.providerEventId, admittedAt: now, payload: row.payload,
        providerPhoneNumberId: row.providerPhoneNumberId, providerMessageId: row.providerMessageId, actionType: row.actionType }]
      if (sql.includes('conversation-turn-persist')) {
        const serialized = query.values.find(value => typeof value === 'string' && value.includes('"schemaVersion"')) as string
        session.state = JSON.parse(serialized)
        session.revision = query.values.find(value => typeof value === 'bigint') as bigint
        return [{ sessionCount: 1n, transitionCount: 1n, stepCount: 1n, conversationId: 'conversation', updatedAt: now }]
      }
      if (sql.includes('settled_inbox')) {
        row.status = 'PROCESSED'
        return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }]
      }
      throw new Error('unhandled cutover test query: ' + sql.slice(0, 180))
    },
    async $executeRaw(query: Query) {
      statements.push(query)
      assert.doesNotMatch(query.sql, /(?:INSERT INTO|UPDATE|DELETE FROM) "(?:Appointment|BookingVisit|BookingDeposit|Payment|Message)"/,
        'policy reconciliation cannot write financial, booking or historical message rows')
      if (query.sql.includes('conversation-generation-reset')) {
        session.state = createInitialBotOptionsState(); session.deploymentGeneration = policy.generation; session.revision++
      }
      return 1
    }
  }
  return {
    run: () => processConversationInbox({ client: client as never,
      job: { id: 'job', aggregateId: 'inbox', kind: 'PROCESS_INBOX', businessId: 'tenant', deploymentId: 'dep',
        deploymentGeneration: policy.generation, claimToken: 'job-token', attempts: 1 } as never,
      lockSession: async () => structuredClone(session) as never,
      projectInbound: async () => { throw new Error('already projected inbound history must not be duplicated') },
      writeView: async (_tx, input) => { replies.push(input.view.interactiveBody ?? '') },
      isRestart: () => false, onInboundConsumed: () => { consumed++ },
      dialogueFactory: async () => {
        assert.equal(inTransaction, false)
        return { context: { businessId: 'tenant', timezone: 'UTC', dbNow: now },
          port: { catalog: async () => [{ id: 'cut', name: 'Corte', durationMinutes: 30, price: 1000, requiresConsultation: false }],
            availability: async () => ({ professionals: [], slots: [] }) } }
      },
      conversationalAi: { timeoutMs: 1000, provider: async input => {
        assert.equal(inTransaction, false)
        aiInputs.push({ message: input.message, state: structuredClone(input.state) })
        return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
      } }
    }),
    get state() { return session.state }, get status() { return row.status }, get consumed() { return consumed },
    replies, statements, aiInputs
  }
}

const failures: string[] = []
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log('PASS ' + name) }
  catch (error) { failures.push(name + ': ' + String(error)); console.error('FAIL ' + failures.at(-1)) }
}
for (const [name, state, policy] of [
  ['changed configuration', baseState, activePolicy],
  ['legacy unfinished draft', { ...createInitialBotOptionsState(), flow: 'NAME_INPUT' }, activePolicy],
  ['changed generation', baseState, { ...activePolicy, generation: 2 }]
] as const) await check(name, async () => {
  const runtime = fixture(state, policy)
  assert.equal(await runtime.run(), 'PROCESSED')
  assert.equal(runtime.status, 'PROCESSED')
  assert.equal(runtime.consumed, 1)
  assert.equal(runtime.aiInputs.length, 1, 'current durable message still reaches AI exactly once')
  assert.equal(runtime.aiInputs[0]!.message, 'hola')
  assert.deepEqual(runtime.aiInputs[0]!.state, initialDialogueState('tenant'), 'AI must not inherit old services, name or management authority')
  assert.equal(readConversationDraft(runtime.state, policy, 'UTC').serviceId, null)
  assert.equal(runtime.replies.length, 1)
})
for (const [booking, deposit, flow] of [
  ['HELD', 'PENDING_PROOF', 'DEPOSIT_INSTRUCTIONS'],
  ['PENDING_PAYMENT_REVIEW', 'PROOF_RECEIVED', 'DEPOSIT_REVIEW'],
  ['CONFIRMED', 'APPROVED', 'BOOKING_CONFIRMED'],
  ['CONFIRMED', 'NONE', 'BOOKING_CONFIRMED']
] as const) await check('protected ' + booking + '/' + deposit, async () => {
  const protectedState = { ...baseState, booking, deposit, flow, selections: { ...baseState.selections,
    professionalId: 'professional', date: '2026-10-20', slotStartAt: '2026-10-20T12:00:00Z' } }
  assert.equal(parseBotOptionsState(protectedState).ok, true, 'negative fixture must be a structurally valid legacy financial projection')
  const runtime = fixture(protectedState)
  assert.equal(await runtime.run(), 'PROCESSED')
  assert.deepEqual(runtime.state, protectedState, 'financial projection and immutable old sidecar remain untouched')
  assert.equal(runtime.aiInputs.length, 0, 'unverified financial authority never reaches AI or management')
  assert.equal(runtime.replies.length, 1, 'existing protected notice is delivered rather than silent retry')
  assert.match(runtime.replies[0]!, /operaci.n anterior pendiente/)
})
for (const [name, state] of [
  ['foreign sidecar tenant', { ...baseState, conversationDraft: { ...baseState.conversationDraft, policy: { ...originalPolicy, businessId: 'foreign' } } }],
  ['malformed old dialogue', { ...baseState, conversationDraft: { ...baseState.conversationDraft, dialogue: { broken: true } } }]
] as const) await check(name, async () => {
  const runtime = fixture(state)
  await assert.rejects(runtime.run(), /invalid conversation sidecar tenant|invalid dialogue/)
  assert.deepEqual(runtime.state, state)
  assert.equal(runtime.status, 'ADMITTED')
  assert.equal(runtime.replies.length, 0)
  assert.equal(runtime.aiInputs.length, 0)
})
assert.deepEqual(failures, [], 'all cutover guards must pass')
console.log('PASS policy cutover: durable current input, clean unfunded draft, protected finance and strict tenant/version validation')
