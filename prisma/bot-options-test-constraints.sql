-- Constraints PostgreSQL que Prisma schema/db push no puede expresar.
-- Uso exclusivo de la base loopback salon_ai_test en contratos F4.

CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_active_deployment_conversation_key"
  ON "BotSession"("deploymentId", "conversationId")
  WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_open_functional_per_session_key"
  ON "BotPrompt"("sessionId")
  WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL';

CREATE UNIQUE INDEX IF NOT EXISTS "BotActionInbox_promptId_providerMessageId_key"
  ON "BotActionInbox"("promptId", "providerMessageId")
  WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BotOutbox_providerMessageId_key"
  ON "BotOutbox"("providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
