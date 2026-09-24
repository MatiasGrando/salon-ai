-- Keep the tenant-scoped FK for local staff. Administrators acting in an authorized business
-- use a separate FK to their global User identity; exactly one responsible identity is set.
ALTER TABLE "CashSession"
  ALTER COLUMN "responsibleUserId" DROP NOT NULL,
  ADD COLUMN "responsibleAdministratorUserId" TEXT;

ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_responsibleAdministratorUserId_fkey"
  FOREIGN KEY ("responsibleAdministratorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CashSession_responsible_identity_check"
  CHECK (("responsibleUserId" IS NOT NULL) <> ("responsibleAdministratorUserId" IS NOT NULL));

CREATE INDEX "CashSession_responsibleAdministratorUserId_idx"
  ON "CashSession"("responsibleAdministratorUserId");
