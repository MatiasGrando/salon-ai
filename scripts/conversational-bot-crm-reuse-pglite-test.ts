import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { processConversationInbox } from '../src/conversational-bot/process-inbox-job.js'
import { projectInboundMessage, isConversationRestartCommand } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { subscribeToCrmRealtimeEvents } from '../src/services/crm-realtime-events.js'
import type { Prisma } from '../src/generated/prisma/client.js'

// Execute the production inbox SELECT in SQL, not a test copy of its identity predicate.
const db = new PGlite()
const now = new Date('2026-10-01T12:00:00Z')
const policy = { businessId: 'biz', deploymentId: 'dep', generation: 1, configurationId: 'cfg',
  customerCode: 'WX-38N6UG', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE',
  engineKey: 'deterministic-options', definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } } }
const payload = { fromPhone: 'phone', textBody: 'hola', messageType: 'text', contextWindowEvaluated: true }
type Query = Prisma.Sql
const inboxQueries: Query[] = []
await db.exec(`
  CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
  CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND');
  CREATE TABLE "Business" ("id" text PRIMARY KEY,"customerCode" text,"botEnabled" boolean);
  CREATE TABLE "BusinessFeatureSettings" ("businessId" text,"botEnabled" boolean);
  CREATE TABLE "BusinessBotOptionsSettings" ("businessId" text,"timezone" text);
  CREATE TABLE "BusinessBotConfiguration" ("id" text PRIMARY KEY,"businessId" text,"status" text,"definition" jsonb);
  CREATE TABLE "BotChannelDeployment" ("id" text PRIMARY KEY,"businessId" text,"generation" int,"dispatchFenceEpoch" int,"engineKey" text,"activeConfigurationId" text,"claimsPausedAt" timestamptz);
  CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY,"businessId" text,"providerMessageId" text,"payload" jsonb,"phoneNumberId" text,"admittedAt" timestamptz,"providerOccurredAt" timestamptz);
  CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"payload" jsonb,"providerEventId" text,"providerMessageId" text,"status" text);
  CREATE TABLE "Conversation" ("id" text PRIMARY KEY,"businessId" text,"phone" text,"lastMessage" text,"updatedAt" timestamptz);
  CREATE TABLE "Message" ("id" text PRIMARY KEY,"conversationId" text,"phone" text,"direction" "MessageDirection","providerMessageId" text);
  INSERT INTO "Business" VALUES ('biz','WX-38N6UG',true),('foreign','OTHER',true);
  INSERT INTO "BusinessBotOptionsSettings" VALUES ('biz','UTC');
  INSERT INTO "BusinessBotConfiguration" VALUES ('cfg','biz','ACTIVE','{"conversation":{"schemaVersion":1,"engine":"conversational-booking-v1"}}');
  INSERT INTO "BotChannelDeployment" VALUES ('dep','biz',1,1,'deterministic-options','cfg',NULL);
`)
async function seed(change = '') {
  await db.exec(`TRUNCATE "BotActionInbox","BotProviderEvent","Conversation","Message";
    INSERT INTO "BotProviderEvent" VALUES ('event','biz','msg','${JSON.stringify(payload)}','channel','2026-10-01T12:00:00Z','2026-10-01T12:00:00Z');
    INSERT INTO "BotActionInbox" VALUES ('inbox','biz','dep',1,'${JSON.stringify(payload)}','event','msg','ADMITTED');
    INSERT INTO "Conversation" VALUES ('conversation','biz','phone','newer durable part','2026-10-01T12:00:01Z');
    INSERT INTO "Message" VALUES ('event','conversation','phone','INBOUND','msg');
    ${change}`)
}
async function fixture(options: { existing?: boolean; status?: string; enabled?: boolean; failSnapshotCommit?: boolean; sessionConversation?: string } = {}) {
  let session = options.existing === false ? null : { sessionId: 'session', conversationId: options.sessionConversation ?? 'conversation',
    revision: 0n, status: options.status ?? 'ACTIVE', state: createInitialBotOptionsState(), businessTimezone: 'UTC',
    handoffFenceEpoch: 0, handoffClaimsPausedAt: null, deploymentId: 'dep', deploymentGeneration: 1 }
  let upserts = 0, projections = 0, publications = 0, writes = 0, replies = 0, transactions = 0
  const statements: Query[] = []
  const unsubscribe = subscribeToCrmRealtimeEvents({ businessId: 'biz', send(event) {
    if (event.type === 'conversation_message_received') publications++
  } })
  if (options.enabled === false) await db.exec(`UPDATE "Business" SET "botEnabled"=false`)
  else await db.exec(`UPDATE "Business" SET "botEnabled"=true`)
  const client = {
    async $transaction<T>(body: (tx: unknown) => Promise<T>): Promise<T> {
      transactions++
      const result = await body(client)
      if (transactions === 2 && options.failSnapshotCommit) throw new Error('snapshot commit failed')
      return result
    },
    async $queryRaw(q: Query): Promise<unknown[]> {
      statements.push(q)
      if (q.sql.includes('conversation-policy')) return [policy]
      if (q.sql.includes('conversation-target')) return [{ fenceEpoch: 1, phone: 'phone' }]
      if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch' }]
      if (q.sql.includes('consolidation-inbox-identity')) return [{ phone: 'phone' }]
      if (q.sql.includes('conversation-claims-assert')) return [{ jobCount: 1n, dispatchCount: 1n }]
      if (q.sql.includes('conversation-feature-lock')) return []
      if (q.sql.includes('conversation-inbox-lock')) {
        inboxQueries.push(q)
        return (await db.query(q.text, q.values)).rows
      }
      if (q.sql.includes('INSERT INTO "Conversation"')) { upserts++; return [{ id: 'conversation' }] }
      if (q.sql.includes('inbound-message-projection')) {
        projections++; writes++
        await db.query(`UPDATE "Conversation" SET "lastMessage"='hola',"updatedAt"=clock_timestamp() WHERE "id"='conversation'`)
        const present = (await db.query(`SELECT "id" FROM "Message" WHERE "providerMessageId"='msg'`)).rows.length
        return present ? [] : [{ id: 'fallback-message' }]
      }
      if (q.sql.includes('conversation-create-session')) {
        session = { sessionId: 'session', conversationId: q.values[2] as string, revision: 0n, status: 'ACTIVE',
          state: createInitialBotOptionsState(), businessTimezone: 'UTC', handoffFenceEpoch: 0,
          handoffClaimsPausedAt: null, deploymentId: 'dep', deploymentGeneration: 1 }
        return [{ id: 'session' }]
      }
      if (q.sql.includes('conversation-order')) return [{ blocked: false }]
      if (q.sql.includes('consolidation-previous')) return []
      if (q.sql.includes('consolidation-candidates')) return [{ id: 'event', admittedAt: now, payload, actionType: 'input.initial', scopeMatches: true }]
      if (q.sql.includes('conversation-turn-persist')) return [{ sessionCount: 1n, transitionCount: 1n, stepCount: 0n, conversationId: null, updatedAt: null }]
      if (q.sql.includes('conversation-settle-batch')) return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }]
      throw new Error(`unhandled query: ${q.sql.slice(0, 100)}`)
    },
    async $executeRaw(q: Query) { statements.push(q); return 1 }
  }
  try {
    const result = await processConversationInbox({ client: client as never,
      job: { id: 'job', kind: 'PROCESS_INBOX', aggregateId: 'inbox', businessId: 'biz', deploymentId: 'dep',
        deploymentGeneration: 1, claimToken: 'job-token', attempts: 1 } as never,
      lockSession: (async () => session) as never, projectInbound: projectInboundMessage,
      isRestart: isConversationRestartCommand, writeView: (async () => { replies++ }) as never,
      dialogueFactory: async () => ({ context: { businessId: 'biz', timezone: 'UTC', dbNow: now },
        port: { catalog: async () => [], availability: async () => { throw new Error('simple turn must not query availability') } } }),
      conversationalAi: { provider: async () => ({ intent: 'other', serviceId: null, serviceEvidence: null,
        professionalMention: null, firstReply: { opening: 'Hola', factIds: [], closing: null } }), timeoutMs: 4500 }
    })
    return { result, upserts, projections, publications, writes, replies, statements }
  } finally { unsubscribe() }
}
try {
  await seed()
  const before = (await db.query(`SELECT "lastMessage","updatedAt" FROM "Conversation" WHERE "id"='conversation'`)).rows[0]
  const reused = await fixture()
  assert.equal(reused.upserts + reused.projections, 0, 'confirmed provider projection must remove two snapshot SQL trips')
  assert.equal(reused.writes, 0, 'old part must not overwrite newer durable CRM projection')
  assert.equal(reused.publications, 0, 'already committed provider message must not publish a second CRM event')
  assert.deepEqual((await db.query(`SELECT "lastMessage","updatedAt" FROM "Conversation" WHERE "id"='conversation'`)).rows[0], before)
  assert.equal(reused.replies, 1)
  assert.equal(reused.statements.filter(q => q.sql.includes('conversation-claims-assert')).length, 2, 'both fresh claims checks remain')
  assert.equal(reused.statements.filter(q => q.sql.includes('conversation-feature-lock')).length, 2, 'both feature locks remain')
  await seed(); assert.equal((await fixture({ existing: false })).upserts, 0, 'first session also reuses the committed conversation')
  for (const guarded of [{ status: 'HUMAN_TAKEN' }, { enabled: false }]) {
    await seed(); const result = await fixture(guarded)
    assert.equal(result.upserts + result.projections, 0); assert.equal(result.replies, 0)
  }
  const cases = [
    `DELETE FROM "Message"`,
    `UPDATE "Message" SET "id"='different-event'`,
    `UPDATE "Message" SET "providerMessageId"='different-provider'`,
    `UPDATE "BotActionInbox" SET "providerMessageId"='different-provider'`,
    `UPDATE "BotProviderEvent" SET "providerMessageId"='different-provider'`,
    `UPDATE "Message" SET "direction"='OUTBOUND'`,
    `UPDATE "Message" SET "phone"='foreign-phone'`,
    `UPDATE "Conversation" SET "businessId"='foreign'`,
    `UPDATE "Conversation" SET "phone"='foreign-phone'`,
    `UPDATE "Message" SET "conversationId"='missing-conversation'`,
    `DELETE FROM "Conversation"`
  ]
  for (const change of cases) {
    await seed(change); const result = await fixture()
    if (change === `DELETE FROM "Message"`) assert.equal(result.statements.length, reused.statements.length + 2, 'complete reuse removes exactly two SQL trips')
    assert.equal(result.upserts, 1, `incomplete projection keeps upsert fallback: ${change}`)
    assert.equal(result.projections, 1, `incomplete projection keeps Message fallback: ${change}`)
  }
  await seed(); const mismatch = await fixture({ sessionConversation: 'another-conversation' })
  assert.equal(mismatch.upserts + mismatch.projections, 2, 'session/projection disagreement cannot be reused')
  await seed(); await assert.rejects(fixture({ failSnapshotCommit: true }), /snapshot commit failed/)
  // SQL negatives above execute the actual joined production SELECT; no extra identity query is allowed.
  assert.ok(inboxQueries.length > 0)
  console.log('OK confirmed CRM projection reuse: two fewer SQL trips, exact SQL identity, fallback, first session, human/disabled, rollback and no duplicate publication.')
} finally { await db.close() }
