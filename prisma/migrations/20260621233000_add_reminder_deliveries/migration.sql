CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reminderAutomationId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "providerMessageId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReminderDelivery_reminderAutomationId_appointmentId_key" ON "ReminderDelivery"("reminderAutomationId", "appointmentId");
CREATE INDEX "ReminderDelivery_businessId_status_sentAt_idx" ON "ReminderDelivery"("businessId", "status", "sentAt");
CREATE INDEX "ReminderDelivery_appointmentId_idx" ON "ReminderDelivery"("appointmentId");
CREATE INDEX "ReminderDelivery_customerId_sentAt_idx" ON "ReminderDelivery"("customerId", "sentAt");

ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_reminderAutomationId_fkey" FOREIGN KEY ("reminderAutomationId") REFERENCES "ReminderAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
