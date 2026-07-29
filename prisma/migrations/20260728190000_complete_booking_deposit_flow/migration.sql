CREATE TYPE "BookingDepositStatus" AS ENUM ('PENDING_PROOF', 'PROOF_RECEIVED', 'APPROVED', 'REJECTED', 'EXPIRED');

ALTER TABLE "Service"
ADD COLUMN "depositHoldMinutes" INTEGER NOT NULL DEFAULT 60;

CREATE TABLE "BusinessPaymentSettings" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "transferEnabled" BOOLEAN NOT NULL DEFAULT false,
  "alias" TEXT,
  "cbu" TEXT,
  "cvu" TEXT,
  "accountHolder" TEXT,
  "paymentLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
  "paymentLink" TEXT,
  "instructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessPaymentSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookingDeposit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "mode" "ServiceDepositMode" NOT NULL,
  "configuredValue" INTEGER NOT NULL,
  "baseAmount" INTEGER,
  "amount" INTEGER NOT NULL,
  "status" "BookingDepositStatus" NOT NULL DEFAULT 'PENDING_PROOF',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "proofMessageId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingDeposit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessPaymentSettings_businessId_key" ON "BusinessPaymentSettings"("businessId");
CREATE UNIQUE INDEX "BookingDeposit_appointmentId_key" ON "BookingDeposit"("appointmentId");
CREATE INDEX "BookingDeposit_businessId_status_expiresAt_idx" ON "BookingDeposit"("businessId", "status", "expiresAt");
CREATE INDEX "BookingDeposit_conversationId_createdAt_idx" ON "BookingDeposit"("conversationId", "createdAt");

ALTER TABLE "BusinessPaymentSettings"
ADD CONSTRAINT "BusinessPaymentSettings_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDeposit"
ADD CONSTRAINT "BookingDeposit_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDeposit"
ADD CONSTRAINT "BookingDeposit_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDeposit"
ADD CONSTRAINT "BookingDeposit_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
