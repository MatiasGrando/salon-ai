import { randomBytes, randomUUID } from 'node:crypto'
import { InstagramApiRequestError } from '../integrations/instagram-api.js'
import { matchInstagramKeywords } from './instagram-automation-domain.js'
import { createInstagramFormRef } from './instagram-form-ref.js'
import { findCustomSiteProfileBindingByCustomerCode } from './custom-site-profile-binding.js'

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_RETRY_MS = 60_000

export type ClaimedInstagramComment = {
  id: string
  businessId: string
  claimToken: string
  attempts: number
  maxAttempts: number
  providerCommentId: string
  commenterInstagramUserId: string
  commenterUsername: string | null
  commentText: string
}

export type InstagramCommentDeliveryConfiguration = {
  privateReplyText: string
  accountId: string
  accessToken: string
  publicationId: string
  automationId: string
}

export type CompleteInstagramCommentInput = {
  execution: ClaimedInstagramComment
  publicationId: string
  automationId: string
  body: string
  providerMessageId: string
  recipientId: string | null
}

export interface InstagramCommentWorkerStore {
  claim(now: Date, leaseMs: number): Promise<ClaimedInstagramComment | null>
  loadConfiguration(execution: ClaimedInstagramComment): Promise<InstagramCommentDeliveryConfiguration | null>
  markSending(execution: ClaimedInstagramComment, now: Date, leaseMs: number): Promise<boolean>
  completeSent(input: CompleteInstagramCommentInput): Promise<boolean>
  markRetry(execution: ClaimedInstagramComment, error: string, availableAt: Date): Promise<boolean>
  markUnknown(execution: ClaimedInstagramComment, error: string): Promise<boolean>
  markFailed(execution: ClaimedInstagramComment, error: string): Promise<boolean>
  markSkipped(execution: ClaimedInstagramComment, reason: string): Promise<boolean>
  expireSendingLeases?(now: Date): Promise<number>
}

type PrivateReplyApi = {
  sendPrivateReply(input: { accountId: string; accessToken: string; commentId: string; text: string }): Promise<{
    messageId: string
    recipientId: string | null
  }>
}

export type InstagramCommentWorkerOutcome = 'IDLE' | 'SENT' | 'RETRY' | 'UNKNOWN' | 'FAILED' | 'SKIPPED'

export class InstagramCommentWorker {
  constructor(
    private readonly store: InstagramCommentWorkerStore,
    private readonly api: PrivateReplyApi,
    private readonly leaseMs = DEFAULT_LEASE_MS
  ) {}

  async processOne(now = new Date()): Promise<InstagramCommentWorkerOutcome> {
    await this.store.expireSendingLeases?.(now)
    const execution = await this.store.claim(now, this.leaseMs)
    if (!execution) return 'IDLE'

    const configuration = await this.store.loadConfiguration(execution)
    if (!configuration) {
      await this.store.markSkipped(execution, 'La publicación, automatización o conexión ya no está activa.')
      return 'SKIPPED'
    }
    if (!await this.store.markSending(execution, now, this.leaseMs)) return 'UNKNOWN'

    let delivery: { messageId: string; recipientId: string | null }
    try {
      delivery = await this.api.sendPrivateReply({
        accountId: configuration.accountId,
        accessToken: configuration.accessToken,
        commentId: execution.providerCommentId,
        text: configuration.privateReplyText
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fallo desconocido al responder el comentario.'
      if (isAmbiguousDelivery(error)) {
        await this.store.markUnknown(execution, message)
        return 'UNKNOWN'
      }
      if (isDefinedRetryableDelivery(error) && execution.attempts < execution.maxAttempts) {
        await this.store.markRetry(execution, message, new Date(now.getTime() + retryDelay(execution.attempts)))
        return 'RETRY'
      }
      await this.store.markFailed(execution, message)
      return 'FAILED'
    }

    const completed = await this.store.completeSent({
      execution,
      publicationId: configuration.publicationId,
      automationId: configuration.automationId,
      body: configuration.privateReplyText,
      providerMessageId: delivery.messageId,
      recipientId: delivery.recipientId
    })
    // A lost fence means another process declared the in-flight attempt
    // ambiguous. Never send again or overwrite that terminal state.
    return completed ? 'SENT' : 'UNKNOWN'
  }
}

type PrismaLike = {
  instagramCommentExecution: {
    findFirst(input: unknown): Promise<any>
    findMany(input: unknown): Promise<any[]>
    updateMany(input: unknown): Promise<{ count: number }>
  }
  businessInstagramConfig: { findFirst(input: unknown): Promise<any> }
  leadCaptureForm?: { findFirst(input: unknown): Promise<any> }
  businessFeatureSettings?: { findUnique(input: unknown): Promise<any> }
  instagramLead: { upsert(input: unknown): Promise<any> }
  instagramMessage: { create(input: unknown): Promise<unknown> }
  $transaction<T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T>
}

export class PrismaInstagramCommentWorkerStore implements InstagramCommentWorkerStore {
  constructor(
    private readonly client: PrismaLike,
    private readonly businessIds?: readonly string[]
  ) {}

  async claim(now: Date, leaseMs: number): Promise<ClaimedInstagramComment | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidates = await this.client.instagramCommentExecution.findMany({
        where: {
          ...(this.businessIds ? { businessId: { in: this.businessIds } } : {}),
          availableAt: { lte: now },
          OR: [
            { status: { in: ['READY', 'RETRY'] } },
            { status: 'CLAIMED', claimedUntil: { lte: now } }
          ]
        },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        take: 20,
        select: {
          id: true, businessId: true, status: true, claimToken: true, attempts: true, maxAttempts: true,
          providerCommentId: true, commenterInstagramUserId: true, commenterUsername: true, commentText: true
        }
      })
      const candidate = candidates.find((row) => row.attempts < row.maxAttempts)
      if (!candidate) {
        for (const exhausted of candidates) {
          await this.client.instagramCommentExecution.updateMany({
            where: {
              id: exhausted.id,
              businessId: exhausted.businessId,
              status: exhausted.status,
              claimToken: exhausted.claimToken,
              attempts: exhausted.attempts
            },
            data: {
              status: 'FAILED',
              claimedUntil: null,
              lastError: 'Se agotaron los intentos de respuesta privada.'
            }
          })
        }
        continue
      }
      const claimToken = randomUUID()
      const claimedUntil = new Date(now.getTime() + leaseMs)
      const claimed = await this.client.instagramCommentExecution.updateMany({
        where: {
          id: candidate.id,
          businessId: candidate.businessId,
          status: candidate.status,
          claimToken: candidate.claimToken,
          attempts: candidate.attempts,
          availableAt: { lte: now }
        },
        data: {
          status: 'CLAIMED', claimToken, claimedUntil,
          attempts: { increment: 1 }, lastError: null
        }
      })
      if (claimed.count === 1) return {
        id: candidate.id,
        businessId: candidate.businessId,
        claimToken,
        attempts: candidate.attempts + 1,
        maxAttempts: candidate.maxAttempts,
        providerCommentId: candidate.providerCommentId,
        commenterInstagramUserId: candidate.commenterInstagramUserId,
        commenterUsername: candidate.commenterUsername,
        commentText: candidate.commentText
      }
    }
    return null
  }

