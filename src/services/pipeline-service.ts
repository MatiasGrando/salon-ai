import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import {
  PipelineError,
  PipelineDomainError,
  assertAssignableUser,
  assertCanArchiveStage,
  assertLifecycleTransition,
  normalizeEmail,
  normalizePhone,
  parseActivityBody,
  parseActivityKind,
  parseEstimatedValue,
  parseExpectedRevision,
  parseHexColor,
  parseLeadLifecycle,
  parseLeadPriority,
  parseLeadTitle,
  parseOptionalId,
  parseOptionalText,
  parsePipelineName,
  parseRequiredId,
  parseStageName,
  parseIsoInstant,
  parseTaskCategory,
  parseTaskStatus,
  parseTaskTitle,
  parseUniqueIdList,
  resolveReopenStage,
  type PipelineLeadLifecycle,
  type PipelineTaskStatus
} from './pipeline-domain.js'
import { createPipelineLeadInTransaction } from './pipeline-lead-command.js'

type PipelineClient = PrismaClient | Prisma.TransactionClient

type PipelineFormAnswer = Readonly<{ key: string; label: string; value: string }>

const INTERNAL_CUSTOM_DATA_KEYS = new Set([
  'businessid', 'pipelineid', 'formid', 'submissionid', 'leadid', 'schemaversion',
  'normalizedemail', 'normalizedphone', 'externalreference', 'idempotencykey',
  'payloadfingerprint', 'password', 'token', 'apitoken', 'authorization', 'cookie', 'secret'
])

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function displayAnswerValue(value: unknown, field?: Readonly<Record<string, unknown>>): string | null {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string' || !value.trim()) return null
  const options = Array.isArray(field?.options) ? field.options : []
  const option = options.map(jsonRecord).find((item) => item?.value === value)
  return typeof option?.label === 'string' && option.label.trim() ? option.label.trim() : value.trim()
}

function customDataLabel(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : key
}

function isSafeCustomDataKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) &&
    !key.startsWith('_') &&
    !INTERNAL_CUSTOM_DATA_KEYS.has(normalized) &&
    !/(?:password|secret|token|authorization|cookie|fingerprint|idempotency)/i.test(key)
}

export function toPipelineLeadFormAnswers(input: {
  customData: unknown
  formSubmissions?: ReadonlyArray<{
    answers: unknown
    form?: { fields: unknown } | null
  }>
}): PipelineFormAnswer[] {
  const latest = input.formSubmissions?.[0]
  const answers = jsonRecord(latest?.answers)
  const fields = Array.isArray(latest?.form?.fields)
    ? latest.form.fields.map(jsonRecord).filter((field): field is Readonly<Record<string, unknown>> => field !== null)
    : []

  const schemaAnswers = fields
    .filter((field) => typeof field.key === 'string' && typeof field.label === 'string')
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .flatMap((field): PipelineFormAnswer[] => {
      const key = field.key as string
      if (!Object.prototype.hasOwnProperty.call(answers ?? {}, key)) return []
      const value = displayAnswerValue(answers?.[key], field)
      if (value === null) return []
      return [{ key, label: (field.label as string).trim() || customDataLabel(key), value }]
    })
  if (schemaAnswers.length > 0) return schemaAnswers

  const customData = jsonRecord(input.customData) ?? {}
  return Object.entries(customData).flatMap(([key, rawValue]): PipelineFormAnswer[] => {
    if (!isSafeCustomDataKey(key)) return []
    const value = displayAnswerValue(rawValue)
    return value === null ? [] : [{ key, label: customDataLabel(key), value }]
  })
}

export class PipelineServiceError extends PipelineError {
  constructor(code: string, statusCode = 422, details?: Readonly<Record<string, unknown>>) {
    super(code, statusCode, details)
    this.name = 'PipelineServiceError'
  }
}

function notFound(): never {
  throw new PipelineServiceError('PIPELINE_RESOURCE_NOT_FOUND', 404)
}

async function requirePipeline(client: PipelineClient, businessId: string) {
  const pipeline = await client.pipeline.findUnique({ where: { businessId } })
  return pipeline ?? notFound()
}

