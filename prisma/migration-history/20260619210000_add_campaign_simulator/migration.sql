CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SIMULATION',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "exclusionSummary" JSONB NOT NULL,
    "configurationSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignJob_idempotencyKey_key" ON "CampaignJob"("idempotencyKey");
CREATE UNIQUE INDEX "CampaignJob_runId_customerId_key" ON "CampaignJob"("runId", "customerId");
CREATE INDEX "CampaignRun_campaignId_createdAt_idx" ON "CampaignRun"("campaignId", "createdAt");
CREATE INDEX "CampaignRun_businessId_createdAt_idx" ON "CampaignRun"("businessId", "createdAt");
CREATE INDEX "CampaignJob_status_nextAttemptAt_idx" ON "CampaignJob"("status", "nextAttemptAt");
CREATE INDEX "CampaignJob_campaignId_customerId_idx" ON "CampaignJob"("campaignId", "customerId");
CREATE INDEX "CampaignJob_businessId_status_idx" ON "CampaignJob"("businessId", "status");

ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignJob" ADD CONSTRAINT "CampaignJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignJob" ADD CONSTRAINT "CampaignJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignJob" ADD CONSTRAINT "CampaignJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignJob" ADD CONSTRAINT "CampaignJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
