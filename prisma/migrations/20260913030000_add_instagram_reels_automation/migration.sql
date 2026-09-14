CREATE TYPE "InstagramPublicationStatus" AS ENUM (
  'DRAFT',
  'READY',
  'CREATING_CONTAINER',
  'PROCESSING',
  'PUBLISHING',
  'PUBLISHED',
  'UNKNOWN',
  'FAILED'
);

CREATE TYPE "InstagramCommentExecutionStatus" AS ENUM (
  'READY',
  'CLAIMED',
  'SENDING',
  'RETRY',
  'SENT',
  'UNKNOWN',
  'FAILED',
  'SKIPPED'
);

CREATE UNIQUE INDEX "InstagramLead_businessId_id_key"
ON "InstagramLead"("businessId", "id");

CREATE TABLE "InstagramPublication" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "videoObjectPath" TEXT NOT NULL,
  "videoMimeType" TEXT NOT NULL,
  "videoSizeBytes" INTEGER NOT NULL,
  "caption" TEXT NOT NULL,
  "shareToFeed" BOOLEAN NOT NULL DEFAULT true,
  "status" "InstagramPublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "metaContainerId" TEXT,
  "metaMediaId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimToken" TEXT,
  "claimedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramCommentAutomation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "privateReplyText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramCommentAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramAutomationKeyword" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstagramAutomationKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramCommentExecution" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "leadId" TEXT,
  "providerCommentId" TEXT NOT NULL,
  "commenterInstagramUserId" TEXT NOT NULL,
  "commenterUsername" TEXT,
  "commentText" TEXT NOT NULL,
  "matchedKeyword" TEXT NOT NULL,
  "status" "InstagramCommentExecutionStatus" NOT NULL DEFAULT 'READY',
  "providerMessageId" TEXT,
  "recipientId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimToken" TEXT,
  "claimedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramCommentExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramPublication_businessId_id_key" ON "InstagramPublication"("businessId", "id");
CREATE UNIQUE INDEX "InstagramPublication_businessId_metaContainerId_key" ON "InstagramPublication"("businessId", "metaContainerId");
CREATE UNIQUE INDEX "InstagramPublication_businessId_metaMediaId_key" ON "InstagramPublication"("businessId", "metaMediaId");
CREATE INDEX "InstagramPublication_status_availableAt_idx" ON "InstagramPublication"("status", "availableAt");
CREATE INDEX "InstagramPublication_businessId_createdAt_idx" ON "InstagramPublication"("businessId", "createdAt");
CREATE INDEX "InstagramPublication_claimedUntil_idx" ON "InstagramPublication"("claimedUntil");

CREATE UNIQUE INDEX "InstagramCommentAutomation_businessId_publicationId_key" ON "InstagramCommentAutomation"("businessId", "publicationId");
CREATE UNIQUE INDEX "InstagramCommentAutomation_businessId_id_key" ON "InstagramCommentAutomation"("businessId", "id");
CREATE UNIQUE INDEX "InstagramCommentAutomation_businessId_publicationId_id_key" ON "InstagramCommentAutomation"("businessId", "publicationId", "id");
CREATE INDEX "InstagramCommentAutomation_businessId_enabled_idx" ON "InstagramCommentAutomation"("businessId", "enabled");

CREATE UNIQUE INDEX "IgAutomationKeyword_scope_normalized_key" ON "InstagramAutomationKeyword"("businessId", "automationId", "normalizedValue");
CREATE INDEX "InstagramAutomationKeyword_businessId_normalizedValue_idx" ON "InstagramAutomationKeyword"("businessId", "normalizedValue");

CREATE UNIQUE INDEX "InstagramCommentExecution_businessId_providerCommentId_key" ON "InstagramCommentExecution"("businessId", "providerCommentId");
CREATE UNIQUE INDEX "InstagramCommentExecution_businessId_providerMessageId_key" ON "InstagramCommentExecution"("businessId", "providerMessageId");
CREATE INDEX "InstagramCommentExecution_status_availableAt_idx" ON "InstagramCommentExecution"("status", "availableAt");
CREATE INDEX "IgCommentExecution_publication_received_idx" ON "InstagramCommentExecution"("businessId", "publicationId", "receivedAt");
CREATE INDEX "IgCommentExecution_commenter_received_idx" ON "InstagramCommentExecution"("businessId", "commenterInstagramUserId", "receivedAt");
CREATE INDEX "InstagramCommentExecution_claimedUntil_idx" ON "InstagramCommentExecution"("claimedUntil");

ALTER TABLE "InstagramPublication"
ADD CONSTRAINT "InstagramPublication_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentAutomation"
ADD CONSTRAINT "InstagramCommentAutomation_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentAutomation"
ADD CONSTRAINT "InstagramCommentAutomation_businessId_publicationId_fkey"
FOREIGN KEY ("businessId", "publicationId") REFERENCES "InstagramPublication"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramAutomationKeyword"
ADD CONSTRAINT "InstagramAutomationKeyword_businessId_automationId_fkey"
FOREIGN KEY ("businessId", "automationId") REFERENCES "InstagramCommentAutomation"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentExecution"
ADD CONSTRAINT "InstagramCommentExecution_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentExecution"
ADD CONSTRAINT "InstagramCommentExecution_businessId_publicationId_fkey"
FOREIGN KEY ("businessId", "publicationId") REFERENCES "InstagramPublication"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentExecution"
ADD CONSTRAINT "IgCommentExecution_scope_automation_fkey"
FOREIGN KEY ("businessId", "publicationId", "automationId") REFERENCES "InstagramCommentAutomation"("businessId", "publicationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentExecution"
ADD CONSTRAINT "InstagramCommentExecution_businessId_leadId_fkey"
FOREIGN KEY ("businessId", "leadId") REFERENCES "InstagramLead"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
