import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF11PgContractDatabase } from './f11-pg-contract-database.js'

const connectionString = resolveF11PgContractDatabase('F11 legacy cutover inbound contract')
const [{ createPrismaClient }, { Prisma }, activation, pausedInbound] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-activation.js'),
  import('../src/bot-options/infrastructure/prisma-legacy-cutover-inbound.js')
])
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const id = (name: string) => `f11legacy_${name}_${suffix}`
const businessId = id('business')
const providerMessageId = id('provider-message')

try {
  await seed()
  const handle = await activation.pauseDispatchScope({ client: prisma, businessId, expectedGeneration: 0, actorId: 'f11-legacy-contract', legacyCoverageComplete: true })
  await assertPausedAdmissionIsDurableAndSideEffectFree()
  await assertProviderIdentityIsMandatoryOnlyWhilePaused()
  await activation.resumeDispatchScope({ client: prisma, handle, actorId: 'f11-legacy-contract' })
  await assertActiveLegacyWorkIsClaimedWithoutConfiguration()
  console.log('OK F11 legacy PG: paused legacy inbound commits an idempotent receipt before ACK with zero Conversation/Message mutation; ID-less receipt is retryable; normal provider-ID work journals its scoped claim before processing; only NORMAL_DONE duplicates ACK; CLAIMED/UNKNOWN retry.')
} finally {
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${businessId},${id('customer')},'F11 legacy receipt contract')`)
    // Deliberately no configuration/pointer: F11.1 may create only an inactive
    // legacy dispatch scope, never a deterministic active configuration.
  })
}

async function assertPausedAdmissionIsDurableAndSideEffectFree() {
  const input = { client: prisma, businessId, providerMessageId, fromPhone: id('phone'), phoneNumberId: id('number'), displayPhoneNumber: 'display', payload: { version: 1 as const, text: 'hola' } }
  assert.deepEqual(await pausedInbound.admitPausedLegacyInbound(input), { kind: 'ACK_PAUSED', duplicate: false, legacyDuplicate: false })
  assert.deepEqual(await pausedInbound.admitPausedLegacyInbound(input), { kind: 'ACK_PAUSED', duplicate: true, legacyDuplicate: false })
  const receipts = await prisma.$queryRaw<Array<{ count: bigint; status: string }>>(Prisma.sql`SELECT count(*)::bigint AS "count", min("status"::text) AS "status" FROM "LegacyWhatsAppCutoverInbound" WHERE "businessId"=${businessId}`)
  assert.deepEqual(receipts[0], { count: 1n, status: 'PAUSED_ADMITTED' })
  const sideEffects = await prisma.$queryRaw<Array<{ conversations: bigint; messages: bigint }>>(Prisma.sql`
    SELECT (SELECT count(*) FROM "Conversation" WHERE "businessId"=${businessId}) AS "conversations", (SELECT count(*) FROM "Message" WHERE "providerMessageId"=${providerMessageId}) AS "messages"
  `)
  assert.deepEqual(sideEffects[0], { conversations: 0n, messages: 0n })
}

async function assertProviderIdentityIsMandatoryOnlyWhilePaused() {
  assert.deepEqual(await pausedInbound.admitPausedLegacyInbound({ client: prisma, businessId, fromPhone: id('idless-phone'), payload: { version: 1, text: 'no id' } }), { kind: 'RETRYABLE_IDENTITY_FAILURE' })
  const count = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "LegacyWhatsAppCutoverInbound" WHERE "businessId"=${businessId}`)
  assert.equal(count[0]?.count, 1n)
}

async function assertActiveLegacyWorkIsClaimedWithoutConfiguration() {
  const messageId = id('after-resume')
  const input = { client: prisma, businessId, providerMessageId: messageId, fromPhone: id('phone'), payload: { version: 1 as const, text: 'after resume' } }
  const claimed = await pausedInbound.claimLegacyInboundProcessing(input)
  assert.equal(claimed.kind, 'PROCESS')
  assert.deepEqual(await pausedInbound.claimLegacyInboundProcessing(input), { kind: 'RETRYABLE_IN_FLIGHT', status: 'CLAIMED' })
  if (claimed.kind !== 'PROCESS') throw new Error('expected legacy process claim')
  const journal = await prisma.$queryRaw<Array<{ status: string; deploymentGeneration: number; dispatchFenceEpoch: number; pausedAt: Date | null }>>(Prisma.sql`
    SELECT "status"::text AS "status", "deploymentGeneration", "dispatchFenceEpoch", "pausedAt"
    FROM "LegacyWhatsAppCutoverInbound" WHERE "businessId"=${businessId} AND "providerMessageId"=${messageId}
  `)
  assert.deepEqual(journal, [{ status: 'NORMAL_CLAIMED', deploymentGeneration: 0, dispatchFenceEpoch: 1, pausedAt: null }])
  assert.equal(await pausedInbound.advanceLegacyProcessClaim(prisma, claimed.claimToken, 'UNKNOWN'), true)
  assert.deepEqual(await pausedInbound.claimLegacyInboundProcessing(input), { kind: 'RETRYABLE_IN_FLIGHT', status: 'UNKNOWN' })
  const terminalInput = { ...input, providerMessageId: id('terminal') }
  const terminal = await pausedInbound.claimLegacyInboundProcessing(terminalInput)
  assert.equal(terminal.kind, 'PROCESS')
  if (terminal.kind !== 'PROCESS') throw new Error('expected terminal legacy process claim')
  assert.equal(await pausedInbound.advanceLegacyProcessClaim(prisma, terminal.claimToken, 'DONE'), true)
  assert.deepEqual(await pausedInbound.claimLegacyInboundProcessing(terminalInput), { kind: 'ACK_TERMINAL_DUPLICATE' })
  const scope = await prisma.$queryRaw<Array<{ activeConfigurationId: string | null; engineKey: string }>>(Prisma.sql`SELECT "activeConfigurationId", "engineKey" FROM "BotChannelDeployment" WHERE "businessId"=${businessId}`)
  assert.deepEqual(scope, [{ activeConfigurationId: null, engineKey: 'legacy-whatsapp' }])
}
