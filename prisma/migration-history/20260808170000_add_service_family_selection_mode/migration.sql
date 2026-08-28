CREATE TYPE "ServiceVariantSelectionMode" AS ENUM ('ONE_OF', 'MULTIPLE');

ALTER TABLE "Service"
ADD COLUMN "variantSelectionMode" "ServiceVariantSelectionMode" NOT NULL DEFAULT 'ONE_OF';
