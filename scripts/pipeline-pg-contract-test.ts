import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = process.cwd()
const schema = await readFile(path.join(root, 'prisma', 'schema.prisma'), 'utf8')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const provisioning = await readFile(path.join(root, 'src', 'services', 'pipeline-provisioning.ts'), 'utf8')
const migrationsRoot = path.join(root, 'prisma', 'migrations')
const migrationNames = (await readdir(migrationsRoot)).filter((name) => name.endsWith('_add_pipeline'))

assert.equal(migrationNames.length, 1, 'debe existir exactamente una migración add_pipeline')
const migration = await readFile(path.join(migrationsRoot, migrationNames[0]!, 'migration.sql'), 'utf8')
const stageBackfillMigration = await readFile(
  path.join(migrationsRoot, '20260913023000_backfill_barber_demo_pipeline_stages', 'migration.sql'),
  'utf8'
)

for (const enumName of [
  'PipelineLeadLifecycle',
  'PipelineLeadPriority',
  'PipelineActivityKind',
  'PipelineTaskStatus',
  'PipelineTaskCategory',
  'PipelineEventType'
]) {
  assert.match(schema, new RegExp(`enum ${enumName} \\{`), `Prisma debe declarar ${enumName}`)
  assert.match(migration, new RegExp(`CREATE TYPE "${enumName}" AS ENUM`), `la migración debe crear ${enumName}`)
}

