import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import type { Prisma } from '../src/generated/prisma/client.js'
import { persistConversationTurnTx } from '../src/conversational-bot/persist-conversation-turn.js'

const db = new PGlite()
const input = { businessId: 'biz', sessionId: 'session', expectedRevision: 3n, revision: 4n,
  handoffFenceEpoch: 2, state: { safe: 'draft' }, transitionId: 'transition:session:4', deploymentId: 'dep',
  generation: 1, providerEventId: 'event', actionType: 'conversation.message', step: 'BOOKING_IN_PROGRESS' as const }
let statements = 0
const run = async (overrides: Partial<Parameters<typeof persistConversationTurnTx>[1]> = {}, failAfter = '') => {
  return db.transaction(async pg => {
    const tx = { async $queryRaw(q: Prisma.Sql) {
      if (statements === 0) {
        const plan = JSON.stringify((await pg.query('EXPLAIN (FORMAT JSON) ' + q.text, q.values)).rows)
        for (const dependency of ['saved_session', 'inserted_transition', 'projected_step']) assert.ok(plan.includes(dependency))
      }
      statements++; return (await pg.query(q.text, q.values)).rows.map(r => {
      const row = r as Record<string, unknown>
      return { ...row, sessionCount: BigInt(row['sessionCount'] as number), stepCount: BigInt(row['stepCount'] as number) }
    }) } }
    const update = await persistConversationTurnTx(tx as never, { ...input, ...overrides })
    if (failAfter === 'outbox') throw new Error('outbox rejected')
    if (failAfter === 'settlement') throw new Error('settlement lost')
    return update
  })
}
const reset = async () => {
  await db.exec(`TRUNCATE "Audit","BotTransitionLog","BotSession","Conversation";
    INSERT INTO "Conversation" VALUES ('conv','biz','OTHER',clock_timestamp()),('foreign','foreign','OTHER',clock_timestamp());
    INSERT INTO "BotSession" VALUES ('session','biz','conv',3,'ACTIVE',NULL,2,'{}',clock_timestamp());`)
  statements = 0
}
const state = async () => (await db.query<Record<string, unknown>>(`SELECT s."revision",s."state",c."currentStep",
  (SELECT count(*) FROM "BotTransitionLog") AS transitions FROM "BotSession" s JOIN "Conversation" c ON c."id"=s."conversationId"`)).rows[0]
try {
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TYPE "ConversationStep" AS ENUM ('BOOKING_IN_PROGRESS','OTHER');
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY,"businessId" text,"currentStep" "ConversationStep","updatedAt" timestamptz);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"conversationId" text,"revision" bigint,
      "status" "BotSessionStatus","handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" int,"state" jsonb,"updatedAt" timestamptz);
    CREATE TABLE "AllowedAction" (action text PRIMARY KEY); INSERT INTO "AllowedAction" VALUES ('conversation.message');
    CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,
      "deploymentGeneration" int,"revisionFrom" bigint,"revisionTo" bigint,"actionType" text,"outcome" text,"providerEventId" text,
      UNIQUE ("sessionId","revisionTo"), CONSTRAINT deferred_action FOREIGN KEY ("actionType") REFERENCES "AllowedAction"(action) DEFERRABLE INITIALLY DEFERRED);
    CREATE TABLE "Audit" (seq serial,resource text);
    CREATE FUNCTION audit_turn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO "Audit"(resource) VALUES (TG_TABLE_NAME); RETURN NEW; END $$;
    CREATE TRIGGER session_audit AFTER UPDATE ON "BotSession" FOR EACH ROW EXECUTE FUNCTION audit_turn();
    CREATE TRIGGER transition_audit AFTER INSERT ON "BotTransitionLog" FOR EACH ROW EXECUTE FUNCTION audit_turn();
    CREATE TRIGGER step_audit AFTER UPDATE ON "Conversation" FOR EACH ROW EXECUTE FUNCTION audit_turn();
  `)
  await reset()
  const update = await run()
  assert.equal(statements, 1)
  assert.equal(update?.businessId, 'biz'); assert.equal(update?.conversationId, 'conv')
  assert.ok(Number.isFinite(Date.parse(update!.updatedAt)))
  assert.deepEqual((await db.query<{ resource: string }>('SELECT resource FROM "Audit" ORDER BY seq')).rows.map(r => r.resource), ['BotSession','BotTransitionLog','Conversation'])
  assert.equal((await state())?.['revision'], 4)
  assert.deepEqual((await state())?.['state'], input.state)
  const transition = (await db.query<Record<string, unknown>>('SELECT * FROM "BotTransitionLog"')).rows[0]!
  assert.equal(transition['revisionFrom'], 3); assert.equal(transition['revisionTo'], 4)
  assert.equal(transition['providerEventId'], 'event'); assert.equal(transition['outcome'], 'APPLIED')
  assert.equal((await db.query<Record<string, unknown>>('SELECT "currentStep" FROM "Conversation" WHERE "id"=\'foreign\'')).rows[0]?.['currentStep'], 'OTHER')
  for (const setup of [
    `UPDATE "BotSession" SET "revision"=9`, `UPDATE "BotSession" SET "businessId"='foreign'`,
    `UPDATE "BotSession" SET "status"='HUMAN_TAKEN'`, `UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp()`,
    `UPDATE "BotSession" SET "handoffFenceEpoch"=9`
  ]) {
    await reset(); await db.exec(setup); const before = await state()
    await assert.rejects(run(), /conversation revision lost/)
    assert.deepEqual(await state(), before)
  }
  await reset(); await db.exec(`UPDATE "Conversation" SET "currentStep"='BOOKING_IN_PROGRESS' WHERE "id"='conv'`)
  assert.equal(await run(), null, 'unchanged step is permitted')
  await reset(); assert.equal(await run({ step: null }), null, 'null step never casts an invalid sentinel')
  assert.equal((await state())?.['currentStep'], 'OTHER')
  assert.equal((await state())?.['transitions'], 1, 'null step still inserts transition')
  assert.equal((await state())?.['revision'], 4)
  await reset(); await db.exec(`UPDATE "Conversation" SET "businessId"='foreign' WHERE "id"='conv'`)
  assert.equal(await run(), null, 'conversation update retains tenant join')
  assert.equal((await state())?.['currentStep'], 'OTHER')
  await reset(); await db.exec(`INSERT INTO "BotTransitionLog" ("id","sessionId","revisionTo") VALUES ('duplicate','session',4)`)
  await assert.rejects(run(), /unique constraint/)
  assert.equal((await state())?.['revision'], 3)
  for (const failure of ['outbox','settlement']) {
    await reset(); const before = await state()
    await assert.rejects(run({}, failure), new RegExp(failure))
    assert.deepEqual(await state(), before)
  }
  await reset(); const beforeCommit = await state()
  await assert.rejects(run({ actionType: 'invalid-action' }), /deferred_action/)
  assert.deepEqual(await state(), beforeCommit)
  await assert.rejects(persistConversationTurnTx({ async $queryRaw() {
    return [{ sessionCount: 1n, stepCount: 2n, conversationId: 'conv', updatedAt: new Date() }]
  } } as never, input), /ambiguous bot options conversation projection/)
  console.log('OK conversation turn SQL: one statement, fences, dependency order, optional step, rollback and COMMIT failure.')
} finally { await db.close() }
