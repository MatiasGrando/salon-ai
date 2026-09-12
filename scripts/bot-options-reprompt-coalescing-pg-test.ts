import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPrismaClient } from '../src/config/prisma-client.js'
import { Prisma } from '../src/generated/prisma/client.js'
import { reuseCurrentPromptTx } from '../src/bot-options/application/reuse-current-prompt.js'
import { menuView } from '../src/bot-options/domain/views.js'

// Disposable local contract database only. An isolated, random schema means no
// business fixtures or production tables are touched, even on failure.
const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const schema = `reprompt_${randomUUID().replaceAll('-', '')}`
assert.match(schema, /^reprompt_[a-f0-9]{32}$/)
const clients = [0, 1].map(() => createPrismaClient({ connectionString, max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 1500 }))
const view = menuView('Elegí', [{ actionType: 'menu.start_booking', label: 'Turno' }, { actionType: 'menu.business_hours', label: 'Horarios' }])
const input = { businessId: 'b', sessionId: 's', revision: 10n, view, toPhone: '5491100000000', dbNow: new Date() }
const transaction = <T>(client: typeof clients[number], run: (tx: Prisma.TransactionClient) => Promise<T>) => client.$transaction(async tx => {
  await tx.$queryRaw(Prisma.sql`SELECT set_config('search_path', ${schema}, true)`)
  return run(tx)
})
let created = false
try {
  await clients[0]!.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  created = true
  await transaction(clients[0]!, async tx => {
    for (const sql of [
      `CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN', 'STABILIZING', 'RESOLVED', 'INVALIDATED', 'EXPIRED')`,
      `CREATE TYPE "BotInboxStatus" AS ENUM ('SELECTED', 'CONFLICT')`,
      `CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENDING', 'UNKNOWN', 'ACCEPTED', 'DELIVERED', 'READ', 'RETRY', 'FAILED', 'POISON', 'SKIPPED')`,
      `CREATE TABLE "BotSession" ("id" text PRIMARY KEY, "businessId" text, "revision" bigint)`,
      `CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "transitionId" text, "deliveryGroupId" text,
        "sequence" int, "kind" text, "payload" jsonb, "idempotencyKey" text UNIQUE, "status" "BotOutboxStatus", "dependsOnSequence" int,
        "availableAt" timestamptz, "updatedAt" timestamptz)`,
      `CREATE TABLE "BotPrompt" ("id" text PRIMARY KEY, "sessionId" text, "stateRevision" bigint, "status" "BotPromptStatus", "outboxMessageId" text, "openedAt" timestamptz)`,
      `CREATE TABLE "BotPromptChoice" ("promptId" text, "actionType" text, "entityType" text, "entityId" text, "payload" jsonb, "sortOrder" int)`,
      `CREATE TABLE "BotActionInbox" ("promptId" text, "businessId" text, "sessionId" text, "status" "BotInboxStatus")`,
      `CREATE TABLE "BotTransitionLog" ("sessionId" text, "businessId" text, "revisionTo" bigint, "actionType" text)`,
      `INSERT INTO "BotSession" VALUES ('s', 'b', 10)`,
      `INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "status") VALUES ('original', 'b', 's', 'PENDING')`,
      `INSERT INTO "BotPrompt" VALUES ('prompt', 's', 10, 'OPEN', 'original', now())`,
      `INSERT INTO "BotPromptChoice" VALUES ('prompt', 'menu.start_booking', NULL, NULL, NULL, 0), ('prompt', 'menu.business_hours', NULL, NULL, NULL, 1)`
    ]) await tx.$executeRawUnsafe(sql)
  })
  const reuse = (client: typeof clients[number]) => transaction(client, async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "BotSession" WHERE "id" = 's' AND "businessId" = 'b' FOR UPDATE`)
    return reuseCurrentPromptTx(tx, input)
  })
  assert.deepEqual(await Promise.all(clients.map(reuse)), [true, true], 'pending menu is reused across real connections')
  await transaction(clients[0]!, async tx => {
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotOutbox"`)
    assert.equal(counts[0]!.count, 1n)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET "status" = 'READ' WHERE "id" = 'original'`)
  })
  assert.deepEqual(await Promise.all(clients.map(reuse)), [true, true], 'delivered menu gets one durable concurrent reminder')
  await reuse(clients[1]!)
  await transaction(clients[0]!, async tx => {
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotOutbox"`)
    assert.equal(rows[0]!.count, 2n, 'global idempotency key survives replay and separate client pools')
    assert.equal(await reuseCurrentPromptTx(tx, { ...input, businessId: 'other' }), false, 'tenant boundary')
    assert.equal(await reuseCurrentPromptTx(tx, { ...input, revision: 11n }), false, 'revision boundary')
    assert.equal(await reuseCurrentPromptTx(tx, { ...input, view: menuView('same text', [{ actionType: 'handoff.request', label: 'Turno' }]) }), false, 'logical options, not visible label')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotPrompt" SET "status" = 'STABILIZING'`)
    assert.equal(await reuseCurrentPromptTx(tx, input), true)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotPrompt" SET "status" = 'RESOLVED'`)
    assert.equal(await reuseCurrentPromptTx(tx, input), false, 'resolved without pending action cannot suppress recovery')
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" VALUES ('prompt', 'b', 's', 'SELECTED')`)
    assert.equal(await reuseCurrentPromptTx(tx, input), true, 'selected action waiting for worker retains ownership')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET "status" = 'FAILED' WHERE "id" = 'original'`)
    assert.equal(await reuseCurrentPromptTx(tx, input), false, 'failed delivery does not trap customer silently')
  })
  console.log('OK reprompt PostgreSQL: actual SQL, two pools, row locks, durable unique reminder, revision/tenant/selection boundaries.')
} finally {
  if (created) await clients[0]!.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
  await Promise.all(clients.map(client => client.$disconnect()))
}
