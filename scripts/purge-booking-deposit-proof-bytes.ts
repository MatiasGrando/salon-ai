import { createPrismaClient } from '../src/config/prisma-client.js'
import { purgeDueDepositProofBytes } from '../src/services/deposit-proof-byte-purge.js'

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const [key = '', value = 'true'] = arg.split('=', 2)
  if (!key.startsWith('--')) throw new Error(`Unsupported argument: ${arg}`)
  args.set(key, value)
}

const databaseUrl = required('--database-url')
const parsed = new URL(databaseUrl)
if (parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('Refusing non-local database; this maintenance CLI is local-only')
}
if (args.get('--allow-local-database') !== 'true') {
  throw new Error('Refusing without --allow-local-database=true')
}

const execute = args.get('--execute') === 'true'
if (execute && args.get('--confirm') !== 'PURGE_PROOF_BYTES') {
  throw new Error('Execute requires --confirm=PURGE_PROOF_BYTES')
}
const batchSize = Number(args.get('--batch-size') ?? '100')
const businessId = args.get('--business-id')?.trim() || undefined
const operationKey = args.get('--operation-key')?.trim() || undefined
if (execute && !operationKey) throw new Error('Execute requires --operation-key=<unique-non-PII-key>')

const prisma = createPrismaClient({ connectionString: databaseUrl, max: 2, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000 })
try {
  const result = await purgeDueDepositProofBytes(prisma, {
    mode: execute ? 'EXECUTE' : 'DRY_RUN', batchSize,
    ...(businessId ? { businessId } : {}),
    ...(operationKey ? { operationKey } : {})
  })
  // Deliberately aggregate-only observability: no identifiers, metadata, hashes or byte data.
  console.log(JSON.stringify(result))
} finally {
  await prisma.$disconnect()
}

function required(name: string) {
  const value = args.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
