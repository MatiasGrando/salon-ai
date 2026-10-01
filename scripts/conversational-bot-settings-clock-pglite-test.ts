/** SQL contract uses disposable PostgreSQL/WASM; no remote connection. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'

const db = new PGlite()
const statements: string[] = []
const client = { async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
  statements.push(query.text)
  return (await db.query(query.text, query.values)).rows as T
} }
try {
  await db.exec(`CREATE TABLE "BusinessBotOptionsSettings" (
    "businessId" text PRIMARY KEY, "timezone" text NOT NULL, "bookingHorizonDays" integer NOT NULL,
    "bookingLeadTimeHours" integer NOT NULL, "morningCutTime" text NOT NULL, "eveningCutTime" text NOT NULL);
    INSERT INTO "BusinessBotOptionsSettings" VALUES
    ('a','America/Argentina/Buenos_Aires',2,0,'12:00','19:00'), ('b','UTC',5,1,'10:00','18:00');`)
  const before = Date.now()
  const a = await createPrismaDialoguePort(client as never, 'a')
  assert.equal(statements.length, 1, 'settings and database clock require one round trip')
  assert.equal(a.context.businessId, 'a')
  assert.equal(a.context.timezone, 'America/Argentina/Buenos_Aires')
  assert.ok(a.context.dbNow instanceof Date)
  assert.ok(a.context.dbNow.getTime() >= before && a.context.dbNow.getTime() <= Date.now())
  assert.match(statements[0]!, /CURRENT_TIMESTAMP AS now/)
  assert.match(statements[0]!, /WHERE "businessId" = \$1/)
  const b = await createPrismaDialoguePort(client as never, 'b')
  assert.equal(b.context.timezone, 'UTC', 'settings cannot leak across tenants')
  assert.equal((await new PrismaAvailabilityRepository(client).loadSettings('b')).horizonDays, 5, 'old API remains compatible')
  await assert.rejects(createPrismaDialoguePort(client as never, 'missing'), /unavailable for tenant/)
  for (const [column, value, message] of [
    ['timezone', 'invalid/timezone', /timezone/], ['bookingHorizonDays', 0, /horizon/],
    ['bookingLeadTimeHours', 48, /lead time/], ['morningCutTime', '25:00', /cuts/]
  ] as const) {
    await db.query(`UPDATE "BusinessBotOptionsSettings" SET "${column}"=$1 WHERE "businessId"='a'`, [value])
    await assert.rejects(createPrismaDialoguePort(client as never, 'a'), message)
    await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "timezone"='America/Argentina/Buenos_Aires',
      "bookingHorizonDays"=2,"bookingLeadTimeHours"=0,"morningCutTime"='12:00',"eveningCutTime"='19:00' WHERE "businessId"='a'`)
  }
  await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "timezone"='UTC',"bookingHorizonDays"=7 WHERE "businessId"='a'`)
  const refreshed = await createPrismaDialoguePort(client as never, 'a')
  assert.equal(refreshed.context.timezone, 'UTC', 'configuration stays live on the next turn')
  for (const now of [undefined, '2026-10-01T00:00:00Z', new Date(NaN)]) {
    const invalidClock = { $queryRaw: async () => [{ timezone: 'UTC', bookingHorizonDays: 2,
      bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now }] }
    await assert.rejects(createPrismaDialoguePort(invalidClock as never, 'a'), /database clock unavailable/)
  }
  console.log('conversational settings and clock PostgreSQL contract: PASS')
} finally { await db.close() }
