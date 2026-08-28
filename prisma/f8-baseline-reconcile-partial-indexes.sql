-- Approved one-time repair for an EXISTING, UNLEDGERED F4/F8-compatible schema.
-- Do not run the baseline migration SQL on a nonempty schema.
-- Run only after backup/restore drill and catalog/schema preflight. This transaction
-- locks the affected tables, rejects every duplicate set, and changes no row data.
BEGIN;

LOCK TABLE "BotSession", "BotPrompt", "BotActionInbox", "BotOutbox", "BotDispatchClaim" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public."BotSession_active_deployment_conversation_key"') IS NOT NULL
    OR to_regclass('public."BotPrompt_open_functional_per_session_key"') IS NOT NULL
    OR to_regclass('public."BotActionInbox_promptId_providerMessageId_key"') IS NOT NULL
    OR to_regclass('public."BotOutbox_providerMessageId_key"') IS NOT NULL
    OR to_regclass('public."BotDispatchClaim_active_resource_key"') IS NOT NULL THEN
    RAISE EXCEPTION 'partial-index reconciliation expects all five named indexes to be absent; inspect catalog and stop';
  END IF;

  IF EXISTS (SELECT 1 FROM "BotSession" WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL GROUP BY "deploymentId", "conversationId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate active BotSession deployment/conversation rows block reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "BotPrompt" WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL' GROUP BY "sessionId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate open functional BotPrompt rows block reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "BotActionInbox" WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL GROUP BY "promptId", "providerMessageId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate BotActionInbox prompt/provider-message rows block reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "BotOutbox" WHERE "providerMessageId" IS NOT NULL GROUP BY "providerMessageId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate BotOutbox provider-message rows block reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "BotDispatchClaim" WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED', 'SENDING', 'UNKNOWN') GROUP BY "kind", "engineKey", "resourceId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate active BotDispatchClaim resources block reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX "BotSession_active_deployment_conversation_key" ON "BotSession"("deploymentId", "conversationId") WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL;
CREATE UNIQUE INDEX "BotPrompt_open_functional_per_session_key" ON "BotPrompt"("sessionId") WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL';
CREATE UNIQUE INDEX "BotActionInbox_promptId_providerMessageId_key" ON "BotActionInbox"("promptId", "providerMessageId") WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL;
CREATE UNIQUE INDEX "BotOutbox_providerMessageId_key" ON "BotOutbox"("providerMessageId") WHERE "providerMessageId" IS NOT NULL;
CREATE UNIQUE INDEX "BotDispatchClaim_active_resource_key" ON "BotDispatchClaim"("kind", "engineKey", "resourceId") WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED', 'SENDING', 'UNKNOWN');

COMMIT;
