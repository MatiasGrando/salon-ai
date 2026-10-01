import vm from 'node:vm'
import ts from 'typescript'
import { withAttemptMetrics, measureAttemptStage } from '../src/bot-options/observability/attempt-metrics.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createBoundedDiagnosticSink } from '../src/bot-options/observability/bounded-diagnostic-sink.js'

const scheduled: Array<() => void> = []
const batches: string[][] = []
let closed = 0
const sink = createBoundedDiagnosticSink({ capacity: 3, batchSize: 2,
  schedule: callback => { scheduled.push(callback) },
  transport: { writeBatch: lines => { batches.push([...lines]) }, close: () => { closed++ } }
})
assert.equal(sink.emit('test', { n: 1 }), true)
assert.equal(sink.emit('test', { n: 2 }), true)
assert.equal(sink.emit('test', { n: 3 }), true)
assert.equal(sink.emit('test', { n: 4 }), false)
assert.equal(batches.length, 0, 'enqueue never calls output synchronously')
assert.equal(scheduled.length, 1, 'one bounded drain scheduled')
assert.equal(sink.stats.pending, 3)
scheduled.shift()!()
await Promise.resolve(); await Promise.resolve()
assert.equal(batches[0]!.length, 2, 'bounded flush cannot monopolize the event loop')
while (scheduled.length) { scheduled.shift()!(); await Promise.resolve(); await Promise.resolve() }
await sink.stop()
assert.equal(closed, 1)
const lines = batches.flat()
assert.ok(lines.findIndex(line => line.includes('"n":1')) < lines.findIndex(line => line.includes('"n":3')))
assert.ok(lines.some(line => line.includes('"dropped":1')), 'overflow explicitly reported')
assert.equal(sink.emit('test', { n: 5 }), false, 'stopped sink refuses new work')
await sink.stop()
assert.equal(closed, 1, 'stop idempotent')

let offWrites = 0
const disabled = createBoundedDiagnosticSink({ enabled: false, transport: { writeBatch: () => { offWrites++ } } })
assert.equal(disabled.emit('off', {}), false)
await disabled.stop()
assert.equal(offWrites, 0)

for (const writeBatch of [() => { throw new Error('sink private error') }, async () => { throw new Error('sink private error') }]) {
  const broken = createBoundedDiagnosticSink({ transport: { writeBatch } })
  assert.doesNotThrow(() => broken.emit('test', { n: 1 }))
  await broken.stop()
  assert.equal(broken.stats.failed, 1, 'sync/async transport failure does not escape operation')
}
const invalid = createBoundedDiagnosticSink({ maxRecordBytes: 32, transport: { writeBatch: () => undefined } })
const cycle: Record<string, unknown> = {}; cycle.self = cycle
assert.equal(invalid.emit('test', cycle), false)
assert.equal(invalid.emit('test', { oversized: 'x'.repeat(100) }), false)
assert.equal(invalid.emit('invalid\nlabel', {}), false)
await invalid.stop()
assert.equal(invalid.stats.dropped, 3)

let hangingClosed = false
const hanging = createBoundedDiagnosticSink({ shutdownTimeoutMs: 15,
  transport: { writeBatch: () => new Promise<void>(() => undefined), close: () => { hangingClosed = true } }
})
hanging.emit('test', {})
const started = Date.now(); await hanging.stop()
assert.ok(Date.now() - started < 1000, 'shutdown has a deadline')
assert.equal(hangingClosed, true)
assert.ok(hanging.stats.dropped >= 1)


let releaseBatch!: () => void
const slowCallbacks: Array<() => void> = []
let slowWrites = 0
const slow = createBoundedDiagnosticSink({ capacity: 2, batchSize: 1,
  schedule: callback => { slowCallbacks.push(callback) },
  transport: { writeBatch: () => {
    slowWrites++
    return slowWrites === 1 ? new Promise<void>(resolve => { releaseBatch = resolve }) : Promise.resolve(false)
  } }
})
assert.equal(slow.emit('test', { n: 1 }), true)
slowCallbacks.shift()!()
assert.equal(slow.emit('test', { n: 2 }), true)
assert.equal(slow.emit('test', { n: 3 }), false, 'capacity includes batch awaiting acknowledgement')
assert.equal(slowWrites, 1, 'only one transport batch can be in flight')
releaseBatch()
await Promise.resolve(); await Promise.resolve()
while (slowCallbacks.length) { slowCallbacks.shift()!(); await Promise.resolve(); await Promise.resolve() }
await slow.stop()
assert.equal(slow.stats.written, 2, 'fulfilled Promise false is handled without chaining assumptions')
assert.equal(slow.stats.failed, 0)

