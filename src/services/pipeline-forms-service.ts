import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { FORM_SCHEMA_VERSION, validateLeadFormSchema, type LeadFormField } from './lead-form-domain.js'
import { randomUUID } from 'node:crypto'
import { encryptRewardPayload, LeadRewardError } from './lead-reward-service.js'
import { leadFormPublicationReady } from './lead-form-edge-ip-policy.js'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ID = /^[a-zA-Z0-9_-]{1,128}$/
type FormStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED'
type RewardMode = 'NONE' | 'BENEFIT'

export class PipelineFormsError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 422, public readonly issues?: readonly { field: string; reason: string }[]) {
    super(code); this.name = 'PipelineFormsError'
  }
}

function invalid(code = 'INVALID_FORM'): never { throw new PipelineFormsError(code) }
function validId(value: unknown) { if (typeof value !== 'string' || !ID.test(value)) invalid(); return value }
function validText(value: unknown, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(); return value.trim() }
function optionalText(value: unknown, max: number) { if (value == null || value === '') return null; return validText(value, max) }
function rewardMode(value: unknown): RewardMode {
  if (value !== 'NONE' && value !== 'BENEFIT') invalid('INVALID_REWARD_MODE')
  return value
}
function schemaFields(value: unknown) {
  const result = validateLeadFormSchema({ schemaVersion: FORM_SCHEMA_VERSION, fields: value })
  if (!result.ok) throw new PipelineFormsError('INVALID_FORM_SCHEMA', 422, result.issues)
  return result.schema.fields as LeadFormField[]
}
function publicDto(form: any) {
  return { id: form.id, businessId: form.businessId, publicSlug: form.publicSlug, name: form.name,
    status: form.status as FormStatus, version: form.version, schemaVersion: form.schemaVersion,
    rewardMode: form.rewardMode as RewardMode,
    fields: form.fields, pipelineId: form.pipelineId, initialStageId: form.initialStageId,
    defaultAssigneeUserId: form.defaultAssigneeUserId, successTitle: form.successTitle,
    successMessage: form.successMessage, publicPath: `/f/${form.publicSlug}`,
    createdAt: form.createdAt, updatedAt: form.updatedAt }
}

export class PipelineFormsService {
  constructor(private readonly client: PrismaClient) {}

  async list(businessId: string) {
    validId(businessId)
    const forms = await this.client.leadCaptureForm.findMany({ where: { businessId }, orderBy: [{ publicSlug: 'asc' }, { version: 'desc' }] })
    return forms.map(publicDto)
  }

  private async validateDestination(tx: Prisma.TransactionClient, businessId: string, initialStageId: string, assigneeId: string | null) {
    const [flags, pipeline] = await Promise.all([
      tx.businessFeatureSettings.findUnique({ where: { businessId }, select: { pipelineEnabled: true } }),
      tx.pipeline.findUnique({ where: { businessId }, select: { id: true } })
    ])
    if (!flags?.pipelineEnabled || !pipeline) throw new PipelineFormsError('PIPELINE_RESOURCE_NOT_FOUND', 404)
    const stage = await tx.pipelineStage.findFirst({ where: { businessId, pipelineId: pipeline.id, id: initialStageId, archivedAt: null }, select: { id: true } })
    if (!stage) throw new PipelineFormsError('STAGE_NOT_AVAILABLE', 422)
    if (assigneeId) {
      const user = await tx.user.findFirst({ where: { businessId, id: assigneeId, isActive: true }, select: { id: true } })
      if (!user) throw new PipelineFormsError('ASSIGNEE_NOT_AVAILABLE', 422)
    }
    return pipeline.id
  }

