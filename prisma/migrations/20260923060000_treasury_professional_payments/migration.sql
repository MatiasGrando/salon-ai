ALTER TABLE "ProfessionalAccountEntry" ADD COLUMN "treasuryMovementId" TEXT;
CREATE UNIQUE INDEX "ProfessionalAccountEntry_treasuryMovementId_key" ON "ProfessionalAccountEntry"("treasuryMovementId");
CREATE UNIQUE INDEX "ProfessionalAccountEntry_businessId_treasuryMovementId_key" ON "ProfessionalAccountEntry"("businessId", "treasuryMovementId");
ALTER TABLE "ProfessionalAccountEntry" ADD CONSTRAINT "ProfessionalAccountEntry_businessId_treasuryMovementId_fkey"
  FOREIGN KEY ("businessId", "treasuryMovementId") REFERENCES "TreasuryMovement"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
