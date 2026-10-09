import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { randomUUID } from 'node:crypto'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms, type RuntimeHeldReceipt, type RuntimePresentedBooking } from '../src/conversational-bot/prisma-conversational-booking.js'
import { conversationProofBindingFromState, CONVERSATION_PROOF_ACTION } from '../src/conversational-bot/attachment-intent.js'
import { resolveProofTarget } from '../src/bot-options/application/process-deposit-proof-job.js'

// Real SQL, in-process only. Receipt targeting is verified here; financial
// lifecycle constraints remain covered by the original coordinated suite.
const db = new PGlite()
await db.exec(`
CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
CREATE TYPE "BotInboxStatus" AS ENUM ('PROCESSED');
CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
CREATE TYPE "BookingDepositStatus" AS ENUM ('PENDING_PROOF','PENDING_RESUBMISSION','EXPIRED');
CREATE TYPE "BookingDepositSource" AS ENUM ('WHATSAPP');
CREATE TYPE "BookingVisitStatus" AS ENUM ('HELD','EXPIRED');
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING','CANCELLED');
CREATE TABLE "Conversation" (id text PRIMARY KEY,"businessId" text,phone text);
CREATE TABLE "BotSession" (id text PRIMARY KEY,"businessId" text,"conversationId" text,"deploymentId" text,"deploymentGeneration" int,status "BotSessionStatus",state jsonb,revision bigint,"businessTimezone" text DEFAULT 'UTC');
CREATE TABLE "BotChannelDeployment" (id text PRIMARY KEY,"businessId" text,channel "BotChannel","engineKey" text,"activeConfigurationId" text,"legacyDispatchCoverageVersion" int,"claimsPausedAt" timestamptz,generation int);
CREATE TABLE "BusinessBotConfiguration" (id text PRIMARY KEY,"businessId" text,status text,definition jsonb);
CREATE TABLE "BookingDeposit" (id text PRIMARY KEY,"businessId" text,"conversationId" text,"visitId" text,"appointmentId" text,"snapshotSealedAt" timestamptz,source "BookingDepositSource",status "BookingDepositStatus");
CREATE TABLE "BookingVisit" (id text PRIMARY KEY,"businessId" text,"sessionId" text,status "BookingVisitStatus","customerId" text DEFAULT 'customer',"professionalId" text DEFAULT 'p1');
CREATE TABLE "Appointment" (id text PRIMARY KEY,"businessId" text,"visitId" text,status "AppointmentStatus","coordinationGroupId" text,origin text,"customerId" text DEFAULT 'customer',"professionalId" text DEFAULT 'p1');
CREATE TABLE "BotOperation" (id text,"businessId" text,type text,"resultRef" text,"operationKey" text,"sessionId" text,"requestHash" text,status text);
CREATE TABLE "Customer" (id text,"businessId" text,"normalizedPhone" text);
CREATE TABLE "Professional" (id text,"businessId" text);
CREATE TABLE "BotActionInbox" (id text,"businessId" text,"providerEventId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" int,"actionType" text,"status" "BotInboxStatus","entityRef" jsonb);
INSERT INTO "Customer" VALUES ('customer','b','5491112345678');
INSERT INTO "Professional" VALUES ('p1','b');
INSERT INTO "Conversation" VALUES ('c','b','5491112345678');
INSERT INTO "BotChannelDeployment" VALUES ('dep','b','WHATSAPP','deterministic-options','cfg',1,NULL,2);
INSERT INTO "BusinessBotConfiguration" VALUES ('cfg','b','ACTIVE','{"conversation":{"engine":"conversational-booking-v1","schemaVersion":1}}');
INSERT INTO "BotSession" VALUES ('session','b','c','dep',2,'ACTIVE','{"flow":"SERVICE_SELECT","booking":"DRAFT","deposit":"NONE","conversationDraft":{"dialogue":{"pending":"service"}}}',4,'UTC');
INSERT INTO "BookingVisit" VALUES ('visit','b','session','HELD','customer','p1');
INSERT INTO "Appointment" VALUES ('appointment','b','visit','PENDING',NULL,'BOT','customer','p1');
INSERT INTO "BookingDeposit" VALUES ('deposit','b','c','visit','appointment',clock_timestamp(),'WHATSAPP','PENDING_PROOF');
`)
let afterTarget: (() => Promise<void>) | undefined
const client = { professional: {findMany:async()=>[{id:'p1'}]}, $queryRaw: async (q: Prisma.Sql) => {
  if(q.text.includes('pg_advisory_xact_lock')) return [{locked:1}] // PGlite has no cross-process locks.
  const result=(await db.query(q.text,q.values)).rows
  if(q.text.includes('AS "conversational"') && afterTarget) {const hook=afterTarget;afterTarget=undefined;await hook()}
  return result
} } as unknown as Prisma.TransactionClient
const event = (businessId='b', caption: string | null=null, messageType='image') => ({ id:'event',businessId,providerMessageId:'message',phoneNumberId:'channel',
  payload: {kind:'message',fromPhone:'5491112345678',messageType,textBody:caption,mediaId:'PRIVATE_MEDIA'} })
