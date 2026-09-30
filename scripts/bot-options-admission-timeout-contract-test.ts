import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  AUTHORITATIVE_LOCK_TIMEOUT_MS,
  AUTHORITATIVE_STATEMENT_TIMEOUT_MS,
  DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS,
  PrismaAuthoritativeAdmissionRepository
} from '../src/bot-options/infrastructure/prisma-admission.js'

assert.equal(DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS, 10_000,
  'temporary production transaction envelope must tolerate measured cross-region admission latency')
assert.equal(AUTHORITATIVE_LOCK_TIMEOUT_MS, 1_000,
  'temporary lock envelope must be explicit and bounded')
assert.equal(AUTHORITATIVE_STATEMENT_TIMEOUT_MS, 3_000,
  'temporary statement envelope must be explicit and bounded')

let observedDefaultTimeout: number | undefined
const executedStatements: string[] = []
const transactionClient = {
  $executeRaw: async (query: { strings?: readonly string[] }) => {
    executedStatements.push(query.strings?.join('?') ?? String(query))
    return 0
  },
  $queryRaw: async () => [{ id: 'deployment-a', generation: 1 }]
}
const client = {
  $transaction: async (
    transaction: (tx: typeof transactionClient) => Promise<unknown>,
    options: { timeout: number }
  ) => {
    observedDefaultTimeout = options.timeout
    return transaction(transactionClient)
  }
}
const defaultRepository = new PrismaAuthoritativeAdmissionRepository(client as never)
await defaultRepository.admitAuthoritative({
  route: {
    kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
    appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
  },
  phoneNumberId: 'phone-a',
  events: []
})
assert.equal(observedDefaultTimeout, DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS,
  'the default repository must pass the fixed production timeout to Prisma')
assert.equal(
  executedStatements.some((statement) => statement.includes('UPDATE "BotJob"')),
  false,
  'authoritative admission must not recover POISON jobs in the webhook transaction'
)
assert.ok(
  executedStatements.some((statement) => statement.includes("lock_timeout = '1s'")),
  'authoritative admission must apply the temporary lock timeout'
)
assert.ok(
  executedStatements.some((statement) => statement.includes("statement_timeout = '3s'")),
  'authoritative admission must apply the temporary statement timeout'
)

const promptToken = 'A'.repeat(16)
const choiceToken = 'B'.repeat(11)
const interactiveStatements: string[] = []
const interactiveStatementValues: unknown[][] = []
const interactiveTx = {
  $executeRaw: async (query: { strings?: readonly string[]; values?: readonly unknown[] } | readonly string[]) => {
    const sql = query as { strings?: readonly string[]; values?: readonly unknown[] }
    const statement = sql.strings?.join('?') ?? String(query)
    interactiveStatements.push(statement)
    interactiveStatementValues.push(Array.isArray(sql.values) ? [...sql.values] : [])
    return 1
  },
  $queryRaw: async (query: { strings?: readonly string[] }) => {
    const statement = query.strings?.join('?') ?? String(query)
    if (statement.includes('FROM "BotChannelDeployment"')) {
      return [{ id: 'deployment-a', generation: 1 }]
    }
    if (statement.includes('INSERT INTO "BotProviderEvent"')) {
      return [{ id: 'provider-event-a' }]
    }
    throw new Error(`webhook admission performed non-journal query: ${statement}`)
  }
}
const interactiveRepository = new PrismaAuthoritativeAdmissionRepository({
  $transaction: async (transaction: (tx: typeof interactiveTx) => Promise<unknown>) => transaction(interactiveTx)
} as never)
const interactiveResult = await interactiveRepository.admitAuthoritative({
  route: {
    kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
    appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
  },
  phoneNumberId: 'phone-a',
  events: [{
    kind: 'message', eventKey: 'wamid.interactive-a', providerMessageId: 'wamid.interactive-a',
    phoneNumberId: 'phone-a', displayPhoneNumber: null, fromPhone: '5491100000000',
    textBody: 'Ver servicios y precios', messageType: 'interactive',
    interactiveReplyId: `b1.${promptToken}.${choiceToken}`,
    mediaType: null, mediaMimeType: null, mediaId: null, filename: null,
    providerOccurredAtIso: null
  }]
})
assert.deepEqual(interactiveResult, { eventCount: 1, insertedCount: 1 })
assert.ok(interactiveStatements.some((statement) => statement.includes('INSERT INTO "BotJob"')),
  'a durable provider event must enqueue asynchronous classification')
