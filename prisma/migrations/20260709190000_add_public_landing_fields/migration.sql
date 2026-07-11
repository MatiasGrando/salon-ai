ALTER TABLE "Business"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "landingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "landingDescription" TEXT,
  ADD COLUMN "coverImageUrl" TEXT,
  ADD COLUMN "publicWhatsapp" TEXT;

CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
