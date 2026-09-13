ALTER TABLE "BusinessFeatureSettings"
ADD COLUMN "pipelineEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BusinessFeatureSettings" AS settings
SET "pipelineEnabled" = true
FROM "Business" AS business
WHERE settings."businessId" = business."id"
  AND business."isDemo" = true
  AND business."demoType" = 'BARBERSHOP';
