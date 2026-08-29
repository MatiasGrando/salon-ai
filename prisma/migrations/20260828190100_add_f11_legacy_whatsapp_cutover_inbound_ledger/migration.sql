-- F11.1 phase 2: durable receipts and legacy claim uniqueness. Additive only.

CREATE TYPE "LegacyWhatsAppCutoverInboundStatus" AS ENUM (
  'PAUSED_ADMITTED', 'LEGACY_DUPLICATE',
  'NORMAL_CLAIMED', 'NORMAL_SENDING', 'NORMAL_DONE', 'NORMAL_UNKNOWN',
  'REPLAY_LEGACY_READY',
  'REPLAYING_LEGACY', 'STALE_CUTOVER', 'STALE_CUTOVER_DUPLICATE', 'REPLAYED_LEGACY'
);

CREATE TABLE "LegacyWhatsAppCutoverInbound" (
  "id" TEXT NOT NULL, "receiptKey" TEXT NOT NULL, "businessId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL, "deploymentGeneration" INTEGER NOT NULL, "dispatchFenceEpoch" INTEGER NOT NULL,
  "pausedAt" TIMESTAMP(3), "providerMessageId" TEXT NOT NULL, "fromPhone" TEXT NOT NULL,
  "phoneNumberId" TEXT, "displayPhoneNumber" TEXT, "payload" JSONB NOT NULL,
  "status" "LegacyWhatsAppCutoverInboundStatus" NOT NULL DEFAULT 'PAUSED_ADMITTED',
  "claimToken" TEXT, "claimedUntil" TIMESTAMP(3), "replayedAt" TIMESTAMP(3), "staleAt" TIMESTAMP(3), "providerEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyWhatsAppCutoverInbound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyWhatsAppCutoverInbound_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LegacyWhatsAppCutoverInbound_receiptKey_key" ON "LegacyWhatsAppCutoverInbound"("receiptKey");
CREATE UNIQUE INDEX "LegacyWhatsAppCutoverInbound_businessId_providerMessageId_key" ON "LegacyWhatsAppCutoverInbound"("businessId", "providerMessageId");
CREATE INDEX "LegacyWhatsAppCutoverInbound_scope_status_createdAt_idx" ON "LegacyWhatsAppCutoverInbound"("businessId", "deploymentId", "deploymentGeneration", "dispatchFenceEpoch", "pausedAt", "status", "createdAt");
CREATE INDEX "LegacyWhatsAppCutoverInbound_status_claimedUntil_idx" ON "LegacyWhatsAppCutoverInbound"("status", "claimedUntil");
CREATE UNIQUE INDEX "BotDispatchClaim_legacy_process_resource_key" ON "BotDispatchClaim"("businessId", "kind", "resourceId") WHERE "kind" = 'LEGACY_PROCESS'::"BotDispatchKind" AND "resourceId" IS NOT NULL;
