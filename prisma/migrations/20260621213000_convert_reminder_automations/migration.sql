DROP INDEX IF EXISTS "WhatsAppReminderAutomation_businessId_key";
DROP INDEX IF EXISTS "WhatsAppReminderAutomation_templateId_idx";

ALTER TABLE "WhatsAppReminderAutomation" RENAME TO "ReminderAutomation";
ALTER TABLE "ReminderAutomation" RENAME CONSTRAINT "WhatsAppReminderAutomation_pkey" TO "ReminderAutomation_pkey";
ALTER TABLE "ReminderAutomation" RENAME CONSTRAINT "WhatsAppReminderAutomation_businessId_fkey" TO "ReminderAutomation_businessId_fkey";

ALTER TABLE "ReminderAutomation" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Recordatorio de turno';
ALTER TABLE "ReminderAutomation" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'WHATSAPP';

CREATE INDEX "ReminderAutomation_businessId_enabled_idx" ON "ReminderAutomation"("businessId", "enabled");
CREATE INDEX "ReminderAutomation_businessId_sendBeforeMinutes_idx" ON "ReminderAutomation"("businessId", "sendBeforeMinutes");
