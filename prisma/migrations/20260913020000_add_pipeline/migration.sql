-- CreateEnum
CREATE TYPE "PipelineLeadLifecycle" AS ENUM ('OPEN', 'WON', 'LOST', 'NO_RESPONSE');
CREATE TYPE "PipelineLeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "PipelineActivityKind" AS ENUM ('NOTE', 'FOLLOW_UP', 'CONTACT');
CREATE TYPE "PipelineTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "PipelineTaskCategory" AS ENUM ('BUSINESS', 'MEETING', 'PERSONAL', 'OPERATIONS');
CREATE TYPE "PipelineEventType" AS ENUM ('CREATED', 'UPDATED', 'MOVED', 'ASSIGNED', 'RESOLVED', 'REOPENED', 'ACTIVITY_RECORDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Pipeline" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Pipeline de leads',
  "revision" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Pipeline_name_not_blank_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  CONSTRAINT "Pipeline_revision_non_negative_check" CHECK ("revision" >= 0)
);

CREATE TABLE "PipelineStage" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "position" INTEGER,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PipelineStage_name_not_blank_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "PipelineStage_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT "PipelineStage_active_position_check" CHECK (
    ("archivedAt" IS NULL AND "position" IS NOT NULL AND "position" >= 0)
    OR ("archivedAt" IS NOT NULL AND "position" IS NULL)
  )
);

CREATE TABLE "PipelineLead" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "stageId" TEXT,
  "lastOpenStageId" TEXT,
  "lifecycle" "PipelineLeadLifecycle" NOT NULL DEFAULT 'OPEN',
  "assigneeUserId" TEXT,
  "title" TEXT NOT NULL,
  "contactName" TEXT,
  "companyName" TEXT,
  "email" TEXT,
  "normalizedEmail" TEXT,
  "phone" TEXT,
  "normalizedPhone" TEXT,
  "estimatedValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "priority" "PipelineLeadPriority" NOT NULL DEFAULT 'MEDIUM',
  "source" TEXT,
  "externalReference" TEXT,
  "position" INTEGER,
  "lastActivityAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineLead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PipelineLead_title_not_blank_check" CHECK (length(btrim("title")) BETWEEN 1 AND 160),
  CONSTRAINT "PipelineLead_estimated_value_check" CHECK ("estimatedValue" >= 0),
  CONSTRAINT "PipelineLead_open_shape_check" CHECK (
    ("archivedAt" IS NOT NULL AND "position" IS NULL)
    OR (
      "archivedAt" IS NULL
      AND (
        ("lifecycle" = 'OPEN' AND "stageId" IS NOT NULL AND "position" IS NOT NULL AND "position" >= 0 AND "resolvedAt" IS NULL)
        OR ("lifecycle" <> 'OPEN' AND "stageId" IS NULL AND "position" IS NULL AND "resolvedAt" IS NOT NULL)
      )
    )
  )
);

CREATE TABLE "PipelineLeadActivity" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "kind" "PipelineActivityKind" NOT NULL,
  "body" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineLeadActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PipelineLeadActivity_body_not_blank_check" CHECK (length(btrim("body")) BETWEEN 1 AND 4000)
);

CREATE TABLE "PipelineLeadEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "type" "PipelineEventType" NOT NULL,
  "fromStageId" TEXT,
  "toStageId" TEXT,
  "fromLifecycle" "PipelineLeadLifecycle",
  "toLifecycle" "PipelineLeadLifecycle",
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineLeadEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PipelineTask" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "leadId" TEXT,
  "assigneeUserId" TEXT,
  "title" TEXT NOT NULL,
  "category" "PipelineTaskCategory" NOT NULL DEFAULT 'BUSINESS',
  "notes" TEXT,
  "dueAt" TIMESTAMP(3),
  "status" "PipelineTaskStatus" NOT NULL DEFAULT 'TODO',
  "position" INTEGER,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PipelineTask_title_not_blank_check" CHECK (length(btrim("title")) BETWEEN 1 AND 160),
  CONSTRAINT "PipelineTask_active_position_check" CHECK (
    ("archivedAt" IS NULL AND "position" IS NOT NULL AND "position" >= 0)
    OR ("archivedAt" IS NOT NULL AND "position" IS NULL)
  )
);

