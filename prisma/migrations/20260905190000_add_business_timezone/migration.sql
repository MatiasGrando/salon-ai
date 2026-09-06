-- Caja necesita una zona IANA canónica por negocio. La columna es nullable para
-- no inventar una zona en comercios históricos. Sólo copiamos configuraciones
-- ya elegidas explícitamente para el bot; el resto debe configurarse en el CRM.
BEGIN;

ALTER TABLE "Business"
  ADD COLUMN "timezone" TEXT,
  ADD CONSTRAINT "Business_timezone_not_blank_check"
    CHECK ("timezone" IS NULL OR btrim("timezone") <> '');

UPDATE "Business" AS business
SET "timezone" = settings."timezone"
FROM "BusinessBotOptionsSettings" AS settings
WHERE settings."businessId" = business."id"
  AND btrim(settings."timezone") <> '';

COMMIT;
