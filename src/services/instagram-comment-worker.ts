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
  executionId?: string
  kind?: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'
}

export type InstagramCommentDeliveryConfiguration = {
  privateReplyText: string
  publicReplyText?: string
  providerMediaId?: string | null
  accountId: string
  accessToken: string
  publicationId: string | null
  automationId: string
}

export type CompleteInstagramCommentInput = {
  execution: ClaimedInstagramComment
  publicationId: string | null
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
  markPreparationRetry(execution: ClaimedInstagramComment, error: string, availableAt: Date): Promise<boolean>
  markUnknown(execution: ClaimedInstagramComment, error: string): Promise<boolean>
  markFailed(execution: ClaimedInstagramComment, error: string): Promise<boolean>
  markSkipped(execution: ClaimedInstagramComment, reason: string): Promise<boolean>
  expireSendingLeases?(now: Date): Promise<number>
}

type PrivateReplyApi = {
  replyToComment?(input: { commentId: string; accessToken: string; text: string }): Promise<{ replyId: string }>
  getComment?(input: { commentId: string; accessToken: string }): Promise<{
    id?: string; timestamp?: string; parent_id?: string; from?: { id?: string }; media?: { id?: string }
  }>
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
      await this.store.markSkipped(execution, 'No se pudieron verificar el destino, la automatizacion o la cuenta recibida como activos.')
      return 'SKIPPED'
    }
    const isPublic = execution.kind === 'PUBLIC_REPLY'
    try {
      const metadata = await this.api.getComment?.({ commentId: execution.providerCommentId, accessToken: configuration.accessToken })
      const created = metadata?.timestamp && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(metadata.timestamp) ? Date.parse(metadata.timestamp) : NaN
      if (metadata?.parent_id || metadata?.id !== execution.providerCommentId || metadata?.from?.id !== execution.commenterInstagramUserId ||
        !configuration.providerMediaId || metadata?.media?.id !== configuration.providerMediaId) {
        await this.store.markSkipped(execution, 'No se pudo verificar la identidad y el origen del comentario.')
        return 'SKIPPED'
      }
      if (!isPublic && (!Number.isFinite(created) || created > now.getTime() || now.getTime() - created >= 7 * 24 * 60 * 60 * 1000)) {
        await this.store.markSkipped(execution, 'No se pudo acreditar la creacion dentro de los ultimos siete dias para responder por privado.')
        return 'SKIPPED'
      }
    } catch (error) {
      const transientRead = !(error instanceof InstagramApiRequestError) || error.transient || error.httpStatus === null || error.httpStatus === 429 || (error.httpStatus !== null && error.httpStatus >= 500)
      if (transientRead && execution.attempts < execution.maxAttempts) {
        await this.store.markPreparationRetry(execution, 'No se pudo leer el comentario. Se reintentara sin haber enviado una respuesta.',
          new Date(now.getTime() + retryDelay(execution.attempts)))
        return 'RETRY'
      }
      await this.store.markSkipped(execution, 'No se pudo verificar el comentario en Instagram.')
      return 'SKIPPED'
    }
    if (!await this.store.markSending(execution, now, this.leaseMs)) return 'UNKNOWN'

    let delivery: { messageId: string; recipientId: string | null }
    try {
      if (isPublic) {
        if (!this.api.replyToComment) throw new Error('Public adapter unavailable')
        const reply = await this.api.replyToComment({ commentId: execution.providerCommentId,
          accessToken: configuration.accessToken, text: configuration.publicReplyText! })
        delivery = { messageId: reply.replyId, recipientId: null }
      } else delivery = await this.api.sendPrivateReply({
        accountId: configuration.accountId,
        accessToken: configuration.accessToken,
        commentId: execution.providerCommentId,
        text: configuration.privateReplyText
      })
    } catch (error) {
      const message = 'No se pudo confirmar la respuesta de Instagram.'
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

    try {
      if (!delivery.messageId) throw new Error('Missing delivery identity')
      const completed = await this.store.completeSent({
        execution,
        publicationId: configuration.publicationId,
        automationId: configuration.automationId,
        body: isPublic ? configuration.publicReplyText! : configuration.privateReplyText,
        providerMessageId: delivery.messageId,
        recipientId: delivery.recipientId
      })
      // A lost fence means another process declared the in-flight attempt
      // ambiguous. Never send again or overwrite that terminal state.
      return completed ? 'SENT' : 'UNKNOWN'
    } catch {
      // A successful POST followed by failed persistence is never safely retryable.
      await this.store.markUnknown(execution, 'Envio aceptado sin confirmacion durable. No reenviar.').catch(() => false)
      return 'UNKNOWN'
    }
  }
}

