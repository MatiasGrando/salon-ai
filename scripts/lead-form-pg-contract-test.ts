import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = process.cwd()
const schema = await readFile(path.join(root, 'prisma', 'schema.prisma'), 'utf8')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
const migrationNames = (await readdir(path.join(root, 'prisma', 'migrations')))
  .filter((name) => name.endsWith('_add_lead_capture_forms'))
assert.equal(migrationNames.length, 1, 'debe existir exactamente una migración add_lead_capture_forms')
const migration = await readFile(path.join(root, 'prisma', 'migrations', migrationNames[0]!, 'migration.sql'), 'utf8')
const rewardModeMigrationNames = (await readdir(path.join(root, 'prisma', 'migrations')))
  .filter((name) => name.endsWith('_add_lead_form_reward_mode'))
assert.equal(rewardModeMigrationNames.length, 1, 'debe existir exactamente una migración add_lead_form_reward_mode')
const rewardModeMigration = await readFile(path.join(root, 'prisma', 'migrations', rewardModeMigrationNames[0]!, 'migration.sql'), 'utf8')

for (const name of ['LeadCaptureFormStatus', 'FormSubmissionStatus', 'LeadRewardType', 'PipelineActorKind']) {
  assert.match(schema, new RegExp(`enum ${name} \\{`), `Prisma debe declarar ${name}`)
  assert.match(migration, new RegExp(`CREATE TYPE "${name}" AS ENUM`), `la migración debe crear ${name}`)
}
for (const name of ['LeadCaptureForm', 'FormSubmission', 'FormReward', 'RewardClaim', 'PublicFormRateLimitBucket']) {
  assert.match(schema, new RegExp(`model ${name} \\{`), `Prisma debe declarar ${name}`)
  assert.match(migration, new RegExp(`CREATE TABLE "${name}"`), `la migración debe crear ${name}`)
}
assert.match(schema, /leadCaptureFormsEnabled\s+Boolean\s+@default\(false\)/)
assert.match(schema, /customData\s+Json\s+@default\("\{\}"\)/)
assert.match(schema, /customDataSchemaVersion\s+Int\s+@default\(1\)/)
assert.match(schema, /actorKind\s+PipelineActorKind\s+@default\(USER\)/)
assert.match(schema, /actorUserId\s+String\?/)
assert.match(migration, /ADD COLUMN "leadCaptureFormsEnabled" BOOLEAN NOT NULL DEFAULT false/)
assert.match(migration, /ADD COLUMN "actorKind" "PipelineActorKind" NOT NULL DEFAULT 'USER'/)
assert.doesNotMatch(migration, /UPDATE "PipelineLeadEvent"/)
assert.match(migration, /"FormSubmission_accepted_requires_lead_check"/)
assert.match(migration, /"PipelineLeadEvent_actor_shape_check"/)
assert.match(migration, /"FormSubmission_businessId_formId_idempotencyKey_key"/)
assert.match(migration, /"LeadCaptureForm_one_published_slug_key"/)
assert.equal(pkg.scripts?.['test:lead-form-pg'], 'tsx scripts/lead-form-pg-contract-test.ts')
assert.match(schema, /enum LeadFormRewardMode\s*\{\s*NONE\s+BENEFIT\s*\}/s)
assert.match(schema, /rewardMode\s+LeadFormRewardMode\s+@default\(NONE\)/)
assert.match(schema, /model FormSubmission \{[\s\S]*rewardMode\s+LeadFormRewardMode\s+@default\(NONE\)/)
assert.match(rewardModeMigration, /CREATE TYPE "LeadFormRewardMode" AS ENUM \('NONE', 'BENEFIT'\)/)
assert.match(rewardModeMigration, /ALTER TABLE "LeadCaptureForm"[\s\S]*ADD COLUMN "rewardMode" "LeadFormRewardMode" NOT NULL DEFAULT 'NONE'/)
assert.match(rewardModeMigration, /ALTER TABLE "FormSubmission"[\s\S]*ADD COLUMN "rewardMode" "LeadFormRewardMode"/)
assert.match(rewardModeMigration, /UPDATE "FormSubmission" SET "rewardMode" = 'BENEFIT'/)
assert.match(rewardModeMigration, /ALTER COLUMN "rewardMode" SET NOT NULL/)
assert.match(rewardModeMigration, /CREATE UNIQUE INDEX "FormReward_one_enabled_per_form_key"[\s\S]*WHERE "enabled" = true/)

const db = new PGlite()
try {
  await db.exec(`
    CREATE TYPE "PipelineEventType" AS ENUM ('CREATED');
    CREATE TABLE "Business" ("id" text PRIMARY KEY);
    CREATE TABLE "BusinessFeatureSettings" ("id" text PRIMARY KEY, "businessId" text NOT NULL UNIQUE);
    CREATE TABLE "User" ("id" text PRIMARY KEY, "businessId" text, UNIQUE ("businessId", "id"));
    CREATE TABLE "Pipeline" ("id" text PRIMARY KEY, "businessId" text NOT NULL UNIQUE, UNIQUE ("businessId", "id"));
    CREATE TABLE "PipelineStage" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "pipelineId" text NOT NULL, UNIQUE ("businessId", "id"));
    CREATE TABLE "PipelineLead" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "pipelineId" text NOT NULL, UNIQUE ("businessId", "id"));
    CREATE TABLE "PipelineLeadEvent" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "leadId" text NOT NULL, "actorUserId" text NOT NULL, "type" "PipelineEventType" NOT NULL, "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO "Business" VALUES ('business-a'), ('business-b');
    INSERT INTO "BusinessFeatureSettings" VALUES ('settings-a', 'business-a');
    INSERT INTO "User" VALUES ('user-a', 'business-a');
    INSERT INTO "Pipeline" VALUES ('pipeline-a', 'business-a'), ('pipeline-b', 'business-b');
    INSERT INTO "PipelineStage" VALUES ('stage-a', 'business-a', 'pipeline-a'), ('stage-b', 'business-b', 'pipeline-b');
    INSERT INTO "PipelineLead" VALUES ('lead-a', 'business-a', 'pipeline-a');
    INSERT INTO "PipelineLeadEvent" VALUES ('event-existing', 'business-a', 'lead-a', 'user-a', 'CREATED', CURRENT_TIMESTAMP);
    CREATE FUNCTION pipeline_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'PipelineLeadEvent is append-only';
    END;
    $$;
    CREATE TRIGGER "PipelineLeadEvent_append_only_trigger"
    BEFORE UPDATE OR DELETE ON "PipelineLeadEvent"
    FOR EACH ROW EXECUTE FUNCTION pipeline_event_append_only();
  `)
  await assert.rejects(
    db.query(`UPDATE "PipelineLeadEvent" SET "actorUserId" = 'user-a' WHERE "id" = 'event-existing'`),
    /append-only/i
  )
  await db.exec(migration)
  await db.exec(rewardModeMigration)
  const settings = await db.query<{ leadCaptureFormsEnabled: boolean }>('SELECT "leadCaptureFormsEnabled" FROM "BusinessFeatureSettings" WHERE "businessId" = $1', ['business-a'])
  assert.equal(settings.rows[0]?.leadCaptureFormsEnabled, false)
  const event = await db.query<{ actorKind: string; actorUserId: string | null }>('SELECT "actorKind", "actorUserId" FROM "PipelineLeadEvent" WHERE "id" = $1', ['event-existing'])
  assert.deepEqual(event.rows[0], { actorKind: 'USER', actorUserId: 'user-a' })

  await db.query(`INSERT INTO "LeadCaptureForm" ("id", "businessId", "pipelineId", "initialStageId", "publicSlug", "name", "fields", "updatedAt") VALUES ('form-a', 'business-a', 'pipeline-a', 'stage-a', 'diagnostico', 'Diagnóstico', '{}'::jsonb, CURRENT_TIMESTAMP)`)
  const legacyMode = await db.query<{ rewardMode: string }>('SELECT "rewardMode" FROM "LeadCaptureForm" WHERE "id" = $1', ['form-a'])
  assert.equal(legacyMode.rows[0]?.rewardMode, 'NONE')
  await db.query(`INSERT INTO "LeadCaptureForm" ("id", "businessId", "pipelineId", "initialStageId", "publicSlug", "name", "fields", "rewardMode", "updatedAt") VALUES ('form-benefit', 'business-a', 'pipeline-a', 'stage-a', 'benefit', 'Benefit', '{}'::jsonb, 'BENEFIT', CURRENT_TIMESTAMP)`)
  await db.query(`INSERT INTO "FormReward" ("id", "businessId", "formId", "name", "type", "version", "enabled", "payloadEncrypted", "updatedAt") VALUES ('reward-one', 'business-a', 'form-benefit', 'Uno', 'TEXT', 1, true, 'cipher-one', CURRENT_TIMESTAMP)`)
  await assert.rejects(db.query(`INSERT INTO "FormReward" ("id", "businessId", "formId", "name", "type", "version", "enabled", "payloadEncrypted", "updatedAt") VALUES ('reward-two', 'business-a', 'form-benefit', 'Dos', 'TEXT', 2, true, 'cipher-two', CURRENT_TIMESTAMP)`), /one_enabled_per_form|unique constraint/i)
  await assert.rejects(db.query(`INSERT INTO "LeadCaptureForm" ("id", "businessId", "pipelineId", "initialStageId", "publicSlug", "name", "fields", "rewardMode", "updatedAt") VALUES ('form-invalid', 'business-a', 'pipeline-a', 'stage-a', 'invalid', 'Invalid', '{}'::jsonb, 'AUTO', CURRENT_TIMESTAMP)`), /invalid input value for enum/i)
  await assert.rejects(db.query(`INSERT INTO "LeadCaptureForm" ("id", "businessId", "pipelineId", "initialStageId", "publicSlug", "name", "fields", "updatedAt") VALUES ('form-cross', 'business-a', 'pipeline-b', 'stage-b', 'cross', 'Cross', '{}'::jsonb, CURRENT_TIMESTAMP)`), /foreign key|violates/i)
  await assert.rejects(db.query(`INSERT INTO "FormSubmission" ("id", "businessId", "formId", "idempotencyKey", "payloadFingerprint", "status", "answers") VALUES ('submission-bad', 'business-a', 'form-a', 'key-bad', 'hash-bad', 'ACCEPTED', '{}'::jsonb)`), /accepted_requires_lead|check constraint/i)
  await db.query(`INSERT INTO "FormSubmission" ("id", "businessId", "formId", "leadId", "idempotencyKey", "payloadFingerprint", "status", "answers", "acceptedAt") VALUES ('submission-a', 'business-a', 'form-a', 'lead-a', 'key-a', 'hash-a', 'ACCEPTED', '{}'::jsonb, CURRENT_TIMESTAMP)`)
  const submissionMode = await db.query<{ rewardMode: string }>('SELECT "rewardMode" FROM "FormSubmission" WHERE "id" = $1', ['submission-a'])
  assert.equal(submissionMode.rows[0]?.rewardMode, 'NONE')
  await assert.rejects(db.query(`INSERT INTO "FormSubmission" ("id", "businessId", "formId", "leadId", "idempotencyKey", "payloadFingerprint", "status", "answers", "acceptedAt") VALUES ('submission-duplicate', 'business-a', 'form-a', 'lead-a', 'key-a', 'hash-a', 'ACCEPTED', '{}'::jsonb, CURRENT_TIMESTAMP)`), /idempotencyKey|unique constraint/i)
  await db.query(`INSERT INTO "PipelineLeadEvent" ("id", "businessId", "leadId", "actorKind", "actorUserId", "type") VALUES ('event-system', 'business-a', 'lead-a', 'SYSTEM', NULL, 'CREATED')`)
  await assert.rejects(db.query(`INSERT INTO "PipelineLeadEvent" ("id", "businessId", "leadId", "actorKind", "actorUserId", "type") VALUES ('event-invalid', 'business-a', 'lead-a', 'USER', NULL, 'CREATED')`), /actor_shape|check constraint/i)
} finally {
  await db.close()
}

console.log('lead-form-pg-contract-test: ok')
