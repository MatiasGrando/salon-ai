CREATE TYPE "ServicePriceMode" AS ENUM ('FIXED', 'STARTING_AT');

ALTER TABLE "Service"
ADD COLUMN "priceMode" "ServicePriceMode" NOT NULL DEFAULT 'FIXED';
