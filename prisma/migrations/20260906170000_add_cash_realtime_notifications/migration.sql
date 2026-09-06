-- PostgreSQL delivers NOTIFY messages only when their transaction commits.
-- The payload deliberately contains identity only; clients refetch authorized data.
CREATE OR REPLACE FUNCTION "notify_cash_changed"() RETURNS trigger AS $$
DECLARE
  tenant_id text;
  entity_id text;
BEGIN
  tenant_id := COALESCE(NEW."businessId", OLD."businessId");
  entity_id := COALESCE(NEW."id", OLD."id");

  IF tenant_id IS NOT NULL AND entity_id IS NOT NULL THEN
    PERFORM pg_notify(
      'cash_changed',
      json_build_object(
        'businessId', tenant_id,
        'entity', TG_ARGV[0],
        'entityId', entity_id,
        'updatedAt', clock_timestamp()
      )::text
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cash_entry_changed_notify" ON "CashEntry";
CREATE TRIGGER "cash_entry_changed_notify"
AFTER INSERT ON "CashEntry"
FOR EACH ROW EXECUTE FUNCTION "notify_cash_changed"('ENTRY');

DROP TRIGGER IF EXISTS "cash_day_changed_notify" ON "CashRegisterDay";
CREATE TRIGGER "cash_day_changed_notify"
AFTER INSERT OR UPDATE ON "CashRegisterDay"
FOR EACH ROW EXECUTE FUNCTION "notify_cash_changed"('DAY');

DROP TRIGGER IF EXISTS "cash_session_changed_notify" ON "CashSession";
CREATE TRIGGER "cash_session_changed_notify"
AFTER INSERT OR UPDATE ON "CashSession"
FOR EACH ROW EXECUTE FUNCTION "notify_cash_changed"('SESSION');

DROP TRIGGER IF EXISTS "appointment_account_changed_notify" ON "AppointmentAccount";
CREATE TRIGGER "appointment_account_changed_notify"
AFTER UPDATE ON "AppointmentAccount"
FOR EACH ROW EXECUTE FUNCTION "notify_cash_changed"('ACCOUNT');
