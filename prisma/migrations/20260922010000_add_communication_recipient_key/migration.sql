ALTER TABLE "CommunicationRecipient" ADD COLUMN "recipientKey" TEXT;

UPDATE "CommunicationRecipient"
SET "recipientKey" = "customerId"
WHERE "recipientKey" IS NULL;

ALTER TABLE "CommunicationRecipient" ALTER COLUMN "recipientKey" SET NOT NULL;

DROP INDEX IF EXISTS "CommunicationRecipient_executionId_customerId_key";
CREATE UNIQUE INDEX "CommunicationRecipient_executionId_recipientKey_key"
  ON "CommunicationRecipient"("executionId", "recipientKey");
