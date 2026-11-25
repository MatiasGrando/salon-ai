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
CREATE TABLE "User" (id text PRIMARY KEY,"businessId" text);
CREATE TABLE "Customer" (id text PRIMARY KEY,"businessId" text, UNIQUE("businessId",id));
CREATE TABLE "Professional" (id text PRIMARY KEY,"businessId" text,"commissionMode" "ProfessionalCompensationMode", "commissionPercentage" numeric,"commissionFixedAmount" integer, UNIQUE("businessId",id));
CREATE TABLE "Service" (id text PRIMARY KEY,"businessId" text,price integer, UNIQUE("businessId",id));
CREATE TABLE "Appointment" (id text PRIMARY KEY,"customerId" text,"professionalId" text,"serviceId" text,status "AppointmentStatus","startAt" timestamp,"totalDurationMinutes" integer,"quotedPrice" integer);
CREATE TABLE "AppointmentServiceItem" ("appointmentId" text,"serviceId" text,price integer, PRIMARY KEY("appointmentId","serviceId"));
CREATE TABLE "BookingDeposit" (id text PRIMARY KEY,"businessId" text, UNIQUE("businessId",id));
CREATE TABLE "TreasuryAccount" (id text PRIMARY KEY,"businessId" text,method text,"createdAt" timestamp);
CREATE TABLE "TreasuryMovement" (id text PRIMARY KEY,"businessId" text,"createdAt" timestamp);
CREATE TABLE "ProductSale" ("businessId" text,"appointmentId" text,"serviceSubtotal" integer);
CREATE TABLE "ProfessionalService" ("professionalId" text,"serviceId" text,"commissionMode" "ProfessionalCompensationMode","commissionPercentage" numeric,"commissionFixedAmount" integer);
CREATE TABLE "ProfessionalAccountEntry" (id text PRIMARY KEY,"businessId" text,"professionalId" text,"appointmentId" text,type "ProfessionalAccountEntryType",direction "ProfessionalAccountDirection",amount integer,"baseAmount" integer,"ruleMode" "ProfessionalCompensationMode","rulePercentage" numeric,"ruleFixedAmount" integer,description text,"actorUserId" text,"actorName" text,"effectiveAt" timestamp, UNIQUE("businessId","appointmentId"));
`)
for (const migration of [
  '20260906120000_add_cash_financial_ledger',
  '20260919210000_add_cash_expense_categories',
  '20260925010000_treasury_payment_methods_and_counterparties',
  '20260925020000_operating_income',
  '20260925030000_unify_cash_income',
  '202611240001_booking_programs',
  '202611250001_membership_service_quotas'
]) {
  await db.exec(readFileSync(new URL('../prisma/migrations/' + migration + '/migration.sql',import.meta.url),'utf8'))
}
const rules=[{serviceId:'cut',name:'Corte',uses:2,unitPrice:25000},{serviceId:'color',name:'Coloracion',uses:1,unitPrice:50000}]
await db.exec(`INSERT INTO "Business" VALUES ('b','America/Argentina/Buenos_Aires'),('other','UTC');
INSERT INTO "User" VALUES ('owner','b');
INSERT INTO "Customer" VALUES ('c','b'),('stranger','b');
INSERT INTO "Professional" (id,"businessId","commissionMode","commissionPercentage") VALUES ('p','b','PERCENTAGE',50);
INSERT INTO "Service" VALUES ('cut','b',40000),('color','b',60000);
INSERT INTO "CashRegisterDay" (id,"businessId","openingCash") VALUES ('day','b',0);
INSERT INTO "CashSession" (id,"businessId","registerDayId","responsibleUserId","responsibleName") VALUES ('session','b','day','owner','Recepcion');
INSERT INTO "BusinessPaymentMethod" (id,"businessId",name,"normalizedName",kind) VALUES
  ('cash','b','Efectivo','efectivo','CASH'),('transfer','b','Transferencia','transferencia','TRANSFER'),('card','b','Tarjeta','tarjeta','CARD');
