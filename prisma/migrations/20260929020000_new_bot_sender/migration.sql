ALTER TABLE "NewBotOutboxEvent"
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "claimExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN "retryAt" TIMESTAMPTZ(6),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dispatchStartedAt" TIMESTAMPTZ(6),
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING';
UPDATE "NewBotOutboxEvent" SET "processingStatus"='ACCEPTED', "deliveryStatus"='DELIVERED' WHERE "processingStatus"='DELIVERED';
ALTER TABLE "NewBotOutboxEvent" DROP CONSTRAINT "NewBotOutboxEvent_status_check";
ALTER TABLE "NewBotOutboxEvent" ADD CONSTRAINT "NewBotOutboxEvent_status_check"
  CHECK ("processingStatus" IN ('PENDING','CLAIMED','DISPATCHING','ACCEPTED','FAILED','UNKNOWN','BLOCKED'));
ALTER TABLE "NewBotOutboxEvent" ADD CONSTRAINT "NewBotOutboxEvent_delivery_status_check"
  CHECK ("deliveryStatus" IN ('PENDING','DELIVERED','READ','FAILED'));
ALTER TABLE "NewBotOutboxEvent" ADD CONSTRAINT "NewBotOutboxEvent_attempt_count_check" CHECK ("attemptCount" >= 0);
CREATE UNIQUE INDEX "NewBotOutboxEvent_provider_message_key"
  ON "NewBotOutboxEvent" ("businessId", "provider", "providerMessageId") WHERE "providerMessageId" IS NOT NULL;
CREATE INDEX "NewBotOutboxEvent_sender_claim_idx"
  ON "NewBotOutboxEvent" ("processingStatus", "retryAt", "createdAt", "id");

CREATE TABLE "NewBotOutboxReceipt" (
  "idempotencyKey" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DELIVERED','READ','FAILED')),
  "safeReasonCode" TEXT,
  "outboxEventId" TEXT,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("businessId", "provider", "idempotencyKey"),
  CONSTRAINT "NewBotOutboxReceipt_event_fkey" FOREIGN KEY ("outboxEventId")
    REFERENCES "NewBotOutboxEvent"("id") ON DELETE SET NULL
);
CREATE INDEX "NewBotOutboxReceipt_match_idx"
  ON "NewBotOutboxReceipt" ("businessId", "provider", "providerMessageId", "recipientKey");
ALTER TABLE "NewBotOutboxReceipt" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "NewBotOutboxReconciliation" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "outboxEventId" TEXT NOT NULL REFERENCES "NewBotOutboxEvent"("id") ON DELETE CASCADE,
  "requestKey" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('BIND_ACCEPTED','RETRY')),
  "providerMessageId" TEXT,
  "duplicateRiskAcknowledged" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("businessId", "outboxEventId", "requestKey")
);
ALTER TABLE "NewBotOutboxReconciliation" ENABLE ROW LEVEL SECURITY;