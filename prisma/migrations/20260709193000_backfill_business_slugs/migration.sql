WITH normalized AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE("name", '[^a-zA-Z0-9]+', '-', 'g'))),
        ''
      ),
      'comercio'
    ) AS "baseSlug"
  FROM "Business"
  WHERE "slug" IS NULL
),
safe_normalized AS (
  SELECT
    "id",
    CASE
      WHEN "baseSlug" IN ('admin', 'api', 'auth', 'crm', 'health', 'public', 'static', 'weex', 'www')
        THEN "baseSlug" || '-local'
      ELSE "baseSlug"
    END AS "baseSlug"
  FROM normalized
),
numbered AS (
  SELECT
    "id",
    "baseSlug",
    ROW_NUMBER() OVER (PARTITION BY "baseSlug" ORDER BY "id") AS "slugNumber"
  FROM safe_normalized
)
UPDATE "Business"
SET "slug" = CASE
  WHEN numbered."slugNumber" = 1 THEN numbered."baseSlug"
  ELSE numbered."baseSlug" || '-' || numbered."slugNumber"
END
FROM numbered
WHERE "Business"."id" = numbered."id";
