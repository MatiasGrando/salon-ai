import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyLazyContextWindowTx } from '../src/bot-options/application/lazy-context-window.js'
import { persistView } from '../src/bot-options/application/process-session-job.js'
import { processProviderEventJob } from '../src/bot-options/application/process-provider-event-job.js'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'

const admittedAt = new Date('2026-08-31T18:00:00Z')
const input = {
  businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
  providerEventId: 'event-a', phone: 'test-phone', admittedAt, providerOccurredAt: admittedAt, isMedia: false
}
const original = {
  id: 'session-a', revision: 8n, status: 'ACTIVE', deploymentGeneration: 1,
  state: { ...createInitialBotOptionsState(), flow: 'BOOKING_SUMMARY', booking: 'DRAFT' },
  draftTouchedAt: new Date('2026-08-30T18:00:00Z'), draftExpiresAt: admittedAt,
  dbNow: admittedAt, hasInbox: false, durableProtection: false
}
type Statement = { sql: string; values: readonly unknown[] }
function fixture(overrides: Record<string, unknown> = {}, guard = { busy: false, protectedDelivery: false }) {
  const statements: Statement[] = []
  let failOnReset = false
  const tx = {
    async $queryRaw(q: { strings: readonly string[]; values: readonly unknown[] }) {
      const sql = q.strings.join('?')
      statements.push({ sql, values: q.values })
      if (sql.includes('lazy-context:session')) return [{ ...original, ...overrides }]
      if (sql.includes('lazy-context:guard')) return [guard]
      if (sql.includes('inserted_choices')) return [{ choiceCount: 5n, outboxCount: 1n }]
      throw new Error(`unhandled query ${sql}`)
    },
    async $executeRaw(q: { strings: readonly string[]; values: readonly unknown[] }) {
      const sql = q.strings.join('?')
      statements.push({ sql, values: q.values })
      if (failOnReset && sql.includes('lazy-context:reset')) throw new Error('simulated rollback')
      return 1
    }
  }
  return { tx, statements, failReset() { failOnReset = true } }
}
const expired = fixture()
assert.equal((await applyLazyContextWindowTx(expired.tx as never, input, persistView)).kind, 'EXPIRED')
const statements = expired.statements
assert.ok(statements.some(s => s.sql.includes('lazy-context:reset') && s.values.includes(9n)), 'revision fence advances')
assert.ok(statements.some(s => s.sql.includes('UPDATE "BotPrompt"') && s.sql.includes('INVALIDATED')))
assert.ok(statements.some(s => s.sql.includes('UPDATE "BotOutbox"') && s.sql.includes('SKIPPED')))
assert.ok(statements.some(s => s.sql.includes('UPDATE "BotJob"') && s.sql.includes('CONTEXT_EXPIRED')))
assert.ok(statements.some(s => s.sql.includes('UPDATE "BotActionInbox"') && s.sql.includes('STALE')))
assert.ok(statements.some(s => s.sql.includes('INSERT INTO "BotTransitionLog"') && s.sql.includes('system.context_expired')))
assert.ok(statements.some(s => s.sql.includes('INSERT INTO "BotOutbox"') && s.values.some(v => typeof v === 'string' && v.includes('Pasaron 24 horas'))), 'new menu explains expiry')
assert.ok(statements.some(s => s.sql.includes('UPDATE "BotProviderEvent"') && s.sql.includes('PROCESSED')), 'triggering action is consumed, not confirmed')
assert.doesNotMatch(statements.map(s => s.sql).join('\n'), /(?:DELETE FROM|UPDATE|INSERT INTO) "(?:Appointment|BookingVisit|BookingDeposit|Customer|Conversation|Message|BotHandoff)"/, 'durable entities and CRM history are not mutated')

for (const patch of [
  { status: 'HUMAN_TAKEN' }, { status: 'HUMAN_QUEUED' }, { durableProtection: true },
  { state: { ...original.state, deposit: 'PENDING_PROOF', booking: 'HELD', flow: 'DEPOSIT_INSTRUCTIONS',
    cart: [{ serviceId: 'service-a' }], selections: { ...original.state.selections,
      professionalId: 'professional-a', date: '2026-09-01', slotStartAt: '2026-09-01T10:00:00-03:00', appointmentId: 'appointment-a' } } }
]) {
  const f = fixture(patch)
  assert.equal((await applyLazyContextWindowTx(f.tx as never, input, persistView)).kind, 'CONTINUE')
  assert.ok(!f.statements.some(s => s.sql.includes('lazy-context:reset')))
}
const media = fixture()
assert.equal((await applyLazyContextWindowTx(media.tx as never, { ...input, isMedia: true }, persistView)).kind, 'CONTINUE')
const replay = fixture({ hasInbox: true })
assert.equal((await applyLazyContextWindowTx(replay.tx as never, input, persistView)).kind, 'REPLAY')
assert.equal(replay.statements.length, 1, 'no clock renew or reclassification on replay')
const busy = fixture({}, { busy: true, protectedDelivery: false })
assert.equal((await applyLazyContextWindowTx(busy.tx as never, input, persistView)).kind, 'WAIT')
assert.equal(busy.statements.length, 2, 'no expiry/touch if a worker or sender is in flight')
const unknown = fixture({}, { busy: false, protectedDelivery: true })
assert.equal((await applyLazyContextWindowTx(unknown.tx as never, input, persistView)).kind, 'CONTINUE')
assert.ok(!unknown.statements.some(s => s.sql.includes('lazy-context:reset')))
const legacy = fixture({ draftTouchedAt: null, draftExpiresAt: null })
assert.equal((await applyLazyContextWindowTx(legacy.tx as never, input, persistView)).kind, 'CONTINUE')
assert.ok(legacy.statements.some(s => s.sql.includes('lazy-context:touch')))
assert.ok(!legacy.statements.some(s => s.sql.includes('lazy-context:guard')), 'normal message does not scan queues')
const failing = fixture()
failing.failReset()
await assert.rejects(() => applyLazyContextWindowTx(failing.tx as never, input, persistView), /simulated rollback/)
assert.ok(!failing.statements.some(s => s.sql.includes('UPDATE "BotProviderEvent"')), 'failure must propagate into transaction rollback')

