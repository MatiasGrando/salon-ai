import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { projectConversationDraft, reconcileConversationDraft } from '../src/conversational-bot/session-state.js'
import { conversationStepForBotOptionsState } from '../src/bot-options/domain/conversation-status.js'
import { Prisma } from '../src/generated/prisma/client.js'
import { loadRuntimeDepositReceipt, runtimeBookingReceiptReply, executePrismaConversationBooking, runtimeBookingFingerprint, runtimeServiceConfigurationHash, type RuntimeBookingInput, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'

const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','BookingDepositLine','BookingDepositProof','BookingDepositReviewAudit','BusinessPaymentSettings','BotJob','ServiceCombinationRule','BotOperation']
for (const name of ['AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode','BookingDepositSource','BookingDepositTtlProvenance']) {
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
    const type = scalar ?? (schema.includes('enum '+field[2]+' {') ? ['AppointmentStatus','BookingDepositStatus','BookingVisitStatus','AppointmentOrigin','ServiceAttentionMode','ServiceCombinationPolicy','ServiceDepositMode','BookingDepositSource','BookingDepositTtlProvenance'].includes(field[2]!) ? '"'+field[2]+'"' : 'text' : null)
    const primary = field[1] === (name === 'BusinessBotOptionsSettings' ? 'businessId' : 'id')
    return type ? ['"'+field[1]+'" '+type+(primary?' PRIMARY KEY':'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')] : []
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
} finally { await db.close() }
