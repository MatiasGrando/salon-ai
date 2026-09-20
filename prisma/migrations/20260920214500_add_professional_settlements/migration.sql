ALTER TABLE "User"
  ADD COLUMN "canViewProfessionalSettlements" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageProfessionalSettlements" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ProfessionalCompensationMode" AS ENUM ('NONE', 'PERCENTAGE', 'FIXED');
CREATE TYPE "ProfessionalAccountEntryType" AS ENUM ('EARNING', 'PAYMENT', 'ADVANCE', 'ADJUSTMENT', 'REVERSAL');
CREATE TYPE "ProfessionalAccountDirection" AS ENUM ('CREDIT', 'DEBIT');
ALTER TABLE "Professional" ADD COLUMN "commissionMode" "ProfessionalCompensationMode" NOT NULL DEFAULT 'NONE', ADD COLUMN "commissionPercentage" DECIMAL(5,2), ADD COLUMN "commissionFixedAmount" INTEGER;
ALTER TABLE "ProfessionalService" ADD COLUMN "commissionMode" "ProfessionalCompensationMode", ADD COLUMN "commissionPercentage" DECIMAL(5,2), ADD COLUMN "commissionFixedAmount" INTEGER;
CREATE TABLE "ProfessionalAccountEntry" ("id" TEXT NOT NULL,"businessId" TEXT NOT NULL,"professionalId" TEXT NOT NULL,"appointmentId" TEXT,"cashEntryId" TEXT,"type" "ProfessionalAccountEntryType" NOT NULL,"direction" "ProfessionalAccountDirection" NOT NULL,"amount" INTEGER NOT NULL,"baseAmount" INTEGER,"ruleMode" "ProfessionalCompensationMode","rulePercentage" DECIMAL(5,2),"ruleFixedAmount" INTEGER,"description" TEXT,"actorUserId" TEXT,"actorName" TEXT NOT NULL,"effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "ProfessionalAccountEntry_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ProfessionalAccountEntry_businessId_id_key" ON "ProfessionalAccountEntry"("businessId","id");
CREATE UNIQUE INDEX "ProfessionalAccountEntry_businessId_appointmentId_key" ON "ProfessionalAccountEntry"("businessId","appointmentId");
CREATE UNIQUE INDEX "ProfessionalAccountEntry_businessId_cashEntryId_key" ON "ProfessionalAccountEntry"("businessId","cashEntryId");
CREATE INDEX "ProfessionalAccountEntry_businessId_professionalId_effectiveAt_id_idx" ON "ProfessionalAccountEntry"("businessId","professionalId","effectiveAt","id");
ALTER TABLE "ProfessionalAccountEntry" ADD CONSTRAINT "ProfessionalAccountEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalAccountEntry" ADD CONSTRAINT "ProfessionalAccountEntry_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalAccountEntry" ADD CONSTRAINT "ProfessionalAccountEntry_businessId_appointmentId_fkey" FOREIGN KEY ("businessId","appointmentId") REFERENCES "Appointment"("businessId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalAccountEntry" ADD CONSTRAINT "ProfessionalAccountEntry_businessId_cashEntryId_fkey" FOREIGN KEY ("businessId","cashEntryId") REFERENCES "CashEntry"("businessId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