  async loadConfiguration(execution: ClaimedInstagramComment): Promise<InstagramCommentDeliveryConfiguration | null> {
    const row = await this.client.instagramCommentExecution.findFirst({
      where: {
        id: execution.id, businessId: execution.businessId,
        claimToken: execution.claimToken, status: 'CLAIMED'
      },
      select: {
        publicationId: true,
        automationId: true,
        publication: { select: { status: true } },
        automation: {
          select: {
            enabled: true, privateReplyText: true,
            keywords: { select: { normalizedValue: true } }
          }
        }
      }
    })
    if (!row || row.publication.status !== 'PUBLISHED' || !row.automation.enabled || !row.automation.privateReplyText.trim()) return null
    if (!matchInstagramKeywords(execution.commentText, row.automation.keywords.map((item: { normalizedValue: string }) => item.normalizedValue)).matched) return null
    const config = await this.client.businessInstagramConfig.findFirst({
      where: {
        businessId: execution.businessId,
        enabled: true,
        accessToken: { not: null },
        business: { accountStatus: 'ACTIVE' }
      },
      select: { instagramAccountId: true, apiAccountId: true, accessToken: true }
    })
    if (!config?.accessToken) return null
    let privateReplyText = row.automation.privateReplyText
    const placeholder = /\{\{weex_form:([a-z0-9-]{1,120})\}\}/.exec(privateReplyText)
    if (privateReplyText.includes('{{weex_form:') && (!placeholder || privateReplyText.indexOf('{{weex_form:', placeholder.index + placeholder[0].length) !== -1)) return null
    if (placeholder) {
      const secret = process.env.INSTAGRAM_FORM_REF_SECRET ?? ''
      if (secret.length < 32 || !this.client.leadCaptureForm || !this.client.businessFeatureSettings) return null
      const settings = await this.client.businessFeatureSettings.findUnique({
        where: { businessId: execution.businessId },
        select: { pipelineEnabled: true, leadCaptureFormsEnabled: true }
      })
      if (!settings?.pipelineEnabled || !settings?.leadCaptureFormsEnabled) return null
      const form = await this.client.leadCaptureForm.findFirst({
        where: { businessId: execution.businessId, publicSlug: placeholder[1], status: 'PUBLISHED' },
        select: { id: true, business: { select: { customerCode: true } } },
        orderBy: { version: 'desc' }
      })
      const binding = form ? findCustomSiteProfileBindingByCustomerCode(form.business.customerCode) : null
      if (!form || !binding) return null
      const ref = createInstagramFormRef(secret, {
        businessId: execution.businessId,
        formId: form.id,
        executionId: execution.id,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      })
      privateReplyText = privateReplyText.replace(placeholder[0], `https://${binding.hostname}/f/${placeholder[1]}?ref=${ref}`)
    }
    return {
      privateReplyText,
      accountId: config.apiAccountId ?? config.instagramAccountId,
      accessToken: config.accessToken,
      publicationId: row.publicationId,
      automationId: row.automationId
    }
  }

