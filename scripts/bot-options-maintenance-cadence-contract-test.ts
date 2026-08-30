import assert from 'node:assert/strict'
import { Prisma } from '../src/generated/prisma/client.js'
import { createMaintenanceCadence } from '../src/bot-options/infrastructure/maintenance-cadence.js'
import {
  claimBotJob,
  maintainBotJobs,
  runClaimedBotJob,
  type BotJobLatencyDiagnostic,
  type ClaimedBotJob
} from '../src/bot-options/infrastructure/postgres-worker.js'
import { claimOutbox, maintainOutbox, sendClaimedOutbox, type OutboxLatencyDiagnostic } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

function sqlText(query: Prisma.Sql): string {
  const value = query as unknown as { sql?: string }
  return value.sql ?? ''
}

let now = 0
let runs = 0
let fail = false
const cadence = createMaintenanceCadence({
  intervalMs: 30_000,
  now: () => now,
  run: async () => {
    runs += 1
    if (fail) throw new Error('maintenance unavailable')
  }
})
assert.equal(await cadence.runIfDue(), true, 'maintenance runs immediately at loop startup')
assert.equal(runs, 1)
now = 29_999
assert.equal(await cadence.runIfDue(), false)
assert.equal(runs, 1, '250ms polls do not repeat maintenance before cadence')
now = 30_000
fail = true
await assert.rejects(() => cadence.runIfDue(), /maintenance unavailable/)
assert.equal(runs, 2)
now = 30_250
assert.equal(await cadence.runIfDue(), false, 'failed maintenance is not retried on every poll')
now = 60_000
fail = false
assert.equal(await cadence.runIfDue(), true, 'maintenance retries at the next bounded cadence')
assert.equal(runs, 3)
assert.throws(() => createMaintenanceCadence({ intervalMs: 0, run: async () => {} }), /positive/)

const workerStatements: string[] = []
const workerTx = {
  $queryRaw: async (query: Prisma.Sql) => { workerStatements.push(sqlText(query)); return [] },
  $executeRaw: async (query: Prisma.Sql) => { workerStatements.push(sqlText(query)); return 0 },
  $transaction: async () => { throw new Error('nested transaction unavailable') }
}
const workerClient = {
  ...workerTx,
  $transaction: async <T>(operation: (tx: typeof workerTx) => Promise<T>) => operation(workerTx)
}
assert.equal(await claimBotJob(workerClient as any, 30_000, 'worker-token'), null)
assert.equal(workerStatements.some((statement) => statement.includes('recovery after exhausted stale lease')), false,
  'worker claim hot path contains no exhausted-lease maintenance')

const successfulWorkerStatements: string[] = []
const claimedWorkerJob: ClaimedBotJob = {
  id: 'job-claim-1', kind: 'PROCESS_SESSION', aggregateId: 'aggregate-claim-1', businessId: 'business-1',
  deploymentId: 'deployment-1', deploymentGeneration: 1, expectedRevision: 1n, attempts: 1, maxAttempts: 5,
  claimToken: 'worker-success-token', claimedUntil: new Date('2026-08-30T12:00:30.000Z'), queueWaitMs: 25
}
const successfulWorkerTx = {
  $queryRaw: async (query: Prisma.Sql) => {
    const sql = sqlText(query)
    successfulWorkerStatements.push(sql)
    if (sql.includes('WITH candidate AS')) return [claimedWorkerJob]
    if (sql.includes('SELECT j."id"')) return [{ id: claimedWorkerJob.id, businessId: claimedWorkerJob.businessId }]
    if (sql.includes('UPDATE "BotJob"')) return [claimedWorkerJob]
    return []
  },
  $executeRaw: async (query: Prisma.Sql) => { successfulWorkerStatements.push(sqlText(query)); return 1 },
  $transaction: async () => { throw new Error('nested transaction unavailable') }
}
const successfulWorkerClient = {
  ...successfulWorkerTx,
  $transaction: async <T>(operation: (tx: typeof successfulWorkerTx) => Promise<T>) => operation(successfulWorkerTx)
}
assert.deepEqual(
  await claimBotJob(successfulWorkerClient as any, 30_000, claimedWorkerJob.claimToken),
  claimedWorkerJob
)
assert.equal(successfulWorkerStatements.length, 1,
  'worker candidate selection, cutover lock, fenced recheck and lease update must use one database round trip')
assert.ok(successfulWorkerStatements[0]!.includes('pg_advisory_xact_lock_shared'),
  'the fused worker claim must retain the cutover advisory lock')