-- Unique and lookup indexes
CREATE UNIQUE INDEX "Pipeline_businessId_key" ON "Pipeline"("businessId");
CREATE UNIQUE INDEX "Pipeline_businessId_id_key" ON "Pipeline"("businessId", "id");
CREATE UNIQUE INDEX "PipelineStage_businessId_id_key" ON "PipelineStage"("businessId", "id");
CREATE UNIQUE INDEX "PipelineStage_active_position_key" ON "PipelineStage"("pipelineId", "position") WHERE "archivedAt" IS NULL;
CREATE INDEX "PipelineStage_businessId_pipelineId_archivedAt_position_idx" ON "PipelineStage"("businessId", "pipelineId", "archivedAt", "position");
CREATE UNIQUE INDEX "PipelineLead_businessId_id_key" ON "PipelineLead"("businessId", "id");
CREATE UNIQUE INDEX "PipelineLead_active_position_key" ON "PipelineLead"("businessId", "stageId", "position") WHERE "archivedAt" IS NULL AND "lifecycle" = 'OPEN';
CREATE INDEX "PipelineLead_businessId_lifecycle_archivedAt_lastActivityAt_idx" ON "PipelineLead"("businessId", "lifecycle", "archivedAt", "lastActivityAt");
CREATE INDEX "PipelineLead_businessId_stageId_archivedAt_position_idx" ON "PipelineLead"("businessId", "stageId", "archivedAt", "position");
CREATE INDEX "PipelineLead_businessId_assigneeUserId_archivedAt_idx" ON "PipelineLead"("businessId", "assigneeUserId", "archivedAt");
CREATE INDEX "PipelineLead_businessId_normalizedEmail_idx" ON "PipelineLead"("businessId", "normalizedEmail");
CREATE INDEX "PipelineLead_businessId_normalizedPhone_idx" ON "PipelineLead"("businessId", "normalizedPhone");
CREATE UNIQUE INDEX "PipelineLeadActivity_businessId_id_key" ON "PipelineLeadActivity"("businessId", "id");
CREATE INDEX "PipelineLeadActivity_businessId_leadId_occurredAt_idx" ON "PipelineLeadActivity"("businessId", "leadId", "occurredAt");
CREATE UNIQUE INDEX "PipelineLeadEvent_businessId_id_key" ON "PipelineLeadEvent"("businessId", "id");
CREATE INDEX "PipelineLeadEvent_businessId_leadId_createdAt_idx" ON "PipelineLeadEvent"("businessId", "leadId", "createdAt");
CREATE INDEX "PipelineLeadEvent_businessId_type_createdAt_idx" ON "PipelineLeadEvent"("businessId", "type", "createdAt");
CREATE UNIQUE INDEX "PipelineTask_businessId_id_key" ON "PipelineTask"("businessId", "id");
CREATE UNIQUE INDEX "PipelineTask_active_position_key" ON "PipelineTask"("businessId", "pipelineId", "status", "position") WHERE "archivedAt" IS NULL;
CREATE INDEX "PipelineTask_businessId_pipelineId_archivedAt_status_position_idx" ON "PipelineTask"("businessId", "pipelineId", "archivedAt", "status", "position");
CREATE INDEX "PipelineTask_businessId_assigneeUserId_archivedAt_idx" ON "PipelineTask"("businessId", "assigneeUserId", "archivedAt");
CREATE INDEX "PipelineTask_businessId_leadId_archivedAt_idx" ON "PipelineTask"("businessId", "leadId", "archivedAt");

