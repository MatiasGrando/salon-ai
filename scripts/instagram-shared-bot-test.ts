import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH = '__instagram_shared_bot_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
const { loadConversationPolicy } = await import('../src/conversational-bot/runtime-policy.js')
const database = new PGlite()
await database.exec(`CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP','INSTAGRAM');
CREATE TABLE "Business" (id text primary key,"customerCode" text);
CREATE TABLE "BusinessBotConfiguration" (id text primary key,"businessId" text,status text,definition jsonb);
CREATE TABLE "BotChannelDeployment" (id text primary key,"businessId" text,channel "BotChannel",generation int,"engineKey" text,"activeConfigurationId" text,"claimsPausedAt" timestamp);
INSERT INTO "Business" VALUES ('business','TEST');
INSERT INTO "BusinessBotConfiguration" VALUES ('config','business','ACTIVE','{"conversation":{"engine":"conversational-booking-v1","schemaVersion":1}}');
INSERT INTO "BotChannelDeployment" VALUES ('ig-deployment','business','INSTAGRAM',1,'deterministic-options','config',NULL);`)
const client = { $queryRaw: async (query: { text:string; values:unknown[] }) => (await database.query(query.text,query.values)).rows }
try {
  const instagram = await loadConversationPolicy(client as never, { businessId:'business',deploymentId:'ig-deployment',generation:1,channel:'INSTAGRAM' } as never)
  assert.ok(instagram, 'An Instagram deployment must load the same published conversational policy without a WhatsApp phone/deployment')
  assert.equal(instagram.configurationId,'config')
  assert.equal(await loadConversationPolicy(client as never,{businessId:'business',deploymentId:'ig-deployment',generation:1}),null,'WhatsApp default cannot load an Instagram deployment')
  assert.equal(await loadConversationPolicy(client as never,{businessId:'foreign',deploymentId:'ig-deployment',generation:1,channel:'INSTAGRAM'} as never),null,'Cross-business lookup must fail closed')
  await database.exec(`ALTER TABLE "Business" ADD COLUMN "timezone" text DEFAULT 'UTC', ADD COLUMN "accountStatus" text DEFAULT 'ACTIVE';
ALTER TABLE "BotChannelDeployment" ADD COLUMN "legacyDispatchCoverageVersion" int DEFAULT 1;
CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
CREATE TYPE "BotJobStatus" AS ENUM ('READY','LEASED','DONE','RETRY','POISON');
CREATE TABLE "InstagramLead" (id text primary key,"businessId" text,"instagramUserId" text,"referralCode" text unique,"lastMessage" text,"createdAt" timestamp DEFAULT now(),"updatedAt" timestamp DEFAULT now(),UNIQUE("businessId","id"),UNIQUE("businessId","instagramUserId"));
CREATE TABLE "BotSession" (id text primary key,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"conversationId" text,channel "BotChannel" DEFAULT 'WHATSAPP',status "BotSessionStatus" DEFAULT 'ACTIVE',"revision" bigint DEFAULT 0,"businessTimezone" text,state jsonb,"createdAt" timestamp DEFAULT now(),"updatedAt" timestamp DEFAULT now(),"draftTouchedAt" timestamp,"draftExpiresAt" timestamp);
CREATE TABLE "BusinessInstagramConfig" ("businessId" text primary key,"instagramAccountId" text,enabled boolean DEFAULT true);
CREATE TABLE "BusinessFeatureSettings" ("businessId" text primary key,"botEnabled" boolean DEFAULT true);
CREATE TABLE "InstagramMessage" (id text primary key,"leadId" text,"providerMessageId" text unique,direction text,body text,status text,metadata jsonb,"createdAt" timestamp);
CREATE TABLE "BotProviderEvent" (id text primary key,provider text,"eventKey" text,"eventType" text,"businessId" text,"providerMessageId" text,payload jsonb,"providerOccurredAt" timestamp,"admittedAt" timestamp,status text,UNIQUE(provider,"eventKey"));
CREATE TABLE "BotActionInbox" (id text primary key,"businessId" text,"providerEventId" text,"sessionId" text,"providerMessageId" text,"actionType" text,"deploymentId" text,"deploymentGeneration" int,payload jsonb,"expectedRevision" bigint,"promptId" text,"choiceToken" text,status text);
CREATE TABLE "BotPrompt" (id text primary key,"sessionId" text,"stateRevision" bigint,status text,"openedAt" timestamp,"outboxMessageId" text);
CREATE TABLE "BotPromptChoice" ("promptId" text,"choiceToken" text,payload jsonb,"labelSnapshot" text,"sortOrder" int,"actionType" text);
CREATE TABLE "BotOutbox" (id text,"sessionId" text,"businessId" text,status text);
CREATE TABLE "BotJob" (id text primary key,kind text,"aggregateId" text,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"expectedRevision" bigint,"availableAt" timestamp,status "BotJobStatus","leaseToken" text,"leasedUntil" timestamp,"updatedAt" timestamp,UNIQUE(kind,"aggregateId"));
INSERT INTO "BusinessInstagramConfig" VALUES ('business','ig-account',true);`)
  const { readFile }=await import('node:fs/promises')
  await database.exec(await readFile(new URL('../prisma/migrations/20261027020000_instagram_conversational_bot/migration.sql',import.meta.url),'utf8'))
  await database.exec(await readFile(new URL('../prisma/migrations/20261027020100_instagram_bot_identity/migration.sql',import.meta.url),'utf8'))
  await database.query('INSERT INTO "BotSession" (id,"businessId","deploymentId","deploymentGeneration",channel) VALUES ($1,$2,$3,1,$4)',['legacy-null','business','wa-dep','WHATSAPP'])
  await assert.rejects(database.query('INSERT INTO "BotSession" (id,"businessId","deploymentId","deploymentGeneration",channel) VALUES ($1,$2,$3,1,$4)',['invalid-ig','business','ig-deployment','INSTAGRAM']),/provider_identity_check/)
  const orm=(tx:any)=>({$queryRaw:async(q:any)=>(await tx.query(q.text,q.values)).rows,$executeRaw:async(q:any)=>{const result=await tx.query(q.text,q.values);return result.affectedRows??result.rows.length}})
  const admissionClient={...orm(database),$transaction:async(fn:any)=>database.transaction(tx=>fn(orm(tx)))}
  const { PrismaInstagramBotAdmission }=await import('../src/services/instagram-bot-admission.js')
  const { resolveInstagramBotConfig }=await import('../src/config/instagram-bot.js')
  assert.equal(resolveInstagramBotConfig({}).enabled,false)
  assert.throws(()=>resolveInstagramBotConfig({INSTAGRAM_CONVERSATIONAL_BOT_ENABLED:'true'}),/allowlist/)
  const admission=new PrismaInstagramBotAdmission(admissionClient as never,{enabled:true,businessIds:['business']},true)
  const event={kind:'messaging' as const,instagramAccountIds:['ig-account'],senderId:'5491112345678',messageId:'ig-message',text:'quiero reservar',timestamp:Date.now()}
  await assert.rejects(admission.admit({businessId:'business',accountId:'ig-account',event,signatureVerified:false}),/authenticated/)
  const unready=new PrismaInstagramBotAdmission(admissionClient as never,{enabled:true,businessIds:['business']})
  await assert.rejects(unready.admit({businessId:'business',accountId:'ig-account',event,signatureVerified:true}),/processor unavailable/)
  const disabled=new PrismaInstagramBotAdmission(admissionClient as never,{enabled:false,businessIds:[]})
  assert.deepEqual(await disabled.admit({businessId:'business',accountId:'ig-account',event,signatureVerified:false}),{route:'legacy'})
  const admitted=await admission.admit({businessId:'business',accountId:'ig-account',event,signatureVerified:true})
  assert.equal(admitted.route,'new');assert.equal('status' in admitted&&admitted.status,'admitted')
  assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotJob"')).rows[0]!.n,1)
  const session=(await database.query<Record<string,unknown>>('SELECT * FROM "BotSession" WHERE channel=$1',['INSTAGRAM'])).rows[0]!
  assert.equal(session.conversationId,null);assert.equal(session.instagramAccountId,'ig-account')
  assert.equal((await admission.admit({businessId:'business',accountId:'ig-account',event,signatureVerified:true}) as any).status,'duplicate')
  assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotJob"')).rows[0]!.n,1)
  const beforeWindow = (await database.query('SELECT * FROM "BotSession" WHERE id=$1',[session.id])).rows[0]
  for (const [label,timestamp] of [['old',Date.now()-25*60*60*1000],['future',Date.now()+60*60*1000],['missing',undefined]] as const) {
    const result=await admission.admit({businessId:'business',accountId:'ig-account',event:{...((({timestamp,...rest})=>rest)(event)),messageId:'invalid-window-'+label,...(timestamp===undefined?{}:{timestamp})},signatureVerified:true})
    assert.equal((result as any).status,'outside_window','A '+label+' signed event cannot enter effect processing')
    assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotJob"')).rows[0]!.n,1,'Invalid event cannot schedule booking, payment, choice or reschedule effects')
    assert.deepEqual((await database.query('SELECT * FROM "BotSession" WHERE id=$1',[session.id])).rows[0],beforeWindow,'Invalid event must not renew/reset a draft')
    assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "InstagramMessage" WHERE "providerMessageId"=$1',['invalid-window-'+label])).rows[0]!.n,1,'CRM retains the authenticated inbound')
  }
  await database.query('UPDATE "InstagramLead" SET "aiEnabled"=false,"botPausedAt"=now()')
  assert.equal((await admission.admit({businessId:'business',accountId:'ig-account',event:{...event,messageId:'human-paused'},signatureVerified:true}) as any).status,'paused')
  assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotJob"')).rows[0]!.n,1)
  await database.query('INSERT INTO "InstagramLead" (id,"businessId","instagramUserId","referralCode","aiEnabled","botPausedAt") VALUES ($1,$2,$3,$4,false,now())',['paused-first','business','no-session-user','paused-referral'])
  assert.equal((await admission.admit({businessId:'business',accountId:'ig-account',event:{...event,senderId:'no-session-user',messageId:'pause-before-session'},signatureVerified:true}) as any).status,'paused')
  assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotSession" WHERE "instagramLeadId"=$1',['paused-first'])).rows[0]!.n,0,'Human pause exists before any bot session')
  await assert.rejects(database.query('INSERT INTO "BotSession" (id,"businessId","deploymentId","deploymentGeneration",channel,"instagramLeadId","instagramAccountId") VALUES ($1,$2,$3,1,$4,$5,$6)',['foreign-session','foreign','ig-deployment','INSTAGRAM','paused-first','ig-account']),/tenant_fk/)
  await database.query('UPDATE "BotChannelDeployment" SET "activeConfigurationId"=NULL WHERE id=$1',['ig-deployment'])
  await assert.rejects(admission.admit({businessId:'business',accountId:'ig-account',event:{...event,messageId:'bad-config'},signatureVerified:true}),/deployment/)
  assert.equal((await database.query<{n:number}>('SELECT count(*)::int n FROM "BotProviderEvent"')).rows[0]!.n,6,'Failed admission transaction leaves no partial event')
  console.log('OK: Instagram atomic admission, replay deduplication, durable human pause and migration identity guards')
  console.log('OK: Instagram loads the existing conversational policy with exact channel and tenant scope')
} finally { await database.close() }
