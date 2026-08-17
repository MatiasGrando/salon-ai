CREATE TYPE "BusinessDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');
CREATE TYPE "AccountChargeStatus" AS ENUM ('PENDING', 'PAID', 'BONIFIED');

ALTER TABLE "BusinessPlan"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "BusinessBillingSettings" (
  "businessId" TEXT NOT NULL,
  "billingDay" INTEGER NOT NULL DEFAULT 1,
  "activatedAt" TIMESTAMP(3),
  "nextBillingAt" TIMESTAMP(3),
  "discountType" "BusinessDiscountType",
  "discountValue" DECIMAL(12,2),
  "discountUntil" TIMESTAMP(3),
  "discountReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessBillingSettings_pkey" PRIMARY KEY ("businessId")
);

CREATE TABLE "BusinessAccountCharge" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "grossAmount" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(12,2) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "originalDueAt" TIMESTAMP(3) NOT NULL,
  "status" "AccountChargeStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "paymentMethod" TEXT,
  "paymentReference" TEXT,
  "paymentNote" TEXT,
  "paymentRecordedBy" TEXT,
  "bonifiedAt" TIMESTAMP(3),
  "bonificationReason" TEXT,
  "bonifiedBy" TEXT,
  "dueDateChangedBy" TEXT,
  "dueDateChangeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessAccountCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessAccountCharge_businessId_period_key" ON "BusinessAccountCharge"("businessId", "period");
CREATE INDEX "BusinessBillingSettings_nextBillingAt_idx" ON "BusinessBillingSettings"("nextBillingAt");
CREATE INDEX "BusinessAccountCharge_businessId_dueAt_idx" ON "BusinessAccountCharge"("businessId", "dueAt");
CREATE INDEX "BusinessAccountCharge_status_dueAt_idx" ON "BusinessAccountCharge"("status", "dueAt");

ALTER TABLE "BusinessBillingSettings"
  ADD CONSTRAINT "BusinessBillingSettings_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessAccountCharge"
  ADD CONSTRAINT "BusinessAccountCharge_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
