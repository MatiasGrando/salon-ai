CREATE TYPE "AppointmentOrigin" AS ENUM ('BOT', 'WEB', 'MANUAL', 'UNKNOWN');

ALTER TABLE "Appointment"
ADD COLUMN "origin" "AppointmentOrigin" NOT NULL DEFAULT 'UNKNOWN';

UPDATE "Appointment" AS appointment
SET "origin" = 'WEB'
FROM "BookingDeposit" AS deposit
WHERE deposit."appointmentId" = appointment."id"
  AND deposit."source" = 'WEB';

UPDATE "Appointment" AS appointment
SET "origin" = 'BOT'
WHERE appointment."origin" = 'UNKNOWN'
  AND (
    EXISTS (
      SELECT 1
      FROM "BookingDeposit" AS deposit
      WHERE deposit."appointmentId" = appointment."id"
        AND deposit."source" = 'WHATSAPP'
    )
    OR EXISTS (
      SELECT 1
      FROM "Conversation" AS conversation
      WHERE conversation."opportunityAppointmentId" = appointment."id"
    )
  );

UPDATE "Appointment"
SET "origin" = 'MANUAL'
WHERE "origin" = 'UNKNOWN'
  AND "manualDepositPaid" = true;
