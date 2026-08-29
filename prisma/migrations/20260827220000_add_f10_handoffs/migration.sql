-- F10.1: durable queue/cancellation only. TAKE/RESOLVE columns are reserved
-- for the documented future shape but no runtime/CRM behavior is enabled here.
CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED', 'TAKEN', 'CANCELLED', 'RESOLVED');

CREATE TABLE "BotHandoff" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" "BotHandoffStatus" NOT NULL DEFAULT 'QUEUED',
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "context" JSONB,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "ownerUserId" TEXT,
  "takenAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resumePolicy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BotHandoff_businessId_id_key" UNIQUE ("businessId", "id"),
  CONSTRAINT "BotHandoff_reason_nonblank" CHECK (btrim("reason") <> ''),
  -- F10.1 may only create QUEUED or transition it to CANCELLED. Future states
  -- remain representable without weakening queue/cancellation consistency.
  CONSTRAINT "BotHandoff_f10_1_timestamp_consistency" CHECK (
    ("status" <> 'QUEUED' OR ("cancelledAt" IS NULL AND "ownerUserId" IS NULL AND "takenAt" IS NULL AND "resolvedAt" IS NULL AND "resumePolicy" IS NULL))
    AND ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledAt" >= "queuedAt" AND "ownerUserId" IS NULL AND "takenAt" IS NULL AND "resolvedAt" IS NULL AND "resumePolicy" IS NULL))
  )
);

ALTER TABLE "BotHandoff" ADD CONSTRAINT "BotHandoff_businessId_sessionId_fkey"
  FOREIGN KEY ("businessId", "sessionId") REFERENCES "BotSession"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deployment requires quiescence: runtime is documented OFF, and no pre-F10
-- writer may change BotSession.status between this snapshot and completion.
-- The stable session identity produces exactly one non-PII legacy queue record
-- for every pre-existing HUMAN_QUEUED session before active uniqueness applies.
INSERT INTO "BotHandoff" (
  "id", "businessId", "sessionId", "status", "reason", "detail", "context", "queuedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-f10-' || md5("businessId" || ':' || "id"),
  "businessId",
  "id",
  'QUEUED'::"BotHandoffStatus",
  'LEGACY_HUMAN_QUEUED_BACKFILL',
  'Created by F10.1 migration for a pre-existing queued human handoff.',
  jsonb_build_object('source', 'F10.1_migration', 'legacyStatus', 'HUMAN_QUEUED'),
  "updatedAt",
  "createdAt",
  "updatedAt"
FROM "BotSession"
WHERE "status" = 'HUMAN_QUEUED'::"BotSessionStatus";

CREATE INDEX "BotHandoff_businessId_sessionId_queuedAt_idx" ON "BotHandoff"("businessId", "sessionId", "queuedAt");
CREATE UNIQUE INDEX "BotHandoff_one_active_per_session"
  ON "BotHandoff"("businessId", "sessionId") WHERE "status" IN ('QUEUED', 'TAKEN');
