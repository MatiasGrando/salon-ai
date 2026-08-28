ALTER TABLE "Conversation"
ADD COLUMN "botProcessingToken" TEXT,
ADD COLUMN "botProcessingUntil" TIMESTAMP(3);
