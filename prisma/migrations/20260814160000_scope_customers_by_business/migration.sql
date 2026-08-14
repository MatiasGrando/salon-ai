BEGIN;

-- Customer used to be a platform-wide identity keyed only by phone. Keep legacy
-- rows without any business evidence quarantined with businessId = NULL, and
-- split only rows that are referenced by more than one business.
ALTER TABLE "Customer" ADD COLUMN "businessId" TEXT;

LOCK TABLE
  "Customer",
  "Appointment",
  "CustomerMarketingPreference",
  "CampaignDelivery",
  "CampaignManualRecipient",
  "CampaignJob",
  "ReminderDelivery",
  "PostSaleDelivery",
  "CommunicationRecipient",
  "WeexCustomerLink"
IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "_CustomerBusinessMembership" ON COMMIT DROP AS
SELECT evidence."customerId", evidence."businessId", MIN(evidence."firstSeenAt") AS "firstSeenAt"
FROM (
  SELECT appointment."customerId", professional."businessId", MIN(appointment."createdAt") AS "firstSeenAt"
  FROM "Appointment" AS appointment
  JOIN "Professional" AS professional ON professional."id" = appointment."professionalId"
  GROUP BY appointment."customerId", professional."businessId"

  UNION ALL

  SELECT preference."customerId", preference."businessId", MIN(preference."createdAt") AS "firstSeenAt"
  FROM "CustomerMarketingPreference" AS preference
  GROUP BY preference."customerId", preference."businessId"

  UNION ALL

  SELECT delivery."customerId", delivery."businessId", MIN(delivery."createdAt") AS "firstSeenAt"
  FROM "CampaignDelivery" AS delivery
  GROUP BY delivery."customerId", delivery."businessId"

  UNION ALL

  SELECT recipient."customerId", campaign."businessId", MIN(recipient."createdAt") AS "firstSeenAt"
  FROM "CampaignManualRecipient" AS recipient
  JOIN "Campaign" AS campaign ON campaign."id" = recipient."campaignId"
  GROUP BY recipient."customerId", campaign."businessId"

  UNION ALL

  SELECT job."customerId", job."businessId", MIN(job."createdAt") AS "firstSeenAt"
  FROM "CampaignJob" AS job
  GROUP BY job."customerId", job."businessId"

  UNION ALL

  SELECT delivery."customerId", delivery."businessId", MIN(delivery."createdAt") AS "firstSeenAt"
  FROM "ReminderDelivery" AS delivery
  GROUP BY delivery."customerId", delivery."businessId"

  UNION ALL

  SELECT delivery."customerId", delivery."businessId", MIN(delivery."createdAt") AS "firstSeenAt"
  FROM "PostSaleDelivery" AS delivery
  GROUP BY delivery."customerId", delivery."businessId"

  UNION ALL

  SELECT recipient."customerId", recipient."businessId", MIN(recipient."createdAt") AS "firstSeenAt"
  FROM "CommunicationRecipient" AS recipient
  GROUP BY recipient."customerId", recipient."businessId"

  UNION ALL

  SELECT link."customerId", link."businessId", MIN(link."linkedAt") AS "firstSeenAt"
  FROM "WeexCustomerLink" AS link
  GROUP BY link."customerId", link."businessId"
) AS evidence
GROUP BY evidence."customerId", evidence."businessId";

CREATE TEMP TABLE "_CustomerBusinessTarget" ON COMMIT DROP AS
SELECT
  ranked."customerId",
  ranked."businessId",
  ranked."firstSeenAt",
  ranked."position",
  CASE
    WHEN ranked."position" = 1 THEN ranked."customerId"
    ELSE ranked."customerId" || '__business__' || md5(ranked."customerId" || ':' || ranked."businessId")
  END AS "targetCustomerId"
FROM (
  SELECT
    membership."customerId",
    membership."businessId",
    membership."firstSeenAt",
    ROW_NUMBER() OVER (
      PARTITION BY membership."customerId"
      ORDER BY membership."firstSeenAt" ASC, membership."businessId" ASC
    ) AS "position"
  FROM "_CustomerBusinessMembership" AS membership
) AS ranked;

CREATE UNIQUE INDEX "_CustomerBusinessTarget_customer_business_key"
  ON "_CustomerBusinessTarget"("customerId", "businessId");
CREATE UNIQUE INDEX "_CustomerBusinessTarget_target_key"
  ON "_CustomerBusinessTarget"("targetCustomerId");

-- The old global unique index must be removed before inserting the per-business
-- copies. The replacement compound unique index is created before commit.
DROP INDEX "Customer_normalizedPhone_key";

UPDATE "Customer" AS customer
SET "businessId" = target."businessId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = customer."id"
  AND target."position" = 1;

