ALTER TABLE "Business"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoType" TEXT;

CREATE INDEX "Business_isDemo_createdByUserId_idx"
ON "Business"("isDemo", "createdByUserId");
