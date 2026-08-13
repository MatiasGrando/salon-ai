ALTER TABLE "Appointment"
ADD COLUMN "coordinationGroupId" TEXT;

CREATE INDEX "Appointment_coordinationGroupId_idx"
ON "Appointment"("coordinationGroupId");
