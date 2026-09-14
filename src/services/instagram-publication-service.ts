import { prisma } from '../config/prisma.js'
import {
  validateInstagramReelDraft,
  type InstagramPublicationStatus,
  type ValidatedInstagramKeyword
} from './instagram-automation-domain.js'

export type InstagramPublicationAutomation = {
  enabled: boolean
  privateReplyText: string
  keywords: ValidatedInstagramKeyword[]
}

export type InstagramPublicationRecord = {
  id: string
  businessId: string
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
  caption: string
  shareToFeed: boolean
  status: InstagramPublicationStatus
  metaContainerId: string | null
  metaMediaId: string | null
  lastError: string | null
  automation: InstagramPublicationAutomation
}

export type CreateInstagramPublicationDraft = {
  businessId: string
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
  caption: string
  shareToFeed: boolean
  automation: { enabled: boolean; privateReplyText: string; keywords: readonly string[] }
}

export type UpdateInstagramPublicationDraft = Partial<Pick<
  CreateInstagramPublicationDraft,
  'videoObjectPath' | 'videoMimeType' | 'videoSizeBytes' | 'caption' | 'shareToFeed'
>> & { automation?: Partial<CreateInstagramPublicationDraft['automation']> }

export interface InstagramPublicationRepository {
  createDraft(input: Omit<CreateInstagramPublicationDraft, 'automation'> & { automation: InstagramPublicationAutomation }): Promise<InstagramPublicationRecord>
  listByBusiness(businessId: string): Promise<InstagramPublicationRecord[]>
  findByBusinessAndId(businessId: string, id: string): Promise<InstagramPublicationRecord | null>
  updateDraft(input: {
    businessId: string
    id: string
    patch: UpdateInstagramPublicationDraft
    automation?: InstagramPublicationAutomation
  }): Promise<InstagramPublicationRecord | null>
  enqueue(input: { businessId: string; id: string; availableAt: Date }): Promise<InstagramPublicationRecord | null>
}

export class InstagramPublicationValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(' '))
    this.name = 'InstagramPublicationValidationError'
  }
}

export class InstagramPublicationNotFoundError extends Error {
  constructor() {
    super('Publicación no encontrada.')
    this.name = 'InstagramPublicationNotFoundError'
  }
}

export class InstagramPublicationConflictError extends Error {
  constructor(message = 'La publicación ya no se puede editar.') {
    super(message)
    this.name = 'InstagramPublicationConflictError'
  }
}

export class InstagramPublicationService {
  constructor(
    private readonly repository: InstagramPublicationRepository = new PrismaInstagramPublicationRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async createDraft(input: CreateInstagramPublicationDraft) {
    const validated = validateInstagramReelDraft({
      businessId: input.businessId,
      videoObjectPath: input.videoObjectPath,
      videoMimeType: input.videoMimeType,
      videoSizeBytes: input.videoSizeBytes,
      caption: input.caption,
      privateReplyText: input.automation.privateReplyText,
      keywords: input.automation.keywords
    })
    if (!validated.ok) throw new InstagramPublicationValidationError(validated.errors)
    return this.repository.createDraft({
      ...input,
      businessId: input.businessId.trim(),
      videoObjectPath: input.videoObjectPath.trim(),
      videoMimeType: input.videoMimeType.trim().toLowerCase(),
      caption: input.caption.trim(),
      automation: {
        enabled: input.automation.enabled,
        privateReplyText: input.automation.privateReplyText.trim(),
        keywords: validated.normalizedKeywords
      }
    })
  }

  list(businessId: string) {
    return this.repository.listByBusiness(businessId)
  }

  async get(businessId: string, id: string) {
    const publication = await this.repository.findByBusinessAndId(businessId, id)
    if (!publication) throw new InstagramPublicationNotFoundError()
    return publication
  }

  async updateDraft(businessId: string, id: string, patch: UpdateInstagramPublicationDraft) {
    const current = await this.get(businessId, id)
    if (current.status !== 'DRAFT') throw new InstagramPublicationConflictError()
    const merged: CreateInstagramPublicationDraft = {
      businessId,
      videoObjectPath: patch.videoObjectPath ?? current.videoObjectPath,
      videoMimeType: patch.videoMimeType ?? current.videoMimeType,
      videoSizeBytes: patch.videoSizeBytes ?? current.videoSizeBytes,
      caption: patch.caption ?? current.caption,
      shareToFeed: patch.shareToFeed ?? current.shareToFeed,
      automation: {
        enabled: patch.automation?.enabled ?? current.automation.enabled,
        privateReplyText: patch.automation?.privateReplyText ?? current.automation.privateReplyText,
        keywords: patch.automation?.keywords ?? current.automation.keywords.map((keyword) => keyword.value)
      }
    }
    const validated = validateInstagramReelDraft({
      ...merged,
      privateReplyText: merged.automation.privateReplyText,
      keywords: merged.automation.keywords
    })
    if (!validated.ok) throw new InstagramPublicationValidationError(validated.errors)
    const updated = await this.repository.updateDraft({
      businessId,
      id,
      patch: {
        videoObjectPath: merged.videoObjectPath.trim(),
        videoMimeType: merged.videoMimeType.trim().toLowerCase(),
        videoSizeBytes: merged.videoSizeBytes,
        caption: merged.caption.trim(),
        shareToFeed: merged.shareToFeed
      },
      automation: {
        enabled: merged.automation.enabled,
        privateReplyText: merged.automation.privateReplyText.trim(),
        keywords: validated.normalizedKeywords
      }
    })
    if (!updated) throw new InstagramPublicationConflictError()
    return updated
  }

  async publish(businessId: string, id: string) {
    const current = await this.get(businessId, id)
    if (!['DRAFT', 'READY', 'CREATING_CONTAINER', 'PROCESSING', 'PUBLISHING', 'PUBLISHED'].includes(current.status)) {
      throw new InstagramPublicationConflictError('La publicación requiere revisión manual antes de volver a intentarse.')
    }
    const queued = await this.repository.enqueue({ businessId, id, availableAt: this.now() })
    if (!queued) throw new InstagramPublicationNotFoundError()
    return queued
  }
}

type PrismaLike = Record<string, any>
const publicationInclude = { automation: { include: { keywords: { orderBy: { createdAt: 'asc' } } } } } as const

export class PrismaInstagramPublicationRepository implements InstagramPublicationRepository {
  constructor(private readonly client: PrismaLike = prisma as unknown as PrismaLike) {}

