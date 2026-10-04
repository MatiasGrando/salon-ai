import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { initialDialogueState, type DialogueContext, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider, type InterpretationDiagnostics } from '../src/conversational-bot/ai-interpreter.js'
import { resolveWhatsAppConversationAi } from '../src/conversational-bot/whatsapp-ai.js'
import { loadConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { localDateKey } from '../src/bot-options/application/availability-queries.js'

const BUSINESS_ID = 'cmpvr0oqo0000o0vcnhgyv054'
const CUSTOMER_CODE = 'WX-38N6UG'
const CASES = ['greeting', 'address', 'catalog_prices', 'opening_hours', 'availability', 'mixed'] as const
export type ProbeCase = typeof CASES[number]
type ProbeOptions = { samples?: number; cases?: readonly ProbeCase[]; label?: string }
type SnapshotDiagnostics = { transactions: number; totalMs: number; catalogMs: number; informationMs: number; availabilityMs: number }
export type ProbeDependencies = {
  readGuard(): Promise<{ defaultReadOnly: boolean; transactionReadOnly: boolean; enforcement?: 'readonly_snapshots' }>
  readScope(): Promise<{ businessId: string; customerCode: string; policyActive: boolean }>
  createPort(businessId: string, caseId?: ProbeCase): Promise<{ context: DialogueContext; port: DialoguePort; snapshotDiagnostics?: SnapshotDiagnostics; cacheDiagnostics?: { hits: number; misses: number; stampReads: number; stampMs: number; loadMs: number } }>
  fetchImpl?: typeof fetch
}
type Sample = {
  caseId: ProbeCase; sample: number; fixtureHash: string; catalogHash: string | null; clockAt: string | null
  outcome: 'ai' | 'prepared' | 'fallback' | 'error'; reason: string | null; copyReason: string | null
  calls: { interpretation: number; response: number; catalog: number; information: number; availability: number }
  metrics: { contextMs: number; catalogMs: number; informationMs: number; availabilityMs: number; interpretationMs: number; validationMs: number; engineMs: number; responseMs: number; totalMs: number }
  usage: InterpretationDiagnostics['usage'] | null; cache: Record<string, number> | null; snapshot: SnapshotDiagnostics | null
}
const ms = (value: number) => Math.round(value * 10) / 10
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function options(input: ProbeOptions) {
  const samples = input.samples ?? 1
  const cases = input.cases ?? CASES
  if (input.label !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(input.label)) throw new Error('PROBE_INVALID_OPTIONS')
  if (!Number.isInteger(samples) || samples < 1 || samples > 3 || !cases.length || cases.length > CASES.length ||
      new Set(cases).size !== cases.length || cases.some(value => !CASES.includes(value))) throw new Error('PROBE_INVALID_OPTIONS')
  return { samples, cases, label: input.label ?? 'unlabelled' }
}
export function parseProbeArguments(args: readonly string[]): ProbeOptions {
  if (args[0] !== '--run-barber-readonly') throw new Error('PROBE_EXPLICIT_RUN_REQUIRED')
  const result: ProbeOptions = {}
  for (const value of args.slice(1)) {
    if (/^--samples=[1-3]$/.test(value) && result.samples === undefined) result.samples = Number(value.slice(10))
    else if (value.startsWith('--case=') && result.cases === undefined) result.cases = [value.slice(7) as ProbeCase]
    else if (value.startsWith('--label=') && result.label === undefined) result.label = value.slice(8)
    else throw new Error('PROBE_INVALID_OPTIONS')
  }
  options(result)
  return result
}

/** Startup settings are defense in depth; CLI also verifies READ ONLY inside every data transaction. */
export function buildReadonlyProbePoolOptions(connectionString: string, env: Record<string, string | undefined>) {
  let url: URL
  try { url = new URL(connectionString) } catch { throw new Error('PROBE_CONNECTION_REQUIRED') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PROBE_CONNECTION_REQUIRED')
  if (url.searchParams.has('options')) throw new Error('PROBE_CONNECTION_OPTIONS_FORBIDDEN')
  const configured = Number(env.DATABASE_POOL_MAX ?? '3')
  const max = Number.isInteger(configured) && configured > 0 ? configured : 3
  return { connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000' }
}

type SnapshotClient = Pick<PrismaClient, '$transaction'>
type SnapshotFactory = typeof createPrismaDialoguePort

/** Every data callback starts after a verified READ ONLY setting; returned values never retain the tx client. */
export async function withReadonlyProbeSnapshot<T>(client: SnapshotClient,
  operation: (tx: Prisma.TransactionClient, guard: { defaultReadOnly: boolean; transactionReadOnly: true }) => Promise<T>): Promise<T> {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const rows = await tx.$queryRaw<Array<{ defaultReadOnly: string; transactionReadOnly: string }>>(Prisma.sql`
      SELECT current_setting('default_transaction_read_only') AS "defaultReadOnly", current_setting('transaction_read_only') AS "transactionReadOnly"
    `)
    if (rows[0]?.transactionReadOnly !== 'on') throw new Error('PROBE_READONLY_REQUIRED')
    return operation(tx, { defaultReadOnly: rows[0]?.defaultReadOnly === 'on', transactionReadOnly: true })
  }, { maxWait: 2000, timeout: 20000 })
}

/** Diagnostic snapshots change query scheduling. They measure AI + safe data reads, not production pool/cache timing. */
export function createReadonlySnapshotDependencies(client: SnapshotClient, factory: SnapshotFactory = createPrismaDialoguePort): ProbeDependencies {
  return {
    readGuard: () => withReadonlyProbeSnapshot(client, async (_tx, guard) => ({ ...guard, enforcement: 'readonly_snapshots' as const })),
    readScope: () => withReadonlyProbeSnapshot(client, async tx => {
      const row = await tx.business.findUnique({ where: { customerCode: CUSTOMER_CODE }, select: { id: true, customerCode: true } })
      if (!row || row.id !== BUSINESS_ID) return { businessId: '', customerCode: '', policyActive: false }
      return { businessId: row.id, customerCode: row.customerCode ?? '', policyActive: Boolean(await loadConversationPolicy(tx, { businessId: row.id })) }
    }),
    async createPort(businessId, caseId) {
      if (businessId !== BUSINESS_ID) throw new Error('PROBE_SCOPE_REQUIRED')
      const diagnostics: SnapshotDiagnostics = { transactions: 0, totalMs: 0, catalogMs: 0, informationMs: 0, availabilityMs: 0 }
      const snapshot = async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => {
        const at = performance.now()
        diagnostics.transactions += 1
        try { return await withReadonlyProbeSnapshot(client, run) }
        finally { diagnostics.totalMs = ms(diagnostics.totalMs + performance.now() - at) }
      }
      const measured = async <T>(kind: 'catalogMs' | 'informationMs' | 'availabilityMs', run: () => Promise<T>) => {
        const at = performance.now()
        try { return await run() } finally { diagnostics[kind] = ms(diagnostics[kind] + performance.now() - at) }
      }
      const informationActions = caseId === 'opening_hours' ? ['HOURS'] as const
        : caseId === 'address' || caseId === 'mixed' ? ['ADDRESS'] as const : null
      const loaded = await snapshot(async tx => {
        const prepared = await factory(tx, businessId)
        if (prepared.context.businessId !== businessId) throw new Error('PROBE_SCOPE_REQUIRED')
        const catalog = await measured('catalogMs', () => prepared.port.catalog())
        const facts = informationActions && prepared.port.information
          ? await measured('informationMs', () => prepared.port.information!(informationActions)) : null
        // Materialize all values before transaction completion, without retaining the original port.
        return { context: structuredClone(prepared.context), catalog: structuredClone(catalog), facts: structuredClone(facts) }
      })
      return { context: loaded.context, snapshotDiagnostics: diagnostics, port: {
        catalog: async () => structuredClone(loaded.catalog),
        information: async actions => {
          if (loaded.facts && actions && (!actions.includes('HOURS') || caseId === 'opening_hours')) return structuredClone(loaded.facts)
          return snapshot(async tx => {
            const prepared = await factory(tx, businessId)
            if (!prepared.port.information) throw new Error('PROBE_FIXTURE_UNAVAILABLE')
            return measured('informationMs', () => prepared.port.information!(actions))
          })
        },
        availability: (service, date, professionalId) => snapshot(async tx => {
          const prepared = await factory(tx, businessId)
          return measured('availabilityMs', () => prepared.port.availability(service, date, professionalId))
        })
      } }
    }
  }
}
/** Pure conversational core only. Dependencies expose no persistence, job, outbox or transport operations. */
export async function runBarberConversationProbe(deps: ProbeDependencies, env: Record<string, string | undefined>, input: ProbeOptions = {}) {
  const selected = options(input)
  const ai = resolveWhatsAppConversationAi(env, deps.fetchImpl)
  if (!ai || !env.OPENAI_API_KEY?.trim()) throw new Error('PROBE_WHATSAPP_AI_REQUIRED')
  const guard = await deps.readGuard().catch(() => { throw new Error('PROBE_READ_GUARD_FAILED') })
  if (!guard.transactionReadOnly || (!guard.defaultReadOnly && guard.enforcement !== 'readonly_snapshots')) throw new Error('PROBE_READONLY_REQUIRED')
  const scope = await deps.readScope().catch(() => { throw new Error('PROBE_SCOPE_READ_FAILED') })
  if (scope.businessId !== BUSINESS_ID || scope.customerCode !== CUSTOMER_CODE) throw new Error('PROBE_SCOPE_REQUIRED')
  if (!scope.policyActive) throw new Error('PROBE_POLICY_REQUIRED')
  let fixtureServiceId: string | null = null
  // Fixture preparation is excluded from sample timings. A fresh real catalog is still read during each turn.
  if (selected.cases.some(value => value === 'availability' || value === 'mixed')) {
    try {
      const prepared = await deps.createPort(BUSINESS_ID)
      if (prepared.context.businessId !== BUSINESS_ID) throw new Error('scope')
      fixtureServiceId = (await prepared.port.catalog()).find(service => !service.requiresConsultation && service.durationMinutes !== null && service.durationMinutes > 0)?.id ?? null
      if (!fixtureServiceId) throw new Error('service')
    } catch { throw new Error('PROBE_FIXTURE_UNAVAILABLE') }
  }
  const samples: Sample[] = []
  for (const caseId of selected.cases) for (let attempt = 1; attempt <= selected.samples; attempt++) {
    const state = initialDialogueState(BUSINESS_ID)
    if (caseId === 'availability' || caseId === 'mixed') { state.serviceId = fixtureServiceId; state.pending = 'date' }
    const message = {
      greeting: 'hola', address: 'donde estan?', catalog_prices: 'que servicios y precios tienen?',
      opening_hours: 'que horario de atencion tienen?', availability: 'quiero un turno mañana con cualquier profesional',
      mixed: 'donde estan y quiero un turno mañana con cualquier profesional'
    }[caseId]
    const sample: Sample = {
      caseId, sample: attempt, fixtureHash: hash({ version: 1, caseId, state, message }), catalogHash: null, clockAt: null,
      outcome: 'error', reason: null, copyReason: null,
      calls: { interpretation: 0, response: 0, catalog: 0, information: 0, availability: 0 },
      metrics: { contextMs: 0, catalogMs: 0, informationMs: 0, availabilityMs: 0, interpretationMs: 0, validationMs: 0, engineMs: 0, responseMs: 0, totalMs: 0 }, usage: null, cache: null, snapshot: null
    }
    const started = performance.now()
    try {
      const prepared = await deps.createPort(BUSINESS_ID, caseId)
      sample.metrics.contextMs = ms(performance.now() - started)
      if (prepared.context.businessId !== BUSINESS_ID) throw new Error('scope')
      sample.clockAt = prepared.context.dbNow.toISOString()
      sample.fixtureHash = hash({ version: 1, caseId, state, message, timezone: prepared.context.timezone,
        localDate: localDateKey(prepared.context.dbNow, prepared.context.timezone) })
      const measure = async <T>(kind: 'catalog' | 'information' | 'availability', run: () => Promise<T>): Promise<T> => {
        sample.calls[kind] += 1
        const at = performance.now()
        try { return await run() } finally { sample.metrics[`${kind}Ms`] = ms(sample.metrics[`${kind}Ms`] + performance.now() - at) }
      }
      const port: DialoguePort = {
        catalog: () => measure('catalog', async () => { const catalog = await prepared.port.catalog(); sample.catalogHash = hash(catalog); return catalog }),
        availability: (...args) => measure('availability', () => prepared.port.availability(...args)),
        ...(prepared.port.information ? { information: (actions?: Parameters<NonNullable<DialoguePort['information']>>[0]) =>
          measure('information', () => prepared.port.information!(actions)) } : {})
      }
      const provider: AiInterpretationProvider = async (request, signal) => { sample.calls.interpretation += 1; return ai.provider(request, signal) }
      if (ai.provider.respond) provider.respond = async (request, signal) => { sample.calls.response += 1; return ai.provider.respond!(request, signal) }
      const response = await respondWithAiInterpreter(prepared.context, structuredClone(state), message, port, provider, { timeoutMs: ai.timeoutMs })
      const diagnostics = response.interpretation
      sample.outcome = diagnostics.mode === 'ai' ? diagnostics.copyMode : 'fallback'
      sample.reason = diagnostics.reason
      sample.copyReason = diagnostics.copyReason
      Object.assign(sample.metrics, { interpretationMs: diagnostics.providerMs, validationMs: diagnostics.validationMs,
        engineMs: diagnostics.engineMs ?? 0, responseMs: diagnostics.responseMs ?? 0 })
      sample.usage = diagnostics.usage ?? null
      sample.snapshot = prepared.snapshotDiagnostics ? { ...prepared.snapshotDiagnostics } : null
      if (prepared.cacheDiagnostics) {
        sample.cache = {}
        for (const key of ['hits', 'misses', 'stampReads', 'stampMs', 'loadMs'] as const) {
          const value = prepared.cacheDiagnostics[key]
          if (Number.isFinite(value) && value >= 0) sample.cache[key] = ms(value)
        }
      }
      // Never export the response, proposal or resulting state: they can contain customer-facing data.
    } catch { sample.reason = 'core_error' }
    finally { sample.metrics.totalMs = ms(performance.now() - started); samples.push(sample) }
  }
  const summary: Partial<Record<ProbeCase, { count: number; ai: number; prepared: number; fallback: number; errors: number; medianMs: number; maxMs: number }>> = {}
  for (const caseId of selected.cases) {
    const rows = samples.filter(sample => sample.caseId === caseId)
    const sorted = rows.map(sample => sample.metrics.totalMs).sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    summary[caseId] = { count: rows.length, ai: rows.filter(row => row.outcome === 'ai').length,
      prepared: rows.filter(row => row.outcome === 'prepared').length, fallback: rows.filter(row => row.outcome === 'fallback').length, errors: rows.filter(row => row.outcome === 'error').length,
      medianMs: ms(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2), maxMs: sorted.at(-1)! }
  }
  return { scope: 'core_only' as const, classification: 'exploratory' as const, fixtureVersion: 1, label: selected.label,
    excluded: ['persistence', 'queues', 'webhook', 'meta', 'phone_delivery'],
    enforcement: guard.enforcement ?? 'readonly_sessions', cachePerformanceMeasured: guard.enforcement !== 'readonly_snapshots',
    snapshotDataIncludedInContextMs: guard.enforcement === 'readonly_snapshots', fixturePreparationExcluded: true,
    metricsAreInclusive: true, sampleCount: samples.length,
    configFingerprint: hash({ model: env.CONVERSATIONAL_WHATSAPP_AI_MODEL?.trim() || 'gpt-6-luna', timeoutMs: ai.timeoutMs }),
    config: { model: env.CONVERSATIONAL_WHATSAPP_AI_MODEL?.trim() || 'gpt-6-luna', timeoutMs: ai.timeoutMs }, samples, summary }
}

/** CLI prints only codes authored here, never driver/provider messages. */
export function safeProbeErrorCode(error: unknown): string {
  const allowed = new Set(['PROBE_INVALID_OPTIONS', 'PROBE_EXPLICIT_RUN_REQUIRED', 'PROBE_CONNECTION_REQUIRED',
    'PROBE_CONNECTION_OPTIONS_FORBIDDEN', 'PROBE_WHATSAPP_AI_REQUIRED', 'PROBE_READONLY_REQUIRED',
    'PROBE_READ_GUARD_FAILED', 'PROBE_SCOPE_REQUIRED', 'PROBE_SCOPE_READ_FAILED', 'PROBE_POLICY_REQUIRED', 'PROBE_FIXTURE_UNAVAILABLE'])
  return error instanceof Error && allowed.has(error.message) ? error.message : 'C06_CONVERSATIONAL_PROBE_FAILED'
}
async function main() {
  const input = parseProbeArguments(process.argv.slice(2))
  const connectionString = process.env.C06_READONLY_DATABASE_URL
  if (!connectionString) throw new Error('PROBE_CONNECTION_REQUIRED')
  const client = new PrismaClient({ adapter: new PrismaPg(buildReadonlyProbePoolOptions(connectionString, process.env)) })
  try {
    const result = await runBarberConversationProbe(createReadonlySnapshotDependencies(client), process.env, input)
    console.log(JSON.stringify(result))
    if (result.samples.some(sample => sample.outcome === 'error')) process.exitCode = 1
  } finally { await client.$disconnect() }
}
const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch(error => { console.error(safeProbeErrorCode(error)); process.exitCode = 1 })
}




