/** Disposable in-memory PostgreSQL/WASM only. No URL, dotenv, network or production data. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { applyLazyContextWindowTx } from '../src/bot-options/application/lazy-context-window.js'
import { persistView } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { Prisma } from '../src/generated/prisma/client.js'

const db = new PGlite()
try {
  // Minimal matching schema, including the single-live-prompt invariant. This
  // checks real SQL/rollback, not production migrations or multi-backend locks.
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BookingVisitStatus" AS ENUM ('DRAFT','HELD','PENDING_PAYMENT_REVIEW','CONFIRMED','CANCELLED','EXPIRED');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN','CANCELLED','RESOLVED');
    CREATE TYPE "BotJobStatus" AS ENUM ('READY','LEASED','DONE','RETRY','POISON');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','CLAIMED','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ','RETRY','FAILED','POISON','SKIPPED');
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','CLAIMED','SELECTED','CONFLICT','PROCESSED','STALE','FAILED');
    CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','RESOLVED','INVALIDATED','EXPIRED');
    CREATE TYPE "BotPromptMode" AS ENUM ('FUNCTIONAL','NAVIGATION','CONFLICT');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED','REJECTED');
    CREATE TABLE "Business" ("id" text PRIMARY KEY, "name" text);
    CREATE TABLE "Customer" ("id" text PRIMARY KEY, "businessId" text, "name" text, "phone" text, "normalizedPhone" text);
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text, "phone" text);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY, "businessId" text, "conversationId" text,
      "deploymentId" text, "deploymentGeneration" int, "status" "BotSessionStatus", "state" jsonb, "revision" bigint,
      "draftTouchedAt" timestamptz, "draftExpiresAt" timestamptz, "handoffClaimsPausedAt" timestamptz,
      "updatedAt" timestamptz DEFAULT now());
    CREATE TABLE "BookingVisit" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "status" "BookingVisitStatus");
    CREATE TABLE "BotHandoff" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "status" "BotHandoffStatus");
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY, "businessId" text, "payload" jsonb,
      "status" "BotProviderEventStatus" DEFAULT 'ADMITTED');
    CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "providerEventId" text,
      "status" "BotInboxStatus", "error" text);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY, "businessId" text, "kind" text, "aggregateId" text,
      "status" "BotJobStatus", "leaseToken" text, "leasedUntil" timestamptz, "lastError" text, "updatedAt" timestamptz);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "status" "BotOutboxStatus",
      "deliveryGroupId" text, "transitionId" text, "sequence" int, "kind" text, "payload" jsonb,
      "idempotencyKey" text UNIQUE, "dependsOnSequence" int, "availableAt" timestamptz, "updatedAt" timestamptz,
      "errorCode" text, "leaseToken" text, "leasedUntil" timestamptz, UNIQUE ("sessionId", "deliveryGroupId", "sequence"));
    CREATE TABLE "BotPrompt" ("id" text PRIMARY KEY, "sessionId" text, "promptToken" text UNIQUE,
      "stateRevision" bigint, "mode" "BotPromptMode", "status" "BotPromptStatus", "openedAt" timestamptz,
      "outboxMessageId" text, "resolvedAt" timestamptz);
    CREATE UNIQUE INDEX one_open_prompt ON "BotPrompt" ("sessionId") WHERE "status" IN ('OPEN','STABILIZING');
    CREATE TABLE "BotPromptChoice" ("id" text PRIMARY KEY, "promptId" text, "choiceToken" text,
      "actionType" text, "entityType" text, "entityId" text, "payload" jsonb, "labelSnapshot" text, "sortOrder" int);
    CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "deploymentId" text,
      "deploymentGeneration" int, "revisionFrom" bigint, "revisionTo" bigint, "actionType" text,
      "outcome" text, "providerEventId" text, UNIQUE("sessionId","revisionTo"));
  `)
  const input = { businessId: 'a', deploymentId: 'd', generation: 1, providerEventId: 'new', phone: '5491112345678',
    admittedAt: new Date('2026-08-31T18:00:00Z'), providerOccurredAt: new Date('2026-08-31T18:00:00Z'), isMedia: false }
  const draft = { ...createInitialBotOptionsState(), flow: 'BOOKING_SUMMARY', booking: 'DRAFT' }
  async function seed() {
    await db.exec(`TRUNCATE "Business", "Customer", "BotSession", "Conversation", "BookingVisit", "BotHandoff", "BotProviderEvent",
      "BotActionInbox", "BotJob", "BotOutbox", "BotPrompt", "BotPromptChoice", "BotTransitionLog";
      INSERT INTO "Business" VALUES ('a','Glow'),('b','Otro salón');
      INSERT INTO "Conversation" VALUES ('c','a','5491112345678'),('other-c','b','5491112345678');
      INSERT INTO "BotProviderEvent" ("id","businessId","payload") VALUES ('old','a','{"fromPhone":"5491112345678"}'),('new','a','{"fromPhone":"5491112345678"}');
      INSERT INTO "BotActionInbox" VALUES ('old-inbox','a',NULL,'old','ADMITTED',NULL);
      INSERT INTO "BotJob" ("id","businessId","kind","aggregateId","status") VALUES
        ('old-job','a','PROCESS_INBOX','old-inbox','POISON'),('prompt-job','a','RECONCILE_PROMPT','p','READY'),
        ('financial-job','a','EXPIRE_DEPOSIT','v','READY'), ('other-job','b','PROCESS_SESSION','other','READY');
      INSERT INTO "BotOutbox" ("id","businessId","sessionId","status","deliveryGroupId","sequence")
        VALUES ('out','a','s','PENDING','group',0),('other-out','b','other-s','PENDING','other-group',0);
      INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","mode","status","outboxMessageId")
        VALUES ('p','s','old-token',8,'FUNCTIONAL','OPEN','out');
      INSERT INTO "BookingVisit" VALUES ('confirmed','a','s','CONFIRMED');`)
    for (const [id, businessId, conversationId] of [['s','a','c'],['other-s','b','other-c']]) {
      await db.query(`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration",
        "status","state","revision","draftTouchedAt","draftExpiresAt") VALUES ($1,$2,$3,'d',1,'ACTIVE',$4,8,$5,$6)`,
      [id, businessId, conversationId, JSON.stringify(draft), new Date('2026-08-30T18:00:00Z'), input.admittedAt])
    }
  }
  async function run(fail = false, override = {}) {
    return db.transaction(async pg => {
      const adapt = (q: Prisma.Sql) => q.values.map(v => typeof v === 'bigint' ? String(v) : v)
      const tx = {
        async $queryRaw(q: Prisma.Sql) {
          const result = await pg.query<Record<string, unknown>>(q.text, adapt(q))
          for (const row of result.rows) for (const key of ['revision','choiceCount','outboxCount']) {
            if (row[key] !== undefined) row[key] = BigInt(row[key] as string)
          }
          return result.rows
        },
        async $executeRaw(q: Prisma.Sql) { return (await pg.query(q.text, adapt(q))).affectedRows ?? 0 }
      }
      const result = await applyLazyContextWindowTx(tx as never, { ...input, ...override }, fail
        ? async () => { throw new Error('render fault') }
        : persistView)
      return result
    })
  }
  const one = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows[0]!
  await seed()
  assert.equal((await run()).kind, 'EXPIRED')
  assert.equal((await one(`SELECT "state"->>'flow' AS flow FROM "BotSession" WHERE "id"='s'`)).flow, 'MAIN_MENU')
  assert.equal((await one(`SELECT "state"->>'flow' AS flow FROM "BotSession" WHERE "id"='other-s'`)).flow, 'BOOKING_SUMMARY')
  assert.equal((await one(`SELECT "status" FROM "BotPrompt" WHERE "id"='p'`)).status, 'INVALIDATED')
  assert.equal((await one(`SELECT "status" FROM "BotOutbox" WHERE "id"='out'`)).status, 'SKIPPED')
  assert.equal((await one(`SELECT "status" FROM "BotOutbox" WHERE "id"='other-out'`)).status, 'PENDING')
  assert.equal((await one(`SELECT "status" FROM "BotJob" WHERE "id"='old-job'`)).status, 'DONE')
  assert.equal((await one(`SELECT "status" FROM "BotJob" WHERE "id"='financial-job'`)).status, 'READY')
  assert.equal((await one(`SELECT "status" FROM "BookingVisit" WHERE "id"='confirmed'`)).status, 'CONFIRMED')
  assert.equal(Number((await one(`SELECT count(*) AS n FROM "BotPrompt" WHERE "sessionId"='s' AND "status"='OPEN'`)).n), 1)
  assert.equal(Number((await one(`SELECT count(*) AS n FROM "BotOutbox" WHERE "sessionId"='s' AND "status"='PENDING'`)).n), 1)
  assert.equal((await one(`SELECT "status" FROM "BotProviderEvent" WHERE "id"='new'`)).status, 'PROCESSED')
  // Direct replay cannot expire twice; worker additionally gates PROCESSED events.
  await run()
  assert.equal(Number((await one(`SELECT count(*) AS n FROM "BotTransitionLog"`)).n), 1)
  await seed()
  await assert.rejects(() => run(true), /render fault/)
  assert.equal((await one(`SELECT "status" FROM "BotOutbox" WHERE "id"='out'`)).status, 'PENDING')
  assert.equal((await one(`SELECT "status" FROM "BotJob" WHERE "id"='old-job'`)).status, 'POISON')
  assert.equal(Number((await one(`SELECT "revision" FROM "BotSession" WHERE "id"='s'`)).revision), 8)
  assert.equal(Number((await one(`SELECT count(*) AS n FROM "BotTransitionLog"`)).n), 0)
  await seed()
  await db.exec(`UPDATE "BotJob" SET "status"='LEASED' WHERE "id"='old-job'`)
  assert.equal((await run()).kind, 'WAIT')
  assert.equal(Number((await one(`SELECT "revision" FROM "BotSession" WHERE "id"='s'`)).revision), 8)
  await seed()
  await db.exec(`UPDATE "BotJob" SET "status"='LEASED', "leasedUntil"=now()-interval '1 minute' WHERE "id"='old-job'`)
  assert.equal((await run()).kind, 'EXPIRED', 'an abandoned expired job lease must not defer expiry forever')
  await seed()
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED', "leasedUntil"=now()-interval '1 minute' WHERE "id"='out'`)
  assert.equal((await run()).kind, 'EXPIRED', 'abandoned pre-I/O sender claim can be fenced without re-sending')
  assert.equal((await one(`SELECT "status" FROM "BotOutbox" WHERE "id"='out'`)).status, 'SKIPPED')
  await seed()
  await db.exec(`UPDATE "BotOutbox" SET "status"='UNKNOWN' WHERE "id"='out'`)
  assert.equal((await run()).kind, 'CONTINUE')
  assert.equal((await one(`SELECT "status" FROM "BotOutbox" WHERE "id"='out'`)).status, 'UNKNOWN')
  await seed()
  await db.exec(`INSERT INTO "BookingVisit" VALUES ('held','a','s','HELD')`)
  assert.equal((await run()).kind, 'CONTINUE', 'durable financial protection wins even if draft JSON is stale')
  await seed()
  await db.exec(`INSERT INTO "BotActionInbox" VALUES ('already-classified','a','s','new','ADMITTED',NULL)`)
  assert.equal((await run()).kind, 'REPLAY')
  await seed()
  await db.exec(`INSERT INTO "BotActionInbox" VALUES ('current-inbox','a',NULL,'new','ADMITTED',NULL);
    INSERT INTO "BotJob" ("id","businessId","kind","aggregateId","status","leasedUntil")
      VALUES ('current-job','a','PROCESS_INBOX','current-inbox','LEASED',now()+interval '1 minute')`)
  assert.equal((await run(false, { processingInboxId: 'current-inbox', currentJobId: 'current-job' })).kind,
    'EXPIRED', 'fallback must exclude its own inbox and live job from replay/busy guards')
  assert.equal((await one(`SELECT "status" FROM "BotActionInbox" WHERE "id"='current-inbox'`)).status, 'ADMITTED')
  assert.equal((await one(`SELECT "status" FROM "BotJob" WHERE "id"='current-job'`)).status, 'LEASED')
  await seed()
  await db.exec(`UPDATE "BotSession" SET "draftTouchedAt"=NULL,"draftExpiresAt"=NULL WHERE "id"='s'`)
  assert.equal((await run()).kind, 'CONTINUE')
  assert.equal(Number((await one(`SELECT "revision" FROM "BotSession" WHERE "id"='s'`)).revision), 8)
  assert.equal((await one(`SELECT "draftExpiresAt" FROM "BotSession" WHERE "id"='s'`)).draftExpiresAt instanceof Date, true)
  await seed()
  assert.equal((await run(false, { providerOccurredAt: new Date('2026-08-30T18:00:01Z') })).kind, 'CONTINUE', 'queue delay is not inactivity')
  // Real SQL verifies unique stored identity, legacy variants, tenant scope and
  // ambiguity fallback without touching booking/customer persistence.
  const expectedBody = [
    '¡Hola! 👋 Soy el asistente virtual de Glow.', '', 'Desde este menú podés:',
    '✨ Sacar un turno.', '💅 Ver servicios y precios.', '🕒 Consultar horarios.',
    '📅 Ver, cambiar o cancelar un turno.', '💬 Hablar con alguien del equipo.', '',
    'Para empezar, elegí la opción que necesitás 👇'
  ].join('\n')
  for (const scenario of [
    { rows: [], name: null },
    { rows: [['known','a','Martina','5491112345678','5491112345678']], name: 'Martina' },
    { rows: [['legacy','a','Lucía','+54 9 11 1234-5678',null]], name: 'Lucía' },
    { rows: [['other','b','Nombre Ajeno','5491112345678','5491112345678']], name: null },
    { rows: [['invalid','a','123','5491112345678','5491112345678']], name: null },
    { rows: [['one','a','Martina','5491112345678','5491112345678'], ['two','a','Lucía','+54 9 11 1234-5678',null]], name: null }
  ]) {
    await seed()
    await db.exec(`UPDATE "BotSession" SET "state" = jsonb_set("state",'{nameCandidate}','"Borrador"') WHERE "id"='s'`)
    for (const row of scenario.rows) await db.query(`INSERT INTO "Customer" VALUES ($1,$2,$3,$4,$5)`, row)
    assert.equal((await run()).kind, 'EXPIRED')
    const sent = await one(`SELECT "payload"->'item'->>'body' AS body FROM "BotOutbox" WHERE "sessionId"='s' AND "status"='PENDING'`)
    assert.equal(sent.body, scenario.name ? expectedBody.replace('¡Hola!', `¡Hola ${scenario.name}!`) : expectedBody)
    assert.equal(Number((await one(`SELECT count(*) AS n FROM "Customer"`)).n), scenario.rows.length, 'greeting lookup never modifies identities')
  }
  console.log('OK context-window SQL: real PostgreSQL/WASM reset, unique prompt, tenant isolation, rollback, replay, busy/protected and legacy bootstrap.')
} finally {
  await db.close()
}
