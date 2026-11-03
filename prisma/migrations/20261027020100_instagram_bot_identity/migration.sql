-- Existing WhatsApp identities and unique indexes remain unchanged.
ALTER TABLE "BotSession" ADD COLUMN "instagramLeadId" TEXT, ADD COLUMN "instagramAccountId" TEXT;
ALTER TABLE "InstagramLead" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "botPausedAt" TIMESTAMP(3), ADD COLUMN "botPausedByUserId" TEXT;
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_instagramLead_tenant_fk" FOREIGN KEY ("businessId","instagramLeadId") REFERENCES "InstagramLead"("businessId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_provider_identity_check" CHECK (("channel"='WHATSAPP'::"BotChannel" AND "instagramLeadId" IS NULL AND "instagramAccountId" IS NULL) OR ("channel"='INSTAGRAM'::"BotChannel" AND "conversationId" IS NULL AND "instagramLeadId" IS NOT NULL AND "instagramAccountId" IS NOT NULL));
CREATE UNIQUE INDEX "BotSession_instagram_active_identity_idx" ON "BotSession" ("deploymentId","instagramLeadId") WHERE "channel"='INSTAGRAM'::"BotChannel" AND "status"<>'CLOSED'::"BotSessionStatus";
CREATE INDEX "BotSession_instagramLeadId_idx" ON "BotSession"("instagramLeadId");
