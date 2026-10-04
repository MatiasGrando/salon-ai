import { attachServiceContent, contentSourceHash } from '../src/bot-options/domain/service-content.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { executePrismaSandboxBooking, verifySimulatorBookingScope } from '../src/conversational-bot/prisma-sandbox-booking.js'
import { initialDialogueState, type DialogueResponse } from '../src/conversational-bot/engine.js'
import { presentSandboxProposal, finalizeSandboxBooking } from '../src/conversational-bot/sandbox-booking.js'
import { PrismaCatalogRepository } from '../src/bot-options/infrastructure/prisma-catalog.js'
import { projectDialogueService } from '../src/conversational-bot/prisma-basket-availability.js'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import { parseDialogueState } from '../src/conversational-bot/engine.js'
import { serviceConfigurationKey } from '../src/bot-options/domain/service-booking.js'
const db = new PGlite(), schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['User','Business','Conversation','Message','Customer','BusinessBotOptionsSettings','Service','ServiceCategory','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingDeposit','ServiceCombinationRule','BusinessBotConfiguration']
for (const name of ['AppointmentStatus','BookingDepositStatus']) {
  const values = schema.match(new RegExp('enum '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!.split('\n').flatMap(line => line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
  await db.exec('CREATE TYPE "'+name+'" AS ENUM ('+values.map(value => "'"+value+"'").join(',')+')')
}
for (const name of models) {
  const body = schema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || /\[\]/.test(line)) return []
    const scalar = ({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision'} as Record<string,string>)[field[2]!]
    const type = scalar ?? (schema.includes('enum '+field[2]+' {') ? ['AppointmentStatus','BookingDepositStatus'].includes(field[2]!) ? '"'+field[2]+'"' : 'text' : null)
    return type ? ['"'+field[1]+'" '+type + (field[1] === (name === 'BusinessBotOptionsSettings' ? 'businessId':'id') ? ' PRIMARY KEY':'')] : []
  })
  await db.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
}
await db.exec(`
INSERT INTO "User" ("id","role","isActive") VALUES ('admin','SUPER_ADMIN',true),('other','BUSINESS_ADMIN',true);
INSERT INTO "Business" ("id","name","isDemo","demoType") VALUES ('qa','Demo',true,'QA_SANDBOX'),('foreign','Other',false,null);
INSERT INTO "Conversation" ("id","businessId","phone") VALUES ('chat','qa','demo:preview:admin:test'),('foreign-chat','foreign','demo:preview:admin:test');
INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","bookingHorizonDays","bookingLeadTimeHours","morningCutTime","eveningCutTime") VALUES ('qa','America/Argentina/Buenos_Aires',3,0,'12:00','19:00');
INSERT INTO "ServiceCategory" ("id","businessId","isActive") VALUES ('category','qa',true);
INSERT INTO "Service" ("id","businessId","catalogCategoryId","name","duration","customerDurationMin","customerDurationMax","price","priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode") VALUES
('cut','qa','category','Corte',30,null,null,27000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE'),
('cream','qa','category','Baño de crema',30,30,60,25000,'STARTING_AT',true,true,'GUIDED_ESTIMATE',false,false,true,'NONE');
UPDATE "Service" SET "estimateQuestion"='¿Qué marca?',"estimateOptions"='[{"id":"karsell","label":"Karsell","priceMin":25000,"priceMax":null,"note":null}]' WHERE "id"='cream';
INSERT INTO "Professional" ("id","businessId","name","isActive","acceptsBotBookings","botBookingPriority") VALUES ('cin','qa','Cin',true,true,0);
INSERT INTO "ProfessionalService" ("id","serviceId","professionalId") VALUES ('cut-cin','cut','cin'),('cream-cin','cream','cin');
INSERT INTO "BusinessHours" ("id","businessId","dayOfWeek","startTime","endTime") VALUES ('hours','qa',6,'11:00','20:00');
INSERT INTO "ProfessionalHours" ("id","professionalId","dayOfWeek","startTime","endTime") VALUES ('prohours','cin',6,'11:00','20:00');
`)
const clock = new Date('2026-10-02T12:00:00Z'), queries: string[] = []
let scopeAddressOverride: { value: unknown } | null = null
let messageSequence=0, rejectMessage=false, revokeInTransaction=false, casInjection=false, transactionCount=0
function orm(sql: { query: PGlite['query'] }): any {
  const query = async (text: string, values: unknown[] = []) => (await sql.query(text, values.map(value => value instanceof Date ? value.toISOString() : value !== null && typeof value === 'object' ? JSON.stringify(value) : value))).rows as any[]
  const select = async (table: string, where: any) => {
    const entries = Object.entries(where), params: unknown[] = []
    const conditions = entries.map(([key,value]) => { if (value && typeof value === 'object' && 'in' in value) { params.push(...(value as any).in); return '"'+key+'" IN ('+(value as any).in.map((_: any,i: number) => '$'+(params.length-(value as any).in.length+i+1)).join(',')+')' } params.push(value); return '"'+key+'"=$'+params.length })
    return query('SELECT * FROM "'+table+'" WHERE '+conditions.join(' AND '),params)
  }
  const insert = async (table: string, data: any) => { const entries=Object.entries(data); return (await query('INSERT INTO "'+table+'" ('+entries.map(([key])=>'"'+key+'"').join(',')+') VALUES ('+entries.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',entries.map(([,value])=>value)))[0] }
  const source: any = {
    businessBotConfiguration: {},
    user: { findUnique: async ({where}: any) => (await select('User',where))[0] ?? null },
    business: { findFirst: async ({where}: any) => (await select('Business',where))[0] ?? null },
    conversation: { findUnique: async ({where}: any) => (await select('Conversation',where.businessId_phone ?? where))[0] ?? null,
      upsert: async ({where,create}: any) => { const existing=(await select('Conversation',where.businessId_phone))[0];
        if(existing && casInjection) {casInjection=false;const changed={...existing.supportBotState,futureStatePadding:'external writer'};await query('UPDATE "Conversation" SET "supportBotState"=$1 WHERE "id"=$2',[changed,existing.id])}
        return existing ?? insert('Conversation',{id:'newchat-'+create.phone,...create,supportBotKey:null,supportBotState:null}) },
      update: async ({where,data}: any)=> {await query('UPDATE "Conversation" SET "supportBotKey"=$1,"supportBotState"=$2 WHERE "id"=$3',[data.supportBotKey,data.supportBotState,where.id]);return (await select('Conversation',where))[0]} },
    message:{create:async ({data}: any)=>{if(rejectMessage && data.direction==='OUTBOUND') throw new Error('test persistence failure');return insert('Message',{id:'msg-'+(++messageSequence),...data})}},
    professional: { findFirst: async ({where}: any) => (await select('Professional',where))[0] ?? null, findMany: async ({where}: any) => select('Professional',where) },
    professionalService: { count: async ({where}: any) => (await select('ProfessionalService',where)).length },
    service: {
      findFirst: async ({where}: any) => {
        assert.equal(where.isActive,true); assert.equal(where.isBookable,true)
        return (await query(`SELECT s.* FROM "Service" s WHERE s."id"=$1 AND s."businessId"=$2 AND s."isActive"=true AND s."isBookable"=true
          AND (s."catalogCategoryId" IS NULL OR EXISTS (SELECT 1 FROM "ServiceCategory" c WHERE c."id"=s."catalogCategoryId" AND c."businessId"=s."businessId" AND c."isActive"=true))
          AND EXISTS (SELECT 1 FROM "ProfessionalService" ps JOIN "Professional" p ON p."id"=ps."professionalId" WHERE ps."serviceId"=s."id" AND p."businessId"=s."businessId" AND p."isActive"=true AND p."acceptsBotBookings"=true)`,[where.id,where.businessId]))[0] ?? null
      }, findMany: async ({where}: any) => select('Service',where)
    },
    businessHours: { findMany: async ({where}: any) => select('BusinessHours',where) },
    professionalHours: { findMany: async ({where}: any) => select('ProfessionalHours',where) },
    scheduleBlock: { findFirst: async () => null },
    customer: { findUnique: async ({where}: any) => (await select('Customer',where))[0] ?? null,
      create: async ({data}: any) => insert('Customer',data), update: async ({where,data}: any) => { await query('UPDATE "Customer" SET "name"=$1 WHERE "id"=$2',[data.name,where.id]); return (await select('Customer',where))[0] } },
    appointment: { findUnique: async ({where}: any) => {
      const row = (await select('Appointment',where))[0]; if (!row) return null
      row.startAt = new Date(row.startAt); row.customer = (await select('Customer',{id:row.customerId}))[0]; row.serviceItems = await query('SELECT * FROM "AppointmentServiceItem" WHERE "appointmentId"=$1 ORDER BY "sortOrder"',[row.id]); return row
    }, create: async ({data}: any) => { const {serviceItems,...rest}=data; const row=await insert('Appointment',rest); for(const item of serviceItems.create) await insert('AppointmentServiceItem',{appointmentId:row.id,...item}); return row } },
    $queryRaw: async (input: any) => {
      queries.push(input.text)
      // PGlite is one connection: inspect exact advisory hierarchy, not pretend to prove cross-process contention.
      if(input.text.includes('pg_advisory_xact_lock')) { assert.match(String(input.values[0]),/^salon-ai:agenda:v1:(business:qa|professional:cin)$/); return [{locked:1}] }
      const rows = await query(input.text,input.values)
      if(scopeAddressOverride && input.text.includes('"publicAddress"')) for(const row of rows) row.publicAddress=scopeAddressOverride.value
      for(const row of rows) { if(input.text.includes('CURRENT_TIMESTAMP AS now') || input.text.includes('clock_timestamp() AS now')) row.now=clock; for(const field of ['startAt','endAt']) if(row[field]!=null) row[field]=new Date(row[field]) }
      return rows
    }
  }
  return source
}
const client=orm(db)
client.$transaction=(body:any)=>db.transaction(async tx=>{transactionCount++;if(revokeInTransaction) {revokeInTransaction=false;await tx.exec(`UPDATE "User" SET "role"='BUSINESS_ADMIN' WHERE "id"='admin'`)}return body(orm(tx))})
const context={businessId:'qa',timezone:'America/Argentina/Buenos_Aires',dbNow:clock}, catalog=new PrismaCatalogRepository(client)
const services=await Promise.all(['cut','cream'].map(async serviceId=>projectDialogueService((await catalog.getService({businessId:'qa',serviceId}))!)))
const state=initialDialogueState('qa'); Object.assign(state,{serviceId:null,basket:{version:1,nextMemberId:3,members:[{memberId:'m1',mode:'single',serviceIds:['cut'],evidence:'cut'},{memberId:'m2',mode:'single',serviceIds:['cream'],evidence:'cream'}]},date:'2026-10-03',professional:{kind:'specific',id:'cin'},customerName:'Matías',pending:'proposal',requestedTime:'17:00',slot:{startAt:'2026-10-03T20:00:00.000Z',date:'2026-10-03',time:'17:00',professionalId:'cin',professionalName:'Cin',band:'AFTERNOON',occupiedMinutes:0}})
state.serviceEstimates={cream:{configurationKey:serviceConfigurationKey(services.find(s=>s.id==='cream')!.bookingPolicy!),optionId:'karsell'}}
const proposal={kind:'BOOKING_PROPOSAL' as const,businessId:'qa',serviceId:'cut',professionalId:'cin',startAt:state.slot!.startAt,customerName:'Matías',serviceIds:['cut','cream'],durationMinutes:60,customerDurationMinutes:90,totalPrice:null}
presentSandboxProposal({...context,sandboxBooking:true},state,services,proposal)
const response: DialogueResponse={state,proposal,reply:'preparing',bookingCommand:{kind:'CONFIRM_SANDBOX_BOOKING',presented:state.sandboxReservation!.presented}}
const execute=async (r=response,userId='admin',conversationId='chat')=>db.transaction(tx=>executePrismaSandboxBooking(orm(tx),{businessId:'qa',userId,conversationId,expectedPhone:'demo:preview:admin:test',response:r}))
const count=async(table:string)=>(await db.query<{n:number}>('SELECT count(*)::int AS n FROM "'+table+'"')).rows[0]!.n
try {
  assert.equal(await verifySimulatorBookingScope(client,'qa','other'),false)
  assert.deepEqual(await execute(response,'other'),{kind:'BLOCKED',reason:'SCOPE_REJECTED'})
  assert.deepEqual(await execute(response,'admin','foreign-chat'),{kind:'BLOCKED',reason:'SCOPE_REJECTED'})
  assert.equal(await count('Appointment'),0)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'SCOPE_REJECTED'},'command without an actually presented persisted proposal is rejected')
  await db.query('UPDATE "Conversation" SET "supportBotState"=$1,"supportBotKey"=$2 WHERE "id"=$3',[JSON.stringify(state),'conversational-preview','chat'])
  await db.exec(`UPDATE "Service" SET "depositMode"='FIXED',"depositValue"=100 WHERE "id"='cut'`)
  // Fresh reviewed metadata participates in consent evidence before writes. No real database is used.
  const originalState = structuredClone(state)
  await db.exec(`UPDATE "Service" SET "estimateDisclaimer"='Asistir con pelo limpio.' WHERE "id"='cream'`)
  const freshService = projectDialogueService((await catalog.getService({ businessId: 'qa', serviceId: 'cream' }))!)
  const freshPolicy = freshService.bookingPolicy!
  const content = { version: 1, businessId: 'qa', serviceId: 'cream', reviewed: true, revision: 1, sourceHash: contentSourceHash(freshPolicy), segments: [
    { id: 'attendance', source: 'disclaimer', start: 0, end: freshPolicy.estimateDisclaimer!.length, stage: 'attendance', role: 'condition', variants: [] }
  ] }
  const definition = { qaSimulator: true, serviceContent: { version: 1 as const, businessId: 'qa', services: [content] } }
  freshService.bookingPolicy = attachServiceContent(freshPolicy, 'qa', definition.serviceContent)
  const reviewedState = structuredClone(state)
  reviewedState.serviceEstimates = { cream: { configurationKey: serviceConfigurationKey(freshService.bookingPolicy), optionId: 'karsell' } }
  const conditionsReply = presentSandboxProposal({ ...context, sandboxBooking: true }, reviewedState, [services[0]!, freshService], proposal)
  assert.ok(conditionsReply.indexOf('Asistir con pelo limpio.') < conditionsReply.indexOf('¿Confirmás'))
  const reviewedResponse: DialogueResponse = { state: reviewedState, proposal: null, reply: '', bookingCommand: { kind: 'CONFIRM_SANDBOX_BOOKING', presented: reviewedState.sandboxReservation!.presented } }
  await db.query('INSERT INTO "BusinessBotConfiguration" ("id","businessId","status","definition") VALUES ($1,$2,$3,$4)', ['active','qa','ACTIVE',JSON.stringify(definition)])
  await db.query('UPDATE "Conversation" SET "supportBotState"=$1 WHERE "id"=$2',[JSON.stringify(reviewedState),'chat'])
  assert.deepEqual(await execute(reviewedResponse), { kind: 'BLOCKED', reason: 'DEPOSIT_REQUIRED' }, 'unchanged reviewed metadata reaches normal fresh safety validation')
  for (const revised of [{ ...definition, serviceContent: { ...definition.serviceContent, services: [{ ...content, revision: 2 }] } }, { ...definition, serviceContent: { ...definition.serviceContent, businessId: 'foreign' } }]) {
    await db.query('UPDATE "BusinessBotConfiguration" SET "definition"=$1 WHERE "id"=$2',[JSON.stringify(revised),'active'])
    assert.deepEqual(await execute(reviewedResponse), { kind: 'REQUOTE' }, 'changed/foreign metadata cannot confirm old presentation')
  }
  await db.query('UPDATE "BusinessBotConfiguration" SET "definition"=$1 WHERE "id"=$2',[JSON.stringify(definition),'active'])
  await db.query('INSERT INTO "BusinessBotConfiguration" ("id","businessId","status","definition") VALUES ($1,$2,$3,$4)', ['ambiguous','qa','ACTIVE',JSON.stringify(definition)])
  assert.deepEqual(await execute(reviewedResponse), { kind: 'REQUOTE' }, 'active ambiguity cannot silently choose a configuration')
  await db.exec(`DELETE FROM "BusinessBotConfiguration"; UPDATE "Service" SET "estimateDisclaimer"=null WHERE "id"='cream'`)
  await db.query('UPDATE "Conversation" SET "supportBotState"=$1 WHERE "id"=$2',[JSON.stringify(originalState),'chat'])
  assert.equal(await count('Appointment'), 0); assert.equal(await count('Customer'), 0)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'DEPOSIT_REQUIRED'}); assert.equal(await count('Customer'),0)
  await db.exec(`UPDATE "Service" SET "depositMode"='NONE',"price"=28000 WHERE "id"='cut'`)
  assert.deepEqual(await execute(),{kind:'REQUOTE'}); assert.equal(await count('Appointment'),0)
  await db.exec(`UPDATE "Service" SET "price"=27000 WHERE "id"='cut'; UPDATE "Service" SET "isActive"=false WHERE "id"='cream'`)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'SERVICE_UNAVAILABLE'})
  await db.exec(`UPDATE "Service" SET "isActive"=true WHERE "id"='cream'; UPDATE "Professional" SET "acceptsBotBookings"=false WHERE "id"='cin'`)
  assert.equal((await execute()).kind,'BLOCKED')
  await db.exec(`UPDATE "Professional" SET "acceptsBotBookings"=true WHERE "id"='cin'`)
  await db.exec(`UPDATE "Service" SET "estimateOptions"='[{"id":"karsell","label":"Karsell","priceMin":30000,"priceMax":null,"note":null}]' WHERE "id"='cream'`)
  assert.deepEqual(await execute(),{kind:'REQUOTE'},'changed estimate terms require new consent')
  await db.exec(`UPDATE "Service" SET "estimateOptions"='[{"id":"karsell","label":"Karsell","priceMin":25000,"priceMax":null,"note":null}]' WHERE "id"='cream'; INSERT INTO "ServiceCombinationRule" ("id","businessId","serviceAId","serviceBId","policy") VALUES ('combo','qa','cut','cream','BLOCKED')`)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'POLICY_BLOCKED'})
  await db.exec(`DELETE FROM "ServiceCombinationRule"; INSERT INTO "ScheduleBlock" ("id","businessId","professionalId","startAt","endAt") VALUES ('block','qa','cin','2026-10-03T20:00:00Z','2026-10-03T21:00:00Z')`)
  assert.deepEqual(await execute(),{kind:'SLOT_CONFLICT'})
  await db.exec(`DELETE FROM "ScheduleBlock"; UPDATE "Service" SET "duration"=40 WHERE "id"='cut'`)
  assert.deepEqual(await execute(),{kind:'REQUOTE'},'duration cannot silently change')
  await db.exec(`UPDATE "Service" SET "duration"=30 WHERE "id"='cut'; INSERT INTO "Appointment" ("id","businessId","professionalId","startAt","totalDurationMinutes","status") VALUES ('ordinary','qa','cin','2026-10-03T20:00:00Z',60,'CONFIRMED')`)
  assert.deepEqual(await execute(),{kind:'SLOT_CONFLICT'})
  await db.exec(`DELETE FROM "Appointment" WHERE "id"='ordinary'`)
  await db.exec(`UPDATE "Business" SET "publicAddress"='Calle Fresca 456',"publicAddressArea"='Centro' WHERE "id"='qa'`)
  const first=await execute(); assert.equal(first.kind,'COMMITTED'); if(first.kind!=='COMMITTED') throw new Error('not committed')
  assert.equal(first.businessAddress,'Calle Fresca 456, Centro','address comes from locked business, not conversational facts')
  assert.equal(await count('Appointment'),1); assert.equal(await count('Customer'),1); assert.equal(await count('AppointmentServiceItem'),2)
  const appointment=(await db.query<any>('SELECT * FROM "Appointment"')).rows[0]; assert.equal(appointment.quotedPrice,null); assert.equal(appointment.totalDurationMinutes,60)
  const items=(await db.query<any>('SELECT * FROM "AppointmentServiceItem" ORDER BY "sortOrder"')).rows; assert.deepEqual(items.map(item=>[item.serviceId,item.durationMinutes,item.price]),[['cut',30,27000],['cream',30,null]])
  const customer=(await db.query<any>('SELECT * FROM "Customer"')).rows[0]; assert.match(customer.phone,/^simqa:customer:/); assert.equal(customer.normalizedPhone,null); assert.equal(customer.email,null)
  const finalized=finalizeSandboxBooking(response,first); assert.equal(finalized.state.sandboxReservation?.receipt?.appointmentId,first.appointmentId)
  const before=queries.length; assert.deepEqual(await execute(),first); assert.equal(await count('Appointment'),1)
  assert.equal(queries.slice(before).some(q=>q.includes('BusinessBotOptionsSettings')),false,'replay does not query agenda/settings')
  await db.exec(`UPDATE "Appointment" SET "status"='CANCELLED'`)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'SCOPE_REJECTED'})
  await db.exec(`UPDATE "Appointment" SET "status"='CONFIRMED'; UPDATE "User" SET "isActive"=false WHERE "id"='admin'`)
  assert.deepEqual(await execute(),{kind:'BLOCKED',reason:'SCOPE_REJECTED'})
  // Actual store transaction: effect, receipt and both chat messages commit or roll back together.
  await db.exec(`UPDATE "User" SET "isActive"=true,"role"='SUPER_ADMIN' WHERE "id"='admin'; DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "Customer";`)
  const seed=async(snapshot:any=state)=> {await db.query('UPDATE "Conversation" SET "supportBotState"=$1,"supportBotKey"=$2 WHERE "id"=$3',[JSON.stringify(snapshot),'conversational-preview','chat'])}
  const factory=async()=>({context,port:{information:async()=>({businessId:'qa',name:'Demo',address:'Monroe 5252',area:'Villa Urquiza',mapsUrl:null,website:null,bookingUrl:null,whatsapp:null,email:null,instagram:null,facebook:null,tiktok:null,description:null,hours:'Sábado: 11:00 a 20:00'}),catalog:async()=>services,availability:async()=>({professionals:[],slots:[]})}})
  const store=(message='confirmo')=>runPrismaDemoPreview(client,'qa','admin','test',message,factory,undefined,undefined,{sandboxBooking:true})
  await seed()
  const defaultTurn=await runPrismaDemoPreview(client,'qa','admin','test','confirmo',factory)
  assert.equal('bookingConfirmed' in defaultTurn,false);assert.equal(await count('Appointment'),0,'default remains proposal-only')
  await db.exec('DELETE FROM "Message"');await seed()
  const uncertain=await store('¿Confirmo?')
  assert.equal(uncertain.bookingConfirmed,false);assert.equal(await count('Appointment'),0,'question is not consent')
  await db.exec('DELETE FROM "Message"');await seed()
  revokeInTransaction=true
  await assert.rejects(()=>store(),/simulator booking scope rejected/)
  assert.equal(await count('Appointment'),0);assert.equal(await count('Message'),0)
  assert.equal((await db.query<any>('SELECT "role" FROM "User" WHERE "id"=$1',['admin'])).rows[0].role,'SUPER_ADMIN','scope failure rolls back injected change')
  rejectMessage=true;await assert.rejects(()=>store(),/test persistence failure/);rejectMessage=false
  assert.equal(await count('Appointment'),0);assert.equal(await count('Customer'),0);assert.equal(await count('Message'),0)
  const oversized:any=structuredClone(state);oversized.futureStatePadding=''
  oversized.futureStatePadding='x'.repeat(16375-JSON.stringify(oversized).length)
  parseDialogueState(oversized,'qa',context.timezone)
  await seed(oversized);await assert.rejects(()=>store(),/invalid dialogue scope/)
  assert.equal(await count('Appointment'),0);assert.equal(await count('Customer'),0);assert.equal(await count('Message'),0,'oversized receipt rolls back effect and chat')
  const { businessAddress: _address, ...legacyResult } = first
  const boundedState:any=structuredClone(state)
  boundedState.futureStatePadding=''
  const withoutLocation=finalizeSandboxBooking({...response,state:boundedState},legacyResult)
  boundedState.futureStatePadding='x'.repeat(16384-JSON.stringify(withoutLocation.state).length)
  parseDialogueState(boundedState,'qa',context.timezone)
  parseDialogueState(finalizeSandboxBooking({...response,state:boundedState},legacyResult).state,'qa',context.timezone)
  await seed(boundedState)
  await assert.rejects(()=>store(),/invalid dialogue scope/,'bounded location snapshot must not bypass the total state limit')
  assert.equal(await count('Appointment'),0);assert.equal(await count('Customer'),0);assert.equal(await count('Message'),0,'location-only state overflow rolls back appointment and chat')
  await seed();casInjection=true;const beforeTx=transactionCount
  const confirmed=await store()
  assert.match(confirmed.reply,/La reserva fue confirmada/)
  assert.match(confirmed.reply,/Te esperamos en Calle Fresca 456, Centro\./)
  assert.match(confirmed.reply,/sábado 03\/10\/2026 a las 17:00/)
  assert.match(confirmed.reply,/Corte/);assert.match(confirmed.reply,/Baño de crema/)
  assert.equal(confirmed.state.sandboxReservation!.receipt!.businessAddress,'Calle Fresca 456, Centro')
  assert.equal((await db.query<any>('SELECT "body" FROM "Message" WHERE "direction"=$1',['OUTBOUND'])).rows[0].body,confirmed.reply)
  await db.exec(`UPDATE "Business" SET "publicAddress"='Calle Posterior 789',"publicAddressArea"='Norte' WHERE "id"='qa'`)
  assert.equal(transactionCount-beforeTx,2,'CAS recomputes outside transaction after stale snapshot')
  assert.equal(confirmed.bookingConfirmed,true);assert.match(confirmed.bookingReceipt!.appointmentId,/^simqa_appointment_/)
  assert.equal('bookingCommand' in confirmed,false,'HTTP projection excludes command')
  assert.equal(await count('Appointment'),1);assert.equal(await count('Message'),2)
  const [again,third]=await Promise.all([store(),store()])
  assert.equal(again.reply,confirmed.reply);assert.equal(third.reply,confirmed.reply,'replay keeps committed location snapshot')
  assert.equal(again.bookingReceipt!.appointmentId,confirmed.bookingReceipt!.appointmentId);assert.equal(third.bookingReceipt!.appointmentId,confirmed.bookingReceipt!.appointmentId)
  assert.equal(await count('Appointment'),1);assert.equal(await count('Message'),6,'FIFO repeated confirmations remain chat turns, not extra bookings')
  const beforeInfo=queries.length
  const address=await runPrismaDemoPreview(client,'qa','admin','test','donde esta el local?',factory,async()=>({intent:'information',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations:[{kind:'information',target:{kind:'business',actions:['ADDRESS']},evidence:'donde esta el local?',confidence:1}]}}),undefined,{sandboxBooking:true}),hours=await store('cuales son los horarios del local?')
  assert.match(address.reply,/Monroe 5252/);assert.match(hours.reply,/Sábado: 11:00 a 20:00/)
  assert.equal(address.bookingReceipt!.appointmentId,confirmed.bookingReceipt!.appointmentId)
  assert.equal(await count('Appointment'),1);assert.equal(queries.slice(beforeInfo).some(q=>q.includes('BusinessBotOptionsSettings')),false)
  const saved=(await db.query<any>('SELECT "supportBotState" FROM "Conversation" WHERE "id"=$1',['chat'])).rows[0].supportBotState
  assert.equal(saved.sandboxReservation.receipt.appointmentId,confirmed.bookingReceipt!.appointmentId)
  // Existing business scope read also supplies the location, without an extra address SELECT.
  const replayReads=queries.slice(beforeInfo).filter(q=>q.includes('FROM "Business"'))
  assert.equal(replayReads.length,4,'two existing business scope checks per preview turn')
  for(const addressValue of [null,'','   ','x'.repeat(1001)]) {
    await db.query('UPDATE "Business" SET "publicAddress"=$1,"publicAddressArea"=$2 WHERE "id"=$3',[addressValue,'Solo barrio','qa'])
    await seed()
    const withoutAddress=await store()
    assert.match(withoutAddress.reply,/La reserva fue confirmada/)
    assert.doesNotMatch(withoutAddress.reply,/Te esperamos en|Solo barrio/)
    assert.equal(withoutAddress.state.sandboxReservation!.receipt!.businessAddress,undefined)
  }
  await db.query('UPDATE "Business" SET "publicAddress"=$1,"publicAddressArea"=$2 WHERE "id"=$3',['  Calle Final 321, Centro  ',' Centro ','qa'])
  for(const value of [123,{},'Calle\n321']) {
    scopeAddressOverride={value};await seed()
    const invalidAddress=await store()
    assert.doesNotMatch(invalidAddress.reply,/Te esperamos en/)
    scopeAddressOverride=null
  }
  const legacy=structuredClone(confirmed.state)
  delete legacy.sandboxReservation!.receipt!.businessAddress
  await seed(legacy)
  const legacyReplay=await store()
  assert.doesNotMatch(legacyReplay.reply,/Te esperamos en/,'a legacy committed receipt is not refreshed from the present address')
  await seed()
  const normalized=await store()
  assert.match(normalized.reply,/Te esperamos en Calle Final 321, Centro\./)
  assert.doesNotMatch(normalized.reply,/Centro, Centro/)
  assert.equal(await count('Appointment'),1,'address changes never create another appointment')
  assert.equal((await db.query<any>('SELECT "status" FROM "Appointment"')).rows[0].status,'CONFIRMED')

  // Real CRM queue plus real Prisma booking adapter: an executed effect cannot be concealed or replayed.
  const ui = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
  const uiSource = (name: string) => {
    const match = ui.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n    \\}'))
    assert.ok(match); return match[0]
  }
  await db.exec('DELETE FROM "AppointmentServiceItem"; DELETE FROM "Appointment"; DELETE FROM "Customer"; DELETE FROM "Message"')
  await seed()
  const chatState: any = { demoChatMessages: [], demoChatSessionId: 'test' }
  const els: any = { demoProfileSelect: { value: 'qa' }, demoPreviewModeRow: { hidden: false }, demoPreviewMode: { value: 'conversational-preview' }, demoChatInput: { value: '', focus() {} }, demoChatSend: { disabled: false } }
  let release!: () => void, effectDone!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const executed = new Promise<void>(resolve => { effectDone = resolve })
  const requestBodies: any[] = []
  const getJson = async (_url: string, options: any) => {
    const body = JSON.parse(options.body), index = requestBodies.length
    requestBodies.push(body)
    const result = await runPrismaDemoPreview(client, 'qa', 'admin', body.sessionId, body.message, factory, undefined, undefined, { sandboxBooking: true }, body.interactiveReplyId, body.turnGroup)
    if (index === 0) { effectDone(); await held }
    return result
  }
  const send = new Function('state', 'els', 'getJson', 'renderDemoChatMessages', 'setButtonLoading',
    [uiSource('startNewDemoChat'), uiSource('drainDemoPreviewMessages'), uiSource('sendDemoChatMessage'), 'return sendDemoChatMessage'].join('\n'))(
    chatState, els, getJson, () => {}, () => true)
  els.demoChatInput.value = 'confirmo'; await send({ preventDefault() {} })
  els.demoChatInput.value = 'cuales son los horarios del local?'; await send({ preventDefault() {} })
  await executed
  assert.equal(await count('Appointment'), 1, 'booking has really executed before its HTTP response reaches the queue')
  release()
  for (let tries = 0; tries < 200 && chatState.demoChatPreviewRun.working; tries++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(chatState.demoChatPreviewRun.working, false)
  const visible = chatState.demoChatMessages.filter((message: any) => message.role === 'bot')
  assert.match(visible[0]?.text ?? '', /La reserva fue confirmada/, 'executed booking receipt must be visible even with a queued followup')
  assert.match(visible[1]?.text ?? '', /Sábado: 11:00 a 20:00/)
  assert.equal(await count('Appointment'), 1, 'followup must never replay or undo an executed booking')
  assert.equal(requestBodies.length, 2)
  assert.notEqual(requestBodies[0].turnGroup.id, requestBodies[1].turnGroup.id)
  assert.deepEqual(requestBodies[1].turnGroup.fragments, ['cuales son los horarios del local?'])


  // Private recovery snapshots must not count as engine state or invalidate an already executed receipt.
  const padded = structuredClone(state) as any
  padded.futureStatePadding = 'x'.repeat(9000)
  parseDialogueState(padded, 'qa', context.timezone)
  await seed(padded)
  const largeFirst = await runPrismaDemoPreview(client, 'qa', 'admin', 'test', 'confirmo', factory, undefined, undefined, { sandboxBooking: true }, undefined,
    { id: 'padded-first', revision: '0', visibleRevision: '0', fragments: ['confirmo'] })
  assert.equal(largeFirst.bookingConfirmed, true)
  const largeFollowup = await runPrismaDemoPreview(client, 'qa', 'admin', 'test', 'cuales son los horarios del local?', factory, undefined, undefined, { sandboxBooking: true }, undefined,
    { id: 'padded-followup', revision: largeFirst.previewRevision, visibleRevision: largeFirst.previewRevision, fragments: ['cuales son los horarios del local?'] })
  assert.equal(largeFollowup.bookingConfirmed, true, 'private ledger size must not silently invalidate a committed reservation')
  assert.equal(largeFollowup.bookingReceipt!.appointmentId, largeFirst.bookingReceipt!.appointmentId)
  assert.match(largeFollowup.reply, /Sábado: 11:00 a 20:00/)
  assert.equal(await count('Appointment'), 1)


  const beforeVisible = chatState.demoChatMessages.filter((message: any) => message.role === 'bot').length
  chatState.demoChatPreviewRun = { profileId: 'qa', sessionId: 'test', queue: [], working: false, revision: largeFollowup.previewRevision, visibleRevision: largeFollowup.previewRevision, group: null }
  els.demoChatInput.value = 'cuales son los horarios del local?'; await send({ preventDefault() {} })
  els.demoChatInput.value = 'y como estas'; await send({ preventDefault() {} })
  for (let tries = 0; tries < 200 && chatState.demoChatPreviewRun.working; tries++) await new Promise(resolve => setTimeout(resolve, 5))
  const afterReceiptReplies = chatState.demoChatMessages.filter((message: any) => message.role === 'bot').slice(beforeVisible)
  assert.equal(afterReceiptReplies.length, 1, 'a historical receipt must not seal every later informational fragment')
  assert.match(afterReceiptReplies[0].text, /Sábado: 11:00 a 20:00/)
  assert.doesNotMatch(afterReceiptReplies[0].text, /La reserva fue confirmada/)
  assert.equal(await count('Appointment'), 1)

  console.log('sandbox booking adapter PGlite: OK (offline; advisory hierarchy inspected, cross-process locks not simulated)')
} finally { await db.close() }
