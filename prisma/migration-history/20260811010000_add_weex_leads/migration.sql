CREATE TABLE "WeexLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT 'promocion-weex-agosto-2026',
    "source" TEXT NOT NULL DEFAULT 'directo',
    "medium" TEXT,
    "campaignName" TEXT,
    "content" TEXT,
    "term" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NUEVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeexLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WeexLead_createdAt_idx" ON "WeexLead"("createdAt");
CREATE INDEX "WeexLead_status_createdAt_idx" ON "WeexLead"("status", "createdAt");
CREATE INDEX "WeexLead_campaign_createdAt_idx" ON "WeexLead"("campaign", "createdAt");
