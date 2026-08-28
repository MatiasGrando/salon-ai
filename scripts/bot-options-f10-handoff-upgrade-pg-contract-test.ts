import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

// Requires a disposable local salon_ai_f10_* scratch prepared through F8 + F9,
// with no F10 objects. This script applies the real F10 SQL exactly once; it
// never creates, resets, or drops a database.
const connectionString = resolveF10PgContractDatabase('F10.1 upgrade contract')
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `f10_upgrade_b_${suffix}`, config: `f10_upgrade_cfg_${suffix}`, deployment: `f10_upgrade_dep_${suffix}`, sessions: [`f10_upgrade_s1_${suffix}`, `f10_upgrade_s2_${suffix}`] }
const migrationSql = await readFile(new URL('../prisma/migrations/20260827220000_add_f10_handoffs/migration.sql', import.meta.url), 'utf8')
const client = new Client({ connectionString })
let connected = false

try {
  await client.connect()
  connected = true
  await assertPreF10F8F9Scratch()
  await seedLegacyQueuedSession()
  await client.query(migrationSql)
  const handoff = await assertMigratedLegacyHandoffs()
  await assertCancellableByRealExecutor(handoff)
  console.log('OK F10.1 upgrade PG: actual migration backfills one deterministic legacy queue handoff and the real executor cancels it.')
} finally {
  await cleanup()
  await client.end()
}

async function assertPreF10F8F9Scratch() {
  const { rows } = await client.query<{ f9: string | null; handoff: string | null; handoffStatus: string | null }>(`
    SELECT to_regclass('public."AppointmentChangeHistory"')::text AS "f9",
      to_regclass('public."BotHandoff"')::text AS "handoff",
      to_regtype('public."BotHandoffStatus"')::text AS "handoffStatus"
  `)
  assert.deepEqual(rows[0], { f9: '"AppointmentChangeHistory"', handoff: null, handoffStatus: null }, 'requires F8+F9 and no F10 schema')
}

async function seedLegacyQueuedSession() {
  await client.query('BEGIN')
  try {
    await client.query('INSERT INTO "Business" ("id", "customerCode", "name") VALUES ($1, $2, $3)', [ids.business, `F10-UPGRADE-${ids.business}`, 'F10 upgrade contract'])
    await client.query('INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, clock_timestamp())', [ids.config, ids.business, 'deterministic-options', 'F10 upgrade', 'v1', 'ACTIVE', '{}'])
    await client.query('INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "updatedAt") VALUES ($1, $2, $3, $4, clock_timestamp())', [ids.deployment, ids.business, 'deterministic-options', ids.config])
    for (const sessionId of ids.sessions) {
      await client.query('INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "status", "updatedAt") VALUES ($1, $2, $3, 0, $4, $5::jsonb, 0, $6::"BotSessionStatus", clock_timestamp())', [sessionId, ids.business, ids.deployment, 'UTC', '{}', 'HUMAN_QUEUED'])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function assertMigratedLegacyHandoffs() {
  const { rows } = await client.query<{ id: string; sessionId: string; reason: string; context: unknown; fk: boolean }>(`
    WITH handoffs AS (
      SELECT "id", "sessionId", "reason", "context" FROM "BotHandoff"
      WHERE "businessId" = $1
    )
    SELECT handoffs.*, EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'BotHandoff_businessId_sessionId_fkey'
    ) AS "fk"
    FROM handoffs
    ORDER BY "sessionId"
  `, [ids.business])
  assert.equal(rows.length, ids.sessions.length, 'every pre-existing HUMAN_QUEUED session has exactly one handoff')
  for (const row of rows) {
    assert.ok(ids.sessions.includes(row.sessionId))
    assert.equal(row.fk, true, 'migration preserves the tenant/session FK')
    assert.equal(row.id, `legacy-f10-${createHash('md5').update(`${ids.business}:${row.sessionId}`, 'utf8').digest('hex')}`)
    assert.equal(row.reason, 'LEGACY_HUMAN_QUEUED_BACKFILL')
    assert.deepEqual(row.context, { source: 'F10.1_migration', legacyStatus: 'HUMAN_QUEUED' })
  }
  return rows[0]!
}

async function assertCancellableByRealExecutor(handoff: { id: string; sessionId: string }) {
  const [{ createPrismaClient }, { Prisma }, handoffExecutor] = await Promise.all([
    import('../src/config/prisma-client.js'),
    import('../src/generated/prisma/client.js'),
    import('../src/bot-options/infrastructure/prisma-handoff-effect-executor.js')
  ])
  const prisma = createPrismaClient({ connectionString, max: 2, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions: { maxWait: 10_000, timeout: 60_000 } })
  try {
    await prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, {
      businessId: ids.business, sessionId: handoff.sessionId, operationKey: 'upgrade-cancel', effects: [{ kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' }]
    }))
    const rows = await prisma.$queryRaw<Array<{ handoffStatus: string; sessionStatus: string }>>(Prisma.sql`
      SELECT h."status"::text AS "handoffStatus", s."status"::text AS "sessionStatus"
      FROM "BotHandoff" h JOIN "BotSession" s ON s."businessId" = h."businessId" AND s."id" = h."sessionId"
      WHERE h."id" = ${handoff.id} AND h."businessId" = ${ids.business}
    `)
    assert.deepEqual(rows, [{ handoffStatus: 'CANCELLED', sessionStatus: 'ACTIVE' }])
  } finally {
    await prisma.$disconnect()
  }
}

async function cleanup() {
  if (!connected) return
  await client.query('BEGIN')
  try {
    const { rows } = await client.query<{ handoff: string | null }>('SELECT to_regclass(\'public."BotHandoff"\')::text AS "handoff"')
    if (rows[0]?.handoff) await client.query('DELETE FROM "BotHandoff" WHERE "businessId" = $1', [ids.business])
    await client.query('DELETE FROM "BotOperation" WHERE "businessId" = $1', [ids.business])
    await client.query('DELETE FROM "BotSession" WHERE "businessId" = $1', [ids.business])
    await client.query('DELETE FROM "BotChannelDeployment" WHERE "businessId" = $1', [ids.business])
    await client.query('DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = $1', [ids.business])
    await client.query('DELETE FROM "Business" WHERE "id" = $1', [ids.business])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
