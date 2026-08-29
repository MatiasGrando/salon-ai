ALTER TABLE "BookingDepositProof"
  ADD COLUMN "providerEventId" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerMediaId" TEXT;

-- NULL provider identifiers remain intentionally repeatable. A supplied
-- provider identity and a source byte hash are each idempotency keys only
-- inside the tenant/deposit aggregate; no cross-tenant evidence correlation.
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerEventId_key"
  ON "BookingDepositProof"("businessId", "depositId", "providerEventId");
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerMessageId_key"
  ON "BookingDepositProof"("businessId", "depositId", "providerMessageId");
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerMediaId_key"
  ON "BookingDepositProof"("businessId", "depositId", "providerMediaId");
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_sourceSha256_key"
  ON "BookingDepositProof"("businessId", "depositId", "sourceSha256");

-- The F8.5 writer may change only the operational status of a sealed root.
-- All financial, legacy-proof and expiry facts remain immutable. This replaces
-- the provisional F8.6-only allowlist, rather than weakening it wholesale.
CREATE OR REPLACE FUNCTION "reject_f8_booking_deposit_terms_update"() RETURNS trigger AS $$
BEGIN
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
    AND (
      (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus"
        AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
        AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt"
        AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason")
      OR
      (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus"
        AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
        AND NEW."expiredAt" IS NOT NULL
        AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED')
    )
  ) THEN
    RAISE EXCEPTION 'sealed F8 BookingDeposit terms are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A direct status flip cannot manufacture "proof received": at commit the
-- aggregate must contain retained append-only evidence. Deferred timing lets
-- the writer append first or update first within one atomic transaction.
CREATE FUNCTION "assert_f8_proof_received_evidence"() RETURNS trigger AS $$
BEGIN
  IF NEW."visitId" IS NOT NULL AND NEW."snapshotSealedAt" IS NOT NULL
    AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
    AND NOT EXISTS (
      SELECT 1 FROM "BookingDepositProof" p
      WHERE p."businessId" = NEW."businessId" AND p."depositId" = NEW."id"
    ) THEN
    RAISE EXCEPTION 'F8 PROOF_RECEIVED requires retained append-only evidence';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BookingDeposit_require_proof_evidence"
  AFTER UPDATE OF "status" ON "BookingDeposit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_f8_proof_received_evidence"();
