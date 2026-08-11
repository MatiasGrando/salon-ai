CREATE TABLE "AiUsageEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "conversationId" TEXT,
  "appointmentId" TEXT,
  "source" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "costNanoUsd" BIGINT,
  "pricingKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsageEvent_responseId_key" ON "AiUsageEvent"("responseId");
CREATE INDEX "AiUsageEvent_businessId_createdAt_idx" ON "AiUsageEvent"("businessId", "createdAt");
CREATE INDEX "AiUsageEvent_conversationId_createdAt_idx" ON "AiUsageEvent"("conversationId", "createdAt");
CREATE INDEX "AiUsageEvent_appointmentId_createdAt_idx" ON "AiUsageEvent"("appointmentId", "createdAt");
CREATE INDEX "AiUsageEvent_source_createdAt_idx" ON "AiUsageEvent"("source", "createdAt");
