-- Appointment is written by the public site, several bot engines, CRM actions
-- and maintenance workers. Keeping the notification at the database boundary
-- guarantees every committed writer follows the same realtime path.
CREATE OR REPLACE FUNCTION "notify_appointment_changed"() RETURNS trigger AS $$
DECLARE
  appointment_id text;
  professional_id text;
  tenant_id text;
BEGIN
  appointment_id := COALESCE(NEW."id", OLD."id");
  professional_id := COALESCE(NEW."professionalId", OLD."professionalId");

  SELECT "businessId"
    INTO tenant_id
    FROM "Professional"
   WHERE "id" = professional_id;

  IF tenant_id IS NOT NULL THEN
    PERFORM pg_notify(
      'appointment_changed',
      json_build_object(
        'businessId', tenant_id,
        'appointmentId', appointment_id,
        'updatedAt', clock_timestamp()
      )::text
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "appointment_changed_notify" ON "Appointment";
CREATE TRIGGER "appointment_changed_notify"
AFTER INSERT OR UPDATE OR DELETE ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION "notify_appointment_changed"();