for (const model of [
  'Pipeline',
  'PipelineStage',
  'PipelineLead',
  'PipelineLeadActivity',
  'PipelineLeadEvent',
  'PipelineTask'
]) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Prisma debe declarar ${model}`)
  assert.match(migration, new RegExp(`CREATE TABLE "${model}"`), `la migración debe crear ${model}`)
}

for (const tenantSafeForeignKey of [
  'PipelineStage_businessId_pipelineId_fkey',
  'PipelineLead_businessId_pipelineId_fkey',
  'PipelineLead_businessId_stageId_fkey',
  'PipelineLead_businessId_lastOpenStageId_fkey',
  'PipelineLead_businessId_assigneeUserId_fkey',
  'PipelineLeadActivity_businessId_leadId_fkey',
  'PipelineLeadEvent_businessId_leadId_fkey',
  'PipelineTask_businessId_pipelineId_fkey',
  'PipelineTask_businessId_leadId_fkey',
  'PipelineTask_businessId_assigneeUserId_fkey'
]) {
  assert.ok(migration.includes(tenantSafeForeignKey), `falta FK tenant-safe ${tenantSafeForeignKey}`)
}

for (const globalAdminCompatibleActorForeignKey of [
  'PipelineLeadActivity_authorUserId_fkey',
  'PipelineLeadEvent_actorUserId_fkey'
]) {
  assert.ok(migration.includes(globalAdminCompatibleActorForeignKey), `falta FK de autor global ${globalAdminCompatibleActorForeignKey}`)
}

for (const invariant of [
  'PipelineStage_active_position_check',
  'PipelineStage_active_position_key',
  'PipelineLead_open_shape_check',
  'PipelineLead_active_position_key',
  'PipelineTask_active_position_check',
  'PipelineTask_active_position_key',
  'PipelineLeadEvent_append_only_trigger'
]) {
  assert.ok(migration.includes(invariant), `falta invariante SQL ${invariant}`)
}

assert.match(migration, /RAISE EXCEPTION 'PipelineLeadEvent is append-only'/)
assert.match(migration, /"customerCode" = 'WX-38N6UG'/)
assert.match(migration, /"pipelineEnabled" = true/)
assert.match(migration, /ON CONFLICT \("businessId"\) DO NOTHING/)
assert.match(migration, /Nuevo[\s\S]+Contactado[\s\S]+Agendar entrevista[\s\S]+Propuesta enviada/)
assert.doesNotMatch(migration, /UPDATE "BusinessFeatureSettings"[\s\S]+SET "pipelineEnabled" = true/)

assert.match(stageBackfillMigration, /"customerCode" = 'WX-38N6UG'/)
assert.match(stageBackfillMigration, /"pipelineEnabled" = true/)
assert.match(stageBackfillMigration, /NOT EXISTS[\s\S]+FROM "PipelineStage"/)
assert.match(stageBackfillMigration, /Nuevo[\s\S]+Contactado[\s\S]+Agendar entrevista[\s\S]+Propuesta enviada/)
assert.match(stageBackfillMigration, /ON CONFLICT DO NOTHING/)
assert.doesNotMatch(stageBackfillMigration, /(?:UPDATE|DELETE)\s+"(?:Business|BusinessFeatureSettings|PipelineStage)"/)

const seedDb = new PGlite()
try {
  await seedDb.exec(`
    CREATE TABLE "Business" ("id" text PRIMARY KEY, "customerCode" text NOT NULL);
    CREATE TABLE "BusinessFeatureSettings" ("businessId" text PRIMARY KEY, "pipelineEnabled" boolean NOT NULL);
    CREATE TABLE "Pipeline" ("id" text PRIMARY KEY, "businessId" text NOT NULL UNIQUE);
    CREATE TABLE "PipelineStage" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL,
      "pipelineId" text NOT NULL,
      "name" text NOT NULL,
      "color" text NOT NULL,
      "position" integer,
      "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("pipelineId", "position")
    );
    INSERT INTO "Business" VALUES ('barber-business', 'WX-38N6UG'), ('other-business', 'WX-OTHER');
    INSERT INTO "BusinessFeatureSettings" VALUES ('barber-business', true), ('other-business', true);
    INSERT INTO "Pipeline" VALUES ('barber-pipeline', 'barber-business'), ('other-pipeline', 'other-business');
  `)
  await seedDb.exec(stageBackfillMigration)
  await seedDb.exec(stageBackfillMigration)

  const barberStages = await seedDb.query<{ name: string; color: string; position: number }>(
    'SELECT name, color, position FROM "PipelineStage" WHERE "businessId" = $1 ORDER BY position',
    ['barber-business']
  )
  const otherStages = await seedDb.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM "PipelineStage" WHERE "businessId" = $1',
    ['other-business']
  )
  assert.deepEqual(barberStages.rows, [
    { name: 'Nuevo', color: '#E7B52C', position: 0 },
    { name: 'Contactado', color: '#D98A3A', position: 1 },
    { name: 'Agendar entrevista', color: '#D95C43', position: 2 },
    { name: 'Propuesta enviada', color: '#3B82C4', position: 3 }
  ])
  assert.equal(otherStages.rows[0]?.count, 0)
} finally {
  await seedDb.close()
}

assert.match(provisioning, /pipelineEnabled:\s*true/)
assert.match(provisioning, /upsert/)
assert.match(provisioning, /WX-38N6UG/)
assert.doesNotMatch(provisioning, /businessFeatureSettings\.(?:update|upsert)/)
assert.doesNotMatch(provisioning, /pipelineEnabled:\s*false/)
assert.equal(packageJson.scripts?.['test:pipeline-pg'], 'tsx scripts/pipeline-pg-contract-test.ts')

const service = await readFile(path.join(root, 'src', 'services', 'pipeline-service.ts'), 'utf8')
assert.match(service, /isolationLevel:\s*'Serializable'/)
assert.match(service, /updateMany\(\{[\s\S]*?revision:\s*expectedRevision/)
assert.match(service, /PIPELINE_REVISION_CONFLICT/)

const casDb = new PGlite()
try {
  await casDb.exec(`
    CREATE TABLE pipeline_cas (id text PRIMARY KEY, revision bigint NOT NULL);
    CREATE TABLE stage_cas (
      id text PRIMARY KEY,
      pipeline_id text NOT NULL REFERENCES pipeline_cas(id),
      position integer NOT NULL
    );
    INSERT INTO pipeline_cas VALUES ('pipeline-test', 7);
    INSERT INTO stage_cas VALUES ('stage-a', 'pipeline-test', 0), ('stage-b', 'pipeline-test', 1);
  `)
  const observedA = 7
  const observedB = 7

  await casDb.exec('BEGIN')
  const claimA = await casDb.query<{ revision: string }>(
    'UPDATE pipeline_cas SET revision = revision + 1 WHERE id = $1 AND revision = $2 RETURNING revision::text',
    ['pipeline-test', observedA]
  )
  assert.equal(claimA.rows.length,1)
  await casDb.query('UPDATE stage_cas SET position = CASE id WHEN $1 THEN 1 WHEN $2 THEN 0 END WHERE pipeline_id = $3', [
    'stage-a', 'stage-b', 'pipeline-test'
  ])
  await casDb.exec('COMMIT')

  await casDb.exec('BEGIN')
  const claimB = await casDb.query<{ revision: string }>(
    'UPDATE pipeline_cas SET revision = revision + 1 WHERE id = $1 AND revision = $2 RETURNING revision::text',
    ['pipeline-test', observedB]
  )
  assert.equal(claimB.rows.length, 0)
  await casDb.exec('ROLLBACK')

  const revision = await casDb.query<{ revision: string }>('SELECT revision::text FROM pipeline_cas WHERE id = $1', ['pipeline-test'])
  const positions = await casDb.query<{ id: string; position: number }>('SELECT id, position FROM stage_cas ORDER BY position')
  assert.equal(revision.rows[0]?.revision, '8')
  assert.deepEqual(positions.rows, [
    { id: 'stage-b', position: 0 },
    { id: 'stage-a', position: 1 }
  ])
} finally {
  await casDb.close()
}

console.log('pipeline-pg-contract-test: ok')


