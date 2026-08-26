import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== SAFE_DATABASE_URL) throw new Error('Refusing unsafe crash-recovery database URL')
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, worker, outbox] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `crash_b_${suffix}`
const configId = `crash_c_${suffix}`
const deploymentId = `crash_d_${suffix}`
const sessionId = `crash_s_${suffix}`
const conversationId = `crash_v_${suffix}`

try {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`CRASH-${suffix}`}, 'Crash contract')`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configId}, ${businessId}, 'crash', 'Crash', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, ${configId}, 1, 1, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, '5491100000000', ${businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt")
    VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'America/Argentina/Buenos_Aires', '{}'::jsonb, clock_timestamp())
  `)

  const jobId = `crash_j_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "updatedAt")
    VALUES (${jobId}, 'CRASH_TEST', ${jobId}, ${businessId}, ${deploymentId}, 1, clock_timestamp())
  `)
  const firstJobClaim = await worker.claimBotJob(prisma)
  assert.equal(firstJobClaim?.id, jobId)
  assert.ok(firstJobClaim)
  await prisma.$executeRaw`UPDATE "BotJob" SET "leasedUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${jobId}`
  const recoveredJob = await worker.claimBotJob(prisma)
  assert.equal(recoveredJob?.id, jobId)
  assert.ok(recoveredJob)
  assert.notEqual(recoveredJob.claimToken, firstJobClaim.claimToken)
  assert.equal(await worker.completeBotJob(prisma, jobId, firstJobClaim.claimToken), false, 'crashed worker token must be fenced')
  assert.equal(await worker.completeBotJob(prisma, jobId, recoveredJob.claimToken), true)

  const beforeIoId = `crash_before_io_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${beforeIoId}, ${businessId}, ${sessionId}, 'before-io', 'before-io', 0, 'text', '{}'::jsonb, ${`idem_${beforeIoId}`}, clock_timestamp())
  `)
  const abandonedClaim = await outbox.claimOutbox(prisma)
  assert.equal(abandonedClaim?.id, beforeIoId)
  assert.ok(abandonedClaim)
  await prisma.$executeRaw`UPDATE "BotOutbox" SET "leasedUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${beforeIoId}`
  const recoveredOutbox = await outbox.claimOutbox(prisma)
  assert.equal(recoveredOutbox?.id, beforeIoId)
  assert.ok(recoveredOutbox)
  let acceptedCalls = 0
  assert.equal(await outbox.sendClaimedOutbox({
    client: prisma, item: recoveredOutbox,
    provider: { async send() { acceptedCalls += 1; return { kind: 'accepted', providerMessageId: `wamid.${suffix}` } } }
  }), 'ACCEPTED')
  assert.equal(acceptedCalls, 1, 'crash before I/O must not duplicate provider submission')

  const ambiguousId = `crash_ambiguous_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${ambiguousId}, ${businessId}, ${sessionId}, 'ambiguous', 'ambiguous', 0, 'text', '{}'::jsonb, ${`idem_${ambiguousId}`}, clock_timestamp())
  `)
  const ambiguousClaim = await outbox.claimOutbox(prisma)
  assert.equal(ambiguousClaim?.id, ambiguousId)
  assert.ok(ambiguousClaim)
  assert.equal(await outbox.sendClaimedOutbox({
    client: prisma, item: ambiguousClaim, timeoutMs: 5,
    provider: { async send() { return new Promise(() => {}) } }
  }), 'UNKNOWN')
  assert.equal(await outbox.claimOutbox(prisma), null, 'ambiguous request must never retry automatically')
  assert.equal(await outbox.resolveUnknownOutbox({
    client: prisma, outboxId: ambiguousId, type: 'SKIP', actorId: 'crash-contract', reason: 'simulated crash after request'
  }), ambiguousId)

  console.log('OK F4 crash recovery: stale worker tokens are fenced, pre-I/O claims recover, ambiguous sends quarantine without retry.')
} finally {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutboxResolution" WHERE "outboxId" IN (SELECT "id" FROM "BotOutbox" WHERE "businessId" = ${businessId})`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  await prisma.$disconnect()
}
