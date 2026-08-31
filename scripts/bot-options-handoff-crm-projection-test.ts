/** Real PostgreSQL/WASM transactions only: no service URL or customer data. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { prismaBotOptionsEffectExecutor } from '../src/bot-options/infrastructure/prisma-bot-options-effect-executor.js'
import { runCommittedProcessSession } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { transition, type NormalizedAction } from '../src/bot-options/domain/transition.js'
import { conversationHandoffStage } from '../src/services/conversation-handoff.js'
import { publishConversationUpdated, subscribeToCrmRealtimeEvents, type ConversationUpdatedEvent } from '../src/services/crm-realtime-events.js'

const db = new PGlite()
const events: ConversationUpdatedEvent[] = []
const foreignEvents: unknown[] = []
const unsubscribe = subscribeToCrmRealtimeEvents({ businessId: 'a', send(event) { if (event.type === 'conversation_updated') events.push(event) } })
const unsubscribeOther = subscribeToCrmRealtimeEvents({ businessId: 'b', send(event) { foreignEvents.push(event) } })
try {
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN','CANCELLED','RESOLVED');
    CREATE TYPE "ConversationStep" AS ENUM ('START','HUMAN_HANDOFF','AWAITING_DEPOSIT','COMPLETED');
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text, "currentStep" "ConversationStep", "aiEnabled" boolean,
      "humanHandoffAt" timestamp(3), "humanHandoffResolvedAt" timestamp(3), "updatedAt" timestamp(3), "archivedAt" timestamp(3), "misunderstandingCount" int DEFAULT 0);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY, "businessId" text, "conversationId" text, "status" "BotSessionStatus", "state" jsonb, "updatedAt" timestamp(3));
    CREATE TABLE "BotOperation" ("id" text PRIMARY KEY, "operationKey" text UNIQUE, "type" text, "businessId" text, "sessionId" text,
      "status" text, "requestHash" text, "resultRef" text, "updatedAt" timestamp(3));
    CREATE TABLE "BotHandoff" ("id" text PRIMARY KEY, "businessId" text, "sessionId" text, "status" "BotHandoffStatus", "reason" text,
      "detail" text, "context" jsonb, "queuedAt" timestamp(3), "cancelledAt" timestamp(3), "ownerUserId" text, "updatedAt" timestamp(3));
    CREATE UNIQUE INDEX one_live_handoff ON "BotHandoff" ("sessionId") WHERE "status" IN ('QUEUED','TAKEN');
  `)
  const initial = createInitialBotOptionsState()
  const action = (actionType: NormalizedAction['actionType']): NormalizedAction => ({ actionType, entityRef: null, payload: null })
  async function seed(step = 'START', aiEnabled = true) {
    await db.exec('TRUNCATE "Conversation", "BotSession", "BotHandoff", "BotOperation"')
    for (const tenant of ['a','b']) {
      await db.query('INSERT INTO "Conversation" VALUES ($1,$2,$3,$4,NULL,NULL,now(),NULL,0)', [`c-${tenant}`,tenant,step,aiEnabled])
      await db.query('INSERT INTO "BotSession" VALUES ($1,$2,$3,\'ACTIVE\',$4,now())', [`s-${tenant}`,tenant,`c-${tenant}`,JSON.stringify(initial)])
    }
    events.length = 0
    foreignEvents.length = 0
  }
  const one = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows[0]!
  const conversation = async () => await one('SELECT * FROM "Conversation" WHERE "id"=\'c-a\'')
  const pending = async () => Number((await one(`SELECT count(*) AS n FROM "Conversation" WHERE "businessId"='a' AND "archivedAt" IS NULL
    AND ("aiEnabled"=false OR ("currentStep"='HUMAN_HANDOFF' AND "humanHandoffResolvedAt" IS NULL))`)).n)
  async function execute(key: string, kind: 'request' | 'cancel' | 'wait' = 'request', fail = false, businessId = 'a') {
    const pendingConversationUpdates: Array<Omit<ConversationUpdatedEvent, 'type'>> = []
    const seenBefore = events.length
    const client = {
      async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
        return db.transaction(async pg => {
          const tx = {
            async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows },
            async $executeRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).affectedRows ?? 0 }
          }
          return operation(tx)
        })
      }
    }
    return runCommittedProcessSession({ client: client as never, operation: async tx => {
      const state = kind === 'request' ? initial : (await tx.$queryRaw<Array<{ state: typeof initial }>>(Prisma.sql`SELECT "state" FROM "BotSession" WHERE "id"='s-a'`))[0]!.state
      const result = transition(state, action(kind === 'request' ? 'handoff.request' : kind === 'cancel' ? 'handoff.cancel' : 'handoff.wait'), { dbNowIso: '2026-08-31T12:00:00Z' })
      assert.ok('effects' in result)
      await prismaBotOptionsEffectExecutor(tx, { businessId, sessionId: 's-a', operationKey: key, effects: result.effects, pendingConversationUpdates })
      // A replayed effect must not force its old functional state over the current state.
      if (kind !== 'request' || (await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status" FROM "BotSession" WHERE "id"='s-a'`))[0]!.status === 'HUMAN_QUEUED') {
        await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "state"=${JSON.stringify(result.state)}::jsonb WHERE "id"='s-a'`)
      }
      assert.equal(events.length, seenBefore, 'notification must not precede commit')
      if (fail) throw new Error('forced rollback after projection')
    }, postCommit() { for (const update of pendingConversationUpdates) publishConversationUpdated(update) } })
  }

  await seed()
  await execute('request-1')
  assert.equal(await pending(), 1, 'shared request must immediately appear in existing CRM pending filter')
  const queued = await conversation()
  assert.equal(conversationHandoffStage(queued as never), 'QUEUED')
  assert.equal(queued.aiEnabled, true, 'queue is not operator ownership')
  assert.equal(events.length, 1)
  assert.deepEqual(foreignEvents, [])
  await execute('request-1')
  await execute('wait-1', 'wait')
  assert.equal(events.length, 1, 'request replay and wait must not duplicate updates')
  await db.exec(`UPDATE "Conversation" SET "updatedAt"=now()+interval '1 minute' WHERE "id"='c-a'`)
  await execute('cancel-1', 'cancel')
  assert.equal(await pending(), 0, 'cancel removes only queue-owned CRM marker despite newer inbound messages')
  assert.equal((await conversation()).aiEnabled, true)
  assert.equal(events.length, 2)
  await execute('request-1')
  assert.equal(await pending(), 0, 'replay after cancellation cannot revive projection')
  assert.equal(events.length, 2)

  await seed('AWAITING_DEPOSIT')
  await execute('request-financial')
  await execute('cancel-financial', 'cancel')
  assert.equal((await conversation()).currentStep, 'AWAITING_DEPOSIT', 'cancel restores prior CRM financial step without changing booking aggregates')

  await seed()
  await execute('request-manual')
  await db.exec(`UPDATE "Conversation" SET "aiEnabled"=false WHERE "id"='c-a'`)
  await execute('cancel-manual', 'cancel')
  assert.equal(await pending(), 1, 'manual ownership must not be hidden on cancel')
  assert.equal((await conversation()).aiEnabled, false, 'cancel never re-enables manually disabled bot')

  await seed('HUMAN_HANDOFF', false)
  const manual = await conversation()
  await execute('request-preexisting')
  await execute('cancel-preexisting', 'cancel')
  assert.deepEqual(await conversation(), manual, 'preexisting manual ownership is never overwritten')
  assert.equal(events.length, 0, 'preexisting manual ownership never emits a queue projection update')

  await seed()
  await assert.rejects(() => execute('wrong-tenant', 'request', false, 'b'), /session not found in tenant/)
  assert.equal(await pending(), 0)
  assert.equal(events.length, 0)
  await assert.rejects(() => execute('rollback', 'request', true), /forced rollback/)
  assert.equal(await pending(), 0)
  assert.equal(Number((await one('SELECT count(*) AS n FROM "BotHandoff"')).n), 0)
  assert.equal(events.length, 0, 'rollback must not publish an orphan update')

  await seed()
  await execute('request-take')
  const queuedState = (await one(`SELECT "state" FROM "BotSession" WHERE "id"='s-a'`)).state as typeof initial
  const taken = transition(queuedState, action('handoff.take'), { dbNowIso: '2026-08-31T12:00:00Z' })
  assert.equal(taken.state.flow, 'HANDOFF_TAKEN')
  // Existing TAKE projection remains operator-owned; old request replay may not undo it.
  await db.exec(`UPDATE "BotHandoff" SET "status"='TAKEN',"ownerUserId"='operator' WHERE "sessionId"='s-a';
    UPDATE "BotSession" SET "status"='HUMAN_TAKEN' WHERE "id"='s-a';
    UPDATE "Conversation" SET "aiEnabled"=false WHERE "id"='c-a'`)
  await execute('request-take')
  assert.equal((await conversation()).aiEnabled, false)
  assert.equal((await one(`SELECT "status" FROM "BotHandoff" WHERE "sessionId"='s-a'`)).status, 'TAKEN')
  await assert.rejects(() => execute('cancel-after-take', 'cancel'), /cannot cancel handoff/)

  const worker = readFileSync(new URL('../src/bot-options/application/process-session-job.ts', import.meta.url), 'utf8')
  assert.match(worker, /pendingConversationUpdates/, 'production worker must collect projection updates')
  assert.match(worker, /postCommit:[\s\S]*?publishConversationUpdated/, 'production worker must publish after commit')
  console.log('OK handoff CRM projection: request, wait, cancel, replay, ownership, tenant isolation and rollback-safe realtime.')
} finally { unsubscribe(); unsubscribeOther(); await db.close() }
