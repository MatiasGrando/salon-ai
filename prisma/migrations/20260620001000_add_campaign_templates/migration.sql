ALTER TABLE "Campaign"
ADD COLUMN "templateName" TEXT,
ADD COLUMN "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR';
