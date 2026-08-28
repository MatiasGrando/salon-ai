ALTER TABLE "Appointment"
ADD COLUMN "quotedPrice" INTEGER;

ALTER TABLE "Conversation"
ADD COLUMN "photoQuoteAcknowledgedAt" TIMESTAMP(3);
