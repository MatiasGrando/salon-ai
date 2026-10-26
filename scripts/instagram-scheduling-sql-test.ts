import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH = '__instagram_schedule_no_dotenv__'
const { PrismaInstagramPublicationRepository } = await import('../src/services/instagram-publication-service.js')
const { PrismaInstagramPublicationWorkerRepository } = await import('../src/services/instagram-publication-worker.js')
const { PrismaInstagramVideoRetentionRepository } = await import('../src/services/instagram-video-retention-worker.js')
const db = new PGlite()
const now = new Date('2026-10-26T12:00:00Z')
try {
  await db.exec(`CREATE TABLE "Business" ("id" TEXT PRIMARY KEY, "timezone" TEXT);
    CREATE TABLE "InstagramLead" ("id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL);
    CREATE TABLE "BusinessInstagramConfig" ("id" TEXT PRIMARY KEY,"businessId" TEXT UNIQUE,"instagramAccountId" TEXT,"apiAccountId" TEXT,"accessToken" TEXT,"enabled" BOOLEAN);
    INSERT INTO "Business" VALUES ('a','America/Argentina/Buenos_Aires'),('b','UTC');
    INSERT INTO "BusinessInstagramConfig" VALUES ('config-a','a','professional-a','app-a','fake-token',true);`)
  await db.exec(readFileSync('prisma/migrations/20260913030000_add_instagram_reels_automation/migration.sql', 'utf8'))
  await db.exec(readFileSync('prisma/migrations/20260914230000_add_instagram_video_deleted_at/migration.sql', 'utf8'))
  await db.exec(`INSERT INTO "InstagramPublication" ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","updatedAt")
    VALUES ('legacy','a','a/source.mp4','video/mp4',100,'Legacy',CURRENT_TIMESTAMP)`)
  await db.exec(readFileSync('prisma/migrations/20261026220000_instagram_publication_schedule/migration.sql', 'utf8'))
  const legacy: any = (await db.query(`SELECT * FROM "InstagramPublication" WHERE "id"='legacy'`)).rows[0]
  assert.equal(legacy.revision, 0); assert.equal(legacy.scheduledAt, null); assert.equal(legacy.destinationInstagramAccountId, null)
  for (const patch of [`"revision"=-1`, `"scheduledAt"=CURRENT_TIMESTAMP`, `"destinationApiAccountId"='one-sided'`, `"status"='SCHEDULED'`]) {
    await assert.rejects(db.exec(`UPDATE "InstagramPublication" SET ${patch} WHERE "id"='legacy'`), /check constraint/i)
  }
  // Translate the actual repository predicates to SQL; no second scheduler/policy.
  function predicate(where: any, values: any[]): string {
    return Object.entries(where).map(([key, value]: [string, any]) => {
      if (key === 'OR' || key === 'AND') return '(' + value.map((part: any) => predicate(part, values)).join(key === 'OR' ? ' OR ' : ' AND ') + ')'
      assert.match(key, /^[A-Za-z]+$/)
      if (value === null) return '"' + key + '" IS NULL'
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return '(' + value.in.map((part: any) => predicate({ [key]: part }, values)).join(' OR ') + ')'
        const [operator, bound] = Object.entries(value)[0]!
        assert.ok(['lte', 'gt'].includes(operator)); values.push(bound instanceof Date ? bound.toISOString() : bound)
        return '"' + key + '"' + (operator === 'lte' ? '<=' : '>') + '$' + values.length
      }
      values.push(value instanceof Date ? value.toISOString() : value)
      return '"' + key + '"=$' + values.length
    }).join(' AND ') || 'TRUE'
  }
  const hydrate = (row: any) => row ? { ...row, automation: { enabled: true, privateReplyText: 'Info', keywords: [] } } : null
  let selectedRace: ((sql: any) => Promise<void>) | null = null
  const client: any = { $transaction: (callback: Function) => db.transaction(async (sql) => callback(makeClient(sql))) }
  function makeClient(sql: any): any {
    async function find({ where }: any) {
      const values: any[] = []; const filter = predicate(where, values)
      const row = hydrate((await sql.query('SELECT * FROM "InstagramPublication" WHERE ' + filter + ' ORDER BY "createdAt" LIMIT 1', values)).rows[0])
      if (selectedRace) { const race = selectedRace; selectedRace = null; await race(sql) }
      return row
    }
    return { ...client, $queryRawUnsafe: (text: string, ...values: any[]) => sql.query(text, values),
      business: { async findUnique() { return { timezone: 'America/Argentina/Buenos_Aires', instagramConfig: (await sql.query(`SELECT * FROM "BusinessInstagramConfig" WHERE "businessId"='a'`)).rows[0] } } },
      businessInstagramConfig: { async findUnique() { return (await sql.query(`SELECT * FROM "BusinessInstagramConfig" WHERE "businessId"='a'`)).rows[0] } },
      instagramPublication: { findFirst: find, findFirstOrThrow: find, findUnique: find,
        async updateMany({ where, data }: any) {
          const values: any[] = []
          const setters = Object.entries(data).map(([key, value]: [string, any]) => {
            assert.match(key, /^[A-Za-z]+$/)
            if (value && typeof value === 'object' && 'increment' in value) { values.push(value.increment); return '"' + key + '"="' + key + '"+$' + values.length }
            values.push(value instanceof Date ? value.toISOString() : value); return '"' + key + '"=$' + values.length
          })
          const filter = predicate(where, values)
          return { count: (await sql.query('UPDATE "InstagramPublication" SET ' + setters.join(',') + ' WHERE ' + filter + ' RETURNING "id"', values)).rows.length }
        }
      } }
  }
  Object.assign(client, makeClient(db))
  const repository = new PrismaInstagramPublicationRepository(client, () => now)
  const worker = new PrismaInstagramPublicationWorkerRepository(client, ['a'], () => now)
  const get = () => repository.findByBusinessAndId('a', 'legacy')
  assert.equal(await repository.changeSchedule({ businessId: 'b', id: 'legacy', expectedRevision: 0, scheduledAt: new Date(+now + 60_000) }), null)
  await repository.changeSchedule({ businessId: 'a', id: 'legacy', expectedRevision: 0, scheduledAt: new Date(+now + 60_000) })
  assert.equal((await get())?.status, 'SCHEDULED')
  assert.equal(await repository.changeSchedule({ businessId: 'a', id: 'legacy', expectedRevision: 0, scheduledAt: null }), null)
  assert.equal(await worker.claimNext({ now, leaseUntil: new Date(+now + 60_000), claimToken: 'early' }), null)
  // Real SQL final-CAS sees a row changed after its selection in this transaction.
  for (const race of ['reprogram', 'cancel']) {
    await db.exec(`UPDATE "InstagramPublication" SET "status"='SCHEDULED',"scheduledAt"='2026-10-26T12:00:00Z',"availableAt"='2026-10-26T12:00:00Z',"claimToken"=NULL,"claimedUntil"=NULL WHERE "id"='legacy'`)
    selectedRace = async (sql) => {
      await sql.exec(`UPDATE "InstagramPublication" SET "revision"="revision"+1, ${race === 'cancel' ? `"status"='CANCELLED'` : `"scheduledAt"='2026-10-27T12:00:00Z',"availableAt"='2026-10-27T12:00:00Z'`} WHERE "id"='legacy'`)
    }
    assert.equal(await worker.claimNext({ now, leaseUntil: new Date(+now + 60_000), claimToken: 'stale' }), null)
    assert.equal((await db.query<any>(`SELECT "claimToken" FROM "InstagramPublication" WHERE "id"='legacy'`)).rows[0].claimToken, null)
  }
  await db.exec(`UPDATE "InstagramPublication" SET "status"='SCHEDULED',"scheduledAt"='2026-10-26T12:00:00Z',"availableAt"='2026-10-26T12:00:00Z' WHERE "id"='legacy'`)
  assert.ok(await worker.claimNext({ now, leaseUntil: new Date(+now + 60_000), claimToken: 'owner' }))
  assert.equal(await repository.changeSchedule({ businessId: 'a', id: 'legacy', expectedRevision: (await get())!.revision!, scheduledAt: null }), null)
  await db.exec(`UPDATE "InstagramPublication" SET "claimedUntil"='2026-10-26T12:00:00Z' WHERE "id"='legacy'`)
  assert.equal(await worker.prepareDispatch({ businessId: 'a', id: 'legacy', claimToken: 'owner', leaseMs: 60_000 }), null)
  assert.equal(await worker.transition({ id: 'legacy', claimToken: 'owner', from: 'SCHEDULED', to: 'CREATING_CONTAINER', patch: {} }), false)
  await db.exec(`UPDATE "InstagramPublication" SET "status"='CANCELLED',"claimToken"=NULL,"claimedUntil"=NULL WHERE "id"='legacy'`)
  await repository.reserveVideoDeletion({ businessId: 'a', id: 'legacy' })
  assert.equal(await repository.changeSchedule({ businessId: 'a', id: 'legacy', expectedRevision: (await get())!.revision!, scheduledAt: new Date(+now + 60_000) }), null)
  assert.equal((await get())?.videoDeletedAt, null)
  // Retention uses actual publication time, never desired scheduledAt.
  const retention = new PrismaInstagramVideoRetentionRepository(client, ['a'])
  for (const status of ['SCHEDULED', 'CANCELLED', 'READY', 'CREATING_CONTAINER', 'PROCESSING', 'UNKNOWN', 'FAILED']) {
    await db.query(`UPDATE "InstagramPublication" SET "status"=$1,"publishedAt"='2026-10-24T12:00:00Z' WHERE "id"='legacy'`, [status])
    assert.equal(await retention.claimNext({ now, cutoff: new Date(+now - 86_400_000), leaseUntil: new Date(+now + 60_000), claimToken: 'retention' }), null)
  }
  await db.exec(`UPDATE "InstagramPublication" SET "status"='PUBLISHED',"publishedAt"='2026-10-25T12:00:00.001Z' WHERE "id"='legacy'`)
  assert.equal(await retention.claimNext({ now, cutoff: new Date(+now - 86_400_000), leaseUntil: new Date(+now + 60_000), claimToken: 'retention' }), null)
  await db.exec(`UPDATE "InstagramPublication" SET "publishedAt"='2026-10-25T12:00:00Z' WHERE "id"='legacy'`)
  assert.ok(await retention.claimNext({ now, cutoff: new Date(+now - 86_400_000), leaseUntil: new Date(+now + 60_000), claimToken: 'retention' }))
  console.log('OK: actual additive schedule migration, legacy nulls/checks, production tenant/revision/due/lease/deletion CAS and retention SQL')
} finally { await db.close() }
