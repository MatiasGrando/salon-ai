CREATE TYPE "PipelineActorKind" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "LeadCaptureFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');
CREATE TYPE "FormSubmissionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "LeadRewardType" AS ENUM ('FILE', 'LINK', 'DISCOUNT', 'TEXT');

ALTER TABLE "BusinessFeatureSettings"
ADD COLUMN "leadCaptureFormsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PipelineLead"
ADD COLUMN "customData" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "customDataSchemaVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PipelineLeadEvent"
ADD COLUMN "actorKind" "PipelineActorKind";

UPDATE "PipelineLeadEvent"
SET "actorKind" = 'USER'
WHERE "actorKind" IS NULL;

ALTER TABLE "PipelineLeadEvent"
ALTER COLUMN "actorKind" SET DEFAULT 'USER',
ALTER COLUMN "actorKind" SET NOT NULL,
ALTER COLUMN "actorUserId" DROP NOT NULL;

ALTER TABLE "PipelineLeadEvent"
ADD CONSTRAINT "PipelineLeadEvent_actor_shape_check"
CHECK (
  ("actorKind" = 'USER' AND "actorUserId" IS NOT NULL)
  OR ("actorKind" = 'SYSTEM' AND "actorUserId" IS NULL)
);

CREATE UNIQUE INDEX "PipelineStage_businessId_pipelineId_id_key"
ON "PipelineStage"("businessId", "pipelineId", "id");

CREATE TABLE "LeadCaptureForm" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "initialStageId" TEXT NOT NULL,
  "defaultAssigneeUserId" TEXT,
  "publicSlug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "LeadCaptureFormStatus" NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fields" JSONB NOT NULL DEFAULT '[]',
  "successTitle" TEXT,
  "successMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadCaptureForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormSubmission" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "leadId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "status" "FormSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "answers" JSONB NOT NULL,
  "attribution" JSONB,
  "contactName" TEXT,
  "normalizedEmail" TEXT,
  "normalizedPhone" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FormSubmission_accepted_requires_lead_check"
    CHECK ("status" <> 'ACCEPTED' OR ("leadId" IS NOT NULL AND "acceptedAt" IS NOT NULL))
);

CREATE TABLE "FormReward" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "LeadRewardType" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "payloadEncrypted" TEXT,
  "objectPath" TEXT,
  "expiresInMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormReward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FormReward_expiry_check" CHECK ("expiresInMinutes" IS NULL OR "expiresInMinutes" > 0),
  CONSTRAINT "FormReward_file_shape_check" CHECK ("type" <> 'FILE' OR "objectPath" IS NOT NULL)
);

CREATE TABLE "RewardClaim" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "accessVersion" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "firstAccessAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardClaim_access_count_check" CHECK ("accessCount" >= 0),
  CONSTRAINT "RewardClaim_access_version_check" CHECK ("accessVersion" > 0)
);

CREATE TABLE "PublicFormRateLimitBucket" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicFormRateLimitBucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicFormRateLimitBucket_count_check" CHECK ("count" >= 0)
);

CREATE UNIQUE INDEX "LeadCaptureForm_businessId_id_key" ON "LeadCaptureForm"("businessId", "id");
CREATE UNIQUE INDEX "LeadCaptureForm_businessId_publicSlug_version_key" ON "LeadCaptureForm"("businessId", "publicSlug", "version");
CREATE UNIQUE INDEX "LeadCaptureForm_one_published_slug_key"
ON "LeadCaptureForm"("businessId", "publicSlug") WHERE "status" = 'PUBLISHED';
CREATE INDEX "LeadCaptureForm_businessId_status_publicSlug_idx" ON "LeadCaptureForm"("businessId", "status", "publicSlug");
CREATE INDEX "LeadCaptureForm_businessId_pipelineId_initialStageId_idx" ON "LeadCaptureForm"("businessId", "pipelineId", "initialStageId");

