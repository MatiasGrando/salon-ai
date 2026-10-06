import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { presentGroupCancellation, confirmGroupCancellation } from '../src/conversational-bot/appointment-management.js'
import { loadCancellationGroupSnapshot, cancelGroupInTransaction } from '../src/conversational-bot/prisma-appointment-management.js'

const db = new PGlite(), calls: string[] = []
let connection: Pick<PGlite,'query'> = db
const withTx = <T>(action: () => Promise<T>) => db.transaction(async pg => {
  connection = pg
  try { return await action() } finally { connection = db }
})
const tx = {
  async $queryRaw<T>(q: Prisma.Sql): Promise<T> { calls.push(q.text); return (await connection.query(q.text,q.values)).rows as T },
  async $executeRaw(q: Prisma.Sql) { calls.push(q.text); return (await connection.query(q.text,q.values)).affectedRows ?? 0 },
  professional: { async findMany(input: {where:{id:{in:string[]}}}) { return input.where.id.in.map(id=>({id})) } }
}
const scope = {businessId:'business',customerId:'customer',sessionId:'session',normalizedPhone:'5491112345678'}
try {
  await db.exec(`CREATE TABLE "Professional" (id text PRIMARY KEY,"businessId" text);
    CREATE TABLE "Service" (id text PRIMARY KEY,"businessId" text);
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
    INSERT INTO "Service" VALUES ('s-a','business'),('s-b','business');
    INSERT INTO "Customer" VALUES ('customer','business','5491112345678');
    INSERT INTO "Conversation" VALUES ('conversation','business','+54 9 11 1234 5678');
    INSERT INTO "BotSession" VALUES ('session','business','conversation');`)
  const seed = async () => {
    await db.exec(`TRUNCATE "Appointment","BookingVisit","AppointmentServiceItem","BookingDeposit","BotOperation";
      INSERT INTO "Appointment" SELECT id,'business','customer','p-'||id,'s-'||id,'group',3,'CONFIRMED'::"AppointmentStatus",'v-'||id,now()+interval '2 days',30,1000,false,NULL FROM unnest(ARRAY['a','b']) id;
      INSERT INTO "BookingVisit" (id,"businessId","customerId","professionalId",version,status,"scheduledStartAt","sessionId","holdExpiresAt") SELECT 'v-'||id,'business','customer','p-'||id,2,'CONFIRMED'::"BookingVisitStatus","startAt",'session',NULL FROM "Appointment";
      INSERT INTO "AppointmentServiceItem" SELECT id,"serviceId",0 FROM "Appointment";`)
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
  console.log('appointment group PostgreSQL/WASM: PASS (real F9 + controlled failure injection; no real DB)')
} finally {await db.close()}
