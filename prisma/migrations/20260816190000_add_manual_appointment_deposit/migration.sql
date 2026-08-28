ALTER TABLE "Appointment"
ADD COLUMN "manualDepositPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "manualDepositAmount" INTEGER;