type PrismaLike = {
  instagramCommentAction: {
    findFirst(input: unknown): Promise<any>
    findMany(input: unknown): Promise<any[]>
    updateMany(input: unknown): Promise<{ count: number }>
  }
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
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

export class PrismaInstagramCommentWorkerStore implements InstagramCommentWorkerStore {
  constructor(
    private readonly client: PrismaLike,
    private readonly businessIds?: readonly string[]
  ) {}

  async claim(now: Date, leaseMs: number): Promise<ClaimedInstagramComment | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidates = await this.client.instagramCommentAction.findMany({
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
          kind: true, executionId: true,
          execution: { select: { providerCommentId: true, commenterInstagramUserId: true, commenterUsername: true, commentText: true } }
        }
      })
      const candidate = candidates.find((row) => row.attempts < row.maxAttempts)
      if (!candidate) {
        for (const exhausted of candidates) {
          await this.client.instagramCommentAction.updateMany({
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
      const claimed = await this.client.instagramCommentAction.updateMany({
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
        executionId: candidate.executionId,
        kind: candidate.kind,
        providerCommentId: candidate.execution.providerCommentId,
        commenterInstagramUserId: candidate.execution.commenterInstagramUserId,
        commenterUsername: candidate.execution.commenterUsername,
        commentText: candidate.execution.commentText
      }
    }
    return null
  }

  async loadConfiguration(execution: ClaimedInstagramComment): Promise<InstagramCommentDeliveryConfiguration | null> {
    const action = await this.client.instagramCommentAction.findFirst({
      where: {
        id: execution.id, businessId: execution.businessId,
        claimToken: execution.claimToken, status: 'CLAIMED'
      },
      include: { execution: { include: { publication: true, automation: { include: { keywords: true, media: true } } } } }
    })
    const row = action?.execution
    const isPublic = execution.kind === 'PUBLIC_REPLY'
    if (!eligibleAction(action, execution)) return null
    const config = await this.client.businessInstagramConfig.findFirst({
      where: {
        businessId: execution.businessId,
        instagramAccountId: row.receivedAccountId,
        enabled: true,
        accessToken: { not: null },
        business: { accountStatus: 'ACTIVE' }
      },
      select: { instagramAccountId: true, apiAccountId: true, accessToken: true }
    })
    if (!config?.accessToken) return null
    let privateReplyText = isPublic ? '' : action.body
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
        executionId: execution.executionId!,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      })
      privateReplyText = privateReplyText.replace(placeholder[0], `https://${binding.hostname}/f/${placeholder[1]}?ref=${ref}`)
    }
    return {
      privateReplyText,
      publicReplyText: isPublic ? action.body : '',
      providerMediaId: row.providerMediaId ?? row.automation.media?.providerMediaId ?? row.publication?.metaMediaId ?? null,
      accountId: config.apiAccountId ?? config.instagramAccountId,
      accessToken: config.accessToken,
      publicationId: row.publicationId,
      automationId: row.automationId
    }
  }

  async markSending(execution: ClaimedInstagramComment, now: Date, leaseMs: number) {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw!`SELECT "businessId" FROM "BusinessInstagramConfig" WHERE "businessId"=${execution.businessId} FOR UPDATE`
      const action = await tx.instagramCommentAction.findFirst({ where: fence(execution, 'CLAIMED'),
        include: { execution: { include: { publication: true, automation: { include: { keywords: true, media: true } } } } } })
      if (!eligibleAction(action, execution)) return false
      const config = await tx.businessInstagramConfig.findFirst({ where: { businessId: execution.businessId,
        instagramAccountId: action.execution.receivedAccountId, enabled: true, accessToken: { not: null }, business: { accountStatus: 'ACTIVE' } } })
      if (!config) return false
      return (await tx.instagramCommentAction.updateMany({ where: { ...fence(execution, 'CLAIMED'), claimedUntil: { gt: now } },
        data: { status: 'SENDING', claimedUntil: new Date(now.getTime() + leaseMs) } })).count === 1
    })
  }

  async completeSent(input: CompleteInstagramCommentInput) {
    return this.client.$transaction(async (tx) => {
      const fenced = await tx.instagramCommentAction.updateMany({
        where: fence(input.execution, 'SENDING'),
        data: {
          status: 'SENT', providerMessageId: input.providerMessageId,
          recipientId: input.recipientId, sentAt: new Date(), claimedUntil: null, lastError: null
        }
      })
      if (fenced.count !== 1) return false
      if (input.execution.kind === 'PUBLIC_REPLY') return true
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
            ...(input.publicationId ? { publicationId: input.publicationId } : {}),
            executionId: input.execution.executionId,
            automationId: input.automationId,
            recipientId: input.recipientId
          }
        }
      })
      await tx.instagramCommentExecution.updateMany({
        where: { id: input.execution.executionId, businessId: input.execution.businessId },
        data: { leadId: lead.id, status: 'SENT', providerMessageId: input.providerMessageId, recipientId: input.recipientId, sentAt: new Date() }
      })
      return true
    })
  }

  async markRetry(execution: ClaimedInstagramComment, error: string, availableAt: Date) {
    return this.finish(execution, 'RETRY', { lastError: error, availableAt, claimToken: null, claimedUntil: null })
  }

  async markPreparationRetry(execution: ClaimedInstagramComment, error: string, availableAt: Date) {
    return (await this.client.instagramCommentAction.updateMany({ where: fence(execution, 'CLAIMED'),
      data: { status: 'RETRY', lastError: error, availableAt, claimToken: null, claimedUntil: null } })).count === 1
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
    return (await this.client.instagramCommentAction.updateMany({
      where: {
        ...(this.businessIds ? { businessId: { in: this.businessIds } } : {}),
        status: 'SENDING', claimedUntil: { lte: now }
      },
      data: { status: 'UNKNOWN', lastError: 'El lease venció durante un envío; el resultado es ambiguo.', claimedUntil: null }
    })).count
  }

  private async finish(execution: ClaimedInstagramComment, status: 'RETRY' | 'UNKNOWN' | 'FAILED' | 'SKIPPED', data: Record<string, unknown>) {
    const sourceStatus = status === 'SKIPPED' ? 'CLAIMED' : 'SENDING'
    return (await this.client.instagramCommentAction.updateMany({
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

function eligibleAction(action: any, execution: ClaimedInstagramComment) {
  const row = action?.execution
  if (!row?.receivedAccountId || !row.automation?.enabled ||
    (row.publication && row.publication.status !== 'PUBLISHED') ||
    (row.automation.accountId && row.automation.accountId !== row.receivedAccountId) || !action.body?.trim()) return false
  const isPublic = execution.kind === 'PUBLIC_REPLY'
  if (isPublic ? !row.automation.publicReplyEnabled : !row.automation.privateReplyEnabled) return false
  if (isPublic && /\{\{weex_form:|[?&]ref=/i.test(action.body)) return false
  return matchInstagramKeywords(execution.commentText, row.automation.keywords.map((item: { normalizedValue: string }) => item.normalizedValue)).matched
}

function isAmbiguousDelivery(error: unknown) {
  return !(error instanceof InstagramApiRequestError) || error.ambiguous
}

function isDefinedRetryableDelivery(error: unknown) {
  return error instanceof InstagramApiRequestError && !error.ambiguous &&
    (error.httpStatus === 429 || (error.httpStatus !== null && error.httpStatus >= 500))
}

function retryDelay(attempts: number) {
  return DEFAULT_RETRY_MS * Math.max(1, 2 ** Math.max(0, attempts - 1))
}
