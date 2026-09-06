ALTER TABLE "User"
  ADD COLUMN "canViewCashRegister" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canRecordAppointmentPayments" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canApplyDiscounts" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageCashOperations" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canAdjustCash" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageCashSessions" BOOLEAN NOT NULL DEFAULT false;
