-- Stop/drain all old comment workers before applying; they claim execution rows.
-- This migration never infers a historical account from today's credentials.
ALTER TABLE "InstagramCommentAutomation"
  ALTER COLUMN "publicationId" DROP NOT NULL,
  ADD COLUMN "accountId" TEXT,
  ADD COLUMN "mediaId" TEXT,
  ADD COLUMN "privateReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicReplyText" TEXT NOT NULL DEFAULT '',
  ADD CONSTRAINT "IgAutomation_target_check" CHECK ("publicationId" IS NOT NULL OR "mediaId" IS NOT NULL),
  ADD CONSTRAINT "IgAutomation_media_pair_check" CHECK (("accountId" IS NULL) = ("mediaId" IS NULL)),
  ADD CONSTRAINT "IgAutomation_media_fkey" FOREIGN KEY ("businessId", "accountId", "mediaId")
    REFERENCES "InstagramMedia"("businessId", "accountId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "IgAutomation_media_key" ON "InstagramCommentAutomation"("businessId", "accountId", "mediaId");
ALTER TABLE "InstagramCommentExecution"
  ALTER COLUMN "publicationId" DROP NOT NULL,
  ADD COLUMN "receivedAccountId" TEXT,
  ADD COLUMN "providerMediaId" TEXT,
  ADD CONSTRAINT "IgExecution_automation_fkey" FOREIGN KEY ("businessId", "automationId")
    REFERENCES "InstagramCommentAutomation"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "InstagramCommentExecution_businessId_id_key" ON "InstagramCommentExecution"("businessId", "id");
CREATE TABLE "InstagramCommentAction" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('PRIVATE_REPLY', 'PUBLIC_REPLY')),
  "body" TEXT NOT NULL,
  "status" "InstagramCommentExecutionStatus" NOT NULL DEFAULT 'READY',
  "providerMessageId" TEXT,
  "recipientId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimToken" TEXT,
  "claimedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IgAction_execution_fkey" FOREIGN KEY ("businessId", "executionId")
    REFERENCES "InstagramCommentExecution"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IgAction_execution_kind_key" ON "InstagramCommentAction"("businessId", "executionId", "kind");
CREATE INDEX "IgAction_status_available_idx" ON "InstagramCommentAction"("status", "availableAt");
INSERT INTO "InstagramCommentAction" (
  "id", "businessId", "executionId", "kind", "body", "status", "providerMessageId", "recipientId",
  "attempts", "maxAttempts", "availableAt", "claimToken", "claimedUntil", "lastError", "sentAt", "createdAt", "updatedAt"
)
SELECT 'legacy-private-' || e."id", e."businessId", e."id", 'PRIVATE_REPLY', a."privateReplyText",
  CASE WHEN e."status" = 'SENDING' THEN 'UNKNOWN'::"InstagramCommentExecutionStatus" ELSE e."status" END,
  e."providerMessageId", e."recipientId", e."attempts", e."maxAttempts", e."availableAt", e."claimToken",
  CASE WHEN e."status" = 'SENDING' THEN NULL ELSE e."claimedUntil" END,
  e."lastError", e."sentAt", e."createdAt", e."updatedAt"
FROM "InstagramCommentExecution" e JOIN "InstagramCommentAutomation" a ON a."businessId"=e."businessId" AND a."id"=e."automationId";
UPDATE "InstagramCommentExecution" SET "status"='UNKNOWN', "claimedUntil"=NULL WHERE "status"='SENDING';
