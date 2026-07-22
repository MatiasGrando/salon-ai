ALTER TABLE "ReminderAutomation"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PAUSED';

UPDATE "ReminderAutomation"
SET "mode" = CASE
  WHEN "enabled" = TRUE THEN 'AUTOMATIC_API'
  ELSE 'PAUSED'
END;

ALTER TABLE "ReminderDelivery"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'WHATSAPP_API',
ADD COLUMN "messageSnapshot" TEXT,
ADD COLUMN "openedAt" TIMESTAMP(3),
ADD COLUMN "skippedAt" TIMESTAMP(3),
ADD COLUMN "manualNote" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ReminderDelivery"
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "sentAt" DROP DEFAULT,
ALTER COLUMN "sentAt" DROP NOT NULL;

CREATE INDEX "ReminderAutomation_businessId_mode_idx"
ON "ReminderAutomation"("businessId", "mode");

CREATE INDEX "ReminderDelivery_businessId_status_scheduledFor_idx"
ON "ReminderDelivery"("businessId", "status", "scheduledFor");
