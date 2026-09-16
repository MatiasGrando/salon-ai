import { createHmac } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import {
  LeadFormDomainError,
  createSubmissionFingerprint,
  normalizeLeadFormAnswers,
  parsePublishedLeadFormSchema
} from './lead-form-domain.js'
import { createPipelineLeadInTransaction } from './pipeline-lead-command.js'
import { PipelineError } from './pipeline-domain.js'
import { verifyInstagramFormRef } from './instagram-form-ref.js'

export class LeadFormSubmissionError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    public readonly issues?: readonly { field: string; reason: string }[]
  ) {
    super(code)
    this.name = 'LeadFormSubmissionError'
  }
}

export type PublicLeadFormSubmission = {
  businessId: string
  publicSlug: string
  idempotencyKey: string
  answers: unknown
  attribution?: unknown
  instagramRef?: unknown
  antiSpam: {
    honeypot?: unknown
    startedAt?: unknown
    ipAddress: string
  }
}

type Client = Pick<Prisma.TransactionClient, 'formSubmission' | 'rewardClaim'> & {
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options: {
    isolationLevel: 'Serializable'
  }): Promise<T>
}

type Options = {
  rateLimitSecret: string
  instagramFormRefSecret?: string
  rateLimitMax?: number
  rateLimitWindowMs?: number
  minimumCompletionMs?: number
  retryLimit?: number
  conservativeSharedPeer?: boolean
  conservativeIdentityMax?: number
  now?: () => Date
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const SAFE_SLUG = /^[a-z0-9-]{1,120}$/
const SERIALIZATION_ERRORS = new Set(['P2034', '40001', '40P01', 'P2002'])

function reject(code: string, statusCode: number): never {
  throw new LeadFormSubmissionError(code, statusCode)
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { code?: unknown }
  return typeof value.code === 'string' ? value.code : undefined
}

function normalizedAttribution(value: unknown) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_ATTRIBUTION', 422)
  const raw = value as Record<string, unknown>
  if (['source', 'campaign', 'instagramExecutionId', 'instagramPublicationId', 'instagramUserId'].some(key => key in raw)) {
    reject('INVALID_ATTRIBUTION', 422)
  }
  const permitted = ['utmSource', 'utmMedium', 'utmCampaign'] as const
  const result: Record<string, string> = {}
  for (const key of permitted) {
    const field = raw[key]
    if (field === undefined) continue
    if (typeof field !== 'string' || field.length > 120) reject('INVALID_ATTRIBUTION', 422)
    const cleaned = field.trim()
    if (cleaned) result[key] = cleaned
  }
  return result
}

export function createRateLimitScopeHash(secret: string, ipAddress: string) {
  if (!secret || !ipAddress) reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
  return createHmac('sha256', secret).update(ipAddress.trim(), 'utf8').digest('hex')
}

function verifyAntiSpam(input: PublicLeadFormSubmission['antiSpam'], now: Date, minimumCompletionMs: number) {
  if (input.honeypot !== undefined && input.honeypot !== '') reject('SPAM_REJECTED', 422)
  if (typeof input.startedAt !== 'string') reject('SPAM_REJECTED', 422)
  const started = new Date(input.startedAt)
  const elapsed = now.getTime() - started.getTime()
  if (!Number.isFinite(elapsed) || elapsed < minimumCompletionMs || elapsed > 24 * 60 * 60 * 1000) {
    reject('SPAM_REJECTED', 422)
  }
}

export class LeadFormSubmissionService {
  constructor(private readonly client: Client, private readonly options: Options) {}

  async submit(input: PublicLeadFormSubmission) {
    if (!this.options.rateLimitSecret) reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
    if (!SAFE_ID.test(input.businessId)) reject('FORM_NOT_AVAILABLE', 404)
    if (!SAFE_SLUG.test(input.publicSlug)) reject('FORM_NOT_AVAILABLE', 404)
    if (!SAFE_ID.test(input.idempotencyKey)) reject('INVALID_IDEMPOTENCY_KEY', 422)
    const now = this.options.now?.() ?? new Date()
    const max = this.options.rateLimitMax ?? 10
    const windowMs = this.options.rateLimitWindowMs ?? 60_000
    const minimumMs = this.options.minimumCompletionMs ?? 1500
    if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) {
      reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
    }
    verifyAntiSpam(input.antiSpam, now, minimumMs)
    const scopeHash = createRateLimitScopeHash(this.options.rateLimitSecret, input.antiSpam.ipAddress)
    const declaredAttribution = normalizedAttribution(input.attribution)
    const retryLimit = this.options.retryLimit ?? 3

