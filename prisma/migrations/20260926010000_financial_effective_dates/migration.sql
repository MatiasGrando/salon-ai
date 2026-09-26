ALTER TABLE "TreasuryMovement"
  ADD COLUMN "effectiveAt" TIMESTAMP(3),
  ADD COLUMN "correctionSourceId" TEXT,
  ADD COLUMN "correctionRole" TEXT,
  ADD COLUMN "correctionReason" TEXT;

UPDATE "TreasuryMovement" SET "effectiveAt" = "createdAt";
ALTER TABLE "TreasuryMovement"
  ALTER COLUMN "effectiveAt" SET NOT NULL,
  ALTER COLUMN "effectiveAt" SET DEFAULT clock_timestamp();

ALTER TABLE "CashEntry"
  ADD COLUMN "correctionSourceId" TEXT,
  ADD COLUMN "correctionReason" TEXT;

CREATE UNIQUE INDEX "TreasuryMovement_businessId_correctionSourceId_correctionRole_key"
  ON "TreasuryMovement"("businessId", "correctionSourceId", "correctionRole");
CREATE INDEX "TreasuryMovement_effectiveAt_id_idx"
  ON "TreasuryMovement"("businessId", "effectiveAt", "id");
CREATE UNIQUE INDEX "CashEntry_businessId_correctionSourceId_key"
  ON "CashEntry"("businessId", "correctionSourceId");

ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_correctionSourceId_fkey"
  FOREIGN KEY ("businessId", "correctionSourceId") REFERENCES "TreasuryMovement"("businessId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_correctionSourceId_fkey"
  FOREIGN KEY ("businessId", "correctionSourceId") REFERENCES "CashEntry"("businessId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;