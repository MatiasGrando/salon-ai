import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH = '__instagram_catalogue_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/instagram_contract'
const { PrismaInstagramMediaRepository } = await import('../src/services/prisma-instagram-media-repository.js')
const { emptyInsights } = await import('../src/services/instagram-media-domain.js')
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
  await db.exec(`CREATE TABLE "BusinessInstagramConfig" ("businessId" TEXT PRIMARY KEY, "instagramAccountId" TEXT, "accessToken" TEXT);
    INSERT INTO "BusinessInstagramConfig" VALUES ('business-a','account-a','fixture-token');`)
  // PGlite serializes transactions. A stale read models A's prior validation while
  // B's claim is already committed; the final predicate and rollback execute real SQL.
  for (const continuing of [true, false]) for (const displaced of [true, false]) {
    const id = 'sql-fence-' + Number(continuing) + '-' + Number(displaced)
    await db.query(`INSERT INTO "InstagramMediaSync" ("id","businessId","accountId","credentialHash","expiresAt","claimToken","claimUntil")
      VALUES ($1,'business-a','account-a','hash-only','2100-01-01',$2,'2100-01-01')`, [id, displaced ? 'owner-b' : 'owner-a'])
    const repository = new PrismaInstagramMediaRepository({
      async $transaction(callback: any) {
        return db.transaction(async (sql) => {
          const rowCount = async (statement: string, parameters: any[]) => ({ count: (await sql.query(statement, parameters)).rows.length })
          const ownerParameters = (where: any) => [where.id, where.businessId, where.accountId, where.claimToken, where.expiresAt.gt.toISOString(), where.claimUntil.gt.toISOString()]
          const ownerPredicate = `"id"=$1 AND "businessId"=$2 AND "accountId"=$3 AND "claimToken"=$4 AND "expiresAt">$5 AND "claimUntil">$6`
          return callback({
            async $queryRaw(query: any) { return (await sql.query(query.text, query.values)).rows },
            instagramMediaSync: {
              async findUnique() { return { ...(await sql.query<Record<string, unknown>>(`SELECT * FROM "InstagramMediaSync" WHERE "id"=$1`, [id])).rows[0], claimToken: 'owner-a' } },
              async updateMany({ where, data }: any) { return rowCount(`UPDATE "InstagramMediaSync" SET "after"=$7,"seenCursors"=array_append("seenCursors",$7),"claimToken"=NULL,"claimUntil"=NULL WHERE ${ownerPredicate} RETURNING "id"`, [...ownerParameters(where), data.after]) },
              async deleteMany({ where }: any) { return rowCount(`DELETE FROM "InstagramMediaSync" WHERE ${ownerPredicate} RETURNING "id"`, ownerParameters(where)) }
            },
            instagramMedia: {
              async findUnique() { return null },
              async upsert({ create }: any) {
                await sql.query(`INSERT INTO "InstagramMedia" ("id","businessId","accountId","providerMediaId","lastSyncedAt") VALUES ($1,$2,$3,$1,$4)`, [id, create.businessId, create.accountId, create.lastSyncedAt.toISOString()])
                return { id, metricObservedAt: {} }
              },
              async update({ data }: any) { await sql.query(`UPDATE "InstagramMedia" SET "reach"=$2 WHERE "id"=$1`, [id, data.reach]) }
            },
            instagramMediaInsight: {
              async create({ data }: any) {
                await sql.query(`INSERT INTO "InstagramMediaInsight" ("id","businessId","accountId","mediaId","observedAt","apiVersion","status","reach") VALUES ($1,$2,$3,$1,$4,$5,$6,$7)`, [id, data.businessId, data.accountId, data.observedAt.toISOString(), data.apiVersion, data.status, data.reach])
              }
            }
          })
        })
      }
    })
    const time = new Date('2026-10-25T10:00:00Z')
    const commit = () => repository.commit({ connection: { businessId: 'business-a', accountId: 'account-a', accessToken: 'fixture-token' },
      claim: { id, after: null, claimToken: 'owner-a' }, media: [{ providerMediaId: id, caption: null, mediaType: 'VIDEO', mediaProductType: 'REELS', permalink: null, thumbnailUrl: null, publishedAt: null }],
      metadataObservedAt: time, observations: [{ providerMediaId: id, observedAt: time, apiVersion: 'v25.0', status: 'partial', errorCode: null, periods: { views: null, reach: 'lifetime', likes: null, comments: null, shares: null, saved: null, total_interactions: null }, values: { ...emptyInsights(), reach: 0 } }],
      nextCursor: continuing ? 'next-page' : null, now: time })
    if (displaced) await assert.rejects(commit(), /continuacion/)
    else await commit()
    const session = (await db.query<{ claimToken: string | null; after: string | null }>(`SELECT "claimToken","after" FROM "InstagramMediaSync" WHERE "id"=$1`, [id])).rows[0]
    assert.equal(session?.claimToken, displaced ? 'owner-b' : continuing ? null : undefined)
    assert.equal(session?.after, displaced ? null : continuing ? 'next-page' : undefined)
    assert.equal((await db.query(`SELECT * FROM "InstagramMedia" WHERE "id"=$1`, [id])).rows.length, displaced ? 0 : 1)
    assert.equal((await db.query(`SELECT * FROM "InstagramMediaInsight" WHERE "id"=$1`, [id])).rows.length, displaced ? 0 : 1)
  }
  console.log('OK: PGlite executes final-owner predicates and whole-page rollback for both page types, with owned positive controls')
  await db.query(`INSERT INTO "InstagramMediaSync" ("id","businessId","accountId","credentialHash","expiresAt")
    VALUES ('opaque-session','business-a','account-a','hash-only',CURRENT_TIMESTAMP)`)
  await db.exec(`DELETE FROM "Business" WHERE "id"='business-a'`)
  assert.equal((await db.query(`SELECT * FROM "InstagramMediaInsight"`)).rows.length, 0)
  assert.equal((await db.query(`SELECT * FROM "InstagramMediaSync"`)).rows.length, 0)
  assert.equal((await db.query(`SELECT * FROM "InstagramMedia" WHERE "businessId"='business-b'`)).rows.length, 1)
  console.log('OK: PGlite migration uniqueness, tenant/account snapshot FK, nullable/zero/large counts, real global provenance SQL and cascades')
} finally { await db.close() }
