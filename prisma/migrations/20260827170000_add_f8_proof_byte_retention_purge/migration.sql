-- F8 retention is byte-only: proof identity, validation facts, hashes, sizes,
-- filename, sequence, timestamps and all aggregate data remain queryable.
ALTER TABLE "BookingDepositProof"
  ALTER COLUMN "sourceData" DROP NOT NULL,
  ALTER COLUMN "derivedData" DROP NOT NULL,
  ADD COLUMN "purgedAt" TIMESTAMP(3),
  ADD COLUMN "purgeReason" TEXT;

ALTER TABLE "BookingDepositProof"
  DROP CONSTRAINT "BookingDepositProof_source_size_valid",
  DROP CONSTRAINT "BookingDepositProof_derived_size_valid",
  ADD CONSTRAINT "BookingDepositProof_source_size_valid"
    CHECK ("sourceData" IS NULL OR ("sourceByteSize" > 0 AND "sourceByteSize" <= 3145728 AND octet_length("sourceData") = "sourceByteSize")),
  ADD CONSTRAINT "BookingDepositProof_derived_size_valid"
    CHECK ("derivedData" IS NULL OR ("derivedByteSize" > 0 AND "derivedByteSize" <= 3145728 AND octet_length("derivedData") = "derivedByteSize")),
  ADD CONSTRAINT "BookingDepositProof_byte_retention_state"
    CHECK (
      ("sourceData" IS NOT NULL AND "derivedData" IS NOT NULL AND "purgedAt" IS NULL AND "purgeReason" IS NULL)
      OR
      ("sourceData" IS NULL AND "derivedData" IS NULL AND "purgedAt" IS NOT NULL AND "purgeReason" = 'RETENTION_12_MONTHS')
    );

CREATE INDEX "BookingDepositProof_businessId_retentionEligibleAt_idx"
  ON "BookingDepositProof"("businessId", "retentionEligibleAt");

CREATE TABLE "BookingDepositProofPurgeOperation" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "businessId" TEXT,
  "reason" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "selectedCount" INTEGER NOT NULL DEFAULT 0,
  "purgedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BookingDepositProofPurgeOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingDepositProofPurgeOperation_operationKey_key" UNIQUE ("operationKey"),
  CONSTRAINT "BookingDepositProofPurgeOperation_scope_valid" CHECK ("scope" IN ('GLOBAL', 'BUSINESS')),
  CONSTRAINT "BookingDepositProofPurgeOperation_scope_business_valid" CHECK (("scope" = 'GLOBAL' AND "businessId" IS NULL) OR ("scope" = 'BUSINESS' AND "businessId" IS NOT NULL)),
  CONSTRAINT "BookingDepositProofPurgeOperation_reason_valid" CHECK ("reason" = 'RETENTION_12_MONTHS'),
  CONSTRAINT "BookingDepositProofPurgeOperation_status_valid" CHECK ("status" = 'COMPLETED')
);
CREATE INDEX "BookingDepositProofPurgeOperation_businessId_createdAt_idx"
  ON "BookingDepositProofPurgeOperation"("businessId", "createdAt");

CREATE TABLE "BookingDepositProofPurgeAudit" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "proofId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "purgedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDepositProofPurgeAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingDepositProofPurgeAudit_operationId_proofId_key" UNIQUE ("operationId", "proofId"),
  CONSTRAINT "BookingDepositProofPurgeAudit_reason_valid" CHECK ("reason" = 'RETENTION_12_MONTHS'),
  CONSTRAINT "BookingDepositProofPurgeAudit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BookingDepositProofPurgeOperation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BookingDepositProofPurgeAudit_businessId_proofId_createdAt_idx"
  ON "BookingDepositProofPurgeAudit"("businessId", "proofId", "createdAt");

-- The original append-only trigger is replaced by this deliberately narrow
-- exception. The DB owns both due-time evaluation and purgedAt, so application
-- clocks and direct SQL cannot advance retention or restore bytes.
CREATE OR REPLACE FUNCTION "reject_booking_deposit_proof_update"() RETURNS trigger AS $$
BEGIN
  IF OLD."sourceData" IS NOT NULL
    AND OLD."derivedData" IS NOT NULL
    AND OLD."purgedAt" IS NULL
    AND OLD."purgeReason" IS NULL
    AND OLD."retentionEligibleAt" <= clock_timestamp()
    AND NEW."sourceData" IS NULL
    AND NEW."derivedData" IS NULL
    AND NEW."purgeReason" = 'RETENTION_12_MONTHS'
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId"
    AND NEW."depositId" IS NOT DISTINCT FROM OLD."depositId"
    AND NEW."sequence" IS NOT DISTINCT FROM OLD."sequence"
    AND NEW."kind" IS NOT DISTINCT FROM OLD."kind"
    AND NEW."validationStatus" IS NOT DISTINCT FROM OLD."validationStatus"
    AND NEW."validatorVersion" IS NOT DISTINCT FROM OLD."validatorVersion"
    AND NEW."validatedAt" IS NOT DISTINCT FROM OLD."validatedAt"
    AND NEW."receivedAt" IS NOT DISTINCT FROM OLD."receivedAt"
    AND NEW."providerEventId" IS NOT DISTINCT FROM OLD."providerEventId"
    AND NEW."providerMessageId" IS NOT DISTINCT FROM OLD."providerMessageId"
    AND NEW."providerMediaId" IS NOT DISTINCT FROM OLD."providerMediaId"
    AND NEW."sourceMimeType" IS NOT DISTINCT FROM OLD."sourceMimeType"
    AND NEW."sourceFilename" IS NOT DISTINCT FROM OLD."sourceFilename"
    AND NEW."sourceByteSize" IS NOT DISTINCT FROM OLD."sourceByteSize"
    AND NEW."sourceSha256" IS NOT DISTINCT FROM OLD."sourceSha256"
    AND NEW."derivedMimeType" IS NOT DISTINCT FROM OLD."derivedMimeType"
    AND NEW."derivedByteSize" IS NOT DISTINCT FROM OLD."derivedByteSize"
    AND NEW."derivedSha256" IS NOT DISTINCT FROM OLD."derivedSha256"
    AND NEW."retentionEligibleAt" IS NOT DISTINCT FROM OLD."retentionEligibleAt"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    NEW."purgedAt" := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BookingDepositProof permits only one-way due byte purge';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "assert_booking_deposit_proof_sequence"() RETURNS trigger AS $$
DECLARE
  last_sequence INTEGER;
BEGIN
  IF NEW."sourceData" IS NULL OR NEW."derivedData" IS NULL OR NEW."purgedAt" IS NOT NULL OR NEW."purgeReason" IS NOT NULL THEN
    RAISE EXCEPTION 'BookingDepositProof must be inserted with retained bytes';
  END IF;
  PERFORM 1 FROM "BookingDeposit"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."depositId"
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BookingDepositProof must reference an existing tenant-scoped deposit'; END IF;
  SELECT max("sequence") INTO last_sequence FROM "BookingDepositProof"
  WHERE "businessId" = NEW."businessId" AND "depositId" = NEW."depositId";
  IF NEW."sequence" <> COALESCE(last_sequence, 0) + 1 THEN RAISE EXCEPTION 'BookingDepositProof sequence must append contiguously per deposit'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_booking_deposit_proof_purge_audit_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'BookingDepositProofPurgeAudit is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BookingDepositProofPurgeAudit_reject_mutation"
  BEFORE UPDATE OR DELETE ON "BookingDepositProofPurgeAudit"
  FOR EACH ROW EXECUTE FUNCTION "reject_booking_deposit_proof_purge_audit_mutation"();
