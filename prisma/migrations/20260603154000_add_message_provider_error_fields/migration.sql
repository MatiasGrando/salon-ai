ALTER TABLE "Message"
ADD COLUMN "providerStatusCode" INTEGER,
ADD COLUMN "providerErrorCode" TEXT,
ADD COLUMN "providerErrorMessage" TEXT;
