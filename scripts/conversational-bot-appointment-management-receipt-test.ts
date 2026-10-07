import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { executePrismaConversationBooking, runtimeBookingFingerprint, runtimeServiceConfigurationHash, type RuntimeBookingInput, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'

import * as management from '../src/conversational-bot/prisma-appointment-management.js'
import { presentGroupCancellation, confirmGroupCancellation, presentGroupReschedule, confirmGroupReschedule } from '../src/conversational-bot/appointment-management.js'
const load = management.loadOwnConfirmedRuntimeGroupSnapshot
assert.equal(typeof load, 'function', 'server receipt loader must exist before accepting appointment management')
const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','ServiceCombinationRule','BotOperation','BookingDepositProof','AppointmentChangeHistory']
for (const name of ['AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode']) {
  const body = schema.match(new RegExp('enum '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const values = body.split('\n').flatMap(line => line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
  await db.exec('CREATE TYPE "'+name+'" AS ENUM ('+values.map(v=>"'"+v+"'").join(',')+')')
}
for (const name of models) {
  const body = schema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || /\[\]/.test(line)) return []
    const scalar = ({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision'} as Record<string,string>)[field[2]!]
    const type = scalar ?? (schema.includes('enum '+field[2]+' {') ? ['AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode'].includes(field[2]!) ? '"'+field[2]+'"' : 'text' : null)
    const primary = field[1] === (name === 'BusinessBotOptionsSettings' ? 'businessId' : 'id')
    const scalarDefault = line.match(/@default\((0|false)\)/)?.[1]
    return type ? ['"'+field[1]+'" '+type+(primary?' PRIMARY KEY':'')+(scalarDefault?' DEFAULT '+scalarDefault:'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')] : []
  })
  await db.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
}
await db.exec('CREATE UNIQUE INDEX operation_key ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX appointment_visit ON "Appointment" ("visitId")')
await db.exec(`
INSERT INTO "Business" ("id","name","botEnabled") VALUES ('b','Salon',true),('foreign','Other',true);
INSERT INTO "Conversation" ("id","businessId","phone") VALUES ('c','b','5491112345678');
INSERT INTO "Customer" ("id","businessId","phone","normalizedPhone","name") VALUES ('customer','b','5491112345678','5491112345678','Ana');
INSERT INTO "BotChannelDeployment" ("id","businessId","channel","generation","dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','b','WHATSAPP',2,3,'cfg',1);
INSERT INTO "BusinessBotConfiguration" ("id","businessId","status") VALUES ('cfg','b','ACTIVE');
INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","status","revision","handoffFenceEpoch","businessTimezone") VALUES ('session','b','c','dep',2,'ACTIVE',4,5,'America/Argentina/Buenos_Aires');
INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","bookingHorizonDays","bookingLeadTimeHours") VALUES ('b','America/Argentina/Buenos_Aires',30,0);
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
    const rows = (await pg.query(sql, values.map(v=>v instanceof Date ? v.toISOString() : v !== null && typeof v === 'object' ? JSON.stringify(v) : v))).rows as Record<string, unknown>[]
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
  return {...delegates, scheduleBlock:{findFirst:async()=>null},
    $queryRaw:async(q:Prisma.Sql)=>query(q.text,q.values),
    $executeRaw:async(q:Prisma.Sql)=>{await query(q.text,q.values);return 1}
  } as unknown as Prisma.TransactionClient
}
// Use the actual database clock and a future Monday inside F9's valid 30-day horizon.
const day=new Date(String((await db.query<{dbNow:Date}>('SELECT clock_timestamp() AS "dbNow"')).rows[0]!.dbNow))
day.setUTCDate(day.getUTCDate()+14); day.setUTCHours(0,0,0,0)
while(day.getUTCDay()!==1)day.setUTCDate(day.getUTCDate()+1)
const fixtureDate=day.toISOString().slice(0,10)
const terms: RuntimeBookingTerms = { version:1,businessId:'b',timezone:'America/Argentina/Buenos_Aires',date:fixtureDate,customerName:'Ana',preference:{kind:'any'},segments:[
  {serviceId:'s1',serviceName:'Corte',professionalId:'p1',professionalName:'Elisa',startAt:fixtureDate+'T13:00:00.000Z',endAt:fixtureDate+'T13:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:1000,priceMode:'FIXED',configurationHash:null},
  {serviceId:'s2',serviceName:'Crema',professionalId:'p2',professionalName:'Leo',startAt:fixtureDate+'T13:30:00.000Z',endAt:fixtureDate+'T14:00:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:2000,priceMode:'FIXED',configurationHash:null}
],totalPriceMinor:3000 }
for(const segment of terms.segments) segment.configurationHash=runtimeServiceConfigurationHash((await db.query<Record<string,unknown>>('SELECT * FROM "Service" WHERE id=$1',[segment.serviceId])).rows[0]!)
const shownScope={businessId:'b',sessionId:'session',deploymentId:'dep',generation:2,revision:'4',configurationId:'cfg',dispatchFenceEpoch:3,handoffFenceEpoch:5}
const presented = {scope:shownScope,version:1 as const,nonce:'9a3db2a0-c131-4262-883a-a7e9aec6fba8',fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true as const,terms}
const draft = {businessId:'b',customerName:'Ana',date:terms.date,pending:'proposal',professional:terms.preference,basket:{members:terms.segments.map((s,i)=>({memberId:'m'+i,mode:'single',serviceIds:[s.serviceId]}))},
  slot:{startAt:terms.segments[0]!.startAt,coordination:{segments:terms.segments.map(({priceMinor,priceMode,configurationHash,...s})=>s)}},bookingReservation:{presented}}
const origin = {kind:'RUNTIME' as const,businessId:'b',sessionId:'session',canonicalPhone:'5491112345678',revision:4n,deploymentId:'dep',generation:2,dispatchFenceEpoch:3,handoffFenceEpoch:5,configurationId:'cfg',operationKey:'runtime:nonce',newBookingAllowed:true}
const input: RuntimeBookingInput = {origin,presented,currentDraft:draft,consent:{nonce:presented.nonce,fingerprint:presented.fingerprint,confirmed:true}}
await db.query('UPDATE "BotSession" SET "state"=$1 WHERE "id"=$2',[JSON.stringify({booking:'DRAFT',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:draft}}),'session'])
// Synthetic fixture copied from the existing real-F7 PGlite test, not a real database.
const context = { businessId:'b', sessionId:'session', canonicalPhone:origin.canonicalPhone, expectedRevision:5n }
const inTx = <T>(work:(tx:Prisma.TransactionClient)=>Promise<T>) => db.transaction(pg=>work(orm(pg)))
try {
  await db.query('UPDATE "Business" SET "publicAddress"=$1 WHERE id=$2',['Calle Pública Sintética 123','b'])
  const result = await inTx(tx=>executePrismaConversationBooking(tx,input))
  assert.equal(result.kind,'COMMITTED')
  if(result.kind!=='COMMITTED')throw new Error('fixture booking failed')
  assert.equal(result.businessAddress,'Calle Pública Sintética 123')
  const confirmedDraft={...draft,bookingReservation:{presented,receipt:result}}
  const state={booking:'CONFIRMED',deposit:'NONE',handoff:'NONE',conversationDraft:{dialogue:confirmedDraft}}
  await db.query('UPDATE "BotSession" SET state=$1,revision=5 WHERE id=$2',[JSON.stringify(state),'session'])
  const before=structuredClone(state)
  const mark=statements.length
  const snapshot=await inTx(tx=>load(tx,context))
  assert.equal(snapshot.groupId,result.coordinationGroupId)
  assert.equal(snapshot.members.length,2)
  assert.deepEqual(snapshot.scope,{businessId:'b',sessionId:'session',customerId:'customer',normalizedPhone:origin.canonicalPhone})
  assert.deepEqual(new Set(snapshot.members.map(m=>m.appointmentId)),new Set(result.appointments.map(a=>a.appointmentId)))
  assert.ok(statements.slice(mark).some(sql=>sql.includes('FOR UPDATE OF a')),'full group locked before returning current terms')
  assert.ok(!statements.slice(mark).some(sql=>/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|"\w)/i.test(sql)), 'loader grants no effects')
  for(const change of [{businessId:'foreign'},{sessionId:'other'},{canonicalPhone:'5491199999999'},{canonicalPhone:'demo:preview:admin'},{expectedRevision:4n},{appointmentId:'external-id'}]) {
    await assert.rejects(inTx(tx=>load(tx,{...context,...change})), /scope|ownership|current|management|receipt/i)
  }
  const rejectMutation=async(work:(pg:QuerySource & {exec:(sql:string)=>Promise<unknown>})=>Promise<void>)=>{
    await assert.rejects(db.transaction(async pg=>{
      await work(pg)
      await load(orm(pg),context)
      throw new Error('CORRUPTION_WAS_ACCEPTED')
    }),error=>{
      assert.doesNotMatch(String(error),/CORRUPTION_WAS_ACCEPTED/)
      assert.match(String(error),/scope|ownership|current|management|receipt|child|group|snapshot|visit/i)
      return true
    })
  }
  for(const mutate of [
    (s:typeof state)=>{delete (s.conversationDraft.dialogue.bookingReservation as Partial<typeof confirmedDraft.bookingReservation>).receipt},
    (s:typeof state)=>{s.booking='DRAFT'},
    (s:typeof state)=>{s.conversationDraft.dialogue.businessId='foreign'},
    (s:typeof state)=>{Object.assign(s.conversationDraft.dialogue.bookingReservation.receipt,{kind:'QA'})},
    (s:typeof state)=>{s.handoff='HUMAN'},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.proposalNonce='foreign'},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.fingerprint='a'.repeat(64)},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.appointments.pop()},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.appointments.push({...result.appointments[0]!})},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.appointments[0]!.segmentIndex=1},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.receipt.appointments[0]!.appointmentId='foreign'},
    (s:typeof state)=>{s.conversationDraft.dialogue.bookingReservation.presented.scope.revision='5'},
    (s:typeof state)=>{Object.assign(s.conversationDraft.dialogue.bookingReservation.receipt,{businessAddress:'x'.repeat(1001)})},
    (s:typeof state)=>{Object.assign(s.conversationDraft.dialogue.bookingReservation.receipt,{externalAuthority:true})}
  ]) await rejectMutation(async pg=>{const bad=structuredClone(state);mutate(bad);await pg.query('UPDATE "BotSession" SET state=$1 WHERE id=$2',[JSON.stringify(bad),'session'])})
  for(const sql of [
    `UPDATE "BotOperation" SET "requestHash"='corrupt' WHERE "resultRef"='${result.coordinationGroupId}'`,
    `UPDATE "BotOperation" SET "businessId"='foreign' WHERE "resultRef"='${result.coordinationGroupId}'`,
    `UPDATE "BotOperation" SET status='STARTED' WHERE "resultRef"='${result.coordinationGroupId}'`,
    `UPDATE "BotOperation" SET "operationKey"='foreign-parent' WHERE "resultRef"='${result.coordinationGroupId}'`,
    `DELETE FROM "BotOperation" WHERE "operationKey" LIKE '%segment:1:CONFIRM_VISIT'`,
    `UPDATE "BotOperation" SET "requestHash"='corrupt' WHERE "operationKey" LIKE '%segment:1:CONFIRM_VISIT'`,
    `UPDATE "BotOperation" SET "resultRef"='foreign' WHERE "operationKey" LIKE '%segment:1:CONFIRM_VISIT'`,
    `UPDATE "BookingVisit" SET "sessionId"='foreign' WHERE id='${result.appointments[0]!.visitId}'`,
    `UPDATE "Appointment" SET "coordinationGroupId"='other' WHERE id='${result.appointments[0]!.appointmentId}'`,
    `INSERT INTO "Appointment" (id,"businessId","customerId","professionalId","serviceId","coordinationGroupId",version,status,"startAt","totalDurationMinutes","manualDepositPaid") VALUES ('foreign-extra','foreign','customer','p1','s1','${result.coordinationGroupId}',0,'CONFIRMED','2030-09-02T14:00Z',30,false)`,
    `INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","resultRef") SELECT 'rogue','rogue','CONFIRM_VISIT',"businessId","sessionId",status,"requestHash","resultRef" FROM "BotOperation" WHERE "resultRef"='${result.coordinationGroupId}'`,
    `INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","resultRef") SELECT 'extra',replace("operationKey",'segment:1:','segment:2:'),type,"businessId","sessionId",status,"requestHash","resultRef" FROM "BotOperation" WHERE "operationKey" LIKE '%segment:1:CONFIRM_VISIT'`
  ]) await rejectMutation(pg=>pg.exec(sql).then(()=>undefined))
  assert.deepEqual((await db.query<{state:unknown}>('SELECT state FROM "BotSession" WHERE id=$1',['session'])).rows[0]!.state,before)
  await db.query('UPDATE "BotSession" SET revision=6 WHERE id=$1',['session'])
  const later={...context,expectedRevision:6n}
  await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "cancellationLeadMinutes"=60,"rescheduleLeadMinutes"=60`)
  const current=await inTx(tx=>load(tx,later))
  const moves=current.members.map(member=>({appointmentId:member.appointmentId,newStartAt:new Date(Date.parse(member.startAt)+7*86400000).toISOString()}))
  const proposal=presentGroupReschedule(current,moves)
  const command=confirmGroupReschedule(proposal,{nonce:proposal.nonce,fingerprint:proposal.fingerprint})
  await inTx(tx=>management.rescheduleGroupInTransaction(tx,command))
  const reloaded=await inTx(tx=>load(tx,later))
  assert.deepEqual(reloaded.members.map(m=>m.startAt),moves.map(m=>m.newStartAt))
  assert.deepEqual(reloaded.members.map(m=>m.version),current.members.map(m=>m.version+1))
  assert.equal((await inTx(tx=>management.rescheduleGroupInTransaction(tx,command))).replayed,true)
  const cancelProposal=presentGroupCancellation(reloaded)
  const cancellation=confirmGroupCancellation(cancelProposal,{nonce:cancelProposal.nonce,fingerprint:cancelProposal.fingerprint})
  assert.equal((await inTx(tx=>management.cancelGroupInTransaction(tx,cancellation))).appointmentIds.length,2)
  assert.equal((await inTx(tx=>management.cancelGroupInTransaction(tx,cancellation))).replayed,true)
  await assert.rejects(inTx(tx=>load(tx,later)),/snapshot|confirmed|management/i)
  console.log('own runtime receipt: PASS (real F7 -> current locked snapshot -> F9 reschedule/cancel; no external IDs or real DB)')
} finally { await db.close() }
