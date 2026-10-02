import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
import type { DialogueService } from '../src/conversational-bot/engine.js'

const db = new PGlite()
const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const enumTypes = ['AppointmentStatus', 'BookingDepositStatus']
for (const name of enumTypes) {
  const values = schema.match(new RegExp('enum ' + name + ' \\{([\\s\\S]*?)\\n\\}'))![1]!.split('\n').flatMap(line => line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
  await db.exec('CREATE TYPE "' + name + '" AS ENUM (' + values.map(value => "'" + value + "'").join(',') + ')')
}
const models = ['Business', 'BusinessBotOptionsSettings', 'Service', 'ServiceCategory', 'Professional', 'ProfessionalService', 'BusinessHours', 'ProfessionalHours', 'ScheduleBlock', 'Appointment', 'BookingDeposit', 'ServiceCombinationRule']
for (const model of models) {
  const body = schema.match(new RegExp('model ' + model + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || models.includes(field[2]!) || /\[\]/.test(line)) return []
    const scalar = { String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamptz', Json: 'jsonb', Decimal: 'numeric', BigInt: 'bigint', Float: 'double precision' }[field[2]!]
    const enumType = schema.includes('enum ' + field[2] + ' {') ? enumTypes.includes(field[2]!) ? '"' + field[2] + '"' : 'text' : null
    if (!scalar && !enumType) return []
    return ['"' + field[1] + '" ' + (scalar ?? enumType) + (field[1] === (model === 'BusinessBotOptionsSettings' ? 'businessId' : 'id') ? ' PRIMARY KEY' : '')]
  })
  await db.exec('CREATE TABLE "' + model + '" (' + columns.join(',') + ')')
}
await db.exec(`
  INSERT INTO "Business" ("id","name") VALUES ('tenant','Demo'),('foreign','Other');
  INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone","bookingHorizonDays","bookingLeadTimeHours","morningCutTime","eveningCutTime") VALUES ('tenant','America/Argentina/Buenos_Aires',2,0,'12:00','19:00');
  INSERT INTO "ServiceCategory" ("id","businessId","isActive") VALUES ('category','tenant',true),('foreign-category','foreign',true);
  INSERT INTO "Service" ("id","businessId","catalogCategoryId","name","duration","price","priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking") VALUES
    ('cut','tenant','category','Corte',30,27000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false),
    ('straightening','tenant','category','Alisado',90,85000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false),
    ('other','foreign','foreign-category','Foreign',15,1,'FIXED',true,true,'DIRECT_BOOKING',false,false,false);
  INSERT INTO "Professional" ("id","businessId","name","isActive","acceptsBotBookings","botBookingPriority") VALUES
    ('ramiro','tenant','Ramiro',true,true,0),('cut-only','tenant','Only cut',true,true,1),('foreign-pro','foreign','Other',true,true,0);
  INSERT INTO "ProfessionalService" ("id","serviceId","professionalId") VALUES ('cut-ramiro','cut','ramiro'),('straightening-ramiro','straightening','ramiro'),('cut-only-link','cut','cut-only'),('other-link','other','foreign-pro');
`)
const dbNow = new Date('2026-10-01T12:00:00Z')
let transactionCount = 0
const queries: any[] = []
function source(sql: Pick<PGlite, 'query'>): any {
  return {
    service: { findFirst: async (args: any) => {
      assert.equal(args.where.businessId, 'tenant')
      assert.equal(args.where.isActive, true)
      assert.equal(args.where.isBookable, true)
      assert.deepEqual(args.where.professionalLinks.some.professional, { businessId: 'tenant', isActive: true, acceptsBotBookings: true })
      assert.deepEqual(args.where.OR[1], { catalogCategory: { is: { businessId: 'tenant', isActive: true } } })
      const result = await sql.query(`SELECT s.* FROM "Service" s WHERE s."id"=$1 AND s."businessId"=$2 AND s."isActive"=true AND s."isBookable"=true
        AND (s."catalogCategoryId" IS NULL OR EXISTS (SELECT 1 FROM "ServiceCategory" c WHERE c."id"=s."catalogCategoryId" AND c."businessId"=s."businessId" AND c."isActive"=true))
        AND EXISTS (SELECT 1 FROM "ProfessionalService" ps JOIN "Professional" p ON p."id"=ps."professionalId" WHERE ps."serviceId"=s."id" AND p."businessId"=s."businessId" AND p."isActive"=true AND p."acceptsBotBookings"=true)`, [args.where.id, args.where.businessId])
      return result.rows[0] ?? null
    } },
    $executeRaw: async (query: any) => sql.query(query.text, query.values),
    $queryRaw: async (query: any) => {
      queries.push(query)
      const rows: any[] = (await sql.query(query.text, query.values.map((value: unknown) => value instanceof Date ? value.toISOString() : value))).rows
      return rows.map(row => {
        // Fix the test clock without connecting to a live database or changing production SQL.
        if (query.text.includes('CURRENT_TIMESTAMP AS now')) row.now = dbNow
        for (const field of ['startAt', 'endAt']) if (row[field] != null && !(row[field] instanceof Date)) row[field] = new Date(row[field])
        return row
      })
    }
  }
}
const client: any = source(db)
client.$transaction = (body: any, options: any) => db.transaction(async tx => {
  transactionCount++
  assert.equal(options.isolationLevel, 'RepeatableRead')
  await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
  return body(source(tx))
})
const selected = (id: string): DialogueService => ({ id, name: 'Old catalogue', durationMinutes: 1, requiresConsultation: false, price: 1 })
const { port } = await createPrismaDialoguePort(client, 'tenant')
const request = (professionalId?: string) => port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02', professionalId)
try {
  await db.exec(`INSERT INTO "BusinessHours" ("id","businessId","dayOfWeek","startTime","endTime") VALUES ('hours','tenant',5,'10:00','14:00');
    INSERT INTO "ProfessionalHours" ("id","professionalId","dayOfWeek","startTime","endTime") VALUES ('pro-hours','ramiro',5,'10:00','14:00');`)
  const complete = await request()
  assert.equal(complete.ok, true)
  if (!complete.ok) throw new Error('full basket unavailable')
  assert.equal(complete.durationMinutes, 120)
  assert.equal(complete.totalPrice, 112000)
  assert.deepEqual(complete.professionals.map(pro => pro.id), ['ramiro'], 'SQL joins all services and never includes cut-only or foreign professional')
  assert.deepEqual(complete.slots.map(slot => slot.time), ['10:00', '10:30', '11:00', '11:30', '12:00'])
  assert.equal(transactionCount, 1, 'fresh services, policy and agenda share a read-only snapshot')
  assert.deepEqual(await request('cut-only'), { ok: false, reason: 'NO_COMMON_PROFESSIONAL' })
  await db.exec(`INSERT INTO "ServiceCombinationRule" ("id","businessId","serviceAId","serviceBId","policy") VALUES ('foreign-rule','foreign','straightening','cut','BLOCKED')`)
  assert.equal((await request()).ok, true, 'foreign rules cannot block or authorize local basket')
  await db.exec(`INSERT INTO "ServiceCombinationRule" ("id","businessId","serviceAId","serviceBId","policy") VALUES ('local-rule','tenant','straightening','cut','REVIEW_REQUIRED')`)
  assert.deepEqual(await request(), { ok: false, reason: 'COMBINATION_REVIEW' })
  await db.exec(`UPDATE "ServiceCombinationRule" SET "policy"='BLOCKED' WHERE "id"='local-rule'`)
  assert.deepEqual(await request(), { ok: false, reason: 'COMBINATION_BLOCKED' })
  await db.exec(`DELETE FROM "ServiceCombinationRule" WHERE "id"='local-rule';
    UPDATE "Service" SET "isActive"=false WHERE "id"='straightening'`)
  assert.deepEqual(await request(), { ok: false, reason: 'SERVICE_UNAVAILABLE' }, 'stale commercial descriptors cannot authorize newly inactive service')
  await db.exec(`UPDATE "Service" SET "isActive"=true WHERE "id"='straightening'; UPDATE "ServiceCategory" SET "isActive"=false WHERE "id"='category'`)
  assert.deepEqual(await request(), { ok: false, reason: 'SERVICE_UNAVAILABLE' })
  await db.exec(`UPDATE "ServiceCategory" SET "isActive"=true WHERE "id"='category'; UPDATE "Professional" SET "acceptsBotBookings"=false WHERE "id"='ramiro'`)
  assert.deepEqual(await request(), { ok: false, reason: 'SERVICE_UNAVAILABLE' }, 'every member needs an active bot-bookable professional')
  await db.exec(`UPDATE "Professional" SET "acceptsBotBookings"=true WHERE "id"='ramiro';
    INSERT INTO "Appointment" ("id","professionalId","startAt","totalDurationMinutes","status") VALUES ('busy','ramiro','2026-10-02T14:00:00Z',30,'CONFIRMED')`)
  const busy = await request()
  assert.equal(busy.ok, true)
  if (busy.ok) assert.deepEqual(busy.slots.map(slot => slot.time), ['11:30', '12:00'], 'busy interval in the second service invalidates the full reservation slot')
  await db.exec(`DELETE FROM "Appointment";
    INSERT INTO "ScheduleBlock" ("id","businessId","startAt","endAt") VALUES ('closing','tenant','2026-10-02T16:00:00Z','2026-10-02T17:00:00Z')`)
  const blocked = await request()
  assert.equal(blocked.ok, true)
  if (blocked.ok) assert.deepEqual(blocked.slots.map(slot => slot.time), ['10:00', '10:30', '11:00'], 'business schedule block checks the full duration')
  await db.exec(`DELETE FROM "ScheduleBlock"; UPDATE "Service" SET "customerDurationMin"=90,"customerDurationMax"=120 WHERE "id"='straightening'`)
  assert.deepEqual(await request(), { ok: false, reason: 'UNSUPPORTED_OCCUPANCY' })
  await db.exec(`UPDATE "Service" SET "customerDurationMin"=NULL,"customerDurationMax"=NULL WHERE "id"='straightening';
    UPDATE "BusinessBotOptionsSettings" SET "bookingLeadTimeHours"=26 WHERE "businessId"='tenant'`)
  const leadPort = await createPrismaDialoguePort(client, 'tenant')
  const lead = await leadPort.port.availabilityBasket!([selected('cut'), selected('straightening')], '2026-10-02')
  assert.equal(lead.ok, true)
  if (lead.ok) assert.deepEqual(lead.slots.map(slot => slot.time), ['11:00', '11:30', '12:00'], 'existing lead time remains applied to joint search')
  assert.deepEqual(await port.availabilityBasket!([selected('cut'), selected('other')], '2026-10-02'), { ok: false, reason: 'SERVICE_UNAVAILABLE' })
  console.log('basket port real PostgreSQL syntax in offline PGlite: PASS')
} finally { await db.close() }