await maintainBotJobs(workerClient as any)
assert.equal(workerStatements.filter((statement) => statement.includes('recovery after exhausted stale lease')).length, 1)

const lifecycleStatements: string[] = []
const lifecycleClient = {
  $executeRaw: async (query: Prisma.Sql) => { lifecycleStatements.push(sqlText(query)); return 1 },
  $queryRaw: async (query: Prisma.Sql) => {
    lifecycleStatements.push(sqlText(query))
    return [{ status: 'RETRY' }]
  },
  $transaction: async () => { throw new Error('transaction not expected') }
}
const lifecycleJob: ClaimedBotJob = {
  id: 'job-1', kind: 'PROCESS_SESSION', aggregateId: 'aggregate-1', businessId: 'business-1', deploymentId: 'deployment-1',
  deploymentGeneration: 1, expectedRevision: 1n, attempts: 1, maxAttempts: 5, claimToken: 'claim-1',
  claimedUntil: new Date('2026-08-29T12:00:30.000Z'), queueWaitMs: 25
}
const lifecycleDiagnostics: BotJobLatencyDiagnostic[] = []
await runClaimedBotJob({
  client: lifecycleClient as any,
  job: lifecycleJob,
  handlerSettlesJob: true,
  handle: async () => { /* successful handler may have completed, rescheduled, or poisoned */ },
  onDiagnostic: (diagnostic) => lifecycleDiagnostics.push(diagnostic)
})
assert.equal(lifecycleStatements.length, 0, 'self-settling success performs no outer complete or retry SQL')
assert.deepEqual(lifecycleDiagnostics.map((item) => [item.phase, item.outcome]), [
  ['processing', 'ok'], ['finalize', 'handler_settled']
])

let reportedError: unknown
await runClaimedBotJob({
  client: lifecycleClient as any,
  job: lifecycleJob,
  handlerSettlesJob: true,
  handle: async () => { throw new Error('retryable handler failure') },
  onError: (error) => { reportedError = error }
})
assert.equal(lifecycleStatements.length, 1, 'self-settling handler failure invokes exactly one fenced retry')
assert.ok(lifecycleStatements[0]!.includes('"leaseToken" ='))
assert.match(String(reportedError), /retryable handler failure/)

lifecycleStatements.length = 0
await runClaimedBotJob({
  client: lifecycleClient as any,
  job: lifecycleJob,
  handle: async () => {}
})
assert.equal(lifecycleStatements.length, 1, 'default mode preserves outer completion for other callers')
assert.ok(lifecycleStatements[0]!.includes('"status" = \'DONE\'::"BotJobStatus"'))

const outboxStatements: string[] = []
let outboxQueryResult: unknown[] = []
const outboxTx = {
  $queryRaw: async (query: Prisma.Sql) => { outboxStatements.push(sqlText(query)); return outboxQueryResult },
  $executeRaw: async (query: Prisma.Sql) => { outboxStatements.push(sqlText(query)); return 0 },
  $transaction: async () => { throw new Error('nested transaction unavailable') }
}
const outboxClient = {
  ...outboxTx,
  $transaction: async <T>(operation: (tx: typeof outboxTx) => Promise<T>) => operation(outboxTx)
}
assert.equal(await claimOutbox(outboxClient as any, 30_000, 'outbox-token'), null)
assert.equal(outboxStatements.some((statement) => statement.includes('stale_sending') || statement.includes('attempts_exhausted')), false,
  'outbox claim hot path contains no stale/exhausted maintenance')
outboxQueryResult = [{ staleSending: 2n, exhausted: 3n }]
assert.deepEqual(await maintainOutbox(outboxClient as any), { staleSending: 2, exhausted: 3 })
const maintenanceSql = outboxStatements.at(-1) ?? ''
assert.ok(maintenanceSql.includes('stale_sending'))
assert.ok(maintenanceSql.includes('attempts_exhausted'))
assert.equal((maintenanceSql.match(/^\s*WITH\s/gm) ?? []).length, 1, 'outbox maintenance is one atomic SQL statement')

