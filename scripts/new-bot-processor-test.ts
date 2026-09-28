import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { ingestNewBotEvent } from '../src/new-bot/application/ingress.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'
import { createNewBotQueueRepository, type NewBotQueueClaim, type NewBotQueueRepository } from '../src/new-bot/infrastructure/queue-repository.js'
import { createNewBotProcessor } from '../src/new-bot/application/processor.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function claim(index: number, conversationId = 'conversation-' + index): NewBotQueueClaim {
  return {
    eventId: 'event-' + index, businessId: 'tenant-a', schemaVersion: 1, vertical: 'salon', provider: 'whatsapp',
    conversationId, sequence: 1n, message: { kind: 'text', text: 'message-' + index }, attemptCount: 1,
    leaseToken: 'lease-' + index, leaseExpiresAt: new Date(Date.now() + 60_000),
  }
}

function fakeQueue(claims: NewBotQueueClaim[]) {
  const completed: string[] = []
  const retried: string[] = []
  let claimCalls = 0
  const queue: NewBotQueueRepository = {
    async claimBatch(input) { claimCalls += 1; return claims.splice(0, input.batchSize) },
    async complete(input) { completed.push(input.eventId); return true },
    async retry(input) { retried.push(input.eventId); return true },
    async renew() { return true },
  }
  return { queue, completed, retried, get claimCalls() { return claimCalls } }
}

// Bounded 100-partition fanout and same-instance runOnce single-flight.
{
  const rows = Array.from({ length: 100 }, (_, index) => claim(index))
  const { queue, completed } = fakeQueue(rows)
  const allStarted = deferred()
  const release = deferred()
  let active = 0
  let maximumActive = 0
  let starts = 0
  const processor = createNewBotProcessor({
    queue, concurrency: 7, leaseDurationMs: 30_000, handlerTimeoutMs: 20_000, retryDelayMs: 1_000,
    async prepare(_item, signal) {
      assert.equal(signal.aborted, false)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      starts += 1
      if (starts === 7) allStarted.resolve()
      await release.promise
      active -= 1
      return { ok: true }
    },
    async commit(item) { return queue.complete(item) },
  })
  const first = processor.runOnce()
  const concurrent = processor.runOnce()
  assert.equal(first, concurrent, 'concurrent runOnce calls share the in-flight bounded batch')
  await allStarted.promise
  assert.equal(starts, 7, 'only available handler slots were claimed and started')
  release.resolve()
  const outcome = await first
  assert.equal(outcome.claimed, 7)
  assert.equal(outcome.committed, 7)
  assert.equal(maximumActive, 7)
  assert.equal(completed.length, 7)
  const second = await processor.runOnce()
  assert.equal(second.claimed, 7, 'every tick stays within the configured concurrency bound')
  while (completed.length < 100) {
    const next = await processor.runOnce()
    assert.ok(next.claimed > 0 && next.claimed <= 7, 'bounded ticks continue making progress')
  }
  assert.equal(completed.length, 100)
  await processor.shutdown()
}

// One failed partition does not block another; commit rejection/uncertainty never retries inline.
{
  const { queue, completed, retried } = fakeQueue([claim(1), claim(2), claim(3)])
  const processor = createNewBotProcessor({
    queue, concurrency: 3, leaseDurationMs: 30_000, handlerTimeoutMs: 10_000, retryDelayMs: 25,
    async prepare(item) {
      if (item.eventId === 'event-1') throw new Error('private message must not escape')
      return item.eventId
    },
    async commit(item, result) {
      if (result === 'event-3') throw new Error('ambiguous storage outcome')
      if (result === 'event-2') return false
      return queue.complete(item)
    },
  })
  const outcome = await processor.runOnce()
  assert.equal(outcome.retried, 1)
  assert.equal(outcome.commitRejected, 1)
  assert.equal(outcome.commitUncertain, 1)
  assert.deepEqual(retried, ['event-1'], 'only preparation failure can retry while the original lease is still fenced')
  assert.deepEqual(completed, [], 'processor never falls back to queue.complete after a failed committer')
  await processor.shutdown()
}

// Preparation timeout aborts work and cannot commit even if an ignoring handler settles later.
{
  const { queue, completed, retried } = fakeQueue([claim(4)])
  const late = deferred<string>()
  const started = deferred()
  let commits = 0
  const processor = createNewBotProcessor({
    queue, concurrency: 1, leaseDurationMs: 100, handlerTimeoutMs: 10, retryDelayMs: 25,
    async prepare() { started.resolve(); return late.promise },
    async commit(item) { commits += 1; return queue.complete(item) },
  })
  const running = processor.runOnce()
  await started.promise
  const outcome = await running
  assert.equal(outcome.retried, 1)
  assert.equal(commits, 0)
  let unhandled = false
  const onUnhandled = () => { unhandled = true }
  process.on('unhandledRejection', onUnhandled)
  late.reject(new Error('late rejection after timeout'))
  await new Promise((resolve) => setImmediate(resolve))
  process.off('unhandledRejection', onUnhandled)
  assert.equal(unhandled, false, 'late handler rejection is handled')
  assert.deepEqual(completed, [])
  assert.deepEqual(retried, ['event-4'])
  await processor.shutdown()
}

