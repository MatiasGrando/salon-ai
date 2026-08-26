-- Motor determinístico por opciones: núcleo aditivo de etapa 1 (F1/F2/F3).
-- Sin cambios destructivos; el runtime legado ignora estas tablas.

ALTER TABLE "BusinessWhatsAppConfig" ADD COLUMN "appSecret" TEXT;

-- Un único phoneNumberId conectado por tenant: resolución determinística del
-- webhook y rechazo temprano de configuraciones cruzadas.
CREATE UNIQUE INDEX "BusinessWhatsAppConfig_phoneNumberId_connected_key"
  ON "BusinessWhatsAppConfig"("phoneNumberId")
  WHERE "phoneNumberId" IS NOT NULL AND "connectionStatus" = 'CONNECTED';

DO $$ BEGIN
  CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotProviderEventType" AS ENUM ('MESSAGE', 'STATUS', 'UNSUPPORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED', 'DUPLICATE', 'UNMATCHED', 'PROCESSED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED', 'SELECTED', 'DUPLICATE', 'CONFLICT', 'STALE', 'REJECTED', 'PROCESSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotPromptMode" AS ENUM ('FUNCTIONAL', 'NAVIGATION', 'CONFLICT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN', 'STABILIZING', 'RESOLVED', 'INVALIDATED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE', 'HUMAN_QUEUED', 'HUMAN_TAKEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotJobStatus" AS ENUM ('READY', 'LEASED', 'DONE', 'RETRY', 'POISON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'UNKNOWN', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED', 'POISON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Puntero exclusivo del motor activo por negocio/canal.
CREATE TABLE IF NOT EXISTS "BotChannelDeployment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "engineKey" TEXT NOT NULL DEFAULT 'deterministic-options',
  "activeConfigurationId" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BotChannelDeployment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotChannelDeployment_businessId_channel_key"
  ON "BotChannelDeployment"("businessId", "channel");

CREATE TABLE IF NOT EXISTS "BotDeploymentAudit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousConfigId" TEXT,
  "newConfigId" TEXT,
  "generation" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BotDeploymentAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BotDeploymentAudit_businessId_createdAt_idx"
  ON "BotDeploymentAudit"("businessId", "createdAt");

CREATE TABLE IF NOT EXISTS "BotSession" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "conversationId" TEXT,
  "deploymentId" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL DEFAULT 'v1',
  "stateSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "state" JSONB NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 0,
  "status" "BotSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "fenceToken" TEXT,
  "draftTouchedAt" TIMESTAMP(3),
  "draftExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BotSession_businessId_status_idx" ON "BotSession"("businessId", "status");
CREATE INDEX IF NOT EXISTS "BotSession_conversationId_idx" ON "BotSession"("conversationId");
-- Una sola sesión activa por deployment/conversación.
CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_active_deployment_conversation_key"
  ON "BotSession"("deploymentId", "conversationId")
  WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "BotPrompt" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "promptToken" TEXT NOT NULL,
  "stateRevision" BIGINT NOT NULL,
  "mode" "BotPromptMode" NOT NULL DEFAULT 'FUNCTIONAL',
  "status" "BotPromptStatus" NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstActionAt" TIMESTAMP(3),
  "lastActionAt" TIMESTAMP(3),
  "settleAt" TIMESTAMP(3),
  "absoluteAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "outboxMessageId" TEXT,

  CONSTRAINT "BotPrompt_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "BotPrompt_session_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "BotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_promptToken_key" ON "BotPrompt"("promptToken");
CREATE INDEX IF NOT EXISTS "BotPrompt_status_settleAt_idx" ON "BotPrompt"("status", "settleAt");
CREATE INDEX IF NOT EXISTS "BotPrompt_sessionId_stateRevision_idx" ON "BotPrompt"("sessionId", "stateRevision");
-- Un solo prompt funcional abierto por sesión.
CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_open_functional_per_session_key"
  ON "BotPrompt"("sessionId")
  WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL';

CREATE TABLE IF NOT EXISTS "BotPromptChoice" (
  "id" TEXT NOT NULL,
  "promptId" TEXT NOT NULL,
  "choiceToken" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "payload" JSONB,
  "labelSnapshot" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "BotPromptChoice_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "BotPromptChoice_promptId_fkey" FOREIGN KEY ("promptId")
    REFERENCES "BotPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotPromptChoice_promptId_choiceToken_key"
  ON "BotPromptChoice"("promptId", "choiceToken");

CREATE TABLE IF NOT EXISTS "BotProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "eventKey" TEXT NOT NULL,
  "eventType" "BotProviderEventType" NOT NULL,
  "businessId" TEXT,
  "phoneNumberId" TEXT,
  "providerMessageId" TEXT,
  "payload" JSONB,
  "providerOccurredAt" TIMESTAMP(3),
  "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "BotProviderEventStatus" NOT NULL DEFAULT 'ADMITTED',
  "traceId" TEXT,

  CONSTRAINT "BotProviderEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotProviderEvent_provider_eventKey_key"
  ON "BotProviderEvent"("provider", "eventKey");
CREATE INDEX IF NOT EXISTS "BotProviderEvent_providerMessageId_idx" ON "BotProviderEvent"("providerMessageId");
CREATE INDEX IF NOT EXISTS "BotProviderEvent_businessId_admittedAt_idx" ON "BotProviderEvent"("businessId", "admittedAt");

CREATE TABLE IF NOT EXISTS "BotActionInbox" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "sessionId" TEXT,
  "promptId" TEXT,
  "choiceToken" TEXT,
  "actionType" TEXT,
  "entityRef" JSONB,
  "payload" JSONB,
  "expectedRevision" BIGINT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "BotInboxStatus" NOT NULL DEFAULT 'ADMITTED',
  "operationKey" TEXT,
  "error" TEXT,

  CONSTRAINT "BotActionInbox_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "BotActionInbox_providerEventId_fkey" FOREIGN KEY ("providerEventId")
    REFERENCES "BotProviderEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BotActionInbox_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "BotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BotActionInbox_promptId_status_receivedAt_idx"
  ON "BotActionInbox"("promptId", "status", "receivedAt");
CREATE INDEX IF NOT EXISTS "BotActionInbox_sessionId_receivedAt_idx"
  ON "BotActionInbox"("sessionId", "receivedAt");

CREATE TABLE IF NOT EXISTS "BotJob" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "businessId" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "BotJobStatus" NOT NULL DEFAULT 'READY',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseToken" TEXT,
  "leasedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BotJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotJob_kind_aggregateId_key" ON "BotJob"("kind", "aggregateId");
CREATE INDEX IF NOT EXISTS "BotJob_status_availableAt_idx" ON "BotJob"("status", "availableAt");

CREATE TABLE IF NOT EXISTS "BotOutbox" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "transitionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "BotOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "dependsOnSequence" INTEGER,
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leasedUntil" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BotOutbox_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "BotOutbox_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "BotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotOutbox_idempotencyKey_key" ON "BotOutbox"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "BotOutbox_sessionId_sequence_idx" ON "BotOutbox"("sessionId", "sequence");
CREATE INDEX IF NOT EXISTS "BotOutbox_status_availableAt_idx" ON "BotOutbox"("status", "availableAt");
