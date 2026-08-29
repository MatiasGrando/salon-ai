-- F10.4: TAKE captures a narrow immutable baseline. Legacy TAKEN rows have no
-- baseline and therefore resolve HOME; this migration never backfills state.
ALTER TABLE "BotHandoff" ADD COLUMN "resumeSnapshot" JSONB;

CREATE FUNCTION "prevent_BotHandoff_resumeSnapshot_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A new TAKE must atomically establish its recovery baseline. This does not
  -- reject legacy rows that were already TAKEN before F10.4 and remain NULL.
  IF OLD."status" = 'QUEUED'::"BotHandoffStatus"
     AND NEW."status" = 'TAKEN'::"BotHandoffStatus"
     AND NEW."resumeSnapshot" IS NULL THEN
    RAISE EXCEPTION 'BotHandoff TAKEN requires resumeSnapshot';
  END IF;

  IF NEW."resumeSnapshot" IS DISTINCT FROM OLD."resumeSnapshot"
     AND NOT (
       OLD."resumeSnapshot" IS NULL
       AND NEW."resumeSnapshot" IS NOT NULL
       AND OLD."status" = 'QUEUED'::"BotHandoffStatus"
       AND NEW."status" = 'TAKEN'::"BotHandoffStatus"
     ) THEN
    RAISE EXCEPTION 'BotHandoff resumeSnapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BotHandoff_resumeSnapshot_immutable"
  BEFORE UPDATE ON "BotHandoff"
  FOR EACH ROW EXECUTE FUNCTION "prevent_BotHandoff_resumeSnapshot_mutation"();
