import assert from 'node:assert/strict'
import {
  DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS,
  PrismaAuthoritativeAdmissionRepository
} from '../src/bot-options/infrastructure/prisma-admission.js'

assert.equal(DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS, 2_000,
  'production authoritative admission transaction timeout must cover measured cross-region database latency')

let observedDefaultTimeout: number | undefined
const transactionClient = {
  $executeRaw: async () => 0,
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

for (const invalidTimeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => new PrismaAuthoritativeAdmissionRepository({} as never, { authoritativeTransactionTimeoutMs: invalidTimeout }),
    /authoritativeTransactionTimeoutMs must be a finite positive integer/
  )
}

new PrismaAuthoritativeAdmissionRepository({} as never)
new PrismaAuthoritativeAdmissionRepository({} as never, { authoritativeTransactionTimeoutMs: 5_000 })

console.log('OK authoritative admission transaction timeout: production default is fixed and test overrides are validated.')
