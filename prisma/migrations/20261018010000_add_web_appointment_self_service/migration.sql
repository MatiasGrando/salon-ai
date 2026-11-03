-- No backfill: an editable contact number is not appointment ownership.
ALTER TABLE "Appointment" ADD COLUMN "createdByWeexAccountId" TEXT;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdByWeexAccountId_fkey"
  FOREIGN KEY ("createdByWeexAccountId") REFERENCES "WeexAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Appointment_createdByWeexAccountId_businessId_idx" ON "Appointment"("createdByWeexAccountId", "businessId");

CREATE TABLE "WebAppointmentAction" (
  "operationId" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "appointmentIds" TEXT[] NOT NULL,
  "actorType" TEXT NOT NULL CHECK ("actorType" IN ('ACCOUNT', 'GUEST')),
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('RESCHEDULE', 'CANCEL')),
  "requestHash" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "WebAppointmentAction_members" CHECK (cardinality("appointmentIds") BETWEEN 1 AND 5)
);
CREATE INDEX "WebAppointmentAction_businessId_createdAt_idx" ON "WebAppointmentAction"("businessId", "createdAt");
CREATE FUNCTION "web_appointment_action_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'web appointment action history is append-only';
END;
$$;
CREATE TRIGGER "web_appointment_action_append_only"
  BEFORE UPDATE OR DELETE ON "WebAppointmentAction"
  FOR EACH ROW EXECUTE FUNCTION "web_appointment_action_append_only"();
