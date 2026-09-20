CREATE TYPE "AppointmentCompletionSource" AS ENUM ('LEGACY', 'MANUAL', 'FULL_PAYMENT');

ALTER TABLE "Appointment"
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedByUserId" TEXT,
  ADD COLUMN "completedByName" TEXT,
  ADD COLUMN "completionSource" "AppointmentCompletionSource";

UPDATE "Appointment"
SET "completedAt" = GREATEST("startAt", "createdAt"),
    "completedByName" = 'Registro anterior',
    "completionSource" = 'LEGACY'::"AppointmentCompletionSource"
WHERE "status" = 'COMPLETED'::"AppointmentStatus";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_completion_metadata_check"
  CHECK (
    ("completedAt" IS NULL AND "completedByUserId" IS NULL AND "completedByName" IS NULL AND "completionSource" IS NULL)
    OR
    ("status" = 'COMPLETED'::"AppointmentStatus" AND "completedAt" IS NOT NULL AND "completedByName" IS NOT NULL AND "completionSource" IS NOT NULL)
  );

CREATE INDEX "Appointment_businessId_status_completedAt_idx"
  ON "Appointment"("businessId", "status", "completedAt");
