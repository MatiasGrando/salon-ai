import assert from 'node:assert/strict'
import { claimBotJob, maintainBotJobs, retryBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'

const statements: string[] = []
const client = {
  async $queryRaw(q: { strings: readonly string[] }) {
    statements.push(q.strings.join('?'))
    return [{ status: 'POISON', count: 1 }]
  },
  async $executeRaw(q: { strings: readonly string[] }) {
    statements.push(q.strings.join('?'))
    return 1
  },
  async $transaction(fn: (tx: unknown) => Promise<unknown>) { return fn(client) }
}
assert.equal(await retryBotJob(client as never, 'job', 'token', 'timeout', 1000), 'POISON')
assert.equal(await maintainBotJobs(client as never, { businessId: 'tenant' }), 1)
for (const sql of statements) {
  assert.match(sql, /WITH changed AS/, 'poison and recovery enqueue must share one atomic statement')
  assert.match(sql, /INSERT INTO "BotJob"/)
  assert.match(sql, /FROM changed j/, 'only newly changed jobs, never historical POISON sweep')
  assert.match(sql, /j\."status" = 'POISON'/)
  assert.match(sql, /j\."kind" = 'PROCESS_SESSION'/)
  assert.match(sql, /i\."actionType" IN \('booking.confirm', 'slot.select'\)/)
  assert.match(sql, /i\."status" = 'SELECTED'/)
  assert.match(sql, /i\."businessId" = j\."businessId"/)
  assert.match(sql, /i\."deploymentId" = j\."deploymentId"/)
  assert.match(sql, /ON CONFLICT \("kind", "aggregateId"\) DO NOTHING/)
  assert.match(sql, /'EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION', 'RECOVER_BOOKING_CONFIRMATION'/, 'recovery retries remain durable after exhaustion')
}
statements.length = 0
await claimBotJob(client as never)
assert.doesNotMatch(statements[0]!, /RECOVER_BOOKING_CONFIRMATION/, 'booking recovery must not bypass deployment or human ownership fences')
console.log('booking recovery worker contract: passed (mock transport, no database)')
