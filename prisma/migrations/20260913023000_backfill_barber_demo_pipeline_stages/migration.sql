-- Repair the initial Pipeline seed without changing the already-applied migration.
-- The data-modifying CTE that created Pipeline used one statement snapshot, so its
-- final SELECT could not see a Pipeline inserted by the same statement.
WITH target_pipeline AS (
  SELECT pipeline."id", pipeline."businessId"
  FROM "Pipeline" AS pipeline
  JOIN "Business" AS business
    ON business."id" = pipeline."businessId"
  JOIN "BusinessFeatureSettings" AS settings
    ON settings."businessId" = business."id"
  WHERE business."customerCode" = 'WX-38N6UG'
    AND settings."pipelineEnabled" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "PipelineStage" AS stage
      WHERE stage."businessId" = pipeline."businessId"
        AND stage."pipelineId" = pipeline."id"
    )
)
INSERT INTO "PipelineStage" (
  "id",
  "businessId",
  "pipelineId",
  "name",
  "color",
  "position",
  "updatedAt"
)
SELECT
  'pls_' || md5(target."businessId" || ':' || defaults.position::text),
  target."businessId",
  target."id",
  defaults.name,
  defaults.color,
  defaults.position,
  CURRENT_TIMESTAMP
FROM target_pipeline AS target
CROSS JOIN (VALUES
  (0, 'Nuevo', '#E7B52C'),
  (1, 'Contactado', '#D98A3A'),
  (2, 'Agendar entrevista', '#D95C43'),
  (3, 'Propuesta enviada', '#3B82C4')
) AS defaults(position, name, color)
ON CONFLICT DO NOTHING;
