import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const schema = await readFile('prisma/schema.prisma', 'utf8')
const migration = await readFile(
  'prisma/migrations/20260912170000_add_pipeline_feature_flag/migration.sql',
  'utf8'
)
const targetedMigration = await readFile(
  'prisma/migrations/20260912171000_enable_pipeline_for_barber_demo/migration.sql',
  'utf8'
)
const authRoute = await readFile('src/routes/auth.ts', 'utf8')
const businessRoute = await readFile('src/routes/business.ts', 'utf8')
const businessService = await readFile('src/services/business-service.ts', 'utf8')
const demoRoute = await readFile('src/routes/demo-profile.ts', 'utf8')
const crmUi = await readFile('src/routes/crm-ui.ts', 'utf8')
const pipelineUi = await readFile('src/routes/crm-ui/pipeline.ts', 'utf8')

assert.match(
  schema,
  /pipelineEnabled\s+Boolean\s+@default\(false\)/,
  'Pipeline must be disabled by default for every business.'
)
assert.match(migration, /ADD COLUMN "pipelineEnabled" BOOLEAN NOT NULL DEFAULT false/)
assert.doesNotMatch(
  demoRoute,
  /pipelineEnabled:\s*type === 'BARBERSHOP'/,
  'Creating a BARBERSHOP demo must not enable Pipeline automatically.'
)
assert.match(
  targetedMigration,
  /"customerCode" = 'WX-38N6UG'[\s\S]*?THEN true/,
  'Pipeline must be enabled for the explicitly selected Barber Demo account.'
)
assert.match(
  targetedMigration,
  /ELSE false[\s\S]*?"isDemo" = true[\s\S]*?"demoType" = 'BARBERSHOP'/,
  'The follow-up migration must undo the accidental generic BARBERSHOP enablement.'
)

for (const [name, source] of [
  ['auth route', authRoute],
  ['business route', businessRoute],
  ['business service', businessService],
  ['demo route', demoRoute]
] as const) {
  assert.match(source, /featureSettings:[\s\S]{0,160}?pipelineEnabled:\s*true/, `${name} must serialize pipelineEnabled.`)
}

assert.match(crmUi, /data-mobile-section="pipeline"[^>]*hidden/, 'Mobile Pipeline navigation must start hidden.')
assert.match(crmUi, /section:\s*'pipeline',\s*label:\s*'Pipeline'/, 'Desktop navigation must know the Pipeline section.')
assert.match(crmUi, /\$\{pipelineMarkup\}/, 'CRM must compose the Pipeline module into its shell.')
assert.match(pipelineUi, /id="pipeline-shell"/, 'Enabled businesses need a navigable Pipeline shell.')
assert.match(
  crmUi,
  /state\.business\?\.featureSettings\?\.pipelineEnabled === true\s*\?\s*'pipeline'\s*:\s*null/,
  'Pipeline visibility must be derived from the selected business feature flag.'
)
assert.match(
  crmUi,
  /if \(!staffVisibleSections\(\)\.includes\(section\)\) section = staffVisibleSections\(\)\[0\] \|\| 'accounts'/,
  'Direct section navigation must fail closed when Pipeline is not enabled.'
)

console.log('Pipeline feature flag contract: OK')

