/** In-memory PostgreSQL/WASM only: no URL, server, provider or real customer. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { enqueueConversationalHandoffTx } from '../src/conversational-bot/prisma-conversational-handoff.js'

const db = new PGlite()
const policy = { businessId: 'a', deploymentId: 'dep', generation: 1, configurationId: 'cfg' }
const referral = { businessId: 'a', status: 'offered' as const, reason: 'UNVERIFIED_SERVICE' as const,
  request: 'Consulta de servicio', serviceId: null }
const draft = { ...initialDialogueState('a'), customerName: 'Demo', referral }
const original = projectConversationDraft(draft, policy)
const input = { businessId: 'a', sessionId: 's', policy, expectedRevision: 4n, handoffFenceEpoch: 2,
  operationKey: 'request-1', command: { referral, consent: { revision: 4n, evidence: 'Quiero consultar con el equipo.' } } }
type Input = Parameters<typeof enqueueConversationalHandoffTx>[1]
type Update = { businessId: string; conversationId: string; updatedAt: string }
let checks = 0
try {
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN','CANCELLED','RESOLVED');
    CREATE TYPE "ConversationStep" AS ENUM ('START','HUMAN_HANDOFF','COMPLETED');
    CREATE TABLE "BotChannelDeployment" ("id" text PRIMARY KEY,"businessId" text,"generation" int,
      "activeConfigurationId" text,"claimsPausedAt" timestamptz);
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY,"businessId" text,"currentStep" "ConversationStep",
      "aiEnabled" boolean,"humanHandoffAt" timestamp(3),"humanHandoffResolvedAt" timestamp(3),
      "updatedAt" timestamp(3),"misunderstandingCount" int DEFAULT 0);
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"conversationId" text,
      "deploymentId" text,"deploymentGeneration" int,"businessTimezone" text,"status" "BotSessionStatus","state" jsonb,
      "revision" bigint,"handoffFenceEpoch" int,"handoffClaimsPausedAt" timestamptz,"updatedAt" timestamp(3));
    CREATE TABLE "BotOperation" ("id" text PRIMARY KEY,"operationKey" text UNIQUE,"type" text,
      "businessId" text,"sessionId" text,"status" text,"requestHash" text,"resultRef" text,"updatedAt" timestamp(3));
    CREATE TABLE "BotHandoff" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,
      "status" "BotHandoffStatus","reason" text,"detail" text,"context" jsonb,"queuedAt" timestamp(3),"updatedAt" timestamp(3));
    CREATE UNIQUE INDEX one_active_handoff ON "BotHandoff" ("sessionId") WHERE "status" IN ('QUEUED','TAKEN');
  `)
  async function seed() {
    await db.exec('TRUNCATE "BotHandoff","BotOperation","BotSession","Conversation","BotChannelDeployment"')
    await db.query('INSERT INTO "BotChannelDeployment" VALUES ($1,$2,1,$3,NULL)', ['dep', 'a', 'cfg'])
    await db.exec(`INSERT INTO "Conversation" VALUES ('c','a','START',true,NULL,NULL,now(),0)`)
    await db.query(`INSERT INTO "BotSession" VALUES ('s','a','c','dep',1,'UTC','ACTIVE',$1,4,2,NULL,now())`, [JSON.stringify(original)])
  }
  const rows = async (table: string) => (await db.query<Record<string, unknown>>(`SELECT * FROM "${table}" ORDER BY "id"`)).rows
  const snapshot = async () => ({ sessions: await rows('BotSession'), conversations: await rows('Conversation'),
    operations: await rows('BotOperation'), handoffs: await rows('BotHandoff') })
  async function execute(value: Input = input, fail = false) {
    const updates: Update[] = []
    const published: Update[] = []
    const result = await db.transaction(async pg => {
      const tx = {
        async $queryRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).rows },
        async $executeRaw(query: Prisma.Sql) { return (await pg.query(query.text, query.values)).affectedRows ?? 0 }
      }
      const result = await enqueueConversationalHandoffTx(tx as never, { ...value, pendingConversationUpdates: updates })
      assert.equal(published.length, 0, 'no CRM publication before commit')
      if (fail) throw new Error('forced rollback')
      return result
    })
    published.push(...updates)
    return { result, published }
  }
  await seed()
  const immutable = structuredClone(input)
  const first = await execute()
  assert.equal(first.result.replayed, false)
  assert.equal(first.result.revision, 5n)
  assert.equal(first.published.length, 1)
  const queued = (await rows('BotSession'))[0]!
  assert.equal(queued.status, 'HUMAN_QUEUED')
  assert.equal(queued.revision, 5)
  assert.equal(queued.handoffFenceEpoch, 2, 'queue does not close TAKE fence')
  assert.equal(queued.handoffClaimsPausedAt, null)
  const state = queued.state as typeof original
  assert.equal(state.handoff, 'QUEUED')
  assert.deepEqual(state.conversationDraft, original.conversationDraft, 'whole draft and policy preserved')
  assert.equal((await rows('Conversation'))[0]!.currentStep, 'HUMAN_HANDOFF')
  assert.equal((await rows('Conversation'))[0]!.aiEnabled, true, 'QUEUED is not TAKEN')
  assert.equal((await rows('BotHandoff'))[0]!.id, first.result.handoffId)
  assert.match(String((await rows('BotHandoff'))[0]!.detail), /^conversational-consent:[a-f0-9]{64}$/)
  assert.ok(!String((await rows('BotHandoff'))[0]!.detail).includes(input.command.consent.evidence), 'raw consent is not duplicated in CRM detail')
  assert.deepEqual(input, immutable)
  checks++

  const beforeReplay = await snapshot()
  const replay = await execute()
  assert.equal(replay.result.replayed, true)
  assert.equal(replay.result.handoffId, first.result.handoffId)
  assert.deepEqual(await snapshot(), beforeReplay, 'replay never rewrites current state')
  assert.equal(replay.published.length, 0)
  checks++
  for (const changed of [
    { ...input, command: { ...input.command, consent: { ...input.command.consent, evidence: 'Otra consulta.' } } },
    { ...input, expectedRevision: 3n },
    { ...input, businessId: 'foreign' },
    { ...input, sessionId: 'foreign' },
    { ...input, operationKey: 'new-request-for-existing-queue' }
  ]) {
    const before = await snapshot()
    await assert.rejects(() => execute(changed))
    assert.deepEqual(await snapshot(), before)
    checks++
  }
  await db.exec(`UPDATE "BotHandoff" SET "status"='CANCELLED'; UPDATE "BotSession" SET "status"='ACTIVE';
    INSERT INTO "BotHandoff" VALUES ('later','a','s','QUEUED','later',NULL,NULL,now(),now());
    UPDATE "BotSession" SET "status"='HUMAN_QUEUED'`)
  const later = await snapshot()
  const historical = await execute()
  assert.equal(historical.result.handoffId, first.result.handoffId)
  assert.deepEqual(await snapshot(), later, 'historical replay cannot retarget later queue')
  checks++

  await seed()
  const beforeRollback = await snapshot()
  await assert.rejects(() => execute(input, true), /forced rollback/)
  assert.deepEqual(await snapshot(), beforeRollback)
  checks++
  for (const patch of [
    `UPDATE "BotSession" SET "revision"=6`,
    `UPDATE "BotSession" SET "handoffFenceEpoch"=3`,
    `UPDATE "BotSession" SET "handoffClaimsPausedAt"=now()`,
    `UPDATE "BotSession" SET "status"='HUMAN_TAKEN'`,
    `UPDATE "BotChannelDeployment" SET "claimsPausedAt"=now()`,
    `UPDATE "BotChannelDeployment" SET "generation"=2`,
    `UPDATE "BotChannelDeployment" SET "activeConfigurationId"='new'`,
    `UPDATE "BotSession" SET "state"=jsonb_set("state",'{deposit}','"PENDING_PROOF"')`,
    `UPDATE "BotSession" SET "state"=jsonb_set("state",'{booking}','"CONFIRMED"')`,
    `UPDATE "BotSession" SET "state"="state" #- '{conversationDraft,dialogue,referral}'`,
    `UPDATE "BotSession" SET "state"=jsonb_set("state",'{conversationDraft,dialogue,referral,request}','"Changed"')`
  ]) {
    await seed()
    await db.exec(patch)
    const before = await snapshot()
    await assert.rejects(() => execute())
    assert.deepEqual(await snapshot(), before)
    checks++
  }
  for (const changed of [
    { ...input, command: { ...input.command, consent: { ...input.command.consent, revision: 3n } } },
    { ...input, command: { ...input.command, consent: { ...input.command.consent, evidence: '' } } },
    { ...input, policy: { ...policy, businessId: 'foreign' } },
    { ...input, command: { ...input.command, consent: { ...input.command.consent, evidence: 'x'.repeat(301) } } },
    { ...input, command: { ...input.command, consent: { ...input.command.consent, evidence: 'bad\u0000quote' } } },
    { ...input, policy: { ...policy, configurationId: 'foreign' } },
    { ...input, policy: { ...policy, deploymentId: 'foreign' } },
    { ...input, policy: { ...policy, generation: 2 } }
  ]) {
    await seed()
    const before = await snapshot()
    await assert.rejects(() => execute(changed))
    assert.deepEqual(await snapshot(), before)
    checks++
  }
  await seed()
  const knownReferral = { ...referral, reason: 'PHOTO_REQUIRED' as const, request: 'Servicio', serviceId: 'svc' }
  const knownDraft = { ...draft, referral: knownReferral }
  const knownState = projectConversationDraft(knownDraft, policy)
  await db.query('UPDATE "BotSession" SET "state"=$1 WHERE "id"=\'s\'', [JSON.stringify(knownState)])
  await execute({ ...input, command: { ...input.command, referral: knownReferral } })
  assert.equal(((await rows('BotHandoff'))[0]!.context as { serviceId: string }).serviceId, 'svc')
  assert.deepEqual(((await rows('BotSession'))[0]!.state as typeof knownState).conversationDraft, knownState.conversationDraft)
  checks++

  console.log(`conversational handoff SQL: ${checks} PASS; memory-only, no engine integration or RESUME authority`)
} finally { await db.close() }
