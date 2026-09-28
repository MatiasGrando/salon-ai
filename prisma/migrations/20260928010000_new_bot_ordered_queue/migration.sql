ALTER TABLE "NewBotInboxEvent"
  ADD COLUMN "sequence" BIGINT,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN "retryAt" TIMESTAMPTZ(6),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6),
  ADD COLUMN "processingErrorCode" TEXT;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "businessId", "provider", "conversationId"
    ORDER BY "admittedAt", "receivedAt", "id"
  ) AS "sequence"
  FROM "NewBotInboxEvent"
)
UPDATE "NewBotInboxEvent" AS event
SET "sequence" = ordered."sequence"
FROM ordered
WHERE event."id" = ordered."id";

ALTER TABLE "NewBotInboxEvent"
  ALTER COLUMN "sequence" SET NOT NULL,
  ADD CONSTRAINT "NewBotInboxEvent_sequence_check" CHECK ("sequence" > 0);

CREATE UNIQUE INDEX "NewBotInboxEvent_partition_sequence_key"
  ON "NewBotInboxEvent" ("businessId", "provider", "conversationId", "sequence");
CREATE INDEX "NewBotInboxEvent_queue_partition_status_idx"
  ON "NewBotInboxEvent" ("businessId", "provider", "conversationId", "processingStatus", "sequence");

CREATE TABLE "NewBotConversationCounter" (
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lastSequence" BIGINT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "NewBotConversationCounter_pkey" PRIMARY KEY ("businessId", "provider", "conversationId"),
  CONSTRAINT "NewBotConversationCounter_lastSequence_check" CHECK ("lastSequence" >= 0),
  CONSTRAINT "NewBotConversationCounter_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "NewBotConversationCounter" ("businessId", "provider", "conversationId", "lastSequence")
SELECT "businessId", "provider", "conversationId", MAX("sequence")
FROM "NewBotInboxEvent"
GROUP BY "businessId", "provider", "conversationId";

ALTER TABLE "NewBotConversationCounter" ENABLE ROW LEVEL SECURITY;