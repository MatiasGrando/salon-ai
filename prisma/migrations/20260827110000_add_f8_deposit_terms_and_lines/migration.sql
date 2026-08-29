CREATE TYPE "BookingDepositTtlProvenance" AS ENUM ('BUSINESS_POLICY', 'DEFAULT_120');

ALTER TABLE "BusinessBotOptionsSettings"
  ADD COLUMN "depositHoldMinutes" INTEGER;

ALTER TABLE "BookingDeposit"
  ADD COLUMN "visitId" TEXT,
  ADD COLUMN "holdTtlMinutes" INTEGER,
  ADD COLUMN "holdTtlProvenance" "BookingDepositTtlProvenance",
  ADD COLUMN "snapshotSealedAt" TIMESTAMP(3),
  ADD COLUMN "expiredAt" TIMESTAMP(3),
  ADD COLUMN "expirationReason" TEXT;

CREATE UNIQUE INDEX "Service_businessId_id_key" ON "Service"("businessId", "id");
CREATE UNIQUE INDEX "BookingDeposit_businessId_id_key" ON "BookingDeposit"("businessId", "id");
-- PostgreSQL unique constraints permit multiple NULLs, so a regular index is
-- equivalent to the intended F8 invariant and matches Prisma @@unique.
CREATE UNIQUE INDEX "BookingDeposit_businessId_visitId_key" ON "BookingDeposit"("businessId", "visitId");

ALTER TABLE "BookingDeposit"
  ADD CONSTRAINT "BookingDeposit_visitId_fkey"
  FOREIGN KEY ("businessId", "visitId") REFERENCES "BookingVisit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Appointment lacks a businessId column in the legacy schema. For F8 rows,
-- validate the complete aggregate at the database boundary instead of trusting
-- application callers to keep appointmentId, visitId and tenant aligned.
CREATE FUNCTION "assert_f8_booking_deposit_aggregate"() RETURNS trigger AS $$
BEGIN
  IF NEW."visitId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Appointment" a
    JOIN "BookingVisit" v ON v."id" = a."visitId" AND v."businessId" = NEW."businessId"
    WHERE a."id" = NEW."appointmentId" AND a."visitId" = NEW."visitId"
  ) THEN
    RAISE EXCEPTION 'F8 BookingDeposit must reference an appointment in its tenant-scoped visit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingDeposit_assert_f8_aggregate"
  BEFORE INSERT OR UPDATE OF "businessId", "appointmentId", "visitId" ON "BookingDeposit"
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_booking_deposit_aggregate"();

CREATE TABLE "BookingDepositLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "serviceName" TEXT NOT NULL,
  "mode" "ServiceDepositMode" NOT NULL,
  "configuredValue" INTEGER NOT NULL,
  "baseAmount" INTEGER,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDepositLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingDepositLine_depositId_sortOrder_key" ON "BookingDepositLine"("depositId", "sortOrder");
CREATE UNIQUE INDEX "BookingDepositLine_depositId_serviceId_key" ON "BookingDepositLine"("depositId", "serviceId");
CREATE INDEX "BookingDepositLine_businessId_depositId_idx" ON "BookingDepositLine"("businessId", "depositId");
CREATE INDEX "BookingDepositLine_businessId_serviceId_idx" ON "BookingDepositLine"("businessId", "serviceId");

ALTER TABLE "BookingDepositLine"
  ADD CONSTRAINT "BookingDepositLine_businessId_depositId_fkey"
  FOREIGN KEY ("businessId", "depositId") REFERENCES "BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingDepositLine"
  ADD CONSTRAINT "BookingDepositLine_businessId_serviceId_fkey"
  FOREIGN KEY ("businessId", "serviceId") REFERENCES "Service"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessBotOptionsSettings"
  ADD CONSTRAINT "BusinessBotOptionsSettings_depositHoldMinutes_positive"
  CHECK ("depositHoldMinutes" IS NULL OR "depositHoldMinutes" > 0);
ALTER TABLE "BookingDeposit"
  ADD CONSTRAINT "BookingDeposit_f8_hold_terms_complete"
  CHECK (("visitId" IS NULL AND "holdTtlMinutes" IS NULL AND "holdTtlProvenance" IS NULL)
      OR ("visitId" IS NOT NULL AND "holdTtlMinutes" > 0 AND "holdTtlProvenance" IS NOT NULL));
