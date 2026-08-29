import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

// Requires an already migrated disposable F10 scratch; this script never creates,
// migrates, resets, or drops a database.
const connectionString = resolveF10PgContractDatabase('F10.1 handoff contract')
const [{ createPrismaClient }, { Prisma }, handoffExecutor] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-handoff-effect-executor.js')
])
const prisma = createPrismaClient({ connectionString, max: 6, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 60_000 } })
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `f10_b_${suffix}`, otherBusiness: `f10_other_${suffix}`, config: `f10_cfg_${suffix}`, deployment: `f10_dep_${suffix}`, session: `f10_s_${suffix}` }
const request = { kind: 'REQUEST_HUMAN_HANDOFF' as const, reason: 'cliente_solicito_atencion', detail: 'F10 contract', context: null }
const cancel = { kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' as const }

try {
  await assertSchema()
  await seed()
  await requestHandoff('request-1')
  const first = await currentHandoff()
  await requestHandoff('request-1')
  assert.equal((await handoffs()).length, 1, 'same request replays its exact handoff')
  await assert.rejects(() => requestHandoff('request-1', { ...request, reason: 'different' }), /idempotency conflict/)
  await assert.rejects(() => requestHandoff('request-2'), /cannot queue handoff/, 'only one active handoff per session')
  await cancelHandoff('cancel-1')
  assert.equal((await sessionStatus()), 'ACTIVE')
  assert.equal((await handoffById(first.id)).status, 'CANCELLED')
  await requestHandoff('request-2')
  const second = await currentHandoff()
  assert.notEqual(second.id, first.id)
  await cancelHandoff('cancel-1')
  assert.equal((await handoffById(second.id)).status, 'QUEUED', 'historical cancellation replay cannot target a later handoff')
  await requestHandoff('request-1')
  assert.equal((await currentHandoff()).id, second.id, 'historical request replay cannot retarget a later handoff')
  assert.equal((await handoffById(second.id)).status, 'QUEUED', 'historical request replay cannot mutate the newer handoff')
  await assertTenantMismatch(second.id)
  await assertRollback()
  await assertConcurrentRequestRequest()
  await assertRequestCancelSerialization()
  console.log('OK F10.1 PG: schema, idempotency/result fencing, active uniqueness, cancellation, tenant scope, rollback, concurrent request/request and request/cancel serialization.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function assertSchema() {
  const row = (await prisma.$queryRaw<Array<{ table: string | null; labels: string; active: boolean; fk: boolean; nonblank: boolean; timestamps: boolean }>>(Prisma.sql`
    SELECT to_regclass('public."BotHandoff"')::text AS "table",
      (SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE typname = 'BotHandoffStatus') AS "labels",
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'BotHandoff_one_active_per_session' AND indexdef LIKE '%WHERE%') AS "active",
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BotHandoff_businessId_sessionId_fkey') AS "fk",
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BotHandoff_reason_nonblank') AS "nonblank",
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('BotHandoff_f10_1_timestamp_consistency', 'BotHandoff_f10_2_timestamp_consistency')) AS "timestamps"
  `))[0]
  assert.deepEqual(row, { table: '"BotHandoff"', labels: 'QUEUED,TAKEN,CANCELLED,RESOLVED', active: true, fk: true, nonblank: true, timestamps: true })
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    for (const business of [ids.business, ids.otherBusiness]) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${business}, ${`F10-${business}`}, 'F10 contract')`)
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${ids.business}, 'deterministic-options', 'F10', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "updatedAt") VALUES (${ids.deployment}, ${ids.business}, 'deterministic-options', ${ids.config}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${ids.session}, ${ids.business}, ${ids.deployment}, 0, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
  })
}

async function requestHandoff(key: string, effect = request) {
  return requestHandoffFor(ids.session, key, effect)
}
async function cancelHandoff(key: string) {
  return cancelHandoffFor(ids.session, key)
}
async function requestHandoffFor(sessionId: string, key: string, effect = request) {
  return prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId, operationKey: key, effects: [effect] }))
}
async function cancelHandoffFor(sessionId: string, key: string) {
  return prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId, operationKey: key, effects: [cancel] }))
}
async function handoffs() { return prisma.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BotHandoff" WHERE "businessId" = ${ids.business} AND "sessionId" = ${ids.session} ORDER BY "queuedAt"`) }
async function currentHandoff() { const rows = await handoffs(); const row = rows.at(-1); assert.ok(row); return row }
async function handoffById(id: string) { const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS "status" FROM "BotHandoff" WHERE "id" = ${id} AND "businessId" = ${ids.business}`); assert.ok(rows[0]); return rows[0]! }
async function sessionStatus() { const rows = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS "status" FROM "BotSession" WHERE "id" = ${ids.session} AND "businessId" = ${ids.business}`); return rows[0]!.status }

async function assertTenantMismatch(handoffId: string) {
  await assert.rejects(() => prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.otherBusiness, sessionId: ids.session, operationKey: 'wrong-tenant', effects: [cancel] })), /session not found in tenant/)
  assert.equal((await handoffById(handoffId)).status, 'QUEUED')
}
async function assertRollback() {
  await cancelHandoff('cancel-2')
  await assert.rejects(() => prisma.$transaction(async (tx) => { await handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId: ids.session, operationKey: 'rollback-request', effects: [request] }); throw new Error('FORCE_F10_ROLLBACK') }), /FORCE_F10_ROLLBACK/)
  assert.equal((await handoffs()).length, 2, 'rollback removes handoff and operation together')
  await requestHandoff('request-3')
}
async function assertConcurrentRequestRequest() {
  const sessionId = await seedScenarioSession('request_request', 'ACTIVE')
  const winnerKey = 'concurrent-request-winner', loserKey = 'concurrent-request-loser'
  const results = await Promise.allSettled([requestHandoffFor(sessionId, winnerKey), requestHandoffFor(sessionId, loserKey)])
  const fulfilledIndex = results.findIndex((result) => result.status === 'fulfilled')
  assert.ok(fulfilledIndex >= 0, 'one concurrent request commits')
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'one concurrent request is rolled back after session serialization')
  const completedKey = fulfilledIndex === 0 ? winnerKey : loserKey
  const rolledBackKey = fulfilledIndex === 0 ? loserKey : winnerKey
  await assertStateEquivalence(sessionId, 'HUMAN_QUEUED')
  await assertCompletedOperation(sessionId, completedKey, 'REQUEST_HUMAN_HANDOFF')
  await assertAbsentOperation(rolledBackKey, 'REQUEST_HUMAN_HANDOFF')
}

