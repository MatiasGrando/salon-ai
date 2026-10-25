import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { PrismaInstagramMediaRepository } = await import('../src/services/prisma-instagram-media-repository.js')
const db = new PGlite()
try {
  await db.exec(`CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "InstagramPublication" ("id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "metaMediaId" TEXT);
    INSERT INTO "Business" VALUES ('business-a'), ('business-b');`)
  await db.exec(readFileSync('prisma/migrations/20261024190000_add_instagram_media_insights/migration.sql', 'utf8'))
  const insertMedia = (id: string, business: string, account: string, providerId = 'reel-1') => db.query(`INSERT INTO "InstagramMedia"
    ("id","businessId","accountId","providerMediaId","lastSyncedAt","views","reach") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,0,NULL)`, [id, business, account, providerId])
  await insertMedia('media-a', 'business-a', 'account-a')
  await insertMedia('media-b', 'business-b', 'account-b')
  await insertMedia('media-a-other-account', 'business-a', 'account-old', 'old-reel')
  await assert.rejects(insertMedia('duplicate', 'business-a', 'account-a'), /unique/i)
  await assert.rejects(insertMedia('orphan', 'missing', 'account-a'), /foreign key/i)
  const known = await db.query<{ views: number; reach: number | null }>(`SELECT "views", "reach" FROM "InstagramMedia" WHERE "id"='media-a'`)
  assert.deepEqual(known.rows[0], { views: 0, reach: null }, 'known zero and unknown remain distinct in PostgreSQL storage')
  await db.query(`INSERT INTO "InstagramMediaInsight" ("id","businessId","accountId","mediaId","observedAt","apiVersion","status","periods","views")
    VALUES ('observation','business-a','account-a','media-a','2026-10-24T10:00:00Z','v25.0','partial','{"views":"lifetime"}',0)`)
  for (const [business, account] of [['business-b', 'account-a'], ['business-a', 'account-old']]) {
    await assert.rejects(db.query(`INSERT INTO "InstagramMediaInsight" ("id","businessId","accountId","mediaId","observedAt","apiVersion","status")
      VALUES ('wrong-scope',$1,$2,'media-a',CURRENT_TIMESTAMP,'v25.0','unavailable')`, [business, account]), /foreign key/i)
  }
  for (const value of [-1, 1.5, 9007199254740992]) {
    await assert.rejects(db.query(`UPDATE "InstagramMedia" SET "views"=$1 WHERE "id"='media-a'`, [value]), /check constraint/i)
    await assert.rejects(db.query(`UPDATE "InstagramMediaInsight" SET "views"=$1 WHERE "id"='observation'`, [value]), /check constraint/i)
  }
  await db.query(`UPDATE "InstagramMedia" SET "views"=4294967296 WHERE "id"='media-a'`)
  await db.query(`INSERT INTO "InstagramPublication" VALUES ('crm-a','business-a','reel-1'),('foreign-crm','business-b','reel-1'),('old-crm','business-a','old-reel')`)
  // Execute the repository's production global-provenance SQL against PostgreSQL semantics.
  const repository = new PrismaInstagramMediaRepository({
    instagramMedia: { async findMany() { return [] }, async count() { return 0 } },
    async $queryRaw(sql: any) { return (await db.query(sql.text, sql.values)).rows }
  })
  const listing = await repository.list({ businessId: 'business-a', accountId: 'account-a' }, { limit: 1, offset: 99, sort: 'views', from: new Date('2100-01-01') })
  assert.deepEqual(listing.items, [])
  assert.deepEqual(listing.linkedPublicationIds, ['crm-a'], 'global provenance ignores list filters but never crosses business/account scope')
  await db.query(`INSERT INTO "InstagramMediaSync" ("id","businessId","accountId","credentialHash","expiresAt")
    VALUES ('opaque-session','business-a','account-a','hash-only',CURRENT_TIMESTAMP)`)
  await db.exec(`DELETE FROM "Business" WHERE "id"='business-a'`)
  assert.equal((await db.query(`SELECT * FROM "InstagramMediaInsight"`)).rows.length, 0)
  assert.equal((await db.query(`SELECT * FROM "InstagramMediaSync"`)).rows.length, 0)
  assert.equal((await db.query(`SELECT * FROM "InstagramMedia" WHERE "businessId"='business-b'`)).rows.length, 1)
  console.log('OK: PGlite migration uniqueness, tenant/account snapshot FK, nullable/zero/large counts, real global provenance SQL and cascades')
} finally { await db.close() }
