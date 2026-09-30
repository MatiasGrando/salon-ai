import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReadonlyProbePoolOptions, createReadonlySnapshotDependencies, withReadonlyProbeSnapshot, parseProbeArguments, safeProbeErrorCode, runBarberConversationProbe, type ProbeDependencies } from './conversational-bot-latency-probe.js'
const businessId = 'cmpvr0oqo0000o0vcnhgyv054'
const env = { CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'true', CONVERSATIONAL_WHATSAPP_AI_MODEL: 'gpt-6-luna', CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS: '4500', OPENAI_API_KEY: 'private-key', OPENAI_MODEL: 'gpt-4o-mini' }
const service = { id: 'private-service', name: 'Private service', durationMinutes: 30, requiresConsultation: false, price: 12345 }
const requests: Record<string, unknown>[] = []
let mode: 'ok' | 'error' = 'ok'
const fetchImpl = (async (_url: unknown, input: RequestInit) => {
  const body = JSON.parse(String(input.body)) as Record<string, unknown>
  requests.push(body)
  if (mode === 'error') throw new Error('private-key customer database query text')
  const format = (body.text as { format: { name: string } }).format
  const response = format.name === 'conversational_turn_interpretation'
    ? { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'uncertain', serviceCandidateIds: [], serviceCorrection: false }
    : { opening: 'Hola, ¿cómo estás?', factIds: [], closing: null }
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(response) }] }], usage: { input_tokens: 30, output_tokens: 10 } }))
}) as typeof fetch
let readonly = true
let wrongScope = false
let invalidPolicy = false
const deps: ProbeDependencies = {
  readGuard: async () => ({ defaultReadOnly: readonly, transactionReadOnly: readonly }),
  readScope: async () => ({ businessId: wrongScope ? 'another-tenant' : businessId, customerCode: 'WX-38N6UG', policyActive: !invalidPolicy }),
  createPort: async id => ({ context: { businessId: id, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-29T12:00:00Z') }, port: {
    catalog: async () => [structuredClone(service)],
    information: async () => ({ businessId: id, name: 'Private business', address: 'Private address', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Private hours' }),
    availability: async () => ({ professionals: [], slots: [] })
  } }), fetchImpl
}
const result = await runBarberConversationProbe(deps, env, { cases: ['greeting'], samples: 2 })
assert.equal(result.scope, 'core_only')
assert.equal(result.sampleCount, 2)
assert.ok(result.samples.every(sample => sample.calls.interpretation === 1 && sample.calls.response === 1))
assert.ok(result.samples.every(sample => sample.outcome === 'ai' && sample.metrics.totalMs >= 0))
assert.ok(result.samples.every(sample => sample.fixtureHash === result.samples[0]!.fixtureHash))
assert.equal(requests.length, 4)
assert.ok(requests.every(body => body.model === 'gpt-6-luna' && body.store === false))
assert.doesNotMatch(JSON.stringify(result), /private|Private|customer|12345|WX-38N6UG|cmpvr|SELECT|postgres|api\.openai/i)
assert.deepEqual(result.excluded, ['persistence', 'queues', 'webhook', 'meta', 'phone_delivery'])
for (const guard of ['readonly', 'scope', 'policy'] as const) {
  const before: number = requests.length
  readonly = guard !== 'readonly'; wrongScope = guard === 'scope'; invalidPolicy = guard === 'policy'
  await assert.rejects(runBarberConversationProbe(deps, env, { cases: ['greeting'] }), /PROBE_(READONLY|SCOPE|POLICY)_REQUIRED/)
  assert.equal(requests.length, before)
}
readonly = true; wrongScope = false; invalidPolicy = false
const beforeConfig = requests.length
await assert.rejects(runBarberConversationProbe(deps, { ...env, CONVERSATIONAL_WHATSAPP_AI_ENABLED: 'false', CONVERSATIONAL_QA_AI_ENABLED: 'true' }), /PROBE_WHATSAPP_AI_REQUIRED/)
await assert.rejects(runBarberConversationProbe(deps, { ...env, OPENAI_API_KEY: '' }), /PROBE_WHATSAPP_AI_REQUIRED/)
assert.equal(requests.length, beforeConfig)
for (const samples of [0, 4]) await assert.rejects(runBarberConversationProbe(deps, env, { samples }), /PROBE_INVALID_OPTIONS/)
await assert.rejects(runBarberConversationProbe(deps, env, { cases: ['unknown'] as never }), /PROBE_INVALID_OPTIONS/)
mode = 'error'
const failed = await runBarberConversationProbe(deps, env, { cases: ['greeting'] })
assert.equal(failed.samples[0]!.outcome, 'fallback')
assert.equal(failed.samples[0]!.reason, 'provider_error')
assert.equal(failed.samples[0]!.calls.response, 0)
assert.equal(failed.summary.greeting!.fallback, 1)
assert.doesNotMatch(JSON.stringify(failed), /private|customer|database query/i)
mode = 'ok'
const error = await runBarberConversationProbe({ ...deps, createPort: async () => { throw new Error('private SQL secret') } }, env, { cases: ['greeting'] })
assert.equal(error.samples[0]!.outcome, 'error')
assert.equal(error.samples[0]!.reason, 'core_error')
assert.equal(error.samples[0]!.calls.interpretation, 0)
assert.doesNotMatch(JSON.stringify(error), /private|SQL|secret/i)
const full = await runBarberConversationProbe(deps, env)
assert.equal(full.sampleCount, 6)
assert.equal(full.samples.find(row => row.caseId === 'address')!.calls.information, 1)
assert.equal(full.samples.find(row => row.caseId === 'opening_hours')!.calls.information, 1)
assert.equal(full.samples.find(row => row.caseId === 'availability')!.calls.availability, 1)
assert.equal(full.samples.find(row => row.caseId === 'mixed')!.calls.availability, 1)
assert.ok(full.samples.every(row => row.calls.catalog === 1))
assert.doesNotMatch(JSON.stringify(full), /private|customer|12345|WX-38N6UG|cmpvr/i)
const cache = await runBarberConversationProbe({ ...deps, createPort: async id => ({ ...await deps.createPort(id), cacheDiagnostics: {
  hits: 1, misses: 0, stampReads: 1, stampMs: 7.2, loadMs: 0, secret: 'private-key'
} }) }, env, { cases: ['greeting'] })
assert.deepEqual(cache.samples[0]!.cache, { hits: 1, misses: 0, stampReads: 1, stampMs: 7.2, loadMs: 0 })
assert.doesNotMatch(JSON.stringify(cache), /private|secret/i)
const beforeMismatch = requests.length
const contextMismatch = await runBarberConversationProbe({ ...deps, createPort: async id => {
  const value = await deps.createPort(id)
  return { ...value, context: { ...value.context, businessId: 'different-tenant' } }
} }, env, { cases: ['greeting'] })
assert.equal(contextMismatch.samples[0]!.outcome, 'error')
assert.equal(requests.length, beforeMismatch)
const timeout = await runBarberConversationProbe({ ...deps, fetchImpl: (async (_url: unknown, input: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(new Error('private timeout')), { once: true }))
}) as typeof fetch }, { ...env, CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS: '1000' }, { cases: ['greeting'] })
assert.equal(timeout.samples[0]!.reason, 'timeout')
assert.equal(timeout.samples[0]!.calls.response, 0)
assert.equal(timeout.samples[0]!.outcome, 'fallback')
const pool = buildReadonlyProbePoolOptions('postgresql://user:password@localhost/db', {})
assert.ok(pool.options.includes('default_transaction_read_only=on'))
assert.equal(pool.max, 3)
assert.throws(() => buildReadonlyProbePoolOptions('postgresql://localhost/db?options=-c%20default_transaction_read_only%3Doff', {}), /PROBE_CONNECTION_OPTIONS_FORBIDDEN/)
assert.deepEqual(parseProbeArguments(['--run-barber-readonly', '--samples=2', '--case=greeting']), { samples: 2, cases: ['greeting'] })
assert.throws(() => parseProbeArguments([]), /PROBE_EXPLICIT_RUN_REQUIRED/)
assert.throws(() => parseProbeArguments(['--run-barber-readonly', '--force']), /PROBE_INVALID_OPTIONS/)
assert.deepEqual(parseProbeArguments(['--run-barber-readonly', '--label=baseline7acac39']), { label: 'baseline7acac39' })
assert.throws(() => parseProbeArguments(['--run-barber-readonly', '--label=unsafe label']), /PROBE_INVALID_OPTIONS/)
assert.equal(safeProbeErrorCode(new Error('PROBE_READONLY_REQUIRED')), 'PROBE_READONLY_REQUIRED')
assert.equal(safeProbeErrorCode(new Error('PROBE_PRIVATE_KEY_SECRET')), 'C06_CONVERSATIONAL_PROBE_FAILED')
assert.equal(safeProbeErrorCode(new Error('postgres://private:key@host/db')), 'C06_CONVERSATIONAL_PROBE_FAILED')
await assert.rejects(runBarberConversationProbe({ ...deps, readGuard: async () => { throw new Error('private pooler startup') } }, env), /PROBE_READ_GUARD_FAILED/)
const source = readFileSync(new URL('./conversational-bot-latency-probe.ts', import.meta.url), 'utf8')
assert.doesNotMatch(source, /processConversationInbox|startServer|createPrismaIngressClient|MetaOutboxProvider|demo-preview-prisma|dotenv\/config/)
let transactionActive = false
let transactionMode = 'on'
const transactionCalls: string[] = []
const snapshotClient = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
  assert.equal(transactionActive, false)
  transactionActive = true
  let guarded = false
  const tx = {
    business: { findUnique: async () => { assert.ok(guarded, 'scope read requires readonly guard'); transactionCalls.push('scope'); return { id: businessId, customerCode: 'WX-38N6UG' } } },
    $executeRawUnsafe: async (sql: string) => { assert.equal(transactionActive, true); transactionCalls.push(sql); assert.equal(sql, 'SET TRANSACTION READ ONLY'); return 0 },
    $queryRaw: async (query: { sql: string }) => {
      if (query.sql.includes('current_setting')) {
        transactionCalls.push('guard')
        assert.equal(transactionCalls.at(-2), 'SET TRANSACTION READ ONLY')
        guarded = transactionMode === 'on'
        return [{ defaultReadOnly: 'off', transactionReadOnly: transactionMode }]
      }
      assert.ok(guarded, 'policy read requires readonly guard')
      if (query.sql.includes('conversation-policy')) return [{ businessId, customerCode: 'WX-38N6UG', deploymentId: 'test-deployment', generation: 1,
        engineKey: 'deterministic-options', configurationId: 'test-config', configurationBusinessId: businessId, configurationStatus: 'ACTIVE',
        definition: { conversation: { engine: 'conversational-booking-v1', schemaVersion: 1 } } }]
      throw new Error('unexpected raw query')
    }
  }
  try { return await run(tx) } finally { transactionActive = false; transactionCalls.push('closed') }
} }
await withReadonlyProbeSnapshot(snapshotClient as never, async () => { transactionCalls.push('data'); assert.equal(transactionActive, true) })
assert.deepEqual(transactionCalls, ['SET TRANSACTION READ ONLY', 'guard', 'data', 'closed'])
transactionMode = 'off'
let unsafeRead = false
await assert.rejects(withReadonlyProbeSnapshot(snapshotClient as never, async () => { unsafeRead = true }), /PROBE_READONLY_REQUIRED/)
assert.equal(unsafeRead, false)
transactionMode = 'on'
const snapshotFactory = async (tx: unknown, id: string) => {
  assert.ok(tx)
  assert.equal(transactionActive, true)
  const prepared = await deps.createPort(id)
  return { context: prepared.context, port: {
    catalog: async () => { assert.equal(transactionActive, true, 'catalog must materialize before close'); return prepared.port.catalog() },
    information: async () => { assert.equal(transactionActive, true); return prepared.port.information!() },
    availability: async () => { assert.equal(transactionActive, true); return prepared.port.availability(service, '2026-09-30') }
  } }
}
const snapshots = createReadonlySnapshotDependencies(snapshotClient as never, snapshotFactory as never)
assert.deepEqual(await snapshots.readGuard(), { defaultReadOnly: false, transactionReadOnly: true, enforcement: 'readonly_snapshots' })
assert.deepEqual(await snapshots.readScope(), { businessId, customerCode: 'WX-38N6UG', policyActive: true })
const materialized = await snapshots.createPort(businessId, 'address')
assert.equal(transactionActive, false)
assert.deepEqual(await materialized.port.catalog(), [service])
assert.equal((await materialized.port.information!(['ADDRESS'])).address, 'Private address')
await materialized.port.availability(service, '2026-09-30')
assert.equal(transactionActive, false)
const snapRun = await runBarberConversationProbe({ ...deps, readGuard: snapshots.readGuard, createPort: snapshots.createPort,
  fetchImpl: (async (url: unknown, request: RequestInit) => { assert.equal(transactionActive, false, 'AI must run after transaction closes'); return fetchImpl(url as never, request) }) as typeof fetch
}, env, { cases: ['greeting'] })
assert.equal(snapRun.enforcement, 'readonly_snapshots')
assert.equal(snapRun.cachePerformanceMeasured, false)
assert.ok(snapRun.samples[0]!.snapshot!.transactions >= 1)
assert.equal(snapRun.samples[0]!.outcome, 'ai')
console.log('conversational bot latency probe offline: PASS')






