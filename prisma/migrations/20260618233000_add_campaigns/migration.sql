CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'ONE_TIME',
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "segment" TEXT NOT NULL DEFAULT 'ALL',
  "segmentLabel" TEXT NOT NULL DEFAULT 'Todos los clientes',
  "message" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "budgetLimit" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign"
ADD CONSTRAINT "Campaign_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Campaign_businessId_status_updatedAt_idx"
ON "Campaign"("businessId", "status", "updatedAt");