const closeThrows = createBoundedDiagnosticSink({ transport: { writeBatch: () => undefined, close: async () => { throw new Error('private close') } } })
closeThrows.emit('test', {})
await closeThrows.stop()
const scheduleThrows = createBoundedDiagnosticSink({ schedule: () => { throw new Error('private schedule') }, transport: { writeBatch: () => undefined } })
assert.doesNotThrow(() => scheduleThrows.emit('test', {}))
await scheduleThrows.stop()
assert.equal(scheduleThrows.stats.failed, 1)


let diagnosticClock = 0
const timed = createBoundedDiagnosticSink({ now: () => diagnosticClock,
  transport: { writeBatch: () => { diagnosticClock += 37 } }
})
timed.emit('test', {})
assert.equal(diagnosticClock, 0, 'output time never belongs to synchronous enqueue cost')
await timed.stop()
assert.equal(timed.stats.asyncDrainMs, 37, 'async drain has separate timing including acknowledgement wait')
const brokenClock = createBoundedDiagnosticSink({ now: () => { throw new Error('clock') }, transport: { writeBatch: () => undefined } })
brokenClock.emit('test', {})
await brokenClock.stop()
assert.equal(brokenClock.stats.asyncDrainMs, null)


const sessionSource = readFileSync('src/bot-options/application/process-session-job.ts', 'utf8')
const sessionAst = ts.createSourceFile('process-session-job.ts', sessionSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
const sessionFunction = sessionAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'processSessionJob') as ts.FunctionDeclaration
assert.ok(sessionFunction)
const sessionDeclaration = ts.factory.updateFunctionDeclaration(sessionFunction, sessionFunction.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword), sessionFunction.asteriskToken,
  sessionFunction.name, sessionFunction.typeParameters, sessionFunction.parameters, sessionFunction.type, sessionFunction.body)
const sessionCode = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, sessionDeclaration, sessionAst),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
let originalFailure: Error | null = null
const session = new vm.Script(sessionCode + '\nprocessSessionJob').runInNewContext({
  performance, withAttemptMetrics, botOptionsMetrics: { observe() {} },
  processSessionJobInternal: async () => measureAttemptStage('conversation_session_save', async () => {
    if (originalFailure) throw originalFailure
    return 'PROCESSED'
  })
}) as (input: { job: { id: string; attempts: number }; onAttemptDiagnostic?: (event: unknown) => void }) => Promise<string>
const delivered: unknown[] = []
const originalConsole = console.info
let defaultOutputs = 0
try {
  console.info = () => { defaultOutputs++ }
  assert.equal(await session({ job: { id: 'private-job', attempts: 1 }, onAttemptDiagnostic: event => { delivered.push(event) } }), 'PROCESSED')
  assert.equal(defaultOutputs, 0, 'conversation metrics must use injected sink rather than synchronous console')
  assert.equal(delivered.length, 2, 'stage and attempt emitted through explicit callback')
  originalFailure = new Error('original private pipeline failure')
  await assert.rejects(session({ job: { id: 'failed-job', attempts: 1 }, onAttemptDiagnostic: () => { throw new Error('diagnostic') } }),
    error => error === originalFailure)
  originalFailure = null
  assert.equal(await session({ job: { id: 'default-profile', attempts: 1 } }), 'PROCESSED')
  assert.equal(defaultOutputs, 2, 'other profiles preserve existing default behavior')
} finally { console.info = originalConsole }

const production = createBoundedDiagnosticSink()
production.emit('bounded-diagnostic-worker-test', { harmless: true })
await production.stop()
assert.equal(production.stats.failed, 0, 'actual worker flush lifecycle')
const wiring = readFileSync('src/barber-local.ts', 'utf8')
assert.match(wiring, /createBoundedDiagnosticSink/)
assert.doesNotMatch(wiring, /console\.info\('\[(?:barber-local|bot-options-attempt-stage)/)
assert.match(wiring, /diagnosticSink\.stop\(/)
console.log('PASS bounded diagnostic sink: nonblocking callbacks, bounded batches, overflow, errors, disable, shutdown and worker wiring')
