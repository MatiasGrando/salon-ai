ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Conversation_businessId_archivedAt_updatedAt_idx"
ON "Conversation"("businessId", "archivedAt", "updatedAt");

CREATE INDEX IF NOT EXISTS "Conversation_currentStep_archivedAt_updatedAt_idx"
ON "Conversation"("currentStep", "archivedAt", "updatedAt");
