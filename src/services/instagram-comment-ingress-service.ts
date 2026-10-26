import { matchInstagramKeywords } from './instagram-automation-domain.js'
import { parseInstagramWebhookPayload } from './instagram-webhook-parser.js'
import { resolveInstagramAutomationTarget } from './instagram-comment-automation-service.js'

export type InstagramCommentTarget = {
  businessId: string; publicationId: string | null; automationId: string; keywords: string[]
  receivedAccountId?: string; providerMediaId?: string
}
export type InstagramCommentExecutionInput = InstagramCommentTarget & {
  providerCommentId: string; commenterInstagramUserId: string; commenterUsername: string | null
  commentText: string; matchedKeyword: string; receivedAt: Date
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
      if ((comment.verb !== null && comment.verb !== 'add') || comment.parentCommentId !== null ||
        (comment.mediaProductType !== null && comment.mediaProductType !== 'REELS') ||
        comment.instagramAccountIds.includes(comment.commenterInstagramUserId)) continue
      const target = await this.store.resolveTarget({ instagramAccountIds: comment.instagramAccountIds, mediaId: comment.mediaId })
      if (!target) continue
      const match = matchInstagramKeywords(comment.text, target.keywords)
      if (!match.matched) continue
      const inserted = await this.store.createExecutionIfAbsent({ ...target,
        providerCommentId: comment.providerCommentId, commenterInstagramUserId: comment.commenterInstagramUserId,
        commenterUsername: comment.commenterUsername, commentText: comment.text, matchedKeyword: match.keyword,
        // Notification time is reception evidence, never private-reply eligibility.
        receivedAt: new Date() })
      if (inserted) created++
      else duplicates++
    }
    return { received: true, parsed: comments.length, created, duplicates }
  }
}

export class PrismaInstagramCommentIngressStore implements InstagramCommentIngressStore {
  constructor(private readonly client: Record<string, any>, private readonly businessIds?: readonly string[]) {}

  async resolveTarget(input: { instagramAccountIds: string[]; mediaId: string }): Promise<InstagramCommentTarget | null> {
    if (!input.instagramAccountIds.length) return null
    // The professional webhook account is not an app-scoped profile alias.
    const config = await this.client.businessInstagramConfig.findFirst({ where: {
      ...(this.businessIds ? { businessId: { in: this.businessIds } } : {}), enabled: true,
      accessToken: { not: null }, business: { accountStatus: 'ACTIVE' }, instagramAccountId: { in: input.instagramAccountIds }
    }, select: { businessId: true, instagramAccountId: true } })
    if (!config) return null
    return this.client.$transaction(async (tx: Record<string, any>) => {
      const media = await tx.instagramMedia.findFirst({ where: { businessId: config.businessId,
        accountId: config.instagramAccountId, providerMediaId: input.mediaId, mediaProductType: 'REELS' } })
      const publication = media ? null : await tx.instagramPublication.findFirst({ where: {
        businessId: config.businessId, metaMediaId: input.mediaId, status: 'PUBLISHED' } })
      if (!media && !publication) return null
      const resolved = await resolveInstagramAutomationTarget(tx, config.businessId, media ? { mediaId: media.id } : { publicationId: publication.id })
      const automation = resolved.automation
      if (resolved.accountId !== config.instagramAccountId || !automation?.enabled) return null
      return { businessId: config.businessId, publicationId: resolved.publicationId, automationId: automation.id,
        receivedAccountId: resolved.accountId, providerMediaId: input.mediaId,
        keywords: automation.keywords.map((k: { normalizedValue: string }) => k.normalizedValue) }
    })
  }

  async createExecutionIfAbsent(input: InstagramCommentExecutionInput) {
    try {
      return await this.client.$transaction(async (tx: Record<string, any>) => {
        await tx.$queryRaw`SELECT "businessId" FROM "BusinessInstagramConfig" WHERE "businessId"=${input.businessId} FOR UPDATE`
        const config = await tx.businessInstagramConfig.findFirst({ where: { businessId: input.businessId,
          instagramAccountId: input.receivedAccountId, enabled: true, accessToken: { not: null }, business: { accountStatus: 'ACTIVE' } } })
        const automation = await tx.instagramCommentAutomation.findFirst({ where: { id: input.automationId,
          businessId: input.businessId, enabled: true }, include: { keywords: true } })
        if (!config || !automation || !matchInstagramKeywords(input.commentText, automation.keywords.map((k: any) => k.normalizedValue)).matched) return false
        const { keywords: _, ...data } = input
        const actions = [
          ...(automation.privateReplyEnabled ? [{ kind: 'PRIVATE_REPLY', body: automation.privateReplyText }] : []),
          ...(automation.publicReplyEnabled ? [{ kind: 'PUBLIC_REPLY', body: automation.publicReplyText }] : [])
        ]
        if (!actions.length) return false
        await tx.instagramCommentExecution.create({ data: { ...data, status: 'READY', actions: { create: actions.map((action) => ({ ...action, businessId: input.businessId })) } } })
        return true
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return false
      throw error
    }
  }
}
