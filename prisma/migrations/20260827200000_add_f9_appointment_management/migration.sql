-- F9.1/F9.2 additive appointment-management prerequisites.
-- This migration intentionally contains no data migration beyond PostgreSQL
-- defaults for existing settings rows, and no runtime activation.

ALTER TABLE "public"."BusinessBotOptionsSettings"
  ADD COLUMN "cancellationLeadMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "rescheduleLeadMinutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "public"."BusinessBotOptionsSettings"
  ADD CONSTRAINT "BusinessBotOptionsSettings_cancellationLeadMinutes_nonnegative"
  CHECK ("cancellationLeadMinutes" >= 0),
  ADD CONSTRAINT "BusinessBotOptionsSettings_rescheduleLeadMinutes_nonnegative"
  CHECK ("rescheduleLeadMinutes" >= 0);

CREATE TABLE "public"."AppointmentChangeHistory" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "fromStartAt" TIMESTAMP(3) NOT NULL,
  "toStartAt" TIMESTAMP(3) NOT NULL,
  "bookingDepositId" TEXT,
  "depositPreserved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentChangeHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentChangeHistory_operationKey_key" UNIQUE ("operationKey"),
  CONSTRAINT "AppointmentChangeHistory_actor_nonblank" CHECK (btrim("actor") <> ''),
  CONSTRAINT "AppointmentChangeHistory_operationKey_nonblank" CHECK (btrim("operationKey") <> ''),
  CONSTRAINT "AppointmentChangeHistory_start_changed" CHECK ("fromStartAt" <> "toStartAt"),
  CONSTRAINT "AppointmentChangeHistory_preserved_deposit_required" CHECK (NOT "depositPreserved" OR "bookingDepositId" IS NOT NULL)
);

CREATE INDEX "AppointmentChangeHistory_appointmentId_createdAt_idx"
  ON "public"."AppointmentChangeHistory"("appointmentId", "createdAt");

CREATE UNIQUE INDEX "BookingDeposit_appointmentId_id_key"
  ON "public"."BookingDeposit"("appointmentId", "id");

ALTER TABLE "public"."AppointmentChangeHistory"
  ADD CONSTRAINT "AppointmentChangeHistory_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AppointmentChangeHistory_appointmentId_bookingDepositId_fkey"
  FOREIGN KEY ("appointmentId", "bookingDepositId") REFERENCES "public"."BookingDeposit"("appointmentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.reject_appointment_change_history_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AppointmentChangeHistory is append-only';
END;
$$;

CREATE TRIGGER "AppointmentChangeHistory_reject_mutation"
  BEFORE UPDATE OR DELETE ON public."AppointmentChangeHistory"
  FOR EACH ROW EXECUTE FUNCTION public.reject_appointment_change_history_mutation();
