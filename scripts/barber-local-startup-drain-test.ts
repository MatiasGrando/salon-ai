import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { startBarberWorkerLoops } from '../src/barber-local/runtime.js'

const scope = { mode: 'include' as const, businessId: 'cmpvr0oqo0000o0vcnhgyv054' }
const shared = {
  scope, client: {} as never,
  provider: { async send() { return { kind: 'accepted' as const, providerMessageId: 'fake' } } },
  handle: async () => {}
}
for (const failureAt of ['second-worker', 'sender'] as const) {
  let releaseStop!: () => void
  const stopGate = new Promise<void>((resolve) => { releaseStop = resolve })
  let started = 0
  let stopCalls = 0
  let drained = 0
  const failed = new Error(`factory failed: ${failureAt}`)
  const attempt = Promise.resolve().then(() => startBarberWorkerLoops({
    ...shared,
    startWorker: () => {
      started += 1
      if (failureAt === 'second-worker' && started === 2) throw failed
      return { async stop() { stopCalls += 1; await stopGate; drained += 1 } }
    },
    startSender: () => {
      if (failureAt === 'sender') throw failed
      return { async stop() {} }
    }
  }))
  let rejected = false
  void attempt.catch(() => { rejected = true })
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
  assert.equal(stopCalls, failureAt === 'second-worker' ? 1 : 2)
  assert.equal(rejected, false, 'factory rejection must wait until every previously started loop drains')
  releaseStop()
  await assert.rejects(attempt, (error) => error === failed)
  assert.equal(drained, stopCalls, 'all started loops drained before error propagated')
}
let releaseRemaining!: () => void
const remainingGate = new Promise<void>((resolve) => { releaseRemaining = resolve })
let workerCount = 0
const failure = new Error('sender creation failed')
const mixedStops = Promise.resolve().then(() => startBarberWorkerLoops({
  ...shared,
  startWorker: () => {
    workerCount += 1
    return workerCount === 1
      ? { stop(): Promise<void> { throw new Error('first stop failed') } }
      : { async stop() { await remainingGate } }
  },
  startSender: () => { throw failure }
}))
let propagated = false
void mixedStops.catch(() => { propagated = true })
await new Promise<void>((resolve) => setTimeout(resolve, 10))
assert.equal(propagated, false, 'a failed stop must not short-circuit waiting for other started loops')
releaseRemaining()
await assert.rejects(mixedStops, (error) => error === failure)
const entrypoint = await readFile(new URL('../src/barber-local.ts', import.meta.url), 'utf8')
assert.match(entrypoint, /loops = await startBarberWorkerLoops\(/,
  'entrypoint must await factory rollback before catch disconnects Prisma')
console.log('barber local startup drain passed')
