import assert from 'node:assert/strict'
import { canResumeExpiredConversationTx } from '../src/conversational-bot/conversation-expired-recovery.js'
import { loadPendingDepositCancellationTx, cancelPendingDepositInTransaction } from '../src/services/pending-deposit-cancellation.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { expireDepositHold } from '../src/bot-options/application/expire-deposit-hold.js'
import { resolveProofTarget } from '../src/bot-options/application/process-deposit-proof-job.js'
import { enqueueDepositNotificationTx, bridgeDirectDepositNotificationTx, encodeDirectNotificationRecovery } from '../src/services/deposit-notification-outbox.js'
import { createCashTransactionRepository, projectApprovedDepositPaymentInTransaction } from '../src/repositories/prisma-cash-repository.js'
import { CashService, ensureAppointmentAccountForPayment } from '../src/services/cash-service.js'
import { calculateAccountTotals } from '../src/services/cash-domain.js'
import { approveCurrentDepositProofInTransaction, rejectCurrentDepositProofInTransaction } from '../src/services/deposit-review-operation.js'
import { createHash } from 'node:crypto'
import { writeValidatedDepositProofInTransaction } from '../src/services/deposit-proof-writer.js'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import * as booking from '../src/services/booking-operations.js'
import { hasAppointmentOverlap } from '../src/services/prisma-booking.js'
import { calculateBookingDepositTerms } from '../src/services/deposit-operations.js'
import { parseEstimateOptions, resolveServiceEstimate } from '../src/bot-options/domain/service-booking.js'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'
import { loadRuntimeDepositReceipt, runtimeBookingChildInput, runtimeBookingRequestHash, type RuntimeHeldReceipt } from '../src/conversational-bot/prisma-conversational-booking.js'