// Timed-out raw preparation keeps its physical slot until it actually settles.
{
  const fixture = fakeQueue([claim(6), claim(7)])
  const { queue, completed, retried } = fixture
  const firstWork = deferred<string>()
  const started = deferred()
  let prepareCalls = 0
  const processor = createNewBotProcessor({
    queue, concurrency: 1, leaseDurationMs: 1_000, handlerTimeoutMs: 10, retryDelayMs: 25,
    async prepare(item) {
      prepareCalls += 1
      if (item.eventId === 'event-6') { started.resolve(); return firstWork.promise }
      return item.eventId
    },
    async commit(item) { return queue.complete(item) },
  })
  const timedOut = processor.runOnce()
  await started.promise
  assert.equal((await timedOut).retried, 1)
  const blockedTick = await processor.runOnce()
  assert.equal(blockedTick.claimed, 0, 'an unresolved raw handler still owns its per-instance slot')
  assert.equal(fixture.claimCalls, 1, 'no extra lease is claimed while physical preparation is pending')
  assert.equal(prepareCalls, 1, 'a second handler does not start before the old raw promise settles')
  firstWork.resolve('late result')
  await new Promise((resolve) => setImmediate(resolve))
  const nextTick = await processor.runOnce()
  assert.equal(nextTick.claimed, 1)
  assert.equal(prepareCalls, 2, 'settling old work releases the bounded slot')
  assert.deepEqual(completed, ['event-7'], 'timed-out output never commits late')
  assert.deepEqual(retried, ['event-6'])
  await processor.shutdown()
}

// Shutdown before the scheduled preparation microtask must prevent handler invocation.
{
  const { queue } = fakeQueue([claim(8)])
  let prepareCalls = 0
  const processor = createNewBotProcessor({
    queue, concurrency: 1, leaseDurationMs: 1_000, handlerTimeoutMs: 500, retryDelayMs: 25,
    async prepare() { prepareCalls += 1; return 'unexpected' },
    async commit(item) { return queue.complete(item) },
  })
  const running = processor.runOnce()
  queueMicrotask(() => { void processor.shutdown() })
  const outcome = await running
  assert.equal(outcome.aborted, 1)
  assert.equal(prepareCalls, 0, 'an already-aborted signal is checked before invoking prepare')
}
// Shutdown aborts active preparation without releasing a potentially newer owner's lease.
{
  const { queue, completed, retried } = fakeQueue([claim(5)])
  const started = deferred()
  let commits = 0
  const processor = createNewBotProcessor({
    queue, concurrency: 1, leaseDurationMs: 1_000, handlerTimeoutMs: 500, retryDelayMs: 25,
    prepare(_item, signal) {
      started.resolve()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    },
    async commit(item) { commits += 1; return queue.complete(item) },
  })
  const running = processor.runOnce()
  await started.promise
  await processor.shutdown()
  const outcome = await running
  assert.equal(outcome.aborted, 1)
  assert.equal(commits, 0)
  assert.deepEqual(completed, [])
  assert.deepEqual(retried, [], 'shutdown leaves lease recovery to expiry/reclaim; no blind release')
}

// Real PGlite ingress + queue + processor proves per-conversation FIFO while healthy partitions progress.
{
  const ingressMigration = await readFile(new URL('../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql', import.meta.url), 'utf8')
  const queueMigration = await readFile(new URL('../prisma/migrations/20260928010000_new_bot_ordered_queue/migration.sql', import.meta.url), 'utf8')
  const db = new PGlite()
  try {
    await db.exec('CREATE TABLE "Business" ("id" text PRIMARY KEY); INSERT INTO "Business" VALUES (\'tenant-a\');')
    await db.exec(ingressMigration)
    await db.exec(queueMigration)
    const client = {
      async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
        return db.transaction(async (pg) => operation({ async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows } }))
      },
    }
    const ingress = createNewBotIngressRepository(client as never)
    const queue = createNewBotQueueRepository(client as never)
    const tenant = { businessId: 'tenant-a', vertical: 'salon' }
    const event = (providerEventId: string, conversationId: string) => ({ provider: 'whatsapp' as const, providerEventId, conversationId, message: { kind: 'text' as const, text: providerEventId } })
    await ingestNewBotEvent(tenant, event('same-first', 'same-conversation'), ingress)
    await ingestNewBotEvent(tenant, event('same-second', 'same-conversation'), ingress)
    await ingestNewBotEvent(tenant, event('healthy', 'other-conversation'), ingress)
    const order: string[] = []
    const processor = createNewBotProcessor({
      queue, concurrency: 2, leaseDurationMs: 30_000, handlerTimeoutMs: 20_000, retryDelayMs: 25,
      async prepare(item) { order.push(item.message.kind === 'text' ? item.message.text : item.eventId); return null },
      async commit(item) { return queue.complete(item) },
    })
    const first = await processor.runOnce()
    assert.equal(first.claimed, 2)
    assert.deepEqual(order, ['same-first', 'healthy'], 'first partition head runs alongside an independent conversation')
    const second = await processor.runOnce()
    assert.equal(second.claimed, 1)
    assert.equal(order[2], 'same-second', 'successor becomes visible only after predecessor completes')
    await processor.shutdown()
  } finally {
    await db.close()
  }
}

console.log('new-bot-processor-test: OK')