ALTER TABLE "BookingDepositLine"
  ADD CONSTRAINT "BookingDepositLine_amount_nonnegative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "BookingDepositLine_configuredValue_positive" CHECK ("configuredValue" > 0),
  ADD CONSTRAINT "BookingDepositLine_percentage_range" CHECK ("mode" <> 'PERCENTAGE' OR "configuredValue" <= 100),
  ADD CONSTRAINT "BookingDepositLine_base_by_mode" CHECK (("mode" = 'PERCENTAGE' AND "baseAmount" > 0) OR ("mode" <> 'PERCENTAGE' AND "baseAmount" IS NULL));

-- Lines are the F8 financial snapshot. A line must belong to a service that
-- was selected on this deposit's appointment, and its content cannot change
-- after capture. Aggregate deletion remains possible only together with the
-- root record (for a future authorised retention purge).
CREATE FUNCTION "assert_f8_deposit_line_membership"() RETURNS trigger AS $$
DECLARE
  target_appointment_id TEXT;
  sealed_at TIMESTAMP(3);
BEGIN
  -- Serialize against a visible unsealed root (for example, a controlled
  -- legacy-to-F8 conversion): a concurrent append waits, then observes the
  -- committed seal and is rejected. An uncommitted new root is fail-closed
  -- as absent because PostgreSQL does not expose it under READ COMMITTED.
  SELECT "appointmentId", "snapshotSealedAt"
  INTO target_appointment_id, sealed_at
  FROM "BookingDeposit"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."depositId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BookingDepositLine must reference an existing deposit';
  END IF;
  IF sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'BookingDepositLine cannot be appended after its snapshot is sealed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "AppointmentServiceItem" i
    WHERE i."appointmentId" = target_appointment_id AND i."serviceId" = NEW."serviceId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositLine service must be selected on the deposit appointment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_f8_booking_deposit_terms_update"() RETURNS trigger AS $$
BEGIN
  -- While sealed, the only permitted change in this F8 increment is the
  -- F8.6 expiry transition. Proof/review writers are deliberately not yet
  -- authorised until F8.4/F8.5 defines their guarded transitions.
  IF OLD."visitId" IS NOT NULL AND OLD."snapshotSealedAt" IS NOT NULL AND NOT (
    NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId"
    AND NEW."appointmentId" IS NOT DISTINCT FROM OLD."appointmentId"
    AND NEW."conversationId" IS NOT DISTINCT FROM OLD."conversationId"
    AND NEW."visitId" IS NOT DISTINCT FROM OLD."visitId"
    AND NEW."source" IS NOT DISTINCT FROM OLD."source"
    AND NEW."mode" IS NOT DISTINCT FROM OLD."mode"
    AND NEW."configuredValue" IS NOT DISTINCT FROM OLD."configuredValue"
    AND NEW."baseAmount" IS NOT DISTINCT FROM OLD."baseAmount"
    AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
    AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt"
    AND NEW."holdTtlMinutes" IS NOT DISTINCT FROM OLD."holdTtlMinutes"
    AND NEW."holdTtlProvenance" IS NOT DISTINCT FROM OLD."holdTtlProvenance"
    AND NEW."snapshotSealedAt" IS NOT DISTINCT FROM OLD."snapshotSealedAt"
    AND NEW."proofMessageId" IS NOT DISTINCT FROM OLD."proofMessageId"
    AND NEW."proofData" IS NOT DISTINCT FROM OLD."proofData"
    AND NEW."proofMimeType" IS NOT DISTINCT FROM OLD."proofMimeType"
    AND NEW."proofFilename" IS NOT DISTINCT FROM OLD."proofFilename"
    AND NEW."reviewedAt" IS NOT DISTINCT FROM OLD."reviewedAt"
    AND NEW."reviewedByUserId" IS NOT DISTINCT FROM OLD."reviewedByUserId"
    AND NEW."rejectionReason" IS NOT DISTINCT FROM OLD."rejectionReason"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    AND OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus"
    AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
    AND NEW."expiredAt" IS NOT NULL
    AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED'
  ) THEN
    RAISE EXCEPTION 'sealed F8 BookingDeposit terms are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_booking_deposit_line_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BookingDepositLine is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "assert_f8_deposit_line_total"() RETURNS trigger AS $$