async function requireStage(client: PipelineClient, businessId: string, pipelineId: string, stageId: string) {
  const stage = await client.pipelineStage.findFirst({
    where: { id: stageId, businessId, pipelineId, archivedAt: null }
  })
  return stage ?? notFound()
}

async function requireLead(client: PipelineClient, businessId: string, pipelineId: string, leadId: string) {
  const lead = await client.pipelineLead.findFirst({
    where: { id: leadId, businessId, pipelineId, archivedAt: null }
  })
  return lead ?? notFound()
}

async function requireTask(client: PipelineClient, businessId: string, pipelineId: string, taskId: string) {
  const task = await client.pipelineTask.findFirst({
    where: { id: taskId, businessId, pipelineId, archivedAt: null }
  })
  return task ?? notFound()
}

function isSerializationConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate.code === 'P2034' ||
    (typeof candidate.message === 'string' && /(?:serialization|write conflict|deadlock)/i.test(candidate.message))
}

async function throwRevisionConflict(prisma: PrismaClient, businessId: string): Promise<never> {
  const current = await prisma.pipeline.findUnique({ where: { businessId }, select: { revision: true } })
  throw new PipelineServiceError('PIPELINE_REVISION_CONFLICT', 409, {
    currentRevision: current?.revision ?? null
  })
}

async function claimRevision(
  client: PipelineClient,
  input: { businessId: string; pipelineId: string; expectedRevision: bigint }
) {
  const claimed = await client.pipeline.updateMany({
    where: { businessId: input.businessId, id: input.pipelineId, revision: input.expectedRevision },
    data: { revision: { increment: 1 } }
  })
  if (claimed.count !== 1) {
    const current = await requirePipeline(client, input.businessId)
    throw new PipelineServiceError('PIPELINE_REVISION_CONFLICT', 409, { currentRevision: current.revision })
  }
}

async function reindexTasks(
  client: PipelineClient,
  input: { businessId: string; pipelineId: string; status: PipelineTaskStatus }
) {
  const tasks = await client.pipelineTask.findMany({
    where: { ...input, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true }
  })
  await client.pipelineTask.updateMany({ where: { ...input, archivedAt: null }, data: { position: null } })
  for (const [position, task] of tasks.entries()) {
    await client.pipelineTask.update({
      where: { businessId_id: { businessId: input.businessId, id: task.id } },
      data: { position }
    })
  }
}

async function reindexOpenLeads(
  client: PipelineClient,
  input: { businessId: string; pipelineId: string; stageId: string }
) {
  const leads = await client.pipelineLead.findMany({
    where: {
      businessId: input.businessId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      lifecycle: 'OPEN',
      archivedAt: null
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true }
  })
  for (const [position, lead] of leads.entries()) {
    await client.pipelineLead.updateMany({
      where: { businessId: input.businessId, id: lead.id }, data: { position }
    })
  }
}

async function requireAssignee(client: PipelineClient, businessId: string, assigneeUserId: string | null) {
  if (!assigneeUserId) return null
  const user = await client.user.findFirst({ where: { id: assigneeUserId, businessId } })
  return assertAssignableUser(user, businessId)
}

async function appendLeadEvent(
  client: PipelineClient,
  input: {
    businessId: string
    leadId: string
    actorUserId: string
    type: 'CREATED' | 'UPDATED' | 'MOVED' | 'ASSIGNED' | 'RESOLVED' | 'REOPENED' | 'ACTIVITY_RECORDED' | 'ARCHIVED'
    fromStageId?: string | null
    toStageId?: string | null
    fromLifecycle?: PipelineLeadLifecycle | null
    toLifecycle?: PipelineLeadLifecycle | null
    metadata?: Prisma.InputJsonValue
  }
) {
  return client.pipelineLeadEvent.create({
    data: {
      businessId: input.businessId,
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      type: input.type,
      fromStageId: input.fromStageId ?? null,
      toStageId: input.toStageId ?? null,
      fromLifecycle: input.fromLifecycle ?? null,
      toLifecycle: input.toLifecycle ?? null,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    }
  })
}

async function bumpRevision(client: PipelineClient, businessId: string, pipelineId: string) {
  return client.pipeline.update({
    where: { businessId_id: { businessId, id: pipelineId } },
    data: { revision: { increment: 1 } }
  })
}

export class PipelineService {
  constructor(private readonly prisma: PrismaClient) {}

