import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import type { Prisma } from '../src/generated/prisma/client.js'
import { projectInboundMessage } from '../src/bot-options/application/process-session-job.js'
import { flushInboundConversationMessages, subscribeToCrmRealtimeEvents, type InboundConversationMessageProjection } from '../src/services/crm-realtime-events.js'

const db = new PGlite()
let statements = 0
const delivered: unknown[] = []
const unsubscribe = subscribeToCrmRealtimeEvents({ businessId: 'tenant-a', send: event => delivered.push(event) })
try {
  await db.exec(`
    CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND');
    CREATE TABLE "AllowedBody" (body text PRIMARY KEY);
    INSERT INTO "AllowedBody" VALUES ('first'),('duplicate'),('foreign'),('rollback');
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text NOT NULL,
      "lastMessage" text, "archivedAt" timestamptz, "updatedAt" timestamptz NOT NULL);
    CREATE TABLE "Message" ("id" text PRIMARY KEY, "conversationId" text NOT NULL REFERENCES "Conversation"("id"),
      "phone" text NOT NULL, "direction" "MessageDirection" NOT NULL, "body" text NOT NULL,
      "providerMessageId" text UNIQUE, "status" text NOT NULL, "metadata" jsonb NOT NULL,
      CONSTRAINT deferred_body FOREIGN KEY ("body") REFERENCES "AllowedBody"(body) DEFERRABLE INITIALLY DEFERRED);
    CREATE TABLE "Audit" (seq serial, operation text);
    CREATE FUNCTION audit_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO "Audit"(operation) VALUES (TG_TABLE_NAME); RETURN NEW; END $$;
    CREATE TRIGGER message_audit AFTER INSERT ON "Message" FOR EACH ROW EXECUTE FUNCTION audit_projection();
    CREATE TRIGGER conversation_audit AFTER UPDATE ON "Conversation" FOR EACH ROW EXECUTE FUNCTION audit_projection();
    INSERT INTO "Conversation" VALUES ('conversation-a','tenant-a','old',clock_timestamp(),clock_timestamp()),
      ('conversation-b','tenant-b','foreign-old',clock_timestamp(),clock_timestamp());
  `)
  const run = async (body: string, providerMessageId: string | null, failBody = false,
    businessId = 'tenant-a', conversationId = 'conversation-a') => {
    const pending: InboundConversationMessageProjection[] = []
    const before = statements
    const deliveredBefore = delivered.length
    await db.transaction(async pg => {
      const tx = {
        async $queryRaw(q: Prisma.Sql) { statements++; return (await pg.query(q.text, q.values)).rows },
        async $executeRaw(q: Prisma.Sql) { statements++; return (await pg.query(q.text, q.values)).affectedRows ?? 0 }
      }
      await projectInboundMessage(tx as never, { businessId, conversationId, phone: 'synthetic', body,
        providerMessageId, messageType: 'text', source: 'projection-test' }, pending)
      assert.equal(delivered.length, deliveredBefore,
        'helper never publishes before its caller commits')
      if (failBody) throw new Error('body rollback')
    })
    flushInboundConversationMessages(pending)
    assert.equal(statements - before, 1, 'production inbound projection must perform one statement, not two')
    return pending
  }
  const first = await run('first', 'first-id')
  assert.equal(first.length, 1); assert.equal(delivered.length, 1)
  const inserted = (await db.query<{ body: string; metadata: unknown }>('SELECT "body", "metadata" FROM "Message"')).rows[0]!
  assert.equal(inserted.body, 'first')
  assert.deepEqual(inserted.metadata, { provider: 'whatsapp', source: 'projection-test', messageType: 'text' })
  assert.deepEqual((await db.query<{ operation: string }>('SELECT operation FROM "Audit" ORDER BY seq')).rows.map(r => r.operation), ['Message', 'Conversation'])
  await db.exec('TRUNCATE "Audit"')
  const duplicate = await run('duplicate', 'first-id')
  assert.equal(duplicate.length, 0); assert.equal(delivered.length, 1)
  assert.deepEqual((await db.query<{ operation: string }>('SELECT operation FROM "Audit" ORDER BY seq')).rows.map(r => r.operation), ['Conversation'], 'duplicate must still update conversation')
  const conversation = () => db.query<{ lastMessage: string; archivedAt: Date | null }>('SELECT "lastMessage", "archivedAt" FROM "Conversation" WHERE "id"=\'conversation-a\'')
  assert.deepEqual((await conversation()).rows[0], { lastMessage: 'duplicate', archivedAt: null })
  await assert.rejects(run('rollback', 'rollback-id', true), /body rollback/)
  assert.equal((await conversation()).rows[0]!.lastMessage, 'duplicate'); assert.equal(delivered.length, 1)
  await assert.rejects(run('commit-fail', 'commit-id'), /deferred_body/)
  assert.equal((await conversation()).rows[0]!.lastMessage, 'duplicate'); assert.equal(delivered.length, 1)
  assert.deepEqual((await db.query<{ providerMessageId: string }>('SELECT "providerMessageId" FROM "Message" ORDER BY "providerMessageId"')).rows, [{ providerMessageId: 'first-id' }])
  // Existing tenant predicate on Conversation must not be widened by batching.
  await run('foreign', 'first-id', false, 'tenant-a', 'conversation-b')
  assert.equal((await db.query<{ lastMessage: string }>('SELECT "lastMessage" FROM "Conversation" WHERE "id"=\'conversation-b\'')).rows[0]!.lastMessage, 'foreign-old')
  assert.equal(delivered.length, 1)
  await run('first', null)
  await run('first', null)
  assert.equal(delivered.length, 3, 'null provider IDs remain independent messages')
  console.log('OK inbound projection: one production SQL, duplicate/update order, tenant, rollback and deferred COMMIT failure.')
} finally { unsubscribe(); await db.close() }
