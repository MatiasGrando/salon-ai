ALTER TABLE "CustomerMarketingPreference"
ALTER COLUMN "status" SET DEFAULT 'NOT_AUTHORIZED';

ALTER TABLE "CustomerMarketingPreference"
ADD COLUMN "optedInAt" TIMESTAMP(3),
ADD COLUMN "declinedAt" TIMESTAMP(3);

UPDATE "CustomerMarketingPreference"
SET "status" = 'NOT_AUTHORIZED'
WHERE "status" = 'ACTIVE';