assert.ok(interactiveStatementValues.some((values) => values.includes('PROCESS_PROVIDER_EVENT')),
  'webhook admission must enqueue PROCESS_PROVIDER_EVENT')
assert.equal(interactiveStatements.some((statement) => statement.includes('BotActionInbox')), false,
  'webhook admission must not classify an interactive selection')
assert.equal(interactiveStatements.some((statement) => statement.includes('BotPrompt')), false,
  'webhook admission must not resolve or stabilize prompts')

const sensitiveMessage = 'postgresql://user:secret@production.example/db?password=secret'
const admissionLogs: unknown[][] = []
const originalConsoleError = console.error
console.error = (...args: unknown[]) => { admissionLogs.push(args) }
try {
  const failingRepository = new PrismaAuthoritativeAdmissionRepository({
    $transaction: async () => {
      const error = new Error(sensitiveMessage) as Error & { code: string }
      error.name = 'PrismaClientKnownRequestError'
      error.code = 'P2028'
      throw error
    }
  } as never)
  await assert.rejects(() => failingRepository.admitAuthoritative({
    route: {
      kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
      appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
    },
    phoneNumberId: 'phone-a',
    events: [],
    traceId: 'trace-safe'
  }))
} finally {
  console.error = originalConsoleError
}
assert.equal(admissionLogs.length, 1, 'failed admission must emit one sanitized diagnostic')
assert.equal(admissionLogs[0]?.[0], '[bot-options-authoritative-admission-error]')
assert.deepEqual(admissionLogs[0]?.[1], {
  event: 'admission_failed',
  traceId: 'trace-safe',
  eventCount: 0,
  hasInteractiveReply: false,
  errorName: 'PrismaClientKnownRequestError',
  errorCode: 'P2028'
})
assert.equal(JSON.stringify(admissionLogs).includes(sensitiveMessage), false,
  'sanitized admission diagnostics must not include exception messages or secrets')

for (const invalidTimeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => new PrismaAuthoritativeAdmissionRepository({} as never, { authoritativeTransactionTimeoutMs: invalidTimeout }),
    /authoritativeTransactionTimeoutMs must be a finite positive integer/
  )
}

new PrismaAuthoritativeAdmissionRepository({} as never)
new PrismaAuthoritativeAdmissionRepository({} as never, { authoritativeTransactionTimeoutMs: 5_000 })

console.log('OK authoritative admission transaction timeout: production default is fixed and test overrides are validated.')

