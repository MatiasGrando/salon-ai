import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF11PgContractDatabase } from './f11-pg-contract-database.js'

const connectionString = resolveF11PgContractDatabase('F11.2/F11.3 cutover contract')
const [{ createPrismaClient }, { Prisma }, activation] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/activation-operations.js')
])
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const id = (name: string) => `f112_${name}_${suffix}`
const businessId = id('business')
const deploymentId = id('deployment')
const firstConfigurationId = id('configuration-first')
const secondConfigurationId = id('configuration-second')
const actorId = 'f11-2-contract'
const phoneNumberId = id('phone')

try {
  await seed()
  await assertIncompletePreparationBlocksActivation()
  await assertActivationIsAtomic()
  await assertRollbackIsSymmetric()
  await assertConcurrentActivationHasSingleWinner()
  console.log('OK F11.2/F11.3 PG: pointer/generation activation and routing rollback are atomic, invalidate disposable runtime, audit the exact transition, resume only the winning generation, and concurrent cutovers have one winner.')
} finally {
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${businessId},${id('customer')},'F11.2 contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","routingMode","phoneNumberId","definition","updatedAt") VALUES (${firstConfigurationId},${businessId},'deterministic-options','F11.2 first','v1','ACTIVE','EXCLUSIVE',${phoneNumberId},'{}'::jsonb,clock_timestamp()),(${secondConfigurationId},${businessId},'deterministic-options-v2','F11.2 second','v2','ACTIVE','EXCLUSIVE',${phoneNumberId},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","generation","legacyDispatchCoverageVersion","updatedAt") VALUES (${deploymentId},${businessId},'legacy-whatsapp',0,1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessWhatsAppConfig" ("id","businessId","connectionStatus","phoneNumberId","displayPhoneNumber","wabaId","accessToken","appSecret","updatedAt") VALUES (${id('whatsapp')},${businessId},'CONNECTED',${phoneNumberId},'test-display','test-waba','test-token','0123456789abcdef0123456789abcdef',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","updatedAt") VALUES (${businessId},'America/Argentina/Buenos_Aires',clock_timestamp())`)
  })
  await seedDisposableRuntime('first', 0)
}

async function assertIncompletePreparationBlocksActivation() {
  await prisma.$executeRaw(Prisma.sql`UPDATE "BusinessWhatsAppConfig" SET "appSecret"=NULL WHERE "businessId"=${businessId}`)
  await assert.rejects(
    activation.activateExclusiveConfiguration({ client: prisma, businessId, expectedGeneration: 0, configurationId: firstConfigurationId, actorId, legacyCoverageComplete: true, timeoutMs: 1_000 }),
    /fully prepared for authoritative routing/
  )
  await prisma.$executeRaw(Prisma.sql`UPDATE "BusinessWhatsAppConfig" SET "appSecret"='0123456789abcdef0123456789abcdef' WHERE "businessId"=${businessId}`)
}

async function seedDisposableRuntime(name: string, generation: number) {
  const sessionId = id(`session-${name}`)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","deploymentId","deploymentGeneration","businessTimezone","state","status","updatedAt") VALUES (${sessionId},${businessId},${deploymentId},${generation},'UTC','{"booking":"DRAFT"}'::jsonb,'ACTIVE'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","status") VALUES (${id(`prompt-${name}`)},${sessionId},${id(`token-${name}`)},0,'OPEN'::"BotPromptStatus")`)
  })
}

async function pointer() {
  const rows = await prisma.$queryRaw<Array<{ engineKey: string; activeConfigurationId: string | null; previousConfigurationId: string | null; generation: number; paused: boolean }>>(Prisma.sql`
    SELECT "engineKey", "activeConfigurationId", "previousConfigurationId", "generation", "claimsPausedAt" IS NOT NULL AS "paused"
    FROM "BotChannelDeployment" WHERE "id"=${deploymentId}
  `)
  return rows[0]!
}

async function assertActivationIsAtomic() {
  const result = await activation.activateExclusiveConfiguration({
    client: prisma, businessId, expectedGeneration: 0, configurationId: firstConfigurationId,
    actorId, legacyCoverageComplete: true, timeoutMs: 1_000
  })
  assert.equal(result.kind, 'SWITCHED')
  assert.deepEqual(await pointer(), { engineKey: 'deterministic-options', activeConfigurationId: firstConfigurationId, previousConfigurationId: null, generation: 1, paused: false })
  const state = (await prisma.$queryRaw<Array<{ sessions: bigint; prompts: bigint; audits: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BotSession" WHERE "businessId"=${businessId} AND "status"='CLOSED'::"BotSessionStatus") AS "sessions",
      (SELECT count(*) FROM "BotPrompt" p JOIN "BotSession" s ON s."id"=p."sessionId" WHERE s."businessId"=${businessId} AND p."status"='INVALIDATED'::"BotPromptStatus") AS "prompts",
      (SELECT count(*) FROM "BotDeploymentAudit" WHERE "businessId"=${businessId} AND "action"='ACTIVATE' AND "generation"=1) AS "audits"
  `))[0]!
  assert.deepEqual(state, { sessions: 1n, prompts: 1n, audits: 1n })
}

async function assertRollbackIsSymmetric() {
  await seedDisposableRuntime('rollback', 1)
  const result = await activation.rollbackExclusiveConfiguration({
    client: prisma, businessId, expectedGeneration: 1, actorId,
    legacyCoverageComplete: true, timeoutMs: 1_000
  })
  assert.equal(result.kind, 'SWITCHED')
  assert.deepEqual(await pointer(), { engineKey: 'legacy-whatsapp', activeConfigurationId: null, previousConfigurationId: firstConfigurationId, generation: 2, paused: false })
  const audits = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) AS "count" FROM "BotDeploymentAudit" WHERE "businessId"=${businessId} AND "action"='ROLLBACK' AND "generation"=2`)
  assert.equal(audits[0]?.count, 1n)
}

async function assertConcurrentActivationHasSingleWinner() {
  const attempts = await Promise.allSettled([
    activation.activateExclusiveConfiguration({ client: prisma, businessId, expectedGeneration: 2, configurationId: firstConfigurationId, actorId: `${actorId}-a`, legacyCoverageComplete: true, timeoutMs: 1_000 }),
    activation.activateExclusiveConfiguration({ client: prisma, businessId, expectedGeneration: 2, configurationId: secondConfigurationId, actorId: `${actorId}-b`, legacyCoverageComplete: true, timeoutMs: 1_000 })
  ])
  assert.equal(attempts.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter((entry) => entry.status === 'rejected').length, 1)
  const current = await pointer()
  assert.equal(current.generation, 3)
  assert.equal(current.engineKey, 'deterministic-options')
  assert.equal(current.paused, false)
  assert.ok(current.activeConfigurationId === firstConfigurationId || current.activeConfigurationId === secondConfigurationId)
}
