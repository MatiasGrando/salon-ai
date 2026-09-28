import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { ingestNewBotEvent } from '../src/new-bot/application/ingress.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'
import { createNewBotQueueRepository } from '../src/new-bot/infrastructure/queue-repository.js'
import { createNewBotCommitter, type NewBotPreparedResult } from '../src/new-bot/infrastructure/commit-repository.js'
import { createNewBotSenderRepository, createNewBotSenderRunner } from '../src/new-bot/infrastructure/sender-repository.js'

const migrationPaths = [
  '../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql',
  '../prisma/migrations/20260928010000_new_bot_ordered_queue/migration.sql',
  '../prisma/migrations/20260929010000_new_bot_atomic_commit/migration.sql',
  '../prisma/migrations/20260929020000_new_bot_sender/migration.sql',
]
const migrations = await Promise.all(migrationPaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
const legacyDb = new PGlite()
try {
  await legacyDb.exec("CREATE TABLE \"Business\" (\"id\" text PRIMARY KEY); INSERT INTO \"Business\" VALUES ('tenant-a');")
  for (const migration of migrations.slice(0, 3)) await legacyDb.exec(migration)
  await legacyDb.query("INSERT INTO \"NewBotInboxEvent\" (\"id\",\"businessId\",\"vertical\",\"provider\",\"providerEventId\",\"conversationId\",\"message\",\"receivedAt\",\"processingStatus\",\"sequence\") VALUES ('legacy-event','tenant-a','salon','whatsapp','legacy-provider-event','legacy-conversation','{\"kind\":\"text\",\"text\":\"legacy\"}'::jsonb,clock_timestamp(),'COMPLETED',1)")
  await legacyDb.query("INSERT INTO \"NewBotOutboxEvent\" (\"id\",\"eventId\",\"businessId\",\"provider\",\"conversationId\",\"sequence\",\"ordinal\",\"recipientKey\",\"action\",\"processingStatus\",\"providerAcceptedAt\",\"deliveredAt\") VALUES ('legacy-outbox','legacy-event','tenant-a','whatsapp','legacy-conversation',1,0,'legacy-recipient','{\"type\":\"text\",\"text\":\"legacy\"}'::jsonb,'DELIVERED',clock_timestamp(),clock_timestamp())")
  await legacyDb.exec(migrations[3]!)
  const legacy=(await legacyDb.query<{processingStatus:string;deliveryStatus:string}>('SELECT "processingStatus","deliveryStatus" FROM "NewBotOutboxEvent" WHERE "id"=$1',['legacy-outbox'])).rows[0]
  assert.deepEqual(legacy,{processingStatus:'ACCEPTED',deliveryStatus:'DELIVERED'},'sender migration preserves legacy delivery as accepted plus delivered')
} finally { await legacyDb.close() }
const db = new PGlite()
let afterCorrelationLock: (()=>Promise<void>) | null = null
const queryTrace: string[] = []
try {
  await db.exec(`CREATE TABLE "Business" ("id" text PRIMARY KEY); INSERT INTO "Business" VALUES ('tenant-a'),('tenant-b');`)
  for (const migration of migrations) await db.exec(migration)
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return db.transaction(async (pg) => operation({ async $queryRaw(query: Prisma.Sql) {
        queryTrace.push(query.text)
        const rows=(await pg.query(query.text, query.values)).rows
        if(afterCorrelationLock && query.text.includes('pg_advisory_xact_lock')){const hook=afterCorrelationLock;afterCorrelationLock=null;await hook()}
        return rows
      } }))
    },
  }
  const ingress=createNewBotIngressRepository(client as never)
  const queue=createNewBotQueueRepository(client as never)
  const commit=createNewBotCommitter(client as never)
  const sender=createNewBotSenderRepository(client as never)
  let n=0
  const seed=async (conversationId:string, expectedRevision=0) => {
    const providerEventId=`sender-${++n}`
    await ingestNewBotEvent({businessId:'tenant-a',vertical:'salon'},{provider:'whatsapp',providerEventId,conversationId,message:{kind:'text',text:'hi'}},ingress)
    const claim=(await queue.claimBatch({batchSize:100,leaseDurationMs:60_000}))[0]!
    const prepared:NewBotPreparedResult={event:{schemaVersion:1,businessId:claim.businessId,provider:claim.provider,conversationId:claim.conversationId,vertical:claim.vertical,expectedRevision,type:'inbound-message',payload:claim.message},transition:{nextState:{step:'service'},effects:[]},actions:[{type:'text',text:'reply'}]}
    assert.equal(await commit(claim,prepared,new AbortController().signal),true)
    return (await db.query<{id:string}>('SELECT "id" FROM "NewBotOutboxEvent" WHERE "eventId"=$1',[claim.eventId])).rows[0]!.id
  }
  const state=async(id:string)=> (await db.query<{processingStatus:string;deliveryStatus:string;attemptCount:number;providerMessageId:string|null;lastErrorCode:string|null}>(
    'SELECT "processingStatus","deliveryStatus","attemptCount","providerMessageId","lastErrorCode" FROM "NewBotOutboxEvent" WHERE "id"=$1',[id])).rows[0]!
  const rls=(await db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('NewBotOutboxReceipt','NewBotOutboxReconciliation') ORDER BY relname")).rows
  assert.equal(rls.length,2)
  assert.equal(rls.every((row)=>row.relrowsecurity),true,'receipt and audit storage retain default-deny RLS')
  const fifoFirst=await seed('sender-fifo')
  const fifoSecond=await seed('sender-fifo',1)
  const fifoClaims=await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})
  assert.equal(fifoClaims.some((row)=>row.id===fifoSecond),false,'unaccepted predecessor blocks the successor')
  const fifoClaim=fifoClaims.find((row)=>row.id===fifoFirst)
  assert.ok(fifoClaim)
  assert.equal(await sender.markDispatching(fifoClaim),true)
  assert.equal(await sender.settle(fifoClaim,{kind:'accepted',providerMessageId:'fifo-accepted'}),true)
  assert.ok((await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).some((row)=>row.id===fifoSecond),'provider acceptance releases FIFO successor without waiting for delivery')
  const first=await seed('sender-one')
  let observedBeforeSend=false
  const runner=createNewBotSenderRunner(sender,{async send(input){
    const row=await state(first); observedBeforeSend=row.processingStatus==='DISPATCHING' && row.attemptCount===1
    assert.deepEqual(input.action,{type:'text',text:'reply'}); assert.equal(input.recipientKey,'sender-one')
    return {kind:'accepted',providerMessageId:'provider-1'}
  }},1)
  const accepted=await runner.runOnce({leaseDurationMs:10_000,signal:new AbortController().signal})
  assert.equal(observedBeforeSend,true,'DISPATCHING must commit before transport starts')
  assert.deepEqual(accepted,[{id:first,state:'accepted'}])
  assert.equal((await state(first)).deliveryStatus,'PENDING','provider acceptance is not delivery')
  assert.equal((await sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-1',providerMessageId:'provider-1',status:'DELIVERED'}})).matched,true)
  await sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-2',providerMessageId:'provider-1',status:'READ'}})
  await sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-3',providerMessageId:'provider-1',status:'FAILED'}})
  assert.equal((await state(first)).deliveryStatus,'READ','out-of-order failure cannot downgrade read')
  assert.equal((await sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-1',providerMessageId:'provider-1',status:'FAILED'}})).inserted,false)

  const uncertain=await seed('sender-uncertain')
  await createNewBotSenderRunner(sender,{async send(){throw new Error('do not persist raw transport text')}},1).runOnce({leaseDurationMs:10_000,signal:new AbortController().signal})
  assert.equal((await state(uncertain)).processingStatus,'UNKNOWN')
  assert.equal((await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).some((claim)=>claim.id===uncertain),false,'UNKNOWN is never resent automatically')
  await assert.rejects(sender.reconcile({businessId:'tenant-a',outboxId:uncertain,operatorId:'operator',reason:'provider lookup',requestKey:'retry-1',action:'RETRY'}),/duplicate-risk/)
  assert.equal(await sender.reconcile({businessId:'tenant-a',outboxId:uncertain,operatorId:'operator',reason:'provider lookup',requestKey:'retry-1',action:'RETRY',duplicateRiskAcknowledged:true}),true)
  assert.equal((await state(uncertain)).processingStatus,'PENDING')
  assert.equal((await db.query('SELECT 1 FROM "NewBotOutboxReconciliation" WHERE "outboxEventId"=$1',[uncertain])).rows.length,1)

  const early=await seed('sender-early-receipt')
  assert.deepEqual(await sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-early-receipt'},receipt:{idempotencyKey:'early-1',providerMessageId:'later-id',status:'DELIVERED'}}),{matched:false,inserted:true})
  const retry=await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})
  const claim=retry.find((x)=>x.id===early); assert.ok(claim)
  assert.equal(await sender.markDispatching(claim),true)
  assert.equal(await sender.settle(claim,{kind:'accepted',providerMessageId:'later-id'}),true)
  assert.equal((await state(early)).deliveryStatus,'DELIVERED','early receipt applies after trusted provider ID binding')

  const pre=await seed('sender-predispatch-expiry')
  const preClaim=(await sender.claimBatch({batchSize:100,leaseDurationMs:100})).find(x=>x.id===pre); assert.ok(preClaim)
  await db.query('UPDATE "NewBotOutboxEvent" SET "claimExpiresAt"=clock_timestamp()-INTERVAL \'1 millisecond\' WHERE "id"=$1',[pre])
  const reclaimed=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===pre); assert.ok(reclaimed)
  assert.equal(await sender.markDispatching(preClaim),false,'stale pre-dispatch token is fenced')
  assert.equal(await sender.markDispatching(reclaimed),true)
  await db.query('UPDATE "NewBotOutboxEvent" SET "claimExpiresAt"=clock_timestamp()-INTERVAL \'1 millisecond\' WHERE "id"=$1',[pre])
  await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})
  assert.equal((await state(pre)).processingStatus,'UNKNOWN','expired dispatch is uncertain, not retryable')
  assert.deepEqual(await sender.recordReceipt({trustedContext:{businessId:'tenant-b',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-3',providerMessageId:'provider-1',status:'FAILED'}}),{matched:false,inserted:true})
  assert.equal((await state(first)).deliveryStatus,'READ','receipt from another tenant cannot mutate a matching provider ID')

  const retryable=await seed('sender-retryable')
  const retryClaim=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===retryable); assert.ok(retryClaim)
  assert.equal(await sender.markDispatching(retryClaim),true)
  assert.equal(await sender.settle(retryClaim,{kind:'not_accepted',retryable:true,code:'RATE_LIMITED',retryDelayMs:0}),true)
  assert.equal((await state(retryable)).processingStatus,'PENDING')
  const retryAgain=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===retryable); assert.ok(retryAgain)
  assert.equal(await sender.settle(retryClaim,{kind:'accepted',providerMessageId:'stale'}),false,'old dispatch token cannot settle a reclaimed attempt')
  assert.equal(await sender.markDispatching(retryAgain),true)
  assert.equal(await sender.settle(retryAgain,{kind:'not_accepted',retryable:false,code:'INVALID_RECIPIENT'}),true)
  assert.equal((await state(retryable)).processingStatus,'FAILED','permanent known rejection is explicit terminal')

  const sqlFailed=await seed('sender-settlement-sql-failure')
  const sqlClaim=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===sqlFailed); assert.ok(sqlClaim)
  assert.equal(await sender.markDispatching(sqlClaim),true)
  await db.exec(`CREATE FUNCTION fail_sender_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sender settlement fixture'; END $$;
    CREATE TRIGGER fail_sender_accept_before_update BEFORE UPDATE ON "NewBotOutboxEvent" FOR EACH ROW
      WHEN (NEW."id"='${sqlFailed}' AND NEW."processingStatus"='ACCEPTED') EXECUTE FUNCTION fail_sender_accept();`)
  await assert.rejects(sender.settle(sqlClaim,{kind:'accepted',providerMessageId:'not-committed'}),/sender settlement fixture/)
  assert.equal((await state(sqlFailed)).processingStatus,'DISPATCHING','SQL error cannot report false acceptance')
  assert.equal((await state(sqlFailed)).providerMessageId,null)
  await db.exec('DROP TRIGGER fail_sender_accept_before_update ON "NewBotOutboxEvent"; DROP FUNCTION fail_sender_accept();')

  const commitFailure=await seed('sender-settlement-commit-failure')
  const commitClaim=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===commitFailure); assert.ok(commitClaim)
  assert.equal(await sender.markDispatching(commitClaim),true)
  await db.exec(`CREATE FUNCTION fail_sender_accept_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sender commit fixture'; END $$;
    CREATE CONSTRAINT TRIGGER fail_sender_accept_deferred AFTER UPDATE ON "NewBotOutboxEvent" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW."id"='${commitFailure}' AND NEW."processingStatus"='ACCEPTED') EXECUTE FUNCTION fail_sender_accept_commit();`)
  await assert.rejects(sender.settle(commitClaim,{kind:'accepted',providerMessageId:'commit-not-accepted'}),/sender commit fixture/)
  assert.equal((await state(commitFailure)).processingStatus,'DISPATCHING','deferred COMMIT failure cannot falsely accept sender message')
  await db.exec('DROP TRIGGER fail_sender_accept_deferred ON "NewBotOutboxEvent"; DROP FUNCTION fail_sender_accept_commit();')
  await db.exec(`CREATE FUNCTION fail_sender_receipt_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt commit fixture'; END $$;
    CREATE CONSTRAINT TRIGGER fail_sender_receipt_deferred AFTER INSERT ON "NewBotOutboxReceipt" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW."idempotencyKey"='receipt-commit-failure') EXECUTE FUNCTION fail_sender_receipt_commit();`)
  await assert.rejects(sender.recordReceipt({trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-one'},receipt:{idempotencyKey:'receipt-commit-failure',providerMessageId:'provider-1',status:'DELIVERED'}}),/receipt commit fixture/)
  assert.equal((await db.query('SELECT 1 FROM "NewBotOutboxReceipt" WHERE "idempotencyKey"=$1',['receipt-commit-failure'])).rows.length,0,'deferred receipt COMMIT failure rolls back durable receipt')
  await db.exec('DROP TRIGGER fail_sender_receipt_deferred ON "NewBotOutboxReceipt"; DROP FUNCTION fail_sender_receipt_commit();')
  const corrupt=await seed('sender-corrupt-head')
  const healthy=await seed('sender-healthy-partition')
  await db.exec('ALTER TABLE "NewBotOutboxEvent" DROP CONSTRAINT "NewBotOutboxEvent_action_check"')
  await db.query('UPDATE "NewBotOutboxEvent" SET "action"=$2::jsonb WHERE "id"=$1',[corrupt,JSON.stringify({type:'execute',command:'bad'})])
  const isolated=await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})
  assert.equal((await state(corrupt)).processingStatus,'BLOCKED','corrupt head is isolated')
  assert.ok(isolated.some((x)=>x.id===healthy),'corrupt head does not fail healthy partition claims')
  assert.equal((await state(healthy)).processingStatus,'CLAIMED')
  const raceId=await seed('sender-receipt-race')
  const raceClaim=(await sender.claimBatch({batchSize:100,leaseDurationMs:10_000})).find(x=>x.id===raceId); assert.ok(raceClaim)
  assert.equal(await sender.markDispatching(raceClaim),true)
  let unlockCorrelation!:()=>void
  let reportLock!:()=>void
  const correlationGate=new Promise<void>((resolve)=>{unlockCorrelation=resolve})
  const correlationLocked=new Promise<void>((resolve)=>{reportLock=resolve})
  afterCorrelationLock=async()=>{reportLock();await correlationGate}
  queryTrace.length=0
  const recordDuringAccept=sender.recordReceipt({
    trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-receipt-race'},
    receipt:{idempotencyKey:'race-receipt',providerMessageId:'race-provider',status:'DELIVERED'},
  })
  const lockReached=await Promise.race([correlationLocked.then(()=>true),new Promise<boolean>((resolve)=>setTimeout(()=>resolve(false),100))])
  const acceptDuringReceipt=sender.settle(raceClaim,{kind:'accepted',providerMessageId:'race-provider'})
  unlockCorrelation()
  const [recordRace,acceptRace]=await Promise.all([recordDuringAccept,acceptDuringReceipt])
  assert.equal(lockReached,true,'receipt transaction reaches the shared correlation lock before lookup')
  assert.equal(recordRace.inserted,true)
  assert.equal(acceptRace,true)
  assert.deepEqual(await state(raceId).then((row)=>[row.processingStatus,row.deliveryStatus,row.providerMessageId]),['ACCEPTED','DELIVERED','race-provider'],
    'receipt-before-bind interleaving is serialized and reconciled by the accepting transaction')
  assert.ok(queryTrace.findIndex((text)=>text.includes('pg_advisory_xact_lock')) < queryTrace.findIndex((text)=>text.includes('FOR UPDATE')),
    'receipt obtains correlation lock before any outbox row lock')
  await db.query('UPDATE "NewBotOutboxReceipt" SET "outboxEventId"=NULL WHERE "idempotencyKey"=$1',['race-receipt'])
  await db.query("UPDATE \"NewBotOutboxEvent\" SET \"deliveryStatus\"='PENDING' WHERE \"id\"=$1",[raceId])
  const duplicateRace=await sender.recordReceipt({
    trustedContext:{businessId:'tenant-a',provider:'whatsapp',recipientKey:'sender-receipt-race'},
    receipt:{idempotencyKey:'race-receipt',providerMessageId:'race-provider',status:'DELIVERED'},
  })
  assert.deepEqual(duplicateRace,{matched:true,inserted:false},'duplicate callback reconciles a preexisting unmatched receipt after binding')
  assert.equal((await state(raceId)).deliveryStatus,'DELIVERED')
  const slow=await seed('sender-single-flight')
  let release!:()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve})
  let sends=0
  const slowRunner=createNewBotSenderRunner(sender,{async send(){sends++;await gate;return {kind:'accepted',providerMessageId:'slow-provider'}}},1)
  const tickOne=slowRunner.runOnce({leaseDurationMs:10_000,signal:new AbortController().signal})
  const tickTwo=slowRunner.runOnce({leaseDurationMs:10_000,signal:new AbortController().signal})
  assert.equal(tickTwo,tickOne,'overlapping ticks share the exact in-flight result')
  await new Promise((resolve)=>setTimeout(resolve,10))
  assert.equal(sends,1,'an unfinished transport keeps its single instance slot')
  assert.equal(slowRunner.activeCount,1)
  release()
  assert.deepEqual(await tickOne,[{id:slow,state:'accepted'}])
  assert.equal(slowRunner.activeCount,0)
  const timed=await seed('sender-timeout-slot')
  let finishLate!: (value:{kind:'accepted';providerMessageId:string})=>void
  const rawPending=new Promise<{kind:'accepted';providerMessageId:string}>((resolve)=>{finishLate=resolve})
  const timedRunner=createNewBotSenderRunner(sender,{send(){return rawPending}},1,10)
  const timedResult=await timedRunner.runOnce({leaseDurationMs:10_000,signal:new AbortController().signal})
  assert.deepEqual(timedResult,[{id:timed,state:'uncertain'}],'bounded transport deadline records UNKNOWN')
  assert.equal((await state(timed)).processingStatus,'UNKNOWN')
  assert.equal(timedRunner.activeCount,1,'unsettled raw transport retains physical concurrency slot after timeout')
  assert.deepEqual(await timedRunner.runOnce({leaseDurationMs:10_000,signal:new AbortController().signal}),[],'second tick cannot exceed actual outstanding transport slots')
  assert.equal(await sender.reconcile({businessId:'tenant-a',outboxId:timed,operatorId:'operator',reason:'provider lookup',requestKey:'bind-timeout',action:'BIND_ACCEPTED',providerMessageId:'manual-known-id'}),true)
  finishLate({kind:'accepted',providerMessageId:'too-late'})
  await new Promise((resolve)=>setTimeout(resolve,0))
  assert.equal((await state(timed)).providerMessageId,'manual-known-id','late transport acceptance cannot overwrite a manual resolution')
  assert.equal(timedRunner.activeCount,0)
  const markerWait=await seed('sender-marker-abort')
  let markerReady!:()=>void; let markerRelease!:()=>void
  const markerEntered=new Promise<void>((resolve)=>{markerReady=resolve})
  const markerGate=new Promise<void>((resolve)=>{markerRelease=resolve})
  const delayedRepository={...sender,async markDispatching(claim:Parameters<typeof sender.markDispatching>[0]){const ok=await sender.markDispatching(claim);markerReady();await markerGate;return ok}}
  const markerController=new AbortController()
  let markerSends=0
  const markerRunner=createNewBotSenderRunner(delayedRepository,{async send(){markerSends++;return {kind:'accepted',providerMessageId:'should-not-send'}}},1,10)
  const markerRun=markerRunner.runOnce({leaseDurationMs:10_000,signal:markerController.signal})
  await markerEntered; markerController.abort(); markerRelease()
  assert.deepEqual(await markerRun,[{id:markerWait,state:'uncertain'}],'abort after durable dispatch marker resolves conservatively UNKNOWN')
  assert.equal(markerSends,0,'abort during marker await never reaches transport')
  assert.equal((await state(markerWait)).processingStatus,'UNKNOWN')
  let canceledSends=0
  const canceled=await seed('sender-pre-aborted')
  const canceledResult=await createNewBotSenderRunner(sender,{async send(){canceledSends++;return {kind:'accepted',providerMessageId:'never'}}},1,10).runOnce({leaseDurationMs:10_000,signal:AbortSignal.abort()})
  assert.deepEqual(canceledResult,[])
  assert.equal(canceledSends,0,'pre-aborted signal causes no claim or network call')
  assert.equal((await state(canceled)).processingStatus,'PENDING')
  console.log('new-bot sender tests passed: durable dispatch fence, accepted/delivery separation, monotonic receipts, UNKNOWN/manual audit, early receipt reconciliation, lease expiry fencing, retry classes, stale fencing, tenant scope, SQL failure and corrupt partition isolation')
} finally { await db.close() }
