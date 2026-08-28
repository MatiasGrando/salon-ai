CREATE TABLE "PostSaleAutomation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "delayMinutes" INTEGER NOT NULL DEFAULT 120,
  "responseWindowDays" INTEGER NOT NULL DEFAULT 7,
  "lowRatingThreshold" INTEGER NOT NULL DEFAULT 2,
  "templateId" TEXT,
  "positiveResponse" TEXT NOT NULL DEFAULT 'Gracias por tu calificación. Nos alegra que hayas tenido una buena experiencia.',
  "neutralResponse" TEXT NOT NULL DEFAULT 'Gracias por responder. Nos gustaría saber qué podríamos mejorar.',
  "negativeResponse" TEXT NOT NULL DEFAULT 'Lamentamos que tu experiencia no haya sido buena. El equipo va a contactarte por este chat.',
  "reviewUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostSaleAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostSaleDelivery" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "automationId" TEXT,
  "appointmentId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "conversationId" TEXT,
  "visitDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "responseExpiresAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "rating" INTEGER,
  "comment" TEXT,
  "commentRequestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostSaleDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostSaleAutomation_businessId_key" ON "PostSaleAutomation"("businessId");
CREATE INDEX "PostSaleAutomation_enabled_businessId_idx" ON "PostSaleAutomation"("enabled", "businessId");
CREATE INDEX "PostSaleAutomation_templateId_idx" ON "PostSaleAutomation"("templateId");
CREATE UNIQUE INDEX "PostSaleDelivery_businessId_customerId_visitDate_key" ON "PostSaleDelivery"("businessId", "customerId", "visitDate");
CREATE INDEX "PostSaleDelivery_businessId_status_scheduledFor_idx" ON "PostSaleDelivery"("businessId", "status", "scheduledFor");
CREATE INDEX "PostSaleDelivery_conversationId_status_responseExpiresAt_idx" ON "PostSaleDelivery"("conversationId", "status", "responseExpiresAt");
CREATE INDEX "PostSaleDelivery_appointmentId_idx" ON "PostSaleDelivery"("appointmentId");

ALTER TABLE "PostSaleAutomation"
ADD CONSTRAINT "PostSaleAutomation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostSaleAutomation"
ADD CONSTRAINT "PostSaleAutomation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostSaleDelivery"
ADD CONSTRAINT "PostSaleDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostSaleDelivery"
ADD CONSTRAINT "PostSaleDelivery_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "PostSaleAutomation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostSaleDelivery"
ADD CONSTRAINT "PostSaleDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostSaleDelivery"
ADD CONSTRAINT "PostSaleDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostSaleDelivery"
ADD CONSTRAINT "PostSaleDelivery_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
