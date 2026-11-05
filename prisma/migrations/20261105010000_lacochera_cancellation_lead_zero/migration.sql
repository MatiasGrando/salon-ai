-- La Cochera alone permits cancellation until the appointment starts.
-- Other businesses and the general 60-minute default remain unchanged.
BEGIN;

UPDATE "BusinessBotOptionsSettings" AS settings
SET "cancellationLeadMinutes" = 0, "updatedAt" = CURRENT_TIMESTAMP
FROM "Business" AS business
WHERE settings."businessId" = business."id"
  AND business."slug" = 'lacochera'
  AND settings."cancellationLeadMinutes" <> 0;

-- A missing settings row can only use a timezone already chosen by the business.
-- Without it, leave the existing fail-closed configuration requirements intact.
INSERT INTO "BusinessBotOptionsSettings"
  ("businessId", "timezone", "cancellationLeadMinutes", "updatedAt")
SELECT business."id", business."timezone", 0, CURRENT_TIMESTAMP
FROM "Business" AS business
WHERE business."slug" = 'lacochera'
  AND business."timezone" IS NOT NULL
  AND btrim(business."timezone") <> ''
ON CONFLICT ("businessId") DO NOTHING;

COMMIT;
