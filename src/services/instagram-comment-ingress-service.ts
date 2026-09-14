import { matchInstagramKeywords } from './instagram-automation-domain.js'
import { parseInstagramWebhookPayload } from './instagram-webhook-parser.js'

export type InstagramCommentTarget = {
  businessId: string
  publicationId: string
  automationId: string
  keywords: string[]
}

export type InstagramCommentExecutionInput = {
  businessId: string
  publicationId: string
  automationId: string
  providerCommentId: string
  commenterInstagramUserId: string
  commenterUsername: string | null
  commentText: string
  matchedKeyword: string
  receivedAt: Date
}

export interface InstagramCommentIngressStore {
  resolveTarget(input: { instagramAccountIds: string[]; mediaId: string }): Promise<InstagramCommentTarget | null>
  createExecutionIfAbsent(input: InstagramCommentExecutionInput): Promise<boolean>
}

export class InstagramCommentIngressService {
  constructor(private readonly store: InstagramCommentIngressStore) {}

  async ingest(payload: unknown) {
    const comments = parseInstagramWebhookPayload(payload).comments
    let created = 0
    let duplicates = 0
    for (const comment of comments) {
      // The documented Instagram `comments` change represents a newly added
      // comment and currently omits `verb`; reject only explicit non-add values.
      if ((comment.verb !== null && comment.verb !== 'add') ||
        comment.parentCommentId !== null ||
        comment.mediaProductType !== 'REELS' ||
        comment.instagramAccountIds.includes(comment.commenterInstagramUserId)) continue
      const target = await this.store.resolveTarget({
        instagramAccountIds: comment.instagramAccountIds,
        mediaId: comment.mediaId
      })
      if (!target) continue
      const match = matchInstagramKeywords(comment.text, target.keywords)
      if (!match.matched) continue
      const inserted = await this.store.createExecutionIfAbsent({
        businessId: target.businessId,
        publicationId: target.publicationId,
        automationId: target.automationId,
        providerCommentId: comment.providerCommentId,
        commenterInstagramUserId: comment.commenterInstagramUserId,
        commenterUsername: comment.commenterUsername,
        commentText: comment.text,
        matchedKeyword: match.keyword,
        receivedAt: webhookDate(comment.timestamp)
      })
      if (inserted) created += 1
      else duplicates += 1
    }
    return { received: true, parsed: comments.length, created, duplicates }
  }
}

type PrismaLike = {
  businessInstagramConfig: { findFirst(input: unknown): Promise<any> }
  instagramPublication: { findFirst(input: unknown): Promise<any> }
  instagramCommentExecution: { create(input: unknown): Promise<unknown> }
}

export class PrismaInstagramCommentIngressStore implements InstagramCommentIngressStore {
  constructor(
    private readonly client: PrismaLike,
    private readonly businessIds?: readonly string[]
  ) {}

  async resolveTarget(input: { instagramAccountIds: string[]; mediaId: string }): Promise<InstagramCommentTarget | null> {
    if (!input.instagramAccountIds.length) return null
    const config = await this.client.businessInstagramConfig.findFirst({
      where: {
        ...(this.businessIds ? { businessId: { in: this.businessIds } } : {}),
        enabled: true,
        accessToken: { not: null },
        business: { accountStatus: 'ACTIVE' },
        OR: [
          { instagramAccountId: { in: input.instagramAccountIds } },
          { apiAccountId: { in: input.instagramAccountIds } }
        ]
      },
      select: { businessId: true }
    })
    if (!config) return null
    const publication = await this.client.instagramPublication.findFirst({
      where: {
        businessId: config.businessId,
        metaMediaId: input.mediaId,
        status: 'PUBLISHED',
        automation: { enabled: true }
      },
      select: {
        id: true,
        automation: {
          select: {
            id: true,
            keywords: { select: { normalizedValue: true } }
          }
        }
      }
    })
    if (!publication?.automation) return null
    return {
      businessId: config.businessId,
      publicationId: publication.id,
      automationId: publication.automation.id,
      keywords: publication.automation.keywords.map((keyword: { normalizedValue: string }) => keyword.normalizedValue)
    }
  }

  async createExecutionIfAbsent(input: InstagramCommentExecutionInput): Promise<boolean> {
    try {
      await this.client.instagramCommentExecution.create({
        data: {
          ...input,
          status: 'READY',
          availableAt: new Date()
        }
      })
      return true
    } catch (error) {
      if (isUniqueConstraint(error)) return false
      throw error
    }
  }
}

function webhookDate(timestamp: number | undefined) {
  if (timestamp === undefined) return new Date()
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}
