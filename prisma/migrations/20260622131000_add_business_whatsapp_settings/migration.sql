CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'NEEDS_PAYMENT', 'NEEDS_REVIEW', 'ERROR');
CREATE TYPE "WhatsAppConnectionMode" AS ENUM ('CLIENT_OWNED', 'INTERNAL_TEST');
CREATE TYPE "BillingOwner" AS ENUM ('CLIENT', 'SALON_AI');

CREATE TABLE "BusinessWhatsAppConfig" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "connectionStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "mode" "WhatsAppConnectionMode" NOT NULL DEFAULT 'CLIENT_OWNED',
  "wabaId" TEXT,
  "phoneNumberId" TEXT,
  "displayPhoneNumber" TEXT,
  "metaAppId" TEXT,
  "accessToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BusinessWhatsAppConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessFeatureSettings" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "botEnabled" BOOLEAN NOT NULL DEFAULT true,
  "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
  "campaignsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
  "realWhatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
  "billingOwner" "BillingOwner" NOT NULL DEFAULT 'CLIENT',
  "campaignSendingLocked" BOOLEAN NOT NULL DEFAULT true,
  "reminderSendingLocked" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BusinessFeatureSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessWhatsAppConfig_businessId_key" ON "BusinessWhatsAppConfig"("businessId");
CREATE UNIQUE INDEX "BusinessFeatureSettings_businessId_key" ON "BusinessFeatureSettings"("businessId");

ALTER TABLE "BusinessWhatsAppConfig"
  ADD CONSTRAINT "BusinessWhatsAppConfig_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessFeatureSettings"
  ADD CONSTRAINT "BusinessFeatureSettings_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BusinessFeatureSettings" (
  "id",
  "businessId",
  "botEnabled",
  "aiEnabled",
  "campaignsEnabled",
  "remindersEnabled",
  "realWhatsappEnabled",
  "billingOwner",
  "campaignSendingLocked",
  "reminderSendingLocked",
  "updatedAt"
)
SELECT
  'bfs_' || "id",
  "id",
  "botEnabled",
  "aiEnabled",
  false,
  false,
  false,
  'CLIENT'::"BillingOwner",
  true,
  true,
  CURRENT_TIMESTAMP
FROM "Business"
ON CONFLICT ("businessId") DO NOTHING;

INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "mode", "updatedAt")
SELECT
  'bwa_' || "id",
  "id",
  'NOT_CONNECTED'::"WhatsAppConnectionStatus",
  'CLIENT_OWNED'::"WhatsAppConnectionMode",
  CURRENT_TIMESTAMP
FROM "Business"
ON CONFLICT ("businessId") DO NOTHING;
