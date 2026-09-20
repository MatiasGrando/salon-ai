CREATE TABLE "CustomerChannelIdentity" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerChannelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerChannelIdentity_businessId_channel_externalUserId_key"
ON "CustomerChannelIdentity"("businessId", "channel", "externalUserId");

CREATE INDEX "CustomerChannelIdentity_businessId_customerId_channel_idx"
ON "CustomerChannelIdentity"("businessId", "customerId", "channel");

CREATE INDEX "CustomerChannelIdentity_businessId_channel_username_idx"
ON "CustomerChannelIdentity"("businessId", "channel", "username");

ALTER TABLE "CustomerChannelIdentity"
ADD CONSTRAINT "CustomerChannelIdentity_businessId_customerId_fkey"
FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Compatibility backfill while the transitional Instagram columns still exist.
INSERT INTO "CustomerChannelIdentity" (
  "id",
  "businessId",
  "customerId",
  "channel",
  "externalUserId",
  "username",
  "createdAt",
  "updatedAt"
)
SELECT
  'cci_' || md5(random()::text || clock_timestamp()::text || "id"),
  "businessId",
  "id",
  'INSTAGRAM',
  "instagramUserId",
  "instagramUsername",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Customer"
WHERE "businessId" IS NOT NULL
  AND "instagramUserId" IS NOT NULL
ON CONFLICT ("businessId", "channel", "externalUserId") DO NOTHING;
