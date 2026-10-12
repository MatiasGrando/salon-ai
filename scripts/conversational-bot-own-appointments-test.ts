import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { initialDialogueState, respond, type DialogueContext, type DialoguePort } from '../src/conversational-bot/engine.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { loadOwnAppointments } from '../src/conversational-bot/prisma-own-appointments.js'
import { enqueueConversationalHandoffTx } from '../src/conversational-bot/prisma-conversational-handoff.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { TURN_PLAN_INTERPRETATION_GUIDE } from '../src/conversational-bot/turn-plan-interpretation-guide.js'

const db = new PGlite()
const tx = { async $queryRaw<T>(q: Prisma.Sql): Promise<T> { return (await db.query(q.text, q.values)).rows as T } }
const scope = { businessId: 'barber', sessionId: 'current', canonicalPhone: '5491112345678', expectedRevision: 5n }
await db.exec(`
CREATE TABLE "Customer" (id text,"businessId" text,"normalizedPhone" text);
CREATE TABLE "Conversation" (id text,"businessId" text,phone text);
CREATE TABLE "BotSession" (id text,"businessId" text,"conversationId" text,revision bigint,status text,state jsonb,"businessTimezone" text);
CREATE TABLE "Professional" (id text,"businessId" text,name text);
CREATE TABLE "Service" (id text,"businessId" text,name text,duration int,"customerDurationMax" int,"customerDurationMin" int);
CREATE TABLE "Appointment" (id text,"businessId" text,"customerId" text,"professionalId" text,"serviceId" text,"coordinationGroupId" text,version int,status text,"visitId" text,"startAt" timestamptz,"totalDurationMinutes" int,"quotedPrice" int,"manualDepositPaid" boolean,"manualDepositAmount" int);
CREATE TABLE "BookingVisit" (id text,"businessId" text,"customerId" text,"professionalId" text,version int,status text,"scheduledStartAt" timestamptz,"sessionId" text);
CREATE TABLE "BookingDeposit" (id text,"businessId" text,"appointmentId" text,status text);
CREATE TABLE "AppointmentServiceItem" ("appointmentId" text,"serviceId" text,"sortOrder" int);
INSERT INTO "Customer" VALUES ('owner','barber','5491112345678'),('other','barber','5491100000000');
INSERT INTO "Conversation" VALUES ('chat','barber','+54 9 11 1234 5678');
INSERT INTO "BotSession" VALUES ('current','barber','chat',5,'ACTIVE','{"booking":"DRAFT","deposit":"NONE","handoff":"NONE"}','UTC');
INSERT INTO "Professional" VALUES ('tamara','barber','Tamara'),('gaspar','barber','Gaspar');
INSERT INTO "Service" VALUES ('light','barber','Iluminación',120,NULL,NULL),('cut','barber','Corte Hombre',30,NULL,NULL);
INSERT INTO "Appointment" VALUES ('a','barber','owner','tamara','light','group',1,'CONFIRMED','v-a',now()+interval '2 days',120,40000,false,NULL),('b','barber','owner','gaspar','cut','group',1,'CONFIRMED','v-b',now()+interval '2 days 2 hours',30,15000,false,NULL);
INSERT INTO "BookingVisit" SELECT 'v-'||id,'barber','owner',"professionalId",1,'CONFIRMED',"startAt",'original-session' FROM "Appointment";
INSERT INTO "AppointmentServiceItem" SELECT id,"serviceId",0 FROM "Appointment";
INSERT INTO "BookingDeposit" VALUES ('deposit','barber','a','APPROVED');`)
try {
  const read = () => loadOwnAppointments(tx as never, scope)
  const own = await read()
  assert.equal(own.items.length, 1)
  assert.equal(own.items[0]!.snapshot.members.length, 2, 'one reservation includes every coordinated service')
  assert.match(own.items[0]!.label, /Iluminación con Tamara/)
  assert.match(own.items[0]!.label, /Corte Hombre con Gaspar/)
  assert.equal(own.items[0]!.snapshot.scope.sessionId, 'current', 'caller is current; original BookingVisit session stays unchanged')
  const context: DialogueContext = { businessId: 'barber', timezone: 'UTC', dbNow: new Date(own.dbNow), serverOwnAppointments: own,
    serverRuntimeBookingScope: { businessId: 'barber', sessionId: 'current', deploymentId: 'dep', generation: 1, revision: '6', configurationId: 'cfg', dispatchFenceEpoch: 0, handoffFenceEpoch: 0 } }
  const port: DialoguePort = { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) }
  const ask = async (action: 'read'|'cancel'|'reschedule', optionKey: string|null = null, state = initialDialogueState('barber'), ctx = context) => {
    const message = action === 'read' ? 'me recordás el turno' : action === 'cancel' ? 'quiero cancelar el turno' : 'quiero reprogramar el turno'
    const turnPlan = parseTurnPlan({ version: 1, operations: [{ kind: 'own_appointment', action, optionKey, evidence: message, confidence: 1 }] }, message)
    return respond(ctx, state, message, port, { serviceId: null, candidateIds: [], correction: false, turnPlan })
  }
  const summary = await ask('read')
  assert.match(summary.reply, /Iluminación con Tamara/)
  assert.equal(summary.state.serviceId, null)
  assert.equal(summary.state.bookingReservation, undefined)
  assert.equal(summary.proposal, null, 'reminder cannot create a prospective reservation')
  let lookupCalls = 0
  const lazyPort = { ...port, ownAppointments:async()=>{lookupCalls++;return own} }
  const lazyContext = { ...context, serverOwnAppointments:undefined }
  await respond(lazyContext,initialDialogueState('barber'),'hola',lazyPort,{ serviceId:null,candidateIds:[],correction:false,turnPlan:{version:1,operations:[]} })
  assert.equal(lookupCalls,0,'ordinary messages do not add booking reads')
  const message = 'me recordás el turno'
  const provider:AiInterpretationProvider = Object.assign(async()=>({intent:'information',serviceId:null,serviceEvidence:null,professionalMention:null,
    turnPlan:{version:1,operations:[{kind:'own_appointment',action:'read',optionKey:null,evidence:message,confidence:1}]},
    communicativeActs:{version:1,acts:[{kind:'inquiry',field:'general',evidence:message,confidence:1,mention:null,operationIndexes:[0]}]}}),{
    respond:async()=>({salutation:null,opening:'Claro, te comparto los detalles 😊',factIds:null,closing:null,variantChoices:null,catalogAnswer:null})})
  const aiRead = await respondWithAiInterpreter(lazyContext,initialDialogueState('barber'),message,lazyPort,provider)
  assert.equal(aiRead.interpretation.mode,'ai')
  assert.equal(aiRead.interpretation.copyMode,'ai','new verified appointment facts allow IA composition instead of generic next')
  assert.match(aiRead.reply,/te comparto los detalles/)
  assert.match(aiRead.reply,/Iluminación con Tamara/)
  assert.equal(lookupCalls,1)
  assert.equal(aiRead.state.serviceId,null)
  const policyQuestion = '¿Qué pasa si cancelo el turno?'
  const inquiry = await respondWithAiInterpreter(lazyContext,initialDialogueState('barber'),policyQuestion,lazyPort,async()=>({intent:'information',serviceId:null,serviceEvidence:null,professionalMention:null,
    turnPlan:{version:1,operations:[{kind:'own_appointment',action:'cancel',optionKey:null,evidence:policyQuestion,confidence:1}]},
    communicativeActs:{version:1,acts:[{kind:'inquiry',field:'general',evidence:policyQuestion,confidence:1,mention:null,operationIndexes:[0]}]}}))
  assert.equal(inquiry.ownAppointmentHandoff,undefined,'a policy inquiry does not request cancellation')
  assert.match(TURN_PLAN_INTERPRETATION_GUIDE,/own_appointment/,'shared guide must advertise current own appointment semantic operation')
  const cancel = await ask('cancel')
  assert.equal(cancel.ownAppointmentHandoff?.action, 'cancel')
  assert.equal(cancel.ownAppointmentHandoff?.snapshot.members.length, 2)
  assert.equal(cancel.managementCommand, undefined)
  assert.match(cancel.reply, /sigue vigente/)
  const reschedule = await ask('reschedule')
  assert.equal(reschedule.managementCommand, undefined, 'lost immutable source receipt cannot be manufactured')
  assert.match(reschedule.reply, /autorización original/)
  assert.match(reschedule.reply, /No envié una solicitud/)
  const policy = { businessId:'barber',deploymentId:'dep',generation:1,configurationId:'cfg' }
  await db.exec(`CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN','CANCELLED','RESOLVED');
    CREATE TYPE "ConversationStep" AS ENUM ('START','HUMAN_HANDOFF','COMPLETED');
    ALTER TABLE "BotSession" ALTER COLUMN status TYPE "BotSessionStatus" USING status::"BotSessionStatus";
    ALTER TABLE "BotSession" ADD COLUMN "deploymentId" text DEFAULT 'dep',ADD COLUMN "deploymentGeneration" int DEFAULT 1,ADD COLUMN "handoffFenceEpoch" int DEFAULT 0,ADD COLUMN "handoffClaimsPausedAt" timestamptz,ADD COLUMN "updatedAt" timestamptz DEFAULT now();
    ALTER TABLE "Conversation" ADD COLUMN "currentStep" "ConversationStep" DEFAULT 'START',ADD COLUMN "aiEnabled" boolean DEFAULT true,ADD COLUMN "humanHandoffAt" timestamp(3),ADD COLUMN "humanHandoffResolvedAt" timestamp(3),ADD COLUMN "updatedAt" timestamp(3) DEFAULT now(),ADD COLUMN "misunderstandingCount" int DEFAULT 0;
    CREATE TABLE "BotChannelDeployment" (id text,"businessId" text,generation int,"activeConfigurationId" text,"claimsPausedAt" timestamptz);
    INSERT INTO "BotChannelDeployment" VALUES ('dep','barber',1,'cfg',NULL);
    CREATE TABLE "BotOperation" (id text PRIMARY KEY,"operationKey" text UNIQUE,type text,"businessId" text,"sessionId" text,status text,"requestHash" text,"resultRef" text,"updatedAt" timestamp(3));
    CREATE TABLE "BotHandoff" (id text PRIMARY KEY,"businessId" text,"sessionId" text,status "BotHandoffStatus",reason text,detail text,context jsonb,"queuedAt" timestamp(3),"updatedAt" timestamp(3));
    CREATE UNIQUE INDEX own_one_active_handoff ON "BotHandoff" ("sessionId") WHERE status IN ('QUEUED','TAKEN');`)
  await db.query(`UPDATE "BotSession" SET state=$1`,[JSON.stringify(projectConversationDraft(cancel.state,policy))])
  const paymentBefore = (await db.query(`SELECT * FROM "BookingDeposit"`)).rows
  const agendaBefore = (await db.query(`SELECT * FROM "Appointment" ORDER BY id`)).rows
  await db.transaction(async pg=>{
    const t = { async $queryRaw(q:Prisma.Sql){return(await pg.query(q.text,q.values)).rows},async $executeRaw(q:Prisma.Sql){return(await pg.query(q.text,q.values)).affectedRows??0} }
    const queued = await enqueueConversationalHandoffTx(t as never,{businessId:'barber',sessionId:'current',policy,expectedRevision:5n,handoffFenceEpoch:0,operationKey:'own-cancel',
      command:{ownAppointment:cancel.ownAppointmentHandoff!,consent:{revision:5n,evidence:'quiero cancelar el turno'}}})
    assert.equal(queued.replayed,false)
  })
  assert.deepEqual((await db.query(`SELECT * FROM "BookingDeposit"`)).rows,paymentBefore)
  assert.deepEqual((await db.query(`SELECT * FROM "Appointment" ORDER BY id`)).rows,agendaBefore)
  assert.equal((await db.query<{status:string}>(`SELECT status FROM "BotHandoff"`)).rows[0]!.status,'QUEUED')
  await db.transaction(async pg=>{
    const t = { async $queryRaw(q:Prisma.Sql){return(await pg.query(q.text,q.values)).rows},async $executeRaw(q:Prisma.Sql){return(await pg.query(q.text,q.values)).affectedRows??0} }
    const replay = await enqueueConversationalHandoffTx(t as never,{businessId:'barber',sessionId:'current',policy,expectedRevision:5n,handoffFenceEpoch:0,operationKey:'own-cancel',
      command:{ownAppointment:cancel.ownAppointmentHandoff!,consent:{revision:5n,evidence:'quiero cancelar el turno'}}})
    assert.equal(replay.replayed,true)
  })
  assert.equal((await db.query(`SELECT * FROM "BotHandoff"`)).rows.length,1,'replay does not duplicate the request')
  await db.query(`UPDATE "BotSession" SET state=$1,status='ACTIVE',revision=5`,[JSON.stringify(projectConversationDraft(initialDialogueState('barber'),policy))])
  await db.exec(`INSERT INTO "Appointment" SELECT 'c','barber','owner','gaspar','cut',NULL,1,'CONFIRMED',NULL,now()+interval '3 days',30,15000,false,NULL`)
  const multiple = await read()
  const choose = await ask('cancel', null, initialDialogueState('barber'), { ...context, serverOwnAppointments: multiple })
  assert.match(choose.reply, /cuál/i)
  assert.equal(choose.ownAppointmentHandoff, undefined)
  const selected = await ask('cancel', multiple.items[1]!.key, choose.state, { ...context, serverOwnAppointments: multiple })
  assert.equal(selected.ownAppointmentHandoff?.snapshot.members[0]!.appointmentId, 'c')
  const invented = await ask('cancel', 'appointment:000000000000000000000000', choose.state, { ...context, serverOwnAppointments: multiple })
  assert.equal(invented.ownAppointmentHandoff, undefined)
  await db.exec(`UPDATE "Appointment" SET version=version+1 WHERE id='c'`)
  const stale = await ask('cancel', multiple.items[1]!.key, choose.state, { ...context, serverOwnAppointments: await read() })
  assert.equal(stale.ownAppointmentHandoff, undefined)
  await assert.rejects(loadOwnAppointments(tx as never, { ...scope, canonicalPhone: '5491100000000' }), /ownership/)
  await assert.rejects(loadOwnAppointments(tx as never, { ...scope, expectedRevision: 4n }), /ownership/)
  await assert.rejects(loadOwnAppointments(tx as never, { ...scope, businessId: 'other' }), /ownership/)
  const lowConfidence = await respond(context,initialDialogueState('barber'),'quiero cancelar el turno',port,{serviceId:null,candidateIds:[],correction:false,
    turnPlan:{version:1,operations:[{kind:'own_appointment',action:'cancel',optionKey:null,evidence:'quiero cancelar el turno',confidence:.5}]}})
  assert.equal(lowConfidence.ownAppointmentHandoff,undefined)
  await db.exec(`UPDATE "Appointment" SET "customerId"='other' WHERE id='b'`)
  await assert.rejects(read(), /ownership|coherence/)
  await db.exec(`UPDATE "Appointment" SET "customerId"='owner' WHERE id='b'; UPDATE "Appointment" SET status='CANCELLED'`)
  const none = await ask('read', null, initialDialogueState('barber'), { ...context, serverOwnAppointments: await read() })
  assert.match(none.reply, /No encontré/)
  assert.equal(none.proposal, null)
  assert.deepEqual((await db.query<{sessionId:string}>(`SELECT "sessionId" FROM "BookingVisit"`)).rows.map(r=>r.sessionId), ['original-session','original-session'])
  console.log('own appointment recovery: real SQL grouped read, reset, reminder, selection, no financial effects and ownership negatives PASS')
} finally { await db.close() }
