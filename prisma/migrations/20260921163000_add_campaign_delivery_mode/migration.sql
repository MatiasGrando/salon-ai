CREATE TYPE "CampaignDeliveryMode" AS ENUM ('MANUAL_ASSISTED', 'AUTOMATIC_API');

ALTER TABLE "Campaign"
  ADD COLUMN "deliveryMode" "CampaignDeliveryMode";

-- Only preserve automatic delivery when durable history proves that Meta/API
-- execution already happened. Merely being ACTIVE or SCHEDULED is ambiguous.
UPDATE "Campaign" AS campaign
SET "deliveryMode" = 'AUTOMATIC_API'::"CampaignDeliveryMode"
WHERE EXISTS (
  SELECT 1
  FROM "CampaignRun" AS run
  WHERE run."campaignId" = campaign."id"
    AND run."mode" = 'REAL'
)
OR EXISTS (
  SELECT 1
  FROM "CampaignDelivery" AS delivery
  WHERE delivery."campaignId" = campaign."id"
    AND delivery."status" NOT IN ('FAILED', 'CANCELLED')
)
OR EXISTS (
  SELECT 1
  FROM "CampaignJob" AS job
  WHERE job."campaignId" = campaign."id"
);

UPDATE "Campaign"
SET "deliveryMode" = 'MANUAL_ASSISTED'::"CampaignDeliveryMode"
WHERE "deliveryMode" IS NULL;

-- Existing ACTIVE/SCHEDULED rows without durable API evidence are ambiguous.
-- Pause them until an operator reviews and explicitly chooses a supported mode.
UPDATE "Campaign"
SET "status" = 'PAUSED'
WHERE "deliveryMode" = 'MANUAL_ASSISTED'::"CampaignDeliveryMode"
  AND "status" IN ('ACTIVE', 'SCHEDULED');
ALTER TABLE "Campaign"
  ALTER COLUMN "deliveryMode" SET DEFAULT 'MANUAL_ASSISTED',
  ALTER COLUMN "deliveryMode" SET NOT NULL;
