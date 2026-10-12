-- Paid confirmed rescheduling amends the operational appointment only. Original
-- sealed deposit terms, proof, amount and review remain immutable.
ALTER TABLE "public"."AppointmentChangeHistory"
  ADD COLUMN "fromProfessionalId" TEXT,
  ADD COLUMN "toProfessionalId" TEXT;

ALTER TABLE "public"."AppointmentChangeHistory"
  ADD CONSTRAINT "AppointmentChangeHistory_professional_pair"
    CHECK (("fromProfessionalId" IS NULL) = ("toProfessionalId" IS NULL));

ALTER TABLE "public"."AppointmentChangeHistory"
  DROP CONSTRAINT "AppointmentChangeHistory_start_changed";
ALTER TABLE "public"."AppointmentChangeHistory"
  ADD CONSTRAINT "AppointmentChangeHistory_assignment_changed"
    CHECK ("fromStartAt" <> "toStartAt" OR
      ("fromProfessionalId" IS NOT NULL AND "fromProfessionalId" <> "toProfessionalId"));
