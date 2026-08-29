CREATE TYPE "BookingDepositProofKind" AS ENUM ('INITIAL', 'RESUBMISSION', 'LATE');
CREATE TYPE "BookingDepositProofValidationStatus" AS ENUM ('VALID');

CREATE TABLE "BookingDepositProof" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" "BookingDepositProofKind" NOT NULL,
  "validationStatus" "BookingDepositProofValidationStatus" NOT NULL DEFAULT 'VALID',
  "validatorVersion" TEXT NOT NULL,
  "validatedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "sourceData" BYTEA NOT NULL,
  "sourceMimeType" TEXT NOT NULL,
  "sourceFilename" TEXT NOT NULL,
  "sourceByteSize" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "derivedData" BYTEA NOT NULL,
  "derivedMimeType" TEXT NOT NULL,
  "derivedByteSize" INTEGER NOT NULL,
  "derivedSha256" TEXT NOT NULL,
  "retentionEligibleAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDepositProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingDepositProof_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "BookingDepositProof_source_size_valid" CHECK ("sourceByteSize" > 0 AND "sourceByteSize" <= 3145728 AND octet_length("sourceData") = "sourceByteSize"),
  CONSTRAINT "BookingDepositProof_derived_size_valid" CHECK ("derivedByteSize" > 0 AND "derivedByteSize" <= 3145728 AND octet_length("derivedData") = "derivedByteSize"),
  CONSTRAINT "BookingDepositProof_source_sha256_valid" CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "BookingDepositProof_derived_sha256_valid" CHECK ("derivedSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "BookingDepositProof_source_mime_allowed" CHECK ("sourceMimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "BookingDepositProof_derived_mime_webp" CHECK ("derivedMimeType" = 'image/webp'),
  CONSTRAINT "BookingDepositProof_filename_nonempty" CHECK (length("sourceFilename") > 0),
  CONSTRAINT "BookingDepositProof_retention_after_receipt" CHECK ("retentionEligibleAt" >= "receivedAt")
);

CREATE UNIQUE INDEX "BookingDepositProof_businessId_id_key" ON "BookingDepositProof"("businessId", "id");
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_sequence_key" ON "BookingDepositProof"("businessId", "depositId", "sequence");
CREATE INDEX "BookingDepositProof_businessId_depositId_receivedAt_idx" ON "BookingDepositProof"("businessId", "depositId", "receivedAt");
CREATE INDEX "BookingDepositProof_retentionEligibleAt_idx" ON "BookingDepositProof"("retentionEligibleAt");

ALTER TABLE "BookingDepositProof"
  ADD CONSTRAINT "BookingDepositProof_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BookingDepositProof_businessId_depositId_fkey"
  FOREIGN KEY ("businessId", "depositId") REFERENCES "BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lock the root before deriving the next sequence. This makes concurrent
-- appenders serialize per deposit without coupling the evidence writer to any
-- runtime transition. A gap or duplicate is rejected rather than guessed.
CREATE FUNCTION "assert_booking_deposit_proof_sequence"() RETURNS trigger AS $$
DECLARE
  last_sequence INTEGER;
BEGIN
  PERFORM 1 FROM "BookingDeposit"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."depositId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BookingDepositProof must reference an existing tenant-scoped deposit';
  END IF;
  SELECT max("sequence") INTO last_sequence
  FROM "BookingDepositProof"
  WHERE "businessId" = NEW."businessId" AND "depositId" = NEW."depositId";
  IF NEW."sequence" <> COALESCE(last_sequence, 0) + 1 THEN
    RAISE EXCEPTION 'BookingDepositProof sequence must append contiguously per deposit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_booking_deposit_proof_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BookingDepositProof is append-only';
END;
$$ LANGUAGE plpgsql;

-- Like the existing F8 financial snapshot/audit triggers, a normal delete is
-- rejected while its aggregate remains. The deferred check permits a future,
-- explicitly authorised transaction that deletes the aggregate and all of its
-- immutable evidence together; no purge worker is introduced here.
CREATE FUNCTION "assert_booking_deposit_proof_retained"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositProof is immutable while its deposit exists';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingDepositProof_assert_sequence"
  BEFORE INSERT ON "BookingDepositProof"
  FOR EACH ROW EXECUTE FUNCTION "assert_booking_deposit_proof_sequence"();
CREATE TRIGGER "BookingDepositProof_reject_update"
  BEFORE UPDATE ON "BookingDepositProof"
  FOR EACH ROW EXECUTE FUNCTION "reject_booking_deposit_proof_update"();
CREATE CONSTRAINT TRIGGER "BookingDepositProof_reject_retained_delete"
  AFTER DELETE ON "BookingDepositProof"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_booking_deposit_proof_retained"();
