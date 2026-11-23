ALTER TABLE "User" ADD COLUMN "canCompleteAppointments" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the ability previously granted through appointment editing.
UPDATE "User" SET "canCompleteAppointments" = "canEditAppointments";
