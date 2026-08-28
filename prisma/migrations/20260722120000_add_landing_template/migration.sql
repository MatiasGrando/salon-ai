ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "landingTemplate" TEXT NOT NULL DEFAULT 'classic';
