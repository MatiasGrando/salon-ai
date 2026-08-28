import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

/**
 * F10.5 focused contract — privacy-safe handoff observability.
 *
 * Safety gate: only an explicit local F10 scratch database is ever accepted by
 * `resolveF10PgContractDatabase`; any other URL throws before a single byte is
 * touched. This mirrors the existing F10 contract safety pattern; the dedicated
 * `f10-pg-contract-database-safety-contract-test.ts` asserts the refusal.
 *
 * This script is intentionally NOT executed by the FREE-tier orchestration. It
 * documents the exact SELECT-only signals and verifies they derive from
 * `BotHandoff`, `BotHandoffAudit` and type-scoped handoff operations with zero
 * PII. Unrelated free-text operation statuses never contribute.
 */
const connectionString = resolveF10PgContractDatabase('F10.5 handoff observability contract')
const [{ createPrismaClient }, { Prisma }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js')
])
const { collectBotOptionsHandoffMetrics, BotOptionsMetrics, botOptionsMetrics } = await import('../src/bot-options/observability/metrics.js')

const prisma = createPrismaClient({ connectionString, max: 6, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const key = (x: string) => `f105_${x}_${suffix}`
const ids = {
  business: key('b'),
  config: key('c'),
  deployment: key('d'),
  conversationQueued: key('cv_q'),
  conversationTaken: key('cv_t'),
  sessionQueued: key('s_q'),
  sessionTaken: key('s_t'),
  handoffQueued: key('h_q'),
  handoffTaken: key('h_t')
}

try {
  // B4: use a fresh BotOptionsMetrics instance rather than the module singleton,
  // so handoff collection is fully isolated from the global state.
  const freshMetrics = new BotOptionsMetrics()
  // Seed a known GLOBAL operational state independent of the handoff collector
  // under test, so we can prove it never mutates the global
  // `bot_dispatch_unknown` gauge/alert.
  botOptionsMetrics.setOperationalGauges({ oldestReadyJobMs: 0, unknownDispatches: 3, staleSending: 0, poisonOutbox: 0, noAvailabilityHorizon: 0 })
  const globalBefore = botOptionsMetrics.snapshot()
  // Capture a pre-seed baseline. The collector aggregates GLOBAL trailing-24h
  // audit rows, so a reused scratch from prior contracts already contributes
  // rows; asserting exact equality to 1 against it would be invalid. We instead
  // assert the exact +1 delta each seeded audit signal produces.
  const baseline = await collectBotOptionsHandoffMetrics(prisma, freshMetrics)
  await seed()
  await verifySignals(baseline, freshMetrics)
  const globalAfter = botOptionsMetrics.snapshot()
  assert.equal(globalAfter.gauges.unknownDispatches, globalBefore.gauges.unknownDispatches, 'handoff collector must not mutate the global unknownDispatches gauge')
  assert.equal(globalAfter.alerts.includes('bot_dispatch_unknown'), globalBefore.alerts.includes('bot_dispatch_unknown'), 'handoff collector must not change the global bot_dispatch_unknown alert')
  console.log('OK F10.5: handoff queue/quiescence/ownership signals derive SELECT-only from type-scoped operations and the handoff ledger with no PII or global alert contamination.')
} finally {
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${ids.business},${key('customer')},'F10.5 contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${ids.config},${ids.business},'deterministic-options','F10.5','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${ids.deployment},${ids.business},'deterministic-options',${ids.config},1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${ids.conversationQueued},${ids.business},${key('phone-q')},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${ids.conversationTaken},${ids.business},${key('phone-t')},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${ids.sessionQueued},${ids.business},${ids.conversationQueued},${ids.deployment},0,'UTC','{}'::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${ids.sessionTaken},${ids.business},${ids.conversationTaken},${ids.deployment},0,'UTC','{}'::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    // Stuck queue: QUEUED older than the 30-minute stuck threshold.
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","status","reason","queuedAt","updatedAt") VALUES (${ids.handoffQueued},${ids.business},${ids.sessionQueued},'QUEUED'::"BotHandoffStatus",'contract',clock_timestamp() - interval '31 minutes',clock_timestamp())`)
    // Stale ownership: TAKEN older than the 6-hour stale threshold.
    // F10.2 check constraint requires ownerUserId NOT NULL and takenAt >= queuedAt
    // when status = TAKEN, so seed a deterministic non-PII owner and align queuedAt.
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","status","reason","queuedAt","takenAt","ownerUserId","updatedAt") VALUES (${ids.handoffTaken},${ids.business},${ids.sessionTaken},'TAKEN'::"BotHandoffStatus",'contract',clock_timestamp() - interval '6 hours 2 minutes',clock_timestamp() - interval '6 hours 1 minute',${key('owner')},clock_timestamp())`)
    // Outcome/blocking audits (authoritative ledger, no PII).
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${key('op-take-blocked')},'HANDOFF_TAKE',${ids.business},${ids.sessionQueued},'BLOCKED_UNKNOWN',${key('hash-take')},${ids.handoffQueued},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${key('op-resolve-blocked')},'HANDOFF_RESOLVE',${ids.business},${ids.sessionTaken},'BLOCKED_UNKNOWN',${key('hash-resolve')},${ids.handoffTaken},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionQueued},${ids.handoffQueued},'TAKE_STARTED',${key('op-take-start')},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionTaken},${ids.handoffTaken},'TAKE_COMPLETED',${key('op-take-done')},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionQueued},${ids.handoffQueued},'TAKE_TIMEOUT_REOPENED',${key('op-take-timeout')},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionTaken},${ids.handoffTaken},'RESOLVE_COMPLETED',${key('op-resolve-done')},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionQueued},${ids.handoffQueued},'TAKE_BLOCKED_UNKNOWN',${key('op-take-blocked')},'{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","operationKey","detail","createdAt") VALUES (${randomUUID()},${ids.business},${ids.sessionTaken},${ids.handoffTaken},'RESOLVE_BLOCKED_UNKNOWN',${key('op-resolve-blocked')},'{}'::jsonb,clock_timestamp())`)
  })
}