CREATE UNIQUE INDEX "FormSubmission_businessId_id_key" ON "FormSubmission"("businessId", "id");
CREATE UNIQUE INDEX "FormSubmission_businessId_formId_id_key" ON "FormSubmission"("businessId", "formId", "id");
CREATE UNIQUE INDEX "FormSubmission_businessId_formId_idempotencyKey_key" ON "FormSubmission"("businessId", "formId", "idempotencyKey");
CREATE INDEX "FormSubmission_businessId_formId_status_createdAt_idx" ON "FormSubmission"("businessId", "formId", "status", "createdAt");
CREATE INDEX "FormSubmission_businessId_leadId_idx" ON "FormSubmission"("businessId", "leadId");

CREATE UNIQUE INDEX "FormReward_businessId_id_key" ON "FormReward"("businessId", "id");
CREATE UNIQUE INDEX "FormReward_businessId_formId_id_key" ON "FormReward"("businessId", "formId", "id");
CREATE UNIQUE INDEX "FormReward_businessId_formId_version_key" ON "FormReward"("businessId", "formId", "version");
CREATE INDEX "FormReward_businessId_formId_enabled_idx" ON "FormReward"("businessId", "formId", "enabled");

CREATE UNIQUE INDEX "RewardClaim_businessId_id_key" ON "RewardClaim"("businessId", "id");
CREATE UNIQUE INDEX "RewardClaim_businessId_submissionId_key" ON "RewardClaim"("businessId", "submissionId");
CREATE INDEX "RewardClaim_businessId_rewardId_createdAt_idx" ON "RewardClaim"("businessId", "rewardId", "createdAt");
CREATE INDEX "RewardClaim_expiresAt_idx" ON "RewardClaim"("expiresAt");

CREATE UNIQUE INDEX "PublicFormRateLimitBucket_businessId_formId_scopeHash_windowStart_key"
ON "PublicFormRateLimitBucket"("businessId", "formId", "scopeHash", "windowStart");
CREATE INDEX "PublicFormRateLimitBucket_expiresAt_idx" ON "PublicFormRateLimitBucket"("expiresAt");

ALTER TABLE "LeadCaptureForm" ADD CONSTRAINT "LeadCaptureForm_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadCaptureForm" ADD CONSTRAINT "LeadCaptureForm_businessId_pipelineId_fkey"
FOREIGN KEY ("businessId", "pipelineId") REFERENCES "Pipeline"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadCaptureForm" ADD CONSTRAINT "LeadCaptureForm_businessId_pipelineId_initialStageId_fkey"
FOREIGN KEY ("businessId", "pipelineId", "initialStageId") REFERENCES "PipelineStage"("businessId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadCaptureForm" ADD CONSTRAINT "LeadCaptureForm_businessId_defaultAssigneeUserId_fkey"
FOREIGN KEY ("businessId", "defaultAssigneeUserId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_businessId_formId_fkey"
FOREIGN KEY ("businessId", "formId") REFERENCES "LeadCaptureForm"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_businessId_leadId_fkey"
FOREIGN KEY ("businessId", "leadId") REFERENCES "PipelineLead"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FormReward" ADD CONSTRAINT "FormReward_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormReward" ADD CONSTRAINT "FormReward_businessId_formId_fkey"
FOREIGN KEY ("businessId", "formId") REFERENCES "LeadCaptureForm"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_businessId_formId_submissionId_fkey"
FOREIGN KEY ("businessId", "formId", "submissionId") REFERENCES "FormSubmission"("businessId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_businessId_formId_rewardId_fkey"
FOREIGN KEY ("businessId", "formId", "rewardId") REFERENCES "FormReward"("businessId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicFormRateLimitBucket" ADD CONSTRAINT "PublicFormRateLimitBucket_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicFormRateLimitBucket" ADD CONSTRAINT "PublicFormRateLimitBucket_businessId_formId_fkey"
FOREIGN KEY ("businessId", "formId") REFERENCES "LeadCaptureForm"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
