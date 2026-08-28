-- Reconcile pre-existing schema drift without mutating already-versioned migrations.
-- ReminderDelivery.updatedAt existed remotely via prior schema synchronization but
-- was absent from migration history. Backfill defensively before enforcing the
-- schema's @updatedAt contract (NOT NULL, no database default).
BEGIN;

ALTER TABLE "ReminderDelivery"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "ReminderDelivery"
SET "updatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;

ALTER TABLE "ReminderDelivery"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- PostgreSQL truncated the historical index identifier at 63 bytes. Rename it
-- to Prisma's stable shortened identifier, failing closed on an ambiguous pair.
DO $$
BEGIN
  IF to_regclass('public."CommunicationExecution_businessId_sourceType_sourceId_createdAt"') IS NOT NULL
     AND to_regclass('public."CommunicationExecution_businessId_sourceType_sourceId_creat_idx"') IS NOT NULL THEN
    RAISE EXCEPTION 'both historical and canonical CommunicationExecution indexes exist';
  END IF;

  IF to_regclass('public."CommunicationExecution_businessId_sourceType_sourceId_createdAt"') IS NOT NULL THEN
    ALTER INDEX "CommunicationExecution_businessId_sourceType_sourceId_createdAt"
      RENAME TO "CommunicationExecution_businessId_sourceType_sourceId_creat_idx";
  END IF;
END $$;

-- F4 used claimedUntil in two physical index names although both columns are
-- leasedUntil. Normalize names so migration replay and Prisma schema converge.
ALTER INDEX IF EXISTS "BotJob_status_claimedUntil_idx"
  RENAME TO "BotJob_status_leasedUntil_idx";
ALTER INDEX IF EXISTS "BotOutbox_status_claimedUntil_idx"
  RENAME TO "BotOutbox_status_leasedUntil_idx";

COMMIT;