  async markSending(execution: ClaimedInstagramComment, now: Date, leaseMs: number) {
    return (await this.client.instagramCommentExecution.updateMany({
      where: fence(execution, 'CLAIMED'),
      data: { status: 'SENDING', claimedUntil: new Date(now.getTime() + leaseMs) }
    })).count === 1
  }

  async completeSent(input: CompleteInstagramCommentInput) {
    return this.client.$transaction(async (tx) => {
      const fenced = await tx.instagramCommentExecution.updateMany({
        where: fence(input.execution, 'SENDING'),
        data: {
          status: 'SENT', providerMessageId: input.providerMessageId,
          recipientId: input.recipientId, sentAt: new Date(), claimedUntil: null, lastError: null
        }
      })
      if (fenced.count !== 1) return false
      const lead = await tx.instagramLead.upsert({
        where: {
          businessId_instagramUserId: {
            businessId: input.execution.businessId,
            instagramUserId: input.execution.commenterInstagramUserId
          }
        },
        update: {
          username: input.execution.commenterUsername,
          lastMessage: input.execution.commentText,
          lastAutoReplyAt: new Date()
        },
        create: {
          businessId: input.execution.businessId,
          instagramUserId: input.execution.commenterInstagramUserId,
          username: input.execution.commenterUsername,
          referralCode: `IG-${randomBytes(4).toString('hex').toUpperCase()}`,
          lastMessage: input.execution.commentText,
          lastAutoReplyAt: new Date()
        }
      })
      await tx.instagramMessage.create({
        data: {
          leadId: lead.id,
          providerMessageId: input.providerMessageId,
          direction: 'OUTBOUND',
          body: input.body,
          status: 'sent',
          metadata: {
            provider: 'instagram',
            origin: 'REEL_COMMENT_AUTOMATION',
            providerCommentId: input.execution.providerCommentId,
            publicationId: input.publicationId,
            automationId: input.automationId,
            recipientId: input.recipientId
          }
        }
      })
      await tx.instagramCommentExecution.updateMany({
        where: { id: input.execution.id, businessId: input.execution.businessId, claimToken: input.execution.claimToken, status: 'SENT' },
        data: { leadId: lead.id }
      })
      return true
    })
  }

  async markRetry(execution: ClaimedInstagramComment, error: string, availableAt: Date) {
    return this.finish(execution, 'RETRY', { lastError: error, availableAt, claimToken: null, claimedUntil: null })
  }

  async markUnknown(execution: ClaimedInstagramComment, error: string) {
    return this.finish(execution, 'UNKNOWN', { lastError: error, claimedUntil: null })
  }

  async markFailed(execution: ClaimedInstagramComment, error: string) {
    return this.finish(execution, 'FAILED', { lastError: error, claimedUntil: null })
  }

  async markSkipped(execution: ClaimedInstagramComment, reason: string) {
    return this.finish(execution, 'SKIPPED', { lastError: reason, claimedUntil: null })
  }

  async expireSendingLeases(now: Date) {
    return (await this.client.instagramCommentExecution.updateMany({
      where: {
        ...(this.businessIds ? { businessId: { in: this.businessIds } } : {}),
        status: 'SENDING', claimedUntil: { lte: now }
      },
      data: { status: 'UNKNOWN', lastError: 'El lease venció durante un envío; el resultado es ambiguo.', claimedUntil: null }
    })).count
  }

  private async finish(execution: ClaimedInstagramComment, status: 'RETRY' | 'UNKNOWN' | 'FAILED' | 'SKIPPED', data: Record<string, unknown>) {
    const sourceStatus = status === 'SKIPPED' ? 'CLAIMED' : 'SENDING'
    return (await this.client.instagramCommentExecution.updateMany({
      where: fence(execution, sourceStatus),
      data: { status, ...data }
    })).count === 1
  }
}

function fence(execution: ClaimedInstagramComment, status: string) {
  return {
    id: execution.id,
    businessId: execution.businessId,
    claimToken: execution.claimToken,
    status
  }
}

function isAmbiguousDelivery(error: unknown) {
  return error instanceof InstagramApiRequestError && error.ambiguous
}

function isDefinedRetryableDelivery(error: unknown) {
  return error instanceof InstagramApiRequestError && !error.ambiguous &&
    (error.httpStatus === 429 || (error.httpStatus !== null && error.httpStatus >= 500))
}

function retryDelay(attempts: number) {
  return DEFAULT_RETRY_MS * Math.max(1, 2 ** Math.max(0, attempts - 1))
}
