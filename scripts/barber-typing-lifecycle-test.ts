import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the real entrypoint functions with imported boundaries replaced by offline fakes.
// No server, Prisma client, worker, environment edit or Meta request is started by this test.
const source = await readFile(new URL('../src/barber-local.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('barber-local.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
const functions = parsed.statements.filter(ts.isFunctionDeclaration).map(node => ts.factory.updateFunctionDeclaration(
  node, node.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword), node.asteriskToken,
  node.name, node.typeParameters, node.parameters, node.type, node.body
))
assert.ok(functions.some(node => node.name?.text === 'startBarberLocal'))
const executable = ts.transpileModule(functions.map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText
const businessId = 'cmpvr0oqo0000o0vcnhgyv054'
const preparing = { businessId, providerPhoneNumberId: 'fake-phone', providerMessageId: 'fake-wamid' }
for (const failureAt of [null, 'internal', 'loops', 'gateway'] as const) {
  const events: string[] = []
  const failed = new Error(`startup failure ${failureAt}`)
  let creates = 0
  let stops = 0
  let hints = 0
  let closed = false
  let sessionHook: unknown
  let handler: ((job: { businessId: string; kind: string }) => Promise<void>) | undefined
  const notify = (context: unknown) => { assert.deepEqual(context, preparing); if (!closed) hints++ }
  const fakeClient = { async $disconnect() { events.push('disconnect') } }
  const app = (name: string) => ({
    async listen() { events.push(`${name}:listen`); if (failureAt === name) throw failed },
    async close() { events.push(`${name}:close`) }, log: { error() {} }
  })
  const dependencies = {
    process: { env: {} }, console: { info() {} },
    BARBER_DEMO_BUSINESS_ID: businessId,
    validateBarberLocalConfig: () => ({ scope: { mode: 'include', businessId }, verifyToken: 'fake-token' }),
    resolveBotOptionsConfig: () => ({}), resolveWhatsAppConversationAi: () => ({}),
    prisma: fakeClient, createPrismaIngressClient: () => fakeClient,
    createProviderDiagnosticProbe: () => ({ emitPool() {}, run: (_input: unknown, work: () => unknown) => work() }),
    enablePrismaClientDiagnostics: () => true,
    createQueueMilestoneTracker: () => ({}), PrismaAuthoritativeAdmissionRepository: class {},
    createWorkerWakeSignal: () => ({}), notifyWorkerWake() {},
    createBarberWebhookApps: async () => ({ internal: app('internal'), gateway: app('gateway') }),
    createBarberTypingIndicator: () => { creates++; return { notify, stop() { stops++; closed = true; events.push('typing:stop') } } },
    processSessionJob: async (input: { onPreparingReply?: (context: typeof preparing) => void }) => {
      sessionHook = input.onPreparingReply
      input.onPreparingReply?.(preparing)
    },
    processProviderEventJob: async () => {}, reconcileActions: async () => {}, expireDepositHold: async () => {},
    processDepositProofJob: async () => {}, bridgeDepositNotificationJob: async () => {}, MetaOutboxProvider: class {},
    startBarberWorkerLoops: async (input: { handle: typeof handler }) => {
      handler = input.handle
      await handler?.({ businessId, kind: 'PROCESS_INBOX' })
      if (failureAt === 'loops') throw failed
      return { async stop() { events.push('loops:stop'); await handler?.({ businessId, kind: 'PROCESS_INBOX' }) } }
    }
  }
  const start = new vm.Script(`${executable}\nstartBarberLocal`).runInNewContext(dependencies) as () => Promise<{ stop: () => Promise<void> }>
  if (failureAt) await assert.rejects(start(), error => error === failed)
  else {
    const running = await start()
    assert.equal(creates, 1, 'Barber startup must create exactly one typing lifecycle')
    assert.equal(sessionHook, notify, 'session handler must receive the nonblocking preparation hook')
    await handler?.({ businessId, kind: 'PROCESS_PROVIDER_EVENT' })
    assert.equal(hints, 1, 'provider admission must not trigger typing before the bot ownership snapshot')
    const first = running.stop(); const second = running.stop()
    assert.equal(first, second, 'shutdown remains idempotent')
    await first
    assert.equal(hints, 1, 'draining workers cannot start new hints after shutdown begins')
  }
  assert.equal(creates, 1)
  assert.equal(stops, 1, 'normal shutdown and each startup failure stop typing exactly once')
  assert.ok(events.indexOf('typing:stop') >= 0 && events.indexOf('typing:stop') < events.indexOf('gateway:close'), 'typing must stop before close awaits can fail or block')
  assert.ok(events.indexOf('typing:stop') < events.indexOf('disconnect'), 'typing must stop before clients disconnect')
}
console.log('Barber typing lifecycle wiring: PASS (offline entrypoint, core snapshot hook not exercised)')
