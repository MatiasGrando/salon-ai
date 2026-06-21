CREATE TABLE "WhatsAppReminderAutomation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "templateId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendBeforeMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppReminderAutomation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppReminderAutomation_businessId_key" ON "WhatsAppReminderAutomation"("businessId");
CREATE INDEX "WhatsAppReminderAutomation_templateId_idx" ON "WhatsAppReminderAutomation"("templateId");

ALTER TABLE "WhatsAppReminderAutomation" ADD CONSTRAINT "WhatsAppReminderAutomation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
