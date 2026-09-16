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
import {
  createPipelineLeadInTransaction,
  type CreatePipelineLeadCommand
} from '../src/services/pipeline-lead-command.js'
import { PipelineService } from '../src/services/pipeline-service.js'

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
assert.match(service, /createPipelineLeadInTransaction/)
assert.match(service, /actor:\s*\{\s*kind:\s*'USER',\s*userId:\s*actorUserId\s*\}/)
assert.doesNotMatch(service, /\.delete(?:Many)?\(/)

await import('../src/services/pipeline-service.js')

type StoredLead = Record<string, unknown> & { id: string }

function createPipelineCommandHarness(options: {
  pipelineEnabled?: boolean
  actorBusinessId?: string | null
  actorRole?: string
  stageBusinessId?: string
  failEvent?: boolean
} = {}) {
  const state = { leads: [] as StoredLead[], events: [] as Record<string, unknown>[], revision: 7n }
  const operations: string[] = []
  const tx = {
    businessFeatureSettings: {
      findUnique: async () => ({ pipelineEnabled: options.pipelineEnabled ?? true })
    },
    pipeline: {
      findUnique: async () => ({ id: 'pipeline-a', businessId: 'business-a', revision: state.revision }),
      update: async () => {
        operations.push('revision')
        state.revision += 1n
        return { id: 'pipeline-a', revision: state.revision }
      }
    },
    pipelineStage: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === 'stage-a' && (options.stageBusinessId ?? 'business-a') === where.businessId
          ? { id: 'stage-a', businessId: options.stageBusinessId ?? 'business-a', pipelineId: 'pipeline-a' }
          : null
    },
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id === 'actor-a') {
          const actorBusinessId = Object.hasOwn(options, 'actorBusinessId') ? options.actorBusinessId! : 'business-a'
          return { id: 'actor-a', businessId: actorBusinessId, isActive: true, role: options.actorRole ?? 'BUSINESS_ADMIN' }
        }
        if (where.id === 'assignee-a') return { id: 'assignee-a', businessId: 'business-a', isActive: true, role: 'STAFF' }
        return null
      }
    },
    pipelineLead: {
      aggregate: async () => {
        operations.push('position')
        return { _max: { position: 3 } }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push('lead')
        const lead = { id: 'lead-a', ...data }
        state.leads.push(lead)
        return lead
      }
    },
    pipelineLeadEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push('event')
        if (options.failEvent) throw new Error('event failed')
        state.events.push(data)
        return { id: 'event-a', ...data }
      }
    }
  }
  const run = async (command: CreatePipelineLeadCommand) => {
    const snapshot = structuredClone({ leads: state.leads, events: state.events, revision: state.revision })
    try {
      return await createPipelineLeadInTransaction(tx as never, command)
    } catch (error) {
      state.leads = snapshot.leads
      state.events = snapshot.events
      state.revision = snapshot.revision
      throw error
    }
  }
  return { state, operations, run, tx }
}

const baseCommand = {
  businessId: 'business-a',
  stageId: 'stage-a',
  title: 'Consulta desde Instagram',
  contactName: 'Ana',
  email: 'ANA@EXAMPLE.COM',
  assigneeUserId: 'assignee-a',
  customData: { objetivo: 'Reservar' },
  customDataSchemaVersion: 1
} satisfies Omit<CreatePipelineLeadCommand, 'actor'>

{
  const harness = createPipelineCommandHarness()
  const result = await harness.run({ ...baseCommand, actor: { kind: 'USER', userId: 'actor-a' } })
  assert.equal(result.lead.position, 4)
  assert.equal(result.revision, 8n)
  assert.equal(result.lead.normalizedEmail, 'ana@example.com')
  assert.deepEqual(result.lead.customData, { objetivo: 'Reservar' })
  assert.deepEqual(harness.state.events[0], {
    businessId: 'business-a', leadId: 'lead-a', actorKind: 'USER', actorUserId: 'actor-a',
    type: 'CREATED', fromStageId: null, toStageId: 'stage-a', fromLifecycle: null,
    toLifecycle: 'OPEN'
  })
  assert.deepEqual(harness.operations, ['revision', 'position', 'lead', 'event'])
}

{
  const harness = createPipelineCommandHarness()
  const service = new PipelineService({
    $transaction: async (callback: (tx: unknown) => unknown) => callback(harness.tx)
  } as never)
  const result = await service.createLead({
    businessId: 'business-a', actorUserId: 'actor-a', stageId: 'stage-a',
    title: 'Lead administrativo', phone: '+54 11 5555 1234'
  })
  assert.equal(result.lead.title, 'Lead administrativo')
  assert.equal(result.lead.normalizedPhone, '541155551234')
  assert.equal(harness.state.events[0]?.actorKind, 'USER')
  assert.equal(harness.state.events[0]?.actorUserId, 'actor-a')
}

{
  const harness = createPipelineCommandHarness()
  await harness.run({ ...baseCommand, actor: { kind: 'SYSTEM' }, assigneeUserId: undefined })
  assert.equal(harness.state.events[0]?.actorKind, 'SYSTEM')
  assert.equal(harness.state.events[0]?.actorUserId, null)
}

{
  const harness = createPipelineCommandHarness({ actorBusinessId: null, actorRole: 'SUPER_ADMIN' })
  await harness.run({ ...baseCommand, actor: { kind: 'USER', userId: 'actor-a' } })
  assert.equal(harness.state.events[0]?.actorUserId, 'actor-a')
}

for (const actor of [
  { kind: 'USER' } as never,
  { kind: 'SYSTEM', userId: 'actor-a' } as never
]) {
  const harness = createPipelineCommandHarness()
  await assert.rejects(() => harness.run({ ...baseCommand, actor }), (error) =>
    error instanceof PipelineDomainError && error.code === 'INVALID_PIPELINE_ACTOR')
  assert.equal(harness.state.leads.length, 0)
}

{
  const harness = createPipelineCommandHarness({ actorBusinessId: 'business-b' })
  await assert.rejects(
    () => harness.run({ ...baseCommand, actor: { kind: 'USER', userId: 'actor-a' } }),
    (error) => error instanceof PipelineDomainError && error.code === 'INVALID_PIPELINE_ACTOR'
  )
}

{
  const harness = createPipelineCommandHarness({ pipelineEnabled: false })
  await assert.rejects(
    () => harness.run({ ...baseCommand, actor: { kind: 'SYSTEM' } }),
    (error) => error instanceof PipelineDomainError && error.code === 'PIPELINE_DISABLED'
  )
}

{
  const harness = createPipelineCommandHarness({ stageBusinessId: 'business-b' })
  await assert.rejects(
    () => harness.run({ ...baseCommand, actor: { kind: 'SYSTEM' } }),
    (error) => error instanceof PipelineError && error.code === 'PIPELINE_RESOURCE_NOT_FOUND'
  )
}

{
  const harness = createPipelineCommandHarness({ failEvent: true })
  await assert.rejects(() => harness.run({ ...baseCommand, actor: { kind: 'SYSTEM' } }), /event failed/)
  assert.equal(harness.state.leads.length, 0)
  assert.equal(harness.state.events.length, 0)
  assert.equal(harness.state.revision, 7n)
}

console.log('pipeline-domain-contract-test: ok')
