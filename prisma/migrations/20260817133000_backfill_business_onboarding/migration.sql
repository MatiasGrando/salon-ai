INSERT INTO "BusinessOnboardingStatus" (
  "businessId",
  "accountCreated",
  "ownerLoggedIn",
  "profileComplete",
  "hasServices",
  "hasProfessionals",
  "hasBusinessHours",
  "whatsappConnected",
  "landingConfigured",
  "completedSteps",
  "totalSteps",
  "progress",
  "updatedAt"
)
SELECT
  b."id",
  true,
  EXISTS (
    SELECT 1 FROM "User" u
    WHERE u."businessId" = b."id"
      AND u."role" = 'BUSINESS_ADMIN'
      AND u."firstLoginAt" IS NOT NULL
  ),
  COALESCE(NULLIF(TRIM(b."name"), ''), '') <> ''
    AND COALESCE(NULLIF(TRIM(b."contactPhone"), ''), '') <> ''
    AND COALESCE(NULLIF(TRIM(b."contactEmail"), ''), '') <> '',
  EXISTS (SELECT 1 FROM "Service" s WHERE s."businessId" = b."id"),
  EXISTS (SELECT 1 FROM "Professional" p WHERE p."businessId" = b."id" AND p."isActive" = true),
  EXISTS (SELECT 1 FROM "BusinessHours" h WHERE h."businessId" = b."id"),
  EXISTS (
    SELECT 1 FROM "BusinessWhatsAppConfig" w
    WHERE w."businessId" = b."id" AND w."connectionStatus" = 'CONNECTED'
  ),
  b."landingEnabled" = true AND (
    COALESCE(NULLIF(TRIM(b."landingSubtitle"), ''), '') <> '' OR
    COALESCE(NULLIF(TRIM(b."landingDescription"), ''), '') <> '' OR
    COALESCE(NULLIF(TRIM(b."coverImageUrl"), ''), '') <> ''
  ),
  1
    + CASE WHEN EXISTS (
        SELECT 1 FROM "User" u
        WHERE u."businessId" = b."id" AND u."role" = 'BUSINESS_ADMIN' AND u."firstLoginAt" IS NOT NULL
      ) THEN 1 ELSE 0 END
    + CASE WHEN COALESCE(NULLIF(TRIM(b."name"), ''), '') <> ''
        AND COALESCE(NULLIF(TRIM(b."contactPhone"), ''), '') <> ''
        AND COALESCE(NULLIF(TRIM(b."contactEmail"), ''), '') <> '' THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM "Service" s WHERE s."businessId" = b."id") THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM "Professional" p WHERE p."businessId" = b."id" AND p."isActive" = true) THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM "BusinessHours" h WHERE h."businessId" = b."id") THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM "BusinessWhatsAppConfig" w WHERE w."businessId" = b."id" AND w."connectionStatus" = 'CONNECTED') THEN 1 ELSE 0 END
    + CASE WHEN b."landingEnabled" = true AND (
        COALESCE(NULLIF(TRIM(b."landingSubtitle"), ''), '') <> '' OR
        COALESCE(NULLIF(TRIM(b."landingDescription"), ''), '') <> '' OR
        COALESCE(NULLIF(TRIM(b."coverImageUrl"), ''), '') <> ''
      ) THEN 1 ELSE 0 END,
  8,
  ROUND((
    1
      + CASE WHEN EXISTS (SELECT 1 FROM "User" u WHERE u."businessId" = b."id" AND u."role" = 'BUSINESS_ADMIN' AND u."firstLoginAt" IS NOT NULL) THEN 1 ELSE 0 END
      + CASE WHEN COALESCE(NULLIF(TRIM(b."name"), ''), '') <> '' AND COALESCE(NULLIF(TRIM(b."contactPhone"), ''), '') <> '' AND COALESCE(NULLIF(TRIM(b."contactEmail"), ''), '') <> '' THEN 1 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM "Service" s WHERE s."businessId" = b."id") THEN 1 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM "Professional" p WHERE p."businessId" = b."id" AND p."isActive" = true) THEN 1 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM "BusinessHours" h WHERE h."businessId" = b."id") THEN 1 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM "BusinessWhatsAppConfig" w WHERE w."businessId" = b."id" AND w."connectionStatus" = 'CONNECTED') THEN 1 ELSE 0 END
      + CASE WHEN b."landingEnabled" = true AND (COALESCE(NULLIF(TRIM(b."landingSubtitle"), ''), '') <> '' OR COALESCE(NULLIF(TRIM(b."landingDescription"), ''), '') <> '' OR COALESCE(NULLIF(TRIM(b."coverImageUrl"), ''), '') <> '') THEN 1 ELSE 0 END
  ) * 100.0 / 8)::INTEGER,
  CURRENT_TIMESTAMP
FROM "Business" b
ON CONFLICT ("businessId") DO NOTHING;
