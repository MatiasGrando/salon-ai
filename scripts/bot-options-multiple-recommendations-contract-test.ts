import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker = readFileSync(
  new URL('../src/bot-options/application/process-session-job.ts', import.meta.url),
  'utf8'
)

const recommendationQuery = worker.match(
  /SELECT s\."id", s\."name" FROM "ServiceAddon"[\s\S]*?ORDER BY MIN\(a\."sortOrder"\), s\."id"[\s\S]*?LIMIT \d+/
)?.[0]

assert.ok(recommendationQuery, 'the recommendation query must be present')
assert.match(
  recommendationQuery,
  /LIMIT 6$/,
  'the bot must load every recommendation that fits alongside skip and global navigation choices'
)
assert.match(recommendationQuery, /LEFT JOIN "ServiceCategory"/, 'uncategorized bookable addons must not require a real category row')
assert.match(recommendationQuery, /s\."catalogCategoryId" IS NULL OR c\."id" IS NOT NULL/, 'only uncategorized or active-category addons are eligible')

console.log('OK multiple service recommendations contract')
