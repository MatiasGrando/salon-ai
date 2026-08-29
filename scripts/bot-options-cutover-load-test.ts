import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { resolveF11PgContractDatabase } from './f11-pg-contract-database.js'

const connectionString = resolveF11PgContractDatabase('F11.6 cutover load contract')
const [{ createPrismaClient }, { Prisma }, admission, activation, worker] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/application/activation-operations.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js')
])
const prisma = createPrismaClient({ connectionString, max: 10, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const id = (name: string) => `f116_${name}_${suffix}`
const businessId = id('business')
const deploymentId = id('deployment')
const configurationA = id('configuration-a')
const configurationB = id('configuration-b')
const phoneNumberId = id('phone')
const actorId = 'f11-6-load-contract'
const BURST_SIZE = 40
const WARMUP_SIZE = 8
const SEQUENTIAL_SAMPLE_SIZE = 8
const latencyWaiverValue = process.env.F11_ALLOW_LATENCY_WAIVER
if (latencyWaiverValue !== undefined && latencyWaiverValue !== 'true' && latencyWaiverValue !== 'false') {
  throw new Error('F11_ALLOW_LATENCY_WAIVER must be exactly "true" or "false"')
}
const latencyWaiverEnabled = latencyWaiverValue === 'true'

try {
  await seed()
  const repository = new admission.PrismaAuthoritativeAdmissionRepository(prisma)
  const route = await repository.resolveRoute(phoneNumberId)
  assert.equal(route.kind, 'new')
  if (route.kind !== 'new') throw new Error('load fixture did not resolve authoritative route')

  for (let sequence = -WARMUP_SIZE; sequence < 0; sequence += 1) {
    const outcome = await repository.admitAuthoritative({ route, phoneNumberId, events: [message(sequence)] })
    assert.equal(outcome.insertedCount, 1)
  }

  const emptyTransactionLatencies: number[] = []
  for (let offset = 0; offset < BURST_SIZE; offset += 4) {
    await Promise.all(Array.from({ length: 4 }, async () => {
      const started = performance.now()
      await prisma.$transaction((tx) => tx.$queryRaw(Prisma.sql`SELECT 1`))
      emptyTransactionLatencies.push(performance.now() - started)
    }))
  }
  const sequentialAdmissionLatencies: number[] = []
  for (let sequence = BURST_SIZE + 100; sequence < BURST_SIZE + 100 + SEQUENTIAL_SAMPLE_SIZE; sequence += 1) {
    const started = performance.now()
    await repository.admitAuthoritative({ route, phoneNumberId, events: [message(sequence)] })
    sequentialAdmissionLatencies.push(performance.now() - started)
  }

  const admissionLatencies: number[] = []
  for (let offset = 0; offset < BURST_SIZE; offset += 4) {
    await Promise.all(Array.from({ length: Math.min(4, BURST_SIZE - offset) }, async (_, index) => {
      const sequence = offset + index
      const started = performance.now()
      const outcome = await repository.admitAuthoritative({ route, phoneNumberId, events: [message(sequence)] })
      admissionLatencies.push(performance.now() - started)
      assert.equal(outcome.insertedCount, 1)
    }))
  }
  const emptyTransactionP95Ms = percentile(emptyTransactionLatencies, 0.95)
  const sequentialAdmissionP95Ms = percentile(sequentialAdmissionLatencies, 0.95)
  const admissionP95Ms = percentile(admissionLatencies, 0.95)
  const latencyBudgetMet = admissionP95Ms <= 200
  console.log(JSON.stringify({ diagnostic: 'F11.6_LATENCY_CLASSIFICATION', emptyTransactionP95Ms: round(emptyTransactionP95Ms), sequentialAdmissionP95Ms: round(sequentialAdmissionP95Ms), burstAdmissionP95Ms: round(admissionP95Ms), latencyBudgetMet, latencyWaiverEnabled }))
  if (!latencyBudgetMet && !latencyWaiverEnabled) {
    assert.fail(`authoritative admission p95 exceeded 200ms: ${admissionP95Ms.toFixed(2)}ms`)
  }
  if (!latencyBudgetMet) {
    console.log(JSON.stringify({ diagnostic: 'F11.6_LATENCY_WAIVER_APPLIED', scope: 'single-commerce-pilot', measuredP95Ms: round(admissionP95Ms), targetP95Ms: 200 }))
  }

  const blocked = await activation.activateExclusiveConfiguration({
    client: prisma, businessId, expectedGeneration: 1, configurationId: configurationB,
    actorId, legacyCoverageComplete: true, timeoutMs: 1_000
  })
  assert.equal(blocked.kind, 'BLOCKED', 'durable backlog must block cutover rather than disappear')
  if (blocked.kind !== 'BLOCKED') throw new Error('backlog unexpectedly passed preflight')
  assert.ok(blocked.snapshot.counts.inbox > 0n || blocked.snapshot.counts.jobs > 0n)
  await activation.abortExclusiveActivationPreflight({ client: prisma, handle: blocked.handle, actorId })

  const queueWaitMs: number[] = []
  for (;;) {
    const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
    if (!claimed) break
    queueWaitMs.push(claimed.queueWaitMs)
    await prisma.$transaction(async (tx) => {
      await worker.completeClaimedBotJobTx(tx, claimed)
      await tx.$executeRaw(Prisma.sql`UPDATE "BotActionInbox" SET "status"='PROCESSED'::"BotInboxStatus" WHERE "id"=${claimed.aggregateId}`)
    })
  }
  assert.equal(queueWaitMs.length, BURST_SIZE + WARMUP_SIZE + SEQUENTIAL_SAMPLE_SIZE)
  const queueToClaimP95Ms = percentile(queueWaitMs, 0.95)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotDispatchClaim" ("id","businessId","channel","resourceId","engineKey","generation","fenceEpoch","kind","status","claimToken","claimedUntil","updatedAt")
    VALUES (${id('draining-claim')},${businessId},'WHATSAPP'::"BotChannel",${id('draining-resource')},'deterministic-options',1,0,'PROCESS'::"BotDispatchKind",'CLAIMED'::"BotDispatchStatus",${id('draining-token')},clock_timestamp()+interval '100 milliseconds',clock_timestamp())
  `)
  const switched = await activation.activateExclusiveConfiguration({
    client: prisma, businessId, expectedGeneration: 1, configurationId: configurationB,
    actorId, legacyCoverageComplete: true, timeoutMs: 2_000
  })
  assert.equal(switched.kind, 'SWITCHED', 'expired in-flight claim must drain before the switch')
  if (switched.kind !== 'SWITCHED') throw new Error('cutover did not switch')
  assert.equal(switched.generation, 2)

  await assert.rejects(
    repository.admitAuthoritative({ route, phoneNumberId, events: [message(BURST_SIZE + 1)] }),
    /pointer changed during admission/,
    'a pre-cutover route may not admit after generation change'
  )
  const staleEventCount = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*) AS "count" FROM "BotProviderEvent" WHERE "businessId"=${businessId} AND "eventKey"=${message(BURST_SIZE + 1).eventKey}
  `)
  assert.equal(staleEventCount[0]?.count, 0n, 'rejected old route must not execute or persist new work')
  const final = (await prisma.$queryRaw<Array<{ pointers: bigint; activeClaims: bigint; generation: number; engineKey: string }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BotChannelDeployment" WHERE "businessId"=${businessId} AND "channel"='WHATSAPP'::"BotChannel") AS "pointers",
      (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId"=${businessId} AND "status" IN ('CLAIMED'::"BotDispatchStatus",'SENDING'::"BotDispatchStatus",'UNKNOWN'::"BotDispatchStatus")) AS "activeClaims",
      "generation", "engineKey"
    FROM "BotChannelDeployment" WHERE "id"=${deploymentId}
  `))[0]!
  assert.deepEqual(final, { pointers: 1n, activeClaims: 0n, generation: 2, engineKey: 'deterministic-options' })

  console.log(JSON.stringify({
    result: latencyBudgetMet ? 'PASS' : 'PASS_WITH_LATENCY_WAIVER', burstSize: BURST_SIZE,
    authoritativeAckP95Ms: round(admissionP95Ms),
    queueToClaimP95Ms: round(queueToClaimP95Ms),
    deliveredCallback: { sample: 'INCOMPLETE', reason: 'local load contract performs no Meta network I/O; accepted is not treated as delivered' },
    doubleEngineResponses: 0, staleCutoverExecutions: 0, finalGeneration: 2
  }))
} finally {
  await prisma.$disconnect()
}

function message(sequence: number) {
  return {
    kind: 'message' as const,
    eventKey: id(`event-${sequence}`),
    providerMessageId: id(`provider-${sequence}`),
    phoneNumberId,
    displayPhoneNumber: null,
    fromPhone: `54911${String(sequence).padStart(8, '0')}`,
    textBody: 'hola',
    messageType: 'text' as const,
    interactiveReplyId: null,
    mediaType: null,
    mediaMimeType: null,
    mediaId: null,
    filename: null,
    providerOccurredAtIso: null
  }
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${businessId},${id('customer')},'F11.6 load')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","routingMode","phoneNumberId","definition","updatedAt") VALUES (${configurationA},${businessId},'f116-a','F11.6 A','v1','ACTIVE','EXCLUSIVE',${phoneNumberId},'{}'::jsonb,clock_timestamp()),(${configurationB},${businessId},'f116-b','F11.6 B','v2','ACTIVE','EXCLUSIVE',${phoneNumberId},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","generation","legacyDispatchCoverageVersion","updatedAt") VALUES (${deploymentId},${businessId},'deterministic-options',${configurationA},1,1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessWhatsAppConfig" ("id","businessId","connectionStatus","phoneNumberId","displayPhoneNumber","wabaId","accessToken","appSecret","updatedAt") VALUES (${id('whatsapp')},${businessId},'CONNECTED'::"WhatsAppConnectionStatus",${phoneNumberId},'test-display','test-waba','test-token','0123456789abcdef0123456789abcdef',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","updatedAt") VALUES (${businessId},'UTC',clock_timestamp())`)
  })
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
