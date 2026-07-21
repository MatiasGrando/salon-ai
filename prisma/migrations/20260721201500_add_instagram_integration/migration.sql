CREATE TABLE "BusinessInstagramConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "username" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessInstagramConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramLead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "referralCode" TEXT NOT NULL,
    "lastMessage" TEXT,
    "lastAutoReplyAt" TIMESTAMP(3),
    "whatsappConversationId" TEXT,
    "whatsappLinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessInstagramConfig_businessId_key" ON "BusinessInstagramConfig"("businessId");
CREATE UNIQUE INDEX "BusinessInstagramConfig_instagramAccountId_key" ON "BusinessInstagramConfig"("instagramAccountId");
CREATE UNIQUE INDEX "InstagramLead_referralCode_key" ON "InstagramLead"("referralCode");
CREATE UNIQUE INDEX "InstagramLead_whatsappConversationId_key" ON "InstagramLead"("whatsappConversationId");
CREATE UNIQUE INDEX "InstagramLead_businessId_instagramUserId_key" ON "InstagramLead"("businessId", "instagramUserId");
CREATE INDEX "InstagramLead_businessId_updatedAt_idx" ON "InstagramLead"("businessId", "updatedAt");
CREATE UNIQUE INDEX "InstagramMessage_providerMessageId_key" ON "InstagramMessage"("providerMessageId");
CREATE INDEX "InstagramMessage_leadId_createdAt_idx" ON "InstagramMessage"("leadId", "createdAt");

ALTER TABLE "BusinessInstagramConfig" ADD CONSTRAINT "BusinessInstagramConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramLead" ADD CONSTRAINT "InstagramLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramLead" ADD CONSTRAINT "InstagramLead_whatsappConversationId_fkey" FOREIGN KEY ("whatsappConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InstagramMessage" ADD CONSTRAINT "InstagramMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "InstagramLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