  async create(input: Record<string, unknown> & { businessId: string }) {
    const businessId = validId(input.businessId)
    const slug = validText(input.publicSlug, 120)
    if (!SLUG.test(slug)) invalid('INVALID_FORM_SLUG')
    const name = validText(input.name, 160)
    const initialStageId = validId(input.initialStageId)
    const assigneeId = input.defaultAssigneeUserId ? validId(input.defaultAssigneeUserId) : null
    const fields = schemaFields(input.fields)
    const successTitle = optionalText(input.successTitle, 160)
    const successMessage = optionalText(input.successMessage, 1000)
    const selectedRewardMode = rewardMode(input.rewardMode)
    try {
      return await this.client.$transaction(async tx => {
        const pipelineId = await this.validateDestination(tx, businessId, initialStageId, assigneeId)
        const existing = await tx.leadCaptureForm.findFirst({ where: { businessId, publicSlug: slug }, select: { id: true } })
        if (existing) throw new PipelineFormsError('FORM_SLUG_ALREADY_EXISTS', 409)
        const form = await tx.leadCaptureForm.create({ data: { businessId, pipelineId, initialStageId, defaultAssigneeUserId: assigneeId, publicSlug: slug, name, status: 'DRAFT', rewardMode: selectedRewardMode, schemaVersion: FORM_SCHEMA_VERSION, version: 1, fields: fields as unknown as Prisma.InputJsonValue, successTitle, successMessage } })
        return publicDto(form)
      }, { isolationLevel: 'Serializable' })
    } catch (error) { if ((error as { code?: string }).code === 'P2002') throw new PipelineFormsError('FORM_SLUG_ALREADY_EXISTS', 409); throw error }
  }

  async update(input: Record<string, unknown> & { businessId: string; formId: string }) {
    const businessId = validId(input.businessId), formId = validId(input.formId)
    return this.client.$transaction(async tx => {
      const form = await tx.leadCaptureForm.findFirst({ where: { businessId, id: formId } })
      if (!form) throw new PipelineFormsError('FORM_NOT_FOUND', 404)
      if (form.status === 'DISABLED') throw new PipelineFormsError('FORM_DISABLED', 409)
      const selectedRewardMode = input.rewardMode === undefined ? rewardMode(form.rewardMode) : rewardMode(input.rewardMode)
      const stageId = input.initialStageId === undefined ? form.initialStageId : validId(input.initialStageId)
      const assigneeId = input.defaultAssigneeUserId === undefined ? form.defaultAssigneeUserId : input.defaultAssigneeUserId ? validId(input.defaultAssigneeUserId) : null
      const pipelineId = await this.validateDestination(tx, businessId, stageId, assigneeId)
      const name = input.name === undefined ? form.name : validText(input.name, 160)
      const fields = input.fields === undefined ? schemaFields(form.fields) : schemaFields(input.fields)
      const successTitle = input.successTitle === undefined ? form.successTitle : optionalText(input.successTitle, 160)
      const successMessage = input.successMessage === undefined ? form.successMessage : optionalText(input.successMessage, 1000)
      const data = { pipelineId, initialStageId: stageId, defaultAssigneeUserId: assigneeId, name, rewardMode: selectedRewardMode, fields: fields as unknown as Prisma.InputJsonValue, successTitle, successMessage }
      if (form.status === 'DRAFT') return publicDto(await tx.leadCaptureForm.update({ where: { businessId_id: { businessId, id: formId } }, data }))
      const latest = await tx.leadCaptureForm.findFirst({ where: { businessId, publicSlug: form.publicSlug }, orderBy: { version: 'desc' }, select: { version: true } })
      return publicDto(await tx.leadCaptureForm.create({ data: { ...data, businessId, publicSlug: form.publicSlug, status: 'DRAFT', schemaVersion: FORM_SCHEMA_VERSION, version: (latest?.version ?? form.version) + 1 } }))
    }, { isolationLevel: 'Serializable' })
  }

