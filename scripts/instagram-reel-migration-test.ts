import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
try {
  await db.exec(`
    CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "BusinessInstagramConfig" (
      "id" TEXT PRIMARY KEY,
      "businessId" TEXT NOT NULL UNIQUE,
      "instagramAccountId" TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE
    );
    CREATE TABLE "InstagramLead" (
      "id" TEXT PRIMARY KEY,
      "businessId" TEXT NOT NULL,
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE
    );
    INSERT INTO "Business" ("id") VALUES ('business-a'), ('business-b');
    INSERT INTO "InstagramLead" ("id", "businessId") VALUES ('lead-a', 'business-a'), ('lead-b', 'business-b');
  `)

  await db.exec(readFileSync('prisma/migrations/20260913030000_add_instagram_reels_automation/migration.sql', 'utf8'))
  await db.exec(readFileSync('prisma/migrations/20260914180000_add_instagram_client_app_secret/migration.sql', 'utf8'))

  await db.exec(`INSERT INTO "BusinessInstagramConfig"
    ("id","businessId","instagramAccountId","appSecret","updatedAt")
    VALUES ('instagram-config-a','business-a','ig-business-a','0123456789abcdef0123456789abcdef',CURRENT_TIMESTAMP)`)
  const secretConfig = await db.query<{ appSecret: string }>(
    `SELECT "appSecret" FROM "BusinessInstagramConfig" WHERE "businessId"='business-a'`
  )
  assert.equal(secretConfig.rows[0]?.appSecret, '0123456789abcdef0123456789abcdef')

  await db.exec(`INSERT INTO "InstagramPublication"
    ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","updatedAt")
    VALUES ('publication-a','business-a','business-a/reel.mp4','video/mp4',123,'Hola',CURRENT_TIMESTAMP)`)
  await db.exec(`INSERT INTO "InstagramCommentAutomation"
    ("id","businessId","publicationId","privateReplyText","updatedAt")
    VALUES ('automation-a','business-a','publication-a','Te escribo por privado',CURRENT_TIMESTAMP)`)
  await db.exec(`INSERT INTO "InstagramAutomationKeyword"
    ("id","businessId","automationId","value","normalizedValue")
    VALUES ('keyword-a','business-a','automation-a','Precio','precio')`)
  await db.exec(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","leadId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","updatedAt")
    VALUES ('execution-a','business-a','publication-a','automation-a','lead-a','comment-1','user-1','precio','precio',CURRENT_TIMESTAMP)`)

  await db.exec(`INSERT INTO "InstagramPublication"
    ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","updatedAt")
    VALUES ('publication-a-other','business-a','business-a/other.mp4','video/mp4',321,'Otra',CURRENT_TIMESTAMP)`)
  await assert.rejects(db.exec(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","updatedAt")
    VALUES ('execution-wrong-automation','business-a','publication-a-other','automation-a','comment-wrong','user-1','precio','precio',CURRENT_TIMESTAMP)`), /foreign key/i)

  await assert.rejects(db.exec(`INSERT INTO "InstagramCommentAutomation"
    ("id","businessId","publicationId","privateReplyText","updatedAt")
    VALUES ('automation-duplicate','business-a','publication-a','Otra',CURRENT_TIMESTAMP)`), /unique/i)
  await assert.rejects(db.exec(`INSERT INTO "InstagramAutomationKeyword"
    ("id","businessId","automationId","value","normalizedValue")
    VALUES ('keyword-duplicate','business-a','automation-a','PRECIO','precio')`), /unique/i)
  await assert.rejects(db.exec(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","updatedAt")
    VALUES ('execution-duplicate','business-a','publication-a','automation-a','comment-1','user-1','precio','precio',CURRENT_TIMESTAMP)`), /unique/i)

  await assert.rejects(db.exec(`INSERT INTO "InstagramCommentAutomation"
    ("id","businessId","publicationId","privateReplyText","updatedAt")
    VALUES ('automation-cross','business-b','publication-a','No debe entrar',CURRENT_TIMESTAMP)`), /foreign key/i)
  await assert.rejects(db.exec(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","leadId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","updatedAt")
    VALUES ('execution-cross','business-a','publication-a','automation-a','lead-b','comment-2','user-2','precio','precio',CURRENT_TIMESTAMP)`), /foreign key/i)

  await db.exec(`INSERT INTO "InstagramPublication"
    ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","metaMediaId","updatedAt")
    VALUES ('publication-b','business-b','business-b/reel.mp4','video/mp4',456,'Hola','media-1',CURRENT_TIMESTAMP)`)
  await db.exec(`INSERT INTO "InstagramCommentAutomation"
    ("id","businessId","publicationId","privateReplyText","updatedAt")
    VALUES ('automation-b','business-b','publication-b','Te escribo',CURRENT_TIMESTAMP)`)
  await db.exec(`INSERT INTO "InstagramCommentExecution"
    ("id","businessId","publicationId","automationId","leadId","providerCommentId","commenterInstagramUserId","commentText","matchedKeyword","updatedAt")
    VALUES ('execution-b','business-b','publication-b','automation-b','lead-b','comment-1','user-1','precio','precio',CURRENT_TIMESTAMP)`)
  await db.exec(`INSERT INTO "InstagramPublication"
    ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","metaMediaId","updatedAt")
    VALUES ('publication-a-2','business-a','business-a/reel-2.mp4','video/mp4',456,'Hola','media-1',CURRENT_TIMESTAMP)`)
  await assert.rejects(db.exec(`INSERT INTO "InstagramPublication"
    ("id","businessId","videoObjectPath","videoMimeType","videoSizeBytes","caption","metaMediaId","updatedAt")
    VALUES ('publication-a-3','business-a','business-a/reel-3.mp4','video/mp4',456,'Hola','media-1',CURRENT_TIMESTAMP)`), /unique/i)

  await db.exec(`DELETE FROM "InstagramPublication" WHERE "id"='publication-a'`)
  const remaining = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "InstagramCommentExecution" WHERE "businessId"='business-a'`)
  assert.equal(remaining.rows[0]?.count, 0, 'publication cascade must remove its automation, keywords and executions')
  const otherTenant = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "InstagramCommentExecution" WHERE "businessId"='business-b'`)
  assert.equal(otherTenant.rows[0]?.count, 1, 'the same provider comment id is isolated per business')

  console.log('Instagram Reel migration contract: OK')
} finally {
  await db.close()
}
