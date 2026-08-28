CREATE TABLE "WhatsAppTemplate" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "internalName" TEXT NOT NULL,
  "metaName" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'MARKETING',
  "language" TEXT NOT NULL DEFAULT 'es_AR',
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "metaId" TEXT,
  "rejectionReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD COLUMN "whatsappTemplateId" TEXT;

CREATE UNIQUE INDEX "WhatsAppTemplate_businessId_metaName_language_key" ON "WhatsAppTemplate"("businessId", "metaName", "language");
CREATE INDEX "WhatsAppTemplate_businessId_status_updatedAt_idx" ON "WhatsAppTemplate"("businessId", "status", "updatedAt");
CREATE INDEX "Campaign_whatsappTemplateId_idx" ON "Campaign"("whatsappTemplateId");

ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
