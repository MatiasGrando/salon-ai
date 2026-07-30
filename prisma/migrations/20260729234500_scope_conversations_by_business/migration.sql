DROP INDEX "Conversation_phone_key";

CREATE UNIQUE INDEX "Conversation_businessId_phone_key"
ON "Conversation"("businessId", "phone");

CREATE INDEX "Conversation_phone_idx"
ON "Conversation"("phone");
