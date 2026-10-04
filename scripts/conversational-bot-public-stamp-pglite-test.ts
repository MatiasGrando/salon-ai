import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { readPublicSourceStamp, readPublicSourceSnapshot, loadReadonlyPublicSnapshot } from '../src/conversational-bot/public-source-stamp.js'

const db = new PGlite()
const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const models = ['Business', 'BusinessBotConfiguration', 'BusinessBotOptionsSettings', 'BusinessFeatureSettings', 'Service', 'ServiceCategory', 'Professional', 'ProfessionalService', 'ProfessionalHours', 'BusinessPaymentMethod', 'BusinessHours', 'ScheduleBlock']
// Columns derive from the actual Prisma schema: unknown stamp fields fail real SQL.
for (const model of models) {
  const body = schema.match(new RegExp('model ' + model + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || models.includes(field[2]!) || /\[\]/.test(line)) return []
    const scalar = { String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamp(3)', Json: 'jsonb', Decimal: 'numeric', BigInt: 'bigint', Float: 'double precision' }[field[2]!]
    if (!scalar && !/enum \w+/.test(schema)) return []
    if (!scalar && !schema.includes('enum ' + field[2] + ' {')) return []
    return ['"' + field[1] + '" ' + (scalar ?? 'text') + (field[1] === (model === 'BusinessBotOptionsSettings' ? 'businessId' : 'id') ? ' PRIMARY KEY' : '')]
  })
  await db.exec('CREATE TABLE "' + model + '" (' + columns.join(',') + ')')
}
await db.exec(`ALTER TABLE "ProfessionalService" ADD FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE;
  ALTER TABLE "ProfessionalService" ADD FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE;
  INSERT INTO "Business" ("id","name","publicAddress") VALUES ('a','A','First'),('b','B','Other');
  INSERT INTO "BusinessBotOptionsSettings" ("businessId","timezone") VALUES ('a','America/Argentina/Buenos_Aires'),('b','America/Argentina/Buenos_Aires');
  INSERT INTO "BusinessFeatureSettings" ("id","businessId","assistantPersonality") VALUES ('settings-a','a','{"commercialName":"Original"}'::jsonb),('settings-b','b','{"commercialName":"Other"}'::jsonb);
  INSERT INTO "ServiceCategory" ("id","businessId","name","isActive","sortOrder") VALUES ('ca','a','Services',true,0);
  INSERT INTO "Service" ("id","businessId","name","price","duration","isBookable","isActive","catalogCategoryId") VALUES ('sa','a','Cut',10,30,true,true,'ca');
  INSERT INTO "Professional" ("id","businessId","isActive","acceptsBotBookings") VALUES ('pa','a',true,true);
  INSERT INTO "ProfessionalService" ("id","serviceId","professionalId") VALUES ('ps','sa','pa');
  INSERT INTO "BusinessHours" ("id","businessId","dayOfWeek","startTime","endTime") VALUES ('ha','a',1,'09:00','18:00');
  INSERT INTO "ScheduleBlock" ("id","businessId","reason","title","startAt","endAt") VALUES ('ea','a','HOLIDAY','Closed','2026-09-30 03:00','2026-10-01 03:00');`)
