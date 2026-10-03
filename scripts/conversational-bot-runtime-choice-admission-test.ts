import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import { PrismaAuthoritativeAdmissionRepository } from '../src/bot-options/infrastructure/prisma-admission.js'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
const policyRow = {businessId:'a',customerCode:'WX-38N6UG',deploymentId:'dep',generation:1,configurationId:'cfg',configurationBusinessId:'a',configurationStatus:'ACTIVE',engineKey:'deterministic-options',definition:{conversation:{schemaVersion:1,engine:'conversational-booking-v1'}}}
const policy = resolveConversationPolicy(policyRow)!
const draft = initialDialogueState('a')
const scope = {businessId:'a',conversationKey:'session',policyKey:'cfg',policyGeneration:1,revision:'2'}
const question = issueChoiceQuestion(scope,draft,{kind:'service',title:'Servicios',choices:[{label:'Service',operation:{kind:'service',serviceId:'s'}}]})
const prompt = {promptId:'prompt',sessionId:'session',businessId:'a',deploymentId:'dep',deploymentGeneration:1,revision:2n,stateRevision:2n,mode:'FUNCTIONAL',status:'OPEN',
  firstActionAt:null,lastActionAt:null,settleAt:null,absoluteAt:null,resolvedAt:null,choiceToken:'abcdefghijk',actionType:'conversation.choice',entityType:null,entityId:null,
  payload:{question,choiceId:publicChoiceQuestion(question).choices[0]!.id},labelSnapshot:'Service',sortOrder:0,dbNow:new Date('2026-10-02T15:00:00Z'),
  state:projectConversationDraft(draft,policy),businessTimezone:'UTC',sessionStatus:'ACTIVE',handoffClaimsPausedAt:null}
async function admit(change: Record<string,unknown> = {}, marked = true) {
  const writes: {sql:string,values:unknown[]}[] = []
  const tx: any = {$queryRaw: async (q:any) => {
    if (q.sql.includes('conversation-policy')) return [{...policyRow,definition:marked?policyRow.definition:{}}]
    if (q.sql.includes('FROM "BotPrompt" p')) return [{...prompt,...change}]
    return []
  },$executeRaw:async(q:any) => {writes.push(q);return 1}}
  const repository = new PrismaAuthoritativeAdmissionRepository(tx,{depositProofIngressEnabled:false})
  await repository.classifyProviderEventTx(tx,{route:{kind:'new',businessId:'a',deploymentId:'dep',generation:1,appSecret:null,appSecretPrevious:null,appSecretPreviousValidUntil:null},
    event:{kind:'message',messageType:'interactive',interactiveReplyId:'b1.abcdefghijklmnop.abcdefghijk',textBody:'FORGED LABEL',fromPhone:'qa',providerMessageId:'message',phoneNumberId:'channel'} as never,providerEventId:'event',contextWindowEvaluated:true})
  return writes
}
const accepted = await admit()
assert.ok(accepted.some(q => q.values.includes('conversation.choice')), 'marked policy admits own typed action')
assert.ok(accepted.some(q => q.values.includes('PROCESS_INBOX')))
assert.ok(!accepted.some(q => q.values.includes('RECONCILE_PROMPT')))
const packet = accepted.flatMap(q=>q.values).filter((value):value is string => typeof value === 'string').find(value=>value.startsWith('{') && value.includes('conversationChoice'))
assert.ok(packet)
assert.equal(JSON.parse(packet!).fromPhone,'qa')
assert.equal(JSON.parse(packet!).conversationChoice.choiceId,prompt.payload.choiceId)
for (const change of [{actionType:'booking.confirm'},{status:'RESOLVED'},{revision:3n},{stateRevision:1n},{deploymentGeneration:2},{sessionStatus:'HUMAN_TAKEN'},{handoffClaimsPausedAt:new Date()},
  {payload:{...prompt.payload,question:{...question,scope:{...scope,businessId:'b'}}}}, {payload:{...prompt.payload,choiceId:'c1.bad.bad'}},
  {state:projectConversationDraft({...draft,customerName:'Changed'},policy)}]) {
  const rejected = await admit(change)
  assert.ok(rejected.some(q => q.values.includes('REJECTED')),JSON.stringify(change,(_,v)=>typeof v==='bigint'?String(v):v))
  assert.ok(!rejected.some(q => q.values.includes('PROCESS_INBOX')))
}
assert.ok((await admit({},false)).some(q=>q.values.includes('REJECTED')), 'legacy policy cannot execute conversation action')
console.log('conversational runtime choice admission: PASS')

