import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'

const runbook = readFileSync(new URL('../docs/lead-form-migration-append-only-recovery.md', import.meta.url), 'utf8')
const recoverySql = runbook.match(/```sql\n([\s\S]*?)\n```/)?.[1]
assert.ok(recoverySql, 'runbook must contain a bounded recovery transaction')
assert.doesNotMatch(recoverySql, /CASCADE|UPDATE "PipelineLeadEvent"/i)
assert.match(recoverySql, /LOCK TABLE "BusinessFeatureSettings", "PipelineLead", "PipelineLeadEvent"\s+IN ACCESS EXCLUSIVE MODE/)

async function historyHash(db: PGlite) {
  const rows = await db.query<{ id: string; actorUserId: string }>('SELECT "id","actorUserId" FROM "PipelineLeadEvent" ORDER BY "id"')
  return createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex')
}

async function fixture(withData: boolean) {
  const db = new PGlite()
  await db.exec(`
    CREATE TYPE "PipelineActorKind" AS ENUM ('USER','SYSTEM');
    CREATE TYPE "LeadCaptureFormStatus" AS ENUM ('DRAFT','PUBLISHED','DISABLED');
    CREATE TYPE "FormSubmissionStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED');
    CREATE TYPE "LeadRewardType" AS ENUM ('FILE','LINK','DISCOUNT','TEXT');
    CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamp, rolled_back_at timestamp);
    INSERT INTO "_prisma_migrations" VALUES ('20260915183000_add_lead_capture_forms', NULL, NULL);
    CREATE TABLE "BusinessFeatureSettings" ("id" text PRIMARY KEY);
    CREATE TABLE "PipelineLead" ("id" text PRIMARY KEY);
    CREATE TABLE "PipelineLeadEvent" ("id" text PRIMARY KEY, "actorUserId" text NOT NULL);
    INSERT INTO "BusinessFeatureSettings" VALUES ('settings-a');
    INSERT INTO "PipelineLead" VALUES ('lead-a');
    INSERT INTO "PipelineLeadEvent" VALUES ('event-a', 'user-a');
    ALTER TABLE "BusinessFeatureSettings" ADD COLUMN "leadCaptureFormsEnabled" boolean NOT NULL DEFAULT false;
    ALTER TABLE "PipelineLead" ADD COLUMN "customData" jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN "customDataSchemaVersion" integer NOT NULL DEFAULT 1;
    ALTER TABLE "PipelineLeadEvent" ADD COLUMN "actorKind" "PipelineActorKind";
    CREATE FUNCTION "reject_pipeline_lead_event_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'PipelineLeadEvent is append-only'; END;
    $$;
    CREATE TRIGGER "PipelineLeadEvent_append_only_trigger"
    BEFORE UPDATE OR DELETE ON "PipelineLeadEvent"
    FOR EACH ROW EXECUTE FUNCTION "reject_pipeline_lead_event_mutation"();
  `)
  if (withData) await db.exec(`UPDATE "PipelineLead" SET "customData"='{"preserve":true}'::jsonb WHERE "id"='lead-a'`)
  return db
}

{
  const db = await fixture(false)
  try {
    const before = await historyHash(db)
    await db.exec(recoverySql)
    const after = await historyHash(db)
    assert.equal(after, before, 'historical event payload must remain byte-for-byte stable excluding actorKind')
    const event = await db.query<{ id: string; actorUserId: string }>('SELECT "id","actorUserId" FROM "PipelineLeadEvent"')
    assert.deepEqual(event.rows, [{ id: 'event-a', actorUserId: 'user-a' }])
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name IN
        ('actorKind','customData','customDataSchemaVersion','leadCaptureFormsEnabled')
    `)
    assert.equal(columns.rows.length, 0)
    const types = await db.query<{ typname: string }>(`
      SELECT typname FROM pg_type WHERE typnamespace='public'::regnamespace
        AND typname IN ('PipelineActorKind','LeadCaptureFormStatus','FormSubmissionStatus','LeadRewardType')
    `)
    assert.equal(types.rows.length, 0)
    await assert.rejects(db.query(`UPDATE "PipelineLeadEvent" SET "actorUserId"='user-b' WHERE "id"='event-a'`), /append-only/i)
  } finally { await db.close() }
}

{
  const db = await fixture(true)
  try {
    const before = await historyHash(db)
    await assert.rejects(db.exec(recoverySql), /non-default data; stop/i)
    await db.exec('ROLLBACK')
    assert.equal(await historyHash(db), before)
    const kept = await db.query<{ customData: unknown }>('SELECT "customData" FROM "PipelineLead" WHERE "id"=$1', ['lead-a'])
    assert.deepEqual(kept.rows[0]?.customData, { preserve: true })
  } finally { await db.close() }
}

console.log('lead-form-partial-recovery-contract-test: PASS')
