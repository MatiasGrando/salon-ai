import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {guardConsolidatedOutboxTx} from '../src/conversational-bot/inbound-consolidation.js'
const db=new PGlite()
const envelope={version:1,businessId:'a',sessionId:'session',deploymentId:'dep',generation:1,handoffFenceEpoch:0,
  baseState:{schemaVersion:1,selectedService:'cut'},eventIds:['choice-event'],sealed:true,revision:'2'}
const input={id:'interactive',businessId:'a',sessionId:'session',claimToken:'lease',payload:{to:'qa',consolidation:envelope}}
try {
  await db.exec(`CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ','SKIPPED');
    CREATE TABLE "BotOutbox"("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"status" "BotOutboxStatus","leaseToken" text,"leasedUntil" timestamptz,"errorCode" text,"payload" jsonb);
    CREATE TABLE "BotTransitionLog"("id" text,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" integer,"revisionTo" bigint,"actionType" text,"providerEventId" text);
    CREATE TABLE "BotProviderEvent"("id" text PRIMARY KEY,"businessId" text,"eventType" text,"payload" jsonb,"admittedAt" timestamptz,"status" text DEFAULT 'ADMITTED');
    CREATE TABLE "BotActionInbox"("id" text,"businessId" text,"providerEventId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" integer,"actionType" text,"status" text);
    CREATE TABLE "BotSession"("id" text,"businessId" text,"revision" bigint,"state" jsonb,"deploymentGeneration" integer,"handoffFenceEpoch" integer,"status" text,"handoffClaimsPausedAt" timestamptz);
    INSERT INTO "BotSession" VALUES ('session','a',2,'{"selectedService":"cut"}',1,0,'ACTIVE',NULL);
    INSERT INTO "BotTransitionLog" VALUES ('typed','a','session','dep',1,2,'conversation.choice','choice-event');
    INSERT INTO "BotProviderEvent" ("id","businessId","eventType","payload","admittedAt") VALUES ('choice-event','a','MESSAGE','{"fromPhone":"qa","messageType":"interactive"}','2026-10-01T12:00:00Z');
    INSERT INTO "BotProviderEvent" ("id","businessId","eventType","payload","admittedAt") VALUES ('later','a','MESSAGE','{"fromPhone":"qa","messageType":"text","textBody":"mañana"}','2026-10-01T12:00:01Z');
    INSERT INTO "BotActionInbox" VALUES ('later-inbox','a','later',NULL,'dep',1,'input.initial','ADMITTED');
    INSERT INTO "BotOutbox" VALUES ('fragment','a','session','typed','PENDING',NULL,NULL,NULL,'{}');
    INSERT INTO "BotOutbox" VALUES ('interactive','a','session','typed','CLAIMED','lease',NULL,NULL,'{}');`)
  const run=()=>db.transaction(async sql=>guardConsolidatedOutboxTx({$queryRaw:async(q:any)=>(await sql.query(q.text,q.values)).rows,
    $executeRaw:async(q:any)=>(await sql.query(q.text,q.values)).affectedRows} as never,input))
  assert.equal(await run(),'superseded','later durable text supersedes pending typed response without replaying the choice')
  assert.deepEqual((await db.query(`SELECT "state" FROM "BotSession"`)).rows,[{state:{selectedService:'cut'}}])
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotActionInbox"`)).rows,[{status:'ADMITTED'}],'later text retains its own durable processing')
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox" WHERE "status"='SKIPPED'`)).rows[0]!.count,2,'whole fragment group supersedes atomically')
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='lease';DELETE FROM "BotActionInbox";`)
  assert.equal(await run(),'superseded','unclassified durable journal text also suppresses stale output')
  await db.exec(`INSERT INTO "BotActionInbox" VALUES ('later-inbox','a','later',NULL,'dep',1,'input.initial','ADMITTED');`)
  // Once the later text has committed, supersede only the earlier output, not either state transition.
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='lease';UPDATE "BotActionInbox" SET "status"='PROCESSED',"sessionId"='session';
    INSERT INTO "BotTransitionLog" VALUES ('later-turn','a','session','dep',1,3,'conversation.message','later');
    UPDATE "BotSession" SET "revision"=3,"state"='{"selectedService":"cut","date":"2026-10-02"}';
    INSERT INTO "BotOutbox" VALUES ('latest','a','session','later-turn','PENDING',NULL,NULL,NULL,'{}');`)
  assert.equal(await run(),'superseded')
  assert.deepEqual((await db.query(`SELECT "state" FROM "BotSession"`)).rows,[{state:{selectedService:'cut',date:'2026-10-02'}}])
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotOutbox" WHERE "id"='latest'`)).rows,[{status:'PENDING'}],'latest response is the only surviving response')
  await db.exec(`DELETE FROM "BotOutbox" WHERE "id"='latest';DELETE FROM "BotTransitionLog" WHERE "id"='later-turn';UPDATE "BotActionInbox" SET "status"='ADMITTED';`)
  for(const frozen of ['SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ']) {
    await db.query(`UPDATE "BotOutbox" SET "status"=CASE WHEN "id"='fragment' THEN $1::"BotOutboxStatus" ELSE 'CLAIMED'::"BotOutboxStatus" END,"leaseToken"='lease'`,[frozen])
    assert.equal(await run(),'ready',frozen)
    assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox" WHERE "status"='SKIPPED'`)).rows[0]!.count,0)
  }
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='lease';UPDATE "BotActionInbox" SET "deploymentGeneration"=2;`)
  assert.equal(await run(),'ready','foreign generation cannot supersede response')
  await db.exec(`UPDATE "BotActionInbox" SET "deploymentGeneration"=1;UPDATE "BotProviderEvent" SET "businessId"='foreign' WHERE "id"='later';`)
  assert.equal(await run(),'ready','foreign tenant cannot supersede response')
  await db.exec(`UPDATE "BotProviderEvent" SET "businessId"='a' WHERE "id"='later';UPDATE "BotTransitionLog" SET "actionType"='conversation.message'`)
  assert.equal(await run(),'ready','sealed non-choice legacy group unchanged')
  await db.exec(`UPDATE "BotTransitionLog" SET "actionType"='conversation.choice';UPDATE "BotOutbox" SET "leaseToken"='lost' WHERE "id"='interactive'`)
  assert.equal(await run(),'defer','lost claim cannot suppress anything')
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='lease';UPDATE "BotSession" SET "handoffFenceEpoch"=1;`)
  assert.equal(await run(),'ready','handoff fence mismatch leaves sender authority intact')
  await db.exec(`UPDATE "BotSession" SET "handoffFenceEpoch"=0,"handoffClaimsPausedAt"=clock_timestamp();`)
  assert.equal(await run(),'ready','handoff pause cannot supersede under stale authority')
  await db.exec(`UPDATE "BotSession" SET "handoffClaimsPausedAt"=NULL;`)
  await db.query(`INSERT INTO "BotOutbox" VALUES ('predecessor','a','session','previous','PENDING',NULL,NULL,NULL,$1::jsonb)`,[JSON.stringify({consolidation:{...envelope,revision:'1'}})])
  assert.equal(await run(),'defer','existing predecessor revision delivery order preserved')
  console.log('conversational typed response pre-send supersession/selection preserved/frozen fragments/tenant/claim: PASS')
} finally {await db.close()}
