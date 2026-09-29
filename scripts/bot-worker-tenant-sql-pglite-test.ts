import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { claimBotJob, maintainBotJobs } from '../src/bot-options/infrastructure/postgres-worker.js'
import { claimOutbox, maintainOutbox } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'
import { whatsappConfig } from '../src/config/whatsapp.js'

whatsappConfig.latencyDiagnosticBusinessCodes.clear()
const db = new PGlite()
const barber = 'cmpvr0oqo0000o0vcnhgyv054'
const other = 'another-business'
const include = { mode: 'include' as const, businessId: barber }
const exclude = { mode: 'exclude' as const, businessId: barber }
const queries: Prisma.Sql[] = []
const client = {
  async $queryRaw(query: Prisma.Sql) { queries.push(query); return (await db.query(query.text, query.values)).rows },
  async $executeRaw(query: Prisma.Sql) { return (await db.query(query.text, query.values)).affectedRows ?? 0 },
  async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
    return db.transaction(async (pg) => operation({
      async $queryRaw(query: Prisma.Sql) { queries.push(query); return (await pg.query(query.text, query.values)).rows },
      async $executeRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).affectedRows ?? 0 }
    }))
  }
}
try {
  await db.exec(`
    CREATE TYPE "BotJobStatus" AS ENUM ('READY','RETRY','LEASED','DONE','POISON');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','RETRY','CLAIMED','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ','SKIPPED','POISON');
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN');
    CREATE TYPE "BotInboxStatus" AS ENUM ('SELECTED');
    CREATE TYPE "BotProviderEventType" AS ENUM ('MESSAGE');
    CREATE TYPE "BotDispatchKind" AS ENUM ('SEND');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('SENDING','UNKNOWN');
    CREATE TABLE "BotChannelDeployment" ("id" text PRIMARY KEY, "businessId" text, "channel" "BotChannel",
      "generation" integer, "activeConfigurationId" text, "engineKey" text,
      "legacyDispatchCoverageVersion" integer, "claimsPausedAt" timestamptz, "dispatchFenceEpoch" integer);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY, "businessId" text, "kind" text, "aggregateId" text,
      "deploymentId" text, "deploymentGeneration" integer, "expectedRevision" bigint, "availableAt" timestamptz,
      "status" "BotJobStatus", "attempts" integer, "maxAttempts" integer, "leaseToken" text,
      "leasedUntil" timestamptz, "createdAt" timestamptz, "updatedAt" timestamptz, "lastError" text, UNIQUE ("kind","aggregateId"));
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY, "businessId" text, "conversationId" text,
      "deploymentId" text, "deploymentGeneration" integer, "status" "BotSessionStatus",
      "handoffClaimsPausedAt" timestamptz);
    CREATE TABLE "BotHandoff" ("businessId" text, "sessionId" text, "status" "BotHandoffStatus");
    CREATE TABLE "Conversation" ("id" text, "businessId" text, "phone" text);
    CREATE TABLE "BotActionInbox" ("id" text, "businessId" text, "sessionId" text, "providerEventId" text,
      "deploymentId" text, "deploymentGeneration" integer, "actionType" text, "status" "BotInboxStatus");
    CREATE TABLE "BotPrompt" ("id" text, "sessionId" text);
    CREATE TABLE "BotProviderEvent" ("id" text, "businessId" text, "eventType" "BotProviderEventType", "payload" jsonb);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "transitionId" text,
      "deliveryGroupId" text, "sequence" integer, "dependsOnSequence" integer, "payload" jsonb,
      "status" "BotOutboxStatus", "attempts" integer, "maxAttempts" integer, "leaseToken" text,
      "leasedUntil" timestamptz, "availableAt" timestamptz, "createdAt" timestamptz,
      "updatedAt" timestamptz, "errorCode" text);
    CREATE TABLE "BotDispatchClaim" ("id" text, "kind" "BotDispatchKind", "resourceId" text,
      "status" "BotDispatchStatus", "updatedAt" timestamptz);
    INSERT INTO "BotChannelDeployment" VALUES
      ('barber-deploy','cmpvr0oqo0000o0vcnhgyv054','WHATSAPP',1,'config','deterministic-options',1,NULL,0),
      ('other-deploy','another-business','WHATSAPP',1,'config','deterministic-options',1,NULL,0);
    INSERT INTO "BotSession" VALUES
      ('barber-session','cmpvr0oqo0000o0vcnhgyv054','barber-conversation','barber-deploy',1,'ACTIVE',NULL),
      ('other-session','another-business','other-conversation','other-deploy',1,'ACTIVE',NULL);
    INSERT INTO "BotJob" ("id","businessId","kind","aggregateId","deploymentId","deploymentGeneration",
      "availableAt","status","attempts","maxAttempts","createdAt","updatedAt") VALUES
      ('barber-job','cmpvr0oqo0000o0vcnhgyv054','PROCESS_PROVIDER_EVENT','barber-event','barber-deploy',1,
        clock_timestamp()-interval '1 minute','READY',0,5,clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('other-job','another-business','PROCESS_PROVIDER_EVENT','other-event','other-deploy',1,
        clock_timestamp()-interval '1 minute','READY',0,5,clock_timestamp()-interval '1 minute',clock_timestamp());
    INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","payload",
      "status","attempts","maxAttempts","availableAt","createdAt","updatedAt") VALUES
      ('barber-outbox','cmpvr0oqo0000o0vcnhgyv054','barber-session','initial:barber-session:0','barber-group',0,'{}',
        'PENDING',0,5,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('other-outbox','another-business','other-session','initial:other-session:0','other-group',0,'{}',
        'PENDING',0,5,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp());
  `)
  const localJob = await claimBotJob(client as never, 30_000, randomUUID(), include)
  assert.equal(localJob?.businessId, barber)
  const railwayJob = await claimBotJob(client as never, 30_000, randomUUID(), exclude)
  assert.equal(railwayJob?.businessId, other)
  assert.equal(await claimBotJob(client as never, 30_000, randomUUID(), exclude), null)
  const localOutbox = await claimOutbox(client as never, 30_000, randomUUID(), include)
  assert.equal(localOutbox?.businessId, barber)
  const railwayOutbox = await claimOutbox(client as never, 30_000, randomUUID(), exclude)
  assert.equal(railwayOutbox?.businessId, other)
  assert.equal(await claimOutbox(client as never, 30_000, randomUUID(), exclude), null)
  for (const mode of ['include', 'exclude'] as const) {
    const operator = mode === 'include' ? '=' : '<>'
    const jobQuery = queries.find((query) => query.text.includes('WITH candidate AS MATERIALIZED')
      && query.text.includes(`j."businessId" ${operator}`))
    assert.ok(jobQuery, `job ${mode} query exists`)
    assert.equal((jobQuery.text.match(new RegExp(`j\\."businessId" ${operator} \\$[0-9]+`, 'g')) ?? []).length, 2,
      'worker checks tenant at candidate and final UPDATE')
    const outboxUpdate = queries.find((query) => query.text.includes('UPDATE "BotOutbox" o SET')
      && query.text.includes(`o."businessId" ${operator}`))
    assert.ok(outboxUpdate, `outbox ${mode} final UPDATE checks tenant`)
  }
  await db.exec(`
    UPDATE "BotJob" SET "attempts"=5,"leasedUntil"=clock_timestamp()-interval '1 minute';
    UPDATE "BotOutbox" SET "status"='SENDING',"leasedUntil"=clock_timestamp()-interval '1 minute';
  `)
  assert.equal(await maintainBotJobs(client as never, exclude), 1)
  assert.equal(((await db.query(`SELECT "status" FROM "BotJob" WHERE "id"='barber-job'`)).rows[0] as { status: string } | undefined)?.status, 'LEASED')
  assert.equal((await maintainOutbox(client as never, exclude)).staleSending, 1)
  assert.equal(((await db.query(`SELECT "status" FROM "BotOutbox" WHERE "id"='barber-outbox'`)).rows[0] as { status: string } | undefined)?.status, 'SENDING')
  assert.equal(await maintainBotJobs(client as never, include), 1)
  assert.equal((await maintainOutbox(client as never, include)).staleSending, 1)
  console.log('bot-worker tenant SQL isolation passed')
} finally {
  await db.close()
}
