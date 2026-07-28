CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Service"
ADD COLUMN "catalogCategoryId" TEXT,
ADD COLUMN "parentServiceId" TEXT,
ADD COLUMN "isBookable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "ServiceCategory" (
    "id",
    "name",
    "businessId",
    "createdAt",
    "updatedAt"
)
SELECT
    'cat_' || md5("businessId" || ':' || lower(trim("category"))),
    min(trim("category")),
    "businessId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Service"
WHERE "category" IS NOT NULL
  AND trim("category") <> ''
GROUP BY "businessId", lower(trim("category"));

UPDATE "Service" AS service
SET "catalogCategoryId" = category."id"
FROM "ServiceCategory" AS category
WHERE category."businessId" = service."businessId"
  AND lower(category."name") = lower(trim(service."category"));

CREATE UNIQUE INDEX "ServiceCategory_businessId_name_key"
ON "ServiceCategory"("businessId", "name");

CREATE INDEX "ServiceCategory_businessId_sortOrder_idx"
ON "ServiceCategory"("businessId", "sortOrder");

CREATE INDEX "Service_businessId_catalogCategoryId_sortOrder_idx"
ON "Service"("businessId", "catalogCategoryId", "sortOrder");

CREATE INDEX "Service_parentServiceId_idx"
ON "Service"("parentServiceId");

ALTER TABLE "ServiceCategory"
ADD CONSTRAINT "ServiceCategory_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Service"
ADD CONSTRAINT "Service_catalogCategoryId_fkey"
FOREIGN KEY ("catalogCategoryId") REFERENCES "ServiceCategory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Service"
ADD CONSTRAINT "Service_parentServiceId_fkey"
FOREIGN KEY ("parentServiceId") REFERENCES "Service"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
