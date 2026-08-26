-- F4: admisión autoritativa, workers con leases/fencing y outbox auditable.
-- Esta migración es forward-only: primero agrega/backfillea y recién después endurece nullability.

ALTER TYPE "BotInboxStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';
ALTER TYPE "BotInboxStatus" ADD VALUE IF NOT EXISTS 'STALE_CUTOVER';

ALTER TYPE "BotOutboxStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';
ALTER TYPE "BotOutboxStatus" ADD VALUE IF NOT EXISTS 'RETRY';
ALTER TYPE "BotOutboxStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

DO $$ BEGIN
  CREATE TYPE "BotDispatchKind" AS ENUM ('PROCESS', 'SEND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED', 'SENDING', 'UNKNOWN', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "BotChannelDeployment"
  ADD COLUMN IF NOT EXISTS "dispatchFenceEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "legacyDispatchCoverageVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BotSession"
  ADD COLUMN IF NOT EXISTS "deploymentGeneration" INTEGER,
  ADD COLUMN IF NOT EXISTS "channel" "BotChannel" NOT NULL DEFAULT 'WHATSAPP',
  ADD COLUMN IF NOT EXISTS "businessTimezone" TEXT;

UPDATE "BotSession" s
SET "deploymentGeneration" = d."generation"
FROM "BotChannelDeployment" d
WHERE d."id" = s."deploymentId" AND d."businessId" = s."businessId" AND s."deploymentGeneration" IS NULL;

UPDATE "BotSession"
SET "businessTimezone" = 'America/Argentina/Buenos_Aires'
WHERE "businessTimezone" IS NULL;

ALTER TABLE "BotSession"
  ALTER COLUMN "deploymentGeneration" SET NOT NULL,
  ALTER COLUMN "businessTimezone" SET NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "BotSession" s LEFT JOIN "BotChannelDeployment" d
      ON d."businessId" = s."businessId" AND d."id" = s."deploymentId"
    WHERE d."id" IS NULL
  ) THEN RAISE EXCEPTION 'BotSession contains a cross-tenant or missing deployment'; END IF;
  IF EXISTS (SELECT 1 FROM "BotProviderEvent" WHERE "businessId" IS NULL) THEN
    RAISE EXCEPTION 'authoritative BotProviderEvent rows require businessId';
  END IF;
END $$;

ALTER TABLE "BotProviderEvent" ALTER COLUMN "businessId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "BotChannelDeployment_businessId_id_key" ON "BotChannelDeployment"("businessId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_businessId_id_key" ON "BotSession"("businessId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_businessId_deploymentId_id_key" ON "BotSession"("businessId", "deploymentId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BotProviderEvent_businessId_id_key" ON "BotProviderEvent"("businessId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_sessionId_id_key" ON "BotPrompt"("sessionId", "id");

