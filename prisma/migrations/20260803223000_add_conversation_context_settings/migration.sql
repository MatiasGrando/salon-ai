ALTER TABLE "BusinessFeatureSettings"
ADD COLUMN "conversationPauseAfterMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN "conversationExpireAfterMinutes" INTEGER NOT NULL DEFAULT 1440;
