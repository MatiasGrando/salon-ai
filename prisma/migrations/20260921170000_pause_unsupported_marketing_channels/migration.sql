-- Email and mixed WhatsApp + Email delivery are not implemented yet.
-- Keep historical records, but stop unsupported active schedules safely.
UPDATE "Campaign"
SET "status" = 'PAUSED'
WHERE "channel" <> 'WHATSAPP'
  AND "status" IN ('ACTIVE', 'SCHEDULED');

UPDATE "ReminderAutomation"
SET "mode" = 'PAUSED',
    "enabled" = false
WHERE "channel" <> 'WHATSAPP'
  AND ("mode" <> 'PAUSED' OR "enabled" = true);