const senderStatements: string[] = []
const senderTx = {
  $executeRaw: async (query: Prisma.Sql) => { senderStatements.push(sqlText(query)); return 1 },
  $queryRaw: async (query: Prisma.Sql) => {
    const sql = sqlText(query)
    senderStatements.push(sql)
    if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
    if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: 'dispatch-id' }]
    if (sql.includes('WITH outbox AS')) return [{ outboxCount: 1n, dispatchCount: 1n }]
    return []
  },
  $transaction: async () => { throw new Error('nested transaction unavailable') }
}
const senderClient = {
  ...senderTx,
  $transaction: async <T>(operation: (tx: typeof senderTx) => Promise<T>) => operation(senderTx)
}
const diagnostics: OutboxLatencyDiagnostic[] = []
assert.equal(await sendClaimedOutbox({
  client: senderClient as any,
  item: {
    id: 'outbox-1', businessId: 'business-1', sessionId: 'session-1', payload: {}, attempts: 1, maxAttempts: 5,
    claimToken: 'outbox-token', generation: 7, fenceEpoch: 9, queueWaitMs: 12
  },
  provider: { async send() { return { kind: 'accepted', providerMessageId: 'wamid.contract' } } },
  onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
}), 'ACCEPTED')
const senderCtes = senderStatements.filter((statement) => statement.includes('WITH outbox AS'))
assert.equal(senderCtes.length, 2, 'preflight and accepted finalize each update outbox+dispatch in one round trip')
assert.ok(senderCtes[0]!.includes('"status" = \'CLAIMED\'::"BotOutboxStatus"') && senderCtes[0]!.includes('"leaseToken" ='))
assert.ok(senderCtes[0]!.includes('c."claimedUntil" > clock_timestamp()'))
assert.ok(senderCtes[0]!.includes('d."generation" = c."generation"') && senderCtes[0]!.includes('d."dispatchFenceEpoch" = c."fenceEpoch"'))
assert.ok(senderCtes[0]!.includes('d."legacyDispatchCoverageVersion" >= 1') && senderCtes[0]!.includes('s."handoffFenceEpoch" = c."handoffFenceEpoch"'))
assert.equal(senderStatements.filter((statement) => statement.includes('SELECT c."id" FROM "BotDispatchClaim"')).length, 0,
  'sender preflight validates and advances the dispatch claim in one fenced statement')
assert.equal(senderStatements.filter((statement) => statement.includes('pg_advisory_xact_lock_shared')).length, 2,
  'acquire and sender preflight each retain their advisory-lock boundary')
assert.ok(senderCtes[1]!.includes('"status" = \'SENDING\'::"BotOutboxStatus"') && senderCtes[1]!.includes('"leaseToken" ='))
assert.deepEqual(diagnostics.map((item) => [item.phase, item.outcome]), [
  ['preflight', 'ok'], ['meta_request', 'ok'], ['finalize', 'ok']
])

let resultTransition = 0
const acceptedFinalizeFailureTx = {
  $executeRaw: async () => 1,
  $queryRaw: async (query: Prisma.Sql) => {
    const sql = sqlText(query)
    if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token-2' }]
    if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: 'dispatch-id-2' }]
    if (sql.includes('WITH outbox AS')) {
      resultTransition += 1
      if (resultTransition === 2) throw new Error('accepted finalize transaction failed')
      return [{ outboxCount: 1n, dispatchCount: 1n }]
    }
    return []
  },
  $transaction: async () => { throw new Error('nested transaction unavailable') }
}
const acceptedFinalizeFailureClient = {
  ...acceptedFinalizeFailureTx,
  $transaction: async <T>(operation: (tx: typeof acceptedFinalizeFailureTx) => Promise<T>) => operation(acceptedFinalizeFailureTx)
}
const acceptedFailureDiagnostics: OutboxLatencyDiagnostic[] = []
assert.equal(await sendClaimedOutbox({
  client: acceptedFinalizeFailureClient as any,
  item: {
    id: 'outbox-2', businessId: 'business-1', sessionId: 'session-1', payload: {}, attempts: 1, maxAttempts: 5,
    claimToken: 'outbox-token-2', generation: 7, fenceEpoch: 9, queueWaitMs: 12
  },
  provider: { async send() { return { kind: 'accepted', providerMessageId: 'wamid.accepted-but-uncommitted' } } },
  onDiagnostic: (diagnostic) => acceptedFailureDiagnostics.push(diagnostic)
}), 'UNKNOWN', 'accepted provider result with failed durable finalize is quarantined, never resent')
assert.equal(resultTransition, 3, 'failed accepted finalize is followed by one fenced UNKNOWN transition')
assert.deepEqual(acceptedFailureDiagnostics.map((item) => [item.phase, item.outcome]), [
  ['preflight', 'ok'], ['meta_request', 'ok'], ['finalize', 'unknown']
], 'accepted-finalize failure does not double-count Meta as failed')

console.log('OK bot-options maintenance cadence: bounded retries and maintenance-free 250ms claim hot paths.')
