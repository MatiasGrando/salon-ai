import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PrismaInstagramCommentWorkerStore } from '../src/services/instagram-comment-worker.js'
const db = new PGlite()
const migration = (name: string) => readFileSync('prisma/migrations/' + name + '/migration.sql', 'utf8')
try {
  await db.exec(`CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "InstagramLead" ("id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL);
    INSERT INTO "Business" VALUES ('a'),('b');`)
  await db.exec(migration('20260913030000_add_instagram_reels_automation'))
  await db.exec(migration('20261024190000_add_instagram_media_insights'))
  await db.exec(`INSERT INTO "InstagramPublication" ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","status","updatedAt")
    VALUES ('pub-a','a','existing-source','video/mp4',1,'legacy','PUBLISHED',CURRENT_TIMESTAMP),('pub-b','b','source','video/mp4',1,'foreign','PUBLISHED',CURRENT_TIMESTAMP);
    INSERT INTO "InstagramCommentAutomation" ("id","businessId","publicationId","privateReplyText","updatedAt")
    VALUES ('auto-a','a','pub-a','legacy private',CURRENT_TIMESTAMP),('auto-b','b','pub-b','other',CURRENT_TIMESTAMP);`)
  const statuses = ['READY', 'CLAIMED', 'SENDING', 'RETRY', 'SENT', 'UNKNOWN', 'FAILED', 'SKIPPED']
  for (const status of statuses) await db.query(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","status","providerMessageId","recipientId","attempts","maxAttempts","availableAt","claimToken","claimedUntil","lastError","sentAt","updatedAt")
    VALUES ($1,'a','pub-a','auto-a',$1,'user','precio','precio',$2,$3,'recipient',2,4,'2026-10-25','owner','2026-10-25','preserved error','2026-10-24','2026-10-24')`,
  [status, status, status === 'SENT' ? 'legacy-dm' : null])
  await db.exec(migration('20261026180000_instagram_comment_actions'))
  const rows = (await db.query<any>(`SELECT * FROM "InstagramCommentAction" ORDER BY "executionId"`)).rows
  assert.equal(rows.length, statuses.length, 'exactly one private action per legacy execution')
  for (const status of statuses) {
    const row = rows.find((r) => r.executionId === status)!
    assert.equal(row.kind, 'PRIVATE_REPLY')
    assert.equal(row.status, status === 'SENDING' ? 'UNKNOWN' : status)
    assert.equal(row.attempts, 2); assert.equal(row.maxAttempts, 4)
    assert.equal(row.claimToken, 'owner'); assert.equal(row.lastError, 'preserved error')
    assert.equal(row.providerMessageId, status === 'SENT' ? 'legacy-dm' : null)
    assert.equal(row.recipientId, 'recipient'); assert.ok(row.sentAt)
  }
  assert.equal((await db.query(`SELECT * FROM "InstagramCommentAction" WHERE "kind"='PUBLIC_REPLY'`)).rows.length, 0)
  const old = (await db.query<any>(`SELECT * FROM "InstagramCommentExecution" WHERE "id"='SENDING'`)).rows[0]
  assert.equal(old.status, 'UNKNOWN'); assert.equal(old.receivedAccountId, null, 'current account never backfills historical evidence')
  const legacyAuto = (await db.query<any>(`SELECT * FROM "InstagramCommentAutomation" WHERE "id"='auto-a'`)).rows[0]
  assert.equal(legacyAuto.privateReplyEnabled, true); assert.equal(legacyAuto.publicReplyEnabled, false)
  await db.exec(`INSERT INTO "InstagramMedia" ("id","businessId","accountId","providerMediaId","lastSyncedAt") VALUES ('media-a','a','professional','provider',CURRENT_TIMESTAMP)`)
  const insertAuto = (id: string, business: string, account: string | null, media: string | null) => db.query(`INSERT INTO "InstagramCommentAutomation"
    ("id","businessId","accountId","mediaId","privateReplyText","updatedAt") VALUES ($1,$2,$3,$4,'',CURRENT_TIMESTAMP)`, [id,business,account,media])
  await insertAuto('imported', 'a', 'professional', 'media-a')
  await assert.rejects(insertAuto('duplicate', 'a', 'professional', 'media-a'), /unique/i)
  await assert.rejects(insertAuto('foreign', 'b', 'professional', 'media-a'), /foreign key/i)
  await assert.rejects(insertAuto('account', 'a', 'other', 'media-a'), /foreign key/i)
  await assert.rejects(insertAuto('missing-pair', 'a', null, 'media-a'), /check constraint/i)
  await assert.rejects(insertAuto('missing-target', 'a', null, null), /check constraint/i)
  const insertExecution = (id: string, business: string, automation: string, publication: string | null) => db.query(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","automationId","publicationId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","receivedAccountId","providerMediaId","updatedAt")
    VALUES ($1,$2,$3,$4,$1,'user','precio','precio','professional','provider',CURRENT_TIMESTAMP)`,[id,business,automation,publication])
  await insertExecution('imported-exec', 'a', 'imported', null)
  await assert.rejects(insertExecution('bad-auto', 'b', 'imported', null), /foreign key/i)
  await assert.rejects(insertExecution('bad-pub', 'a', 'auto-a', 'pub-b'), /foreign key/i)
  const insertAction = (id: string, business: string, execution: string, kind: string) => db.query(`INSERT INTO "InstagramCommentAction"
    ("id","businessId","executionId","kind","body","updatedAt") VALUES ($1,$2,$3,$4,'text',CURRENT_TIMESTAMP)`, [id,business,execution,kind])
  await insertAction('public', 'a', 'imported-exec', 'PUBLIC_REPLY')
  await insertAction('private', 'a', 'imported-exec', 'PRIVATE_REPLY')
  await assert.rejects(insertAction('repeat', 'a', 'imported-exec', 'PUBLIC_REPLY'), /unique/i)
  await assert.rejects(insertAction('cross-tenant', 'b', 'imported-exec', 'PRIVATE_REPLY'), /foreign key/i)
  await assert.rejects(insertAction('invalid-kind', 'a', 'imported-exec', 'UNKNOWN_KIND'), /check constraint/i)
  // Production completion's CAS and transaction run real SQL. PGlite serializes
  // sessions; precommitted B ownership models a displaced A, not concurrent PG.
  await db.exec(`UPDATE "InstagramCommentAction" SET "status"='SENDING',"claimToken"='owner-b' WHERE "id"='public';
    UPDATE "InstagramCommentAction" SET "status"='SENDING',"claimToken"='owner-private' WHERE "id"='private'`)
  let leadCalls = 0
  const repository = new PrismaInstagramCommentWorkerStore({
    async $transaction(callback: any) {
      return db.transaction(async (sql) => callback({
        instagramCommentAction: { async updateMany({ where, data }: any) {
          const result = await sql.query(`UPDATE "InstagramCommentAction" SET "status"=$5,"providerMessageId"=$6
            WHERE "id"=$1 AND "businessId"=$2 AND "claimToken"=$3 AND "status"=$4 RETURNING "id"`,
          [where.id,where.businessId,where.claimToken,where.status,data.status,data.providerMessageId])
          return { count: result.rows.length }
        } },
        instagramLead: { async upsert() { leadCalls++; await sql.query(`INSERT INTO "InstagramLead" VALUES ('created-lead','a')`); return { id: 'created-lead' } } },
        instagramMessage: { async create() { throw new Error('message persistence failed') } }
      }))
    }
  } as any)
  const execution = { id: 'public', businessId: 'a', executionId: 'imported-exec', kind: 'PUBLIC_REPLY' as const, claimToken: 'owner-a', attempts: 1,
    maxAttempts: 5, providerCommentId: 'comment', commenterInstagramUserId: 'user', commenterUsername: null, commentText: 'precio' }
  const completion = { execution, publicationId: null, automationId: 'imported', body: 'Publica', providerMessageId: 'reply', recipientId: null }
  assert.equal(await repository.completeSent(completion), false)
  assert.equal((await db.query<any>(`SELECT "status","claimToken" FROM "InstagramCommentAction" WHERE "id"='public'`)).rows[0].claimToken, 'owner-b')
  assert.equal(await repository.completeSent({ ...completion, execution: { ...execution, claimToken: 'owner-b' } }), true)
  assert.equal(leadCalls, 0, 'public CAS never invokes private persistence')
  await assert.rejects(() => repository.completeSent({ ...completion, execution: { ...execution, id: 'private', kind: 'PRIVATE_REPLY', claimToken: 'owner-private' } }), /persistence failed/)
  assert.equal((await db.query<any>(`SELECT "status" FROM "InstagramCommentAction" WHERE "id"='private'`)).rows[0].status, 'SENDING', 'failed private transaction rolls back SENT before worker marks UNKNOWN')
  assert.equal((await db.query(`SELECT * FROM "InstagramLead" WHERE "id"='created-lead'`)).rows.length, 0)
  await db.exec(`DELETE FROM "InstagramMedia" WHERE "id"='media-a'`)
  assert.equal((await db.query(`SELECT * FROM "InstagramCommentAction" WHERE "executionId"='imported-exec'`)).rows.length, 0)
  assert.equal((await db.query(`SELECT * FROM "InstagramCommentAction" WHERE "executionId"='SENT'`)).rows.length, 1, 'unrelated legacy evidence survives imported target deletion')
  console.log('OK: actual PGlite migration legacy status/evidence matrix, target/FK constraints, fenced completion and private transaction rollback')
} finally { await db.close() }
