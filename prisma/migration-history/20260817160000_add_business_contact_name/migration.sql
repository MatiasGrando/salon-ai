ALTER TABLE "Business"
ADD COLUMN "contactName" TEXT;

UPDATE "Business" AS business
SET "contactName" = (
  SELECT app_user."name"
  FROM "User" AS app_user
  WHERE app_user."businessId" = business."id"
    AND app_user."role" = 'BUSINESS_ADMIN'
  ORDER BY app_user."createdAt" ASC
  LIMIT 1
)
WHERE business."contactName" IS NULL;
