CREATE UNIQUE INDEX "NewBotInboxEvent_event_partition_sequence_key"
  ON "NewBotInboxEvent" ("id", "businessId", "provider", "conversationId", "sequence");

CREATE TABLE "NewBotConversationSession" (
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "vertical" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" BIGINT NOT NULL,
  "state" JSONB NOT NULL,
  "lastInboxEventId" TEXT NOT NULL,
  "lastInboxSequence" BIGINT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "NewBotConversationSession_pkey" PRIMARY KEY ("businessId", "provider", "conversationId"),
  CONSTRAINT "NewBotConversationSession_schemaVersion_check" CHECK ("schemaVersion" = 1),
  CONSTRAINT "NewBotConversationSession_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "NewBotConversationSession_sequence_check" CHECK ("lastInboxSequence" > 0),
  CONSTRAINT "NewBotConversationSession_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NewBotConversationSession_last_event_fkey"
    FOREIGN KEY ("lastInboxEventId", "businessId", "provider", "conversationId", "lastInboxSequence")
    REFERENCES "NewBotInboxEvent"("id", "businessId", "provider", "conversationId", "sequence")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NewBotConversationSession_business_provider_vertical_idx"
  ON "NewBotConversationSession" ("businessId", "provider", "vertical");
ALTER TABLE "NewBotConversationSession" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "NewBotOutboxEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "action" JSONB NOT NULL,
  "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "providerAcceptedAt" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  "providerMessageId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "NewBotOutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NewBotOutboxEvent_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "NewBotOutboxEvent_status_check" CHECK ("processingStatus" IN ('PENDING','ACCEPTED','DELIVERED','FAILED')),
  CONSTRAINT "NewBotOutboxEvent_action_check" CHECK (
    jsonb_typeof("action") = 'object' AND "action"->>'type' = 'text' AND
    jsonb_typeof("action"->'text') = 'string' AND length("action"->>'text') BETWEEN 1 AND 4096
  ),
  CONSTRAINT "NewBotOutboxEvent_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NewBotOutboxEvent_inbox_fkey"
    FOREIGN KEY ("eventId", "businessId", "provider", "conversationId", "sequence")
    REFERENCES "NewBotInboxEvent"("id", "businessId", "provider", "conversationId", "sequence")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NewBotOutboxEvent_event_ordinal_key"
  ON "NewBotOutboxEvent" ("eventId", "ordinal");
CREATE UNIQUE INDEX "NewBotOutboxEvent_partition_sequence_ordinal_key"
  ON "NewBotOutboxEvent" ("businessId", "provider", "conversationId", "sequence", "ordinal");
CREATE INDEX "NewBotOutboxEvent_sender_pending_idx"
  ON "NewBotOutboxEvent" ("processingStatus", "createdAt", "id");
ALTER TABLE "NewBotOutboxEvent" ENABLE ROW LEVEL SECURITY;