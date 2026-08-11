CREATE TABLE "BusinessBotConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "botKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'OPTIONS_ONLY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessBotConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessBotConfiguration_businessId_botKey_key"
ON "BusinessBotConfiguration"("businessId", "botKey");

CREATE INDEX "BusinessBotConfiguration_businessId_status_idx"
ON "BusinessBotConfiguration"("businessId", "status");

ALTER TABLE "BusinessBotConfiguration"
ADD CONSTRAINT "BusinessBotConfiguration_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
