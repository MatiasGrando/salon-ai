import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import * as booking from '../src/services/booking-operations.js'
import { hasAppointmentOverlap } from '../src/services/prisma-booking.js'
import { calculateBookingDepositTerms } from '../src/services/deposit-operations.js'
import { parseEstimateOptions, resolveServiceEstimate } from '../src/bot-options/domain/service-booking.js'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'

// Entirely in-process PostgreSQL. No environment, Prisma connection, network or real business.
const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','BookingDepositLine','BookingDepositExpiryAudit','BusinessPaymentSettings','BotJob','ServiceCombinationRule','BotOperation']
const enums = ['AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode','BookingDepositSource','BookingDepositTtlProvenance']
for (const name of enums) {
  const body = schema.match(new RegExp('enum '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const values = body.split('\n').flatMap(line => line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
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
    return type ? ['"'+field[1]+'" '+type+(primary?' PRIMARY KEY':'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')] : []
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
await db.exec(`
INSERT INTO "Business" (id,name,"botEnabled") VALUES ('b','Salon',true),('foreign','Other',true);
INSERT INTO "Conversation" (id,"businessId",phone) VALUES ('c','b','5491112345678');
INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('customer','b','5491112345678','5491112345678','Ana');
INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','b','WHATSAPP',2,3,'cfg',1);
INSERT INTO "BusinessBotConfiguration" (id,"businessId",status) VALUES ('cfg','b','ACTIVE');
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
function orm(pg: QuerySource): Prisma.TransactionClient {
  let affectedRows=0
  const query = async (q: Prisma.Sql) => {
    // PGlite has no concurrent sessions; locks are executed where supported,
    // advisory lock is the sole no-op. This test does NOT prove cross-process contention.
    if (q.text.includes('pg_advisory_xact_lock')) return [{locked:1}]
    if (failLast && q.text.includes('INSERT INTO "Appointment"') && q.values.includes('p2')) throw Error('controlled last-member failure')
    const result = await pg.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v!==null&&typeof v==='object'?JSON.stringify(v):v))
    affectedRows=result.affectedRows??result.rows.length
    for (const row of result.rows as Record<string,unknown>[]) for (const key of ['startAt','endAt','dbNow','scheduledStartAt','expiresAt','holdExpiresAt']) if(row[key]!=null)row[key]=new Date(String(row[key]))
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
  const estimated=await input()
  assert.equal(estimated.proposal.terms.totalPriceMinor,null)
  const estimateReceipt=await execute(estimated)
  assert.equal(estimateReceipt.amount,250,'percentage uses current estimated minimum, never range maximum')
  assert.equal(estimateReceipt.members[1]!.amount,150)
  assert.deepEqual(await execute(estimated),estimateReceipt)
  console.log('P14.1 coordinated hold, real constraints, replay and rollback PASS')
} finally {await db.close()}