CREATE TABLE "CampaignManualRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignManualRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignManualRecipient_campaignId_customerId_key"
ON "CampaignManualRecipient"("campaignId", "customerId");
CREATE INDEX "CampaignManualRecipient_customerId_idx"
ON "CampaignManualRecipient"("customerId");

ALTER TABLE "CampaignManualRecipient"
ADD CONSTRAINT "CampaignManualRecipient_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignManualRecipient"
ADD CONSTRAINT "CampaignManualRecipient_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
