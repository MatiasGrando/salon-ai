CREATE TABLE "CustomerMarketingPreference" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT NOT NULL DEFAULT 'DEFAULT',
  "optedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerMarketingPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignDelivery" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "bookedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerMarketingPreference_businessId_customerId_key"
ON "CustomerMarketingPreference"("businessId", "customerId");
CREATE INDEX "CustomerMarketingPreference_businessId_status_idx"
ON "CustomerMarketingPreference"("businessId", "status");
CREATE INDEX "CampaignDelivery_businessId_customerId_sentAt_idx"
ON "CampaignDelivery"("businessId", "customerId", "sentAt");
CREATE INDEX "CampaignDelivery_campaignId_customerId_sentAt_idx"
ON "CampaignDelivery"("campaignId", "customerId", "sentAt");

ALTER TABLE "CustomerMarketingPreference"
ADD CONSTRAINT "CustomerMarketingPreference_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMarketingPreference"
ADD CONSTRAINT "CustomerMarketingPreference_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignDelivery"
ADD CONSTRAINT "CampaignDelivery_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignDelivery"
ADD CONSTRAINT "CampaignDelivery_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignDelivery"
ADD CONSTRAINT "CampaignDelivery_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
