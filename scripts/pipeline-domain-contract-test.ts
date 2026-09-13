import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PipelineDomainError,
  PipelineError,
  assertAssignableUser,
  assertCanArchiveStage,
  assertLifecycleTransition,
  parseEstimatedValue,
  parseExpectedRevision,
  parseHexColor,
  parseIsoInstant,
  parseLeadLifecycle,
  parsePipelineName,
  parseStageName,
  parseUniqueIdList,
  resolveReopenStage,
  toPipelineDto,
  toPipelineErrorDto
} from '../src/services/pipeline-domain.js'

function rejectsCode(run: () => unknown, code: string) {
  assert.throws(run, (error) => error instanceof PipelineDomainError && error.code === code)
}

assert.equal(parsePipelineName('  Ventas consultivas  '), 'Ventas consultivas')
assert.equal(parseStageName(' Contactado '), 'Contactado')
rejectsCode(() => parsePipelineName('   '), 'INVALID_PIPELINE_NAME')
rejectsCode(() => parseStageName('x'.repeat(81)), 'INVALID_STAGE_NAME')
assert.equal(parseHexColor('#a0B1c2'), '#A0B1C2')
rejectsCode(() => parseHexColor('gold'), 'INVALID_STAGE_COLOR')

for (const lifecycle of ['OPEN', 'WON', 'LOST', 'NO_RESPONSE'] as const) {
  assert.equal(parseLeadLifecycle(lifecycle), lifecycle)
}
rejectsCode(() => parseLeadLifecycle('CLOSED'), 'INVALID_LEAD_LIFECYCLE')
assert.equal(assertLifecycleTransition('OPEN', 'WON'), 'WON')
assert.equal(assertLifecycleTransition('LOST', 'OPEN'), 'OPEN')
rejectsCode(() => assertLifecycleTransition('OPEN', 'OPEN'), 'LEAD_LIFECYCLE_UNCHANGED')
rejectsCode(() => assertLifecycleTransition('WON', 'LOST'), 'INVALID_LEAD_LIFECYCLE_TRANSITION')

assert.equal(resolveReopenStage({ lastOpenStageId: 'second', activeStageIds: ['first', 'second'] }), 'second')
assert.equal(resolveReopenStage({ lastOpenStageId: 'archived', activeStageIds: ['first', 'second'] }), 'first')
rejectsCode(() => resolveReopenStage({ lastOpenStageId: null, activeStageIds: [] }), 'ACTIVE_STAGE_REQUIRED')

assert.deepEqual(
  assertAssignableUser({ id: 'user-a', businessId: 'business-a', isActive: true, role: 'STAFF' }, 'business-a'),
  { id: 'user-a', businessId: 'business-a', isActive: true, role: 'STAFF' }
)
rejectsCode(
  () => assertAssignableUser({ id: 'user-b', businessId: 'business-b', isActive: true, role: 'STAFF' }, 'business-a'),
  'INVALID_ASSIGNEE'
)
rejectsCode(
  () => assertAssignableUser({ id: 'global', businessId: null, isActive: true, role: 'SUPER_ADMIN' }, 'business-a'),
  'INVALID_ASSIGNEE'
)
rejectsCode(
  () => assertAssignableUser({ id: 'inactive', businessId: 'business-a', isActive: false, role: 'STAFF' }, 'business-a'),
  'INVALID_ASSIGNEE'
)

assert.doesNotThrow(() => assertCanArchiveStage({ activeStageCount: 2, openLeadCount: 0 }))
rejectsCode(() => assertCanArchiveStage({ activeStageCount: 1, openLeadCount: 0 }), 'LAST_ACTIVE_STAGE')
rejectsCode(() => assertCanArchiveStage({ activeStageCount: 2, openLeadCount: 1 }), 'STAGE_HAS_OPEN_LEADS')

assert.equal(parseExpectedRevision('42'), 42n)
rejectsCode(() => parseExpectedRevision(-1), 'INVALID_EXPECTED_REVISION')
assert.deepEqual(parseUniqueIdList(['a', 'b']), ['a', 'b'])
rejectsCode(() => parseUniqueIdList(['a', 'a']), 'DUPLICATE_IDS')
assert.equal(parseEstimatedValue(0.29), 0.29)
rejectsCode(() => parseEstimatedValue(0.291), 'INVALID_ESTIMATED_VALUE')
assert.equal(parseIsoInstant('2026-09-13T12:00:00-03:00').toISOString(), '2026-09-13T15:00:00.000Z')
rejectsCode(() => parseIsoInstant('2026-09-13'), 'INVALID_ABSOLUTE_INSTANT')

assert.deepEqual(
  toPipelineDto({ revision: 42n, occurredAt: new Date('2026-09-13T15:00:00.000Z'), nested: [1n] }),
  { revision: '42', occurredAt: '2026-09-13T15:00:00.000Z', nested: ['1'] }
)
assert.deepEqual(
  toPipelineErrorDto(new PipelineError('PIPELINE_REVISION_CONFLICT', 409, { currentRevision: 43n })),
  {
    error: 'PIPELINE_REVISION_CONFLICT',
    code: 'PIPELINE_REVISION_CONFLICT',
    details: { currentRevision: '43' }
  }
)

const service = await readFile(path.join(process.cwd(), 'src', 'services', 'pipeline-service.ts'), 'utf8')
assert.match(service, /class PipelineService/)
assert.match(service, /businessId/)
assert.match(service, /\$transaction/)
assert.match(service, /pipelineLeadEvent\.create/)
assert.match(service, /const archivedAt = new Date\(\)/)
assert.match(service, /position:\s*null/)
assert.match(service, /where:\s*\{ businessId_id:/)
assert.match(service, /type:\s*'ASSIGNED'/)
assert.match(service, /lastActivityAt:\s*now/)
assert.doesNotMatch(service, /\.delete(?:Many)?\(/)

await import('../src/services/pipeline-service.js')

console.log('pipeline-domain-contract-test: ok')
