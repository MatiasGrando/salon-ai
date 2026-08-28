ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "professionalId" TEXT;

CREATE INDEX IF NOT EXISTS "User_professionalId_idx" ON "User"("professionalId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
