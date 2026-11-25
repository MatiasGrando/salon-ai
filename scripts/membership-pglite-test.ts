import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { ensureProfessionalEarningForCompletedAppointment } from '../src/services/professional-compensation.js'
import type { Prisma } from '../src/generated/prisma/client.js'

// Execute the real migrations and commission SQL offline. PGlite has one
// connection; cross-process advisory lock contention requires PostgreSQL.
const db=new PGlite()
await db.exec(`
CREATE TYPE "ProfessionalCompensationMode" AS ENUM ('NONE','FIXED','PERCENTAGE');
CREATE TYPE "ProfessionalAccountEntryType" AS ENUM ('EARNING');
CREATE TYPE "ProfessionalAccountDirection" AS ENUM ('CREDIT');
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
CREATE TABLE "Business" (id text PRIMARY KEY, timezone text);
CREATE TABLE "Customer" (id text PRIMARY KEY,"businessId" text, UNIQUE("businessId",id));
CREATE TABLE "Professional" (id text PRIMARY KEY,"businessId" text,"commissionMode" "ProfessionalCompensationMode", "commissionPercentage" numeric,"commissionFixedAmount" integer, UNIQUE("businessId",id));
CREATE TABLE "Service" (id text PRIMARY KEY,"businessId" text,price integer, UNIQUE("businessId",id));
CREATE TABLE "Appointment" (id text PRIMARY KEY,"businessId" text,"customerId" text,"professionalId" text,"serviceId" text,status "AppointmentStatus","startAt" timestamp,"totalDurationMinutes" integer,"quotedPrice" integer, UNIQUE("businessId",id));
CREATE TABLE "AppointmentServiceItem" ("appointmentId" text,"serviceId" text,price integer, PRIMARY KEY("appointmentId","serviceId"));
CREATE TABLE "CashEntry" (id text PRIMARY KEY,"businessId" text,"reversesEntryId" text,amount integer, UNIQUE("businessId",id));
CREATE TABLE "AppointmentAccount" (id text PRIMARY KEY,"businessId" text,"agreedAmount" integer,"discountAmount" integer NOT NULL DEFAULT 0);
CREATE TABLE "AppointmentAccountLink" ("businessId" text,"appointmentId" text,"accountId" text);
CREATE TABLE "ProductSale" ("businessId" text,"appointmentId" text,"serviceSubtotal" integer);
CREATE TABLE "ProfessionalService" ("professionalId" text,"serviceId" text,"commissionMode" "ProfessionalCompensationMode","commissionPercentage" numeric,"commissionFixedAmount" integer);
CREATE TABLE "ProfessionalAccountEntry" (id text PRIMARY KEY,"businessId" text,"professionalId" text,"appointmentId" text,type "ProfessionalAccountEntryType",direction "ProfessionalAccountDirection",amount integer,"baseAmount" integer,"ruleMode" "ProfessionalCompensationMode","rulePercentage" numeric,"ruleFixedAmount" integer,description text,"actorUserId" text,"actorName" text,"effectiveAt" timestamp, UNIQUE("businessId","appointmentId"));
`)
await db.exec(readFileSync(new URL('../prisma/migrations/202611240001_booking_programs/migration.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../prisma/migrations/202611250001_membership_service_quotas/migration.sql',import.meta.url),'utf8'))
const rules=[{serviceId:'cut',name:'Corte',uses:2,unitPrice:25000},{serviceId:'color',name:'Coloracion',uses:1,unitPrice:50000}]
await db.exec(`INSERT INTO "Business" VALUES ('b','America/Argentina/Buenos_Aires'),('other','UTC');
INSERT INTO "Customer" VALUES ('c','b'),('stranger','b');
INSERT INTO "Professional" (id,"businessId","commissionMode","commissionPercentage") VALUES ('p','b','PERCENTAGE',50);
INSERT INTO "Service" VALUES ('cut','b',40000),('color','b',60000);
INSERT INTO "CashEntry" VALUES ('purchase','b',NULL,100000);`)
await db.query(`INSERT INTO "BenefitPlan" (id,"businessId",name,kind,"serviceIds","totalUses",price,"serviceRules") VALUES ('plan','b','Mixta','MEMBERSHIP',ARRAY['cut','color'],3,100000,$1)`,[JSON.stringify(rules)])
await db.query(`INSERT INTO "CustomerBenefit" (id,"businessId","customerId","planId",name,kind,"serviceIds","totalUses","discountPercent",price,"startsOn","endsOn","cancellationHours","consumeLateCancellation","consumeNoShow","cashEntryId","requestKey","requestHash","serviceRules") VALUES ('grant','b','c','plan','Mixta','MEMBERSHIP',ARRAY['cut','color'],3,100,100000,'2027-01-01','2027-01-30',24,false,false,'purchase','key','hash',$1)`,[JSON.stringify(rules)])
async function appointment(id:string, serviceId='cut',date='2027-01-15T15:00:00',customerId='c') {
  const price=serviceId==='cut'?40000:60000
  await db.query(`INSERT INTO "Appointment" VALUES ($1,'b',$2,'p',$3,'CONFIRMED',$4,30,$5)`,[id,customerId,serviceId,date,price])
  await db.query(`INSERT INTO "AppointmentServiceItem" VALUES ($1,$2,$3)`,[id,serviceId,price])
  await db.query(`INSERT INTO "AppointmentAccount" VALUES ($1,'b',$2,$2)`,['account-'+id,price])
  await db.query(`INSERT INTO "AppointmentAccountLink" VALUES ('b',$1,$2)`,[id,'account-'+id])
}
async function reserve(id:string,serviceId='cut') {
  const originalPrice=serviceId==='cut'?40000:60000,unitPrice=serviceId==='cut'?25000:50000
  await db.query(`INSERT INTO "BenefitUse" (id,"businessId","benefitId","appointmentId","originalPrice","coveredAmount",allocations,"commissionBase") VALUES ($1,'b','grant',$1,$2,$2,$3,$4)`,[id,originalPrice,JSON.stringify([{serviceId,originalPrice,unitPrice}]),unitPrice])
}
const state=async(id:string)=>(await db.query<{state:string}>(`SELECT state FROM "BenefitUse" WHERE id=$1`,[id])).rows[0]!.state
try {
  await appointment('first');await reserve('first')
  await appointment('second');await reserve('second')
  await appointment('third');await assert.rejects(()=>reserve('third'),/MEMBERSHIP_SERVICE_EXHAUSTED/)
  await appointment('color','color');await reserve('color','color')
  await db.query(`UPDATE "Appointment" SET status='CANCELLED' WHERE id='first'`)
  assert.equal(await state('first'),'RELEASED')
  await reserve('third')
  await assert.rejects(()=>db.query(`UPDATE "Appointment" SET status='CONFIRMED' WHERE id='first'`),/MEMBERSHIP_SERVICE_EXHAUSTED/)
  await assert.rejects(()=>db.query(`UPDATE "Appointment" SET "startAt"='2027-01-31T15:00:00' WHERE id='third'`),/BENEFIT_OUTSIDE_PAID_PERIOD/)
  await db.query(`UPDATE "Appointment" SET "startAt"='2027-01-30T15:00:00' WHERE id='third'`)
  await db.query(`UPDATE "Appointment" SET status='COMPLETED' WHERE id='second'`)
  assert.equal(await state('second'),'CONSUMED')
  await db.query(`UPDATE "Service" SET price=90000 WHERE id='cut'`)
  await db.query(`UPDATE "AppointmentAccountLink" SET "accountId"='account-second' WHERE "appointmentId"='color'`)
  await db.query(`UPDATE "AppointmentAccount" SET "agreedAmount"=100000,"discountAmount"=100000 WHERE id='account-second'`)
  const tx={$queryRaw:async(sql:Prisma.Sql)=>(await db.query(sql.text,sql.values.map(v=>v instanceof Date?v.toISOString():v))).rows} as Prisma.TransactionClient
  await ensureProfessionalEarningForCompletedAppointment(tx,{businessId:'b',appointmentId:'second',actorUserId:'admin',actorName:'Admin'})
  await ensureProfessionalEarningForCompletedAppointment(tx,{businessId:'b',appointmentId:'second',actorUserId:'admin',actorName:'Admin'})
  const earnings=(await db.query<{baseAmount:number;amount:number}>(`SELECT * FROM "ProfessionalAccountEntry"`)).rows
  assert.equal(earnings.length,1)
  assert.equal(earnings[0]!.baseAmount,25000)
  assert.equal(earnings[0]!.amount,12500,'comision sobre Plata, no sobre precio habitual ni cero')
  assert.equal((await db.query(`SELECT * FROM "CashEntry"`)).rows.length,1,'atencion y comision no duplican ingreso')
  await assert.rejects(()=>db.query(`UPDATE "CustomerBenefit" SET price=1 WHERE id='grant'`),/MEMBERSHIP_PURCHASE_TERMS_IMMUTABLE/)
  await assert.rejects(()=>db.query(`UPDATE "BenefitUse" SET "commissionBase"=1 WHERE id='second'`),/MEMBERSHIP_USE_TERMS_IMMUTABLE/)
  await assert.rejects(()=>db.query(`UPDATE "AppointmentAccount" SET "discountAmount"=0 WHERE id='account-second'`),/MEMBERSHIP_COVERAGE_LOCKED/)
  await appointment('stranger','cut','2027-01-15T15:00:00','stranger')
  await assert.rejects(()=>reserve('stranger'),/BENEFIT_CUSTOMER_OR_STATUS_CONFLICT/)
  await appointment('expired','cut','2027-01-31T15:00:00')
  await assert.rejects(()=>reserve('expired'),/BENEFIT_OUTSIDE_PAID_PERIOD/)
  await assert.rejects(()=>db.query(`INSERT INTO "CashEntry" VALUES ('refund','b','purchase',100000)`),/BENEFIT_HAS_RESERVED_OR_CONSUMED_USES/)
  console.log('OK PostgreSQL offline: migraciones, cuotas, cancelacion, reactivacion, vencimiento, titularidad y comisiones reales.')
} finally { await db.close() }