INSERT INTO "Customer" (
  "id",
  "businessId",
  "name",
  "phone",
  "email",
  "normalizedPhone",
  "createdAt"
)
SELECT
  target."targetCustomerId",
  target."businessId",
  customer."name",
  customer."phone",
  customer."email",
  customer."normalizedPhone",
  target."firstSeenAt"
FROM "_CustomerBusinessTarget" AS target
JOIN "Customer" AS customer ON customer."id" = target."customerId"
WHERE target."position" > 1;

-- Appointments determine their business through the professional.
UPDATE "Appointment" AS appointment
SET "customerId" = target."targetCustomerId"
FROM "Professional" AS professional, "_CustomerBusinessTarget" AS target
WHERE professional."id" = appointment."professionalId"
  AND target."customerId" = appointment."customerId"
  AND target."businessId" = professional."businessId"
  AND appointment."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "CustomerMarketingPreference" AS preference
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = preference."customerId"
  AND target."businessId" = preference."businessId"
  AND preference."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "CampaignDelivery" AS delivery
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = delivery."customerId"
  AND target."businessId" = delivery."businessId"
  AND delivery."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "CampaignManualRecipient" AS recipient
SET "customerId" = target."targetCustomerId"
FROM "Campaign" AS campaign, "_CustomerBusinessTarget" AS target
WHERE campaign."id" = recipient."campaignId"
  AND target."customerId" = recipient."customerId"
  AND target."businessId" = campaign."businessId"
  AND recipient."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "CampaignJob" AS job
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = job."customerId"
  AND target."businessId" = job."businessId"
  AND job."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "ReminderDelivery" AS delivery
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = delivery."customerId"
  AND target."businessId" = delivery."businessId"
  AND delivery."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "PostSaleDelivery" AS delivery
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = delivery."customerId"
  AND target."businessId" = delivery."businessId"
  AND delivery."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "CommunicationRecipient" AS recipient
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = recipient."customerId"
  AND target."businessId" = recipient."businessId"
  AND recipient."customerId" IS DISTINCT FROM target."targetCustomerId";

UPDATE "WeexCustomerLink" AS link
SET "customerId" = target."targetCustomerId"
FROM "_CustomerBusinessTarget" AS target
WHERE target."customerId" = link."customerId"
  AND target."businessId" = link."businessId"
  AND link."customerId" IS DISTINCT FROM target."targetCustomerId";

-- Notes have no legacy businessId. They intentionally stay only on the original
-- customer, which belongs to the earliest evidenced business; they are never
-- copied to every business.

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Customer_businessId_normalizedPhone_key"
  ON "Customer"("businessId", "normalizedPhone");
CREATE INDEX "Customer_businessId_phone_idx"
  ON "Customer"("businessId", "phone");
CREATE INDEX "Customer_businessId_createdAt_idx"
  ON "Customer"("businessId", "createdAt");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Appointment" AS appointment
    JOIN "Professional" AS professional ON professional."id" = appointment."professionalId"
    JOIN "Customer" AS customer ON customer."id" = appointment."customerId"
    WHERE customer."businessId" IS DISTINCT FROM professional."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left an appointment linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerMarketingPreference" AS preference
    JOIN "Customer" AS customer ON customer."id" = preference."customerId"
    WHERE customer."businessId" IS DISTINCT FROM preference."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a marketing preference linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CampaignDelivery" AS delivery
    JOIN "Customer" AS customer ON customer."id" = delivery."customerId"
    WHERE customer."businessId" IS DISTINCT FROM delivery."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a campaign delivery linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CampaignManualRecipient" AS recipient
    JOIN "Campaign" AS campaign ON campaign."id" = recipient."campaignId"
    JOIN "Customer" AS customer ON customer."id" = recipient."customerId"
    WHERE customer."businessId" IS DISTINCT FROM campaign."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a manual campaign recipient linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CampaignJob" AS job
    JOIN "Customer" AS customer ON customer."id" = job."customerId"
    WHERE customer."businessId" IS DISTINCT FROM job."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a campaign job linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReminderDelivery" AS delivery
    JOIN "Customer" AS customer ON customer."id" = delivery."customerId"
    WHERE customer."businessId" IS DISTINCT FROM delivery."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a reminder linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PostSaleDelivery" AS delivery
    JOIN "Customer" AS customer ON customer."id" = delivery."customerId"
    WHERE customer."businessId" IS DISTINCT FROM delivery."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a post-sale delivery linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CommunicationRecipient" AS recipient
    JOIN "Customer" AS customer ON customer."id" = recipient."customerId"
    WHERE customer."businessId" IS DISTINCT FROM recipient."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a communication linked across businesses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WeexCustomerLink" AS link
    JOIN "Customer" AS customer ON customer."id" = link."customerId"
    WHERE customer."businessId" IS DISTINCT FROM link."businessId"
  ) THEN
    RAISE EXCEPTION 'Customer migration left a Weex link linked across businesses';
  END IF;
END $$;

COMMIT;
