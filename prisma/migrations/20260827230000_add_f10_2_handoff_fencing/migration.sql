-- F10.2 is strictly additive. It does not activate ingress, workers or sender.
ALTER TABLE "BotSession"
  ADD COLUMN "handoffClaimsPausedAt" TIMESTAMP(3),
  ADD COLUMN "handoffFenceEpoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BotDispatchClaim" ADD COLUMN "handoffFenceEpoch" INTEGER;

-- The session lock serializes normal writers; this partial uniqueness is the
-- durable backstop against a second distinct TAKE becoming STARTED.
CREATE UNIQUE INDEX "BotOperation_one_started_handoff_take_per_session"
  ON "BotOperation"("businessId", "sessionId", "type")
  WHERE "type" = 'HANDOFF_TAKE' AND "status" = 'STARTED';

ALTER TABLE "BotHandoff" DROP CONSTRAINT "BotHandoff_f10_1_timestamp_consistency";
ALTER TABLE "BotHandoff" ADD CONSTRAINT "BotHandoff_f10_2_timestamp_consistency" CHECK (
  ("status" = 'QUEUED' AND "cancelledAt" IS NULL AND "ownerUserId" IS NULL AND "takenAt" IS NULL AND "resolvedAt" IS NULL AND "resumePolicy" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledAt" >= "queuedAt" AND "ownerUserId" IS NULL AND "takenAt" IS NULL AND "resolvedAt" IS NULL AND "resumePolicy" IS NULL)
  OR ("status" = 'TAKEN' AND "cancelledAt" IS NULL AND "ownerUserId" IS NOT NULL AND "takenAt" IS NOT NULL AND "takenAt" >= "queuedAt" AND "resolvedAt" IS NULL AND "resumePolicy" IS NULL)
  OR ("status" = 'RESOLVED' AND "cancelledAt" IS NULL AND "ownerUserId" IS NOT NULL AND "takenAt" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "takenAt" AND "resumePolicy" IN ('HOME', 'RESUME'))
);

CREATE TABLE "BotHandoffAudit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT,
  "operationKey" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotHandoffAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BotHandoffAudit_handoff_operation_action_key" UNIQUE ("handoffId", "operationKey", "action"),
  CONSTRAINT "BotHandoffAudit_businessId_handoffId_fkey" FOREIGN KEY ("businessId", "handoffId") REFERENCES "BotHandoff"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BotHandoffAudit_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "BotSession"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BotHandoffAudit_businessId_sessionId_createdAt_idx" ON "BotHandoffAudit"("businessId", "sessionId", "createdAt");

-- Ownership evidence is forensic history, never operational state.  This is a
-- database invariant, rather than a convention dependent on the runtime role.
CREATE FUNCTION "prevent_BotHandoffAudit_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BotHandoffAudit is append-only';
END;
$$;
CREATE TRIGGER "BotHandoffAudit_append_only"
  BEFORE UPDATE OR DELETE ON "BotHandoffAudit"
  FOR EACH ROW EXECUTE FUNCTION "prevent_BotHandoffAudit_mutation"();