INSERT INTO "CashExpenseCategory" (id,"businessId",name,"normalizedName") VALUES ('memberships','b','Membresias y packs','membresias y packs');`)
const insertPurchase = (id: string, kind: string, methodId: string, direction = 'INFLOW', category: string | null = 'memberships', session: string | null = 'session') =>
  db.query(`INSERT INTO "CashEntry" (id,"businessId","registerDayId","cashSessionId",type,direction,amount,"paymentMethod",
    "businessPaymentMethodId",origin,description,"expenseCategoryId")
    VALUES ($1,'b','day',$2,'INCOME',$3,40000,$4,$5,'CASH_REGISTER','Membresia: Plata',$6)`,
    [id,session,direction,kind,methodId,category])
await assert.rejects(() => insertPurchase('purchase','CASH','cash'), /CashEntry_shape_check/)
await db.exec(readFileSync(new URL('../prisma/migrations/20261125120000_allow_cash_operating_income/migration.sql',import.meta.url),'utf8'))
for (const [id,kind,methodId] of [['purchase','CASH','cash'],['purchase-transfer','TRANSFER','transfer'],['purchase-card','CARD','card']] as const) {
  await insertPurchase(id,kind,methodId)
}
await assert.rejects(() => insertPurchase('outflow','CASH','cash','OUTFLOW'), /CashEntry_shape_check/)
await assert.rejects(() => insertPurchase('no-session','CASH','cash','INFLOW','memberships',null), /CashEntry_shape_check/)
await assert.rejects(() => insertPurchase('no-category','CASH','cash','INFLOW',null), /CashEntry_expense_category_only_for_classified_operation_check/)
await assert.rejects(() => insertPurchase('wrong-method','CASH','card'), /business payment method mismatch/)
await db.query(`INSERT INTO "BenefitPlan" (id,"businessId",name,kind,"serviceIds","totalUses",price,"serviceRules") VALUES ('plan','b','Mixta','MEMBERSHIP',ARRAY['cut','color'],3,40000,$1)`,[JSON.stringify(rules)])
await db.query(`INSERT INTO "CustomerBenefit" (id,"businessId","customerId","planId",name,kind,"serviceIds","totalUses","discountPercent",price,"startsOn","endsOn","cancellationHours","consumeLateCancellation","consumeNoShow","cashEntryId","requestKey","requestHash","serviceRules") VALUES ('grant','b','c','plan','Mixta','MEMBERSHIP',ARRAY['cut','color'],3,100,40000,'2027-01-01','2027-01-30',24,false,false,'purchase','key','hash',$1)`,[JSON.stringify(rules)])
async function appointment(id:string, serviceId='cut',date='2027-01-15T15:00:00',customerId='c') {
  const price=serviceId==='cut'?40000:60000
  await db.query(`INSERT INTO "Appointment" (id,"businessId","customerId","professionalId","serviceId",status,"startAt","totalDurationMinutes","quotedPrice") VALUES ($1,'b',$2,'p',$3,'CONFIRMED',$4,30,$5)`,[id,customerId,serviceId,date,price])
  await db.query(`INSERT INTO "AppointmentServiceItem" VALUES ($1,$2,$3)`,[id,serviceId,price])
  await db.query(`INSERT INTO "AppointmentAccount" (id,"businessId","pricingMode","agreedAmount","discountAmount","updatedAt") VALUES ($1,'b','FIXED',$2,$2,clock_timestamp())`,['account-'+id,price])
  await db.query(`INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('b',$1,$2)`,[id,'account-'+id])
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
  await db.exec(`INSERT INTO "AppointmentAccount" (id,"businessId","pricingMode","agreedAmount","discountAmount","updatedAt") VALUES
    ('shared-account','b','FIXED',100000,100000,clock_timestamp());
    UPDATE "AppointmentAccountLink" SET "accountId"='shared-account' WHERE "appointmentId" IN ('second','color');`)
  const tx={$queryRaw:async(sql:Prisma.Sql)=>(await db.query(sql.text,sql.values.map(v=>v instanceof Date?v.toISOString():v))).rows} as Prisma.TransactionClient
  await ensureProfessionalEarningForCompletedAppointment(tx,{businessId:'b',appointmentId:'second',actorUserId:'admin',actorName:'Admin'})
  await ensureProfessionalEarningForCompletedAppointment(tx,{businessId:'b',appointmentId:'second',actorUserId:'admin',actorName:'Admin'})
  const earnings=(await db.query<{baseAmount:number;amount:number}>(`SELECT * FROM "ProfessionalAccountEntry"`)).rows
  assert.equal(earnings.length,1)
  assert.equal(earnings[0]!.baseAmount,25000)
  assert.equal(earnings[0]!.amount,12500,'comision sobre Plata, no sobre precio habitual ni cero')
  assert.equal((await db.query(`SELECT * FROM "CashEntry"`)).rows.length,3,'atencion y comision no duplican ingreso')
  await assert.rejects(()=>db.query(`UPDATE "CustomerBenefit" SET price=1 WHERE id='grant'`),/MEMBERSHIP_PURCHASE_TERMS_IMMUTABLE/)
  await assert.rejects(()=>db.query(`UPDATE "BenefitUse" SET "commissionBase"=1 WHERE id='second'`),/MEMBERSHIP_USE_TERMS_IMMUTABLE/)
  await assert.rejects(()=>db.query(`UPDATE "AppointmentAccount" SET "discountAmount"=0 WHERE id='shared-account'`),/MEMBERSHIP_COVERAGE_LOCKED/)
  await appointment('stranger','cut','2027-01-15T15:00:00','stranger')
  await assert.rejects(()=>reserve('stranger'),/BENEFIT_CUSTOMER_OR_STATUS_CONFLICT/)
  await appointment('expired','cut','2027-01-31T15:00:00')
  await assert.rejects(()=>reserve('expired'),/BENEFIT_OUTSIDE_PAID_PERIOD/)
  await assert.rejects(()=>db.query(`INSERT INTO "CashEntry" (id,"businessId","registerDayId","cashSessionId",type,direction,amount,
    "paymentMethod","businessPaymentMethodId",origin,"reversesEntryId")
    VALUES ('refund','b','day','session','REVERSAL','OUTFLOW',40000,'CASH','cash','CASH_REGISTER','purchase')`),/BENEFIT_HAS_RESERVED_OR_CONSUMED_USES/)
  console.log('OK PostgreSQL offline: ingresos de Caja, cuotas, cancelacion, reactivacion, vencimiento, titularidad y comisiones.')
} finally { await db.close() }
