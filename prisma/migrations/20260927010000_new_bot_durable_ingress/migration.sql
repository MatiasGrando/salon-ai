CREATE TABLE "NewBotInboxEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "vertical" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "message" JSONB NOT NULL,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL,
  "admittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "NewBotInboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NewBotInboxEvent_attemptCount_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "NewBotInboxEvent_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NewBotInboxEvent_businessId_provider_providerEventId_key"
  ON "NewBotInboxEvent"("businessId", "provider", "providerEventId");

ALTER TABLE "NewBotInboxEvent" ENABLE ROW LEVEL SECURITY;
