ALTER TYPE "ServiceAttentionMode" ADD VALUE 'GUIDED_ESTIMATE';

ALTER TABLE "Service"
ADD COLUMN "estimateExplanation" TEXT,
ADD COLUMN "estimateQuestion" TEXT,
ADD COLUMN "estimateOptions" JSONB,
ADD COLUMN "estimateDisclaimer" TEXT,
ADD COLUMN "estimateAllowsBooking" BOOLEAN NOT NULL DEFAULT true;
