CREATE TYPE "BusinessType" AS ENUM ('SALON', 'WORKSHOP');
ALTER TABLE "Business" ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'SALON';