try {
  assert.deepEqual(await resolveProofTarget(client,event('foreign') as never,'dep'), {kind:'NONE'}, 'P16 foreign tenant never acquires a proof target')
  assert.deepEqual(await resolveProofTarget(client,event() as never,'other-deployment'), {kind:'NONE'}, 'P16 another deployment never acquires a proof target')
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'), {kind:'NONE'}, 'P16 same phone and pending deposit are insufficient without a currently asked conversational receipt')
  for (const [caption,type] of [['este es el color que quiero','image'],['foto de mi pelo','document'],['te paso una referencia','image']] as const) {
    assert.deepEqual(await resolveProofTarget(client,event('b',caption,type) as never,'dep'), {kind:'NONE'}, 'P16 service-photo or unsolicited media cannot be evidence of payment')
  }
  const configuration={businessId:'b',customerCode:'WX-38N6UG',deploymentId:'dep',generation:2,configurationId:'cfg',configurationBusinessId:'b',configurationStatus:'ACTIVE',engineKey:'deterministic-options',definition:{conversation:{schemaVersion:1,engine:'conversational-booking-v1'}}}
  const policy=resolveConversationPolicy(configuration)!
  const scope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,configurationId:'cfg',revision:'4',dispatchFenceEpoch:1,handoffFenceEpoch:0}
  const terms:RuntimeBookingTerms={version:1,businessId:'b',timezone:'America/Argentina/Buenos_Aires',date:'2026-10-10',customerName:'Ana',preference:{kind:'specific',id:'p1'},totalPriceMinor:1000,
    segments:[{serviceId:'cut',serviceName:'Corte',professionalId:'p1',professionalName:'Ana',startAt:'2026-10-10T13:00:00.000Z',endAt:'2026-10-10T13:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:1000,priceMode:'FIXED',configurationHash:null}],
    deposit:{financial:{amount:100,ttlMinutes:60,ttlProvenance:'BUSINESS_POLICY',lines:[{serviceId:'cut',sortOrder:0,serviceName:'Corte',mode:'FIXED',configuredValue:100,baseAmount:null,amount:100}]},payment:{transferEnabled:true,alias:'not-sent-to-ai',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}}
  const presented:RuntimePresentedBooking={version:1,scope,nonce:randomUUID(),fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true,terms}
  const receipt:RuntimeHeldReceipt={kind:'HELD',coordinationGroupId:randomUUID(),proposalNonce:presented.nonce,fingerprint:presented.fingerprint,appointments:[{segmentIndex:0,appointmentId:'appointment',visitId:'visit'}],operationKey:'conversation-booking:proof-test',depositId:'deposit',amount:100,expiresAt:'2026-10-10T12:00:00.000Z',depositStatus:'PENDING_PROOF'}
  const dialogue={...initialDialogueState('b'),serviceId:'cut',customerName:'Ana',date:terms.date,professional:terms.preference,pending:'proposal' as const,slot:{date:terms.date,time:'10:00',startAt:terms.segments[0]!.startAt,professionalId:'p1',professionalName:'Ana',band:'MORNING' as const,occupiedMinutes:0},bookingReservation:{presented,receipt}}
  const state=projectConversationDraft(dialogue,policy)
  const binding=conversationProofBindingFromState(state,{...scope,timezone:terms.timezone})!
  assert.ok(binding,'P16 fixture carries a valid explicitly asked Argentina receipt')
  await db.query('UPDATE "BotSession" SET state=$1::jsonb,"businessTimezone"=$2',[JSON.stringify(state),terms.timezone])
  await db.query('UPDATE "Appointment" SET "coordinationGroupId"=$1',[receipt.coordinationGroupId])
  for(const [id,key,result] of [['parent',receipt.operationKey,receipt.coordinationGroupId],['child',receipt.operationKey+':segment:0:HOLD_VISIT_WITH_DEPOSIT','visit']]) {
    await db.query(`INSERT INTO "BotOperation" VALUES ($1,'b','HOLD_VISIT_WITH_DEPOSIT',$2,$3,'session',$4,'COMPLETED')`,[id,result,key,'a'.repeat(64)])
  }
  const writeBinding=async(value:unknown)=>{
    await db.exec('DELETE FROM "BotActionInbox"')
    await db.query(`INSERT INTO "BotActionInbox" VALUES ('inbox','b','event','session','dep',2,$1,'PROCESSED',$2::jsonb)`,[CONVERSATION_PROOF_ACTION,JSON.stringify(value)])
  }
  await writeBinding(binding)
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'FOUND',depositId:'deposit'},'P16 exact asked receipt in local timezone binds the real runtime singular lineage')
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'FOUND',depositId:'deposit'},'P16 duplicate target lookup is stable; writer owns event idempotence')
  for(const change of [{depositId:'other'},{sessionId:'other'},{generation:3},{configurationId:'other'},{revision:'5'},{proposalNonce:randomUUID()},{fingerprint:'b'.repeat(64)},{coordinationGroupId:randomUUID()},{operationKey:'other'}]) {
    await writeBinding({...binding,...change})
    assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'NONE'},'P16 stale or foreign bound obligation cannot be retargeted')
  }
  await writeBinding(binding)
  await db.exec('UPDATE "BotSession" SET revision=5')
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'FOUND',depositId:'deposit'},'P16 unrelated acknowledgement revision retains the same receipt')
  await db.exec('UPDATE "BotSession" SET "deploymentGeneration"=1')
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'NONE'},'P16 stale session generation cannot bind')
  await db.exec(`UPDATE "BotSession" SET "deploymentGeneration"=2; UPDATE "BusinessBotConfiguration" SET status='DRAFT'`)
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'NONE'},'P16 inactive configuration cannot bind')
  await db.exec(`UPDATE "BusinessBotConfiguration" SET status='ACTIVE'`)
  afterTarget=async()=>{await db.query('UPDATE "BotSession" SET state=$1::jsonb',[JSON.stringify({...state,deposit:'APPROVED',booking:'CONFIRMED'})])}
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'NONE'},'P16 changed receipt after first selection is re-read under session lock before proof write')
  await db.query('UPDATE "BotSession" SET state=$1::jsonb',[JSON.stringify(state)])
  await db.exec(`UPDATE "BookingDeposit" SET status='EXPIRED'; UPDATE "BookingVisit" SET status='EXPIRED'; UPDATE "Appointment" SET status='CANCELLED'`)
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'FOUND',depositId:'deposit'},'P16 already-bound late event can reach existing LATE writer; never renews a hold')
  await db.query('UPDATE "BotSession" SET state=$1::jsonb',[JSON.stringify(projectConversationDraft({...dialogue,bookingReservation:{presented,receipt:{...receipt,depositStatus:'EXPIRED'}}},policy))])
  assert.deepEqual(await resolveProofTarget(client,event() as never,'dep'),{kind:'NONE'},'P16 a reconciled expired session never asks for a new proof or resurrects the reservation')
  console.log('P16 attachment proof binding SQL: PASS')
} finally { await db.close() }