const source = readFileSync(new URL('../src/bot-options/application/lazy-context-window.ts', import.meta.url), 'utf8')
assert.match(source, /FOR UPDATE OF s/, 'session reset must serialize with confirmation')
assert.match(source, /FOR UPDATE OF j SKIP LOCKED/, 'never wait for a job already holding a lock and waiting for session')
assert.match(source, /FOR UPDATE OF o SKIP LOCKED/, 'fence claim races without stealing active sender leases')
assert.match(source, /"businessId"/, 'tenant scoped')
assert.doesNotMatch(source, /setInterval|setTimeout/, 'lazy only, no periodic timer')

// Run the production worker boundary as well: ACK/journal projection is already
// committed before this transaction, and the old button must never reach the
// classifier when expiry consumed it. Mocks only replace the database transport.
async function workerScenario(options: { busy?: boolean; statusCallback?: boolean; processed?: boolean } = {}) {
  const operations: Statement[][] = []
  const f = fixture({}, { busy: options.busy ?? false, protectedDelivery: false })
  const job: ClaimedBotJob = {
    id: 'worker-job', kind: 'PROCESS_PROVIDER_EVENT', aggregateId: 'event-a', businessId: input.businessId,
    deploymentId: input.deploymentId, deploymentGeneration: 1, expectedRevision: null, attempts: 5,
    maxAttempts: 5, claimToken: 'lease', claimedUntil: new Date(admittedAt.getTime() + 30_000), queueWaitMs: 0
  }
  const event = { id: 'event-a', businessId: input.businessId, eventKey: 'event-a',
    eventType: options.statusCallback ? 'STATUS' : 'MESSAGE', phoneNumberId: 'phone', providerMessageId: 'wamid-test',
    status: options.processed ? 'PROCESSED' : 'ADMITTED', admittedAt, providerOccurredAt: admittedAt,
    payload: options.statusCallback ? { kind: 'status', status: 'delivered', errorMessage: null }
      : { kind: 'message', messageType: 'interactive', fromPhone: input.phone, textBody: 'Confirmar turno',
          interactiveReplyId: 'b1.AAAAAAAAAAAAAAAA.BBBBBBBBBBB' } }
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
      const statements: Statement[] = []
      const transactionNumber = operations.length + 1
      const tx = {
        async $executeRaw(q: { strings: readonly string[]; values: readonly unknown[] }) {
          statements.push({ sql: q.strings.join('?'), values: q.values })
          return 1
        },
        async $queryRaw(q: { strings: readonly string[]; values: readonly unknown[] }) {
          const sql = q.strings.join('?')
          statements.push({ sql, values: q.values })
          if (sql.includes('lazy-context:') || sql.includes('inserted_choices')) return f.tx.$queryRaw(q)
          if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: job.id }]
          if (sql.includes('"BotProviderEvent" e')) return [event]
          if (sql.includes('SELECT d."id", d."generation"')) return [{ id: input.deploymentId, generation: 1 }]
          if (transactionNumber === 1 && sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation-a' }]
          if (transactionNumber === 1 && sql.includes('inserted_message')) return [] // already projected, idempotent
          if (sql.includes('UPDATE "Message"')) return [] // unmatched callback
          throw new Error(`unexpected worker query ${sql}`)
        }
      }
      const result = await operation(tx)
      operations.push(statements)
      return result
    }
  }
  const outcome = await processProviderEventJob({ client: client as never, job })
  return { outcome, operations }
}
const actualExpired = await workerScenario()
assert.equal(actualExpired.outcome, 'PROCESSED')
assert.equal(actualExpired.operations.length, 2)
assert.ok(actualExpired.operations[1]!.some(s => s.sql.includes('lazy-context:reset')))
assert.ok(!actualExpired.operations[1]!.some(s => s.sql.includes('INSERT INTO "BotActionInbox"')), 'expired confirm never reaches classification')
const actualWait = await workerScenario({ busy: true })
assert.equal(actualWait.outcome, 'DEFERRED')
assert.ok(actualWait.operations[1]!.some(s => s.sql.includes('GREATEST("attempts" - 1, 0)') && s.values.includes(true)), 'waiting does not exhaust attempts/POISON')
const callback = await workerScenario({ statusCallback: true })
assert.ok(!callback.operations.flat().some(s => s.sql.includes('lazy-context:')), 'delivery callbacks never renew or expire customer context')
const replayed = await workerScenario({ processed: true })
assert.ok(!replayed.operations[1]!.some(s => s.sql.includes('lazy-context:')), 'completed provider event retry skips window entirely')
console.log('OK lazy context worker: replay, expiry, protected aggregates, active claims, rollback propagation and new menu.')