  async publish(input: { businessId: string; formId: string }) {
    const businessId = validId(input.businessId), formId = validId(input.formId)
    return this.client.$transaction(async tx => {
      const form = await tx.leadCaptureForm.findFirst({ where: { businessId, id: formId } })
      if (!form) throw new PipelineFormsError('FORM_NOT_FOUND', 404)
      if (form.status !== 'DRAFT') throw new PipelineFormsError('FORM_NOT_DRAFT', 409)
      const selectedRewardMode = rewardMode(form.rewardMode)
      const flags = await tx.businessFeatureSettings.findUnique({ where: { businessId }, select: { leadCaptureFormsEnabled: true } })
      if (!flags?.leadCaptureFormsEnabled) throw new PipelineFormsError('FORM_FEATURE_DISABLED', 409)
      if (!leadFormPublicationReady(process.env, selectedRewardMode === 'BENEFIT')) throw new PipelineFormsError('FORM_INGRESS_NOT_READY', 503)
      schemaFields(form.fields)
      await this.validateDestination(tx, businessId, form.initialStageId, form.defaultAssigneeUserId)
      if (selectedRewardMode === 'BENEFIT') {
        const rewards = await tx.formReward.findMany({
          where: { businessId, formId, enabled: true },
          select: { id: true, businessId: true, formId: true, enabled: true },
          orderBy: { version: 'desc' },
          take: 2
        })
        const reward = rewards[0]
        if (rewards.length !== 1 || !reward || reward.businessId !== businessId || reward.formId !== formId || reward.enabled !== true) {
          throw new PipelineFormsError('REWARD_REQUIRED', 422)
        }
      }
      await tx.leadCaptureForm.updateMany({ where: { businessId, publicSlug: form.publicSlug, status: 'PUBLISHED' }, data: { status: 'DISABLED' } })
      return publicDto(await tx.leadCaptureForm.update({ where: { businessId_id: { businessId, id: formId } }, data: { status: 'PUBLISHED' } }))
    }, { isolationLevel: 'Serializable' })
  }

  async configureReward(input: Record<string, unknown> & { businessId: string; formId: string }) {
    const businessId = validId(input.businessId), formId = validId(input.formId)
    const type = input.type
    if (type !== 'LINK' && type !== 'DISCOUNT' && type !== 'TEXT') invalid('INVALID_REWARD_TYPE')
    const name = validText(input.name ?? 'Beneficio', 160)
    const value = validText(input.value, 8192)
    const key = process.env.LEAD_REWARD_ENCRYPTION_KEY ?? ''
    return this.client.$transaction(async tx => {
      const form = await tx.leadCaptureForm.findFirst({ where: { businessId, id: formId }, select: { status: true } })
      if (!form) throw new PipelineFormsError('FORM_NOT_FOUND', 404)
      if (form.status !== 'DRAFT') throw new PipelineFormsError('FORM_NOT_DRAFT', 409)
      const latest = await tx.formReward.findFirst({ where: { businessId, formId }, orderBy: { version: 'desc' }, select: { version: true } })
      const version = (latest?.version ?? 0) + 1
      const rewardId = randomUUID()
      let payloadEncrypted: string
      try { payloadEncrypted = encryptRewardPayload(key, { businessId, formId, rewardId, accessVersion: version, type }, value) }
      catch (error) { if (error instanceof LeadRewardError) throw new PipelineFormsError(error.code, error.statusCode); throw error }
      await tx.formReward.updateMany({ where: { businessId, formId, enabled: true }, data: { enabled: false } })
      const reward = await tx.formReward.create({ data: { id: rewardId, businessId, formId, name, type, version, enabled: true, payloadEncrypted } })
      return { id: reward.id, businessId, formId, name: reward.name, type: reward.type, version: reward.version, enabled: reward.enabled }
    }, { isolationLevel: 'Serializable' })
  }

  async disable(input: { businessId: string; formId: string }) {
    const businessId = validId(input.businessId), formId = validId(input.formId)
    const updated = await this.client.leadCaptureForm.updateMany({ where: { businessId, id: formId, status: { in: ['DRAFT', 'PUBLISHED'] } }, data: { status: 'DISABLED' } })
    if (!updated.count) throw new PipelineFormsError('FORM_NOT_FOUND', 404)
    return { id: formId, businessId, status: 'DISABLED' as const }
  }
}
