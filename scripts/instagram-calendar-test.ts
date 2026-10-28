import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH = '__instagram_editor_no_dotenv__'
const { InstagramCalendarService } = await import('../src/services/instagram-calendar-service.js')
const db = new PGlite()
let timezone: string | null = 'America/New_York'
const service = new InstagramCalendarService({ business: { async findUnique() { return { timezone, instagramConfig: { instagramAccountId: 'account-a', apiAccountId: 'app-a' } } } },
  async $queryRaw(query: any) { return (await db.query(query.text, query.values)).rows } })
try {
  const fold = await service.resolveTime('a', '2026-11-01', 90)
  assert.equal(fold.requiresChoice, true); assert.equal(fold.candidates.length, 2)
  assert.deepEqual(fold.candidates.map((c) => c.instant), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'])
  assert.deepEqual(fold.candidates.map((c) => c.offset), ['UTC-4', 'UTC-5'])
  await assert.rejects(service.resolveTime('a', '2026-03-08', 150), /no existe/)
  await assert.rejects(service.resolveTime('a', '2026-02-30', 720), /no existe/)
  assert.equal((await service.resolveTime('a', '2026-11-02', 90)).candidates.length, 1)
  timezone = null; await assert.rejects(service.resolveTime('a', '2026-11-02', 90), /zona horaria/)
  timezone = 'America/Argentina/Buenos_Aires'
  await db.exec(`CREATE TABLE "InstagramMedia" ("id" TEXT,"businessId" TEXT,"accountId" TEXT,"providerMediaId" TEXT,"mediaProductType" TEXT,"caption" TEXT,"publishedAt" TIMESTAMP);
    CREATE TABLE "InstagramPublication" ("id" TEXT,"businessId" TEXT,"caption" TEXT,"status" TEXT,"destinationInstagramAccountId" TEXT,"destinationApiAccountId" TEXT,
      "scheduledAt" TIMESTAMP,"publishedAt" TIMESTAMP,"scheduleTimezone" TEXT,"revision" INTEGER,"metaMediaId" TEXT);`)
  for (let index = 0; index < 32; index++) await db.query(`INSERT INTO "InstagramMedia" VALUES ($1,'a','account-a',$2,'REELS','Cached','2026-10-26T12:00:00Z')`, ['media-' + index, 'provider-' + index])
  await db.exec(`INSERT INTO "InstagramMedia" VALUES ('foreign','b','account-a','provider-x','REELS','Foreign','2026-10-26T12:00:00Z'),('old-account','a','other','provider-old','REELS','Old','2026-10-26T12:00:00Z');
    INSERT INTO "InstagramPublication" VALUES
    ('linked-offpage','a','Linked','PUBLISHED',NULL,NULL,NULL,'2026-10-26T12:00:00Z',NULL,0,'provider-31'),
    ('scheduled','a','Desired','SCHEDULED','account-a','app-a','2026-10-27T12:00:00Z',NULL,'UTC',1,NULL),
    ('cancelled','a','Cancelled','CANCELLED','account-a','app-a','2026-10-27T13:00:00Z',NULL,'UTC',2,NULL),
    ('unknown','a','Uncertain','UNKNOWN','account-a','app-a','2026-10-27T14:00:00Z',NULL,'UTC',1,NULL),
    ('legacy','a','History unknown account','PUBLISHED',NULL,NULL,NULL,'2026-10-26T14:00:00Z',NULL,0,NULL),
    ('draft','a','Undated','DRAFT',NULL,NULL,NULL,NULL,NULL,0,NULL),
    ('other-bound','a','Other account','PUBLISHED','other','other',NULL,'2026-10-26T12:00:00Z',NULL,1,NULL),
    ('foreign','b','Foreign','PUBLISHED',NULL,NULL,NULL,'2026-10-26T12:00:00Z',NULL,0,NULL),
    ('undated-unknown','a','Unknown publish-now','UNKNOWN',NULL,NULL,NULL,NULL,NULL,0,NULL),
    ('undated-failed','a','Failed publish-now','FAILED',NULL,NULL,NULL,NULL,NULL,0,NULL);
    INSERT INTO "InstagramMedia" VALUES ('undated-media','a','account-a','no-time','REELS','Missing creation time',NULL);`)
  await db.exec(`ALTER TABLE "InstagramPublication" ADD COLUMN "publicationType" TEXT NOT NULL DEFAULT 'REEL', ADD COLUMN "manuallyCompletedAt" TIMESTAMP, ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'AUTO';`)
  const range = { from: '2026-10-26T00:00:00Z', to: '2026-10-28T00:00:00Z', limit: 10, offset: 20 }
  const page = await service.list('a', range)
  assert.equal(page.items.length, 10); assert.equal(page.total, 36)
  assert.equal(page.undatedTotal, 4, 'unknown/failed immediate jobs and missing-date imports must remain visible without invented dates'); assert.deepEqual(page.undatedItems, [])
  const all = await service.list('a', { ...range, limit: 100, offset: 0 })
  assert.equal(all.items.filter((row: any) => row.publicationId === 'linked-offpage').length, 1)
  assert.ok(!all.items.some((row: any) => ['other-bound', 'foreign', 'old-account'].includes(row.id)))
  const legacy: any = all.items.find((row: any) => row.id === 'legacy')
  assert.equal(legacy.accountId, null); assert.equal(legacy.unverifiedAccount, true)
  for (const id of ['cancelled', 'unknown']) {
    const row: any = all.items.find((row: any) => row.id === id)
    assert.ok(row.scheduledAt); assert.equal(row.publishedAt, null); assert.equal(+row.eventAt, +row.scheduledAt)
  }
  assert.deepEqual(all.undatedItems.map((row: any) => row.id).sort(), ['draft', 'undated-failed', 'undated-media', 'undated-unknown'])
  for (const row of all.undatedItems) { assert.equal(row.eventAt, null); assert.equal(row.publishedAt, null); assert.equal(row.scheduledAt, null) }
  for (const bad of [{ from: '2026-02-30T00:00:00Z' }, { to: '2027-10-28T00:00:00Z' }, { limit: 101 }, { offset: -1 }]) await assert.rejects(service.list('a', { ...range, ...bad }), /Rango/)
  console.log('OK: real DST gap/fold resolution and cached SQL calendar completeness, pagination, global dedup, legacy history and tenant/account isolation')
} finally { await db.close() }
