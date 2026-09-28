import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { ingestNewBotEvent, type NewBotIngressEvent } from '../src/new-bot/application/ingress.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'

const migration = await readFile(new URL('../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql', import.meta.url), 'utf8')
const queueMigration = await readFile(new URL('../prisma/migrations/20260928010000_new_bot_ordered_queue/migration.sql', import.meta.url), 'utf8')
const db = new PGlite()
const tenantA = { businessId: 'tenant-a', vertical: 'salon' }
const tenantB = { businessId: 'tenant-b', vertical: 'workshop' }

try {
  await db.exec('CREATE TABLE "Business" ("id" text PRIMARY KEY); INSERT INTO "Business" VALUES (\'tenant-a\'), (\'tenant-b\');')
  await db.exec(migration)
  await db.exec(queueMigration)

  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) {
          return (await pg.query(query.text, query.values)).rows
        },
      }))
    },
  }
  const repository = createNewBotIngressRepository(client as never)
  const event = (providerEventId: string, text = 'hello'): NewBotIngressEvent => ({
    provider: 'whatsapp',
    providerEventId,
    conversationId: 'conversation-1',
    message: { kind: 'text', text },
  })

  assert.deepEqual(await ingestNewBotEvent(tenantA, event('event-1'), repository), { status: 'accepted' })
  assert.deepEqual(await ingestNewBotEvent(tenantA, event('event-1', 'replacement'), repository), { status: 'duplicate' })
  const first = (await db.query<{ businessId: string; schemaVersion: number; vertical: string; receivedAt: Date; admittedAt: Date; message: { text: string }; processingStatus: string }>(
    'SELECT "businessId", "schemaVersion", "vertical", "receivedAt", "admittedAt", "message", "processingStatus" FROM "NewBotInboxEvent" WHERE "businessId"=$1', ['tenant-a'],
  )).rows[0]
  assert.equal(first?.businessId, 'tenant-a')
  assert.equal(first?.schemaVersion, 1)
  assert.equal(first?.vertical, 'salon')
  assert.ok(first?.receivedAt instanceof Date)
  assert.ok(first?.admittedAt instanceof Date)
  assert.equal(first?.message.text, 'hello', 'duplicate delivery must preserve the first normalized payload')
  assert.equal(first?.processingStatus, 'PENDING')

  await db.exec('CREATE ROLE ingress_untrusted NOLOGIN; GRANT SELECT, INSERT ON "NewBotInboxEvent" TO ingress_untrusted; SET ROLE ingress_untrusted;')
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent"')).rows.length, 0, 'untrusted role must not read inbox rows')
  await assert.rejects(db.query(`INSERT INTO "NewBotInboxEvent" ("id","businessId","schemaVersion","vertical","provider","providerEventId","conversationId","message","receivedAt")
    VALUES ('rls-denied','tenant-a',1,'salon','whatsapp','rls-denied','conversation-rls','{"kind":"text","text":"no"}'::jsonb,clock_timestamp())`), /row-level security/i)
  await db.exec('RESET ROLE;')

  const parallel = await Promise.all(Array.from({ length: 8 }, () => ingestNewBotEvent(tenantA, event('parallel'), repository)))
  assert.equal(parallel.filter((result) => result.status === 'accepted').length, 1)
  assert.equal(parallel.filter((result) => result.status === 'duplicate').length, 7)
  assert.deepEqual(await ingestNewBotEvent(tenantB, event('event-1'), repository), { status: 'accepted' })
  assert.deepEqual(await ingestNewBotEvent(tenantA, {
    provider: 'whatsapp', providerEventId: 'selection', conversationId: 'conversation-1',
    message: { kind: 'selection', selectionId: 'service:cut' },
  }, repository), { status: 'accepted' })
  assert.deepEqual(await ingestNewBotEvent(tenantA, {
    provider: 'instagram', providerEventId: 'unsupported', conversationId: 'conversation-2',
    message: { kind: 'unsupported' },
  }, repository), { status: 'accepted' })
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['event-1'])).rows.length, 2)

  let getterCalls = 0
  const accessorMessage = Object.defineProperty({ kind: 'text' }, 'text', { get() { getterCalls++; return 'unsafe' } })
  assert.deepEqual(await ingestNewBotEvent(tenantA, { ...event('accessor'), message: accessorMessage as never }, repository), { status: 'rejected', reason: 'invalid-message' })
  assert.equal(getterCalls, 0, 'validation must not execute message accessors')
  const accessorTenant = Object.defineProperties({}, {
    businessId: { value: 'tenant-a', enumerable: true },
    vertical: { value: 'salon', enumerable: true },
    forged: { get() { getterCalls++; return true }, enumerable: true },
  })
  assert.deepEqual(await ingestNewBotEvent(accessorTenant as never, event('forged-context'), repository), { status: 'rejected', reason: 'invalid-trusted-context' })
  assert.equal(getterCalls, 0, 'validation must not execute trusted-context accessors')
  assert.deepEqual(await ingestNewBotEvent(tenantA, { ...event('payload-tenant'), businessId: 'tenant-b' } as never, repository), { status: 'rejected', reason: 'invalid-event' })

  const beforeInsertRollback = (await db.query<{ lastSequence: number }>('SELECT "lastSequence" FROM "NewBotConversationCounter" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3', ['tenant-a', 'whatsapp', 'conversation-1'])).rows[0]?.lastSequence
  await db.exec(`CREATE FUNCTION fail_ingress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture insert failure'; END $$;
    CREATE TRIGGER fail_ingress_before_insert BEFORE INSERT ON "NewBotInboxEvent" FOR EACH ROW EXECUTE FUNCTION fail_ingress();`)
  await assert.rejects(ingestNewBotEvent(tenantA, event('rollback'), repository), /fixture insert failure/)
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['rollback'])).rows.length, 0)
  assert.equal((await db.query<{ lastSequence: number }>('SELECT "lastSequence" FROM "NewBotConversationCounter" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3', ['tenant-a', 'whatsapp', 'conversation-1'])).rows[0]?.lastSequence, beforeInsertRollback, 'failed inbox insert rolls back its sequence increment')
  await db.exec('DROP TRIGGER fail_ingress_before_insert ON "NewBotInboxEvent"; DROP FUNCTION fail_ingress();')

  await db.exec('CREATE TABLE "IngressCommitGate" ("id" text PRIMARY KEY)')
  await db.exec('INSERT INTO "IngressCommitGate" SELECT DISTINCT "providerEventId" FROM "NewBotInboxEvent"')
  await db.exec('ALTER TABLE "NewBotInboxEvent" ADD CONSTRAINT "ingress_commit_gate_fkey" FOREIGN KEY ("providerEventId") REFERENCES "IngressCommitGate"("id") DEFERRABLE INITIALLY DEFERRED')
  let transactionResult: unknown
  let transactionCallbackReturned = false
  const deferredCommitClient = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => {
        transactionResult = await operation({
          async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows },
        })
        transactionCallbackReturned = true
        return transactionResult as T
      })
    },
  }
  const beforeCommitFailure = (await db.query<{ lastSequence: number }>('SELECT "lastSequence" FROM "NewBotConversationCounter" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3', ['tenant-a', 'whatsapp', 'conversation-1'])).rows[0]?.lastSequence
  const commitOutcome = await ingestNewBotEvent(tenantA, event('commit-failure'), createNewBotIngressRepository(deferredCommitClient as never)).then(
    (result) => ({ status: 'resolved' as const, result }),
    (error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }),
  )
  assert.equal(transactionCallbackReturned, true, 'the deferred constraint must fail after the transaction callback returns')
  assert.equal(transactionResult, 'accepted', 'the insert statement should succeed before deferred constraint validation')
  assert.equal(commitOutcome.status, 'rejected', 'a COMMIT failure must not resolve with ACK-eligible success')
  assert.match(commitOutcome.status === 'rejected' ? commitOutcome.message : '', /foreign key|commit/i)
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['commit-failure'])).rows.length, 0)
  assert.equal((await db.query<{ lastSequence: number }>('SELECT "lastSequence" FROM "NewBotConversationCounter" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3', ['tenant-a', 'whatsapp', 'conversation-1'])).rows[0]?.lastSequence, beforeCommitFailure, 'failed COMMIT rolls back its sequence increment')

  console.log('new-bot-ingress-test: OK')
} finally {
  await db.close()
}