const client: any = { $queryRaw: async (q: any) => (await db.query(q.text, q.values.map((v: unknown) => v instanceof Date ? v.toISOString() : v))).rows }
const context = { businessId: 'a', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-29T15:00:00Z') }
const stamp = () => readPublicSourceStamp(client, context)
try {
  const before = await stamp()
  const publicSnapshot = await readPublicSourceSnapshot(client,context)
  assert.equal(publicSnapshot.stamp,before,'structured snapshot preserves stamp contract')
  assert.deepEqual(publicSnapshot.weeklyHours,[{dayOfWeek:1,startTime:'09:00',endTime:'18:00'}])
  assert.deepEqual(publicSnapshot.globalBlocks,[{startAt:'2026-09-30T03:00:00.000Z',endAt:'2026-10-01T03:00:00.000Z'}])
  assert.doesNotMatch(JSON.stringify(publicSnapshot.globalBlocks),/note|reason|title|Closed/,'private exception text not in temporal projection')
  assert.equal(await stamp(), before)
  await db.exec(`UPDATE "Business" SET "publicAddress"='Other Changed' WHERE "id"='b'`)
  assert.equal(await stamp(), before, 'foreign edits never invalidate local source')
  await db.exec(`UPDATE "BusinessFeatureSettings" SET "assistantPersonality"='{"commercialName":"Foreign Changed"}'::jsonb WHERE "businessId"='b'`)
  assert.equal(await stamp(), before, 'foreign alias must not invalidate local cache')
  await db.exec(`UPDATE "BusinessFeatureSettings" SET "assistantPersonality"='{"commercialName":"Glow"}'::jsonb WHERE "businessId"='a'`)
  assert.notEqual(await stamp(), before, 'local alias edit invalidates public cache')
  for (const [table, id, field, value] of [
    ['Business','a','publicAddress',"'Second'"], ['Business','a','contactEmail',"'public@example.test'"],
    ['Business','a','name',"'Updated'"], ['Business','a','publicMapsUrl',"'https://maps.example'"],
    ['Business','a','landingDescription',"'Updated description'"], ['Business','a','publicWhatsapp',"'123'"],
    ['Business','a','publicAddressArea',"'Area'"], ['Business','a','workshopPublicSiteUrl',"'https://example.test'"],
    ['Business','a','instagramUrl',"'https://instagram.example'"], ['Business','a','facebookUrl',"'https://facebook.example'"], ['Business','a','tiktokUrl',"'https://tiktok.example'"],
    ['Service','sa','price','25'], ['Service','sa','priceMode',"'STARTING_AT'"], ['Service','sa','duration','45'],
    ['Service','sa','name',"'Cut updated'"], ['Service','sa','isActive','false'], ['Service','sa','isBookable','false'],
    ['Service','sa','attentionMode',"'QUOTE'"], ['Service','sa','requiresPhoto','true'], ['Service','sa','validationEnabled','true'],
    ['Service','sa','sortOrder','1'], ['Service','sa','customerDurationMin','20'], ['Service','sa','customerDurationMax','50'],
    ['Service','sa','description',"'Description'"], ['Service','sa','estimateAllowsBooking','false'],
    ['Service','sa','estimateOptions',"'[{\"label\":\"choice\"}]'::jsonb"], ['Service','sa','estimateQuestion',"'Question'"],
    ['Service','sa','estimateExplanation',"'Explanation'"], ['Service','sa','estimateDisclaimer',"'Disclaimer'"],
    ['Service','sa','validationMessage',"'Validation'"], ['Service','sa','validationQuestion',"'Question'"],
    ['ServiceCategory','ca','name',"'Changed'"], ['ServiceCategory','ca','isActive','false'], ['ServiceCategory','ca','sortOrder','2'],
    ['Professional','pa','name',"'Ana'"], ['Professional','pa','description',"'Actual profile'"], ['Professional','pa','isActive','false'], ['Professional','pa','acceptsBotBookings','false'],
    ['BusinessHours','ha','startTime',"'10:00'"], ['BusinessHours','ha','endTime',"'17:00'"], ['BusinessHours','ha','dayOfWeek','2'],
    ['ScheduleBlock','ea','title',"'New public title'"], ['ScheduleBlock','ea','reason',"'OTHER'"],
    ['ScheduleBlock','ea','endAt',"'2026-10-02 03:00'"], ['ScheduleBlock','ea','startAt',"'2026-09-30 04:00'"],
    ['Service','sa','catalogCategoryId','NULL'], ['Service','sa','parentServiceId',"'root'"],
  ]) {
    const prior = await stamp()
    await db.exec('UPDATE "' + table + '" SET "' + field + '"=' + value + ' WHERE "id"=\'' + id + '\'')
    assert.notEqual(await stamp(), prior, table + '.' + field + ' must change stamp')
  }

  let contentBefore = await stamp()
  await db.exec(`INSERT INTO "BusinessBotConfiguration" ("id","businessId","status","definition") VALUES ('qa-cfg','a','ACTIVE','{"qaSimulator":true,"serviceContent":{"version":1,"businessId":"a","services":[]}}'::jsonb)`)
  assert.equal(await stamp(), contentBefore, 'non-QA business must not admit QA-only metadata')
  await db.exec(`UPDATE "Business" SET "isDemo"=true,"demoType"='QA_SANDBOX' WHERE "id"='a'`)
  assert.notEqual(await stamp(), contentBefore, 'QA eligibility changes fingerprint')
  contentBefore = await stamp()
  const contentSnapshot = await readPublicSourceSnapshot(client, context)
  assert.deepEqual(contentSnapshot.serviceContentRows?.[0]?.serviceContent, { version: 1, businessId: 'a', services: [] }, 'same SQL returns only scoped metadata, not whole definition')
  await db.exec(`UPDATE "BusinessBotConfiguration" SET "definition"="definition" || '{"privateSecret":"do-not-project"}'::jsonb WHERE "id"='qa-cfg'`)
  assert.equal(await stamp(), contentBefore, 'unrelated private definition edits never fingerprint')
  await db.exec(`UPDATE "BusinessBotConfiguration" SET "definition"=jsonb_set("definition",'{serviceContent,services}','[{"serviceId":"sa","revision":2}]'::jsonb) WHERE "id"='qa-cfg'`)
  assert.notEqual(await stamp(), contentBefore, 'metadata-only source edit invalidates warm catalog')
  contentBefore = await stamp()
  await db.exec(`UPDATE "BusinessBotConfiguration" SET "status"='INACTIVE' WHERE "id"='qa-cfg'`)
  assert.notEqual(await stamp(), contentBefore, 'active status removal invalidates public metadata')
  let prior = await stamp()
  await db.exec(`UPDATE "ScheduleBlock" SET "note"='PRIVATE' WHERE "id"='ea'; UPDATE "Business" SET "contactPhone"='PRIVATE' WHERE "id"='a'`)
  assert.equal(await stamp(), prior, 'private fields are not fingerprint inputs')
  await db.exec(`INSERT INTO "ScheduleBlock" ("id","businessId","professionalId","startAt","endAt") VALUES ('pro','a','pa','2026-09-30','2026-10-01')`)
  assert.notEqual(await stamp(), prior, 'professional exceptions invalidate public habitual schedule');
  prior = await stamp(); await db.exec(`INSERT INTO "ProfessionalHours" ("id","professionalId","dayOfWeek","startTime","endTime") VALUES ('ph','pa',6,'09:00','18:00')`);
  assert.notEqual(await stamp(), prior, 'professional hours invalidate public schedule');
  prior = await stamp(); await db.exec(`INSERT INTO "BusinessPaymentMethod" ("id","businessId","name","position","isActive") VALUES ('pay','a','Cash',0,true)`);
  assert.notEqual(await stamp(), prior, 'public payment method invalidates public facts')
  for (const [table, id, field, value] of [
    ['ProfessionalHours', 'ph', 'dayOfWeek', '5'], ['ProfessionalHours', 'ph', 'startTime', "'10:00'"], ['ProfessionalHours', 'ph', 'endTime', "'17:00'"],
    ['BusinessPaymentMethod', 'pay', 'name', "'Card'"], ['BusinessPaymentMethod', 'pay', 'position', '3'], ['BusinessPaymentMethod', 'pay', 'isActive', 'false'],
    ['ScheduleBlock', 'pro', 'startAt', "'2026-09-30 12:00'"], ['ScheduleBlock', 'pro', 'endAt', "'2026-10-01 12:00'"]
  ]) {
    prior = await stamp()
    await db.exec('UPDATE "' + table + '" SET "' + field + '"=' + value + ' WHERE "id"=\'' + id + '\'')
    assert.notEqual(await stamp(), prior, table + '.' + field + ' invalidates public facts')
  }
  prior = await stamp()
  await db.exec(`UPDATE "Professional" SET "commissionFixedAmount"=500 WHERE "id"='pa'; UPDATE "BusinessPaymentMethod" SET "kind"='TRANSFER',"isDefault"=true WHERE "id"='pay'; UPDATE "ScheduleBlock" SET "reason"='PERSONAL',"title"='PRIVATE',"note"='PRIVATE' WHERE "id"='pro'; INSERT INTO "BusinessPaymentMethod" ("id","businessId","name","position","isActive") VALUES ('foreign-pay','b','Foreign',0,true)`)
  assert.equal(await stamp(), prior, 'private fields and foreign public payment rows never fingerprint local facts')
  prior = await stamp(); await db.exec(`DELETE FROM "ProfessionalHours" WHERE "id"='ph'; DELETE FROM "BusinessPaymentMethod" WHERE "id"='pay'`)
  assert.notEqual(await stamp(), prior, 'public schedule/payment deletes invalidate facts')
  prior = await stamp(); await db.exec(`DELETE FROM "Professional" WHERE "id"='pa'`)
  assert.notEqual(await stamp(), prior, 'professional and link cascade invalidates catalogue')
  prior = await stamp(); await db.exec(`DELETE FROM "BusinessHours" WHERE "id"='ha'`)
  assert.notEqual(await stamp(), prior, 'deletes invalidate without timestamps')
  assert.notEqual(await readPublicSourceStamp(client, { ...context, dbNow: new Date('2026-09-30T03:01:00Z') }), await stamp(), 'new local day changes source window')
  await db.exec(`UPDATE "BusinessBotOptionsSettings" SET "timezone"='UTC' WHERE "businessId"='a'`)
  await assert.rejects(() => stamp(), /timezone/)
  assert.notEqual(await readPublicSourceStamp(client, { ...context, timezone: 'UTC' }), prior)
  await assert.rejects(() => readPublicSourceStamp(client, { ...context, businessId: 'missing' }), /scope/)
  const snapshotClient: any = { $transaction: (body: any, options: any) => db.transaction(async transaction => {
    assert.equal(options.isolationLevel, 'RepeatableRead')
    await transaction.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    return body({
      $executeRaw: async (q: any) => transaction.query(q.text, q.values),
      $queryRaw: async (q: any) => (await transaction.query(q.text, q.values.map((v: unknown) => v instanceof Date ? v.toISOString() : v))).rows
    })
  }) }
  await loadReadonlyPublicSnapshot(snapshotClient, async (source: any) => {
    const settings = await source.$queryRaw({ text: "SELECT current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation", values: [] })
    assert.equal(settings[0].readonly, 'on'); assert.equal(settings[0].isolation, 'repeatable read')
    assert.equal(typeof await readPublicSourceStamp(source, { ...context, timezone: 'UTC' }), 'string')
  })
  await assert.rejects(() => loadReadonlyPublicSnapshot(snapshotClient, async (source: any) => source.$executeRaw({ text: 'DELETE FROM "BusinessHours"', values: [] })), /read-only/)
  console.log('conversational public stamp PGlite: PASS')
} finally { await db.close() }