    for (let attempt = 0; attempt < retryLimit; attempt++) {
      try {
        return await this.client.$transaction(async (tx) => {
          const settings = await tx.businessFeatureSettings.findUnique({
            where: { businessId: input.businessId },
            select: { leadCaptureFormsEnabled: true, pipelineEnabled: true }
          })
          if (!settings?.leadCaptureFormsEnabled || !settings.pipelineEnabled) reject('FORM_NOT_AVAILABLE', 404)
          const form = await tx.leadCaptureForm.findFirst({
            where: { businessId: input.businessId, publicSlug: input.publicSlug, status: 'PUBLISHED' },
            orderBy: { version: 'desc' }
          })
          if (!form || form.businessId !== input.businessId) reject('FORM_NOT_AVAILABLE', 404)
          if (form.rewardMode !== 'NONE' && form.rewardMode !== 'BENEFIT') {
            reject('FORM_NOT_AVAILABLE', 404)
          }
          if (this.options.conservativeSharedPeer && form.rewardMode !== 'NONE') reject('FORM_NOT_AVAILABLE', 404)

          const stage = await tx.pipelineStage.findFirst({
            where: {
              id: form.initialStageId,
              businessId: input.businessId,
              pipelineId: form.pipelineId,
              archivedAt: null
            },
            select: { id: true }
          })
          if (!stage) reject('FORM_NOT_AVAILABLE', 404)

          let normalized
          try {
            const schema = parsePublishedLeadFormSchema({ schemaVersion: form.schemaVersion, fields: form.fields })
            normalized = normalizeLeadFormAnswers(schema, input.answers)
          } catch (error) {
            if (error instanceof LeadFormDomainError) {
              throw new LeadFormSubmissionError(error.code, error.code === 'INVALID_FORM_ANSWERS' ? 422 : 503, error.issues)
            }
            throw error
          }
          const payloadFingerprint = createSubmissionFingerprint({
            formVersion: form.version,
            schemaVersion: form.schemaVersion,
            answers: input.answers,
            attribution: declaredAttribution,
            instagramRef: input.instagramRef ?? null
          })
          const prior = await tx.formSubmission.findUnique({
            where: {
              businessId_formId_idempotencyKey: {
                businessId: input.businessId,
                formId: form.id,
                idempotencyKey: input.idempotencyKey
              }
            }
          })
          if (prior) {
            if (prior.payloadFingerprint !== payloadFingerprint) reject('IDEMPOTENCY_CONFLICT', 409)
            if (prior.status !== 'ACCEPTED' || !prior.leadId) reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
            const lead = await tx.pipelineLead.findFirst({
              where: { id: prior.leadId, businessId: input.businessId }
            })
            if (!lead) reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
            if (prior.rewardMode !== 'NONE' && prior.rewardMode !== 'BENEFIT') {
              reject('FORM_NOT_AVAILABLE', 404)
            }
            const claim = prior.rewardMode === 'BENEFIT'
              ? await tx.rewardClaim.findFirst({
                where: { businessId: input.businessId, submissionId: prior.id }
              })
              : null
            if (prior.rewardMode === 'BENEFIT' && !claim) reject('FORM_NOT_AVAILABLE', 404)
            return {
              submission: prior,
              lead,
              claim,
              benefitAvailable: prior.rewardMode === 'BENEFIT',
              replayed: true
            }
          }

          let attribution: Record<string, string> | null = declaredAttribution
          if (input.instagramRef !== undefined) {
            const ref = verifyInstagramFormRef(
              this.options.instagramFormRefSecret ?? '', input.instagramRef as string,
              { businessId: input.businessId, formId: form.id }, now.getTime()
            )
            if (!ref) reject('INVALID_INSTAGRAM_REF', 422)
            const execution = await tx.instagramCommentExecution.findFirst({
              where: { id: ref.executionId, businessId: input.businessId },
              select: { id: true, matchedKeyword: true, publicationId: true, commenterInstagramUserId: true }
            })
            if (!execution) reject('INVALID_INSTAGRAM_REF', 422)
            attribution = {
              ...(declaredAttribution ?? {}),
              source: 'INSTAGRAM_COMMENT',
              campaign: execution.matchedKeyword,
              instagramExecutionId: execution.id,
              instagramPublicationId: execution.publicationId,
              instagramUserId: execution.commenterInstagramUserId
            }
          }

          const rewards = form.rewardMode === 'BENEFIT'
            ? await tx.formReward.findMany({
              where: { businessId: input.businessId, formId: form.id, enabled: true },
              orderBy: { version: 'desc' },
              take: 2
            })
            : []
          if (form.rewardMode === 'BENEFIT' && rewards.length !== 1) reject('FORM_NOT_AVAILABLE', 404)
          const reward = rewards[0] ?? null
          if (reward && (reward.businessId !== input.businessId || reward.formId !== form.id || reward.enabled !== true)) {
            reject('FORM_NOT_AVAILABLE', 404)
          }

          const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
          const incrementBucket = async (bucketScopeHash: string, bucketMax: number) => {
            const bucket = await tx.publicFormRateLimitBucket.upsert({
              where: { businessId_formId_scopeHash_windowStart: {
                businessId: input.businessId, formId: form.id, scopeHash: bucketScopeHash, windowStart
              } },
              create: {
                businessId: input.businessId, formId: form.id, scopeHash: bucketScopeHash, windowStart,
                count: 1, expiresAt: new Date(windowStart.getTime() + 2 * windowMs)
              },
              update: { count: { increment: 1 } }
            })
            if (bucket.count > bucketMax) reject('RATE_LIMITED', 429)
          }
          await incrementBucket(scopeHash, max)
          if (this.options.conservativeSharedPeer) {
            const identity = typeof normalized.leadFields.normalizedEmail === 'string'
              ? `email:${normalized.leadFields.normalizedEmail}`
              : typeof normalized.leadFields.normalizedPhone === 'string'
                ? `phone:${normalized.leadFields.normalizedPhone}` : null
            if (!identity) reject('INVALID_FORM_ANSWERS', 422)
            await incrementBucket(createRateLimitScopeHash(this.options.rateLimitSecret, `global:${input.businessId}:${form.id}`), max)
            await incrementBucket(createRateLimitScopeHash(this.options.rateLimitSecret, `identity:${identity}`), this.options.conservativeIdentityMax ?? 3)
          }

          const leadFields = normalized.leadFields
          const title = leadFields.title ?? form.name
          const submission = await tx.formSubmission.create({
            data: {
              businessId: input.businessId,
              formId: form.id,
              idempotencyKey: input.idempotencyKey,
              payloadFingerprint,
              status: 'PENDING',
              rewardMode: form.rewardMode,
              schemaVersion: form.schemaVersion,
              answers: normalized.answers as Prisma.InputJsonObject,
              attribution: attribution as Prisma.InputJsonObject | null,
              contactName: typeof leadFields.contactName === 'string' ? leadFields.contactName : null,
              normalizedEmail: typeof leadFields.normalizedEmail === 'string' ? leadFields.normalizedEmail : null,
              normalizedPhone: typeof leadFields.normalizedPhone === 'string' ? leadFields.normalizedPhone : null
            }
          })
          const created = await createPipelineLeadInTransaction(tx, {
            businessId: input.businessId,
            actor: { kind: 'SYSTEM' },
            stageId: form.initialStageId,
            title,
            contactName: leadFields.contactName,
            companyName: leadFields.companyName,
            email: leadFields.email,
            phone: leadFields.phone,
            estimatedValue: leadFields.estimatedValue,
            priority: leadFields.priority,
            source: attribution?.source === 'INSTAGRAM_COMMENT' ? 'INSTAGRAM_COMMENT' : 'FORM',
            externalReference: leadFields.externalReference,
            assigneeUserId: form.defaultAssigneeUserId,
            customData: normalized.customData,
            customDataSchemaVersion: form.schemaVersion,
            eventMetadata: {
              formId: form.id,
              submissionId: submission.id,
              formVersion: form.version
            }
          })
          const accepted = await tx.formSubmission.update({
            where: { businessId_id: { businessId: input.businessId, id: submission.id } },
            data: { status: 'ACCEPTED', leadId: created.lead.id, acceptedAt: now }
          })
          const claim = reward
            ? await tx.rewardClaim.create({
              data: {
                businessId: input.businessId,
                formId: form.id,
                submissionId: accepted.id,
                rewardId: reward.id,
                accessVersion: reward.version,
                expiresAt: reward.expiresInMinutes
                  ? new Date(now.getTime() + reward.expiresInMinutes * 60_000)
                  : null
              }
            })
            : null
          return {
            submission: accepted,
            lead: created.lead,
            claim,
            benefitAvailable: form.rewardMode === 'BENEFIT',
            replayed: false
          }
        }, { isolationLevel: 'Serializable' })
      } catch (error) {
        if (error instanceof LeadFormSubmissionError) throw error
        if (error instanceof PipelineError) {
          if (['PIPELINE_DISABLED', 'PIPELINE_RESOURCE_NOT_FOUND', 'INVALID_ASSIGNEE'].includes(error.code)) {
            reject('FORM_NOT_AVAILABLE', 404)
          }
          throw error
        }
        if (!SERIALIZATION_ERRORS.has(databaseCode(error) ?? '')) throw error
        if (attempt === retryLimit - 1) reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
      }
    }
    reject('SUBMISSION_SERVICE_UNAVAILABLE', 503)
  }
}
