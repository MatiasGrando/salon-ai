import assert from 'node:assert/strict'
import { approveCurrentDepositProofInTransaction } from '../src/services/deposit-review-operation.js'
import { createHash } from 'node:crypto'
import { writeValidatedDepositProofInTransaction } from '../src/services/deposit-proof-writer.js'
import { readFileSync, existsSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import * as booking from '../src/services/booking-operations.js'
import { calculateBookingDepositTerms } from '../src/services/deposit-operations.js'
import { parseEstimateOptions, resolveServiceEstimate } from '../src/bot-options/domain/service-booking.js'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'

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
await db.exec(`
INSERT INTO "Business" (id,name,"botEnabled",timezone) VALUES ('b','Salon',true,'America/Argentina/Buenos_Aires'),('foreign','Other',true,'America/Argentina/Buenos_Aires');
INSERT INTO "BusinessWhatsAppConfig" (id,"businessId","phoneNumberId","accessToken","connectionStatus") VALUES ('offline-route','b','offline-number','offline-token','CONNECTED');
INSERT INTO "Conversation" (id,"businessId",phone) VALUES ('c','b','5491112345678');
INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('customer','b','5491112345678','5491112345678','Ana');
INSERT INTO "BotChannelDeployment" (id,"businessId",channel,"engineKey",generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','b','WHATSAPP','deterministic-options',2,3,'cfg',1);
INSERT INTO "BusinessBotConfiguration" (id,"businessId",status,definition) VALUES ('cfg','b','ACTIVE','{"conversation":{"engine":"conversational-booking-v1","schemaVersion":1}}');
INSERT INTO "BotSession" (id,"businessId","conversationId","deploymentId","deploymentGeneration",status,revision,"handoffFenceEpoch") VALUES ('session','b','c','dep',2,'ACTIVE',4,5);
INSERT INTO "BusinessBotOptionsSettings" ("businessId",timezone,"bookingHorizonDays","bookingLeadTimeHours","depositHoldMinutes") VALUES ('b','America/Argentina/Buenos_Aires',20000,0,60);
INSERT INTO "BusinessPaymentSettings" ("businessId","transferEnabled",alias,"paymentLinkEnabled") VALUES ('b',true,'offline.alias',false);
INSERT INTO "ServiceCategory" (id,"businessId","isActive") VALUES ('category','b',true);
INSERT INTO "Service" (id,"businessId","catalogCategoryId",name,duration,"customerDurationMin","customerDurationMax",price,"priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode","depositValue") VALUES
('s1','b','category','Color',45,120,120,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'FIXED',100),
('s2','b','category','Cut',30,30,30,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE',null);
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
  const group = await import('../src/services/coordinated-deposit-group.js')
  const hold = booking.holdCoordinatedBookingWithDeposit
  const scope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,revision:'4',configurationId:'cfg',dispatchFenceEpoch:3,handoffFenceEpoch:5}
  const segments=[
    {serviceId:'s1',serviceName:'Color',professionalId:'p1',professionalName:'Elisa',startAt:'2030-09-02T13:00:00.000Z',endAt:'2030-09-02T15:00:00.000Z',durationMinutes:45,customerDurationMinutes:120,priceMinor:1000,priceMode:'FIXED' as const,configurationHash:''},
    {serviceId:'s2',serviceName:'Cut',professionalId:'p2',professionalName:'Leo',startAt:'2030-09-02T15:00:00.000Z',endAt:'2030-09-02T15:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:2000,priceMode:'FIXED' as const,configurationHash:''}
  ]
  async function input() {
    const services=(await current.query<Record<string,unknown>>('SELECT * FROM "Service" ORDER BY id')).rows
    const currentSegments=segments.map((s,i)=>{
      const service=services[i]!
      const estimate=service.attentionMode==='GUIDED_ESTIMATE'?resolveServiceEstimate({...service,price:service.price as number,priceMode:service.priceMode as 'FIXED',estimateOptions:parseEstimateOptions(service.estimateOptions)},'length'):null
      return {...s,priceMinor:estimate?.priceMin??service.price as number,priceMode:estimate?'STARTING_AT' as const:service.priceMode as 'FIXED',...(estimate?{estimate}:{}),configurationHash:group.coordinatedServiceConfigurationHash(service)}
    })
    const financial=calculateBookingDepositTerms({services:services.map(s=>({id:String(s.id),name:String(s.name),price:currentSegments.find(segment=>segment.serviceId===s.id)!.priceMinor,priceMode:currentSegments.find(segment=>segment.serviceId===s.id)!.priceMode,depositMode:s.depositMode as 'FIXED'|'NONE'|'PERCENTAGE',depositValue:s.depositValue as number|null})),businessDepositHoldMinutes:60})
    const terms={version:1 as const,businessId:'b',timezone:'America/Argentina/Buenos_Aires',date:'2030-09-02',customerName:'Ana',preference:{kind:'any' as const},segments:currentSegments,totalPriceMinor:currentSegments.every(s=>s.priceMode==='FIXED')?currentSegments.reduce((sum,s)=>sum+s.priceMinor,0):null,deposit:{financial,payment:{transferEnabled:true,alias:'offline.alias',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}}
    const proposal={version:1 as const,scope,nonce:'9a3db2a0-c131-4262-883a-a7e9aec6fba8',fingerprint:canonicalJsonHash(terms),conditionsPresented:true as const,terms}
    const draft={businessId:'b',pending:'proposal',customerName:'Ana',date:terms.date,professional:terms.preference,basket:{members:currentSegments.map((s,i)=>({memberId:'m'+i,mode:'single',serviceIds:[s.serviceId]}))},slot:{startAt:currentSegments[0]!.startAt,coordination:{segments:currentSegments.map(({priceMinor,priceMode,configurationHash,...s})=>s)}},bookingReservation:{presented:proposal}}
    await current.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:draft}}),'session'])
    return {origin:{kind:'RUNTIME' as const,...scope,revision:4n,canonicalPhone:'5491112345678',operationKey:'offline-op',newBookingAllowed:true},proposal,currentDraft:draft,consent:{confirmed:true,nonce:proposal.nonce,fingerprint:proposal.fingerprint}}
  }

// Real F9 terms remain active while the new staff cancellation branch is absent.
await db.exec(readFileSync(new URL('../prisma/migrations/20260827210000_add_f9_cancellation_transition/migration.sql',import.meta.url),'utf8'))
const staffMigration=new URL('../prisma/migrations/20261009210000_add_pending_deposit_staff_cancellation/migration.sql',import.meta.url)
if(existsSync(staffMigration))await db.exec(readFileSync(staffMigration,'utf8'))
await db.exec(`INSERT INTO "User" (id,"businessId",role) VALUES ('operator','b','STAFF')`)
const staffUser={id:'operator',role:'STAFF' as const,businessId:'b',canCreateBusinesses:false,agendaScope:'ALL' as const,
  professionalId:null,canCancelAppointments:true,canManageDeposits:false}
const staff={kind:'STAFF' as const,user:staffUser}
const moduleUrl=new URL('../src/services/pending-deposit-cancellation.ts',import.meta.url).href
const common=()=>import(moduleUrl)
let current:Pick<PGlite,'query'>=db
const financialRows=async()=>{
  const tables=['Appointment','BookingVisit','BookingDeposit','BotOperation','StaffAuditLog','BookingDepositProof','BotJob','BotSession']
  return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await current.query('SELECT * FROM "'+table+'" ORDER BY id')).rows])))
}
async function savepoint<T>(action:()=>Promise<T>):Promise<T>{
  await current.query('SAVEPOINT cancellation_test')
  try{const result=await action();await current.query('RELEASE SAVEPOINT cancellation_test');return result}
  catch(error){await current.query('ROLLBACK TO SAVEPOINT cancellation_test');await current.query('RELEASE SAVEPOINT cancellation_test');throw error}
}
let passed=0,failed=0
const rollback='ROLLBACK_PENDING_CANCELLATION_FIXTURE'
async function check(name:string,action:(tx:Prisma.TransactionClient,r:any)=>Promise<void>,singular=false){
  try{
    await db.transaction(async raw=>{
      current=raw
      const tx=orm(raw)
      let receipt:any
      if(singular){
        receipt=await booking.holdBookingWithDeposit(tx,{businessId:'b',sessionId:'session',operationKey:'singular-pending',newBookingAllowed:true,
          services:[{serviceId:'s1',name:'Color',durationMinutes:45,priceMinor:1000,priceMode:'FIXED'}],professional:{professionalId:'p1',name:'Elisa',assignedByBalancer:false},
          date:'2030-09-02',slotStartAt:'2030-09-02T13:00:00.000Z',totalDurationMinutes:45,totalPriceMinor:1000})
        assert.equal(receipt.kind,'HELD','real sealed F8 fixture')
        receipt={...receipt,groupId:null,anchorDepositId:receipt.depositId,members:[{appointmentId:receipt.appointmentId,visitId:receipt.visitId,depositId:receipt.depositId}]}
      }else{
        const v=await input()
        receipt=await booking.holdCoordinatedBookingWithDeposit(tx,v)
        const held={kind:'HELD',operationKey:receipt.operationKey,depositId:receipt.anchorDepositId,expiresAt:receipt.expiresAt,amount:receipt.amount,
          depositStatus:'PENDING_PROOF',coordinationGroupId:receipt.groupId,proposalNonce:v.proposal.nonce,fingerprint:v.proposal.fingerprint,
          appointments:receipt.members.map((m:any)=>({segmentIndex:m.segmentIndex,appointmentId:m.appointmentId,visitId:m.visitId})),
          coordinatedDepositGroup:{version:1,groupId:receipt.groupId,requestHash:receipt.requestHash}}
        await raw.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify({booking:'HELD',deposit:'PENDING_PROOF',handoff:'NONE',conversationDraft:{dialogue:{...v.currentDraft,bookingReservation:{presented:v.proposal,receipt:held}}}}),'session'])
      }
      assert.equal((await raw.query('SELECT count(*)::int AS n FROM "BookingDeposit" WHERE "snapshotSealedAt" IS NOT NULL')).rows[0]!.n,1)
      if(!name.startsWith('real F8')&&!name.startsWith('STAFF transition'))await common()
      await action(tx,receipt)
      throw Error(rollback)
    })
  }catch(error){
    if(error instanceof Error&&error.message===rollback){passed++;console.log('PASS '+name);return}
    failed++;console.error('FAIL '+name+': '+String(error))
  }finally{current=db;failSql=null}
}
function customer(r:any){return {kind:'CUSTOMER' as const,sessionId:'session',canonicalPhone:'5491112345678',expectedRevision:4n,
  expectedReceipt:{groupId:r.groupId,operationKey:r.operationKey,proposalNonce:r.proposal.nonce,fingerprint:r.proposal.fingerprint}}}
async function prepared(tx:Prisma.TransactionClient,r:any,actor:any=staff){return (await common()).loadPendingDepositCancellationTx(tx,{businessId:'b',appointmentId:r.members[0].appointmentId,actor})}
async function cancel(tx:Prisma.TransactionClient,snapshot:any,actor:any=staff,key='cancel-pending'){return (await common()).cancelPendingDepositInTransaction(tx,{snapshot,actor,confirmed:true,operationKey:key})}
async function assertCancelled(memberCount:number){
  const rows=await financialRows()
  assert.equal(rows.Appointment.length,memberCount);assert.ok(rows.Appointment.every((r:any)=>r.status==='CANCELLED'))
  assert.ok(rows.BookingVisit.every((r:any)=>r.status==='CANCELLED'))
  assert.ok(rows.BookingDeposit.every((r:any)=>r.status==='REJECTED'&&r.reviewedByUserId===null))
  assert.equal(rows.BookingDepositProof.length,0,'no fabricated proof or approval')
  assert.ok(rows.BotJob.every((r:any)=>r.status==='DONE'),'unclaimed expiries neutralized, not deleted')
}
try{
  await check('customer cancels all members including NONE companion and preserves session',async(tx,r)=>{
    const actor=customer(r),p=await prepared(tx,r,actor),before=await financialRows(),result=await cancel(tx,p,actor)
    assert.match(p.fingerprint,/^[a-f0-9]{64}$/);assert.equal(result.outcome,'CANCELLED');assert.equal(result.appointmentIds.length,2)
    await assertCancelled(2)
    const after=await financialRows();assert.deepEqual(after.BotSession,before.BotSession,'caller owns reset/CAS')
    assert.ok(after.BookingDeposit.every((d:any)=>d.rejectionReason==='CANCELLED_BY_CUSTOMER'));assert.equal(after.StaffAuditLog.length,0)
    assert.equal((await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})).depositStatus,'REJECTED','cancellation evidence is not proof review')
    assert.equal((await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})).cancellationReason,'CUSTOMER')
  })
  await check('staff cancels whole group with actual audit and no reviewer',async(tx,r)=>{
    const p=await prepared(tx,r),before=await financialRows(),result=await cancel(tx,p)
    assert.equal(result.appointmentIds.length,2);await assertCancelled(2)
    const after=await financialRows();assert.deepEqual(after.BotSession,before.BotSession)
    assert.ok(after.BookingDeposit.every((d:any)=>d.rejectionReason==='CANCELLED_BY_STAFF'))
    assert.ok(after.StaffAuditLog.length>=1);assert.ok(after.StaffAuditLog.every((a:any)=>a.userId==='operator'&&a.businessId==='b'))
    assert.equal((await current.query('SELECT count(*)::int AS n FROM "BookingDepositReviewAudit"')).rows[0]!.n,0)
    assert.equal((await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})).depositStatus,'REJECTED')
    assert.equal((await group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId})).cancellationReason,'STAFF')
  })
  for(const corruption of ['requestHash','status','actorAudit','memberVersion'] as const)await check('durable cancellation reader rejects '+corruption,async(tx,r)=>{
    await cancel(tx,await prepared(tx,r))
    if(corruption==='requestHash')await current.query('UPDATE "BotOperation" SET "requestHash"=$1 WHERE type=$2',['0'.repeat(64),'CANCEL_PENDING_DEPOSIT_GROUP'])
    else if(corruption==='status')await current.query('UPDATE "BotOperation" SET status=$1 WHERE type=$2',['STARTED','CANCEL_PENDING_DEPOSIT_GROUP'])
    else if(corruption==='actorAudit')await current.query('UPDATE "StaffAuditLog" SET "entityId"=$1 WHERE action=$2',['foreign-deposit','CANCEL_PENDING_DEPOSIT_GROUP'])
    else await current.query('UPDATE "Appointment" SET version=version+1 WHERE id=$1',[r.members[1].appointmentId])
    const before=await financialRows()
    await assert.rejects(group.lockCoordinatedDepositGroupState(tx,{businessId:'b',groupId:r.groupId}))
    assert.deepEqual(await financialRows(),before,'verification has no lifecycle effects')
  })
  await check('staff singular F8 hold without coordinated manifest',async(tx,r)=>{
    const result=await cancel(tx,await prepared(tx,r));assert.equal(result.appointmentIds.length,1);await assertCancelled(1)
  },true)
  await check('replay does not duplicate cancellation or actor audit',async(tx,r)=>{
    const p=await prepared(tx,r),first=await cancel(tx,p),before=await financialRows(),replay=await cancel(tx,p)
    assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(await financialRows(),before)
  })
  await check('operation replay with different actor fails closed',async(tx,r)=>{
    const p=await prepared(tx,r);await cancel(tx,p);const before=await financialRows()
    await assert.rejects(cancel(tx,p,{...staff,user:{...staffUser,id:'another-actor'}}));assert.deepEqual(await financialRows(),before)
  })
  await check('missing explicit confirmation has no effect',async(tx,r)=>{
    const p=await prepared(tx,r),before=await financialRows()
    await assert.rejects((await common()).cancelPendingDepositInTransaction(tx,{snapshot:p,actor:staff,confirmed:false,operationKey:'no-consent'}))
    assert.deepEqual(await financialRows(),before)
  })
  for(const field of ['groupId','operationKey','proposalNonce','fingerprint'] as const)await check('customer receipt mismatch '+field,async(tx,r)=>{
    const actor=customer(r);actor.expectedReceipt[field]='foreign';const before=await financialRows()
    await assert.rejects(prepared(tx,r,actor));assert.deepEqual(await financialRows(),before)
  })
  for(const field of ['sessionId','canonicalPhone','expectedRevision'] as const)await check('customer scope mismatch '+field,async(tx,r)=>{
    const actor=customer(r) as any;actor[field]=field==='expectedRevision'?3n:field==='canonicalPhone'?'5491199999999':'foreign'
    const before=await financialRows();await assert.rejects(prepared(tx,r,actor));assert.deepEqual(await financialRows(),before)
  })
  await check('tenant and all professional permissions checked before effects',async(tx,r)=>{
    const before=await financialRows(),api=await common()
    await assert.rejects(api.loadPendingDepositCancellationTx(tx,{businessId:'foreign',appointmentId:r.members[0].appointmentId,actor:staff}))
    await assert.rejects(prepared(tx,r,{kind:'STAFF',user:{...staffUser,agendaScope:'OWN',professionalId:'p1'}}))
    await assert.rejects(prepared(tx,r,{kind:'STAFF',user:{...staffUser,canCancelAppointments:false}}));assert.deepEqual(await financialRows(),before)
  })
  await check('changed member after offer requires fresh consent',async(tx,r)=>{
    const p=await prepared(tx,r)
    await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET version=version+1 WHERE id=${r.members[1].appointmentId}`)
    const before=await financialRows();await assert.rejects(cancel(tx,p));assert.deepEqual(await financialRows(),before)
  })
  await check('last member failure rolls back whole financial aggregate',async(tx,r)=>{
    const p=await prepared(tx,r),before=await financialRows()
    failSql=q=>q.text.includes('UPDATE "Appointment"')&&q.values.includes(r.members[1].appointmentId)
    await assert.rejects(savepoint(()=>cancel(tx,p)),/controlled lifecycle/)
    failSql=null;assert.deepEqual(await financialRows(),before)
  })
  await check('reset CAS and outbox failure also roll back cancellation',async(tx,r)=>{
    const actor=customer(r),p=await prepared(tx,r,actor),before=await financialRows()
    await assert.rejects(savepoint(async()=>{
      await cancel(tx,p,actor)
      const changed=await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET state='{}',revision=revision+1 WHERE id='session' AND revision=4`)
      assert.equal(changed,1)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOutbox" (id,"businessId","sessionId",status,"idempotencyKey") VALUES ('reset-reply','b','session','PENDING','reset-reply')`)
      throw Error('controlled reset output failure')
    }),/controlled reset/)
    assert.deepEqual(await financialRows(),before)
    assert.equal((await current.query('SELECT count(*)::int AS n FROM "BotOutbox"')).rows[0]!.n,0)
  })
  await check('under-review and paid remain protected',async(tx,r)=>{
    const bytes=Buffer.from('synthetic proof'),hash=createHash('sha256').update(bytes).digest('hex')
    await writeValidatedDepositProofInTransaction(tx,{businessId:'b',depositId:r.anchorDepositId,operationKey:'proof-before-cancel',evidence:{sourceData:bytes,sourceMimeType:'image/png',sourceFilename:'synthetic.png',sourceByteSize:bytes.length,sourceSha256:hash,derivedData:bytes,derivedMimeType:'image/webp',derivedByteSize:bytes.length,derivedSha256:hash,validatorVersion:'f8-image-v1'}})
    const before=await financialRows();await assert.rejects(prepared(tx,r));assert.deepEqual(await financialRows(),before)
    await approveCurrentDepositProofInTransaction(tx,{businessId:'b',depositId:r.anchorDepositId,actorUserId:'operator',operationKey:'approval-before-cancel',method:'POST',path:'/offline',projectCashPayment:false})
    const approved=await financialRows();await assert.rejects(prepared(tx,r));assert.deepEqual(await financialRows(),approved)
  })
  await check('STAFF transition with actual audit is permitted without fake proof review',async(tx,r)=>{
    await current.query(`INSERT INTO "StaffAuditLog" (id,"businessId","userId",action,"entityType","entityId",method,path) VALUES ('cancel-audit','b','operator','CANCEL_PENDING_DEPOSIT_GROUP','BookingDeposit',$1,'DELETE','/appointments')`,[r.anchorDepositId])
    await current.query(`UPDATE "BookingDeposit" SET status='REJECTED',"reviewedAt"=clock_timestamp(),"rejectionReason"='CANCELLED_BY_STAFF' WHERE id=$1`,[r.anchorDepositId])
    assert.equal((await current.query('SELECT "reviewedByUserId" FROM "BookingDeposit" WHERE id=$1',[r.anchorDepositId])).rows[0]!.reviewedByUserId,null)
  })
  await check('real F8 guard rejects staff cancellation without atomic actor audit',async(tx,r)=>{
    const before=await financialRows()
    await assert.rejects(savepoint(()=>current.query(`UPDATE "BookingDeposit" SET status='REJECTED',"reviewedAt"=clock_timestamp(),"rejectionReason"='CANCELLED_BY_STAFF' WHERE id=$1`,[r.anchorDepositId])),/immutable|audit|cancel/i)
    assert.deepEqual(await financialRows(),before)
  })
  await check('sealed amount and deadline stay immutable',async(tx,r)=>{
    await assert.rejects(savepoint(()=>current.query('UPDATE "BookingDeposit" SET amount=amount+1 WHERE id=$1',[r.anchorDepositId])),/immutable/i)
    await cancel(tx,await prepared(tx,r))
    await assert.rejects(savepoint(()=>current.query(`UPDATE "BookingDeposit" SET "expiresAt"="expiresAt"+interval '1 minute' WHERE id=$1`,[r.anchorDepositId])),/immutable/i)
  })

  await check('current exact revision accepts retained historical hold lineage',async(tx,r)=>{
    await current.query('UPDATE "BotSession" SET revision=5 WHERE id=\'session\'')
    const actor={...customer(r),expectedRevision:5n},p=await prepared(tx,r,actor)
    assert.equal(p.receipt.revision,'5')
    const before=await financialRows();await assert.rejects(prepared(tx,r,customer(r)));assert.deepEqual(await financialRows(),before)
    await cancel(tx,p,actor);await assertCancelled(2)
  })
  for(const field of ['generation','dispatchFenceEpoch','activeConfigurationId'] as const)await check('customer current deployment fence '+field,async(tx,r)=>{
    await current.query('UPDATE "BotChannelDeployment" SET "'+field+'"=$1 WHERE id=\'dep\'',[field==='activeConfigurationId'?'other-config':99])
    const before=await financialRows();await assert.rejects(prepared(tx,r,customer(r)));assert.deepEqual(await financialRows(),before)
  })
  await check('customer cancellation rejects a different active engine',async(tx,r)=>{
    await current.query('UPDATE "BotChannelDeployment" SET "engineKey"=\'other-engine\' WHERE id=\'dep\'')
    const before=await financialRows();await assert.rejects(prepared(tx,r,customer(r)));assert.deepEqual(await financialRows(),before)
  })
  await check('customer cancellation rejects a removed conversational marker',async(tx,r)=>{
    await current.query('UPDATE "BusinessBotConfiguration" SET definition=\'{}\' WHERE id=\'cfg\'')
    const before=await financialRows();await assert.rejects(prepared(tx,r,customer(r)));assert.deepEqual(await financialRows(),before)
  })
  for(const status of ['READY','RETRY','LEASED'] as const)await check('bound proof event job '+status+' protects customer and staff',async(tx,r)=>{
    const actor=customer(r),p=await prepared(tx,r,actor)
    const binding={version:1,...scope,revision:'4',depositId:r.anchorDepositId,operationKey:r.operationKey,proposalNonce:r.proposal.nonce,fingerprint:r.proposal.fingerprint,coordinationGroupId:r.groupId}
    delete (binding as any).dispatchFenceEpoch;delete (binding as any).handoffFenceEpoch
    await current.query('INSERT INTO "BotActionInbox" (id,"businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","entityRef") VALUES (\'proof-inbox\',\'b\',\'proof-event\',\'session\',\'dep\',2,$1)',[JSON.stringify(binding)])
    await current.query('INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration",status) VALUES (\'proof-job\',\'RECEIVE_DEPOSIT_PROOF\',\'proof-event\',\'b\',\'dep\',2,$1)',[status])
    const before=await financialRows();await assert.rejects(prepared(tx,r,actor));await assert.rejects(prepared(tx,r));await assert.rejects(cancel(tx,p,actor));assert.deepEqual(await financialRows(),before)
  })
  for(const old of ['DONE','OTHER_GROUP'] as const)await check('historical proof work '+old+' does not create false busy',async(tx,r)=>{
    const binding={version:1,...scope,revision:'4',depositId:old==='OTHER_GROUP'?'old-deposit':r.anchorDepositId,operationKey:r.operationKey,proposalNonce:r.proposal.nonce,fingerprint:r.proposal.fingerprint,coordinationGroupId:old==='OTHER_GROUP'?'old-group':r.groupId}
    await current.query('INSERT INTO "BotActionInbox" (id,"businessId","providerEventId","sessionId","deploymentId","deploymentGeneration","entityRef") VALUES (\'old-inbox\',\'b\',\'old-event\',\'session\',\'dep\',2,$1)',[JSON.stringify(binding)])
    await current.query('INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration",status) VALUES (\'old-job\',\'RECEIVE_DEPOSIT_PROOF\',\'old-event\',\'b\',\'dep\',2,$1)',[old==='DONE'?'DONE':'READY'])
    const p=await prepared(tx,r);await cancel(tx,p)
    assert.ok((await financialRows()).Appointment.every((a:any)=>a.status==='CANCELLED'))
  })
  await check('proof received after offer blocks financial cancellation without loss',async(tx,r)=>{
    const p=await prepared(tx,r),bytes=Buffer.from('synthetic proof'),hash=createHash('sha256').update(bytes).digest('hex')
    await writeValidatedDepositProofInTransaction(tx,{businessId:'b',depositId:r.anchorDepositId,operationKey:'proof-race',evidence:{sourceData:bytes,sourceMimeType:'image/png',sourceFilename:'synthetic.png',sourceByteSize:bytes.length,sourceSha256:hash,derivedData:bytes,derivedMimeType:'image/webp',derivedByteSize:bytes.length,derivedSha256:hash,validatorVersion:'f8-image-v1'}})
    const before=await financialRows();await assert.rejects(cancel(tx,p));assert.deepEqual(await financialRows(),before)
  })

  console.log('Pending deposit cancellation: '+passed+' passed, '+failed+' failed')
  assert.equal(failed,0)
}finally{failSql=null;await db.close()}
