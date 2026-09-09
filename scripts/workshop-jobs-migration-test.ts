import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
try {
  await db.exec(`CREATE TABLE "Business" (id TEXT PRIMARY KEY);
    CREATE TABLE "WorkshopVehicle" (id TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, UNIQUE("businessId", id));
    INSERT INTO "Business" VALUES ('a'), ('b');
    INSERT INTO "WorkshopVehicle" VALUES ('v', 'a');`)
  await db.exec(readFileSync('prisma/migrations/20260908010000_add_workshop_jobs/migration.sql', 'utf8'))
  await db.exec(readFileSync('prisma/migrations/20260908160000_add_workshop_performer_active/migration.sql', 'utf8'))
  await db.exec(readFileSync('prisma/migrations/20260908170000_link_workshop_jobs_to_performers/migration.sql', 'utf8'))
  const insert = (id: string, business: string) => db.query(`INSERT INTO "WorkshopJob"
    (id,"businessId","vehicleId",date,mileage,responsible,lines,"totalCents")
    VALUES ($1,$2,'v','2026-09-07',85000,'Mecanico',$3,0)`,
    [id,business,JSON.stringify([{quantity:1,description:'Aceite',partsCents:null,laborCents:null}])])
  await insert('job-a','a')
  await assert.rejects(insert('job-b','b'), /foreign key/i)
  const { rows } = await db.query<{lines: Array<{partsCents: number | null}>}>(`SELECT lines FROM "WorkshopJob"`)
  assert.equal(rows[0].lines[0].partsCents, null)
  await db.exec(`INSERT INTO "WorkshopPerformer" (id,"businessId",name,"normalizedName") VALUES ('p','a','Juan','juan');`)
  await assert.rejects(db.exec(`INSERT INTO "WorkshopPerformer" (id,"businessId",name,"normalizedName") VALUES ('p2','a','JUAN','juan')`), /unique/i)
  await db.exec(`INSERT INTO "WorkshopPerformer" (id,"businessId",name,"normalizedName",active) VALUES ('p3','b','Juan','juan',false)`)
  const performer = await db.query<{active:boolean}>(`SELECT active FROM "WorkshopPerformer" WHERE id='p'`)
  assert.equal(performer.rows[0].active,true)
  await db.exec(`INSERT INTO "WorkshopJob" (id,"businessId","vehicleId",date,mileage,responsible,"performerId",lines,"totalCents") VALUES ('legacy','a','v','2026-09-08',86000,NULL,NULL,'[]',0)`)
  await db.exec(`INSERT INTO "WorkshopJob" (id,"businessId","vehicleId",date,mileage,responsible,"performerId",lines,"totalCents") VALUES ('assigned','a','v','2026-09-09',87000,'Juan','p','[]',0)`)
  await assert.rejects(db.exec(`INSERT INTO "WorkshopJob" (id,"businessId","vehicleId",date,mileage,responsible,"performerId",lines,"totalCents") VALUES ('foreign','b','v','2026-09-09',87000,'Juan','p','[]',0)`), /foreign key/i)
  console.log('Workshop jobs migration passed: tenant foreign key, nullable historical responsible, performer link and active state')
} finally { await db.close() }
