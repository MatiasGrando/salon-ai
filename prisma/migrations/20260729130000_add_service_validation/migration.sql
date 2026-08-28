ALTER TABLE "Service"
ADD COLUMN "validationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "validationMessage" TEXT,
ADD COLUMN "validationQuestion" TEXT;
