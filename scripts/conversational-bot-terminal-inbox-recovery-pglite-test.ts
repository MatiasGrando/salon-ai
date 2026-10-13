import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { createHash } from 'node:crypto'
import { selectConsolidationGroupTx } from '../src/conversational-bot/inbound-consolidation.js'
const db = new PGlite()
const scope = { businessId:'biz', deploymentId:'dep', generation:1, phone:'5491100' }
const tx = { async $queryRaw(q:Prisma.Sql) {return (await db.query(q.text,q.values)).rows}, async $executeRaw(q:Prisma.Sql) {return (await db.query(q.text,q.values)).affectedRows??0} } as never
await db.exec(`
CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','CLAIMED','SELECTED','CONFLICT','FAILED','PROCESSED');
CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','REJECTED','PROCESSED');
CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY,"businessId" text,"eventType" text,"payload" jsonb,"admittedAt" timestamptz,"status" "BotProviderEventStatus","phoneNumberId" text,"providerMessageId" text);
CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY,"businessId" text,"providerEventId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" int,"actionType" text,"status" "BotInboxStatus","claimToken" text,"claimedUntil" timestamptz,"operationKey" text,"error" text);
CREATE TABLE "BotJob" ("id" text PRIMARY KEY,"kind" text,"aggregateId" text,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"status" text,"attempts" int,"maxAttempts" int,"leaseToken" text,"leasedUntil" timestamptz,"lastError" text);
CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" int,"revisionTo" bigint,"actionType" text,"detail" jsonb,"providerEventId" text);
CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"status" text,"errorCode" text);
CREATE TABLE "BotOperation" ("id" text,"businessId" text,"sessionId" text,"operationKey" text,"status" text);
CREATE TABLE "BotDispatchClaim" ("id" text,"businessId" text,"sessionId" text,"resourceId" text,"claimToken" text,"status" text,"claimedUntil" timestamptz);
CREATE TABLE "BotSession" ("id" text,"businessId" text,"conversationId" text);
CREATE TABLE "Conversation" ("id" text,"businessId" text,"phone" text);
INSERT INTO "Conversation" VALUES ('conversation','biz','5491100'); INSERT INTO "BotSession" VALUES ('session','biz','conversation');
`)
async function seed() {
 await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotJob","BotTransitionLog","BotOutbox","BotOperation","BotDispatchClaim";
 INSERT INTO "BotProviderEvent" VALUES ('old','biz','MESSAGE','{"fromPhone":"5491100","messageType":"text","textBody":"old failed greeting"}','2026-10-12T21:09:00Z','ADMITTED','channel','old-msg'),('new','biz','MESSAGE','{"fromPhone":"5491100","messageType":"text","textBody":"new greeting"}','2026-10-13T12:00:00Z','ADMITTED','channel','new-msg');
 INSERT INTO "BotActionInbox" VALUES ('old-inbox','biz','old','session','dep',1,'conversation.message','ADMITTED',NULL,NULL,NULL,NULL),('new-inbox','biz','new','session','dep',1,'conversation.message','ADMITTED',NULL,NULL,NULL,NULL);
 INSERT INTO "BotJob" VALUES ('old-job','PROCESS_INBOX','old-inbox','biz','dep',1,'POISON',5,5,NULL,NULL,'invalid social continuation');`)
}
async function group() {return selectConsolidationGroupTx(tx,{...scope, sessionId:'session', handoffFenceEpoch:0, revision:1n,state:{},currentEventId:'new',isRestart:text=>text==='/reset'})}
try {
 await seed()
 assert.deepEqual((await group())?.envelope.eventIds,['new'],'terminal exhausted text must not be replayed with a new greeting')
 const { hasEarlierConversationInputTx } = await import('../src/conversational-bot/terminal-inbox-recovery.js')
 const order = () => hasEarlierConversationInputTx(tx,{...scope,admittedAt:new Date('2026-10-13T12:00:00Z'),providerEventId:'new'})
 const status=async()=> (await db.query<{status:string,error:string}>(`SELECT "status","error" FROM "BotActionInbox" WHERE "id"='old-inbox'`)).rows[0]!
 assert.equal((await status()).status,'FAILED'); assert.equal((await status()).error,'PROCESS_INBOX_EXHAUSTED_WITHOUT_EFFECTS')
 assert.equal((await db.query<{status:string}>(`SELECT "status" FROM "BotProviderEvent" WHERE "id"='old'`)).rows[0]!.status,'REJECTED')
 assert.equal((await db.query<{lastError:string}>(`SELECT "lastError" FROM "BotJob"`)).rows[0]!.lastError,'invalid social continuation')
 assert.equal(await order(),false)
 console.log('PASS terminal exhaustion settles metadata, retains audit and unblocks order/consolidation')
 await seed()
 await db.exec(`INSERT INTO "BotProviderEvent" VALUES ('reset','biz','MESSAGE','{"fromPhone":"5491100","messageType":"text","textBody":"/reset"}','2026-10-13T11:59:00Z','ADMITTED','channel','reset-msg');
 INSERT INTO "BotActionInbox" VALUES ('reset-inbox','biz','reset','session','dep',1,'conversation.message','ADMITTED',NULL,NULL,NULL,NULL);
 INSERT INTO "BotJob" VALUES ('reset-job','PROCESS_INBOX','reset-inbox','biz','dep',1,'READY',0,5,NULL,NULL,NULL);`)
 assert.equal(await group(),null,'new text must wait for the current reset after retiring only the older exhausted input')
 assert.equal(await hasEarlierConversationInputTx(tx,{...scope,admittedAt:new Date('2026-10-13T11:59:00Z'),providerEventId:'reset'}),false,'reset may now proceed past historical exhausted input')
 assert.equal((await status()).status,'FAILED')
 // Model the existing reset settlement; production reset/CAS/effect guards have separate runtime coverage.
 await db.exec(`UPDATE "BotActionInbox" SET "status"='PROCESSED' WHERE "id"='reset-inbox'; UPDATE "BotProviderEvent" SET "status"='PROCESSED' WHERE "id"='reset'; UPDATE "BotJob" SET "status"='DONE' WHERE "id"='reset-job';`)
 assert.deepEqual((await group())?.envelope.eventIds,['new'],'after reset settles, only new input proceeds, without historical replay')
 assert.equal(await order(),false)
 console.log('PASS ordered historical exhaustion → reset → new text')
 await seed(); await db.exec(`UPDATE "BotActionInbox" SET "error"='prior diagnostic' WHERE "id"='old-inbox'`)
 assert.equal(await order(),false); assert.equal((await status()).error,'prior diagnostic\nPROCESS_INBOX_EXHAUSTED_WITHOUT_EFFECTS','prior inbox diagnostic remains in audit')
 for (const [name,change] of [
 ['retry',`UPDATE "BotJob" SET "status"='RETRY',"attempts"=4`],
 ['unexhausted poison',`UPDATE "BotJob" SET "attempts"=4`],
 ['job lease',`UPDATE "BotJob" SET "leasedUntil"='2100-01-01'`],
 ['inbox lease',`UPDATE "BotActionInbox" SET "claimToken"='active',"claimedUntil"='2100-01-01' WHERE "id"='old-inbox'`],
 ['selected inbox',`UPDATE "BotActionInbox" SET "status"='SELECTED' WHERE "id"='old-inbox'`],
 ['operation key',`UPDATE "BotActionInbox" SET "operationKey"='operation' WHERE "id"='old-inbox'`],
 ['uncertain operation',`INSERT INTO "BotOperation" VALUES ('operation','biz','session','operation','PENDING')`],
 ['unknown delivery',`INSERT INTO "BotOutbox" VALUES ('out','biz','session','t','UNKNOWN',NULL)`],
 ['live dispatch',`INSERT INTO "BotDispatchClaim" VALUES ('d','biz','session','old-inbox','other','CLAIMED','2100-01-01')`],
 ['uncertain dispatch',`INSERT INTO "BotDispatchClaim" VALUES ('d','biz','session',NULL,'other','UNKNOWN',NULL)`],
 ['duplicate inbox',`INSERT INTO "BotActionInbox" SELECT 'sibling',"businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","actionType","status","claimToken","claimedUntil","operationKey","error" FROM "BotActionInbox" WHERE "id"='old-inbox'`],
 ['committed transition',`INSERT INTO "BotTransitionLog" VALUES ('t','biz','session','dep',1,1,'conversation.message','{}','old')`],
 ['grouped transition',`INSERT INTO "BotTransitionLog" VALUES ('t','biz','session','dep',1,1,'conversation.message','{"consolidation":{"eventIds":["old"]}}','other')`],
 ['wrong generation',`UPDATE "BotJob" SET "deploymentGeneration"=2`],
 ['active sibling job',`INSERT INTO "BotJob" VALUES ('sibling','RECOVER_BOOKING_CONFIRMATION','old-inbox','biz','dep',1,'LEASED',1,5,'lease','2100-01-01',NULL)`],
 ['image',`UPDATE "BotProviderEvent" SET "payload"=jsonb_set("payload",'{messageType}','"image"') WHERE "id"='old'`],
 ['confirmation action',`UPDATE "BotActionInbox" SET "actionType"='booking.confirm' WHERE "id"='old-inbox'`]
 ] as const) {
  await seed(); await db.exec(change); assert.equal(await order(),true,name+' must remain blocking'); await group(); assert.equal((await status()).status,name==='selected inbox'?'SELECTED':'ADMITTED',name+' must not be silently abandoned'); console.log('PASS guard '+name)
 }
 await seed(); await db.exec(`UPDATE "BotProviderEvent" SET "payload"=jsonb_set("payload",'{textBody}','"/reset"') WHERE "id"='old'`)
 assert.equal(await order(),false,'exhausted failed reset can settle without executing it')
 await seed(); await db.exec(`UPDATE "BotJob" SET "status"='READY',"attempts"=0; UPDATE "BotProviderEvent" SET "payload"=jsonb_set("payload",'{textBody}','"/reset"') WHERE "id"='old'`)
 assert.equal(await group(),null,'a live reset remains a consolidation barrier'); assert.equal(await order(),true)
 await seed(); await db.exec(`UPDATE "BotJob" SET "businessId"='other'`); assert.equal(await order(),true,'foreign job cannot authorize local metadata settlement')
 await seed(); await db.exec(`UPDATE "BotJob" SET "status"='READY'; UPDATE "BotProviderEvent" SET "payload"=jsonb_set("payload",'{fromPhone}','"+54 9 1100"') WHERE "id"='old'`)
 assert.equal(await order(),true,'formatted provider identity must not bypass a live predecessor')
 await seed()
 const resource='conversation-compute:'+createHash('sha256').update(JSON.stringify(['biz',scope.phone])).digest('hex')
 await db.query(`INSERT INTO "BotDispatchClaim" VALUES ('current','biz',NULL,$1,'current-token','CLAIMED','2100-01-01')`,[resource])
 assert.equal(await order(),true,'another live phone-compute claim remains a barrier')
 assert.equal(await hasEarlierConversationInputTx(tx,{...scope,currentClaimToken:'current-token',admittedAt:new Date('2026-10-13T12:00:00Z'),providerEventId:'new'}),false,'only caller-owned current claim is excluded')
 await seed(); await db.query(`INSERT INTO "BotDispatchClaim" VALUES ('current','biz',NULL,$1,'current-token','UNKNOWN',NULL)`,[resource])
 assert.equal(await hasEarlierConversationInputTx(tx,{...scope,currentClaimToken:'current-token',admittedAt:new Date('2026-10-13T12:00:00Z'),providerEventId:'new'}),true,'uncertain dispatch remains blocking even with caller token')
 await seed()
 await assert.rejects(db.transaction(async pg=> {
  const transactional={async $queryRaw(q:Prisma.Sql){return (await pg.query(q.text,q.values)).rows}} as never
  assert.equal(await hasEarlierConversationInputTx(transactional,{...scope,admittedAt:new Date('2026-10-13T12:00:00Z'),providerEventId:'new'}),false)
  throw new Error('controlled rollback')
 }),/controlled rollback/)
 assert.equal((await status()).status,'ADMITTED','rollback restores original lifecycle and preserves retry ordering')
 console.log('PASS reset barrier and tenant scope remain strict')
} finally {await db.close()}
