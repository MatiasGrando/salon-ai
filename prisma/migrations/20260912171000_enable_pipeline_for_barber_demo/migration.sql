UPDATE "BusinessFeatureSettings" AS settings
SET "pipelineEnabled" = CASE
  WHEN business."customerCode" = 'WX-38N6UG' THEN true
  ELSE false
END
FROM "Business" AS business
WHERE settings."businessId" = business."id"
  AND (
    business."customerCode" = 'WX-38N6UG'
    OR (business."isDemo" = true AND business."demoType" = 'BARBERSHOP')
  );
