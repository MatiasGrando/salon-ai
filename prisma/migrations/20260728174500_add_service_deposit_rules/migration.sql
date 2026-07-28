CREATE TYPE "ServiceDepositMode" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');

ALTER TABLE "Service"
ADD COLUMN "depositMode" "ServiceDepositMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN "depositValue" INTEGER;