async function verifySignals(baseline: Awaited<ReturnType<typeof collectBotOptionsHandoffMetrics>>, freshMetrics: InstanceType<typeof BotOptionsMetrics>) {
  const snapshot = await collectBotOptionsHandoffMetrics(prisma, freshMetrics)
  const h = snapshot.handoff
  const b = baseline.handoff
  assert.ok(h, 'snapshot must expose handoff gauges')

  // No PII: every handoff gauge is a plain number; no IDs/phones/free-text.
  for (const [name, value] of Object.entries(h)) {
    assert.equal(typeof value, 'number', `handoff gauge ${name} must be a number (no PII)`)
  }

  // Queue stuck/age: the 31-minute-old QUEUED handoff crosses the 30-minute threshold.
  // Threshold checks (>=) are retained on purpose against a reused scratch.
  assert.ok(h.handoffQueuedStuck >= 1, `expected queued stuck >=1, got ${h.handoffQueuedStuck}`)
  assert.ok(h.handoffQueuedOldestMs >= 31 * 60_000, `expected oldest queued age >= 31min, got ${h.handoffQueuedOldestMs}`)

  // Stale ownership: the 6h1m-old TAKEN handoff crosses the 6-hour threshold.
  assert.ok(h.handoffStaleOwnership >= 1, `expected stale ownership >=1, got ${h.handoffStaleOwnership}`)
  assert.ok(h.handoffStaleOwnershipMs >= 6 * 60 * 60_000, `expected oldest taken age >= 6h, got ${h.handoffStaleOwnershipMs}`)

  // Outcome/drain signals from BotHandoffAudit (within the 24h window). The
  // collector counts GLOBAL audit rows, so assert the exact +1 delta this seed
  // produces rather than an absolute count of 1.
  assert.equal(h.handoffTakeStarted - b.handoffTakeStarted, 1, 'TAKE_STARTED delta')
  assert.equal(h.handoffTakeCompleted - b.handoffTakeCompleted, 1, 'TAKE_COMPLETED delta')
  assert.equal(h.handoffTakeTimeoutReopened - b.handoffTakeTimeoutReopened, 1, 'TAKE_TIMEOUT_REOPENED delta')
  assert.equal(h.handoffTakeBlockedUnknown - b.handoffTakeBlockedUnknown, 1, 'active HANDOFF_TAKE BLOCKED_UNKNOWN delta')
  assert.equal(h.handoffTakeBlockedUnknownRecent - b.handoffTakeBlockedUnknownRecent, 1, 'TAKE_BLOCKED_UNKNOWN audit delta')
  assert.equal(h.handoffResolveCompleted - b.handoffResolveCompleted, 1, 'RESOLVE_COMPLETED delta')
  assert.equal(h.handoffResolveBlockedUnknown - b.handoffResolveBlockedUnknown, 1, 'active HANDOFF_RESOLVE BLOCKED_UNKNOWN delta')
  assert.equal(h.handoffResolveBlockedUnknownRecent - b.handoffResolveBlockedUnknownRecent, 1, 'RESOLVE_BLOCKED_UNKNOWN audit delta')

  // Distinct, handoff-scoped alerts — must NOT duplicate the global signal.
  assert.ok(snapshot.alerts.includes('bot_handoff_take_blocked_unknown'), 'missing take-blocked alert')
  assert.ok(snapshot.alerts.includes('bot_handoff_resolve_blocked_unknown'), 'missing resolve-blocked alert')
  assert.ok(snapshot.alerts.includes('bot_handoff_queue_stuck'), 'missing queue-stuck alert')
  assert.ok(snapshot.alerts.includes('bot_handoff_stale_ownership'), 'missing stale-ownership alert')
  assert.ok(!snapshot.alerts.includes('bot_dispatch_unknown'), 'F10.5 must not duplicate the global bot_dispatch_unknown signal')
}
