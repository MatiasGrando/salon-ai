import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { ingestNewBotEvent, type NewBotIngressEvent } from '../src/new-bot/application/ingress.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'
import { createNewBotQueueRepository } from '../src/new-bot/infrastructure/queue-repository.js'

const ingressMigration = await readFile(new URL('../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql', import.meta.url), 'utf8')
const queueMigration = await readFile(new URL('../prisma/migrations/20260928010000_new_bot_ordered_queue/migration.sql', import.meta.url), 'utf8')
const db = new PGlite()
const tenantA = { businessId: 'tenant-a', vertical: 'salon' }
const tenantB = { businessId: 'tenant-b', vertical: 'workshop' }

try {
  await db.exec("CREATE TABLE \"Business\" (\"id\" text PRIMARY KEY); INSERT INTO \"Business\" VALUES ('tenant-a'), ('tenant-b');")
  await db.exec(ingressMigration)
  await db.query(`
    INSERT INTO "NewBotInboxEvent" (
      "id", "businessId", "schemaVersion", "vertical", "provider", "providerEventId",
      "conversationId", "message", "receivedAt", "admittedAt", "processingStatus"
    ) VALUES
      ('legacy-row-1','tenant-a',1,'salon','whatsapp','legacy-first','legacy-conversation','{"kind":"text","text":"legacy-first"}'::jsonb,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','PROCESSING'),
      ('legacy-row-2','tenant-a',1,'salon','whatsapp','legacy-second','legacy-conversation','{"kind":"text","text":"legacy-second"}'::jsonb,'2026-09-01T00:00:01Z','2026-09-01T00:00:01Z','PENDING')
  `)
  await db.exec(queueMigration)
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows },
      }))
    },
  }
  const ingress = createNewBotIngressRepository(client as never)
  const queue = createNewBotQueueRepository(client as never)
  const event = (providerEventId: string, conversationId: string, text = providerEventId): NewBotIngressEvent => ({
    provider: 'whatsapp', providerEventId, conversationId, message: { kind: 'text', text },
  })
  const identity = (claim: Awaited<ReturnType<typeof queue.claimBatch>>[number]) => ({
    eventId: claim.eventId, businessId: claim.businessId, provider: claim.provider,
    conversationId: claim.conversationId, leaseToken: claim.leaseToken,
  })

  const backfill = (await db.query<{ id: string; sequence: number }>(
    'SELECT "id", "sequence" FROM "NewBotInboxEvent" WHERE "conversationId"=$1 ORDER BY "sequence"', ['legacy-conversation'],
  )).rows
  assert.deepEqual(backfill.map((row) => [row.id, row.sequence]), [['legacy-row-1', 1], ['legacy-row-2', 2]])
  const [legacyFirst] = await queue.claimBatch({ batchSize: 1, leaseDurationMs: 60_000 })
  assert.equal(legacyFirst?.message.kind === 'text' ? legacyFirst.message.text : null, 'legacy-first', 'old PROCESSING rows without a lease remain reclaimable')
  assert.equal(await queue.complete(identity(legacyFirst!)), true)
  const [legacySecond] = await queue.claimBatch({ batchSize: 1, leaseDurationMs: 60_000 })
  assert.equal(legacySecond?.message.kind === 'text' ? legacySecond.message.text : null, 'legacy-second')
  assert.equal(await queue.complete(identity(legacySecond!)), true)

  // A leased head blocks its successor. Reclaim gives a new token and stale owners cannot mutate.
  await ingestNewBotEvent(tenantA, event('lease-first', 'lease-conversation'), ingress)
  await ingestNewBotEvent(tenantA, event('lease-second', 'lease-conversation'), ingress)
  const [firstClaim] = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.equal(firstClaim?.message.kind === 'text' ? firstClaim.message.text : null, 'lease-first')
  assert.equal((await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })).length, 0, 'leased head hides successor')
  assert.equal(await queue.renew({ ...identity(firstClaim!), leaseDurationMs: 60_000 }), true)
  assert.equal(await queue.complete({ ...identity(firstClaim!), businessId: 'tenant-b' }), false, 'tenant mismatch cannot complete')
  await db.query('UPDATE "NewBotInboxEvent" SET "leaseExpiresAt"=clock_timestamp()-INTERVAL \'1 millisecond\' WHERE "id"=$1', [firstClaim!.eventId])
  assert.equal(await queue.complete(identity(firstClaim!)), false, 'expired ownership cannot complete')
  assert.equal(await queue.retry({ ...identity(firstClaim!), delayMs: 0 }), false, 'expired ownership cannot retry')
  assert.equal(await queue.renew({ ...identity(firstClaim!), leaseDurationMs: 60_000 }), false, 'expired ownership cannot renew')
  const [reclaimed] = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.equal(reclaimed?.message.kind === 'text' ? reclaimed.message.text : null, 'lease-first')
  assert.notEqual(reclaimed?.leaseToken, firstClaim?.leaseToken)
  assert.match(reclaimed?.leaseToken ?? '', /^[0-9a-f-]{36}$/i)
  assert.equal(reclaimed?.attemptCount, 2)
  assert.equal(await queue.complete(identity(firstClaim!)), false, 'stale token cannot complete after reclaim')
  assert.equal(await queue.complete(identity(reclaimed!)), true)
  const [retryHead] = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })

  assert.equal(retryHead?.message.kind === 'text' ? retryHead.message.text : null, 'lease-second')
  assert.equal(await queue.retry({ ...identity(retryHead!), delayMs: 60_000 }), true)
  assert.equal((await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })).length, 0, 'retry delay hides successor of delayed head')
  await db.query('UPDATE "NewBotInboxEvent" SET "retryAt"=clock_timestamp()-INTERVAL \'1 millisecond\' WHERE "id"=$1', [retryHead!.eventId])
  const [retryClaim] = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.equal(retryClaim?.message.kind === 'text' ? retryClaim.message.text : null, 'lease-second')
  assert.equal(await queue.complete(identity(retryClaim!)), true)

  await ingestNewBotEvent(tenantA, event('corrupt-first', 'corrupt-conversation'), ingress)
  await ingestNewBotEvent(tenantA, event('corrupt-second', 'corrupt-conversation'), ingress)
  await db.query('UPDATE "NewBotInboxEvent" SET "processingStatus"=$1 WHERE "providerEventId"=$2', ['CORRUPT', 'corrupt-first'])
  assert.equal((await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })).length, 0, 'corrupt unfinished head fails closed and does not expose successor')

  // Poison payloads/schema must block only their heads and never poison healthy partitions in one batch.
  await ingestNewBotEvent(tenantA, event('poison-json-head', 'poison-json'), ingress)
  await ingestNewBotEvent(tenantA, event('poison-json-successor', 'poison-json'), ingress)
  await ingestNewBotEvent(tenantA, event('poison-schema-head', 'poison-schema'), ingress)
  await ingestNewBotEvent(tenantA, event('poison-schema-successor', 'poison-schema'), ingress)
  await ingestNewBotEvent(tenantA, event('poison-overflow-head', 'poison-overflow'), ingress)
  await ingestNewBotEvent(tenantA, event('poison-overflow-successor', 'poison-overflow'), ingress)
  await ingestNewBotEvent(tenantA, event('healthy-head', 'healthy-conversation'), ingress)
  await ingestNewBotEvent(tenantA, event('healthy-successor', 'healthy-conversation'), ingress)
  await db.query('UPDATE "NewBotInboxEvent" SET "message"=$1::jsonb WHERE "providerEventId"=$2', ['{"kind":"text","text":""}', 'poison-json-head'])
  await db.query('UPDATE "NewBotInboxEvent" SET "schemaVersion"=$1 WHERE "providerEventId"=$2', [2, 'poison-schema-head'])
  await db.query('UPDATE "NewBotInboxEvent" SET "attemptCount"=$1 WHERE "providerEventId"=$2', [2_147_483_647, 'poison-overflow-head'])

  const mixedBatch = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.deepEqual(mixedBatch.map((claim) => claim.message.kind === 'text' ? claim.message.text : null), ['healthy-head'])
  for (const providerEventId of ['poison-json-head', 'poison-schema-head', 'poison-overflow-head']) {
    const poison = (await db.query<{ processingStatus: string; processingErrorCode: string | null; attemptCount: number; leaseToken: string | null; schemaVersion: number; message: unknown }>(
      'SELECT "processingStatus", "processingErrorCode", "attemptCount", "leaseToken", "schemaVersion", "message" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', [providerEventId],
    )).rows[0]
    assert.equal(poison?.processingStatus, 'BLOCKED')
    assert.equal(poison?.attemptCount, providerEventId === 'poison-overflow-head' ? 2_147_483_647 : 0)
    assert.equal(poison?.leaseToken, null)
    assert.ok(poison?.processingErrorCode)
    if (providerEventId === 'poison-json-head') {
      assert.equal(poison?.processingErrorCode, 'INVALID_PERSISTED_MESSAGE')
      assert.deepEqual(poison?.message, { kind: 'text', text: '' }, 'poison payload is retained for inspection')
    }
    if (providerEventId === 'poison-schema-head') {
      assert.equal(poison?.processingErrorCode, 'UNSUPPORTED_SCHEMA_VERSION')
      assert.equal(poison.schemaVersion, 2, 'unsupported schema row remains intact')
    }
    if (providerEventId === 'poison-overflow-head') assert.equal(poison?.processingErrorCode, 'ATTEMPT_LIMIT_REACHED')
    assert.doesNotMatch(poison?.processingErrorCode ?? '', /text|message body|providerEventId/i, 'block reason is a safe code, not raw data')
  }
  assert.equal((await db.query<{ processingStatus: string; processingErrorCode: string | null }>(
    'SELECT "processingStatus", "processingErrorCode" FROM "NewBotInboxEvent" WHERE "providerEventId" IN ($1,$2,$3)',
    ['poison-json-successor', 'poison-schema-successor', 'poison-overflow-successor'],
  )).rows.every((row) => row.processingStatus === 'PENDING' && row.processingErrorCode === null), true, 'poison successors stay unfinished')
  assert.equal(await queue.complete(identity(mixedBatch[0]!)), true)
  const secondHealthyClaim = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.deepEqual(secondHealthyClaim.map((claim) => claim.message.kind === 'text' ? claim.message.text : null), ['healthy-successor'])
  assert.equal(await queue.complete(identity(secondHealthyClaim[0]!)), true)
  assert.equal((await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })).length, 0, 'blocked poison heads keep their successors hidden on repeated claims')

  await ingestNewBotEvent(tenantA, event('storage-failure', 'storage-failure'), ingress)
  await db.exec(`CREATE FUNCTION fail_queue_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue storage fixture failure'; END $$;
    CREATE TRIGGER fail_queue_claim_before_update BEFORE UPDATE ON "NewBotInboxEvent" FOR EACH ROW
    WHEN (NEW."providerEventId" = 'storage-failure' AND NEW."processingStatus" = 'PROCESSING')
    EXECUTE FUNCTION fail_queue_claim();`)
  await assert.rejects(queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 }), /queue storage fixture failure/)
  let storageRow = (await db.query<{ processingStatus: string; processingErrorCode: string | null; attemptCount: number }>(
    'SELECT "processingStatus", "processingErrorCode", "attemptCount" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['storage-failure'],
  )).rows[0]
  assert.deepEqual(storageRow, { processingStatus: 'PENDING', processingErrorCode: null, attemptCount: 0 }, 'real SQL failures reject instead of marking poison')
  await db.exec('DROP TRIGGER fail_queue_claim_before_update ON "NewBotInboxEvent"; DROP FUNCTION fail_queue_claim();')
  const storageClaim = await queue.claimBatch({ batchSize: 1, leaseDurationMs: 60_000 })
  assert.equal(storageClaim[0]?.message.kind === 'text' ? storageClaim[0].message.text : null, 'storage-failure')
  assert.equal(await queue.complete(identity(storageClaim[0]!)), true)

  await ingestNewBotEvent(tenantA, event('commit-failure-claim', 'commit-failure-claim'), ingress)
  await db.exec(`CREATE TABLE "QueueCommitGate" ("id" text PRIMARY KEY);
    CREATE TABLE "QueueCommitProbe" ("eventId" text REFERENCES "QueueCommitGate"("id") DEFERRABLE INITIALLY DEFERRED);
    CREATE FUNCTION defer_queue_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO "QueueCommitProbe" ("eventId") VALUES (NEW."id"); RETURN NEW;
    END $$;
    CREATE TRIGGER defer_queue_commit_failure_after_update AFTER UPDATE OF "processingStatus" ON "NewBotInboxEvent"
    FOR EACH ROW WHEN (NEW."providerEventId" = 'commit-failure-claim' AND NEW."processingStatus" = 'PROCESSING')
    EXECUTE FUNCTION defer_queue_commit_failure();`)
  await assert.rejects(queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 }), /foreign key|commit/i)
  const afterCommitFailure = (await db.query<{ processingStatus: string; processingErrorCode: string | null; attemptCount: number; leaseToken: string | null; schemaVersion: number; message: unknown }>(
    'SELECT "processingStatus", "processingErrorCode", "attemptCount", "leaseToken", "schemaVersion", "message" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['commit-failure-claim'],
  )).rows[0]
  assert.deepEqual(afterCommitFailure, { processingStatus: 'PENDING', processingErrorCode: null, attemptCount: 0, leaseToken: null, schemaVersion: 1, message: { kind: 'text', text: 'commit-failure-claim' } }, 'deferred COMMIT failure rolls back claims without poisoning rows')
  await db.exec('DROP TRIGGER defer_queue_commit_failure_after_update ON "NewBotInboxEvent"; DROP FUNCTION defer_queue_commit_failure();')
  const recoveredCommitClaim = await queue.claimBatch({ batchSize: 1, leaseDurationMs: 60_000 })
  assert.equal(recoveredCommitClaim[0]?.message.kind === 'text' ? recoveredCommitClaim[0].message.text : null, 'commit-failure-claim')
  assert.equal(await queue.complete(identity(recoveredCommitClaim[0]!)), true)

  // One partition receives an ordered sequence; duplicates preserve the first payload.
  const committedAdmissionOrder: string[] = []
  await Promise.all(Array.from({ length: 100 }, (_, index) =>
    ingestNewBotEvent(tenantA, event(`ordered-${index}`, 'same-conversation'), ingress).then((result) => {
      assert.deepEqual(result, { status: 'accepted' })
      committedAdmissionOrder.push(`ordered-${index}`)
    }),
  ))
  assert.deepEqual(await ingestNewBotEvent(tenantA, event('ordered-10', 'same-conversation', 'replacement'), ingress), { status: 'duplicate' })
  const ordered = (await db.query<{ sequence: number; providerEventId: string; message: { text: string } }>(
    'SELECT "sequence", "providerEventId", "message" FROM "NewBotInboxEvent" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3 ORDER BY "sequence"',
    ['tenant-a', 'whatsapp', 'same-conversation'],
  )).rows
  assert.equal(ordered.length, 100)
  assert.deepEqual(ordered.map((row) => row.sequence), Array.from({ length: 100 }, (_, index) => index + 1))
  assert.deepEqual(ordered.map((row) => row.providerEventId), committedAdmissionOrder, 'per-conversation sequence follows transaction commit-resolved admission order')
  assert.equal(ordered[10]?.message.text, 'ordered-10', 'duplicate must preserve original payload')
  for (let index = 0; index < 100; index++) {
    const [claim] = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
    assert.equal(claim?.message.kind === 'text' ? claim.message.text : null, `ordered-${index}`, 'only oldest unfinished event is claimable')
    assert.equal(await queue.complete(identity(claim!)), true, 'completion releases the next partition head')
  }

  // Partition scope includes business and provider. Same provider event ID is independent across them.
  assert.deepEqual(await ingestNewBotEvent(tenantB, event('same-id', 'same-conversation'), ingress), { status: 'accepted' })
  assert.deepEqual(await ingestNewBotEvent(tenantA, { ...event('same-id', 'same-conversation'), provider: 'instagram' }, ingress), { status: 'accepted' })
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['same-id'])).rows.length, 2)
  const isolated = await queue.claimBatch({ batchSize: 10, leaseDurationMs: 60_000 })
  assert.equal(isolated.length, 2)
  for (const claim of isolated) assert.equal(await queue.complete(identity(claim)), true)

  // 100 distinct partitions drain through bounded batches without claiming two heads per partition.
  await Promise.all(Array.from({ length: 100 }, (_, index) =>
    ingestNewBotEvent(tenantA, event(`fanout-${index}`, `conversation-${index}`), ingress),
  ))
  const drained = new Set<string>()
  while (drained.size < 100) {
    const batch = await queue.claimBatch({ batchSize: 20, leaseDurationMs: 60_000 })
    assert.ok(batch.length > 0)
    assert.ok(batch.length <= 20)
    assert.equal(new Set(batch.map((claim) => claim.conversationId)).size, batch.length)
    for (const claim of batch) {
      assert.equal(drained.has(claim.eventId), false, 'each event is claimed once until completion')
      drained.add(claim.eventId)
      assert.equal(await queue.complete(identity(claim)), true)
    }
  }
  assert.equal(drained.size, 100)

  await assert.rejects(queue.claimBatch({ batchSize: 0, leaseDurationMs: 1000 }), /bounds/)
  await assert.rejects(queue.claimBatch({ batchSize: 101, leaseDurationMs: 1000 }), /bounds/)
  await assert.rejects(queue.retry({ ...identity(reclaimed!), delayMs: -1 }), /delay/)

  await db.exec('CREATE ROLE queue_untrusted NOLOGIN; GRANT SELECT, INSERT, UPDATE ON "NewBotInboxEvent" TO queue_untrusted; GRANT SELECT, INSERT, UPDATE ON "NewBotConversationCounter" TO queue_untrusted; SET ROLE queue_untrusted;')
  assert.equal((await db.query('SELECT 1 FROM "NewBotInboxEvent"')).rows.length, 0, 'untrusted role cannot read inbox rows')
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationCounter"')).rows.length, 0, 'untrusted role cannot read counters')
  await assert.rejects(db.query('INSERT INTO "NewBotConversationCounter" ("businessId","provider","conversationId","lastSequence") VALUES (\'tenant-a\',\'whatsapp\',\'rls-denied\',1)'), /row-level security/i)
  await db.exec('RESET ROLE;')

  console.log('new-bot-queue-test: OK')
} finally {
  await db.close()
}