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

console.log('OK multiple service recommendations contract')
