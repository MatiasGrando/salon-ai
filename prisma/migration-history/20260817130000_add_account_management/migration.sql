CREATE TYPE "BusinessAccountStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'CANCELLED');

CREATE TABLE "BusinessPlan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessPlan_name_key" ON "BusinessPlan"("name");

INSERT INTO "BusinessPlan" ("id", "name", "createdAt", "updatedAt") VALUES
  ('plan-1', 'Plan 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan-2', 'Plan 2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan-3', 'Plan 3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Business"
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "planId" TEXT,
  ADD COLUMN "accountStatus" "BusinessAccountStatus";

UPDATE "Business" SET "accountStatus" = 'ACTIVE';

ALTER TABLE "Business"
  ALTER COLUMN "accountStatus" SET NOT NULL,
  ALTER COLUMN "accountStatus" SET DEFAULT 'ONBOARDING';

ALTER TABLE "User" ADD COLUMN "firstLoginAt" TIMESTAMP(3);

CREATE TABLE "BusinessOnboardingStatus" (
  "businessId" TEXT NOT NULL,
  "accountCreated" BOOLEAN NOT NULL DEFAULT true,
  "ownerLoggedIn" BOOLEAN NOT NULL DEFAULT false,
  "profileComplete" BOOLEAN NOT NULL DEFAULT false,
  "hasServices" BOOLEAN NOT NULL DEFAULT false,
  "hasProfessionals" BOOLEAN NOT NULL DEFAULT false,
  "hasBusinessHours" BOOLEAN NOT NULL DEFAULT false,
  "whatsappConnected" BOOLEAN NOT NULL DEFAULT false,
  "landingConfigured" BOOLEAN NOT NULL DEFAULT false,
  "completedSteps" INTEGER NOT NULL DEFAULT 1,
  "totalSteps" INTEGER NOT NULL DEFAULT 8,
  "progress" INTEGER NOT NULL DEFAULT 13,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessOnboardingStatus_pkey" PRIMARY KEY ("businessId")
);

CREATE INDEX "Business_planId_idx" ON "Business"("planId");
CREATE INDEX "Business_accountStatus_idx" ON "Business"("accountStatus");
CREATE INDEX "BusinessOnboardingStatus_progress_idx" ON "BusinessOnboardingStatus"("progress");

ALTER TABLE "Business"
  ADD CONSTRAINT "Business_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "BusinessPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessOnboardingStatus"
  ADD CONSTRAINT "BusinessOnboardingStatus_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