ALTER TABLE "BotSession" DROP CONSTRAINT IF EXISTS "BotSession_businessId_deploymentId_fkey";
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_businessId_deploymentId_fkey"
  FOREIGN KEY ("businessId", "deploymentId") REFERENCES "BotChannelDeployment"("businessId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotSession" VALIDATE CONSTRAINT "BotSession_businessId_deploymentId_fkey";

CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_active_deployment_conversation_key"
  ON "BotSession"("deploymentId", "conversationId")
  WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_open_functional_per_session_key"
  ON "BotPrompt"("sessionId")
  WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL';

ALTER TABLE "BotActionInbox"
  ADD COLUMN IF NOT EXISTS "businessId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "deploymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "deploymentGeneration" INTEGER,
  ADD COLUMN IF NOT EXISTS "claimToken" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedUntil" TIMESTAMP(3);

WITH mapped AS (
  SELECT i."id", e."businessId", COALESCE(s."deploymentId", d."id") AS "deploymentId",
    COALESCE(s."deploymentGeneration", d."generation") AS "deploymentGeneration"
  FROM "BotActionInbox" i
  JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
  LEFT JOIN "BotSession" s ON s."id" = i."sessionId" AND s."businessId" = e."businessId"
  LEFT JOIN "BotChannelDeployment" d
    ON d."businessId" = e."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
  WHERE i."businessId" IS NULL OR i."deploymentId" IS NULL OR i."deploymentGeneration" IS NULL
)
UPDATE "BotActionInbox" i
SET "businessId" = mapped."businessId", "deploymentId" = mapped."deploymentId",
    "deploymentGeneration" = mapped."deploymentGeneration"
FROM mapped
WHERE mapped."id" = i."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BotActionInbox" WHERE "businessId" IS NULL OR "deploymentId" IS NULL OR "deploymentGeneration" IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill tenant/deployment fencing for existing BotActionInbox rows';
  END IF;
END $$;

ALTER TABLE "BotActionInbox"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "deploymentId" SET NOT NULL,
  ALTER COLUMN "deploymentGeneration" SET NOT NULL;

DROP INDEX IF EXISTS "BotActionInbox_providerEventId_key";
DROP INDEX IF EXISTS "BotActionInbox_providerEventId_idx";
CREATE INDEX IF NOT EXISTS "BotActionInbox_businessId_providerEventId_idx" ON "BotActionInbox"("businessId", "providerEventId");
CREATE INDEX IF NOT EXISTS "BotActionInbox_status_claimedUntil_idx" ON "BotActionInbox"("status", "claimedUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "BotActionInbox_promptId_providerMessageId_key"
  ON "BotActionInbox"("promptId", "providerMessageId")
  WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL;

ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_providerEventId_fkey";
ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_sessionId_fkey";
ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_businessId_providerEventId_fkey";
ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_businessId_deploymentId_fkey";
ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_businessId_deploymentId_sessionId_fkey";
ALTER TABLE "BotActionInbox" DROP CONSTRAINT IF EXISTS "BotActionInbox_sessionId_promptId_fkey";
ALTER TABLE "BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_providerEventId_fkey"
  FOREIGN KEY ("businessId", "providerEventId") REFERENCES "BotProviderEvent"("businessId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_deploymentId_fkey"
  FOREIGN KEY ("businessId", "deploymentId") REFERENCES "BotChannelDeployment"("businessId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_deploymentId_sessionId_fkey"
  FOREIGN KEY ("businessId", "deploymentId", "sessionId") REFERENCES "BotSession"("businessId", "deploymentId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotActionInbox" ADD CONSTRAINT "BotActionInbox_sessionId_promptId_fkey"
  FOREIGN KEY ("sessionId", "promptId") REFERENCES "BotPrompt"("sessionId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotActionInbox" VALIDATE CONSTRAINT "BotActionInbox_businessId_providerEventId_fkey";
ALTER TABLE "BotActionInbox" VALIDATE CONSTRAINT "BotActionInbox_businessId_deploymentId_fkey";
ALTER TABLE "BotActionInbox" VALIDATE CONSTRAINT "BotActionInbox_businessId_deploymentId_sessionId_fkey";
ALTER TABLE "BotActionInbox" VALIDATE CONSTRAINT "BotActionInbox_sessionId_promptId_fkey";

ALTER TABLE "BotJob"
  ADD COLUMN IF NOT EXISTS "deploymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "deploymentGeneration" INTEGER,
  ADD COLUMN IF NOT EXISTS "expectedRevision" BIGINT;

UPDATE "BotJob" j
SET "deploymentId" = d."id", "deploymentGeneration" = d."generation"
FROM "BotChannelDeployment" d
WHERE d."businessId" = j."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
  AND (j."deploymentId" IS NULL OR j."deploymentGeneration" IS NULL);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "BotJob" WHERE "businessId" IS NULL OR "deploymentId" IS NULL OR "deploymentGeneration" IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill tenant/deployment fencing for existing BotJob rows';
  END IF;
END $$;

ALTER TABLE "BotJob"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "deploymentId" SET NOT NULL,
  ALTER COLUMN "deploymentGeneration" SET NOT NULL;
ALTER TABLE "BotJob" DROP CONSTRAINT IF EXISTS "BotJob_businessId_deploymentId_fkey";
ALTER TABLE "BotJob" ADD CONSTRAINT "BotJob_businessId_deploymentId_fkey"
  FOREIGN KEY ("businessId", "deploymentId") REFERENCES "BotChannelDeployment"("businessId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotJob" VALIDATE CONSTRAINT "BotJob_businessId_deploymentId_fkey";
CREATE INDEX IF NOT EXISTS "BotJob_businessId_deploymentId_status_idx" ON "BotJob"("businessId", "deploymentId", "status");
CREATE INDEX IF NOT EXISTS "BotJob_status_claimedUntil_idx" ON "BotJob"("status", "leasedUntil");

ALTER TABLE "BotOutbox" ADD COLUMN IF NOT EXISTS "deliveryGroupId" TEXT;

UPDATE "BotOutbox" SET "deliveryGroupId" = "transitionId" WHERE "deliveryGroupId" IS NULL;
ALTER TABLE "BotOutbox" ALTER COLUMN "deliveryGroupId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BotOutbox_providerMessageId_key"
  ON "BotOutbox"("providerMessageId") WHERE "providerMessageId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "BotOutbox_deliveryGroupId_sequence_idx" ON "BotOutbox"("deliveryGroupId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "BotOutbox_sessionId_deliveryGroupId_sequence_key" ON "BotOutbox"("sessionId", "deliveryGroupId", "sequence");
CREATE INDEX IF NOT EXISTS "BotOutbox_status_claimedUntil_idx" ON "BotOutbox"("status", "leasedUntil");

ALTER TABLE "BotOutbox" DROP CONSTRAINT IF EXISTS "BotOutbox_sessionId_fkey";
ALTER TABLE "BotOutbox" DROP CONSTRAINT IF EXISTS "BotOutbox_businessId_sessionId_fkey";
ALTER TABLE "BotOutbox" ADD CONSTRAINT "BotOutbox_businessId_sessionId_fkey"
  FOREIGN KEY ("businessId", "sessionId") REFERENCES "BotSession"("businessId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotOutbox" VALIDATE CONSTRAINT "BotOutbox_businessId_sessionId_fkey";

CREATE TABLE IF NOT EXISTS "BotOutboxResolution" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotOutboxResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BotOutboxResolution_outboxId_fkey" FOREIGN KEY ("outboxId")
    REFERENCES "BotOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BotOutboxResolution_outboxId_createdAt_idx"
  ON "BotOutboxResolution"("outboxId", "createdAt");

CREATE TABLE IF NOT EXISTS "BotDispatchClaim" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "channel" "BotChannel" NOT NULL DEFAULT 'WHATSAPP',
  "sessionId" TEXT,
  "resourceId" TEXT,
  "engineKey" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "fenceEpoch" INTEGER NOT NULL,
  "kind" "BotDispatchKind" NOT NULL,
  "status" "BotDispatchStatus" NOT NULL DEFAULT 'CLAIMED',
  "claimToken" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedUntil" TIMESTAMP(3) NOT NULL,
  "providerMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotDispatchClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotDispatchClaim_claimToken_key" ON "BotDispatchClaim"("claimToken");
CREATE INDEX IF NOT EXISTS "BotDispatchClaim_businessId_channel_kind_status_idx"
  ON "BotDispatchClaim"("businessId", "channel", "kind", "status");
CREATE INDEX IF NOT EXISTS "BotDispatchClaim_kind_resourceId_status_idx"
  ON "BotDispatchClaim"("kind", "resourceId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "BotDispatchClaim_active_resource_key"
  ON "BotDispatchClaim"("kind", "engineKey", "resourceId")
  WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED', 'SENDING', 'UNKNOWN');
CREATE INDEX IF NOT EXISTS "BotDispatchClaim_status_claimedUntil_idx"
  ON "BotDispatchClaim"("status", "claimedUntil");
ALTER TABLE "BotDispatchClaim" DROP CONSTRAINT IF EXISTS "BotDispatchClaim_businessId_sessionId_fkey";
ALTER TABLE "BotDispatchClaim" ADD CONSTRAINT "BotDispatchClaim_businessId_sessionId_fkey"
  FOREIGN KEY ("businessId", "sessionId") REFERENCES "BotSession"("businessId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BotDispatchClaim" VALIDATE CONSTRAINT "BotDispatchClaim_businessId_sessionId_fkey";

CREATE TABLE IF NOT EXISTS "BotTransitionLog" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "deploymentGeneration" INTEGER NOT NULL,
  "revisionFrom" BIGINT NOT NULL,
  "revisionTo" BIGINT NOT NULL,
  "actionType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "promptId" TEXT,
  "providerEventId" TEXT,
  "durationMs" INTEGER,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotTransitionLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotTransitionLog_sessionId_revisionTo_key"
  ON "BotTransitionLog"("sessionId", "revisionTo");
CREATE INDEX IF NOT EXISTS "BotTransitionLog_businessId_createdAt_idx"
  ON "BotTransitionLog"("businessId", "createdAt");

CREATE TABLE IF NOT EXISTS "BotOperation" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "resultRef" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotOperation_operationKey_key" ON "BotOperation"("operationKey");
CREATE INDEX IF NOT EXISTS "BotOperation_businessId_status_idx" ON "BotOperation"("businessId", "status");
CREATE INDEX IF NOT EXISTS "BotOperation_sessionId_createdAt_idx" ON "BotOperation"("sessionId", "createdAt");
