import assert from 'node:assert/strict'
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
