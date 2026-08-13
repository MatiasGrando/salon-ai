CREATE TYPE "BookingDepositSource" AS ENUM ('WHATSAPP', 'WEB');

ALTER TABLE "BookingDeposit"
  ADD COLUMN "source" "BookingDepositSource" NOT NULL DEFAULT 'WHATSAPP',
  ADD COLUMN "proofData" BYTEA,
  ADD COLUMN "proofMimeType" TEXT,
  ADD COLUMN "proofFilename" TEXT,
  ALTER COLUMN "conversationId" DROP NOT NULL;

ALTER TABLE "BookingDeposit"
  DROP CONSTRAINT "BookingDeposit_conversationId_fkey";

ALTER TABLE "BookingDeposit"
  ADD CONSTRAINT "BookingDeposit_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