-- Tenant-safe foreign keys
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_businessId_pipelineId_fkey" FOREIGN KEY ("businessId", "pipelineId") REFERENCES "Pipeline"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLead" ADD CONSTRAINT "PipelineLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLead" ADD CONSTRAINT "PipelineLead_businessId_pipelineId_fkey" FOREIGN KEY ("businessId", "pipelineId") REFERENCES "Pipeline"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLead" ADD CONSTRAINT "PipelineLead_businessId_stageId_fkey" FOREIGN KEY ("businessId", "stageId") REFERENCES "PipelineStage"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLead" ADD CONSTRAINT "PipelineLead_businessId_lastOpenStageId_fkey" FOREIGN KEY ("businessId", "lastOpenStageId") REFERENCES "PipelineStage"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLead" ADD CONSTRAINT "PipelineLead_businessId_assigneeUserId_fkey" FOREIGN KEY ("businessId", "assigneeUserId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadActivity" ADD CONSTRAINT "PipelineLeadActivity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadActivity" ADD CONSTRAINT "PipelineLeadActivity_businessId_leadId_fkey" FOREIGN KEY ("businessId", "leadId") REFERENCES "PipelineLead"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadActivity" ADD CONSTRAINT "PipelineLeadActivity_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadEvent" ADD CONSTRAINT "PipelineLeadEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadEvent" ADD CONSTRAINT "PipelineLeadEvent_businessId_leadId_fkey" FOREIGN KEY ("businessId", "leadId") REFERENCES "PipelineLead"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadEvent" ADD CONSTRAINT "PipelineLeadEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadEvent" ADD CONSTRAINT "PipelineLeadEvent_businessId_fromStageId_fkey" FOREIGN KEY ("businessId", "fromStageId") REFERENCES "PipelineStage"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineLeadEvent" ADD CONSTRAINT "PipelineLeadEvent_businessId_toStageId_fkey" FOREIGN KEY ("businessId", "toStageId") REFERENCES "PipelineStage"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineTask" ADD CONSTRAINT "PipelineTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineTask" ADD CONSTRAINT "PipelineTask_businessId_pipelineId_fkey" FOREIGN KEY ("businessId", "pipelineId") REFERENCES "Pipeline"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineTask" ADD CONSTRAINT "PipelineTask_businessId_leadId_fkey" FOREIGN KEY ("businessId", "leadId") REFERENCES "PipelineLead"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineTask" ADD CONSTRAINT "PipelineTask_businessId_assigneeUserId_fkey" FOREIGN KEY ("businessId", "assigneeUserId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lead history is immutable even for accidental raw-SQL writes.
CREATE FUNCTION "reject_pipeline_lead_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PipelineLeadEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PipelineLeadEvent_append_only_trigger"
BEFORE UPDATE OR DELETE ON "PipelineLeadEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_pipeline_lead_event_mutation"();

-- Provision only the already-enabled Barber Demo. Reads never provision data.
WITH eligible AS (
  SELECT business."id" AS "businessId"
  FROM "Business" AS business
  JOIN "BusinessFeatureSettings" AS settings ON settings."businessId" = business."id"
  WHERE business."customerCode" = 'WX-38N6UG'
    AND settings."pipelineEnabled" = true
), inserted AS (
  INSERT INTO "Pipeline" ("id", "businessId", "name", "updatedAt")
  SELECT 'pl_' || md5(eligible."businessId"), eligible."businessId", 'Pipeline de leads', CURRENT_TIMESTAMP
  FROM eligible
  ON CONFLICT ("businessId") DO NOTHING
  RETURNING "businessId"
)
INSERT INTO "PipelineStage" ("id", "businessId", "pipelineId", "name", "color", "position", "updatedAt")
SELECT
  'pls_' || md5(pipeline."businessId" || ':' || defaults.position::text),
  pipeline."businessId",
  pipeline."id",
  defaults.name,
  defaults.color,
  defaults.position,
  CURRENT_TIMESTAMP
FROM "Pipeline" AS pipeline
JOIN eligible ON eligible."businessId" = pipeline."businessId"
CROSS JOIN (VALUES
  (0, 'Nuevo', '#E7B52C'),
  (1, 'Contactado', '#D98A3A'),
  (2, 'Agendar entrevista', '#D95C43'),
  (3, 'Propuesta enviada', '#3B82C4')
) AS defaults(position, name, color)
ON CONFLICT DO NOTHING;
