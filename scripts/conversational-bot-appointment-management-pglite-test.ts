import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { presentGroupReschedule, confirmGroupReschedule, presentGroupCancellation, confirmGroupCancellation } from '../src/conversational-bot/appointment-management.js'
import { rescheduleGroupInTransaction, loadCancellationGroupSnapshot, cancelGroupInTransaction } from '../src/conversational-bot/prisma-appointment-management.js'

const db = new PGlite(), calls: string[] = []
let connection: Pick<PGlite,'query'> = db
const withTx = <T>(action: () => Promise<T>) => db.transaction(async pg => {
  connection = pg
  try { return await action() } finally { connection = db }
})
const tx = {
  async $queryRaw<T>(q: Prisma.Sql): Promise<T> { calls.push(q.text); return (await connection.query(q.text,q.values)).rows as T },
  async $executeRaw(q: Prisma.Sql) { calls.push(q.text); return (await connection.query(q.text,q.values)).affectedRows ?? 0 },
  professional: {
    async findMany(input: {where:{businessId:string;id:{in:string[]}}}) { return (await connection.query('SELECT id FROM "Professional" WHERE "businessId"=$1 AND id=ANY($2)',[input.where.businessId,input.where.id.in])).rows },
    async findFirst(input: {where:{businessId:string;id:string}}) { return (await connection.query('SELECT * FROM "Professional" WHERE "businessId"=$1 AND id=$2',[input.where.businessId,input.where.id])).rows[0] ?? null }
  },
  service: {async findMany(input: {where:{businessId:string;id:{in:string[]}}}) { return (await connection.query('SELECT * FROM "Service" WHERE "businessId"=$1 AND id=ANY($2)',[input.where.businessId,input.where.id.in])).rows }},
  professionalService: {async count(input: {where:{professionalId:string;serviceId:{in:string[]}}}) { return Number((await connection.query<{n:number}>('SELECT count(*) AS n FROM "ProfessionalService" WHERE "professionalId"=$1 AND "serviceId"=ANY($2)',[input.where.professionalId,input.where.serviceId.in])).rows[0]!.n) }},
  businessHours: {async findMany(input: {where:{businessId:string;dayOfWeek:number}}) { return (await connection.query('SELECT * FROM "BusinessHours" WHERE "businessId"=$1 AND "dayOfWeek"=$2',[input.where.businessId,input.where.dayOfWeek])).rows }},
  professionalHours: {async findMany(input: {where:{professionalId:string;dayOfWeek:number}}) { return (await connection.query('SELECT * FROM "ProfessionalHours" WHERE "professionalId"=$1 AND "dayOfWeek"=$2',[input.where.professionalId,input.where.dayOfWeek])).rows }},
  scheduleBlock: {async findFirst(input: {where:{businessId:string;startAt:{lt:Date};endAt:{gt:Date};OR:[{professionalId:string},{professionalId:null}]}}) { return (await connection.query('SELECT id FROM "ScheduleBlock" WHERE "businessId"=$1 AND "startAt"<$2 AND "endAt">$3 AND ("professionalId"=$4 OR "professionalId" IS NULL)',[input.where.businessId,input.where.startAt.lt,input.where.endAt.gt,input.where.OR[0].professionalId])).rows[0] ?? null }}
}
const scope = {businessId:'business',customerId:'customer',sessionId:'session',normalizedPhone:'5491112345678'}
try {
  await db.exec(`CREATE TABLE "Professional" (id text PRIMARY KEY,"businessId" text);
    CREATE TABLE "Service" (id text PRIMARY KEY,"businessId" text,duration int DEFAULT 30,"customerDurationMin" int,"customerDurationMax" int);
    CREATE TABLE "Customer" (id text PRIMARY KEY,"businessId" text,"normalizedPhone" text);
    CREATE TABLE "Conversation" (id text PRIMARY KEY,"businessId" text,phone text);
    CREATE TABLE "BotSession" (id text PRIMARY KEY,"businessId" text,"conversationId" text);
    CREATE TABLE "Appointment" (id text PRIMARY KEY,"businessId" text,"customerId" text,"professionalId" text,"serviceId" text,
      "coordinationGroupId" text,version int,status text,"visitId" text,"startAt" timestamptz,"totalDurationMinutes" int,
      "quotedPrice" int,"manualDepositPaid" boolean,"manualDepositAmount" int);
    CREATE TABLE "BookingVisit" (id text PRIMARY KEY,"businessId" text,"customerId" text,"professionalId" text,version int,status text,"scheduledStartAt" timestamptz,"sessionId" text,"holdExpiresAt" timestamptz,"updatedAt" timestamptz DEFAULT now());
    CREATE TABLE "BookingDeposit" (id text PRIMARY KEY,"businessId" text,"appointmentId" text,status text,"visitId" text,"snapshotSealedAt" timestamptz,"expiresAt" timestamptz);
    CREATE TABLE "BusinessBotOptionsSettings" ("businessId" text PRIMARY KEY,timezone text,"cancellationLeadMinutes" int);
    CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED','CANCELLED','PENDING');
    CREATE TYPE "BookingVisitStatus" AS ENUM ('CONFIRMED','CANCELLED','HELD');
    ALTER TABLE "Appointment" ALTER COLUMN status TYPE "AppointmentStatus" USING status::"AppointmentStatus";
    ALTER TABLE "BookingVisit" ALTER COLUMN status TYPE "BookingVisitStatus" USING status::"BookingVisitStatus";
    INSERT INTO "BusinessBotOptionsSettings" VALUES ('business','America/Argentina/Buenos_Aires',60);
    CREATE TABLE "AppointmentServiceItem" ("appointmentId" text,"serviceId" text,"sortOrder" int);
    CREATE TABLE "BotOperation" (id text PRIMARY KEY,"operationKey" text UNIQUE,type text,"businessId" text,"sessionId" text,status text,"requestHash" text,"resultRef" text,"updatedAt" timestamptz);
    INSERT INTO "Professional" VALUES ('p-a','business'),('p-b','business');
    INSERT INTO "Service" (id,"businessId") VALUES ('s-a','business'),('s-b','business');
    INSERT INTO "Customer" VALUES ('customer','business','5491112345678');
    INSERT INTO "Conversation" VALUES ('conversation','business','+54 9 11 1234 5678');
    INSERT INTO "BotSession" VALUES ('session','business','conversation');`)
  const seed = async () => {
    await db.exec(`TRUNCATE "Appointment","BookingVisit","AppointmentServiceItem","BookingDeposit","BotOperation";
      INSERT INTO "Appointment" SELECT id,'business','customer','p-'||id,'s-'||id,'group',3,'CONFIRMED'::"AppointmentStatus",'v-'||id,now()+interval '2 days',30,1000,false,NULL FROM unnest(ARRAY['a','b']) id;
      INSERT INTO "BookingVisit" (id,"businessId","customerId","professionalId",version,status,"scheduledStartAt","sessionId","holdExpiresAt") SELECT 'v-'||id,'business','customer','p-'||id,2,'CONFIRMED'::"BookingVisitStatus","startAt",'session',NULL FROM "Appointment";
      INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId","sortOrder") SELECT id,"serviceId",0 FROM "Appointment";`)
    calls.length = 0
  }
  const snapshot = () => loadCancellationGroupSnapshot(tx as never,scope,'a')
  const makeCommand = async () => { const p=presentGroupCancellation(await snapshot()); return confirmGroupCancellation(p,{nonce:p.nonce,fingerprint:p.fingerprint}) }
  const run = (command: Awaited<ReturnType<typeof makeCommand>>, rejectLast: 'HANDOFF'|'INELIGIBLE'|null = null) =>
    withTx(async () => cancelGroupInTransaction(tx as never,command,async (_tx,input) => {
      assert.ok(calls.some(sql=>sql.includes('FOR UPDATE OF a')), 'all appointments locked before first child')
      assert.ok(calls.some(sql=>sql.includes('FOR UPDATE OF v')), 'visits locked before first child')
      if(rejectLast && input.appointmentId==='b') return {outcome:rejectLast,replayed:false}
      await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET status='CANCELLED',version=version+1 WHERE id=${input.appointmentId}`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET status='CANCELLED',version=version+1 WHERE id=${'v-'+input.appointmentId}`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" VALUES (${input.operationKey},${input.operationKey},'CANCEL_APPOINTMENT',${input.businessId},${input.sessionId},'COMPLETED',${input.requestHash},${input.appointmentId},now())`)
      return {outcome:'CANCELLED',replayed:false}
    }))
  await seed(); const command=await makeCommand()
  for(const failure of ['HANDOFF','INELIGIBLE'] as const) {
    await assert.rejects(run(command,failure),new RegExp(failure))
    assert.deepEqual((await db.query<{status:string}>('SELECT status FROM "Appointment" ORDER BY id')).rows.map(r=>r.status),['CONFIRMED','CONFIRMED'])
    assert.equal((await db.query('SELECT * FROM "BotOperation"')).rows.length,0)
  }
  assert.deepEqual((await db.query<{version:number}>('SELECT version FROM "Appointment" ORDER BY id')).rows.map(r=>r.version),[3,3])
  const result=await run(command); assert.deepEqual(result.appointmentIds,['a','b']); assert.equal(result.replayed,false)
  const replay=await withTx(async()=>cancelGroupInTransaction(tx as never,command,async()=>{throw new Error('no child on replay')}))
  assert.equal(replay.replayed,true)
  await db.exec(`DELETE FROM "BotOperation" WHERE "resultRef"='b'`)
  await assert.rejects(run(command),/replay/)
  await seed(); const stale=await makeCommand(); await db.exec(`UPDATE "Appointment" SET version=4 WHERE id='b'`)
  await assert.rejects(run(stale),/snapshot/)
  await seed(); const membership=await makeCommand(); await db.exec(`UPDATE "Appointment" SET "coordinationGroupId"=NULL WHERE id='b'`)
  await assert.rejects(run(membership),/snapshot/)
  await seed(); await assert.rejects(loadCancellationGroupSnapshot(tx as never,{...scope,customerId:'foreign'},'a'),/ownership/)
  const foreign=await makeCommand(); await db.exec(`UPDATE "Appointment" SET "customerId"='foreign' WHERE id='b'`)
  await assert.rejects(run(foreign),/ownership/)
  await seed(); await db.exec(`UPDATE "Conversation" SET phone='demo:preview:foreign'`)
  await assert.rejects(snapshot(),/ownership/)
  await db.exec(`UPDATE "Conversation" SET phone='+54 9 11 1234 5678'`)
  await seed(); const financial=await makeCommand(); await db.exec(`UPDATE "Appointment" SET "manualDepositPaid"=true WHERE id='b'`)
  await assert.rejects(run(financial),/snapshot/)
  await seed(); const actual=await makeCommand()
  const f9=await withTx(()=>cancelGroupInTransaction(tx as never,actual))
  assert.equal(f9.replayed,false,'default writer executes real F9 SQL')
  assert.deepEqual((await db.query<{status:string}>('SELECT status FROM "Appointment" ORDER BY id')).rows.map(r=>r.status),['CANCELLED','CANCELLED'])
  assert.equal((await withTx(()=>cancelGroupInTransaction(tx as never,actual))).replayed,true,'default F9 group replay')
  await seed()
  await db.exec(`UPDATE "Appointment" SET "startAt"=now()+interval '30 minutes' WHERE id='b';
    UPDATE "BookingVisit" SET "scheduledStartAt"=(SELECT "startAt" FROM "Appointment" WHERE id='b') WHERE id='v-b';`)
  const lastChild=await makeCommand()
  await assert.rejects(withTx(()=>cancelGroupInTransaction(tx as never,lastChild)),/HANDOFF/)
  assert.deepEqual((await db.query<{status:string}>('SELECT status FROM "Appointment" ORDER BY id')).rows.map(r=>r.status),['CONFIRMED','CONFIRMED'],'real F9 second-child rejection rolls back first')
  assert.deepEqual((await db.query<{version:number}>('SELECT version FROM "Appointment" ORDER BY id')).rows.map(r=>r.version),[3,3])
  assert.equal((await db.query('SELECT * FROM "BotOperation"')).rows.length,0)
  await seed(); const denied=await makeCommand()
  await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "cancellationLeadMinutes"=10000`)
  await assert.rejects(withTx(()=>cancelGroupInTransaction(tx as never,denied)),/HANDOFF/)
  assert.deepEqual((await db.query<{status:string}>('SELECT status FROM "Appointment" ORDER BY id')).rows.map(r=>r.status),['CONFIRMED','CONFIRMED'])
  await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "cancellationLeadMinutes"=60`)
  await seed(); await db.exec(`UPDATE "Appointment" SET "manualDepositPaid"=true WHERE id='b'`)
  const handoff=await makeCommand(); let childCalls=0
  await assert.rejects(withTx(()=>cancelGroupInTransaction(tx as never,handoff,async()=>{childCalls++;return {outcome:'CANCELLED',replayed:false}})),/HANDOFF/)
  assert.equal(childCalls,0,'known financial restriction checked before any child')
  await seed(); const tamper=await makeCommand(); await run(tamper)
  await db.exec(`UPDATE "BotOperation" SET "sessionId"='foreign' WHERE type='CANCEL_APPOINTMENT_GROUP'`)
  await assert.rejects(run(tamper),/replay/)
  await seed(); const changed=await makeCommand(); await run(changed)
  await db.exec(`UPDATE "Appointment" SET version=version+1 WHERE id='b'`)
  await assert.rejects(run(changed),/replay/)
  await seed(); const injected=await makeCommand()
  await db.exec(`INSERT INTO "Appointment" SELECT 'foreign', 'other-business','foreign','p-a','s-a','group',3,'CONFIRMED'::"AppointmentStatus",NULL,now()+interval '2 days',30,1000,false,NULL`)
  await assert.rejects(run(injected),/ownership/)
  await seed(); const altered=await makeCommand(); await run(altered)
  await db.exec(`UPDATE "BotOperation" SET "resultRef"='{}' WHERE type='CANCEL_APPOINTMENT_GROUP'`)
  await assert.rejects(run(altered),/replay/)
  await seed(); const childScope=await makeCommand(); await run(childScope)
  await db.exec(`UPDATE "BotOperation" SET "businessId"='foreign' WHERE type='CANCEL_APPOINTMENT' AND "resultRef"='b'`)
  await assert.rejects(run(childScope),/replay/)

  await db.exec(`ALTER TABLE "BusinessBotOptionsSettings" ADD "bookingLeadTimeHours" int DEFAULT 0, ADD "bookingHorizonDays" int DEFAULT 30,
    ADD "rescheduleLeadMinutes" int DEFAULT 60, ADD "depositHoldMinutes" int;
    ALTER TABLE "BookingVisit" ADD "totalDurationMinutes" int DEFAULT 30, ADD "totalPrice" int DEFAULT 1000;
    ALTER TABLE "BookingDeposit" ADD mode text, ADD "configuredValue" int, ADD "baseAmount" int, ADD amount int,
    ADD "holdTtlMinutes" int, ADD "holdTtlProvenance" text, ADD "reviewedAt" timestamptz, ADD "reviewedByUserId" text, ADD "rejectionReason" text;
    ALTER TABLE "AppointmentServiceItem" ADD "durationMinutes" int DEFAULT 30, ADD price int DEFAULT 1000;
    CREATE TABLE "BookingDepositProof" ("businessId" text,"depositId" text);
    CREATE TYPE "BookingDepositStatus" AS ENUM ('PENDING_PROOF','PENDING_RESUBMISSION','PROOF_RECEIVED','APPROVED','REJECTED');
    ALTER TABLE "BookingDeposit" ALTER COLUMN status TYPE "BookingDepositStatus" USING status::"BookingDepositStatus";
    CREATE TABLE "AppointmentChangeHistory" (id text PRIMARY KEY,"appointmentId" text,"operationKey" text UNIQUE,actor text,
      "fromStartAt" timestamptz,"toStartAt" timestamptz,"bookingDepositId" text,"depositPreserved" boolean);
    ALTER TABLE "Professional" ADD "isActive" boolean DEFAULT true;
    ALTER TABLE "Service" ADD name text DEFAULT 'Servicio sintético', ADD price int DEFAULT 1000,
      ADD "priceMode" text DEFAULT 'FIXED', ADD "depositMode" text DEFAULT 'NONE', ADD "depositValue" int;
    CREATE TABLE "ProfessionalService" ("professionalId" text,"serviceId" text);
    INSERT INTO "ProfessionalService" VALUES ('p-a','s-a'),('p-b','s-b');
    CREATE TABLE "BusinessHours" ("businessId" text,"dayOfWeek" int,"startTime" text,"endTime" text);
    CREATE TABLE "ProfessionalHours" ("professionalId" text,"dayOfWeek" int,"startTime" text,"endTime" text);
    INSERT INTO "BusinessHours" SELECT 'business',day,'09:00','18:00' FROM generate_series(0,6) day;
    INSERT INTO "ProfessionalHours" SELECT id,day,'09:00','18:00' FROM "Professional",generate_series(0,6) day;
    CREATE TABLE "ScheduleBlock" (id text,"businessId" text,"professionalId" text,"startAt" timestamptz,"endAt" timestamptz);`)
  await seed()
  const old=await snapshot()
  const target=new Date(Date.parse(old.dbNow)+3*86400000); target.setUTCHours(15,0,0,0)
  const proposed=presentGroupReschedule(old,old.members.map((m,index)=>({appointmentId:m.appointmentId,newStartAt:new Date(target.getTime()+index*30*60000).toISOString()})))
  const moveCommand=confirmGroupReschedule(proposed,{nonce:proposed.nonce,fingerprint:proposed.fingerprint})
  await assert.rejects(withTx(()=>rescheduleGroupInTransaction(tx as never,moveCommand,async(_tx,input)=>{
    if(input.appointmentId==='b') return {outcome:'SLOT_CONFLICT',replayed:false}
    await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "startAt"=${new Date(input.newStartAt)},version=version+1 WHERE id=${input.appointmentId}`)
    return {outcome:'RESCHEDULED',replayed:false,appointmentId:input.appointmentId,newStartAt:input.newStartAt,depositPreserved:false}
  })),/SLOT_CONFLICT/)
  assert.deepEqual((await snapshot()).members,old.members,'partial reschedule leaves originals intact')
  assert.equal((await db.query('SELECT * FROM "BotOperation"')).rows.length,0)

  const moved=await withTx(()=>rescheduleGroupInTransaction(tx as never,moveCommand))
  assert.equal(moved.replayed,false)
  assert.deepEqual((await snapshot()).members.map(m=>m.startAt),moveCommand.moves.map(m=>m.newStartAt))
  assert.equal((await db.query('SELECT * FROM "AppointmentChangeHistory"')).rows.length,2,'real F9 history for every member')
  const movedAgain=await withTx(()=>rescheduleGroupInTransaction(tx as never,moveCommand))
  assert.equal(movedAgain.replayed,true,'whole group replay before fresh-old comparison')
  await db.exec(`DELETE FROM "AppointmentChangeHistory" WHERE "appointmentId"='b'`)
  await assert.rejects(withTx(()=>rescheduleGroupInTransaction(tx as never,moveCommand)),/replay/)
  await seed(); await db.exec('TRUNCATE "AppointmentChangeHistory"')
  const originalAgain=await snapshot()
  const bad=presentGroupReschedule(originalAgain,[{appointmentId:'a',newStartAt:target.toISOString()},
    {appointmentId:'b',newStartAt:new Date(target.getTime()+7*3600000).toISOString()}])
  const badCommand=confirmGroupReschedule(bad,{nonce:bad.nonce,fingerprint:bad.fingerprint})
  await assert.rejects(withTx(()=>rescheduleGroupInTransaction(tx as never,badCommand)),/SLOT_CONFLICT/)
  assert.deepEqual((await snapshot()).members,originalAgain.members,'F9 last-child hours conflict rolls back originals and versions')
  assert.equal((await db.query('SELECT * FROM "AppointmentChangeHistory"')).rows.length,0)
  assert.equal((await db.query('SELECT * FROM "BotOperation"')).rows.length,0)
  const staleMove=presentGroupReschedule(originalAgain,moveCommand.moves)
  const staleCommand=confirmGroupReschedule(staleMove,{nonce:staleMove.nonce,fingerprint:staleMove.fingerprint})
  await db.exec(`UPDATE "Appointment" SET version=version+1 WHERE id='b'`)
  await assert.rejects(withTx(()=>rescheduleGroupInTransaction(tx as never,staleCommand)),/snapshot/)
  await seed(); await db.exec(`UPDATE "Appointment" SET "manualDepositPaid"=true WHERE id='a'`)
  const financialMove=presentGroupReschedule(await snapshot(),moveCommand.moves)
  const financialCommand=confirmGroupReschedule(financialMove,{nonce:financialMove.nonce,fingerprint:financialMove.fingerprint})
  await assert.rejects(withTx(()=>rescheduleGroupInTransaction(tx as never,financialCommand)),/HANDOFF/)
  console.log('group reschedule PostgreSQL/WASM: PASS (real F9; rollback/history/replay; conservative targets)')
  console.log('appointment group PostgreSQL/WASM: PASS (real F9 + controlled failure injection; no real DB)')
} finally {await db.close()}