DECLARE
  target_deposit_id TEXT;
  target_business_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'BookingDeposit' THEN
    target_deposit_id := NEW."id";
    target_business_id := NEW."businessId";
  ELSIF TG_OP = 'DELETE' THEN
    target_deposit_id := OLD."depositId";
    target_business_id := OLD."businessId";
  ELSE
    target_deposit_id := NEW."depositId";
    target_business_id := NEW."businessId";
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit" d
    WHERE d."id" = target_deposit_id
      AND d."businessId" = target_business_id
      AND d."visitId" IS NOT NULL
      AND d."amount" <> COALESCE((
        SELECT sum(l."amount")::int
        FROM "BookingDepositLine" l
        WHERE l."depositId" = d."id" AND l."businessId" = d."businessId"
      ), 0)
  ) THEN
    RAISE EXCEPTION 'BookingDeposit amount must equal its immutable line total';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "assert_f8_deposit_line_retained"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositLine is immutable while its deposit exists';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingDepositLine_assert_membership"
  BEFORE INSERT ON "BookingDepositLine"
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_deposit_line_membership"();

CREATE TRIGGER "BookingDeposit_reject_sealed_terms_update"
  BEFORE UPDATE ON "BookingDeposit"
  FOR EACH ROW EXECUTE FUNCTION "reject_f8_booking_deposit_terms_update"();

CREATE TRIGGER "BookingDepositLine_reject_update"
  BEFORE UPDATE ON "BookingDepositLine"
  FOR EACH ROW EXECUTE FUNCTION "reject_booking_deposit_line_update"();

CREATE CONSTRAINT TRIGGER "BookingDepositLine_assert_total"
  AFTER INSERT OR DELETE ON "BookingDepositLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_deposit_line_total"();

CREATE CONSTRAINT TRIGGER "BookingDepositLine_reject_retained_delete"
  AFTER DELETE ON "BookingDepositLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_deposit_line_retained"();

CREATE CONSTRAINT TRIGGER "BookingDeposit_assert_line_total"
  AFTER INSERT OR UPDATE OF "amount", "snapshotSealedAt" ON "BookingDeposit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_deposit_line_total"();

CREATE FUNCTION "assert_f8_deposit_snapshot_sealed"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit" d
    WHERE d."id" = NEW."id" AND d."businessId" = NEW."businessId"
      AND d."visitId" IS NOT NULL AND d."snapshotSealedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'F8 BookingDeposit snapshot must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BookingDeposit_require_snapshot_seal"
  AFTER INSERT OR UPDATE OF "snapshotSealedAt" ON "BookingDeposit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_deposit_snapshot_sealed"();

CREATE TABLE "BookingDepositExpiryAudit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "expiredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDepositExpiryAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingDepositExpiryAudit_depositId_key" ON "BookingDepositExpiryAudit"("depositId");
CREATE UNIQUE INDEX "BookingDepositExpiryAudit_businessId_depositId_key" ON "BookingDepositExpiryAudit"("businessId", "depositId");
CREATE INDEX "BookingDepositExpiryAudit_businessId_expiredAt_idx" ON "BookingDepositExpiryAudit"("businessId", "expiredAt");
CREATE INDEX "BookingDepositExpiryAudit_businessId_visitId_idx" ON "BookingDepositExpiryAudit"("businessId", "visitId");

ALTER TABLE "BookingDepositExpiryAudit"
  ADD CONSTRAINT "BookingDepositExpiryAudit_businessId_depositId_fkey"
  FOREIGN KEY ("businessId", "depositId") REFERENCES "BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_booking_deposit_expiry_audit_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BookingDepositExpiryAudit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingDepositExpiryAudit_reject_update"
  BEFORE UPDATE ON "BookingDepositExpiryAudit"
  FOR EACH ROW EXECUTE FUNCTION "reject_booking_deposit_expiry_audit_update"();

-- Deletion is rejected while the parent aggregate exists. It remains allowed
-- in the same transaction as deleting that root, so an authorised retention
-- purge does not need to bypass a database security control.
CREATE FUNCTION "assert_booking_deposit_expiry_audit_retained"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositExpiryAudit is append-only while its deposit exists';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BookingDepositExpiryAudit_reject_retained_delete"
  AFTER DELETE ON "BookingDepositExpiryAudit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_booking_deposit_expiry_audit_retained"();
