ALTER TABLE "User"
ADD COLUMN "canCreateAppointments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "canEditAppointments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "canCancelAppointments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "canManageScheduleBlocks" BOOLEAN NOT NULL DEFAULT true;
