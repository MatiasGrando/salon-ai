ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ACCOUNT_ADMIN';

ALTER TABLE "User"
ADD COLUMN "canCreateBusinesses" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Business"
ADD COLUMN "accountAdminId" TEXT,
ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "Business_accountAdminId_idx" ON "Business"("accountAdminId");
CREATE INDEX "Business_createdByUserId_idx" ON "Business"("createdByUserId");

ALTER TABLE "Business"
ADD CONSTRAINT "Business_accountAdminId_fkey"
FOREIGN KEY ("accountAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Business"
ADD CONSTRAINT "Business_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