// Entirely in-process PostgreSQL. No environment, Prisma connection, network or real business.
const db = new PGlite({parsers:{1114:(value:string)=>new Date(value+'Z')}})
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','BookingDepositLine','BookingDepositExpiryAudit','BusinessPaymentSettings','BotJob','ServiceCombinationRule','BotOperation','BusinessWhatsAppConfig','BotOutbox','StaffAuditLog','User','BotProviderEvent','BotActionInbox']
const enums = [...schema.matchAll(/^enum (\w+) \{/gm)].map(m=>m[1]!)
for (const name of enums) {
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
    const type = scalar ?? (schema.includes('enum '+field[2]+' {') ? enums.includes(field[2]!) ? '"'+field[2]+'"' : 'text' : null)
    const primary = field[1] === (name === 'BusinessBotOptionsSettings' || name === 'BusinessPaymentSettings' ? 'businessId' : 'id')
    const literal=line.match(/@default\((true|false|[0-9]+|[A-Z_]+|"[^"]*")\)/)?.[1]
    const defaultSql=literal?(/^(true|false|[0-9]+)$/.test(literal)?literal:"'"+literal.replace(/^"|"$/g,'').replace(/'/g,"''")+"'"):null
    return type ? ['"'+(line.match(/@map\("([^"]+)"\)/)?.[1]??field[1])+'" '+type+(primary?' PRIMARY KEY':'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':defaultSql?' DEFAULT '+defaultSql:'')] : []
  })
  await db.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
}
await db.exec(`CREATE UNIQUE INDEX operation_key ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX appointment_visit ON "Appointment" ("visitId"); CREATE UNIQUE INDEX business_tenant_id ON "BookingVisit" ("businessId",id); CREATE UNIQUE INDEX business_service_id ON "Service" ("businessId",id)`)
// Install VERBATIM migration SQL for the real F8 constraints, membership, totals,
// sealing and immutability. Only already-created scalar columns/table DDL are omitted.
const migration = readFileSync(new URL('../prisma/migrations/20260827110000_add_f8_deposit_terms_and_lines/migration.sql', import.meta.url), 'utf8')
const functions = migration.match(/CREATE FUNCTION[\s\S]*?\$\$ LANGUAGE plpgsql;/g)!
const triggers = migration.match(/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?;/g)!
for (const statement of migration.match(/CREATE (?:UNIQUE )?INDEX[\s\S]*?;/g)!) {
  if (!statement.includes('"Service_businessId_id_key"')) await db.exec(statement)
}
for (const statement of migration.match(/ALTER TABLE[\s\S]*?;/g)!) {
  if (statement.includes('ADD CONSTRAINT')) await db.exec(statement)
}
for (const statement of [...functions,...triggers]) await db.exec(statement)
// Lifecycle constraints are the original migrations, not a permissive mock.
for (const name of ['20260827130000_add_f8_append_only_deposit_proofs','20260827140000_add_f8_proof_writer_guards','20260827150000_add_f8_review_operations','20260827160000_add_f8_8_rejection_operations','20260827161000_fix_f8_resubmission_deadline_guard','20260827170000_add_f8_proof_byte_retention_purge']) {
  const sql=readFileSync(new URL('../prisma/migrations/'+name+'/migration.sql',import.meta.url),'utf8')
  // Enum types already come from the actual current schema. All other DDL runs verbatim.
  await db.exec(sql.replace(/CREATE TYPE[\s\S]*?;/g,'').replace(/ALTER TYPE[\s\S]*?;/g,''))
}
await db.exec('CREATE UNIQUE INDEX job_kind_aggregate ON "BotJob" (kind,"aggregateId"); CREATE UNIQUE INDEX outbox_idempotency ON "BotOutbox" ("idempotencyKey")')
await db.exec(readFileSync(new URL('../prisma/migrations/20261009210000_add_pending_deposit_staff_cancellation/migration.sql',import.meta.url),'utf8'))
const cashMigration=readFileSync(new URL('../prisma/migrations/20260906120000_add_cash_financial_ledger/migration.sql',import.meta.url),'utf8')
await db.exec('BEGIN;'+cashMigration.slice(cashMigration.indexOf('ALTER TABLE "Appointment" ALTER COLUMN')))
await db.exec(readFileSync(new URL('../prisma/migrations/20260919170000_add_appointment_total_adjustments/migration.sql',import.meta.url),'utf8'))
await db.exec(`
INSERT INTO "Business" (id,name,"botEnabled",timezone) VALUES ('b','Salon',true,'America/Argentina/Buenos_Aires'),('foreign','Other',true,'America/Argentina/Buenos_Aires');
INSERT INTO "BusinessWhatsAppConfig" (id,"businessId","phoneNumberId","accessToken","connectionStatus") VALUES ('offline-route','b','offline-number','offline-token','CONNECTED');
INSERT INTO "Conversation" (id,"businessId",phone) VALUES ('c','b','5491112345678');
INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('customer','b','5491112345678','5491112345678','Ana');
INSERT INTO "BotChannelDeployment" (id,"businessId",channel,"engineKey",generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','b','WHATSAPP','deterministic-options',2,3,'cfg',1);
INSERT INTO "BusinessBotConfiguration" (id,"businessId",status) VALUES ('cfg','b','ACTIVE');
INSERT INTO "BotSession" (id,"businessId","conversationId","deploymentId","deploymentGeneration",status,revision,"handoffFenceEpoch") VALUES ('session','b','c','dep',2,'ACTIVE',4,5);
INSERT INTO "BusinessBotOptionsSettings" ("businessId",timezone,"bookingHorizonDays","bookingLeadTimeHours","depositHoldMinutes") VALUES ('b','America/Argentina/Buenos_Aires',20000,0,60);
INSERT INTO "BusinessPaymentSettings" ("businessId","transferEnabled",alias,"paymentLinkEnabled") VALUES ('b',true,'offline.alias',false);
INSERT INTO "ServiceCategory" (id,"businessId","isActive") VALUES ('category','b',true);
INSERT INTO "Service" (id,"businessId","catalogCategoryId",name,duration,"customerDurationMin","customerDurationMax",price,"priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode","depositValue") VALUES
('s1','b','category','Color',45,120,120,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'FIXED',100),
('s2','b','category','Cut',30,30,30,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE',null);
INSERT INTO "User" (id,"businessId",role) VALUES ('cancel-operator','b','STAFF');
INSERT INTO "Professional" (id,"businessId",name,"isActive","acceptsBotBookings","botBookingPriority") VALUES ('p1','b','Elisa',true,true,0),('p2','b','Leo',true,true,0);
INSERT INTO "ProfessionalService" (id,"professionalId","serviceId") VALUES ('ps1','p1','s1'),('ps2','p2','s2');
INSERT INTO "BusinessHours" (id,"businessId","dayOfWeek","startTime","endTime") VALUES ('bh','b',1,'09:00','20:00');
INSERT INTO "ProfessionalHours" (id,"professionalId","dayOfWeek","startTime","endTime") VALUES ('ph1','p1',1,'09:00','20:00'),('ph2','p2',1,'09:00','20:00');
`)
type QuerySource = Pick<PGlite,'query'>
let failLast = false
let failSql:((q:Prisma.Sql)=>boolean)|null=null
let testClock:Date|null=null
function orm(pg: QuerySource): Prisma.TransactionClient {
  let affectedRows=0
  const query = async (q: Prisma.Sql) => {
    // PGlite has no concurrent sessions; locks are executed where supported,
    // advisory lock is the sole no-op. This test does NOT prove cross-process contention.
    if (q.text.includes('pg_advisory_xact_lock')) return [{locked:1}]
    if (failLast && q.text.includes('INSERT INTO "Appointment"') && q.values.includes('p2')) throw Error('controlled last-member failure')
    if(failSql?.(q)) throw Error('controlled lifecycle last-member failure')
    const sql=testClock?q.text.replace(/clock_timestamp\(\)/g,"'"+testClock.toISOString()+"'::timestamptz"):q.text
    const result = await pg.query(sql,q.values.map(v=>v instanceof Date?v.toISOString():Buffer.isBuffer(v)?v:v!==null&&typeof v==='object'?JSON.stringify(v):v))
    affectedRows=result.affectedRows??result.rows.length
    for (const row of result.rows as Record<string,unknown>[]) for (const key of ['startAt','endAt','dbNow','scheduledStartAt','expiresAt','holdExpiresAt']) if(row[key]!=null && !(row[key] instanceof Date))row[key]=new Date(String(row[key]))
    return result.rows
  }
  const select = async (table:string,where:Record<string,unknown>) => {
    const values:unknown[]=[]
    const clauses=Object.entries(where).map(([key,v])=>{
      if(v&&typeof v==='object'&&'in' in v)return '"'+key+'" IN ('+(v as {in:unknown[]}).in.map(x=>{values.push(x);return '$'+values.length}).join(',')+')'
      values.push(v);return '"'+key+'"=$'+values.length
    })
    return query({text:'SELECT * FROM "'+table+'" WHERE '+clauses.join(' AND '),values} as Prisma.Sql)
  }
  const delegates:Record<string,unknown>={}
  for(const [name,table] of Object.entries({professional:'Professional',service:'Service',professionalService:'ProfessionalService',businessHours:'BusinessHours',professionalHours:'ProfessionalHours'})) delegates[name]={
    findMany:async({where}:{where:Record<string,unknown>})=>select(table,where),findFirst:async({where}:{where:Record<string,unknown>})=>(await select(table,where))[0]??null,count:async({where}:{where:Record<string,unknown>})=>(await select(table,where)).length
  }
  return {...delegates,scheduleBlock:{findFirst:async()=>null},$queryRaw:query,$executeRaw:async(q:Prisma.Sql)=>{await query(q);return affectedRows}} as unknown as Prisma.TransactionClient
}
const counts = async()=>(await db.query<{appointments:number;visits:number;deposits:number;operations:number}>(`SELECT (SELECT count(*)::int FROM "Appointment") appointments,(SELECT count(*)::int FROM "BookingVisit") visits,(SELECT count(*)::int FROM "BookingDeposit") deposits,(SELECT count(*)::int FROM "BotOperation") operations`)).rows[0]!
try {
  // Behavior RED on current source, not an absent import/export: a held NONE
  // companion must occupy the professional even though LEFT JOIN deposit is NULL.
  await db.transaction(async tx=>{
    await tx.exec(`INSERT INTO "BookingVisit" (id,"businessId","customerId","professionalId","sessionId",status,"scheduledStartAt","totalDurationMinutes","holdExpiresAt") VALUES ('none-v','b','customer','p2','session','HELD','2030-09-02T15:00:00Z',30,clock_timestamp()+interval '1 hour'); INSERT INTO "Appointment" (id,"businessId","customerId","professionalId","serviceId","visitId",status,"startAt","totalDurationMinutes") VALUES ('none-a','b','customer','p2','s2','none-v','PENDING','2030-09-02T15:00:00Z',30)`)
    assert.equal(await hasAppointmentOverlap(orm(tx),{professionalId:'p2',startAt:new Date('2030-09-02T15:00:00Z'),endAt:new Date('2030-09-02T15:30:00Z')}),true,'NONE HELD companion must block agenda, not disappear through SQL NULL')
    await tx.exec(`UPDATE "BookingVisit" SET "holdExpiresAt"=clock_timestamp()-interval '1 minute' WHERE id='none-v'`)
    assert.equal(await hasAppointmentOverlap(orm(tx),{professionalId:'p2',startAt:new Date('2030-09-02T15:00:00Z'),endAt:new Date('2030-09-02T15:30:00Z')}),false,'expired timed companion must release occupation')
    throw Error('rollback companion fixture')
  }).catch(e=>{assert.match(String(e),/rollback companion fixture/)})
  console.log('companion overlap PASS')
  const group = await import('../src/services/coordinated-deposit-group.js')
  const hold = booking.holdCoordinatedBookingWithDeposit
  const scope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,revision:'4',configurationId:'cfg',dispatchFenceEpoch:3,handoffFenceEpoch:5}
  const segments=[
    {serviceId:'s1',serviceName:'Color',professionalId:'p1',professionalName:'Elisa',startAt:'2030-09-02T13:00:00.000Z',endAt:'2030-09-02T15:00:00.000Z',durationMinutes:45,customerDurationMinutes:120,priceMinor:1000,priceMode:'FIXED' as const,configurationHash:''},
    {serviceId:'s2',serviceName:'Cut',professionalId:'p2',professionalName:'Leo',startAt:'2030-09-02T15:00:00.000Z',endAt:'2030-09-02T15:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:2000,priceMode:'FIXED' as const,configurationHash:''}
  ]
  async function input() {
    const services=(await db.query<Record<string,unknown>>('SELECT * FROM "Service" ORDER BY id')).rows
    const current=segments.map((s,i)=>{
      const service=services[i]!
      const estimate=service.attentionMode==='GUIDED_ESTIMATE'?resolveServiceEstimate({...service,price:service.price as number,priceMode:service.priceMode as 'FIXED',estimateOptions:parseEstimateOptions(service.estimateOptions)},'length'):null
      return {...s,priceMinor:estimate?.priceMin??service.price as number,priceMode:estimate?'STARTING_AT' as const:service.priceMode as 'FIXED',...(estimate?{estimate}:{}),configurationHash:group.coordinatedServiceConfigurationHash(service)}
    })
    const financial=calculateBookingDepositTerms({services:services.map(s=>({id:String(s.id),name:String(s.name),price:current.find(segment=>segment.serviceId===s.id)!.priceMinor,priceMode:current.find(segment=>segment.serviceId===s.id)!.priceMode,depositMode:s.depositMode as 'FIXED'|'NONE'|'PERCENTAGE',depositValue:s.depositValue as number|null})),businessDepositHoldMinutes:60})
    const terms={version:1 as const,businessId:'b',timezone:'America/Argentina/Buenos_Aires',date:'2030-09-02',customerName:'Ana',preference:{kind:'any' as const},segments:current,totalPriceMinor:current.every(s=>s.priceMode==='FIXED')?current.reduce((sum,s)=>sum+s.priceMinor,0):null,deposit:{financial,payment:{transferEnabled:true,alias:'offline.alias',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}}
    const proposal={version:1 as const,scope,nonce:'9a3db2a0-c131-4262-883a-a7e9aec6fba8',fingerprint:canonicalJsonHash(terms),conditionsPresented:true as const,terms}
    const draft={businessId:'b',pending:'proposal',customerName:'Ana',date:terms.date,professional:terms.preference,basket:{members:current.map((s,i)=>({memberId:'m'+i,mode:'single',serviceIds:[s.serviceId]}))},slot:{startAt:current[0]!.startAt,coordination:{segments:current.map(({priceMinor,priceMode,configurationHash,...s})=>s)}},bookingReservation:{presented:proposal}}
    await db.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:draft}}),'session'])
    return {origin:{kind:'RUNTIME' as const,...scope,revision:4n,canonicalPhone:'5491112345678',operationKey:'offline-op',newBookingAllowed:true},proposal,currentDraft:draft,consent:{confirmed:true,nonce:proposal.nonce,fingerprint:proposal.fingerprint}}
  }
  const value=await input()
  const execute=(v=value)=>db.transaction(tx=>hold(orm(tx),v))
  const cleanup=()=>db.transaction(async tx=>{await tx.exec(`DELETE FROM "BotJob"; DELETE FROM "BotOperation"; DELETE FROM "BookingDepositLine"; DELETE FROM "BookingDeposit"; DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "BookingVisit";`)})
  for(const mutation of ['consent','nonce','fingerprint','revision','tenant','phone'] as const){
    const bad=structuredClone(value)
    if(mutation==='consent')bad.consent.confirmed=false
    if(mutation==='nonce')bad.consent.nonce='00000000-0000-4000-8000-000000000000'
    if(mutation==='fingerprint')bad.proposal.terms.totalPriceMinor=1
    if(mutation==='revision')bad.origin.revision=3n
    if(mutation==='tenant')bad.origin.businessId='foreign'
    if(mutation==='phone')bad.origin.canonicalPhone='5491199999999'
    await assert.rejects(execute(bad));assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  }
  for(const sql of [
    `UPDATE "Service" SET price=1001 WHERE id='s1'`,
    `UPDATE "Service" SET "isActive"=false WHERE id='s2'`,
    `UPDATE "Service" SET "requiresPhoto"=true WHERE id='s2'`,
    `UPDATE "Professional" SET "isActive"=false WHERE id='p2'`,
    `UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes"=61 WHERE "businessId"='b'`,
    `UPDATE "BusinessPaymentSettings" SET alias='changed.alias' WHERE "businessId"='b'`,
    `UPDATE "Service" SET "depositMode"='NONE',"depositValue"=null WHERE id='s1'`
  ]) {
    await assert.rejects(db.transaction(async tx=>{await tx.exec(sql);await hold(orm(tx),value)}))
    assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  }
  await assert.rejects(db.transaction(tx=>booking.holdBookingWithDeposit(orm(tx),{businessId:'b',sessionId:'session',operationKey:'individual-none',newBookingAllowed:true,
    services:[{serviceId:'s2',name:'Cut',durationMinutes:30,priceMinor:2000,priceMode:'FIXED'}],professional:{professionalId:'p2',name:'Leo',assignedByBalancer:false},
    date:'2030-09-02',slotStartAt:'2030-09-02T15:00:00.000Z',totalDurationMinutes:30,totalPriceMinor:2000})),/no-deposit service/)
  failLast=true;await assert.rejects(execute(),/last-member/);failLast=false
  assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  const receipt=await execute()
  assert.equal(receipt.amount,100);assert.equal(receipt.members.length,2);assert.equal(receipt.members.filter(m=>m.depositId!==null).length,1)
  const rows=(await db.query<{status:string;visitStatus:string;expiry:string}>(`SELECT a.status,v.status AS "visitStatus",v."holdExpiresAt" AS expiry FROM "Appointment" a JOIN "BookingVisit" v ON v.id=a."visitId" ORDER BY a."serviceId"`)).rows
  assert.ok(rows.every(r=>r.status==='PENDING'&&r.visitStatus==='HELD'));assert.equal(new Set(rows.map(r=>new Date(r.expiry).toISOString())).size,1)
  assert.equal(receipt.anchorDepositId,receipt.members[0]!.depositId)
  assert.deepEqual(await execute(),receipt,'replay must preserve exact sealed membership and deadline')
  assert.deepEqual(await counts(),{appointments:2,visits:2,deposits:1,operations:3})
  assert.equal(await hasAppointmentOverlap(orm(db),{professionalId:'p2',startAt:new Date('2030-09-02T15:00:00Z'),endAt:new Date('2030-09-02T15:30:00Z')}),true)
  const verified=await db.transaction(tx=>group.lockCoordinatedDepositGroup(orm(tx),{businessId:'b',groupId:receipt.groupId}))
  assert.deepEqual(verified,receipt)
  await assert.rejects(db.transaction(async tx=>{await tx.exec(`UPDATE "Appointment" SET "businessId"='foreign' WHERE "serviceId"='s2'`);await group.lockCoordinatedDepositGroup(orm(tx),{businessId:'b',groupId:receipt.groupId})}),/membership|group/i)
  await assert.rejects(db.transaction(async tx=>{await tx.exec(`UPDATE "Appointment" SET "coordinationGroupId"='corrupt' WHERE "serviceId"='s2'`);await group.lockCoordinatedDepositGroup(orm(tx),{businessId:'b',groupId:receipt.groupId})}),/membership|group/i)
  const deposit=receipt.members.find(m=>m.depositId)!.depositId!
  await assert.rejects(db.query(`UPDATE "BookingDepositLine" SET amount=999 WHERE "depositId"=$1`,[deposit]),/immutable/i)
  await assert.rejects(db.transaction(async tx=>{await tx.query(`UPDATE "BookingDeposit" SET "snapshotSealedAt"=null WHERE id=$1`,[deposit])}),/immutable/i)
  // The original trigger forbids assigning a foreign member's service line to the anchor.
  await assert.rejects(db.transaction(async tx=>{await tx.query(`INSERT INTO "BookingDepositLine" (id,"businessId","depositId","serviceId","sortOrder","serviceName",mode,"configuredValue",amount) VALUES ('wrong','b',$1,'s2',1,'Cut','FIXED',100,100)`,[deposit])}),/sealed|selected on/i)
  // Cleanup is rollback-based; a second financial configuration never alters sealed rows.
  await cleanup()
  await db.exec(`UPDATE "Service" SET "depositMode"='PERCENTAGE',"depositValue"=10 WHERE id='s2'`)
  const percentage=await input()
  const second=await execute(percentage)
  assert.equal(second.amount,300);assert.equal(second.members.filter(m=>m.depositId!==null).length,2)
  const deadlines=(await db.query<{expiresAt:string}>(`SELECT "expiresAt" FROM "BookingDeposit" ORDER BY id`)).rows
  assert.equal(new Set(deadlines.map(r=>new Date(r.expiresAt).toISOString())).size,1,'all obligations share one deadline')
  assert.deepEqual(await execute(percentage),second)
  assert.deepEqual(await counts(),{appointments:2,visits:2,deposits:2,operations:3})
  await cleanup()
  await db.exec(`UPDATE "Service" SET "depositMode"='NONE',"depositValue"=null WHERE id='s1'`)
  const noneFirst=await execute(await input())
  assert.equal(noneFirst.members[0]!.depositId,null)
  assert.equal(noneFirst.anchorDepositId,noneFirst.members[1]!.depositId,'anchor may be the second segment')
  assert.equal(noneFirst.amount,200)
  await cleanup()
  await db.exec(`UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100 WHERE id='s1'; UPDATE "Service" SET "attentionMode"='GUIDED_ESTIMATE',"estimateAllowsBooking"=true,"estimateOptions"='[{"id":"length","label":"Medium","priceMin":1500,"priceMax":3000}]' WHERE id='s2'`)
  // Isolated lifecycle scenarios roll back the entire aggregate, including append-only ledger rows.
  await db.exec(`UPDATE "Service" SET "attentionMode"='DIRECT_BOOKING',"estimateAllowsBooking"=false,"estimateOptions"=null WHERE id='s2'`)
  const fixtureBytes=Buffer.from('offline proof fixture')
  const fixtureEvidence={sourceData:fixtureBytes,sourceMimeType:'image/png' as const,sourceFilename:'offline.png',sourceByteSize:fixtureBytes.length,sourceSha256:createHash('sha256').update(fixtureBytes).digest('hex'),derivedData:fixtureBytes,derivedMimeType:'image/webp' as const,derivedByteSize:fixtureBytes.length,derivedSha256:createHash('sha256').update(fixtureBytes).digest('hex'),validatorVersion:'f8-image-v1' as const}
  const reviewer={businessId:'b',actorUserId:'offline-reviewer',method:'POST',path:'/offline'}
  let scenario=0
  async function isolated(run:(tx:Prisma.TransactionClient,r:typeof receipt)=>Promise<void>) {
    console.log('lifecycle scenario '+(++scenario))
    const v=await input()
    await assert.rejects(db.transaction(async raw=>{
      const tx=orm(raw),r=await hold(tx,v)
      await run(tx,r)
      throw Error('rollback lifecycle fixture')
    }),/rollback lifecycle fixture/)
    testClock=null;failSql=null
    assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  }

  // P17 executes the same recovery helper against actual production SQL, not mocked terminal labels.
  async function recoveryChecks(tx: Prisma.TransactionClient, reservation: import('../src/conversational-bot/prisma-conversational-booking.js').RuntimeBookingReservation) {
    const draft = { ...initialDialogueState('b'), bookingReservation: reservation }
    const recoveryScope = { ...scope, canonicalPhone: '5491112345678' }
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET status='ACCEPTED' WHERE "businessId"='b' AND "sessionId"='session'`)
    const snapshot = async () => {
      const result: Record<string, unknown> = {}
      for (const table of ['Appointment','BookingVisit','BookingDeposit','BookingDepositExpiryAudit','BotOperation']) {
        result[table] = await tx.$queryRaw(Prisma.sql`SELECT * FROM ${Prisma.raw('"'+table+'"')} ORDER BY id`)
      }
      return result
    }
    const before = await snapshot()
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), true, 'durable singular/group expiry authorizes conversation only')
    assert.deepEqual(await snapshot(), before, 'recovery itself must be financially read-only')
    for (const patch of [{ businessId: 'foreign' }, { sessionId: 'foreign' }, { canonicalPhone: '5491199999999' },
      { revision: '5' }, { generation: 3 }, { configurationId: 'foreign' }, { dispatchFenceEpoch: 4 }, { handoffFenceEpoch: 6 }]) {
      assert.equal(await canResumeExpiredConversationTx(tx, { ...recoveryScope, ...patch }, draft), false, 'foreign or stale recovery scope')
    }
    const malformed = structuredClone(draft)
    malformed.bookingReservation.receipt!.fingerprint = 'invalid'
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, malformed), false)
    for (const status of ['PENDING','CLAIMED','RETRY','SENDING','UNKNOWN']) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ('recovery-pending','b','session',${status}::"BotOutboxStatus")`)
      assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), false, status + ' delivery blocks recovery')
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE id='recovery-pending'`)
    }
    for (const status of ['STARTED','FAILED','UNKNOWN',null]) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"businessId","sessionId",status) VALUES ('recovery-operation','b','session',${status})`)
      assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), false, 'uncertain historical operation blocks recovery')
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE id='recovery-operation'`)
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ('foreign-delivery','foreign','session','UNKNOWN'),('other-session','b','other','UNKNOWN')`)
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), true, 'unrelated pending effects do not block this scope')
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE id IN ('foreign-delivery','other-session')`)
    const key = reservation.receipt!.kind === 'HELD' ? reservation.receipt!.operationKey : ''
    const hash = (await tx.$queryRaw<Array<{ requestHash: string }>>(Prisma.sql`SELECT "requestHash" FROM "BotOperation" WHERE "operationKey"=${key}`))[0]!.requestHash
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"='broken' WHERE "operationKey"=${key}`)
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), false, 'corrupted durable parent lineage is never recovery authority')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"=${hash} WHERE "operationKey"=${key}`)

    const child = (await tx.$queryRaw<Array<{ operationKey: string; requestHash: string }>>(Prisma.sql`SELECT "operationKey","requestHash" FROM "BotOperation"
      WHERE "businessId"='b' AND "sessionId"='session' AND "operationKey"<>${key} AND type IN ('HOLD_VISIT_WITH_DEPOSIT','HOLD_GROUP_COMPANION') LIMIT 1`))[0]!
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"='broken-child' WHERE "operationKey"=${child.operationKey}`)
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), false, 'corrupted durable child lineage is never recovery authority')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"=${child.requestHash} WHERE "operationKey"=${child.operationKey}`)
    assert.equal(await canResumeExpiredConversationTx(tx, recoveryScope, draft), true)
    assert.deepEqual(await snapshot(), before)
    console.log('P17 real SQL expired recovery: singular/group lineage, scope, pending/unknown, historical data unchanged PASS')
  }

  const receive=(tx:Prisma.TransactionClient,r:typeof receipt,event='fixture-proof',evidence=fixtureEvidence)=>writeValidatedDepositProofInTransaction(tx,{businessId:'b',depositId:r.anchorDepositId,operationKey:event,providerEventId:event,evidence})
  const stateCount=async(tx:Prisma.TransactionClient,table:string,status:string)=>(await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM ${Prisma.raw('"'+table+'"')} WHERE status::text=${status}`))[0]!.n
  // A worker can claim expiry before the proof commits. Its later execution
  // must still respect review state, even past the original immutable deadline.
  async function claimExpiry(tx:Prisma.TransactionClient,depositId:string,expiresAt:string) {
    const jobRow=(await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "BotJob" WHERE kind='EXPIRE_DEPOSIT' AND "aggregateId"=${depositId}`))[0]!
    const claimedUntil=new Date(Date.parse(expiresAt)+120000)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotJob" SET status='LEASED',"leaseToken"='offline-review-claim',"leasedUntil"=${claimedUntil} WHERE id=${jobRow.id}`)
    return {id:jobRow.id,kind:'EXPIRE_DEPOSIT' as const,aggregateId:depositId,businessId:'b',deploymentId:'dep',deploymentGeneration:2,claimToken:'offline-review-claim',queueWaitMs:0,attempts:1,maxAttempts:5,expectedRevision:null,availableAt:new Date(expiresAt),claimedUntil}
  }
  const expiryClient=(tx:Prisma.TransactionClient)=>({$transaction:async<T>(fn:(transaction:Prisma.TransactionClient)=>Promise<T>)=>fn(tx)})
  async function retainGroupPastDeadline(tx:Prisma.TransactionClient,r:typeof receipt) {
    const jobs=await Promise.all(r.members.filter(m=>m.depositId).map(m=>claimExpiry(tx,m.depositId!,r.expiresAt)))
    await receive(tx,r)
    testClock=new Date(Date.parse(r.expiresAt)+60000)
    for(const job of jobs) assert.equal(await expireDepositHold(expiryClient(tx) as never,job),'INELIGIBLE','proof received before TTL must defeat an already claimed expiry')
    assert.equal(await stateCount(tx,'BookingVisit','PENDING_PAYMENT_REVIEW'),2)
    assert.equal(await stateCount(tx,'Appointment','PENDING'),2,'review is not premature confirmation')
    assert.equal(await stateCount(tx,'BookingDeposit','PROOF_RECEIVED'),r.members.filter(m=>m.depositId).length)
    assert.equal(await stateCount(tx,'BookingVisit','EXPIRED'),0)
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositExpiryAudit"`))[0]!.n,0)
    const current=await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})
    assert.equal(current.currentExpiresAt.toISOString(),r.expiresAt,'receipt does not rewrite the deadline to preserve review')
    for(const segment of segments) assert.equal(await hasAppointmentOverlap(tx,{professionalId:segment.professionalId,startAt:new Date(segment.startAt),endAt:new Date(segment.endAt)}),true,'every service remains occupied during human review')
    await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'approve-after-original-deadline'})
    assert.equal(await stateCount(tx,'BookingVisit','CONFIRMED'),2)
    assert.equal(await stateCount(tx,'Appointment','CONFIRMED'),2)
  }
  async function cancellationRecovery(tx:Prisma.TransactionClient,reservation:import('../src/conversational-bot/prisma-conversational-booking.js').RuntimeBookingReservation,kind:'CUSTOMER'|'STAFF'='STAFF') {
    const held=reservation.receipt as RuntimeHeldReceipt
    const actor:import('../src/services/pending-deposit-cancellation.js').PendingDepositCancellationActor=kind==='STAFF'
      ? {kind:'STAFF',user:{id:'cancel-operator',role:'STAFF',businessId:'b',canCreateBusinesses:false,agendaScope:'ALL',professionalId:null,canCancelAppointments:true}}
      : {kind:'CUSTOMER',sessionId:'session',canonicalPhone:'5491112345678',expectedRevision:BigInt(scope.revision),
          expectedReceipt:{groupId:held.coordinationGroupId,operationKey:held.operationKey,proposalNonce:held.proposalNonce,fingerprint:held.fingerprint}}
    if(kind==='CUSTOMER') {
      await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotConfiguration" SET definition=${JSON.stringify({conversation:{engine:'conversational-booking-v1',schemaVersion:1}})}::jsonb WHERE id='cfg'`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET state=${JSON.stringify({booking:'HELD',deposit:'PENDING_PROOF',handoff:'NONE',conversationDraft:{dialogue:{...initialDialogueState('b'),bookingReservation:reservation}}})}::jsonb WHERE id='session'`)
    }
    const snapshot=await loadPendingDepositCancellationTx(tx,{businessId:'b',appointmentId:reservation.receipt!.appointments[0]!.appointmentId,actor})
    await cancelPendingDepositInTransaction(tx,{snapshot,actor,confirmed:true,operationKey:'terminal-staff-cancel'})
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET status='ACCEPTED' WHERE "businessId"='b' AND "sessionId"='session'`)
    const draft={...initialDialogueState('b'),bookingReservation:reservation}
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},draft),true,'durable cancellation releases conversation, never the historical reservation')
    const actual=await loadRuntimeDepositReceipt(tx,{businessId:'b',sessionId:'session',canonicalPhone:'5491112345678',expectedRevision:BigInt(scope.revision)},reservation)
    assert.equal(actual?.cancellationReason,kind,'cancelled is not payment rejected')
    const terminalDraft={...draft,bookingReservation:{...reservation,receipt:{...held,depositStatus:'REJECTED' as const,cancellationReason:kind}}}
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},terminalDraft),true,'persisted terminal cancellation still requires durable authority')
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,revision:'5',canonicalPhone:'5491112345678'},terminalDraft),false,'terminal receipt never bypasses current revision')
    const cancelHash=(await tx.$queryRaw<Array<{requestHash:string}>>(Prisma.sql`SELECT "requestHash" FROM "BotOperation" WHERE "operationKey"='terminal-staff-cancel'`))[0]!.requestHash
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"='broken' WHERE "operationKey"='terminal-staff-cancel'`)
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},terminalDraft),false,'a terminal hint cannot repair broken cancellation authority')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"=${cancelHash} WHERE "operationKey"='terminal-staff-cancel'`)
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},terminalDraft),true,'restored exact durable authority remains readable')
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ('cancel-pending-output','b','session','UNKNOWN')`)
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},draft),false,'uncertain delivery still protects terminal recovery')
  }
  for(const kind of ['STAFF','CUSTOMER'] as const) await isolated(async(tx,r)=>{
    const receipt:RuntimeHeldReceipt={kind:'HELD',operationKey:r.operationKey,coordinationGroupId:r.groupId,proposalNonce:r.proposal.nonce,fingerprint:r.proposal.fingerprint,
      depositId:r.anchorDepositId,amount:r.amount,expiresAt:r.expiresAt,depositStatus:'PENDING_PROOF',
      appointments:r.members.map(({segmentIndex,appointmentId,visitId})=>({segmentIndex,appointmentId,visitId})),
      coordinatedDepositGroup:{version:1,groupId:r.groupId,requestHash:r.requestHash}}
    await cancellationRecovery(tx,{presented:r.proposal,receipt},kind)
  })
  await isolated(retainGroupPastDeadline)
  // Runtime singular holds also have a BOT coordination UUID, but their sealed
  // parent/child operations are HOLD_VISIT_WITH_DEPOSIT, never a multi manifest.
  const singularBase=await input()
  const singularTerms={...singularBase.proposal.terms,segments:[singularBase.proposal.terms.segments[0]!],totalPriceMinor:1000,
    deposit:{...singularBase.proposal.terms.deposit,financial:calculateBookingDepositTerms({services:[{id:'s1',name:'Color',price:1000,priceMode:'FIXED',depositMode:'FIXED',depositValue:100}],businessDepositHoldMinutes:60})}}
  const singularPresented={...singularBase.proposal,terms:singularTerms,fingerprint:canonicalJsonHash(singularTerms)}
  const singularOrigin={...singularBase.origin,operationKey:'singular-runtime'}
  const singularKey='conversation-booking:'+singularOrigin.operationKey+':'+singularPresented.nonce
  const singularGroup='ffb01eab-a968-411a-80f9-32c9825e1377'
  async function singularRuntimeFixture(tx:Prisma.TransactionClient) {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","resultRef","updatedAt")
      VALUES ('single-parent',${singularKey},'HOLD_VISIT_WITH_DEPOSIT','b','session','STARTED',${runtimeBookingRequestHash(singularOrigin,singularPresented)},${singularGroup},clock_timestamp())`)
    const r=await booking.holdBookingWithDeposit(tx,runtimeBookingChildInput(singularPresented,singularKey,0,true))
    assert.equal(r.kind,'HELD')
    if(r.kind!=='HELD') throw Error('singular fixture must hold')
    await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=${singularGroup} WHERE id=${r.appointmentId}`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED' WHERE "operationKey"=${singularKey}`)
    const receipt:RuntimeHeldReceipt={kind:'HELD',operationKey:singularKey,coordinationGroupId:singularGroup,proposalNonce:singularPresented.nonce,fingerprint:singularPresented.fingerprint,
      appointments:[{segmentIndex:0,appointmentId:r.appointmentId,visitId:r.visitId}],depositId:r.depositId,amount:r.amount,expiresAt:r.expiresAt.toISOString(),depositStatus:'PENDING_PROOF'}
    const draft={...singularBase.currentDraft,basket:{members:[singularBase.currentDraft.basket.members[0]!]},bookingReservation:{presented:singularPresented,receipt},slot:{startAt:singularTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa'}}
    await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET state=${JSON.stringify({booking:'HELD',deposit:'PENDING_PROOF',handoff:'NONE',conversationDraft:{dialogue:draft}})}::jsonb WHERE id='session'`)
    return r
  }

  for(const kind of ['STAFF','CUSTOMER'] as const) await assert.rejects(db.transaction(async raw=>{
    const tx=orm(raw),held=await singularRuntimeFixture(tx)
    const receipt:RuntimeHeldReceipt={kind:'HELD',operationKey:singularKey,coordinationGroupId:singularGroup,proposalNonce:singularPresented.nonce,fingerprint:singularPresented.fingerprint,
      appointments:[{segmentIndex:0,appointmentId:held.appointmentId,visitId:held.visitId}],depositId:held.depositId,amount:held.amount,expiresAt:held.expiresAt.toISOString(),depositStatus:'PENDING_PROOF'}
    await cancellationRecovery(tx,{presented:singularPresented,receipt},kind)
    throw Error('rollback singular cancelled recovery')
  }),/rollback singular cancelled recovery/)
  await assert.rejects(db.transaction(async raw => {
    const tx = orm(raw), held = await singularRuntimeFixture(tx)
    const receipt: RuntimeHeldReceipt = { kind: 'HELD', operationKey: singularKey, coordinationGroupId: singularGroup,
      proposalNonce: singularPresented.nonce, fingerprint: singularPresented.fingerprint, depositId: held.depositId,
      appointments: [{ segmentIndex: 0, appointmentId: held.appointmentId, visitId: held.visitId }],
      expiresAt: held.expiresAt.toISOString(), amount: held.amount, depositStatus: 'PENDING_PROOF' }
    const draft = { ...initialDialogueState('b'), bookingReservation: { presented: singularPresented, receipt } }
    assert.equal(await canResumeExpiredConversationTx(tx, { ...scope, canonicalPhone: '5491112345678' }, draft), false)
    const job = await claimExpiry(tx, held.depositId, receipt.expiresAt)
    testClock = new Date(Date.parse(receipt.expiresAt) + 60000)
    assert.equal(await expireDepositHold(expiryClient(tx) as never, job), 'EXPIRED')
    await recoveryChecks(tx, draft.bookingReservation)
    throw Error('rollback singular expired recovery')
  }), /rollback singular expired recovery/)
  testClock = null
  assert.deepEqual(await counts(), { appointments: 0, visits: 0, deposits: 0, operations: 0 })

  for(const mutation of ['parent-missing','parent-type','parent-state','parent-hash','parent-session','child-hash','child-scope','child-result','second-member'] as const) {
    await assert.rejects(db.transaction(async raw=>{
      const tx=orm(raw),r=await singularRuntimeFixture(tx)
      const childKey=singularKey+':segment:0:HOLD_VISIT_WITH_DEPOSIT'
      if(mutation==='parent-missing') await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "operationKey"=${singularKey}`)
      if(mutation==='parent-type') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET type='CONFIRM_VISIT' WHERE "operationKey"=${singularKey}`)
      if(mutation==='parent-state') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='STARTED' WHERE "operationKey"=${singularKey}`)
      if(mutation==='parent-hash') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"='not-a-sha256' WHERE "operationKey"=${singularKey}`)
      if(mutation==='parent-session') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "sessionId"='foreign-session' WHERE "operationKey"=${singularKey}`)
      if(mutation==='child-hash') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "requestHash"='not-a-sha256' WHERE "operationKey"=${childKey}`)
      if(mutation==='child-scope') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "businessId"='foreign' WHERE "operationKey"=${childKey}`)
      if(mutation==='child-result') await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "resultRef"='foreign-visit' WHERE "operationKey"=${childKey}`)
      if(mutation==='second-member') {
        const extra=await booking.holdBookingWithDeposit(tx,{businessId:'b',sessionId:'session',operationKey:'extra-runtime-member',newBookingAllowed:true,
          services:[{serviceId:'s2',name:'Cut',durationMinutes:30,priceMinor:2000,priceMode:'FIXED'}],professional:{professionalId:'p2',name:'Leo',assignedByBalancer:false},
          date:'2030-09-02',slotStartAt:'2030-09-02T15:00:00.000Z',totalDurationMinutes:30,totalPriceMinor:2000})
        assert.equal(extra.kind,'HELD')
        if(extra.kind!=='HELD') throw Error('extra financial fixture must hold')
        await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=${singularGroup} WHERE id=${extra.appointmentId}`)
      }
      await assert.rejects(writeValidatedDepositProofInTransaction(tx,{businessId:'b',depositId:r.depositId,operationKey:'deny-'+mutation,providerEventId:'deny-'+mutation,evidence:fixtureEvidence}),/membership|group/)
      assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositProof"`))[0]!.n,0,'invalid lineage must not accept evidence')
      throw Error('rollback invalid singular fixture')
    }),/rollback invalid singular fixture/)
    assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  }
  await assert.rejects(db.transaction(async raw=>{
    const tx=orm(raw),r=await singularRuntimeFixture(tx)
    const original=r.expiresAt.toISOString(),job=await claimExpiry(tx,r.depositId,original)
    // Durable lineage must survive a later conversation replacing its sidecar.
    await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET state='{}'::jsonb WHERE id='session'`)
    await writeValidatedDepositProofInTransaction(tx,{businessId:'b',depositId:r.depositId,operationKey:'singular-proof',providerEventId:'singular-proof',evidence:fixtureEvidence})
    testClock=new Date(Date.parse(original)+60000)
    assert.equal(await expireDepositHold(expiryClient(tx) as never,job),'INELIGIBLE')
    assert.equal(await stateCount(tx,'BookingVisit','PENDING_PAYMENT_REVIEW'),1)
    assert.equal(await stateCount(tx,'Appointment','PENDING'),1)
    const stored=(await tx.$queryRaw<Array<{expiresAt:Date}>>(Prisma.sql`SELECT "expiresAt" FROM "BookingDeposit" WHERE id=${r.depositId}`))[0]!
    assert.equal(stored.expiresAt.toISOString(),original)
    assert.equal(await hasAppointmentOverlap(tx,{professionalId:'p1',startAt:new Date(segments[0]!.startAt),endAt:new Date(segments[0]!.endAt)}),true)
    await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.depositId,operationKey:'singular-approve-after-ttl'})
    assert.equal(await stateCount(tx,'BookingVisit','CONFIRMED'),1)
    throw Error('rollback singular review fixture')
  }),/rollback singular review fixture/)
  testClock=null
  assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
  await isolated(async(tx,r)=>{
    const first=await receive(tx,r)
    assert.equal((await receive(tx,r)).outcome,'REPLAYED')
    assert.equal(await stateCount(tx,'BookingVisit','PENDING_PAYMENT_REVIEW'),2)
    const found=await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositProof"`)
    assert.equal(found[0]!.n,2)
    // Recovery may be attempted repeatedly, including through any internal proof copy.
    const child=(await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "BookingDepositProof" WHERE "depositId"=${r.members[1]!.depositId}`))[0]!
    await enqueueDepositNotificationTx(tx,{businessId:'b',depositId:r.members[1]!.depositId!,sourceId:child.id,kind:'PROOF_RECEIVED'})
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BotOutbox"`))[0]!.n,1)
    const bodies=await tx.$queryRaw<Array<{payload:{item:{body:string}}}>>(Prisma.sql`SELECT payload FROM "BotOutbox"`)
    assert.match(bodies[0]!.payload.item.body,/Color con Elisa.*Cut con Leo.*300/)
    assert.ok(!JSON.stringify(bodies).includes('offline.png')&&!JSON.stringify(bodies).includes(fixtureEvidence.sourceSha256))
    const approved=await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.members[1]!.depositId!,operationKey:'fixture-approve'})
    assert.equal(approved.outcome,'APPLIED')
    assert.equal(await stateCount(tx,'BookingVisit','CONFIRMED'),2)
    assert.equal((await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'fixture-approve'})).outcome,'REPLAYED')
    const cash=await tx.$queryRaw<Array<{n:number;total:number;accounts:number}>>(Prisma.sql`SELECT count(*)::int n,sum(amount)::int total,count(DISTINCT "accountId")::int accounts FROM "CashEntry"`)
    assert.deepEqual(cash[0],{n:2,total:300,accounts:1})
    const repo=createCashTransactionRepository(tx)
    for(const m of r.members) await projectApprovedDepositPaymentInTransaction(tx,{businessId:'b',bookingDepositId:m.depositId!,origin:'BOT_DEPOSIT'})
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "CashEntry"`))[0]!.n,2)
    assert.equal((await repo.loadAppointmentBackfillGroup('b',r.members[1]!.appointmentId)).length,2)
    await bridgeDirectDepositNotificationTx(tx,{businessId:'b',aggregateId:encodeDirectNotificationRecovery({depositId:r.anchorDepositId,sourceId:first.proofId,kind:'PROOF_RECEIVED'})})
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BotOutbox"`))[0]!.n,2,'superseded proof recovery must not emit stale content')
  })
  await isolated(async(tx,r)=>{
    await receive(tx,r)
    const original=r.expiresAt
    await rejectCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.members[1]!.depositId!,operationKey:'fixture-resubmit',rejection:{reason:'private reviewer text',mode:'RESUBMISSION_ALLOWED'}})
    const renewed=await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})
    assert.equal(renewed.group.expiresAt,original)
    assert.notEqual(renewed.currentExpiresAt.toISOString(),original)
    assert.equal(await stateCount(tx,'BookingVisit','HELD'),2)
    await receive(tx,r,'fixture-proof-2',{...fixtureEvidence,sourceSha256:'b'.repeat(64)})
    assert.equal(await stateCount(tx,'BookingVisit','PENDING_PAYMENT_REVIEW'),2)
    await rejectCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'fixture-resubmit-2',rejection:{reason:'private reviewer text',mode:'RESUBMISSION_ALLOWED'}})
    await receive(tx,r,'fixture-proof-3',{...fixtureEvidence,sourceSha256:'c'.repeat(64)})
    await rejectCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'fixture-final',rejection:{reason:'private reviewer text',mode:'FINAL'}})
    assert.equal(await stateCount(tx,'BookingVisit','CANCELLED'),2)
    assert.equal(await stateCount(tx,'Appointment','CANCELLED'),2)
    await assert.rejects(approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'cannot-approve-final'}))
    const rejectedReceipt:RuntimeHeldReceipt={kind:'HELD',operationKey:r.operationKey,coordinationGroupId:r.groupId,proposalNonce:r.proposal.nonce,fingerprint:r.proposal.fingerprint,
      depositId:r.anchorDepositId,amount:r.amount,expiresAt:r.expiresAt,depositStatus:'REJECTED',cancellationReason:'STAFF',
      appointments:r.members.map(({segmentIndex,appointmentId,visitId})=>({segmentIndex,appointmentId,visitId})),coordinatedDepositGroup:{version:1,groupId:r.groupId,requestHash:r.requestHash}}
    const rejectedReservation={presented:r.proposal,receipt:rejectedReceipt}
    const rejectedActual=await loadRuntimeDepositReceipt(tx,{businessId:'b',sessionId:'session',canonicalPhone:'5491112345678',expectedRevision:BigInt(scope.revision)},rejectedReservation)
    assert.equal(rejectedActual?.depositStatus,'REJECTED')
    assert.equal(rejectedActual?.cancellationReason,undefined,'forged sidecar cancellation cannot relabel a real payment rejection')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET status='ACCEPTED' WHERE "businessId"='b' AND "sessionId"='session'`)
    assert.equal(await canResumeExpiredConversationTx(tx,{...scope,canonicalPhone:'5491112345678'},{...initialDialogueState('b'),bookingReservation:rejectedReservation}),false,'plain payment rejection never authorizes terminal cancellation recovery')
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BotOutbox"`))[0]!.n,6,'three proof events and three distinct review events, never permanent group-kind dedupe')
  })
  await isolated(async(tx,r)=>{
    await receive(tx,r)
    await rejectCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'resubmission-still-expires',rejection:{reason:'send a valid proof',mode:'RESUBMISSION_ALLOWED'}})
    const renewed=await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})
    assert.equal(renewed.group.expiresAt,r.expiresAt,'original sealed deadline remains immutable')
    assert.ok(renewed.currentExpiresAt>new Date(r.expiresAt),'only explicit rejection renews the operational submission deadline')
    const job=await claimExpiry(tx,r.anchorDepositId,renewed.currentExpiresAt.toISOString())
    testClock=new Date(renewed.currentExpiresAt.getTime()+60000)
    assert.equal(await expireDepositHold(expiryClient(tx) as never,job),'EXPIRED','requesting a replacement proof must not retain indefinitely without resubmission')
    assert.equal(await stateCount(tx,'BookingVisit','EXPIRED'),2)
    assert.equal(await stateCount(tx,'Appointment','CANCELLED'),2)
  })
  await isolated(async(tx,r)=>{
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET status='CONFIRMED' WHERE id=${r.members[1]!.visitId}`)
    await assert.rejects(receive(tx,r),/membership|group/)
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositProof"`))[0]!.n,0)
  })
  for(const brokenTarget of ['null-group','manual-origin','missing-appointment'] as const) await isolated(async(tx,r)=>{
    const target=r.members.find(m=>m.depositId===r.anchorDepositId)!
    if(brokenTarget==='null-group') await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=null WHERE id=${target.appointmentId}`)
    if(brokenTarget==='manual-origin') await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET origin='MANUAL' WHERE id=${target.appointmentId}`)
    if(brokenTarget==='missing-appointment') await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE id=${target.appointmentId}`)
    await assert.rejects(receive(tx,r),/membership|group/,'durable financial member must never fall back to singular authority')
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositProof"`))[0]!.n,0)
  })
  for(const brokenTarget of ['null-group','manual-origin','missing-appointment'] as const) await isolated(async(tx,r)=>{
    await receive(tx,r)
    const target=r.members.find(m=>m.depositId===r.anchorDepositId)!
    if(brokenTarget==='null-group') await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "coordinationGroupId"=null WHERE id=${target.appointmentId}`)
    if(brokenTarget==='manual-origin') await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET origin='MANUAL' WHERE id=${target.appointmentId}`)
    if(brokenTarget==='missing-appointment') await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE id=${target.appointmentId}`)
    await assert.rejects(approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'no-downgrade'}),/membership|group/)
    await assert.rejects(createCashTransactionRepository(tx).loadAppointmentBackfillGroup('b',target.appointmentId),/membership|group/)
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDeposit" WHERE status='APPROVED'`))[0]!.n,0)
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "CashEntry"`))[0]!.n,0)
  })
  await isolated(async(tx,r)=>{
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "operationKey"=${r.operationKey}`)
    await assert.rejects(receive(tx,r),/membership|group/,'a lost coordinated manifest cannot be downgraded into singular authority')
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BookingDepositProof"`))[0]!.n,0)
  })
  await isolated(async(tx,r)=>{
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "resultRef"=replace("resultRef",'"amount":300','"amount":999') WHERE "operationKey"=${r.operationKey}`)
    await assert.rejects(receive(tx,r),/membership|group/)
  })
  await isolated(async(tx,r)=>{
    await tx.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp() WHERE "businessId"='b'`)
    const proof=await receive(tx,r)
    const jobs=await tx.$queryRaw<Array<{aggregateId:string}>>(Prisma.sql`SELECT "aggregateId" FROM "BotJob" WHERE kind='BRIDGE_DEPOSIT_NOTIFICATION'`)
    assert.equal(jobs.length,1,'one durable recovery identity for the entire proof event')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "claimsPausedAt"=null WHERE "businessId"='b'`)
    await bridgeDirectDepositNotificationTx(tx,{businessId:'b',aggregateId:jobs[0]!.aggregateId})
    await bridgeDirectDepositNotificationTx(tx,{businessId:'b',aggregateId:jobs[0]!.aggregateId})
    assert.equal((await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int n FROM "BotOutbox"`))[0]!.n,1)
    assert.equal(proof.outcome,'APPLIED')
  })
  await db.exec(`UPDATE "Service" SET "depositMode"='NONE',"depositValue"=null WHERE id='s1'`)
  await isolated(retainGroupPastDeadline)
  await isolated(async(tx,r)=>{
    assert.equal(r.members[0]!.depositId,null)
    const event={id:'event',businessId:'b',providerMessageId:null,phoneNumberId:null,payload:{kind:'message',fromPhone:'5491112345678'}}
    // This existing case checks legacy phone routing to a second-segment anchor.
    // A conversational sidecar now correctly requires canonical inbox binding;
    // that separate admission path has its own integration suite.
    await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET state='{"booking":"HELD","deposit":"PENDING_PROOF","handoff":"NONE"}'::jsonb WHERE id='session'`)
    assert.deepEqual(await resolveProofTarget(tx,event,'dep'),{kind:'FOUND',depositId:r.anchorDepositId})
    await receive(tx,r)
    testClock=new Date(Date.parse(r.expiresAt)+60000)
    assert.equal(await hasAppointmentOverlap(tx,{professionalId:'p1',startAt:new Date('2030-09-02T13:00:00Z'),endAt:new Date('2030-09-02T13:45:00Z')}),true,'NONE review must keep blocking after original hold deadline')
    await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'approve-none'})
    assert.equal(await stateCount(tx,'BookingVisit','CONFIRMED'),2)
    testClock=null
  })
  await isolated(async(tx,r)=>{
    testClock=new Date(Date.parse(r.expiresAt)+60000)
    const jobRow=(await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "BotJob" WHERE kind='EXPIRE_DEPOSIT' AND "aggregateId"=${r.anchorDepositId}`))[0]!
    await tx.$executeRaw(Prisma.sql`UPDATE "BotJob" SET status='LEASED',"leaseToken"='offline-claim',"leasedUntil"=${new Date(testClock.getTime()+60000)} WHERE id=${jobRow.id}`)
    const job={id:jobRow.id,kind:'EXPIRE_DEPOSIT',aggregateId:r.anchorDepositId,businessId:'b',deploymentId:'dep',deploymentGeneration:2,claimToken:'offline-claim',queueWaitMs:0,attempts:1,maxAttempts:5,expectedRevision:null,availableAt:new Date(r.expiresAt),claimedUntil:new Date(testClock.getTime()+60000)}
    const client={$transaction:async<T>(fn:(transaction:Prisma.TransactionClient)=>Promise<T>)=>fn(tx)}
    assert.equal(await expireDepositHold(client as never,job),'EXPIRED')
    assert.equal(await stateCount(tx,'BookingVisit','EXPIRED'),2)
    assert.equal(await stateCount(tx,'Appointment','CANCELLED'),2)

    const expiredReceipt: RuntimeHeldReceipt = { kind: 'HELD', operationKey: r.operationKey, coordinationGroupId: r.groupId,
      proposalNonce: r.proposal.nonce, fingerprint: r.proposal.fingerprint, depositId: r.anchorDepositId,
      amount: r.amount, expiresAt: r.expiresAt, depositStatus: 'PENDING_PROOF',
      appointments: r.members.map(({ segmentIndex, appointmentId, visitId }) => ({ segmentIndex, appointmentId, visitId })),
      coordinatedDepositGroup: { version: 1, groupId: r.groupId, requestHash: r.requestHash } }
    await recoveryChecks(tx, { presented: r.proposal, receipt: expiredReceipt })
    assert.equal((await receive(tx,r)).kind,'LATE')
    assert.equal(await stateCount(tx,'BookingVisit','EXPIRED'),2,'late evidence never reopens any member')
    await assert.rejects(approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'cannot-approve-expired'}))
    testClock=null
  })
  // Real parent transaction rollback on late write failures; no partial proofs, statuses, ledger or notifications survive.
  await db.exec(`UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100 WHERE id='s1'`)
  for(const phase of ['proof','approve','cash'] as const) {
    const v=await input()
    await assert.rejects(db.transaction(async raw=>{
      const tx=orm(raw),r=await hold(tx,v),last=r.members[1]!.depositId!
      if(phase==='proof')failSql=q=>q.text.includes('INSERT INTO "BookingDepositProof"')&&q.values.includes(last)
      await receive(tx,r)
      if(phase==='approve')failSql=q=>q.text.includes('INSERT INTO "BookingDepositReviewAudit"')&&q.values.includes(last)
      if(phase==='cash')failSql=q=>q.text.includes('INSERT INTO "CashEntry"')&&q.values.includes(last)
      await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'rollback-'+phase})
    }),/controlled lifecycle/)
    failSql=null
    assert.deepEqual(await counts(),{appointments:0,visits:0,deposits:0,operations:0})
    for(const table of ['BookingDepositProof','BookingDepositReviewAudit','CashEntry','BotOutbox']) assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "'+table+'"')).rows[0]!.n,0)
  }
  console.log('P14.2 fixed/NONE lifecycle, notifications, late evidence and rollback PASS')
  await db.exec(`UPDATE "Service" SET "attentionMode"='GUIDED_ESTIMATE',"estimateAllowsBooking"=true,"estimateOptions"='[{"id":"length","label":"Medium","priceMin":1500,"priceMax":3000}]' WHERE id='s2'`)
  for(const invalidCredit of ['wrong-amount','unrelated-payment'] as const) await isolated(async(tx,r)=>{
    await receive(tx,r)
    await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'unprojected-approve',projectCashPayment:false})
    const repo=createCashTransactionRepository(tx)
    const account=await ensureAppointmentAccountForPayment(repo,'b',r.members[0]!.appointmentId)
    if(invalidCredit==='wrong-amount') await tx.$executeRaw(Prisma.sql`INSERT INTO "CashEntry" (id,"businessId","accountId",type,direction,amount,"paymentMethod",origin,"bookingDepositId","effectiveAt")
      VALUES ('bad-credit','b',${account.id},'PAYMENT','INFLOW',${r.members[0]!.amount+1},'TRANSFER','BOT_DEPOSIT',${r.members[0]!.depositId},clock_timestamp())`)
    else await tx.$executeRaw(Prisma.sql`INSERT INTO "CashEntry" (id,"businessId","accountId",type,direction,amount,"paymentMethod",origin,"effectiveAt")
      VALUES ('unrelated-credit','b',${account.id},'LEGACY_PAYMENT','INFLOW',9999,'UNSPECIFIED','MIGRATION',NULL)`)
    await assert.rejects(projectApprovedDepositPaymentInTransaction(tx,{businessId:'b',bookingDepositId:r.anchorDepositId,origin:'BOT_DEPOSIT'}),/CREDIT_MISMATCH|OVERPAYMENT/)
  })
  await db.exec(`UPDATE "Service" SET "depositValue"=3000 WHERE id='s1'`)
  await isolated(async(tx,r)=>{
    assert.equal(r.amount,3150)
    await receive(tx,r)
    await approveCurrentDepositProofInTransaction(tx,{...reviewer,depositId:r.anchorDepositId,operationKey:'known-credit-unknown-final'})
    const service=new CashService({transaction:async fn=>fn(createCashTransactionRepository(tx))})
    await assert.rejects(service.setEstimatedAppointmentTotal({businessId:'b',appointmentId:r.members[0]!.appointmentId,agreedAmount:2750}),/OVERPAYMENT/,'final above the minimum but below retained credit must still reject')
    await service.setEstimatedAppointmentTotal({businessId:'b',appointmentId:r.members[0]!.appointmentId,agreedAmount:4000})
    const repo=createCashTransactionRepository(tx)
    const account=await repo.resolveAppointmentAccount('b',r.members[0]!.appointmentId)
    assert.equal(account!.agreedAmount,4000)
    assert.equal(calculateAccountTotals({agreedAmount:4000,discountAmount:0,entries:await repo.listAccountEntries('b',account!.id)}).paidAmount,3150)
  })
  await db.exec(`UPDATE "Service" SET "depositValue"=100 WHERE id='s1'`)
  const estimated=await input()
  assert.equal(estimated.proposal.terms.totalPriceMinor,null)
  const estimateReceipt=await execute(estimated)
  assert.equal(estimateReceipt.amount,250,'percentage uses current estimated minimum, never range maximum')
  assert.equal(estimateReceipt.members[1]!.amount,150)
  assert.deepEqual(await execute(estimated),estimateReceipt)
  console.log('P14.1 coordinated hold, real constraints, replay and rollback PASS')
  // First lifecycle RED is an existing public writer invoked with a real held group.
  const bytes=Buffer.from('offline proof fixture')
  const evidence={sourceData:bytes,sourceMimeType:'image/png' as const,sourceFilename:'offline.png',sourceByteSize:bytes.length,sourceSha256:createHash('sha256').update(bytes).digest('hex'),derivedData:bytes,derivedMimeType:'image/webp' as const,derivedByteSize:bytes.length,derivedSha256:createHash('sha256').update(bytes).digest('hex'),validatorVersion:'f8-image-v1' as const}
  await db.transaction(tx=>writeValidatedDepositProofInTransaction(orm(tx),{businessId:'b',depositId:estimateReceipt.anchorDepositId,operationKey:'proof-group',providerEventId:'offline-event',evidence}))
  assert.equal((await db.query<{n:number}>(`SELECT count(*)::int n FROM "BookingDeposit" WHERE status='PROOF_RECEIVED'`)).rows[0]!.n,2,'single proof must atomically reach ALL financial members')
  assert.equal((await db.query<{n:number}>(`SELECT count(*)::int n FROM "BookingDepositProof"`)).rows[0]!.n,2)
  console.log('P14.2 proof fanout PASS')
  await db.transaction(tx=>rejectCurrentDepositProofInTransaction(orm(tx),{businessId:'b',depositId:estimateReceipt.members[1]!.depositId!,actorUserId:'offline-reviewer',operationKey:'reject-group',method:'POST',path:'/offline',rejection:{reason:'offline reason',mode:'RESUBMISSION_ALLOWED'}}))
  assert.equal((await db.query<{n:number}>(`SELECT count(*)::int n FROM "BookingDeposit" WHERE status='PENDING_RESUBMISSION'`)).rows[0]!.n,2,'review of any obligation must renew ALL')
  console.log('P14.2 resubmission ALL PASS')
  const resubmitted={...evidence,sourceSha256:'a'.repeat(64)}
  await db.transaction(tx=>writeValidatedDepositProofInTransaction(orm(tx),{businessId:'b',depositId:estimateReceipt.anchorDepositId,operationKey:'proof-resubmit',providerEventId:'offline-event-2',evidence:resubmitted}))
  await db.transaction(tx=>approveCurrentDepositProofInTransaction(orm(tx),{businessId:'b',depositId:estimateReceipt.members[1]!.depositId!,actorUserId:'offline-reviewer',operationKey:'approve-estimate-group',method:'POST',path:'/offline'}))
  const credit=(await db.query<{n:number;amount:number;accounts:number}>(`SELECT count(*)::int n,sum(amount)::int amount,count(DISTINCT "accountId")::int accounts FROM "CashEntry"`)).rows[0]!
  assert.deepEqual(credit,{n:2,amount:250,accounts:1},'estimated group credits exactly its known deposit, never turns minimum into final price')
  assert.deepEqual((await db.query(`SELECT "agreedAmount","originalAmount","pricingMode" FROM "AppointmentAccount"`)).rows,[{agreedAmount:null,originalAmount:null,pricingMode:'ESTIMATED'}])
  assert.equal((await db.transaction(tx=>approveCurrentDepositProofInTransaction(orm(tx),{...reviewer,depositId:estimateReceipt.anchorDepositId,operationKey:'approve-estimate-group'}))).outcome,'REPLAYED')
  const cashRepo=createCashTransactionRepository(orm(db))
  const account=await cashRepo.resolveAppointmentAccount('b',estimateReceipt.members[0]!.appointmentId)
  assert.ok(account)
  const entries=await cashRepo.listAccountEntries('b',account.id)
  assert.throws(()=>calculateAccountTotals({agreedAmount:249,discountAmount:0,entries}),/OVERPAYMENT/)
  assert.equal(calculateAccountTotals({agreedAmount:3000,discountAmount:0,entries}).paidAmount,250)
  const cashService=new CashService({transaction:fn=>db.transaction(raw=>fn(createCashTransactionRepository(orm(raw))))})
  await assert.rejects(cashService.setAppointmentDiscount({businessId:'b',appointmentId:estimateReceipt.members[0]!.appointmentId,discountAmount:0}),/ESTIMATED_TOTAL_REQUIRED/)
  await assert.rejects(cashService.setEstimatedAppointmentTotal({businessId:'b',appointmentId:estimateReceipt.members[0]!.appointmentId,agreedAmount:249}),/MINIMUM|OVERPAYMENT/)
  await cashService.setEstimatedAppointmentTotal({businessId:'b',appointmentId:estimateReceipt.members[0]!.appointmentId,agreedAmount:3000})
  assert.equal((await cashRepo.resolveAppointmentAccount('b',estimateReceipt.members[0]!.appointmentId))!.agreedAmount,3000)
  console.log('P14.2 estimated payment ALL PASS')
} finally {await db.close()}
