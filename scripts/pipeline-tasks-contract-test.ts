import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PipelineDomainError,
  parseIsoInstant,
  parseTaskCategory,
  parseTaskStatus,
  parseTaskTitle
} from '../src/services/pipeline-domain.js'

function rejectsCode(run: () => unknown, code: string) {
  assert.throws(run, (error) => error instanceof PipelineDomainError && error.code === code)
}

assert.equal(parseTaskTitle('  Llamar al prospecto  '), 'Llamar al prospecto')
assert.equal(parseTaskStatus('IN_PROGRESS'), 'IN_PROGRESS')
assert.equal(parseTaskCategory('MEETING'), 'MEETING')
assert.equal(parseIsoInstant('2026-09-13T09:00:00-03:00').toISOString(), '2026-09-13T12:00:00.000Z')
rejectsCode(() => parseTaskTitle(''), 'INVALID_TASK_TITLE')
rejectsCode(() => parseTaskStatus('BLOCKED'), 'INVALID_TASK_STATUS')
rejectsCode(() => parseIsoInstant('2026-09-13T09:00:00'), 'INVALID_ABSOLUTE_INSTANT')

const read = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), 'utf8')
const [routes, service] = await Promise.all([
  read('src/routes/pipeline.ts'),
  read('src/services/pipeline-service.ts')
])

for (const signature of [
  /app\.get\('\/pipeline\/responsibles'/,
  /app\.get\('\/pipeline\/tasks'/,
  /app\.post\('\/pipeline\/tasks'/,
  /app\.patch\('\/pipeline\/tasks\/:id'/,
  /app\.delete\('\/pipeline\/tasks\/:id'/,
  /app\.post\('\/pipeline\/tasks\/reorder'/
]) assert.match(routes, signature)

for (const operation of [
  'listResponsibles',
  'listTasks',
  'createTask',
  'updateTask',
  'archiveTask',
  'reorderTasks'
]) assert.match(service, new RegExp(`(?:async )?${operation}\\(`))

assert.match(service, /isolationLevel:\s*'Serializable'/)
assert.match(service, /PIPELINE_REVISION_CONFLICT/)
assert.match(service, /expectedRevision/)
assert.match(service, /assigneeUserId/)
assert.match(service, /leadId/)
assert.match(service, /archivedAt:\s*new Date\(\)|const archivedAt = new Date\(\)/)
assert.doesNotMatch(service, /pipelineTask\.delete/)

console.log('pipeline-tasks-contract-test: ok')
