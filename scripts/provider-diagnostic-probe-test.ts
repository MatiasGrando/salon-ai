import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createProviderDiagnosticProbe, type ProviderDiagnosticSummary } from '../src/bot-options/observability/provider-diagnostic-probe.js'
import { getAttemptDiagnosticContext, measureAttemptStage } from '../src/bot-options/observability/attempt-metrics.js'
import type { PrismaPoolDiagnostic } from '../src/config/prisma-pool-diagnostics.js'

let now = 0
const summaries: ProviderDiagnosticSummary[] = []
let pools = 0
const probe = createProviderDiagnosticProbe({
  now: () => now,
  emitAttempt: () => { now += 3 },
  emitPool: () => { pools++; now += 7 },
  emitSummary: event => { summaries.push(event); now += 1000 }
})
const poolEvent = (): PrismaPoolDiagnostic => ({ event: 'prisma_pool_diagnostic', role: 'worker', phase: 'client_query_total',
  durationMs: 44, outcome: 'ok', errorCode: null, context: getAttemptDiagnosticContext()!,
  start: { total: 3, idle: 1, waiting: 0 }, end: { total: 3, idle: 1, waiting: 0 } })
assert.equal(await probe.run({ jobId: 'private job', attempt: 1 }, () => measureAttemptStage('provider_classify', async () => {
  probe.emitPool(poolEvent())
  return 42
})), 42)
assert.deepEqual(summaries[0]!.attemptSink, { count: 2, totalMs: 6, maxMs: 3 })
assert.deepEqual(summaries[0]!.poolSink, { count: 1, totalMs: 7, maxMs: 7 })
assert.equal(summaries[0]!.windowMs, 13, 'summary emission excluded')
assert.equal(summaries[0]!.eventLoop.scope, 'process_window')
assert.equal(summaries[0]!.overlap, false)
assert.equal(probe.activeCount, 0)
assert.doesNotMatch(JSON.stringify(summaries), /private job/)
probe.emitPool({ ...poolEvent(), context: { jobRef: 'unknown', attempt: 1, stage: 'attempt' } })
assert.equal(pools, 2, 'unknown pool context still delivered')
assert.equal(summaries[0]!.poolSink.count, 1, 'completed attempt never accumulates later events')

const original = new Error('original private failure')
const broken = createProviderDiagnosticProbe({ now: () => { throw new Error('clock') },
  emitAttempt: () => { throw new Error('sink') }, emitPool: () => { throw new Error('sink') },
  emitSummary: () => { throw new Error('sink') } })
assert.equal(await broken.run({ jobId: 'success', attempt: 1 }, async () => { broken.emitPool(poolEvent()); return 7 }), 7)
await assert.rejects(broken.run({ jobId: 'failed', attempt: 1 }, async () => { throw original }), error => error === original)
assert.equal(broken.activeCount, 0)

let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
const first = probe.run({ jobId: 'a', attempt: 1 }, async () => gate)
await probe.run({ jobId: 'b', attempt: 1 }, async () => 2)
release(); await first
assert.ok(summaries.slice(1).every(event => event.overlap), 'both overlapping process windows declared')
assert.equal(probe.activeCount, 0)
const bounded = createProviderDiagnosticProbe({ capacity: 1, emitAttempt: () => undefined, emitPool: () => undefined, emitSummary: () => undefined })
const held = bounded.run({ jobId: 'held', attempt: 1 }, async () => gate)
assert.equal(await bounded.run({ jobId: 'bypass', attempt: 1 }, async () => 8), 8)
await held
assert.equal(bounded.activeCount, 0)
let disabledEvents = 0
const disabled = createProviderDiagnosticProbe({ enabled: false, emitAttempt: () => { disabledEvents++ },
  emitPool: () => { disabledEvents++ }, emitSummary: () => { disabledEvents++ } })
assert.equal(await disabled.run({ jobId: 'off', attempt: 1 }, async () => 9), 9)
assert.equal(disabledEvents, 0)
const wiring = readFileSync('src/barber-local.ts', 'utf8')
assert.match(wiring, /providerDiagnosticProbe\.run\([\s\S]*?processProviderEventJob/)
assert.match(wiring, /emitPoolDiagnostic = providerDiagnosticProbe\.emitPool/)
console.log('PASS provider sink probe: exact sink time, exclusions, safe summaries, error preservation, overlap, bounds and wiring')