async function assertRequestCancelSerialization() {
  // From ACTIVE, cancellation obtains the row lock first and fails closed; the
  // truly concurrent request waits, then commits the only active handoff.
  const activeSession = await seedScenarioSession('request_cancel_active', 'ACTIVE')
  await runLockedThenConcurrent(activeSession,
    (tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId: activeSession, operationKey: 'active-cancel-loser', effects: [cancel] }),
    (started) => prisma.$transaction(async (tx) => { started(); await handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId: activeSession, operationKey: 'active-request-winner', effects: [request] }) }))
  await assertStateEquivalence(activeSession, 'HUMAN_QUEUED')
  await assertCompletedOperation(activeSession, 'active-request-winner', 'REQUEST_HUMAN_HANDOFF')
  await assertAbsentOperation('active-cancel-loser', 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER')

  // From HUMAN_QUEUED, request obtains the lock first and fails closed; the
  // concurrent cancellation waits, then restores ACTIVE and removes activity.
  const queuedSession = await seedScenarioSession('request_cancel_queued', 'ACTIVE')
  await requestHandoffFor(queuedSession, 'queued-setup-request')
  await runLockedThenConcurrent(queuedSession,
    (tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId: queuedSession, operationKey: 'queued-request-loser', effects: [request] }),
    (started) => prisma.$transaction(async (tx) => { started(); await handoffExecutor.prismaHandoffEffectExecutor(tx, { businessId: ids.business, sessionId: queuedSession, operationKey: 'queued-cancel-winner', effects: [cancel] }) }))
  await assertStateEquivalence(queuedSession, 'ACTIVE')
  await assertCompletedOperation(queuedSession, 'queued-cancel-winner', 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER')
  await assertAbsentOperation('queued-request-loser', 'REQUEST_HUMAN_HANDOFF')
}

async function runLockedThenConcurrent(
  sessionId: string,
  first: (tx: Parameters<typeof handoffExecutor.prismaHandoffEffectExecutor>[0]) => Promise<void>,
  second: (started: () => void) => Promise<void>
) {
  let locked!: () => void
  const lockHeld = new Promise<void>((resolve) => { locked = resolve })
  let started!: () => void
  const secondStarted = new Promise<void>((resolve) => { started = resolve })
  const firstAttempt = prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BotSession" WHERE "id" = ${sessionId} AND "businessId" = ${ids.business} FOR UPDATE`)
    locked()
    await secondStarted
    await first(tx)
  })
  await lockHeld
  const secondAttempt = second(started)
  const results = await Promise.allSettled([firstAttempt, secondAttempt])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one request/cancel operation commits')
}

async function seedScenarioSession(tag: string, status: 'ACTIVE' | 'HUMAN_QUEUED') {
  const sessionId = `f10_${tag}_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "status", "updatedAt")
    VALUES (${sessionId}, ${ids.business}, ${ids.deployment}, 0, 'UTC', '{}'::jsonb, 0, ${status}::"BotSessionStatus", clock_timestamp())
  `)
  return sessionId
}

async function assertStateEquivalence(sessionId: string, expectedStatus: 'ACTIVE' | 'HUMAN_QUEUED') {
  const rows = await prisma.$queryRaw<Array<{ sessionStatus: string; activeCount: bigint }>>(Prisma.sql`
    SELECT s."status"::text AS "sessionStatus", count(h."id") AS "activeCount"
    FROM "BotSession" s LEFT JOIN "BotHandoff" h ON h."businessId" = s."businessId" AND h."sessionId" = s."id"
      AND h."status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
    WHERE s."id" = ${sessionId} AND s."businessId" = ${ids.business}
    GROUP BY s."status"
  `)
  assert.equal(rows[0]!.sessionStatus, expectedStatus)
  assert.equal(rows[0]!.activeCount === 1n, expectedStatus === 'HUMAN_QUEUED', 'active QUEUED iff session HUMAN_QUEUED')
}

async function assertCompletedOperation(sessionId: string, key: string, kind: string) {
  const rows = await prisma.$queryRaw<Array<{ status: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "status", "resultRef" FROM "BotOperation"
    WHERE "operationKey" = ${`${key}:${kind}`} AND "businessId" = ${ids.business} AND "sessionId" = ${sessionId}
  `)
  assert.equal(rows.length, 1, 'winning operation persists exactly once')
  assert.equal(rows[0]!.status, 'COMPLETED')
  assert.ok(rows[0]!.resultRef)
}

async function assertAbsentOperation(key: string, kind: string) {
  const rows = await prisma.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    SELECT "operationKey" FROM "BotOperation" WHERE "operationKey" = ${`${key}:${kind}`}
  `)
  assert.equal(rows.length, 0, 'losing operation is rolled back rather than retained STARTED')
}
async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotHandoff" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${ids.business}, ${ids.otherBusiness})`)
  })
}
