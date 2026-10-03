import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { planConversationChoiceView, persistConversationChoiceViewTx, resolveConversationChoicePayload } from '../src/conversational-bot/runtime-choice-persistence.js'
const scope = { businessId:'a', conversationKey:'session', policyKey:'config', policyGeneration:1, revision:'2' }
const draft = { businessId:'a', pending:'professional', name:'Actual' }
const question = issueChoiceQuestion(scope, draft, {kind:'professional',title:'Profesionales',choices:[
  {label:'Cualquier profesional',operation:{kind:'any_professional'}}, {label:'Ana',operation:{kind:'professional',professionalId:'p'}}
]})
const plan = planConversationChoiceView({question,reply:'Elegí tu profesional',transitionId:'transition'})
assert.equal(plan.choiceRows.length,2)
assert.ok(plan.choiceRows.every(row => row.actionType === 'conversation.choice' && row.entityType === null && row.entityId === null))
const item = plan.outboxRows.at(-1)!.item
assert.ok(item.type === 'interactive' && item.mode === 'list' && item.rows?.[0]?.title === 'Cualquier profesional')
assert.ok(item.type === 'interactive' && item.actionIds.every(id => /^b1\./.test(id)))
assert.ok(item.type === 'interactive' && item.body.includes('Cualquier profesional') && item.body.includes('Ana'), 'text is self-contained')
const fragmented = planConversationChoiceView({question,reply:'Texto público '.repeat(160),transitionId:'fragments'})
assert.ok(fragmented.outboxRows.length > 1 && fragmented.outboxRows.at(-1)!.dependsOnSequence === fragmented.outboxRows.length-2, 'interactive depends on accepted fragments')
assert.ok(fragmented.choiceRows.every(row => row.actionType === 'conversation.choice'))
assert.deepEqual(resolveConversationChoicePayload(plan.choiceRows[0]!.payload,scope,draft).operation, {kind:'any_professional'})
assert.throws(() => resolveConversationChoicePayload(plan.choiceRows[0]!.payload,{...scope,businessId:'b'},draft),/scope/)
assert.throws(() => resolveConversationChoicePayload(plan.choiceRows[0]!.payload,{...scope,revision:'3'},draft),/scope/)
assert.throws(() => resolveConversationChoicePayload(plan.choiceRows[0]!.payload,scope,{...draft,name:'Changed'}),/draft/)
assert.throws(() => resolveConversationChoicePayload({...plan.choiceRows[0]!.payload,operation:{kind:'confirm'}},scope,draft),/payload/)
assert.equal(plan.choiceRows[0]!.payload.choiceId, publicChoiceQuestion(question).choices[0]!.id)
const db = new PGlite()
try {
  await db.exec(`CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','RESOLVED','INVALIDATED','EXPIRED');
    CREATE TYPE "BotPromptMode" AS ENUM ('FUNCTIONAL','NAVIGATION','CONFLICT');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"revision" bigint,"deploymentGeneration" integer,"status" "BotSessionStatus","handoffClaimsPausedAt" timestamp);
    INSERT INTO "BotSession" VALUES ('session','a',2,1,'ACTIVE',NULL);
    CREATE TABLE "BotPrompt" ("id" text PRIMARY KEY,"sessionId" text REFERENCES "BotSession"("id"),"promptToken" text UNIQUE,"stateRevision" bigint,"mode" "BotPromptMode","status" "BotPromptStatus","openedAt" timestamp,"outboxMessageId" text,"resolvedAt" timestamp);
    CREATE UNIQUE INDEX "one_open_prompt" ON "BotPrompt"("sessionId") WHERE "status" IN ('OPEN','STABILIZING');
    CREATE TABLE "BotPromptChoice" ("id" text PRIMARY KEY,"promptId" text REFERENCES "BotPrompt"("id"),"choiceToken" text,"actionType" text,"entityType" text,"entityId" text,"payload" jsonb,"labelSnapshot" text,"sortOrder" integer);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"deliveryGroupId" text,"sequence" integer,"kind" text,"payload" jsonb,"idempotencyKey" text UNIQUE,"status" "BotOutboxStatus","dependsOnSequence" integer,"availableAt" timestamp,"updatedAt" timestamp);
    INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","mode","status") VALUES ('old','session','old',1,'FUNCTIONAL','OPEN');`)
  const input = {scope,draft,question,reply:'Elegí tu profesional',transitionId:'tx1',toPhone:'qa',dbNow:new Date('2026-10-02T15:00:00Z')}
  const run = async (change: Partial<typeof input> = {}, fail = false) => db.transaction(async tx => {
    const client: any = {$queryRaw: async (q:any) => (await tx.query(q.text,q.values.map((v:unknown) => v instanceof Date ? v.toISOString() : v))).rows.map((row:any) => ({...row,...('choiceCount' in row ? {choiceCount:BigInt(row.choiceCount),outboxCount:BigInt(row.outboxCount)} : {})})),
      $executeRaw: async (q:any) => (await tx.query(q.text,q.values.map((v:unknown) => v instanceof Date ? v.toISOString() : v))).affectedRows}
    await persistConversationChoiceViewTx(client,{...input,...change})
    if (fail) throw new Error('rollback fixture')
  })
  await run()
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotPrompt" WHERE "id"='old'`)).rows,[{status:'INVALIDATED'}])
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotPromptChoice" WHERE "actionType"='conversation.choice'`)).rows[0]!.count,2)
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox"`)).rows[0]!.count,1)
  await assert.rejects(() => run({transitionId:'failed'},true), /rollback/)
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox"`)).rows[0]!.count,1)
  await assert.rejects(() => run({scope:{...scope,businessId:'foreign'}}),/scope/)
  await db.exec(`UPDATE "BotSession" SET "revision"=3`)
  await assert.rejects(() => run({transitionId:'stale'}),/scope|revision/)
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotPrompt" WHERE "status"='OPEN'`)).rows[0]!.count,1)
  await db.exec(`UPDATE "BotSession" SET "revision"=2,"deploymentGeneration"=2`)
  await assert.rejects(() => run({transitionId:'generation'}),/scope|revision/)
  await db.exec(`UPDATE "BotSession" SET "deploymentGeneration"=1,"handoffClaimsPausedAt"='2026-10-02'`)
  await assert.rejects(() => run({transitionId:'handoff'}),/scope|revision/)
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox"`)).rows[0]!.count,1)
  console.log('conversational runtime choice persistence PGlite: PASS')
} finally {await db.close()}
