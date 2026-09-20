import type { Prisma } from '../generated/prisma/client.js'
import {
  PipelineDomainError,
  normalizeEmail,
  normalizePhone,
  parseEstimatedValue,
  parseLeadPriority,
  parseLeadTitle,
  parseOptionalId,
  parseOptionalText,
  parseRequiredId
} from './pipeline-domain.js'

export type PipelineLeadActor =
  | { kind: 'USER'; userId: string }
  | { kind: 'SYSTEM' }

export type CreatePipelineLeadCommand = {
  businessId: string
  actor: PipelineLeadActor
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
  customerId?: unknown
  customData?: unknown
  customDataSchemaVersion?: unknown
  eventMetadata?: Prisma.InputJsonValue
}

function resourceNotFound(): never {
  throw new PipelineDomainError('PIPELINE_RESOURCE_NOT_FOUND', 404)
}

function parseActor(actor: PipelineLeadActor): PipelineLeadActor {
  if (!actor || typeof actor !== 'object') throw new PipelineDomainError('INVALID_PIPELINE_ACTOR')
  if (actor.kind === 'SYSTEM') {
    if (Object.hasOwn(actor, 'userId')) throw new PipelineDomainError('INVALID_PIPELINE_ACTOR')
    return { kind: 'SYSTEM' }
  }
  if (actor.kind === 'USER' && Object.hasOwn(actor, 'userId')) {
    return { kind: 'USER', userId: parseRequiredId(actor.userId, 'INVALID_PIPELINE_ACTOR') }
  }
  throw new PipelineDomainError('INVALID_PIPELINE_ACTOR')
}

function parseCustomData(value: unknown): Prisma.InputJsonObject {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PipelineDomainError('INVALID_PIPELINE_CUSTOM_DATA')
  }
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('not serializable')
    const parsed = JSON.parse(serialized) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Prisma.InputJsonObject
  } catch {
    throw new PipelineDomainError('INVALID_PIPELINE_CUSTOM_DATA')
  }
}

function parseCustomDataSchemaVersion(value: unknown) {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new PipelineDomainError('INVALID_PIPELINE_CUSTOM_DATA_SCHEMA_VERSION')
  }
  return value
}

async function assertActor(
  tx: Prisma.TransactionClient,
  businessId: string,
  actor: PipelineLeadActor
) {
  if (actor.kind === 'SYSTEM') return
  const user = await tx.user.findFirst({
    where: { id: actor.userId, isActive: true },
    select: { id: true, businessId: true, role: true }
  })
  const isBusinessActor = user?.businessId === businessId
  const isGlobalSuperAdmin = user?.role === 'SUPER_ADMIN' && user.businessId === null
  if (!user || (!isBusinessActor && !isGlobalSuperAdmin)) {
    throw new PipelineDomainError('INVALID_PIPELINE_ACTOR')
  }
}

async function assertAssignee(
  tx: Prisma.TransactionClient,
  businessId: string,
  assigneeUserId: string | null
) {
  if (!assigneeUserId) return
  const user = await tx.user.findFirst({
    where: { id: assigneeUserId, businessId },
    select: { id: true, businessId: true, isActive: true, role: true }
  })
  if (!user || !user.isActive || user.businessId !== businessId || user.role === 'SUPER_ADMIN') {
    throw new PipelineDomainError('INVALID_ASSIGNEE')
  }
}

async function assertCustomer(
  tx: Prisma.TransactionClient,
  businessId: string,
  customerId: string | null
) {
  if (!customerId) return
  const customer = await tx.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true }
  })
  if (!customer) resourceNotFound()
}

/**
 * Creates a lead using the transaction owned by the caller. This function never
 * opens or commits a transaction, so submissions can atomically create their
 * lead, audit event and reward claim in one database unit of work.
 */
export async function createPipelineLeadInTransaction(
  tx: Prisma.TransactionClient,
  command: CreatePipelineLeadCommand
) {
  const businessId = parseRequiredId(command.businessId, 'INVALID_BUSINESS_ID')
  const actor = parseActor(command.actor)
  const stageId = parseRequiredId(command.stageId)
  const title = parseLeadTitle(command.title)
  const contactName = parseOptionalText(command.contactName, 160, 'INVALID_CONTACT_NAME')
  const companyName = parseOptionalText(command.companyName, 160, 'INVALID_COMPANY_NAME')
  const email = normalizeEmail(command.email)
  const phone = normalizePhone(command.phone)
  const estimatedValue = command.estimatedValue === undefined ? 0 : parseEstimatedValue(command.estimatedValue)
  const priority = command.priority === undefined ? 'MEDIUM' : parseLeadPriority(command.priority)
  const source = parseOptionalText(command.source, 120, 'INVALID_LEAD_SOURCE')
  const externalReference = parseOptionalText(command.externalReference, 200, 'INVALID_EXTERNAL_REFERENCE')
  const assigneeUserId = parseOptionalId(command.assigneeUserId, 'INVALID_ASSIGNEE')
  const customerId = parseOptionalId(command.customerId, 'PIPELINE_RESOURCE_NOT_FOUND')
  const customData = parseCustomData(command.customData)
  const customDataSchemaVersion = parseCustomDataSchemaVersion(command.customDataSchemaVersion)

  const settings = await tx.businessFeatureSettings.findUnique({
    where: { businessId },
    select: { pipelineEnabled: true }
  })
  if (!settings?.pipelineEnabled) throw new PipelineDomainError('PIPELINE_DISABLED', 403)

  const pipeline = await tx.pipeline.findUnique({ where: { businessId } })
  if (!pipeline) resourceNotFound()

  const stage = await tx.pipelineStage.findFirst({
    where: { id: stageId, businessId, pipelineId: pipeline.id, archivedAt: null },
    select: { id: true }
  })
  if (!stage) resourceNotFound()

  await assertActor(tx, businessId, actor)
  await assertAssignee(tx, businessId, assigneeUserId)
  await assertCustomer(tx, businessId, customerId)

  // Updating the aggregate first locks the Pipeline row. All concurrent lead
  // insertions for this Pipeline therefore calculate their tail position in order.
  const revised = await tx.pipeline.update({
    where: { businessId_id: { businessId, id: pipeline.id } },
    data: { revision: { increment: 1 } },
    select: { revision: true }
  })
  const aggregate = await tx.pipelineLead.aggregate({
    where: { businessId, pipelineId: pipeline.id, stageId, lifecycle: 'OPEN', archivedAt: null },
    _max: { position: true }
  })
  const now = new Date()
  const lead = await tx.pipelineLead.create({
    data: {
      businessId,
      pipelineId: pipeline.id,
      stageId,
      lastOpenStageId: stageId,
      title,
      contactName,
      companyName,
      ...email,
      ...phone,
      estimatedValue,
      priority,
      source,
      externalReference,
      assigneeUserId,
      customerId,
      customData,
      customDataSchemaVersion,
      position: (aggregate._max.position ?? -1) + 1,
      lastActivityAt: now
    }
  })
  await tx.pipelineLeadEvent.create({
    data: {
      businessId,
      leadId: lead.id,
      actorKind: actor.kind,
      actorUserId: actor.kind === 'USER' ? actor.userId : null,
      type: 'CREATED',
      fromStageId: null,
      toStageId: stageId,
      fromLifecycle: null,
      toLifecycle: 'OPEN',
      ...(command.eventMetadata === undefined ? {} : { metadata: command.eventMetadata })
    }
  })
  return { lead, revision: revised.revision }
}
