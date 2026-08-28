-- Keep the physical column aligned with Prisma's @updatedAt contract.
-- The application supplies updatedAt; the database must not invent it.
BEGIN;

ALTER TABLE "BusinessBotOptionsSettings"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;