// Execute production prompt joins, claim update, inbox insertion and job enqueue in one offline transaction.
const db=new PGlite()
try {
  await db.exec(`CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','RESOLVED','INVALIDATED','EXPIRED');
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','REJECTED');CREATE TYPE "BotJobStatus" AS ENUM ('READY','RETRY');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');CREATE TYPE "BotHandoffStatus" AS ENUM ('TAKEN');
    CREATE TABLE "BotHandoff"("id" text,"businessId" text,"sessionId" text,"status" "BotHandoffStatus");
    CREATE TABLE "Conversation"("id" text PRIMARY KEY,"businessId" text,"phone" text);
    CREATE TABLE "BotSession"("id" text PRIMARY KEY,"businessId" text,"conversationId" text,"deploymentId" text,"deploymentGeneration" integer,"revision" bigint,"state" jsonb,"businessTimezone" text,"status" "BotSessionStatus","handoffClaimsPausedAt" timestamptz);
    CREATE TABLE "BotPrompt"("id" text PRIMARY KEY,"sessionId" text,"promptToken" text,"stateRevision" bigint,"mode" text,"status" "BotPromptStatus","firstActionAt" timestamptz,"lastActionAt" timestamptz,"settleAt" timestamptz,"absoluteAt" timestamptz,"resolvedAt" timestamptz);
    CREATE TABLE "BotPromptChoice"("id" text PRIMARY KEY,"promptId" text,"choiceToken" text,"actionType" text,"entityType" text,"entityId" text,"payload" jsonb,"labelSnapshot" text,"sortOrder" integer);
    CREATE TABLE "BotActionInbox"("id" text PRIMARY KEY,"businessId" text,"providerEventId" text UNIQUE,"sessionId" text,"promptId" text,"providerMessageId" text,"choiceToken" text,"actionType" text,"deploymentId" text,"deploymentGeneration" integer,"payload" jsonb,"expectedRevision" bigint,"receivedAt" timestamptz,"status" "BotInboxStatus","error" text);
    CREATE TABLE "BotJob"("id" text PRIMARY KEY,"kind" text,"aggregateId" text,"businessId" text,"deploymentId" text,"deploymentGeneration" integer,"expectedRevision" bigint,"availableAt" timestamptz,"status" "BotJobStatus","updatedAt" timestamptz,"leaseToken" text,"leasedUntil" timestamptz,UNIQUE("kind","aggregateId"));
    INSERT INTO "Conversation" VALUES ('owner','a','qa');
    INSERT INTO "BotSession" VALUES ('session','a','owner','dep',1,2,'{}','UTC','ACTIVE',NULL);
    INSERT INTO "BotPrompt" ("id","sessionId","promptToken","stateRevision","mode","status") VALUES ('prompt','session','abcdefghijklmnop',2,'FUNCTIONAL','OPEN');`)
  await db.query(`UPDATE "BotSession" SET "state"=$1::jsonb`,[JSON.stringify(prompt.state)])
  await db.query(`INSERT INTO "BotPromptChoice" VALUES ('choice','prompt','abcdefghijk','conversation.choice',NULL,NULL,$1::jsonb,'Service',0)`,[JSON.stringify(prompt.payload)])
  let counter=0
  const run=async(fail=false,foreign=false)=>db.transaction(async sql=>{
    const values=(q:any)=>q.values.map((v:unknown)=>v instanceof Date?v.toISOString():v)
    const tx:any={$queryRaw:async(q:any)=>{
      if(q.sql.includes('conversation-policy'))return [policyRow]
      return (await sql.query(q.text,values(q))).rows.map((r:any)=>({...r,revision:BigInt(r.revision),stateRevision:BigInt(r.stateRevision)}))
    },$executeRaw:async(q:any)=>(await sql.query(q.text,values(q))).affectedRows}
    const repository=new PrismaAuthoritativeAdmissionRepository(tx,{depositProofIngressEnabled:false})
    await repository.classifyProviderEventTx(tx,{route:{kind:'new',businessId:foreign?'foreign':'a',deploymentId:'dep',generation:1,appSecret:null,appSecretPrevious:null,appSecretPreviousValidUntil:null},
      event:{kind:'message',messageType:'interactive',interactiveReplyId:'b1.abcdefghijklmnop.abcdefghijk',textBody:'not an instruction',fromPhone:'qa',providerMessageId:'message-'+counter,phoneNumberId:'channel'} as never,
      providerEventId:'event-'+counter++,contextWindowEvaluated:true})
    if(fail)throw new Error('admission rollback fixture')
  })
  await assert.rejects(()=>run(true),/rollback/)
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotPrompt"`)).rows,[{status:'OPEN'}])
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotJob"`)).rows[0]!.count,0)
  await run(false,true)
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotPrompt"`)).rows,[{status:'OPEN'}],'foreign owner join cannot claim prompt')
  await run()
  assert.deepEqual((await db.query(`SELECT "status" FROM "BotPrompt"`)).rows,[{status:'RESOLVED'}])
  assert.deepEqual((await db.query(`SELECT "kind","businessId","expectedRevision"::text FROM "BotJob"`)).rows,[{kind:'PROCESS_INBOX',businessId:'a',expectedRevision:'2'}])
  const admitted=(await db.query<{payload:any}>(`SELECT "payload" FROM "BotActionInbox" WHERE "status"='ADMITTED'`)).rows[0]!
  assert.equal(admitted.payload.fromPhone,'qa');assert.deepEqual(admitted.payload.conversationChoice,prompt.payload)
  await run()
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotActionInbox" WHERE "status"='ADMITTED'`)).rows[0]!.count,1,'resolved prompt rejects replay')
  assert.equal((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotJob"`)).rows[0]!.count,1)
  console.log('conversational choice admission actual SQL/owner tenant/rollback/replay/job atomicity: PASS')
} finally {await db.close()}