// A webhook batch must fence all message identities before locking deployment/journal rows.
// Adapters exercise the real repository; model rollback by publishing staged writes only after success.
const expectedGate = (tenant: string, phone: string) => `bot-conversation-input:${createHash('sha256').update(JSON.stringify([tenant, phone])).digest('hex')}`
const message = (fromPhone: string, index: number, messageType: 'text' | 'image' | 'interactive' = 'text') => ({
  kind: 'message' as const, eventKey: `batch-${index}`, providerMessageId: `batch-${index}`,
  phoneNumberId: 'phone-a', displayPhoneNumber: null, fromPhone, textBody: 'synthetic', messageType,
  interactiveReplyId: messageType === 'interactive' ? `b1.${promptToken}.${choiceToken}` : null,
  mediaType: messageType === 'image' ? 'image' as const : null, mediaMimeType: null, mediaId: null, filename: null,
  providerOccurredAtIso: null
})
async function admissionTrace(tenant: string, phones: string[], failGate = false, statusOnly = false) {
  const trace: Array<{ sql: string; values: unknown[] }> = []
  let committedWrites = 0
  let stagedWrites = 0
  const unpack = (q: { strings?: readonly string[]; values?: readonly unknown[] } | readonly string[], bound: unknown[]) => {
    const sql = q as { strings?: readonly string[]; values?: readonly unknown[] }
    return { sql: Array.isArray(q) ? q.join('?') : sql.strings!.join('?'), values: Array.isArray(q) ? bound : [...(sql.values ?? [])] }
  }
  const repository = new PrismaAuthoritativeAdmissionRepository({
    async $transaction(body: (tx: unknown) => Promise<unknown>) {
      const result = await body({
        async $executeRaw(q: Parameters<typeof unpack>[0], ...bound: unknown[]) {
          const item = unpack(q,bound); trace.push(item)
          if (item.sql.includes('pg_advisory_xact_lock(') && failGate) throw new Error('injected conversation fence timeout')
          if (item.sql.includes('INSERT INTO')) stagedWrites++
          return 1
        },
        async $queryRaw(q: Parameters<typeof unpack>[0], ...bound: unknown[]) {
          const item = unpack(q,bound); trace.push(item)
          if (item.sql.includes('FROM "BotChannelDeployment"')) return [{ id: 'deployment-a',generation: 1 }]
          if (item.sql.includes('INSERT INTO "BotProviderEvent"')) { stagedWrites++; return [{ id: item.values[0] }] }
          throw new Error(`unexpected admission query: ${item.sql}`)
        }
      })
      committedWrites = stagedWrites
      return result
    }
  } as never)
  const events = statusOnly ? [{ kind: 'status' as const,eventKey: 'status',providerMessageId: 'status',phoneNumberId: 'phone-a',
    status: 'read' as const,recipientPhone: '5491100000000',providerOccurredAtIso: null,errorMessage: null }] :
    phones.map((phone,index) => message(phone,index,index === 1 ? 'image' : index === 2 ? 'interactive' : 'text'))
  const run = repository.admitAuthoritative({ route: { kind: 'new',businessId: tenant,deploymentId: 'deployment-a',generation: 1,
    appSecret: null,appSecretPrevious: null,appSecretPreviousValidUntil: null },phoneNumberId: 'phone-a',events })
  if (failGate) {
    const saved = console.error; console.error = () => {}
    try { await assert.rejects(run,/injected conversation fence timeout/) } finally { console.error = saved }
    assert.equal(committedWrites,0)
    assert.equal(stagedWrites,0,'fence rejection happens before any journal/job write')
    assert.equal(trace.some(item => item.sql.includes('FOR SHARE')),false,'deployment lock must not precede phone fence')
  } else await run
  return trace
}
const firstBatch = await admissionTrace('business-a',['549222','+549 111','549111','549333'])
const exclusive = firstBatch.filter(item => item.sql.includes('pg_advisory_xact_lock('))
assert.deepEqual(exclusive.map(item => item.values[0]),['549111','549222','549333'].map(phone => expectedGate('business-a',phone)),
  'canonical phones must be deduplicated, sorted and exclusively fenced')
const cutoverIndex = firstBatch.findIndex(item => item.sql.includes('pg_advisory_xact_lock_shared'))
const deploymentIndex = firstBatch.findIndex(item => item.sql.includes('FOR SHARE'))
for (const item of exclusive) assert.ok(firstBatch.indexOf(item)>cutoverIndex && firstBatch.indexOf(item)<deploymentIndex,
  'standalone shared cutover -> exclusive conversation locks -> deployment FOR SHARE')
const reverseBatch = await admissionTrace('business-a',['549333','549111','549222'])
assert.deepEqual(reverseBatch.filter(item => item.sql.includes('pg_advisory_xact_lock(')).map(item => item.values[0]),exclusive.map(item => item.values[0]))
const otherTenant = await admissionTrace('business-b',['549111'])
assert.notEqual(otherTenant.find(item => item.sql.includes('pg_advisory_xact_lock('))?.values[0],exclusive[0]!.values[0])
for (const trace of [await admissionTrace('business-a',[]),await admissionTrace('business-a',[],false,true)]) {
  assert.equal(trace.some(item => item.sql.includes('pg_advisory_xact_lock(')),false,'empty/status-only batch adds no conversation lock')
}
await admissionTrace('business-a',['549111'],true)
console.log('PASS admission consolidation fence: canonical sorted batch locks, media/interactive, tenant, fail-before-write and no-message path.')
