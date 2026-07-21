ALTER TABLE "PostSaleAutomation"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PAUSED';

UPDATE "PostSaleAutomation"
SET "mode" = CASE
  WHEN "enabled" = TRUE THEN 'AUTOMATIC_API'
  ELSE 'PAUSED'
END;

ALTER TABLE "PostSaleDelivery"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'WHATSAPP_API',
ADD COLUMN "messageSnapshot" TEXT,
ADD COLUMN "openedAt" TIMESTAMP(3),
ADD COLUMN "skippedAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "manualNote" TEXT;

CREATE INDEX "PostSaleAutomation_mode_businessId_idx"
ON "PostSaleAutomation"("mode", "businessId");
