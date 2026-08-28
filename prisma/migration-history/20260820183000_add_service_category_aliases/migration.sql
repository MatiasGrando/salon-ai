CREATE TABLE "ServiceCategoryAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCategoryAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceCategoryAlias_categoryId_normalizedName_key"
ON "ServiceCategoryAlias"("categoryId", "normalizedName");

CREATE INDEX "ServiceCategoryAlias_normalizedName_idx"
ON "ServiceCategoryAlias"("normalizedName");

ALTER TABLE "ServiceCategoryAlias"
ADD CONSTRAINT "ServiceCategoryAlias_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
