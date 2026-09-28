import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { ingestNewBotEvent } from '../src/new-bot/application/ingress.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'
import { createNewBotQueueRepository, type NewBotQueueClaim } from '../src/new-bot/infrastructure/queue-repository.js'
import { createNewBotCommitter, createNewBotSessionReader, type NewBotPreparedResult } from '../src/new-bot/infrastructure/commit-repository.js'

const migrations = await Promise.all([
  readFile(new URL('../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260928010000_new_bot_ordered_queue/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260929010000_new_bot_atomic_commit/migration.sql', import.meta.url), 'utf8'),
])
const db = new PGlite()
const tenant = { businessId: 'tenant-a', vertical: 'salon' }
const otherTenant = { businessId: 'tenant-b', vertical: 'workshop' }

try {
  await db.exec(`CREATE TABLE "Business" ("id" text PRIMARY KEY); INSERT INTO "Business" VALUES ('tenant-a'), ('tenant-b');`)
  for (const migration of migrations) await db.exec(migration)
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows },
      }))
    },
  }
  const ingress = createNewBotIngressRepository(client as never)
  const queue = createNewBotQueueRepository(client as never)
  const commit = createNewBotCommitter(client as never)
  const readSession = createNewBotSessionReader(client as never)
  const admit = async (providerEventId: string, conversationId: string, provider: 'whatsapp' | 'instagram' = 'whatsapp') => {
    await ingestNewBotEvent({ ...tenant, vertical: provider === 'whatsapp' ? 'salon' : 'workshop' }, {
      provider, providerEventId, conversationId, message: { kind: 'text', text: providerEventId },
    }, ingress)
    const id = (await db.query<{ id: string }>(
      'SELECT "id" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1 AND "provider"=$2', [providerEventId, provider],
    )).rows[0]!.id
    const claims = await queue.claimBatch({ batchSize: 100, leaseDurationMs: 60_000 })
    const claim = claims.find((candidate) => candidate.eventId === id)
    assert.ok(claim, `expected claim for ${providerEventId}`)
    return claim
  }
  const prepared = (claim: NewBotQueueClaim, expectedRevision = 0, nextState: unknown = { step: 'service' }, texts: string[] = ['reply']) => ({
    event: {
      schemaVersion: 1 as const, businessId: claim.businessId, provider: claim.provider,
      conversationId: claim.conversationId, vertical: claim.vertical,
      expectedRevision, type: 'inbound-message', payload: claim.message,
    },
    transition: { nextState, effects: [] },
    actions: texts.map((text) => ({ type: 'text' as const, text })),
  }) as NewBotPreparedResult
  const rows = async (table: string, eventId: string) => {
    const eventColumn = table === 'NewBotConversationSession' ? 'lastInboxEventId' : 'eventId'
    return (await db.query<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE "${eventColumn}"=$1`, [eventId])).rows
  }
  const signal = () => new AbortController().signal

  // Unsupported transition effects must not be discarded when the inbox is completed.
  const effectOnly = await admit('unmapped-effect-only', 'unmapped-effect-only-conversation')
  const effectOnlyResult = {
    ...prepared(effectOnly, 0, { step: 'must-not-commit' }, []),
    transition: { nextState: { step: 'must-not-commit' }, effects: [{ type: 'request-human-handoff', payload: { reason: 'needs review' } }] },
  } as NewBotPreparedResult
  const effectOnlyBefore = (await db.query(
    'SELECT "processingStatus", "attemptCount", "leaseToken", "leaseExpiresAt", "completedAt" FROM "NewBotInboxEvent" WHERE "id"=$1', [effectOnly.eventId],
  )).rows[0]
  assert.equal(await commit(effectOnly, effectOnlyResult, signal()), false,
    'non-empty effects without an implemented typed mapping must reject before writes')
  assert.deepEqual((await db.query(
    'SELECT "processingStatus", "attemptCount", "leaseToken", "leaseExpiresAt", "completedAt" FROM "NewBotInboxEvent" WHERE "id"=$1', [effectOnly.eventId],
  )).rows[0], effectOnlyBefore, 'effect rejection must preserve the leased inbox row exactly')
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [effectOnly.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', effectOnly.eventId)).length, 0)

  const effectWithAction = await admit('unmapped-effect-with-action', 'unmapped-effect-with-action-conversation')
  const effectAndActionResult = {
    ...prepared(effectWithAction, 0, { step: 'must-not-commit' }, ['separate action is not a mapping']),
    transition: { nextState: { step: 'must-not-commit' }, effects: [{ type: 'request-human-handoff', payload: { reason: 'needs review' } }] },
  } as NewBotPreparedResult
  assert.equal(await commit(effectWithAction, effectAndActionResult, signal()), false,
    'a separate outbound action does not implicitly map a transition effect')
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [effectWithAction.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', effectWithAction.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string }>(
    'SELECT "processingStatus" FROM "NewBotInboxEvent" WHERE "id"=$1', [effectWithAction.eventId],
  )).rows[0]?.processingStatus, 'PROCESSING')
  // One transaction writes a revisioned session, ordered text outbox rows, and inbox completion.
  const first = await admit('atomic-first', 'atomic-conversation')
  const result = prepared(first, 0, { step: 'date' }, ['Choose a service', 'Then choose a date'])
  assert.equal(await commit(first, result, signal()), true)
  const inbox = (await db.query<{ processingStatus: string; leaseToken: string | null; completedAt: Date | null }>(
    'SELECT "processingStatus", "leaseToken", "completedAt" FROM "NewBotInboxEvent" WHERE "id"=$1', [first.eventId],
  )).rows[0]
  assert.equal(inbox?.processingStatus, 'COMPLETED')
  assert.equal(inbox?.leaseToken, null)
  assert.ok(inbox?.completedAt)
  const session = (await db.query<{ provider: string; revision: bigint; vertical: string; state: unknown; lastInboxEventId: string }>(
    'SELECT "provider", "revision", "vertical", "state", "lastInboxEventId" FROM "NewBotConversationSession" WHERE "conversationId"=$1', [first.conversationId],
  )).rows[0]
  assert.deepEqual(session, { provider: 'whatsapp', revision: 1, vertical: 'salon', state: { step: 'date' }, lastInboxEventId: first.eventId })
  const firstOutbox = (await db.query<{ id: string; ordinal: number; sequence: bigint; recipientKey: string; action: unknown; processingStatus: string; providerAcceptedAt: unknown; deliveredAt: unknown }>(
    'SELECT "id", "ordinal", "sequence", "recipientKey", "action", "processingStatus", "providerAcceptedAt", "deliveredAt" FROM "NewBotOutboxEvent" WHERE "eventId"=$1 ORDER BY "ordinal"', [first.eventId],
  )).rows
  assert.deepEqual(firstOutbox.map((item) => [item.ordinal, item.action]), [
    [0, { type: 'text', text: 'Choose a service' }], [1, { type: 'text', text: 'Then choose a date' }],
  ])
  assert.equal(firstOutbox.every((item) => item.recipientKey === first.conversationId), true)
  assert.equal(new Set(firstOutbox.map((item) => item.id)).size, 2)
  assert.equal(firstOutbox.every((item) => item.processingStatus === 'PENDING' && item.providerAcceptedAt === null && item.deliveredAt === null), true,
    'provider acceptance and delivery remain separate sender-owned states')
  assert.equal(await commit(first, result, signal()), false, 'replay after successful commit cannot duplicate outbox rows')
  assert.equal((await rows('NewBotOutboxEvent', first.eventId)).length, 2)
  assert.deepEqual(await readSession({ businessId: tenant.businessId, provider: 'whatsapp', conversationId: first.conversationId, vertical: 'salon' }), {
    schemaVersion: 1, businessId: tenant.businessId, provider: 'whatsapp', conversationId: first.conversationId,
    vertical: 'salon', revision: 1, state: { step: 'date' },
  })
  assert.equal(await readSession({ businessId: tenant.businessId, provider: 'instagram', conversationId: first.conversationId, vertical: 'salon' }), null,
    'session reads require the exact provider partition')
  assert.equal(await readSession({ businessId: tenant.businessId, provider: 'whatsapp', conversationId: first.conversationId, vertical: 'workshop' }), null,
    'session reads require the exact immutable vertical')
  await assert.rejects(readSession({ businessId: tenant.businessId, provider: 'whatsapp', conversationId: first.conversationId, vertical: 'salon', businessId2: 'tenant-b' } as never), /partition/)

  // Same provider conversation ID remains separate across provider and tenant boundaries.
  const whatsapp = await admit('provider-whatsapp', 'shared-conversation', 'whatsapp')
  const instagram = await admit('provider-instagram', 'shared-conversation', 'instagram')
  assert.equal(await commit(whatsapp, prepared(whatsapp, 0, { step: 'whatsapp' }, []), signal()), true, 'zero actions are a valid state-only commit')
  assert.equal(await commit(instagram, prepared(instagram, 0, { step: 'instagram' }, ['Different provider']), signal()), true)
  const isolatedSessions = (await db.query<{ provider: string; vertical: string; state: unknown }>(
    'SELECT "provider", "vertical", "state" FROM "NewBotConversationSession" WHERE "conversationId"=$1 ORDER BY "provider"', ['shared-conversation'],
  )).rows
  assert.deepEqual(isolatedSessions, [
    { provider: 'instagram', vertical: 'workshop', state: { step: 'instagram' } },
    { provider: 'whatsapp', vertical: 'salon', state: { step: 'whatsapp' } },
  ])

  // Identity and prepared data are never allowed to redirect a trusted target or write snapshot.
  const forged = await admit('forged-claim', 'forged-conversation')
  assert.equal(await commit({ ...forged, businessId: otherTenant.businessId } as NewBotQueueClaim, prepared(forged), signal()), false)
  assert.equal(await commit({ ...forged, vertical: 'workshop' }, prepared(forged), signal()), false)
  for (const identityChange of [{ businessId: otherTenant.businessId }, { provider: 'instagram' }, { conversationId: 'other-conversation' }, { vertical: 'workshop' }]) {
    assert.equal(await commit(forged, { ...prepared(forged), event: { ...prepared(forged).event, ...identityChange } } as NewBotPreparedResult, signal()), false)
  }
  await assert.rejects(commit(forged, { ...prepared(forged), snapshot: { businessId: otherTenant.businessId } } as never, signal()), /prepared result/)
  await assert.rejects(commit(forged, { ...prepared(forged), recipientKey: 'forged-recipient' } as never, signal()), /prepared result/)
  await assert.rejects(commit(forged, { ...prepared(forged), actions: [{ type: 'execute', command: 'send' }] } as never, signal()), /prepared result/)
  await assert.rejects(commit(forged, { ...prepared(forged), actions: Array.from({ length: 11 }, () => ({ type: 'text', text: 'too many' })) } as never, signal()), /prepared result/)
  await assert.rejects(commit(forged, { ...prepared(forged), actions: [{ type: 'text', text: 'x'.repeat(4097) }] } as never, signal()), /prepared result/)
  assert.equal((await rows('NewBotConversationSession', forged.eventId)).length, 0)
  assert.equal((await rows('NewBotOutboxEvent', forged.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string }>('SELECT "processingStatus" FROM "NewBotInboxEvent" WHERE "id"=$1', [forged.eventId])).rows[0]?.processingStatus, 'PROCESSING')

  // Compare-and-swap rejects a stale expected revision without partial writes or inbox completion.
  const staleFirst = await admit('stale-first', 'stale-conversation')
  assert.equal(await commit(staleFirst, prepared(staleFirst, 0, { step: 'one' }), signal()), true)
  const staleSecond = await admit('stale-second', 'stale-conversation')
  assert.equal(await commit(staleSecond, prepared(staleSecond, 0, { step: 'wrong' }), signal()), false)
  assert.equal((await rows('NewBotOutboxEvent', staleSecond.eventId)).length, 0)
  assert.equal((await db.query<{ revision: bigint; state: unknown }>('SELECT "revision", "state" FROM "NewBotConversationSession" WHERE "conversationId"=$1', ['stale-conversation'])).rows[0]?.revision, 1)
  assert.equal((await db.query<{ processingStatus: string }>('SELECT "processingStatus" FROM "NewBotInboxEvent" WHERE "id"=$1', [staleSecond.eventId])).rows[0]?.processingStatus, 'PROCESSING')
  assert.equal(await commit(staleSecond, prepared(staleSecond, 1, { step: 'two' }), signal()), true)
  const orderedOutbox = (await db.query<{ sequence: bigint; ordinal: number; action: { text: string } }>(
    'SELECT "sequence", "ordinal", "action" FROM "NewBotOutboxEvent" WHERE "conversationId"=$1 ORDER BY "sequence", "ordinal"', ['stale-conversation'],
  )).rows
  assert.deepEqual(orderedOutbox.map((row) => [row.sequence, row.ordinal, row.action.text]), [[1, 0, 'reply'], [2, 0, 'reply']])

  // Lease is checked from DB time after row locking; an expired claim cannot write any entity.
  const expired = await admit('expired-lease', 'expired-conversation')
  await db.query('UPDATE "NewBotInboxEvent" SET "leaseExpiresAt"=clock_timestamp()-INTERVAL \'1 millisecond\' WHERE "id"=$1', [expired.eventId])
  assert.equal(await commit(expired, prepared(expired), signal()), false)
  assert.equal((await rows('NewBotConversationSession', expired.eventId)).length, 0)
  assert.equal((await rows('NewBotOutboxEvent', expired.eventId)).length, 0)

  // Database failures during an outbox write roll back the prior session mutation and preserve the lease.
  const sqlFailure = await admit('outbox-failure', 'outbox-failure-conversation')
  await db.exec(`CREATE FUNCTION fail_new_bot_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox fixture failure'; END $$;
    CREATE TRIGGER fail_new_bot_outbox_before_insert BEFORE INSERT ON "NewBotOutboxEvent" FOR EACH ROW EXECUTE FUNCTION fail_new_bot_outbox();`)
  await assert.rejects(commit(sqlFailure, prepared(sqlFailure), signal()), /outbox fixture failure/)
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [sqlFailure.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', sqlFailure.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string; leaseToken: string }>('SELECT "processingStatus", "leaseToken" FROM "NewBotInboxEvent" WHERE "id"=$1', [sqlFailure.eventId])).rows[0]?.processingStatus, 'PROCESSING')
  await db.exec('DROP TRIGGER fail_new_bot_outbox_before_insert ON "NewBotOutboxEvent"; DROP FUNCTION fail_new_bot_outbox();')

  // Existing-session UPDATE failures cannot leave a changed revision or a completed inbox.
  const updateSeed = await admit('session-update-seed', 'session-update-conversation')
  assert.equal(await commit(updateSeed, prepared(updateSeed, 0, { step: 'seed' }, []), signal()), true)
  const updateFailure = await admit('session-update-failure', 'session-update-conversation')
  await db.exec(`CREATE FUNCTION fail_new_bot_session_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'session update fixture failure'; END $$;
    CREATE TRIGGER fail_new_bot_session_update_before_update BEFORE UPDATE ON "NewBotConversationSession"
      FOR EACH ROW WHEN (OLD."conversationId" = 'session-update-conversation') EXECUTE FUNCTION fail_new_bot_session_update();`)
  await assert.rejects(commit(updateFailure, prepared(updateFailure, 1, { step: 'must-rollback' }), signal()), /session update fixture failure/)
  assert.deepEqual((await db.query<{ revision: number; state: unknown }>(
    'SELECT "revision", "state" FROM "NewBotConversationSession" WHERE "conversationId"=$1', ['session-update-conversation'],
  )).rows[0], { revision: 1, state: { step: 'seed' } })
  assert.equal((await rows('NewBotOutboxEvent', updateFailure.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string }>(
    'SELECT "processingStatus" FROM "NewBotInboxEvent" WHERE "id"=$1', [updateFailure.eventId],
  )).rows[0]?.processingStatus, 'PROCESSING')
  await db.exec('DROP TRIGGER fail_new_bot_session_update_before_update ON "NewBotConversationSession"; DROP FUNCTION fail_new_bot_session_update();')

  // Lease expiry while waiting after the inbox lock is checked with fresh database time.
  const waitExpired = await admit('wait-expired-lease', 'wait-expired-conversation')
  await db.query('UPDATE "NewBotInboxEvent" SET "leaseExpiresAt"=clock_timestamp()+INTERVAL \'30 milliseconds\' WHERE "id"=$1', [waitExpired.eventId])
  const delayedClockClient = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) {
          if (query.text.includes('SELECT clock_timestamp()')) await new Promise((resolve) => setTimeout(resolve, 60))
          return (await pg.query(query.text, query.values)).rows
        },
      }))
    },
  }
  assert.equal(await createNewBotCommitter(delayedClockClient as never)(waitExpired, prepared(waitExpired), signal()), false)
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [waitExpired.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', waitExpired.eventId)).length, 0)
  // Deferred COMMIT failure is propagated and rolls back all three entities.
  const commitFailure = await admit('deferred-commit-failure', 'deferred-commit-conversation')
  await db.exec(`CREATE TABLE "CommitGate" ("id" text PRIMARY KEY);
    CREATE TABLE "CommitProbe" ("eventId" text REFERENCES "CommitGate"("id") DEFERRABLE INITIALLY DEFERRED);
    CREATE FUNCTION fail_new_bot_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO "CommitProbe" ("eventId") VALUES ('missing-commit-gate'); RETURN NEW; END $$;
    CREATE TRIGGER fail_new_bot_commit_after_complete AFTER UPDATE OF "processingStatus" ON "NewBotInboxEvent"
      FOR EACH ROW WHEN (NEW."id" = '${commitFailure.eventId}' AND NEW."processingStatus" = 'COMPLETED')
      EXECUTE FUNCTION fail_new_bot_commit();`)
  await assert.rejects(commit(commitFailure, prepared(commitFailure), signal()), /foreign key|commit/i)
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [commitFailure.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', commitFailure.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string; leaseToken: string | null }>('SELECT "processingStatus", "leaseToken" FROM "NewBotInboxEvent" WHERE "id"=$1', [commitFailure.eventId])).rows[0]?.processingStatus, 'PROCESSING')
  await db.exec('DROP TRIGGER fail_new_bot_commit_after_complete ON "NewBotInboxEvent"; DROP FUNCTION fail_new_bot_commit();')

  // Abort before transaction causes no write; abort during final fence throws and rolls back.
  const abortedBefore = await admit('abort-before', 'abort-before-conversation')
  const beforeController = new AbortController(); beforeController.abort()
  assert.equal(await commit(abortedBefore, prepared(abortedBefore), beforeController.signal), false)
  assert.equal((await rows('NewBotConversationSession', abortedBefore.eventId)).length, 0)
  const abortedDuring = await admit('abort-during', 'abort-during-conversation')
  const duringController = new AbortController()
  const abortingClient = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({
        async $queryRaw(query: Prisma.Sql) {
          const result = await pg.query(query.text, query.values)
          if (query.text.includes('SET "processingStatus" = \'COMPLETED\'')) duringController.abort()
          return result.rows
        },
      }))
    },
  }
  await assert.rejects(createNewBotCommitter(abortingClient as never)(abortedDuring, prepared(abortedDuring), duringController.signal), /aborted/)
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "conversationId"=$1', [abortedDuring.conversationId])).rows.length, 0)
  assert.equal((await rows('NewBotOutboxEvent', abortedDuring.eventId)).length, 0)
  assert.equal((await db.query<{ processingStatus: string }>('SELECT "processingStatus" FROM "NewBotInboxEvent" WHERE "id"=$1', [abortedDuring.eventId])).rows[0]?.processingStatus, 'PROCESSING')

  // Default-deny RLS covers the new session and outbox relations.
  await db.exec('CREATE ROLE commit_untrusted NOLOGIN; GRANT SELECT, INSERT, UPDATE ON "NewBotConversationSession" TO commit_untrusted; GRANT SELECT, INSERT, UPDATE ON "NewBotOutboxEvent" TO commit_untrusted; SET ROLE commit_untrusted;')
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession"')).rows.length, 0)
  assert.equal((await db.query('SELECT 1 FROM "NewBotOutboxEvent"')).rows.length, 0)
  await assert.rejects(db.query(`INSERT INTO "NewBotOutboxEvent" ("id","eventId","businessId","provider","conversationId","sequence","ordinal","recipientKey","action") VALUES ('forbidden','forbidden','tenant-a','whatsapp','forbidden',1,0,'forbidden','{"type":"text","text":"no"}'::jsonb)`), /row-level security/i)
  await db.exec('RESET ROLE;')

  // Business partition is also distinct for equal provider/conversation identifiers.
  await ingestNewBotEvent(otherTenant, { provider: 'whatsapp', providerEventId: 'other-tenant', conversationId: 'shared-conversation', message: { kind: 'text', text: 'other' } }, ingress)
  const otherId = (await db.query<{ id: string }>('SELECT "id" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['other-tenant'])).rows[0]!.id
  const otherClaim = (await queue.claimBatch({ batchSize: 100, leaseDurationMs: 60_000 })).find((candidate) => candidate.eventId === otherId)!
  assert.equal(await commit(otherClaim, prepared(otherClaim, 0, { step: 'other-tenant' }), signal()), true)
  assert.equal((await db.query('SELECT 1 FROM "NewBotConversationSession" WHERE "businessId"=$1 AND "provider"=$2 AND "conversationId"=$3', ['tenant-b', 'whatsapp', 'shared-conversation'])).rows.length, 1)

  console.log('new-bot-commit-test: OK')
} finally {
  await db.close()
}