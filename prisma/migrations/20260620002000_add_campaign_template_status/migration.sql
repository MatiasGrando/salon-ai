ALTER TABLE "Campaign"
ADD COLUMN "templateId" TEXT,
ADD COLUMN "templateStatus" TEXT NOT NULL DEFAULT 'NOT_CREATED',
ADD COLUMN "templateRejectionReason" TEXT,
ADD COLUMN "templateLastSyncedAt" TIMESTAMP(3);