  async createDraft(input: Parameters<InstagramPublicationRepository['createDraft']>[0]) {
    const row = await this.client.instagramPublication.create({
      data: {
        businessId: input.businessId,
        videoObjectPath: input.videoObjectPath,
        videoMimeType: input.videoMimeType,
        videoSizeBytes: input.videoSizeBytes,
        caption: input.caption,
        shareToFeed: input.shareToFeed,
        automation: {
          create: {
            businessId: input.businessId,
            enabled: input.automation.enabled,
            privateReplyText: input.automation.privateReplyText,
            keywords: { create: input.automation.keywords.map((keyword) => ({ businessId: input.businessId, ...keyword })) }
          }
        }
      },
      include: publicationInclude
    })
    return mapPublication(row)
  }

  async listByBusiness(businessId: string) {
    const rows = await this.client.instagramPublication.findMany({
      where: { businessId }, include: publicationInclude, orderBy: { createdAt: 'desc' }
    })
    return rows.map(mapPublication)
  }

  async findByBusinessAndId(businessId: string, id: string) {
    const row = await this.client.instagramPublication.findFirst({ where: { businessId, id }, include: publicationInclude })
    return row ? mapPublication(row) : null
  }

  async updateDraft(input: Parameters<InstagramPublicationRepository['updateDraft']>[0]) {
    return this.client.$transaction(async (tx: PrismaLike) => {
      const guarded = await tx.instagramPublication.updateMany({
        where: { businessId: input.businessId, id: input.id, status: 'DRAFT' },
        data: input.patch
      })
      if (guarded.count !== 1) return null
      if (input.automation) {
        const automation = await tx.instagramCommentAutomation.findFirst({
          where: { businessId: input.businessId, publicationId: input.id }, select: { id: true }
        })
        if (!automation) throw new Error('La automatización de la publicación no existe.')
        await tx.instagramCommentAutomation.update({
          where: { businessId_publicationId: { businessId: input.businessId, publicationId: input.id } },
          data: { enabled: input.automation.enabled, privateReplyText: input.automation.privateReplyText }
        })
        await tx.instagramAutomationKeyword.deleteMany({ where: { businessId: input.businessId, automationId: automation.id } })
        await tx.instagramAutomationKeyword.createMany({
          data: input.automation.keywords.map((keyword) => ({ businessId: input.businessId, automationId: automation.id, ...keyword }))
        })
      }
      return mapPublication(await tx.instagramPublication.findFirstOrThrow({
        where: { businessId: input.businessId, id: input.id }, include: publicationInclude
      }))
    })
  }

  async enqueue(input: Parameters<InstagramPublicationRepository['enqueue']>[0]) {
    await this.client.instagramPublication.updateMany({
      where: { businessId: input.businessId, id: input.id, status: 'DRAFT' },
      data: { status: 'READY', availableAt: input.availableAt, lastError: null }
    })
    const row = await this.client.instagramPublication.findFirst({ where: { businessId: input.businessId, id: input.id }, include: publicationInclude })
    return row ? mapPublication(row) : null
  }
}

function mapPublication(row: any): InstagramPublicationRecord {
  return {
    id: row.id,
    businessId: row.businessId,
    videoObjectPath: row.videoObjectPath,
    videoMimeType: row.videoMimeType,
    videoSizeBytes: row.videoSizeBytes,
    caption: row.caption,
    shareToFeed: row.shareToFeed,
    status: row.status,
    metaContainerId: row.metaContainerId,
    metaMediaId: row.metaMediaId,
    lastError: row.lastError,
    automation: {
      enabled: row.automation.enabled,
      privateReplyText: row.automation.privateReplyText,
      keywords: row.automation.keywords.map((keyword: any) => ({ value: keyword.value, normalizedValue: keyword.normalizedValue }))
    }
  }
}
