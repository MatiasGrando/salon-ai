import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { resolveProofTarget,processDepositProofJob } from '../src/bot-options/application/process-deposit-proof-job.js'
import { conversationProofBindingFromState,CONVERSATION_PROOF_ACTION } from '../src/conversational-bot/attachment-intent.js'
import { enqueueConversationalHandoffTx } from '../src/conversational-bot/prisma-conversational-handoff.js'
import { rescheduleGroupInTransaction } from '../src/conversational-bot/prisma-appointment-management.js'
import { presentGroupReschedule, confirmGroupReschedule } from '../src/conversational-bot/appointment-management.js'
import { loadOwnAppointments } from '../src/conversational-bot/prisma-own-appointments.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft, reconcileConversationDraft } from '../src/conversational-bot/session-state.js'
import { conversationStepForBotOptionsState } from '../src/bot-options/domain/conversation-status.js'
import { Prisma } from '../src/generated/prisma/client.js'
import { loadRuntimeDepositReceipt, runtimeBookingReceiptReply, executePrismaConversationBooking, runtimeBookingFingerprint, runtimeServiceConfigurationHash, type RuntimeBookingInput, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'

const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['BotTransitionLog','BotPrompt','BotPromptChoice','BotProviderEvent','BotActionInbox','BotOutbox','Business','Conversation','Customer','InstagramLead','BusinessInstagramConfig','CustomerChannelIdentity','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentChangeHistory','AppointmentServiceItem','BookingVisit','BookingDeposit','BookingDepositLine','BookingDepositProof','BookingDepositReviewAudit','BotHandoff','BusinessPaymentSettings','BotJob','ServiceCombinationRule','BotOperation']
for (const name of ['BotPromptStatus','BotPromptMode','BotProviderEventType','BotProviderEventStatus','BotInboxStatus','BotJobStatus','BotOutboxStatus','BookingDepositProofKind','BotChannel','BotSessionStatus','BotHandoffStatus','ConversationStep','AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode','BookingDepositSource','BookingDepositTtlProvenance']) {
  const body = schema.match(new RegExp('enum '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const values = body.split('\n').flatMap(line => line.match(/@map\("([^"]+)"\)/)?.[1]??line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1]??[])
  await db.exec('CREATE TYPE "'+name+'" AS ENUM ('+values.map(v=>"'"+v+"'").join(',')+')')
}
for (const name of models) {
  const body = schema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || /\[\]/.test(line)) return []
    const scalar = ({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision',Bytes:'bytea'} as Record<string,string>)[field[2]!]
    const type = scalar ?? (schema.includes('enum '+field[2]+' {') ? ['BotPromptStatus','BotPromptMode','BotProviderEventType','BotProviderEventStatus','BotInboxStatus','BotJobStatus','BotOutboxStatus','BookingDepositProofKind','BotChannel','BotSessionStatus','BotHandoffStatus','ConversationStep','AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode','BookingDepositSource','BookingDepositTtlProvenance'].includes(field[2]!) ? '"'+field[2]+'"' : 'text' : null)
    const primary = field[1] === (name === 'BusinessBotOptionsSettings' ? 'businessId' : 'id')
    const columnName=line.match(/@map\("([^"]+)"\)/)?.[1]??field[1]
    return type ? ['"'+columnName+'" '+type+(primary?' PRIMARY KEY':'')+(field[1]==='version'?' DEFAULT 1':['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')] : []
  })
  await db.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
}
await db.exec('CREATE UNIQUE INDEX operation_key ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX appointment_visit ON "Appointment" ("visitId");CREATE UNIQUE INDEX bot_outbox_key ON "BotOutbox" ("idempotencyKey");CREATE UNIQUE INDEX bot_job_key ON "BotJob" (kind,"aggregateId")')
await db.exec(`
INSERT INTO "Business" ("id","name","botEnabled") VALUES ('b','Salon',true),('foreign','Other',true);
INSERT INTO "Conversation" ("id","businessId","phone") VALUES ('c','b','5491112345678');
INSERT INTO "Customer" ("id","businessId","phone","normalizedPhone","name") VALUES ('customer','b','5491112345678','5491112345678','Ana');
INSERT INTO "BotChannelDeployment" ("id","businessId","channel","generation","dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','b','WHATSAPP',2,3,'cfg',1);
INSERT INTO "BusinessBotConfiguration" ("id","businessId","status") VALUES ('cfg','b','ACTIVE');
INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","status","revision","handoffFenceEpoch","businessTimezone") VALUES ('session','b','c','dep',2,'ACTIVE',4,5,'America/Argentina/Buenos_Aires');
INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","bookingHorizonDays","bookingLeadTimeHours") VALUES ('b','America/Argentina/Buenos_Aires',20000,0);
INSERT INTO "ServiceCategory" ("id","businessId","isActive") VALUES ('category','b',true);
INSERT INTO "Service" ("id","businessId","catalogCategoryId","name","duration","price","priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode") VALUES
('s1','b','category','Corte',30,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE'),
('s2','b','category','Crema',30,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE');
INSERT INTO "Professional" ("id","businessId","name","isActive","acceptsBotBookings","botBookingPriority") VALUES ('p1','b','Elisa',true,true,0),('p2','b','Leo',true,true,0);
INSERT INTO "ProfessionalService" ("id","professionalId","serviceId") VALUES ('ps1','p1','s1'),('ps2','p2','s2');
INSERT INTO "BusinessHours" ("id","businessId","dayOfWeek","startTime","endTime") VALUES ('bh','b',1,'09:00','20:00');
INSERT INTO "ProfessionalHours" ("id","professionalId","dayOfWeek","startTime","endTime") VALUES ('ph1','p1',1,'09:00','20:00'),('ph2','p2',1,'09:00','20:00');
`)
type QuerySource = Pick<PGlite, 'query'>
const statements: string[] = []
let rejectSecondChild = false
let lateSlotConflict = false
function orm(pg: QuerySource): Prisma.TransactionClient {
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push(sql)
    if (sql.includes('pg_advisory_xact_lock')) return [{locked:1}]
    if (rejectSecondChild && sql.includes('INSERT INTO "Appointment"') && values.includes('p2')) throw new Error('controlled second child failure')
    if(sql.includes('pg_notify'))return [{notified:''}]
    const result=await pg.query(sql, values.map(v=>v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
    const rows=result.rows as Record<string,unknown>[]
    for(const field of result.fields??[])if(field.dataTypeID===20)for(const row of rows)if(row[field.name]!==null&&row[field.name]!==undefined)row[field.name]=BigInt(String(row[field.name]))
    if(lateSlotConflict && sql.includes('FROM "BusinessBotOptionsSettings" s') && values.some(v=>v instanceof Date && v.toISOString()==='2030-09-02T13:30:00.000Z')) for(const row of rows) row.insideWindow=false
    for (const row of rows) for (const key of ['startAt','endAt','dbNow','scheduledStartAt','expiresAt']) if (row[key] != null) row[key] = new Date(String(row[key]))
    return rows
  }
  const select = async (table: string, where: Record<string, unknown>) => {
    const values: unknown[] = []
    const clauses = Object.entries(where).map(([key,v]) => {
      if (v && typeof v === 'object' && 'in' in v) {
        const list = (v as {in: unknown[]}).in
        return '"'+key+'" IN ('+list.map(item=>{values.push(item);return '$'+values.length}).join(',')+')'
      }
      values.push(v); return '"'+key+'"=$'+values.length
    })
    return query('SELECT * FROM "'+table+'" WHERE '+clauses.join(' AND '),values)
  }
  const delegates: Record<string, unknown> = {}
  for (const [name,table] of Object.entries({professional:'Professional',service:'Service',professionalService:'ProfessionalService',businessHours:'BusinessHours',professionalHours:'ProfessionalHours'})) delegates[name] = {
    findMany: async ({where}:{where:Record<string, unknown>})=>select(table,where),
    findFirst: async ({where}:{where:Record<string, unknown>})=>(await select(table,where))[0]??null,
    count: async ({where}:{where:Record<string, unknown>})=>(await select(table,where)).length
  }
  for(const [name,table] of Object.entries({instagramLead:'InstagramLead',customer:'Customer',customerChannelIdentity:'CustomerChannelIdentity'})) delegates[name]={
    findFirst:async({where,include}:{where:Record<string,unknown>;include?:{customer?:boolean}})=>{
      const row=(await select(table,where))[0]??null
      return row&&include?.customer?{...row,customer:(await select('Customer',{id:row.customerId}))[0]??null}:row
    },
    create:async({data}:{data:Record<string,unknown>})=>{
      const record={id:crypto.randomUUID(),...data},keys=Object.keys(record)
      return (await query('INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(record)))[0]
    }
  }
  return {...delegates,scheduleBlock:{findFirst:async()=>null},$queryRaw:async(q:Prisma.Sql)=>query(q.text,q.values),$executeRaw:async(q:Prisma.Sql)=>{await query(q.text,q.values);return 1}} as unknown as Prisma.TransactionClient
}
const terms: RuntimeBookingTerms = { version:1,businessId:'b',timezone:'America/Argentina/Buenos_Aires',date:'2030-09-02',customerName:'Ana',preference:{kind:'any'},segments:[
  {serviceId:'s1',serviceName:'Corte',professionalId:'p1',professionalName:'Elisa',startAt:'2030-09-02T13:00:00.000Z',endAt:'2030-09-02T13:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:1000,priceMode:'FIXED',configurationHash:null},
  {serviceId:'s2',serviceName:'Crema',professionalId:'p2',professionalName:'Leo',startAt:'2030-09-02T13:30:00.000Z',endAt:'2030-09-02T14:00:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:2000,priceMode:'FIXED',configurationHash:null}
],totalPriceMinor:3000 }
for(const segment of terms.segments) segment.configurationHash=runtimeServiceConfigurationHash((await db.query<Record<string,unknown>>('SELECT * FROM "Service" WHERE id=$1',[segment.serviceId])).rows[0]!)
const shownScope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,revision:'4',configurationId:'cfg',dispatchFenceEpoch:3,handoffFenceEpoch:5}
const presented = {scope:shownScope,version:1 as const,nonce:'9a3db2a0-c131-4262-883a-a7e9aec6fba8',fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true as const,terms}
const draft = {businessId:'b',customerName:'Ana',date:terms.date,pending:'proposal',professional:terms.preference,basket:{members:terms.segments.map((s,i)=>({memberId:'m'+i,mode:'single',serviceIds:[s.serviceId]}))},
  slot:{startAt:terms.segments[0]!.startAt,coordination:{segments:terms.segments.map(({priceMinor,priceMode,configurationHash,...s})=>s)}},bookingReservation:{presented}}
const origin = {kind:'RUNTIME' as const,businessId:'b',sessionId:'session',canonicalPhone:'5491112345678',revision:4n,deploymentId:'dep',generation:2,dispatchFenceEpoch:3,handoffFenceEpoch:5,configurationId:'cfg',operationKey:'runtime:nonce',newBookingAllowed:true}
const input: RuntimeBookingInput = {origin,presented,currentDraft:draft,consent:{nonce:presented.nonce,fingerprint:presented.fingerprint,confirmed:true}}
await db.query('UPDATE "BotSession" SET "state"=$1 WHERE "id"=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:draft}}),'session'])
const counts = async () => (await db.query<{appointments:number;visits:number;operations:number}>(`SELECT (SELECT count(*)::int FROM "Appointment") appointments,(SELECT count(*)::int FROM "BookingVisit") visits,(SELECT count(*)::int FROM "BotOperation") operations`)).rows[0]!
const execute = (value=input,failPersist=false)=>db.transaction(async tx=>{const result=await executePrismaConversationBooking(orm(tx),value);if(failPersist)throw new Error('caller persistence failure');return result})
try {
  await db.transaction(async tx=>{
    await tx.exec(`INSERT INTO "InstagramLead" (id,"businessId","instagramUserId","aiEnabled") VALUES ('ig-lead','b','5491112345678',true);
      INSERT INTO "BusinessInstagramConfig" (id,"businessId","instagramAccountId",enabled) VALUES ('ig-settings','b','ig-account',true);
      INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('ig-customer','b','',NULL,'Before');
      INSERT INTO "CustomerChannelIdentity" (id,"businessId",channel,"externalUserId","customerId") VALUES ('ig-identity','b','INSTAGRAM','5491112345678','ig-customer');
      INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('ig-dep','b','INSTAGRAM',2,3,'cfg',1);
      INSERT INTO "BotSession" (id,"businessId",channel,"instagramLeadId","instagramAccountId","deploymentId","deploymentGeneration",status,revision,"handoffFenceEpoch","businessTimezone") VALUES ('ig-session','b','INSTAGRAM','ig-lead','ig-account','ig-dep',2,'ACTIVE',4,5,'America/Argentina/Buenos_Aires');`)
    await tx.query('UPDATE "BotChannelDeployment" SET "engineKey"=$1',['deterministic-options'])
    await tx.query('UPDATE "BusinessBotConfiguration" SET definition=$1',[JSON.stringify({conversation:{engine:'conversational-booking-v1',schemaVersion:1}})])
    const {canonicalPhone:waPhone,...originWithoutPhone}=origin
    const igOrigin={...originWithoutPhone,sessionId:'ig-session',deploymentId:'ig-dep',operationKey:'ig-runtime:nonce',subject:{channel:'INSTAGRAM' as const,instagramLeadId:'ig-lead',instagramAccountId:'ig-account',externalUserId:'5491112345678'}}
    const nextMonday=new Date((await tx.query<{now:string}>('SELECT clock_timestamp() now')).rows[0]!.now)
    nextMonday.setUTCDate(nextMonday.getUTCDate()+((8-nextMonday.getUTCDay())%7||7));const igDate=nextMonday.toISOString().slice(0,10)
    const igTerms={...terms,date:igDate,segments:terms.segments.map(segment=>({...segment,startAt:igDate+segment.startAt.slice(10),endAt:igDate+segment.endAt.slice(10)}))}
    const igShown={...presented,terms:igTerms,fingerprint:runtimeBookingFingerprint(igTerms),scope:{...presented.scope,sessionId:'ig-session',deploymentId:'ig-dep'}}
    const igDraft={...draft,date:igDate,slot:{startAt:igTerms.segments[0]!.startAt,coordination:{segments:igTerms.segments.map(({priceMinor,priceMode,configurationHash,...segment})=>segment)}},bookingReservation:{presented:igShown}}
    const igInput={origin:igOrigin,presented:igShown,currentDraft:igDraft,consent:{nonce:igShown.nonce,fingerprint:igShown.fingerprint,confirmed:true}} as RuntimeBookingInput
    await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:igDraft}}),'ig-session'])
    for(const change of [{subject:{...igOrigin.subject,instagramAccountId:'other-account'}},{subject:{...igOrigin.subject,externalUserId:'someone-else'}},{revision:3n},{businessId:'foreign'},{handoffFenceEpoch:4}]){
      assert.equal((await executePrismaConversationBooking(orm(tx),{...igInput,origin:{...igOrigin,...change}} as RuntimeBookingInput)).kind,'BLOCKED','IG scope cannot borrow a phone, account, tenant or old consent')
    }
    const result=await executePrismaConversationBooking(orm(tx),igInput)
    assert.equal(result.kind,'COMMITTED','Instagram must execute the SAME booking primitive without any phone')
    assert.deepEqual((await tx.query('SELECT DISTINCT "customerId" FROM "Appointment"')).rows,[{customerId:'ig-customer'}],'numeric sender ID never links the WhatsApp customer')
    assert.deepEqual(await executePrismaConversationBooking(orm(tx),igInput),result,'IG replay does not duplicate appointments')
    assert.equal((await tx.query<{phone:string;normalizedPhone:string|null}>('SELECT phone,"normalizedPhone" FROM "Customer" WHERE id=$1',['ig-customer'])).rows[0]!.phone,'')
    console.log('IG booking/no-phone/exact-customer/replay: PASS')
    await tx.exec('UPDATE "Appointment" SET version=0,"manualDepositPaid"=false; UPDATE "BookingVisit" SET version=0')
    await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'CONFIRMED',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:{...igDraft,bookingReservation:{presented:igShown,receipt:result}}}}),'ig-session'])
    const own=await loadOwnAppointments(orm(tx),{businessId:'b',sessionId:'ig-session',subject:igOrigin.subject,expectedRevision:4n} as never)
    assert.equal(own.items.length,1,'IG exact linked customer can read its coordinated booking without a phone')
    await tx.exec('UPDATE "BusinessBotOptionsSettings" SET "bookingHorizonDays"=90,"rescheduleLeadMinutes"=0')
    const moves=own.items[0]!.snapshot.members.map(member=>({appointmentId:member.appointmentId,newStartAt:new Date(Date.parse(member.startAt)+2*60*60*1000).toISOString()}))
    const proposal=presentGroupReschedule(own.items[0]!.snapshot,moves,'own_lookup')
    const command=confirmGroupReschedule(proposal,{nonce:proposal.nonce,fingerprint:proposal.fingerprint})
    const changed=await rescheduleGroupInTransaction(orm(tx),command)
    assert.equal(changed.appointmentIds.length,2,'IG reschedules the same exact-customer coordinated group')
    assert.equal((await tx.query<{n:number}>('SELECT count(*)::int n FROM "AppointmentChangeHistory"')).rows[0]!.n,2)
    assert.equal((await rescheduleGroupInTransaction(orm(tx),command)).replayed,true,'IG rescheduling replay does not repeat effects')
    console.log('IG own-read/reschedule: PASS')
    await tx.query('UPDATE "CustomerChannelIdentity" SET "customerId"=$1 WHERE id=$2',['customer','ig-identity'])
    assert.equal((await loadOwnAppointments(orm(tx),{businessId:'b',sessionId:'ig-session',subject:igOrigin.subject,expectedRevision:4n} as never)).items.length,0,'an explicit link grants only that exact customer, not the old IG customer')
    await tx.exec(`UPDATE "Appointment" SET "customerId"='customer'; UPDATE "BookingVisit" SET "customerId"='customer',"sessionId"='session'`)
    const linked=await loadOwnAppointments(orm(tx),{businessId:'b',sessionId:'ig-session',subject:igOrigin.subject,expectedRevision:4n} as never)
    assert.equal(linked.items.length,1,'an explicit IG link can read that same customer WA-origin visit')
    const policy={businessId:'b',deploymentId:'ig-dep',generation:2,configurationId:'cfg',channel:'INSTAGRAM' as const}
    const handoffState=projectConversationDraft({...initialDialogueState('b'),completedBooking:{presented:igShown,receipt:result}} as never,policy)
    await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify(handoffState),'ig-session'])
    const unchanged=(await tx.query('SELECT id,status,"startAt",version FROM "Appointment" ORDER BY id')).rows
    const request={businessId:'b',sessionId:'ig-session',policy,expectedRevision:4n,handoffFenceEpoch:5,operationKey:'ig-cancel-referral',command:{ownAppointment:{snapshot:linked.items[0]!.snapshot,action:'cancel' as const,evidence:'Quiero cancelar mi turno'},consent:{revision:4n,evidence:'Quiero cancelar mi turno'}}}
    const handoff=await enqueueConversationalHandoffTx(orm(tx),request)
    assert.ok(handoff.handoffId)
    assert.deepEqual((await tx.query('SELECT id,status,"startAt",version FROM "Appointment" ORDER BY id')).rows,unchanged,'cancel request queues a human and NEVER mutates the appointment')
    assert.equal((await tx.query<{aiEnabled:boolean}>('SELECT "aiEnabled" FROM "InstagramLead" WHERE id=$1',['ig-lead'])).rows[0]!.aiEnabled,false,'handoff pause is durable on the lead')
    assert.equal((await enqueueConversationalHandoffTx(orm(tx),request)).replayed,true)
    console.log('IG exact linked WA-customer/cancellation referral/no appointment mutation: PASS')
    await tx.exec(`UPDATE "BotSession" SET status='ACTIVE',revision=4 WHERE id='ig-session'; UPDATE "InstagramLead" SET "aiEnabled"=true,"botPausedAt"=NULL WHERE id='ig-lead';
      DELETE FROM "AppointmentChangeHistory"; DELETE FROM "BookingDeposit"; DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "BookingVisit"; DELETE FROM "BotOperation"; DELETE FROM "BotHandoff";
      UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100 WHERE id='s1'; UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=60;
      INSERT INTO "BusinessPaymentSettings" (id,"businessId","transferEnabled",alias,"paymentLinkEnabled") VALUES ('ig-pay','b',true,'salon.test',false)`)
    const deposit={financial:{amount:100,ttlMinutes:60,ttlProvenance:'BUSINESS_POLICY' as const,lines:[{serviceId:'s1',sortOrder:0,serviceName:'Corte',mode:'FIXED' as const,configuredValue:100,baseAmount:null,amount:100}]},payment:{transferEnabled:true,alias:'salon.test',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}
    const service=(await tx.query<Record<string,unknown>>('SELECT * FROM "Service" WHERE id=$1',['s1'])).rows[0]!
    const heldTerms={...igTerms,segments:[{...igTerms.segments[0]!,configurationHash:runtimeServiceConfigurationHash(service)}],totalPriceMinor:1000,deposit}
    const heldShown={...igShown,terms:heldTerms,fingerprint:runtimeBookingFingerprint(heldTerms)}
    const heldDraft={...igDraft,basket:{members:[igDraft.basket.members[0]!]},slot:{startAt:heldTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa'},bookingReservation:{presented:heldShown}}
    const heldInput={...igInput,presented:heldShown,currentDraft:heldDraft,consent:{nonce:heldShown.nonce,fingerprint:heldShown.fingerprint,confirmed:true}} as RuntimeBookingInput
    await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:heldDraft}}),'ig-session'])
    const previousCapability=process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED,previousAuthority=process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED
    process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED='false';process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='false'
    process.env.INSTAGRAM_CONVERSATIONAL_BOT_ENABLED='true';process.env.INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS='b'
    try {
      const held=await executePrismaConversationBooking(orm(tx),heldInput)
      assert.equal(held.kind,'HELD','Instagram creates the same real financial hold')
      if(held.kind!=='HELD')throw Error('expected IG hold')
      assert.equal((await tx.query<{source:string;conversationId:string|null}>('SELECT source,"conversationId" FROM "BookingDeposit"')).rows[0]!.source,'INSTAGRAM','IG financial origin is explicit, never disguised as WhatsApp')
      const refreshed=await loadRuntimeDepositReceipt(orm(tx),{businessId:'b',sessionId:'ig-session',subject:igOrigin.subject,expectedRevision:4n} as never,{presented:heldShown,receipt:held})
      assert.deepEqual(refreshed,held,'IG held receipt survives durable reread')
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),{businessId:'b',sessionId:'ig-session',canonicalPhone:origin.canonicalPhone,expectedRevision:4n},{presented:heldShown,receipt:held}),null,'a WA phone cannot read an IG receipt')
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),{businessId:'b',sessionId:'ig-session',subject:{...igOrigin.subject,instagramAccountId:'wrong'},expectedRevision:4n} as never,{presented:heldShown,receipt:held}),null)
      assert.deepEqual(await executePrismaConversationBooking(orm(tx),heldInput),held,'IG deposit replay creates no second obligation')
      console.log('IG financial hold/exact receipt/replay: PASS')
      const financialDialogue={...initialDialogueState('b'),serviceId:'s1',customerName:'Ana',date:igDate,professional:heldTerms.preference,pending:'proposal' as const,slot:{date:igDate,time:'10:00',startAt:heldTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa',band:'MORNING' as const,occupiedMinutes:0},bookingReservation:{presented:heldShown,receipt:held}}
      const financialState=projectConversationDraft(financialDialogue,policy)
      await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify(financialState),'ig-session'])
      const {loadPendingDepositCancellationTx}=await import('../src/services/pending-deposit-cancellation.js')
      const pendingActor={kind:'CUSTOMER' as const,sessionId:'ig-session',subject:igOrigin.subject,expectedRevision:4n,expectedReceipt:{groupId:held.coordinationGroupId,operationKey:held.operationKey,proposalNonce:held.proposalNonce,fingerprint:held.fingerprint}}
      const pendingReset=await loadPendingDepositCancellationTx(orm(tx),{businessId:'b',appointmentId:held.appointments[0]!.appointmentId,actor:pendingActor})
      assert.equal(pendingReset.sessionId,'ig-session','Current pending-hold reset uses exact IG identity and same original session')
      await assert.rejects(loadPendingDepositCancellationTx(orm(tx),{businessId:'b',appointmentId:held.appointments[0]!.appointmentId,actor:{...pendingActor,subject:{...igOrigin.subject,instagramAccountId:'other-account'}}}),/OWNERSHIP/)
      await tx.exec('SAVEPOINT ig_pending_reset')
      const {cancelPendingDepositInTransaction}=await import('../src/services/pending-deposit-cancellation.js')
      assert.equal((await cancelPendingDepositInTransaction(orm(tx),{snapshot:pendingReset,actor:pendingActor,confirmed:true,operationKey:'ig-pending-reset'})).outcome,'CANCELLED')
      assert.equal((await tx.query<{status:string}>('SELECT status FROM "BookingDeposit" WHERE id=$1',[held.depositId])).rows[0]!.status,'REJECTED','Only the current pending hold is released by the existing reset policy')
      const {canResumeExpiredConversationTx}=await import('../src/conversational-bot/conversation-expired-recovery.js')
      await tx.exec(`UPDATE "BotOutbox" SET status='ACCEPTED' WHERE "sessionId"='ig-session'`)
      const terminalRows=(await tx.query('SELECT * FROM "Appointment" ORDER BY id')).rows
      assert.equal(await canResumeExpiredConversationTx(orm(tx),{...heldShown.scope,subject:igOrigin.subject},financialDialogue),true,'Terminal current IG hold can recover only after exact receipt and effect checks')
      assert.equal(await canResumeExpiredConversationTx(orm(tx),{...heldShown.scope,subject:{...igOrigin.subject,instagramAccountId:'foreign'}},financialDialogue),false)
      assert.deepEqual((await tx.query('SELECT * FROM "Appointment" ORDER BY id')).rows,terminalRows,'Recovery reads never mutate historical appointments')
      await tx.exec('ROLLBACK TO SAVEPOINT ig_pending_reset')

      const proofBinding=conversationProofBindingFromState(financialState,{businessId:'b',sessionId:'ig-session',deploymentId:'ig-dep',generation:2,configurationId:'cfg',revision:'4',timezone:igTerms.timezone})
      assert.ok(proofBinding)
      const pdfProof=process.argv.includes('--instagram-pdf-proof')
      const proofPayload={kind:'message',channel:'INSTAGRAM',instagramLeadId:'ig-lead',instagramAccountId:'ig-account',senderId:'5491112345678',messageType:pdfProof?'document':'image',mediaSource:'INSTAGRAM_SIGNED_URL',instagramAttachment:{type:pdfProof?'file':'image',url:'https://lookaside.fbsbx.com/ig_messaging_cdn/?signed=offline'},textBody:'',mediaMimeType:null,contextWindowEvaluated:true}
      await tx.query('INSERT INTO "BotProviderEvent" (id,"businessId",provider,"eventType","providerMessageId",payload,status,"admittedAt","providerOccurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),clock_timestamp())',['ig-proof-event','b','INSTAGRAM','MESSAGE','ig-proof-mid',JSON.stringify(proofPayload),'PROCESSED'])
      await tx.query('INSERT INTO "BotActionInbox" (id,"businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","actionType","entityRef",status) VALUES ($1,$2,$3,$4,$5,2,$6,$7,$8)',['ig-proof-inbox','b','ig-proof-event','ig-session','ig-dep',CONVERSATION_PROOF_ACTION,JSON.stringify(proofBinding),'PROCESSED'])
      const proofEvent={id:'ig-proof-event',businessId:'b',providerMessageId:'ig-proof-mid',phoneNumberId:null,payload:proofPayload}
      assert.deepEqual(await resolveProofTarget(orm(tx),proofEvent,'ig-dep'),{kind:'FOUND',depositId:held.depositId},'proof target resolves only the bound IG obligation without a phone')
      await tx.query('INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration",status,attempts,"maxAttempts","leaseToken","leasedUntil") VALUES ($1,$2,$3,$4,$5,2,$6,1,5,$7,clock_timestamp()+interval \'1 minute\')',['ig-proof-job','RECEIVE_DEPOSIT_PROOF','ig-proof-event','b','ig-dep','LEASED','ig-proof-token'])
      const proofClient={...orm(tx),$transaction:async<T>(run:(client:Prisma.TransactionClient)=>Promise<T>)=>run(orm(tx))}
      const image=pdfProof?await(async()=>{const pdf=await(await import('pdf-lib')).PDFDocument.create();pdf.addPage([100,100]);return pdf.save({useObjectStreams:false})})():await (await import('sharp')).default({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer()
      assert.equal((await resolveProofTarget(orm(tx),{...proofEvent,payload:{...proofPayload,instagramAccountId:'other-account'}},'ig-dep')).kind,'NONE','proof cannot cross account')
      for(const binding of [{...proofBinding,depositId:'foreign-deposit'},{...proofBinding,revision:'5'}]){
        await tx.query('UPDATE "BotActionInbox" SET "entityRef"=$1 WHERE id=$2',[JSON.stringify(binding),'ig-proof-inbox'])
        assert.equal((await resolveProofTarget(orm(tx),proofEvent,'ig-dep')).kind,'NONE','foreign obligation or future binding never authorizes proof bytes')
      }
      await tx.query('UPDATE "BotActionInbox" SET "entityRef"=$1 WHERE id=$2',[JSON.stringify(proofBinding),'ig-proof-inbox'])
      let proofDownloads=0
      const proofResult=await processDepositProofJob({client:proofClient as never,job:{id:'ig-proof-job',kind:'RECEIVE_DEPOSIT_PROOF',aggregateId:'ig-proof-event',businessId:'b',deploymentId:'ig-dep',deploymentGeneration:2,expectedRevision:4n,attempts:1,maxAttempts:5,claimToken:'ig-proof-token',claimedUntil:new Date(Date.now()+60000),queueWaitMs:0,channel:'INSTAGRAM'},capabilityEnabled:true,instagramFetch:(async(_url:string,options:{headers:Record<string,string>})=>{proofDownloads++;assert.deepEqual(options.headers,{});return {ok:true,headers:new Headers({'content-type':pdfProof?'application/pdf':'image/png','content-length':String(image.length)}),body:(async function*(){yield image})()}}) as never})
      assert.equal(proofResult,'APPLIED');assert.equal(proofDownloads,1)
      assert.equal((await tx.query<{status:string}>('SELECT status FROM "BookingDeposit" WHERE id=$1',[held.depositId])).rows[0]!.status,'PROOF_RECEIVED','validated IG proof waits for staff review and is NEVER approved automatically')
      assert.equal((await tx.query<{n:number}>("SELECT count(*)::int n FROM \"BotOutbox\" WHERE payload->>'channel'='INSTAGRAM'")).rows[0]!.n,1,'proof acknowledgement uses the shared IG outbox')
      console.log('IG exact financial proof worker/'+(pdfProof?'PDF':'image')+' validation/receipt acknowledgement: PASS')

      await tx.exec('DELETE FROM "BookingDepositProof"; DELETE FROM "BookingDepositLine"; DELETE FROM "BookingDeposit"; DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "BookingVisit"; DELETE FROM "BotOperation"; DELETE FROM "BotJob"')
      const groupTerms={...igTerms,segments:[{...heldTerms.segments[0]!},igTerms.segments[1]!],deposit}
      const groupShown={...igShown,terms:groupTerms,fingerprint:runtimeBookingFingerprint(groupTerms)}
      const groupDraft={...igDraft,bookingReservation:{presented:groupShown}}
      await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:groupDraft}}),'ig-session'])
      const groupInput={...igInput,presented:groupShown,currentDraft:groupDraft,consent:{nonce:groupShown.nonce,fingerprint:groupShown.fingerprint,confirmed:true}} as RuntimeBookingInput
      const groupHeld=await executePrismaConversationBooking(orm(tx),groupInput)
      assert.equal(groupHeld.kind,'HELD','IG coordinated financial booking must hold every segment')
      assert.deepEqual(await executePrismaConversationBooking(orm(tx),groupInput),groupHeld,'IG coordinated receipt remains recoverable and idempotent')
      console.log('IG coordinated financial hold/receipt/replay: PASS')
      await tx.exec(`DELETE FROM "BookingDepositProof"; DELETE FROM "BookingDepositLine"; DELETE FROM "BookingDeposit"; DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "BookingVisit"; DELETE FROM "BotOperation"; DELETE FROM "BotJob"; DELETE FROM "CustomerChannelIdentity" WHERE id='ig-identity'; UPDATE "Service" SET "depositMode"='NONE',"depositValue"=NULL WHERE id='s1'`)
      const freshTerms={...igTerms,segments:igTerms.segments.map(segment=>({...segment}))}
      freshTerms.segments[0]!.configurationHash=runtimeServiceConfigurationHash((await tx.query<Record<string,unknown>>('SELECT * FROM "Service" WHERE id=$1',['s1'])).rows[0]!)
      const freshShown={...igShown,terms:freshTerms,fingerprint:runtimeBookingFingerprint(freshTerms)}
      const freshDraft={...igDraft,bookingReservation:{presented:freshShown}}
      await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:freshDraft}}),'ig-session'])
      const fresh=await executePrismaConversationBooking(orm(tx),{...igInput,presented:freshShown,currentDraft:freshDraft,consent:{confirmed:true,nonce:freshShown.nonce,fingerprint:freshShown.fingerprint}} as RuntimeBookingInput)
      assert.equal(fresh.kind,'COMMITTED','new Instagram customer is created after a valid name, without a phone')
      const created=(await tx.query<{id:string;phone:string;normalizedPhone:string|null;name:string}>('SELECT c.id,c.phone,c."normalizedPhone",c.name FROM "CustomerChannelIdentity" i JOIN "Customer" c ON c.id=i."customerId" WHERE i."businessId"=$1 AND i.channel=$2 AND i."externalUserId"=$3',['b','INSTAGRAM','5491112345678'])).rows[0]!
      assert.equal(created.phone,'');assert.equal(created.normalizedPhone,null);assert.equal(created.name,'Ana');assert.notEqual(created.id,'customer')
      console.log('IG new named customer/no phone/no typed identity match: PASS')
    } finally {
      delete process.env.INSTAGRAM_CONVERSATIONAL_BOT_ENABLED;delete process.env.INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS
      if(previousCapability===undefined)delete process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED;else process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED=previousCapability
      if(previousAuthority===undefined)delete process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED;else process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=previousAuthority
    }
    throw new Error('reset Instagram booking')
  }).catch(error=>{if(!(error instanceof Error)||error.message!=='reset Instagram booking')throw error})
  if (!process.argv.includes('--instagram-only')) {
  for(const change of [{revision:3n},{canonicalPhone:'5491199999999'},{businessId:'foreign'},{handoffFenceEpoch:4},{dispatchFenceEpoch:2},{generation:1},{newBookingAllowed:false}]) {
    const result=await execute({...input,origin:{...origin,...change}})
    assert.equal(result.kind,'BLOCKED');assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0})
  }
  assert.equal((await execute({...input,consent:{...input.consent,confirmed:false}})).kind,'BLOCKED')
  await db.transaction(async tx=>{await tx.query('UPDATE "Conversation" SET phone=$1 WHERE id=$2',['demo:preview:admin:'+origin.canonicalPhone,'c']);assert.equal((await executePrismaConversationBooking(orm(tx),input)).kind,'BLOCKED');throw new Error('reset nonphone origin')}).catch(error=>assert.match(String(error),/reset nonphone origin/))
  const before=structuredClone(input)
  const noProofTerms={...terms,segments:terms.segments.map(s=>({...s,configurationHash:null}))}
  const noProofPresented={...presented,terms:noProofTerms,fingerprint:runtimeBookingFingerprint(noProofTerms)}
  await db.transaction(async tx=>{const noProofDraft={...draft,bookingReservation:{presented:noProofPresented}};await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:noProofDraft}}),'session']);assert.notEqual((await executePrismaConversationBooking(orm(tx),{...input,currentDraft:noProofDraft,presented:noProofPresented,consent:{confirmed:true,nonce:noProofPresented.nonce,fingerprint:noProofPresented.fingerprint}})).kind,'COMMITTED');throw new Error('reset no proof')}).catch(error=>assert.match(String(error),/reset no proof/))
  for(const sql of [
    `UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100 WHERE "id"='s2'`,
    `UPDATE "Service" SET "requiresPhoto"=true WHERE "id"='s2'`,
    `UPDATE "Service" SET "duration"=60 WHERE "id"='s2'`,
    `UPDATE "Service" SET "price"=2500 WHERE "id"='s2'`,
    `UPDATE "Professional" SET "name"='Changed' WHERE "id"='p2'`,
    `UPDATE "ServiceCategory" SET "isActive"=false WHERE "id"='category'`
  ]) {
    await db.transaction(async tx=>{await tx.exec(sql); const result=await executePrismaConversationBooking(orm(tx),input);assert.notEqual(result.kind,'COMMITTED');assert.equal((await tx.query<{n:number}>('SELECT count(*)::int n FROM "BotOperation"')).rows[0]!.n,0);throw new Error('reset negative')}).catch(error=>{assert.match(String(error),/reset negative/)})
  }
  lateSlotConflict=true
  await assert.rejects(execute(),/child conflict/)
  lateSlotConflict=false
  assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0})
  rejectSecondChild=true
  await assert.rejects(execute(),/second child/)
  rejectSecondChild=false
  assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0})
  await assert.rejects(execute(input,true),/caller persistence/)
  assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0})

  for(const mode of ['missing','renamed'] as const) {
    await db.transaction(async tx=>{
      await tx.exec(mode==='missing' ? 'DELETE FROM "Customer"' : `UPDATE "Customer" SET name='Before'`)
      const created=await executePrismaConversationBooking(orm(tx),input)
      assert.equal(created.kind,'COMMITTED')
      const rows=(await tx.query<{name:string;phone:string;normalizedPhone:string;businessId:string}>('SELECT name,phone,"normalizedPhone","businessId" FROM "Customer"')).rows
      assert.deepEqual(rows,[{name:'Ana',phone:origin.canonicalPhone,normalizedPhone:origin.canonicalPhone,businessId:'b'}])
      throw new Error('reset real identity')
    }).catch(error=>assert.match(String(error),/reset real identity/))
  }
  for(const mutation of ['membership','date','preference','scope','conditions','unknownfield'] as const) {
    const bad=structuredClone(input)
    if(mutation==='membership') (bad.currentDraft as typeof draft).basket.members[1]!.serviceIds=['s1']
    if(mutation==='date') (bad.currentDraft as typeof draft).date='2030-09-03'
    if(mutation==='preference') (bad.currentDraft as typeof draft).professional={kind:'specific',id:'p1'} as typeof draft.professional
    if(mutation==='scope') bad.presented.scope.revision='3'
    if(mutation==='conditions') Object.assign(bad.presented,{conditionsPresented:false})
    if(mutation==='unknownfield') Object.assign(bad.presented.terms,{priceOverride:1})
    assert.equal((await execute(bad)).kind,'BLOCKED')
    assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0})
  }
  // Execute the existing financial primitive in this local DB only. Restore every
  // side effect with caller rollback so all pre-existing NONE tests remain intact.
  const oldCapability=process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED, oldAuthority=process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED
  process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED='true';process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='true'
  try {
    await db.transaction(async tx=>{
      await tx.exec(`UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100,duration=45,"customerDurationMin"=120,"customerDurationMax"=120 WHERE id='s1';
        UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=60 WHERE "businessId"='b';
        INSERT INTO "BusinessPaymentSettings" (id,"businessId","transferEnabled",alias,"paymentLinkEnabled") VALUES ('pay','b',true,'salon.test',false)`)
      const s=(await tx.query<Record<string,unknown>>('SELECT * FROM "Service" WHERE id=$1',['s1'])).rows[0]!
      const deposit={financial:{amount:100,ttlMinutes:60,ttlProvenance:'BUSINESS_POLICY' as const,lines:[{serviceId:'s1',sortOrder:0,serviceName:'Corte',mode:'FIXED' as const,configuredValue:100,baseAmount:null,amount:100}]},payment:{transferEnabled:true,alias:'salon.test',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}
      const oneTerms={...terms,segments:[{...terms.segments[0]!,durationMinutes:45,customerDurationMinutes:120,endAt:'2030-09-02T15:00:00.000Z',configurationHash:runtimeServiceConfigurationHash(s)}],totalPriceMinor:1000,deposit}
      const shown={...presented,terms:oneTerms,fingerprint:runtimeBookingFingerprint(oneTerms)}
      const current={...draft,basket:{members:[draft.basket.members[0]!]},slot:{startAt:oneTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa'},bookingReservation:{presented:shown}}
      await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:current}}),'session'])
      const financialInput={...input,presented:shown,currentDraft:current,consent:{confirmed:true,nonce:shown.nonce,fingerprint:shown.fingerprint}} as RuntimeBookingInput
      process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='false'
      assert.equal((await executePrismaConversationBooking(orm(tx),financialInput)).kind,'BLOCKED','server capability cannot be forged by newBookingAllowed')
      process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED='true'
      for(const mutation of [`UPDATE "Service" SET "depositValue"=101 WHERE id='s1'`,`UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=61`,`UPDATE "BusinessPaymentSettings" SET alias='changed.test'`]){
        await tx.exec(mutation)
        assert.notEqual((await executePrismaConversationBooking(orm(tx),financialInput)).kind,'HELD','financial values changed after display require new consent')
        assert.equal((await tx.query<{n:number}>('SELECT count(*)::int n FROM "BotOperation"')).rows[0]!.n,0)
        await tx.exec(`UPDATE "Service" SET "depositValue"=100 WHERE id='s1';UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=60;UPDATE "BusinessPaymentSettings" SET alias='salon.test'`)
      }
      const result=await executePrismaConversationBooking(orm(tx),financialInput)
      assert.equal(result.kind,'HELD','a fixed deposit creates a real hold, never a false confirmed receipt')
      assert.deepEqual(await executePrismaConversationBooking(orm(tx),financialInput),result,'financial replay does not create a second visit or deposit')
      const rows=(await tx.query<{status:string;depositStatus:string;amount:number;ttl:number}>(`SELECT a.status,d.status AS "depositStatus",d.amount,d."holdTtlMinutes" AS ttl FROM "Appointment" a JOIN "BookingDeposit" d ON d."appointmentId"=a.id`)).rows
      assert.deepEqual(rows,[{status:'PENDING',depositStatus:'PENDING_PROOF',amount:100,ttl:60}])
      if(result.kind!=='HELD')throw new Error('expected actual held receipt')
      const reservation={presented:shown,receipt:result}

      const policy={businessId:'b',deploymentId:'dep',generation:2,configurationId:'cfg'}
      const dialogue={...initialDialogueState('b'),serviceId:'s1',customerName:'Ana',date:oneTerms.date,professional:oneTerms.preference,pending:'proposal' as const,slot:{date:oneTerms.date,time:'10:00',startAt:oneTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa',band:'MORNING' as const,occupiedMinutes:0},bookingReservation:reservation}
      const heldState=projectConversationDraft(dialogue,policy)
      assert.equal(heldState.booking,'HELD');assert.equal(heldState.deposit,'PENDING_PROOF');assert.equal(heldState.flow,'DEPOSIT_INSTRUCTIONS')
      assert.equal(heldState.selections.appointmentId,result.appointments[0]!.appointmentId)
      assert.equal(conversationStepForBotOptionsState(heldState),'AWAITING_DEPOSIT')
      assert.throws(()=>reconcileConversationDraft(heldState,{...policy,generation:3},oneTerms.timezone),/protected/,'configuration replacement cannot discard financial ownership')
      const proofTarget=(await tx.query<{n:number}>(`SELECT count(*)::int n FROM "BookingDeposit" d JOIN "BookingVisit" v ON v.id=d."visitId" AND v."businessId"=d."businessId" JOIN "Appointment" a ON a.id=d."appointmentId" AND a."visitId"=v.id WHERE d."conversationId"='c' AND v."sessionId"='session' AND d.source='WHATSAPP' AND d.status='PENDING_PROOF' AND d."snapshotSealedAt" IS NOT NULL AND v.status='HELD' AND a.status='PENDING'`)).rows[0]!.n
      assert.equal(proofTarget,1,'existing proof ingress can identify the sealed pending WhatsApp visit')
      assert.equal((await tx.query<{n:number}>(`SELECT count(*)::int n FROM "BotJob" WHERE kind='EXPIRE_DEPOSIT' AND "aggregateId"=$1 AND "businessId"='b' AND "deploymentId"='dep' AND "deploymentGeneration"=2`,[result.depositId])).rows[0]!.n,1,'existing expiry job is created atomically with the hold')

      assert.doesNotMatch(runtimeBookingReceiptReply(reservation),/reserva fue confirmada/i)
      assert.match(runtimeBookingReceiptReply(reservation),/salon.test/)
      assert.match(runtimeBookingReceiptReply(reservation),/comprobante.*antes/i)
      const readScope={businessId:'b',sessionId:'session',canonicalPhone:origin.canonicalPhone,expectedRevision:4n}
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),{...readScope,businessId:'foreign'},reservation),null)
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),{...readScope,canonicalPhone:'5491199999999'},reservation),null)
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),{...readScope,expectedRevision:3n},reservation),null)
      for(const [depositStatus,visitStatus,appointmentStatus] of [['PROOF_RECEIVED','PENDING_PAYMENT_REVIEW','PENDING'],['APPROVED','CONFIRMED','CONFIRMED'],['EXPIRED','EXPIRED','CANCELLED'],['REJECTED','CANCELLED','CANCELLED']] as const){
        await tx.query('UPDATE "BookingDeposit" SET status=$1',[depositStatus]);await tx.query('UPDATE "BookingVisit" SET status=$1',[visitStatus]);await tx.query('UPDATE "Appointment" SET status=$1',[appointmentStatus])
        const actual=await loadRuntimeDepositReceipt(orm(tx),readScope,reservation)
        assert.equal(actual?.depositStatus,depositStatus,'status comes from scoped financial rows, never client text or the original HELD receipt')

        const projected=projectConversationDraft({...dialogue,bookingReservation:{presented:shown,receipt:actual!}},policy)
        const expected={PROOF_RECEIVED:['PENDING_PAYMENT_REVIEW','PROOF_RECEIVED','DEPOSIT_REVIEW'],APPROVED:['CONFIRMED','APPROVED','BOOKING_CONFIRMED'],EXPIRED:['EXPIRED','EXPIRED','APPOINTMENT_DETAIL'],REJECTED:['CANCELLED','REJECTED_FINAL','APPOINTMENT_DETAIL']} as const
        assert.deepEqual([projected.booking,projected.deposit,projected.flow],expected[depositStatus])

        assert.equal(/La reserva fue confirmada/.test(runtimeBookingReceiptReply({...reservation,receipt:actual!})),depositStatus==='APPROVED')
      }
      await tx.exec(`UPDATE "BookingDepositLine" SET amount=999`)
      assert.equal(await loadRuntimeDepositReceipt(orm(tx),readScope,reservation),null,'sealed financial line mismatch cannot claim approval')
      throw new Error('reset financial hold')
    }).catch(error=>assert.match(String(error),/reset financial hold/))
    assert.deepEqual(await counts(),{appointments:0,visits:0,operations:0},'caller rollback includes financial holds')

    // P14 conversational adapter: run aggregate holds against the same local SQL
    // harness, never a network database. Each case rolls back every member.
    for (const modes of [['FIXED', 'NONE'], ['FIXED', 'PERCENTAGE'], ['NONE', 'FIXED']] as const) {
      const resetMarker = 'reset P14 coordinated hold ' + modes.join('+')
      await db.transaction(async tx => {
        await tx.query('UPDATE "Service" SET "depositMode"=$1,"depositValue"=$2,duration=45,"customerDurationMin"=120,"customerDurationMax"=120 WHERE id=$3',
          [modes[0], modes[0] === 'NONE' ? null : 100, 's1'])
        await tx.query('UPDATE "Service" SET "depositMode"=$1,"depositValue"=$2 WHERE id=$3',
          [modes[1], modes[1] === 'NONE' ? null : modes[1] === 'PERCENTAGE' ? 10 : 150, 's2'])
        await tx.exec(`UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=60 WHERE "businessId"='b';
          INSERT INTO "BusinessPaymentSettings" (id,"businessId","transferEnabled",alias,"paymentLinkEnabled") VALUES ('pay','b',true,'salon.test',false)`)
        if (modes[1] === 'PERCENTAGE') await tx.exec(`UPDATE "Service" SET "priceMode"='STARTING_AT' WHERE id='s2'`)
        const groupTerms: RuntimeBookingTerms = structuredClone(terms)
        if (modes[1] === 'PERCENTAGE') {
          groupTerms.segments[1]!.priceMode = 'STARTING_AT'
          groupTerms.totalPriceMinor = null
        }
        Object.assign(groupTerms.segments[0]!, { durationMinutes: 45, customerDurationMinutes: 120, endAt: '2030-09-02T15:00:00.000Z' })
        Object.assign(groupTerms.segments[1]!, { startAt: '2030-09-02T15:00:00.000Z', endAt: '2030-09-02T15:30:00.000Z' })
        const lines = []
        for (const [index, segment] of groupTerms.segments.entries()) {
          const service = (await tx.query<Record<string, unknown>>('SELECT * FROM "Service" WHERE id=$1', [segment.serviceId])).rows[0]!
          segment.configurationHash = runtimeServiceConfigurationHash(service)
          if (modes[index] === 'NONE') continue
          lines.push({ serviceId: segment.serviceId, serviceName: segment.serviceName, sortOrder: index,
            mode: modes[index] as 'FIXED' | 'PERCENTAGE', configuredValue: Number(service.depositValue),
            baseAmount: modes[index] === 'PERCENTAGE' ? segment.priceMinor : null,
            amount: modes[index] === 'PERCENTAGE' ? 200 : Number(service.depositValue) })
        }
        const amount = lines.reduce((sum, line) => sum + line.amount, 0)
        groupTerms.deposit = { financial: { lines, amount, ttlMinutes: 60, ttlProvenance: 'BUSINESS_POLICY' },
          payment: { transferEnabled: true, alias: 'salon.test', cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null } }
        const groupShown = { ...presented, terms: groupTerms, fingerprint: runtimeBookingFingerprint(groupTerms) }
        const current = { ...draft, slot: { startAt: groupTerms.segments[0]!.startAt,
          coordination: { segments: groupTerms.segments.map(({ priceMinor, priceMode, configurationHash, ...segment }) => segment) } },
          bookingReservation: { presented: groupShown } }
        await tx.query('UPDATE "BotSession" SET state=$1 WHERE id=$2', [JSON.stringify({
          booking: 'DRAFT', deposit: 'NONE', handoff: 'NONE', conversationDraft: { dialogue: current } }), 'session'])
        const jointInput: RuntimeBookingInput = { ...input, presented: groupShown, currentDraft: current,
          consent: { confirmed: true, nonce: groupShown.nonce, fingerprint: groupShown.fingerprint } }
        assert.equal((await executePrismaConversationBooking(orm(tx), { ...jointInput,
          consent: { ...jointInput.consent, nonce: 'old-nonce' } })).kind, 'BLOCKED', 'one current nonce owns ALL segments')
        for (const [mutation, restore] of [
          [`UPDATE "Service" SET "depositValue"="depositValue"+1 WHERE "depositMode"<>'NONE'`,
            `UPDATE "Service" SET "depositValue"="depositValue"-1 WHERE "depositMode"<>'NONE'`],
          [`UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=61`,
            `UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=60`],
          [`UPDATE "BusinessPaymentSettings" SET alias='changed.test'`,
            `UPDATE "BusinessPaymentSettings" SET alias='salon.test'`]
        ] as const) {
          await tx.exec(mutation)
          assert.notEqual((await executePrismaConversationBooking(orm(tx), jointInput)).kind, 'HELD',
            'changed deposit terms anywhere in the group require fresh consent')
          assert.equal((await tx.query<{ n: number }>('SELECT count(*)::int n FROM "BotOperation"')).rows[0]!.n, 0,
            'rejected group terms cannot retain a subset')
          await tx.exec(restore)
        }
        const result = await executePrismaConversationBooking(orm(tx), jointInput)
        assert.equal(result.kind, 'HELD', 'P14 coordinated deposit must hold ALL: ' + modes.join('+'))
        if (result.kind !== 'HELD') throw new Error('P14 expected held group')
        assert.equal(result.amount, amount)
        assert.ok(result.coordinatedDepositGroup, 'receipt references the durable group seal')
        if (modes[1] === 'PERCENTAGE') {
          const estimated = (await tx.query<{ quotedPrice: number | null; totalPrice: number | null }>(
            `SELECT a."quotedPrice",v."totalPrice" FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" WHERE a."serviceId"='s2'`)).rows[0]!
          assert.deepEqual(estimated, { quotedPrice: null, totalPrice: null }, 'known deposit does not invent the final price')
        }
        assert.equal(result.appointments.length, 2)
        const members = (await tx.query<{ serviceId: string; appointmentId: string; appointmentStatus: string; visitStatus: string; depositId: string | null; amount: number | null; expiresAt: string | null }>(
          `SELECT a."serviceId",a.id AS "appointmentId",a.status AS "appointmentStatus",v.status AS "visitStatus",
            d.id AS "depositId",d.amount,d."expiresAt" FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId"
            LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id ORDER BY a."serviceId"`)).rows
        assert.equal(members.length, 2)
        assert.ok(members.every(member => member.appointmentStatus === 'PENDING' && member.visitStatus === 'HELD'), 'NONE companion is not prematurely confirmed')
        assert.equal(members.filter(member => member.depositId !== null).length, lines.length, 'NONE has no fictitious obligation')
        assert.equal(result.depositId, members.find(member => member.depositId !== null)!.depositId, 'financial anchor may be segment one')
        assert.ok(members.filter(member => member.depositId !== null).every(member => new Date(member.expiresAt!).toISOString() === result.expiresAt), 'common deadline')
        assert.deepEqual(await executePrismaConversationBooking(orm(tx), jointInput), result, 'group replay is idempotent')
        const reservation = { presented: groupShown, receipt: result }
        assert.doesNotMatch(runtimeBookingReceiptReply(reservation), /La reserva fue confirmada/)
        assert.equal((runtimeBookingReceiptReply(reservation).match(/Enviá el comprobante/g) ?? []).length, 1)
        const readScope = { businessId: 'b', sessionId: 'session', canonicalPhone: origin.canonicalPhone, expectedRevision: 4n }
        assert.deepEqual(await loadRuntimeDepositReceipt(orm(tx), readScope, reservation), result, 'reader validates complete sealed group including NONE companion')
        assert.equal(await loadRuntimeDepositReceipt(orm(tx), { ...readScope, canonicalPhone: '5491199999999' }, reservation), null)
        assert.equal(await loadRuntimeDepositReceipt(orm(tx), { ...readScope, expectedRevision: 3n }, reservation), null)
        assert.equal(await loadRuntimeDepositReceipt(orm(tx), readScope, { ...reservation,
          receipt: { ...result, proposalNonce: 'old-nonce' } }), null, 'reader checks current sealed proposal nonce')
        assert.equal(await loadRuntimeDepositReceipt(orm(tx), readScope, { ...reservation,
          receipt: { ...result, coordinatedDepositGroup: { ...result.coordinatedDepositGroup!, requestHash: 'a'.repeat(64) } } }), null,
          'well-shaped but wrong seal hash cannot grant group authority')
        await tx.exec(`UPDATE "Appointment" SET "coordinationGroupId"='foreign-group' WHERE "serviceId"='s2'`)
        assert.equal(await loadRuntimeDepositReceipt(orm(tx), readScope, reservation), null, 'one bad member invalidates group authority')
        throw new Error(resetMarker)
      }).catch(error => { if (!(error instanceof Error) || error.message !== resetMarker) throw error })
      assert.deepEqual(await counts(), { appointments: 0, visits: 0, operations: 0 }, 'rollback clears every P14 child and parent')
    }
  } finally {
    if(oldCapability===undefined)delete process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED;else process.env.BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED=oldCapability
    if(oldAuthority===undefined)delete process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED;else process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=oldAuthority
  }
  const result=await execute()
  assert.equal(result.kind,'COMMITTED')
  if(result.kind!=='COMMITTED')throw new Error('unreachable')
  assert.equal(result.appointments.length,2)
  assert.equal(new Set(result.appointments.map(a=>a.visitId)).size,2)
  assert.deepEqual(await counts(),{appointments:2,visits:2,operations:3})
  assert.deepEqual(await execute(),result,'replay before checking own occupied availability')
  assert.deepEqual(input,before)
  assert.equal((await execute({...input,presented:{...presented,fingerprint:'a'.repeat(64)}})).kind,'BLOCKED')
  await db.transaction(async tx=>{await tx.exec(`UPDATE "Appointment" SET "coordinationGroupId"='foreign-group' WHERE "serviceId"='s2'`);await assert.rejects(executePrismaConversationBooking(orm(tx),input),/replay|membership/);throw new Error('reset replay')}).catch(error=>assert.match(String(error),/reset replay/))
  await db.transaction(async tx=>{await tx.exec(`UPDATE "BotOperation" SET "requestHash"='tampered' WHERE "operationKey" LIKE '%segment:1:CONFIRM_VISIT'`);await assert.rejects(executePrismaConversationBooking(orm(tx),input),/replay/);throw new Error('reset child hash')}).catch(error=>assert.match(String(error),/reset child hash/))
  assert.ok(statements.some(s=>s.includes('pg_advisory_xact_lock')),'existing agenda locks reused')
  console.log('booking runtime PGlite: PASS (production F7 children; caller rollback; no network; no cross-process lock claim)')
  }
} finally { await db.close() }
