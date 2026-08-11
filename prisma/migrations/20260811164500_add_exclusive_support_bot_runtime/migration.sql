ALTER TABLE "BusinessBotConfiguration"
ADD COLUMN "routingMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
ADD COLUMN "phoneNumberId" TEXT,
ADD COLUMN "displayPhoneNumber" TEXT;

ALTER TABLE "Conversation"
ADD COLUMN "supportBotKey" TEXT,
ADD COLUMN "supportBotState" JSONB;

CREATE INDEX "BusinessBotConfiguration_phoneNumberId_status_idx"
ON "BusinessBotConfiguration"("phoneNumberId", "status");
