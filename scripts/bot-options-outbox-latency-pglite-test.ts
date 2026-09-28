/** Disposable in-memory PostgreSQL/WASM coverage for the production outbox claim SQL. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'

process.env.WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES = 'WX-38N6UG'
const { claimOutbox, sendClaimedOutbox } = await import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js')
const { whatsappConfig } = await import('../src/config/whatsapp.js')
const db = new PGlite()
const businessId = 'business-integration'
const foreignBusinessId = 'business-foreign'
const deploymentId = 'deployment-integration'
const foreignDeploymentId = 'deployment-foreign'
const diagnosticCode = 'WX-38N6UG'
const foreignCode = 'WX-38N6UH'
const admittedAt = new Date('2026-09-27T10:00:00.000Z')

try {
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','CLAIMED','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ','RETRY','FAILED','POISON','SKIPPED');
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotDispatchKind" AS ENUM ('PROCESS','SEND');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','DONE','UNKNOWN');
    CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND');
    CREATE TABLE "Business" ("id" text PRIMARY KEY, "customerCode" text NOT NULL);
    CREATE TABLE "BotChannelDeployment" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "channel" "BotChannel" NOT NULL,
      "generation" int NOT NULL, "activeConfigurationId" text, "engineKey" text NOT NULL,
      "legacyDispatchCoverageVersion" int NOT NULL, "claimsPausedAt" timestamptz,
      "dispatchFenceEpoch" int NOT NULL DEFAULT 0
    );
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text NOT NULL,
      "lastMessage" text, "archivedAt" timestamptz, "updatedAt" timestamptz DEFAULT clock_timestamp());
    CREATE TABLE "BotSession" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "conversationId" text NOT NULL,
      "deploymentId" text NOT NULL, "deploymentGeneration" int NOT NULL,
      "status" "BotSessionStatus" NOT NULL, "handoffClaimsPausedAt" timestamptz,
      "handoffFenceEpoch" int NOT NULL DEFAULT 0
    );
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "admittedAt" timestamptz NOT NULL);
    CREATE TABLE "BotTransitionLog" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "sessionId" text NOT NULL,
      "revisionTo" bigint NOT NULL, "providerEventId" text NOT NULL
    );
    CREATE TABLE "BotOutbox" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "sessionId" text NOT NULL,
      "transitionId" text NOT NULL, "deliveryGroupId" text NOT NULL, "sequence" int NOT NULL,
      "kind" text NOT NULL, "payload" jsonb NOT NULL, "idempotencyKey" text NOT NULL,
      "status" "BotOutboxStatus" NOT NULL, "attempts" int NOT NULL DEFAULT 0,
      "maxAttempts" int NOT NULL DEFAULT 5, "leaseToken" text, "leasedUntil" timestamptz,
      "availableAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "dependsOnSequence" int,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "sentAt" timestamptz, "providerMessageId" text, "errorCode" text
    );
    CREATE TABLE "BotDispatchClaim" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "channel" "BotChannel" NOT NULL,
      "sessionId" text, "resourceId" text, "engineKey" text NOT NULL, "generation" int NOT NULL,
      "fenceEpoch" int NOT NULL, "handoffFenceEpoch" int, "kind" "BotDispatchKind" NOT NULL,
      "status" "BotDispatchStatus" NOT NULL, "claimToken" text NOT NULL UNIQUE,
      "claimedUntil" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
      "providerMessageId" text
    );
    CREATE TABLE "Message" (
      "id" text PRIMARY KEY, "conversationId" text NOT NULL, "phone" text NOT NULL,
      "direction" "MessageDirection" NOT NULL, "body" text NOT NULL, "providerMessageId" text,
      "status" text NOT NULL, "providerErrorCode" text, "metadata" jsonb NOT NULL
    );
    INSERT INTO "Business" VALUES ('business-integration','WX-38N6UG'),('business-foreign','WX-38N6UH');
    INSERT INTO "BotChannelDeployment" VALUES
      ('deployment-integration','business-integration','WHATSAPP',0,'config-a','deterministic-options',1,NULL,0),
      ('deployment-foreign','business-foreign','WHATSAPP',0,'config-b','deterministic-options',1,NULL,0);
    INSERT INTO "Conversation" ("id","businessId") VALUES ('conversation-a','business-integration'),('conversation-b','business-foreign');
    INSERT INTO "BotSession" VALUES
      ('session-a','business-integration','conversation-a','deployment-integration',0,'ACTIVE',NULL,0),
      ('session-b','business-foreign','conversation-b','deployment-foreign',0,'ACTIVE',NULL,0);
  `)

  const prismaRows = (rows: Array<Record<string, unknown>>) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, /Count$/.test(key) && (typeof value === 'string' || typeof value === 'number') ? BigInt(value) : value])
  ))
  const client = {
    async $queryRaw(query: Prisma.Sql) { return prismaRows((await db.query(query.text, query.values)).rows as Array<Record<string, unknown>>) },
    async $executeRaw(query: Prisma.Sql) { return (await db.query(query.text, query.values)).affectedRows ?? 0 },
    async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) { return prismaRows((await pg.query(query.text, query.values)).rows as Array<Record<string, unknown>>) },
        async $executeRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).affectedRows ?? 0 }
      }))
    }
  }
  const insert = async (sql: Prisma.Sql) => { await db.query(sql.text, sql.values) }
  const addOutbox = async (id: string, transitionId: string, order: number) => {
    await insert(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","availableAt","createdAt")
      VALUES (${id},${businessId},'session-a',${transitionId},${`group-${id}`},0,'text',${JSON.stringify({ to: 'synthetic-recipient', item: { type: 'text', body: 'synthetic test content' } })}::jsonb,${`key-${id}`},'PENDING'::"BotOutboxStatus",clock_timestamp()-interval '1 second',clock_timestamp()+(${order} * interval '1 millisecond'))`)
  }
  const addEvent = async (id: string, ownerBusinessId: string, at = admittedAt) => {
    await insert(Prisma.sql`INSERT INTO "BotProviderEvent" VALUES (${id},${ownerBusinessId},${at})`)
  }
  const addTransition = async (id: string, ownerBusinessId: string, ownerSessionId: string, revision: bigint, providerEventId: string) => {
    await insert(Prisma.sql`INSERT INTO "BotTransitionLog" VALUES (${id},${ownerBusinessId},${ownerSessionId},${revision},${providerEventId})`)
  }

  await addEvent('event-normal','business-integration')
  await addEvent('event-initial','business-integration',new Date('2026-09-27T10:00:01.000Z'))
  await addEvent('event-cross-tenant','business-foreign')
  await addEvent('event-malformed','business-integration')
  await addTransition('transition-normal','business-integration','session-a',11n,'event-normal')
  await addTransition('transition-initial','business-integration','session-a',0n,'event-initial')
  await addTransition('transition-cross-tenant','business-integration','session-a',13n,'event-cross-tenant')
  await addTransition('transition-unlinked','business-integration','session-a',14n,'event-missing')
  await addTransition('transition-malformed','business-integration','session-a',15n,'event-malformed')
  await addOutbox('outbox-normal','transition:session-a:11',1)
  await addOutbox('outbox-initial','initial:session-a:0',2)
  await addOutbox('outbox-cross-tenant','transition:session-a:13',3)
  await addOutbox('outbox-unlinked','transition:session-a:14',4)
  await addOutbox('outbox-malformed','transition:session-a:15:extra',5)

  const claimed = async (expectedId: string) => {
    const item = await claimOutbox(client as never, 30_000, `claim-${expectedId}`, { businessId })
    assert.equal(item?.id, expectedId)
    return item!
  }
  whatsappConfig.latencyDiagnosticBusinessCodes.clear()
  whatsappConfig.latencyDiagnosticBusinessCodes.add(diagnosticCode)

  const normal = await claimed('outbox-normal')
  assert.equal(normal.diagnosticCustomerCode, diagnosticCode)
  assert.equal(normal.sourceProviderEventId, 'event-normal')
  assert.equal(normal.sourceProviderEventAdmittedAt?.toISOString(), admittedAt.toISOString())
  const initial = await claimed('outbox-initial')
  assert.equal(initial.sourceProviderEventId, 'event-initial', 'initial transitions must link through their joined event')
  const crossTenant = await claimed('outbox-cross-tenant')
  assert.equal(crossTenant.sourceProviderEventId, null, 'foreign-business event rows cannot be returned as linked')
  assert.equal(crossTenant.sourceProviderEventAdmittedAt, null)
  const unlinked = await claimed('outbox-unlinked')
  assert.equal(unlinked.sourceProviderEventId, null, 'missing event row reports unavailable correlation')
  const malformed = await claimed('outbox-malformed')
  assert.equal(malformed.sourceProviderEventId, null, 'malformed transition IDs do not reach the ledger join')

  await addOutbox('outbox-allowlist-off','transition:session-a:11',10)
  whatsappConfig.latencyDiagnosticBusinessCodes.clear()
  const off = await claimed('outbox-allowlist-off')
  assert.equal(off.diagnosticCustomerCode, null)
  assert.equal(off.sourceProviderEventId, null)
  assert.equal(off.sourceProviderEventAdmittedAt, null)

  await addOutbox('outbox-sent-at','transition:session-a:11',11)
  whatsappConfig.latencyDiagnosticBusinessCodes.add(diagnosticCode)
  const acceptanceItem = await claimed('outbox-sent-at')
  const diagnostics: Array<{ phase: string; durationMs: number | null; outcome: string; sourceProviderEventId: string | null }> = []
  const sendResult = await sendClaimedOutbox({
    client: client as never,
    item: acceptanceItem,
    provider: { async send() { return { kind: 'accepted', providerMessageId: 'synthetic-meta-acceptance' } } },
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic) }
  })
  assert.equal(sendResult, 'ACCEPTED')
  const sentAt = (await db.query<{ sentAt: Date }>(`SELECT "sentAt" FROM "BotOutbox" WHERE "id"='outbox-sent-at'`)).rows[0]!.sentAt
  const acceptance = diagnostics.find((diagnostic) => diagnostic.phase === 'admission_to_meta_acceptance')!
  assert.equal(acceptance.outcome, 'accepted')
  assert.equal(acceptance.sourceProviderEventId, 'event-normal')
  assert.equal(acceptance.durationMs, sentAt.getTime() - admittedAt.getTime(), 'latency uses the sentAt returned by acceptance SQL')

  console.log('bot-options-outbox-latency-pglite-test: OK')
} finally {
  await db.close()
}