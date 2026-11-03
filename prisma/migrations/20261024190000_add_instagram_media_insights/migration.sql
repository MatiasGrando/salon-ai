CREATE TABLE "InstagramMedia" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "providerMediaId" TEXT NOT NULL,
  "caption" TEXT, "mediaType" TEXT, "mediaProductType" TEXT, "permalink" TEXT, "thumbnailUrl" TEXT,
  "publishedAt" TIMESTAMP(3), "cataloguedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL, "lastInsightAttemptAt" TIMESTAMP(3),
  "insightsStatus" TEXT NOT NULL DEFAULT 'not_applicable', "insightsErrorCode" TEXT,
  "views" DOUBLE PRECISION, "reach" DOUBLE PRECISION, "likes" DOUBLE PRECISION, "comments" DOUBLE PRECISION,
  "shares" DOUBLE PRECISION, "saved" DOUBLE PRECISION, "total_interactions" DOUBLE PRECISION,
  "metricObservedAt" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "InstagramMedia_business_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE,
  CONSTRAINT "InstagramMedia_counts_check" CHECK (
    ("views" IS NULL OR ("views" >= 0 AND "views" <= 9007199254740991 AND "views" = trunc("views"))) AND
    ("reach" IS NULL OR ("reach" >= 0 AND "reach" <= 9007199254740991 AND "reach" = trunc("reach"))) AND
    ("likes" IS NULL OR ("likes" >= 0 AND "likes" <= 9007199254740991 AND "likes" = trunc("likes"))) AND
    ("comments" IS NULL OR ("comments" >= 0 AND "comments" <= 9007199254740991 AND "comments" = trunc("comments"))) AND
    ("shares" IS NULL OR ("shares" >= 0 AND "shares" <= 9007199254740991 AND "shares" = trunc("shares"))) AND
    ("saved" IS NULL OR ("saved" >= 0 AND "saved" <= 9007199254740991 AND "saved" = trunc("saved"))) AND
    ("total_interactions" IS NULL OR ("total_interactions" >= 0 AND "total_interactions" <= 9007199254740991 AND "total_interactions" = trunc("total_interactions")))
  )
);
CREATE UNIQUE INDEX "InstagramMedia_businessId_accountId_providerMediaId_key" ON "InstagramMedia" ("businessId", "accountId", "providerMediaId");
CREATE UNIQUE INDEX "InstagramMedia_businessId_accountId_id_key" ON "InstagramMedia" ("businessId", "accountId", "id");
CREATE INDEX "InstagramMedia_businessId_accountId_publishedAt_idx" ON "InstagramMedia" ("businessId", "accountId", "publishedAt");
CREATE TABLE "InstagramMediaInsight" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "mediaId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL, "apiVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "errorCode" TEXT, "periods" JSONB NOT NULL DEFAULT '{}',
  "views" DOUBLE PRECISION, "reach" DOUBLE PRECISION, "likes" DOUBLE PRECISION, "comments" DOUBLE PRECISION,
  "shares" DOUBLE PRECISION, "saved" DOUBLE PRECISION, "total_interactions" DOUBLE PRECISION,
  CONSTRAINT "InstagramMediaInsight_scope_fkey" FOREIGN KEY ("businessId", "accountId", "mediaId")
    REFERENCES "InstagramMedia" ("businessId", "accountId", "id") ON DELETE CASCADE,
  CONSTRAINT "InstagramMediaInsight_status_check" CHECK ("status" IN ('complete', 'partial', 'unavailable')),
  CONSTRAINT "InstagramMediaInsight_counts_check" CHECK (
    ("views" IS NULL OR ("views" >= 0 AND "views" <= 9007199254740991 AND "views" = trunc("views"))) AND
    ("reach" IS NULL OR ("reach" >= 0 AND "reach" <= 9007199254740991 AND "reach" = trunc("reach"))) AND
    ("likes" IS NULL OR ("likes" >= 0 AND "likes" <= 9007199254740991 AND "likes" = trunc("likes"))) AND
    ("comments" IS NULL OR ("comments" >= 0 AND "comments" <= 9007199254740991 AND "comments" = trunc("comments"))) AND
    ("shares" IS NULL OR ("shares" >= 0 AND "shares" <= 9007199254740991 AND "shares" = trunc("shares"))) AND
    ("saved" IS NULL OR ("saved" >= 0 AND "saved" <= 9007199254740991 AND "saved" = trunc("saved"))) AND
    ("total_interactions" IS NULL OR ("total_interactions" >= 0 AND "total_interactions" <= 9007199254740991 AND "total_interactions" = trunc("total_interactions")))
  )
);
CREATE INDEX "InstagramMediaInsight_scope_observedAt_idx" ON "InstagramMediaInsight" ("businessId", "accountId", "mediaId", "observedAt");
CREATE TABLE "InstagramMediaSync" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "credentialHash" TEXT NOT NULL,
  "after" TEXT, "seenCursors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimToken" TEXT, "claimUntil" TIMESTAMP(3),
  CONSTRAINT "InstagramMediaSync_business_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE
);
CREATE INDEX "InstagramMediaSync_businessId_expiresAt_idx" ON "InstagramMediaSync" ("businessId", "expiresAt");