  getPipeline(businessId: string) {
    return this.prisma.pipeline.findUnique({
      where: { businessId: parseRequiredId(businessId, 'INVALID_BUSINESS_ID') },
      include: { stages: { where: { archivedAt: null }, orderBy: { position: 'asc' } } }
    })
  }

  async renamePipeline(input: { businessId: string; name: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const name = parsePipelineName(input.name)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      return transaction.pipeline.update({
        where: { businessId_id: { businessId, id: pipeline.id } },
        data: { name, revision: { increment: 1 } }
      })
    })
  }

  async createStage(input: { businessId: string; name: unknown; color: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const name = parseStageName(input.name)
    const color = parseHexColor(input.color)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const aggregate = await transaction.pipelineStage.aggregate({
        where: { businessId, pipelineId: pipeline.id, archivedAt: null },
        _max: { position: true }
      })
      const stage = await transaction.pipelineStage.create({
        data: { businessId, pipelineId: pipeline.id, name, color, position: (aggregate._max.position ?? -1) + 1 }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { stage, revision: revised.revision }
    })
  }

  async updateStage(input: { businessId: string; stageId: string; name: unknown; color: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const stageId = parseRequiredId(input.stageId)
    const name = parseStageName(input.name)
    const color = parseHexColor(input.color)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      await requireStage(transaction, businessId, pipeline.id, stageId)
      const stage = await transaction.pipelineStage.update({
        where: { businessId_id: { businessId, id: stageId } },
        data: { name, color }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { stage, revision: revised.revision }
    })
  }

  async reorderStages(input: { businessId: string; stageIds: unknown; expectedRevision: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const stageIds = parseUniqueIdList(input.stageIds)
    const expectedRevision = parseExpectedRevision(input.expectedRevision)
    try {
      return await this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const activeStages = await transaction.pipelineStage.findMany({
        where: { businessId, pipelineId: pipeline.id, archivedAt: null },
        select: { id: true }
      })
      const activeIds = new Set(activeStages.map((stage) => stage.id))
      if (activeIds.size !== stageIds.length || stageIds.some((id) => !activeIds.has(id))) {
        throw new PipelineServiceError('INVALID_STAGE_ORDER')
      }
      await claimRevision(transaction, { businessId, pipelineId: pipeline.id, expectedRevision })
      await transaction.pipelineStage.updateMany({
        where: { businessId, pipelineId: pipeline.id, archivedAt: null },
        data: { position: null }
      })
      for (const [position, id] of stageIds.entries()) {
        const changed = await transaction.pipelineStage.updateMany({
          where: { businessId, pipelineId: pipeline.id, id, archivedAt: null },
          data: { position }
        })
        if (changed.count !== 1) throw new PipelineServiceError('INVALID_STAGE_ORDER')
      }
      const stages = await transaction.pipelineStage.findMany({
        where: { businessId, pipelineId: pipeline.id, archivedAt: null },
        orderBy: { position: 'asc' }
      })
      return { stages, revision: expectedRevision + 1n }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (isSerializationConflict(error)) return throwRevisionConflict(this.prisma, businessId)
      throw error
    }
  }

  async archiveStage(input: { businessId: string; stageId: string }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const stageId = parseRequiredId(input.stageId)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      await requireStage(transaction, businessId, pipeline.id, stageId)
      const [activeStageCount, openLeadCount] = await Promise.all([
        transaction.pipelineStage.count({ where: { businessId, pipelineId: pipeline.id, archivedAt: null } }),
        transaction.pipelineLead.count({ where: { businessId, pipelineId: pipeline.id, stageId, lifecycle: 'OPEN', archivedAt: null } })
      ])
      assertCanArchiveStage({ activeStageCount, openLeadCount })
      const archivedAt = new Date()
      await transaction.pipelineStage.updateMany({
        where: { id: stageId, businessId, pipelineId: pipeline.id, archivedAt: null },
        data: { archivedAt, position: null }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { archivedAt, revision: revised.revision }
    })
  }

  async listLeads(input: {
    businessId: string
    search?: unknown
    lifecycle?: unknown
    stageId?: unknown
    assigneeUserId?: unknown
    priority?: unknown
    cursor?: unknown
    limit?: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const search = parseOptionalText(input.search, 200, 'INVALID_LEAD_SEARCH')
    const lifecycle = input.lifecycle === undefined || input.lifecycle === '' ? null : parseLeadLifecycle(input.lifecycle)
    const stageId = parseOptionalId(input.stageId)
    const assigneeUserId = parseOptionalId(input.assigneeUserId)
    const priority = input.priority === undefined || input.priority === '' ? null : parseLeadPriority(input.priority)
    const cursor = parseOptionalId(input.cursor, 'INVALID_CURSOR')
    const limit = parsePageLimit(input.limit)
    const pipeline = await requirePipeline(this.prisma, businessId)
    const where: Prisma.PipelineLeadWhereInput = {
      businessId,
      pipelineId: pipeline.id,
      archivedAt: null,
      ...(lifecycle ? { lifecycle } : {}),
      ...(stageId ? { stageId } : {}),
      ...(assigneeUserId ? { assigneeUserId } : {}),
      ...(priority ? { priority } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } }
        ]
      } : {})
    }
    const [items, count, totals, groups] = await Promise.all([
      this.prisma.pipelineLead.findMany({
        where,
        include: {
          stage: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, isActive: true } }
        },
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      }),
      this.prisma.pipelineLead.count({ where }),
      this.prisma.pipelineLead.aggregate({ where, _sum: { estimatedValue: true } }),
      this.prisma.pipelineLead.groupBy({
        by: ['lifecycle', 'stageId'],
        where,
        _count: { _all: true },
        _sum: { estimatedValue: true }
      })
    ])
    return {
      items,
      nextCursor: items.length === limit ? items.at(-1)?.id ?? null : null,
      metrics: { count, estimatedValue: totals._sum.estimatedValue ?? 0, groups },
      revision: pipeline.revision
    }
  }

  async getLead(input: { businessId: string; leadId: string }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const leadId = parseRequiredId(input.leadId)
    const pipeline = await requirePipeline(this.prisma, businessId)
    const lead = await this.prisma.pipelineLead.findFirst({
      where: { id: leadId, businessId, pipelineId: pipeline.id, archivedAt: null },
      include: {
        stage: { select: { id: true, name: true, color: true } },
        assignee: { select: { id: true, name: true, isActive: true } },
        activities: {
          where: { archivedAt: null },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }]
        },
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        formSubmissions: {
          where: { status: 'ACCEPTED' },
          orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            answers: true,
            form: { select: { fields: true } }
          }
        }
      }
    })
    if (!lead) return notFound()
    const { formSubmissions, customData, ...leadDetail } = lead
    return {
      ...leadDetail,
      formAnswers: toPipelineLeadFormAnswers({ customData, formSubmissions })
    }
  }

  async updateLead(input: {
    businessId: string
    actorUserId: string
    leadId: string
    changes: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)) {
      throw new PipelineDomainError('INVALID_LEAD_UPDATE', 400)
    }
    const changes = input.changes as Record<string, unknown>
    const data: Prisma.PipelineLeadUncheckedUpdateInput = {}
    const fields: string[] = []
    const set = (field: string, value: unknown) => {
      ;(data as unknown as Record<string, unknown>)[field] = value
      fields.push(field)
    }
    if (Object.hasOwn(changes, 'title')) set('title', parseLeadTitle(changes.title))
    if (Object.hasOwn(changes, 'contactName')) set('contactName', parseOptionalText(changes.contactName, 160, 'INVALID_CONTACT_NAME'))
    if (Object.hasOwn(changes, 'companyName')) set('companyName', parseOptionalText(changes.companyName, 160, 'INVALID_COMPANY_NAME'))
    if (Object.hasOwn(changes, 'email')) {
      const email = normalizeEmail(changes.email)
      set('email', email.email)
      set('normalizedEmail', email.normalizedEmail)
    }
    if (Object.hasOwn(changes, 'phone')) {
      const phone = normalizePhone(changes.phone)
      set('phone', phone.phone)
      set('normalizedPhone', phone.normalizedPhone)
    }
    if (Object.hasOwn(changes, 'estimatedValue')) set('estimatedValue', parseEstimatedValue(changes.estimatedValue))
    if (Object.hasOwn(changes, 'priority')) set('priority', parseLeadPriority(changes.priority))
    if (Object.hasOwn(changes, 'source')) set('source', parseOptionalText(changes.source, 120, 'INVALID_LEAD_SOURCE'))
    if (Object.hasOwn(changes, 'externalReference')) {
      set('externalReference', parseOptionalText(changes.externalReference, 200, 'INVALID_EXTERNAL_REFERENCE'))
    }
    if (fields.length === 0) throw new PipelineDomainError('EMPTY_LEAD_UPDATE', 400)

    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const lead = await requireLead(transaction, businessId, pipeline.id, leadId)
      const now = new Date()
      data.lastActivityAt = now
      const updated = await transaction.pipelineLead.update({
        where: { businessId_id: { businessId, id: lead.id } },
        data
      })
      await appendLeadEvent(transaction, {
        businessId,
        leadId,
        actorUserId,
        type: 'UPDATED',
        metadata: { fields: [...new Set(fields)] }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { lead: updated, revision: revised.revision }
    })
  }

  async createLead(input: {
    businessId: string
    actorUserId: string
    stageId: string
    title: unknown
    contactName?: unknown
    companyName?: unknown
    email?: unknown
    phone?: unknown
    estimatedValue?: unknown
    priority?: unknown
    source?: unknown
    externalReference?: unknown
    assigneeUserId?: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    return this.prisma.$transaction((transaction) =>
      createPipelineLeadInTransaction(transaction, {
        businessId,
        actor: { kind: 'USER', userId: actorUserId },
        stageId: input.stageId,
        title: input.title,
        contactName: input.contactName,
        companyName: input.companyName,
        email: input.email,
        phone: input.phone,
        estimatedValue: input.estimatedValue,
        priority: input.priority,
        source: input.source,
        externalReference: input.externalReference,
        assigneeUserId: input.assigneeUserId
      })
    )
  }

  async assignLead(input: { businessId: string; actorUserId: string; leadId: string; assigneeUserId: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    const assigneeUserId = parseOptionalId(input.assigneeUserId, 'INVALID_ASSIGNEE')
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const lead = await requireLead(transaction, businessId, pipeline.id, leadId)
      await requireAssignee(transaction, businessId, assigneeUserId)
      const now = new Date()
      const updated = await transaction.pipelineLead.update({
        where: { businessId_id: { businessId, id: lead.id } },
        data: { assigneeUserId, lastActivityAt: now }
      })
      await appendLeadEvent(transaction, {
        businessId, leadId, actorUserId, type: 'ASSIGNED',
        metadata: { fromAssigneeUserId: lead.assigneeUserId, toAssigneeUserId: assigneeUserId }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { lead: updated, revision: revised.revision }
    })
  }

  async moveLead(input: {
    businessId: string
    actorUserId: string
    leadId: string
    stageId: string
    expectedRevision: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    const stageId = parseRequiredId(input.stageId)
    const expectedRevision = parseExpectedRevision(input.expectedRevision)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const pipeline = await requirePipeline(transaction, businessId)
        const lead = await requireLead(transaction, businessId, pipeline.id, leadId)
        if (lead.lifecycle !== 'OPEN') throw new PipelineServiceError('LEAD_NOT_OPEN', 409)
        if (lead.stageId === stageId) throw new PipelineServiceError('LEAD_STAGE_UNCHANGED', 409)
        await requireStage(transaction, businessId, pipeline.id, stageId)
        await claimRevision(transaction, { businessId, pipelineId: pipeline.id, expectedRevision })
        const aggregate = await transaction.pipelineLead.aggregate({
          where: { businessId, pipelineId: pipeline.id, stageId, lifecycle: 'OPEN', archivedAt: null },
          _max: { position: true }
        })
        const moved = await transaction.pipelineLead.update({
          where: { businessId_id: { businessId, id: lead.id } },
          data: { stageId, lastOpenStageId: stageId, position: (aggregate._max.position ?? -1) + 1, lastActivityAt: new Date() }
        })
        if (lead.stageId) await reindexOpenLeads(transaction, { businessId, pipelineId: pipeline.id, stageId: lead.stageId })
        await appendLeadEvent(transaction, {
          businessId, leadId, actorUserId, type: 'MOVED',
          fromStageId: lead.stageId, toStageId: stageId, fromLifecycle: 'OPEN', toLifecycle: 'OPEN'
        })
        return { lead: moved, revision: expectedRevision + 1n }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (isSerializationConflict(error)) return throwRevisionConflict(this.prisma, businessId)
      throw error
    }
  }

  async changeLifecycle(input: {
    businessId: string
    actorUserId: string
    leadId: string
    lifecycle: unknown
    expectedRevision: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    const lifecycle = parseLeadLifecycle(input.lifecycle)
    const expectedRevision = parseExpectedRevision(input.expectedRevision)
    try {
      return await this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const lead = await requireLead(transaction, businessId, pipeline.id, leadId)
      assertLifecycleTransition(lead.lifecycle, lifecycle)
      await claimRevision(transaction, { businessId, pipelineId: pipeline.id, expectedRevision })
      const now = new Date()
      let stageId: string | null = null
      let position: number | null = null
      if (lifecycle === 'OPEN') {
        const stages = await transaction.pipelineStage.findMany({
          where: { businessId, pipelineId: pipeline.id, archivedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true }
        })
        stageId = resolveReopenStage({ lastOpenStageId: lead.lastOpenStageId, activeStageIds: stages.map((stage) => stage.id) })
        const aggregate = await transaction.pipelineLead.aggregate({
          where: { businessId, pipelineId: pipeline.id, stageId, lifecycle: 'OPEN', archivedAt: null },
          _max: { position: true }
        })
        position = (aggregate._max.position ?? -1) + 1
      }
      const updated = await transaction.pipelineLead.update({
        where: { businessId_id: { businessId, id: lead.id } },
        data: {
          lifecycle,
          stageId,
          position,
          lastOpenStageId: lifecycle === 'OPEN' ? stageId : lead.stageId,
          resolvedAt: lifecycle === 'OPEN' ? null : now,
          lastActivityAt: now
        }
      })
      if (lead.lifecycle === 'OPEN' && lead.stageId) {
        await reindexOpenLeads(transaction, { businessId, pipelineId: pipeline.id, stageId: lead.stageId })
      }
      await appendLeadEvent(transaction, {
        businessId, leadId, actorUserId,
        type: lifecycle === 'OPEN' ? 'REOPENED' : 'RESOLVED',
        fromStageId: lead.stageId, toStageId: stageId,
        fromLifecycle: lead.lifecycle, toLifecycle: lifecycle
      })
      return { lead: updated, revision: expectedRevision + 1n }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (isSerializationConflict(error)) return throwRevisionConflict(this.prisma, businessId)
      throw error
    }
  }

  async addActivity(input: { businessId: string; actorUserId: string; leadId: string; kind: unknown; body: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    const kind = parseActivityKind(input.kind)
    const body = parseActivityBody(input.body)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      await requireLead(transaction, businessId, pipeline.id, leadId)
      const occurredAt = new Date()
      const activity = await transaction.pipelineLeadActivity.create({
        data: { businessId, leadId, authorUserId: actorUserId, kind, body, occurredAt }
      })
      await transaction.pipelineLead.updateMany({ where: { id: leadId, businessId }, data: { lastActivityAt: occurredAt } })
      await appendLeadEvent(transaction, {
        businessId, leadId, actorUserId, type: 'ACTIVITY_RECORDED', metadata: { activityId: activity.id, kind }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { activity, revision: revised.revision }
    })
  }

  async listResponsibles(input: { businessId: string }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    await requirePipeline(this.prisma, businessId)
    return this.prisma.user.findMany({
      where: { businessId, isActive: true, role: { not: 'SUPER_ADMIN' } },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }]
    })
  }

  async listTasks(input: { businessId: string; status?: unknown }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const status = input.status === undefined || input.status === '' ? null : parseTaskStatus(input.status)
    const pipeline = await requirePipeline(this.prisma, businessId)
    const [business, items] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
      this.prisma.pipelineTask.findMany({
        where: { businessId, pipelineId: pipeline.id, archivedAt: null, ...(status ? { status } : {}) },
        include: {
          assignee: { select: { id: true, name: true, isActive: true } },
          lead: { select: { id: true, title: true, lifecycle: true, archivedAt: true } }
        },
        orderBy: [{ status: 'asc' }, { position: 'asc' }, { id: 'asc' }]
      })
    ])
    return { items, revision: pipeline.revision, timezone: business?.timezone ?? 'America/Argentina/Buenos_Aires' }
  }

  async createTask(input: {
    businessId: string
    title: unknown
    category?: unknown
    notes?: unknown
    dueAt?: unknown
    status?: unknown
    assigneeUserId?: unknown
    leadId?: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const title = parseTaskTitle(input.title)
    const category = input.category === undefined ? 'BUSINESS' : parseTaskCategory(input.category)
    const notes = parseOptionalText(input.notes, 4000, 'INVALID_TASK_NOTES')
    const dueAt = input.dueAt === undefined || input.dueAt === null || input.dueAt === '' ? null : parseIsoInstant(input.dueAt)
    const status = input.status === undefined ? 'TODO' : parseTaskStatus(input.status)
    const assigneeUserId = parseOptionalId(input.assigneeUserId, 'INVALID_ASSIGNEE')
    const leadId = parseOptionalId(input.leadId, 'INVALID_LEAD_ID')
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      await requireAssignee(transaction, businessId, assigneeUserId)
      if (leadId) await requireLead(transaction, businessId, pipeline.id, leadId)
      const aggregate = await transaction.pipelineTask.aggregate({
        where: { businessId, pipelineId: pipeline.id, status, archivedAt: null },
        _max: { position: true }
      })
      const task = await transaction.pipelineTask.create({
        data: {
          businessId, pipelineId: pipeline.id, title, category, notes, dueAt, status,
          assigneeUserId, leadId, position: (aggregate._max.position ?? -1) + 1
        }
      })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { task, revision: revised.revision }
    })
  }

  async updateTask(input: {
    businessId: string
    taskId: string
    changes: unknown
    expectedRevision?: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const taskId = parseRequiredId(input.taskId)
    if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)) {
      throw new PipelineDomainError('INVALID_TASK_UPDATE', 400)
    }
    const changes = input.changes as Record<string, unknown>
    const data: Prisma.PipelineTaskUncheckedUpdateInput = {}
    if (Object.hasOwn(changes, 'title')) data.title = parseTaskTitle(changes.title)
    if (Object.hasOwn(changes, 'category')) data.category = parseTaskCategory(changes.category)
    if (Object.hasOwn(changes, 'notes')) data.notes = parseOptionalText(changes.notes, 4000, 'INVALID_TASK_NOTES')
    if (Object.hasOwn(changes, 'dueAt')) {
      data.dueAt = changes.dueAt === null || changes.dueAt === '' ? null : parseIsoInstant(changes.dueAt)
    }
    const assigneeWasProvided = Object.hasOwn(changes, 'assigneeUserId')
    const assigneeUserId = assigneeWasProvided ? parseOptionalId(changes.assigneeUserId, 'INVALID_ASSIGNEE') : undefined
    const leadWasProvided = Object.hasOwn(changes, 'leadId')
    const leadId = leadWasProvided ? parseOptionalId(changes.leadId, 'INVALID_LEAD_ID') : undefined
    const statusWasProvided = Object.hasOwn(changes, 'status')
    const status = statusWasProvided ? parseTaskStatus(changes.status) : undefined
    if (assigneeWasProvided) data.assigneeUserId = assigneeUserId
    if (leadWasProvided) data.leadId = leadId
    if (statusWasProvided) data.status = status
    if (Object.keys(data).length === 0) throw new PipelineDomainError('EMPTY_TASK_UPDATE', 400)
    const expectedRevision = statusWasProvided ? parseExpectedRevision(input.expectedRevision) : null

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const pipeline = await requirePipeline(transaction, businessId)
        const task = await requireTask(transaction, businessId, pipeline.id, taskId)
        if (assigneeWasProvided) await requireAssignee(transaction, businessId, assigneeUserId ?? null)
        if (leadId) await requireLead(transaction, businessId, pipeline.id, leadId)
        if (status) {
          await claimRevision(transaction, { businessId, pipelineId: pipeline.id, expectedRevision: expectedRevision! })
        }
        if (status && status !== task.status) {
          const aggregate = await transaction.pipelineTask.aggregate({
            where: { businessId, pipelineId: pipeline.id, status, archivedAt: null },
            _max: { position: true }
          })
          data.position = (aggregate._max.position ?? -1) + 1
        }
        const updated = await transaction.pipelineTask.update({
          where: { businessId_id: { businessId, id: taskId } }, data
        })
        if (status) {
          if (status !== task.status) {
            await reindexTasks(transaction, { businessId, pipelineId: pipeline.id, status: task.status })
          }
          return { task: updated, revision: expectedRevision! + 1n }
        }
        const revised = await bumpRevision(transaction, businessId, pipeline.id)
        return { task: updated, revision: revised.revision }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (isSerializationConflict(error)) return throwRevisionConflict(this.prisma, businessId)
      throw error
    }
  }

  async archiveTask(input: { businessId: string; taskId: string }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const taskId = parseRequiredId(input.taskId)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      const task = await requireTask(transaction, businessId, pipeline.id, taskId)
      const archivedAt = new Date()
      await transaction.pipelineTask.update({
        where: { businessId_id: { businessId, id: taskId } },
        data: { archivedAt, position: null }
      })
      await reindexTasks(transaction, { businessId, pipelineId: pipeline.id, status: task.status })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { archivedAt, revision: revised.revision }
    }, { isolationLevel: 'Serializable' })
  }

  async reorderTasks(input: {
    businessId: string
    status: unknown
    taskIds: unknown
    expectedRevision: unknown
  }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const status = parseTaskStatus(input.status)
    const taskIds = parseUniqueIdList(input.taskIds)
    const expectedRevision = parseExpectedRevision(input.expectedRevision)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const pipeline = await requirePipeline(transaction, businessId)
        const activeTasks = await transaction.pipelineTask.findMany({
          where: { businessId, pipelineId: pipeline.id, status, archivedAt: null }, select: { id: true }
        })
        const activeIds = new Set(activeTasks.map((task) => task.id))
        if (activeIds.size !== taskIds.length || taskIds.some((id) => !activeIds.has(id))) {
          throw new PipelineServiceError('INVALID_TASK_ORDER')
        }
        await claimRevision(transaction, { businessId, pipelineId: pipeline.id, expectedRevision })
        await transaction.pipelineTask.updateMany({
          where: { businessId, pipelineId: pipeline.id, status, archivedAt: null }, data: { position: null }
        })
        for (const [position, id] of taskIds.entries()) {
          const changed = await transaction.pipelineTask.updateMany({
            where: { id, businessId, pipelineId: pipeline.id, status, archivedAt: null }, data: { position }
          })
          if (changed.count !== 1) throw new PipelineServiceError('INVALID_TASK_ORDER')
        }
        const tasks = await transaction.pipelineTask.findMany({
          where: { businessId, pipelineId: pipeline.id, status, archivedAt: null }, orderBy: { position: 'asc' }
        })
        return { tasks, revision: expectedRevision + 1n }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (isSerializationConflict(error)) return throwRevisionConflict(this.prisma, businessId)
      throw error
    }
  }

  async archiveLead(input: { businessId: string; actorUserId: string; leadId: string }) {
    const businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID')
    const actorUserId = parseRequiredId(input.actorUserId, 'INVALID_ACTOR_ID')
    const leadId = parseRequiredId(input.leadId)
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await requirePipeline(transaction, businessId)
      await requireLead(transaction, businessId, pipeline.id, leadId)
      const archivedAt = new Date()
      await transaction.pipelineLead.updateMany({
        where: { id: leadId, businessId, pipelineId: pipeline.id, archivedAt: null },
        data: { archivedAt, position: null }
      })
      await appendLeadEvent(transaction, { businessId, leadId, actorUserId, type: 'ARCHIVED' })
      const revised = await bumpRevision(transaction, businessId, pipeline.id)
      return { archivedAt, revision: revised.revision }
    })
  }
}

function parsePageLimit(value: unknown) {
  if (value === undefined || value === null || value === '') return 50
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new PipelineDomainError('INVALID_PAGE_LIMIT', 400)
  }
  return parsed
}

export function asPipelineServiceError(error: unknown) {
  if (error instanceof PipelineError || error instanceof PipelineDomainError) return error
  return new PipelineServiceError('PIPELINE_OPERATION_FAILED', 500)
}
