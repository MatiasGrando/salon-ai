import { prisma } from '../config/prisma.js'
import { assertIanaTimezone } from './cash-domain.js'
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
  videoDeletedAt: Date | null
  videoAvailable: boolean
  scheduledAt?: Date | null
  scheduleTimezone?: string | null
  revision?: number
  destinationInstagramAccountId?: string | null
  destinationApiAccountId?: string | null
  publishedAt?: Date | null
  videoDeleteRequestedAt?: Date | null
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
  changeSchedule(input: { businessId: string; id: string; expectedRevision: number; scheduledAt: Date | null }): Promise<InstagramPublicationRecord | null>
  reserveVideoDeletion(input: { businessId: string; id: string }): Promise<InstagramPublicationRecord | null>
  markVideoDeleted(input: { businessId: string; id: string; deletedAt: Date }): Promise<InstagramPublicationRecord | null>
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

  async markVideoDeleted(businessId: string, id: string) {
    const current = await this.get(businessId, id)
    if (current.videoDeletedAt) {
      throw new InstagramPublicationConflictError('El video ya fue eliminado del almacenamiento.')
    }
    if (!['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(current.status)) {
      throw new InstagramPublicationConflictError('Esperá a que finalice la publicación antes de borrar el video almacenado.')
    }
    const updated = await this.repository.markVideoDeleted({ businessId, id, deletedAt: this.now() })
    if (!updated) throw new InstagramPublicationConflictError('El estado del Reel cambió. Actualizá la lista e intentá nuevamente.')
    return updated
  }

  async schedule(businessId: string, id: string, input: { scheduledAt: unknown; expectedRevision: unknown }) {
    const scheduledAt = parseScheduleInstant(input.scheduledAt)
    if (!scheduledAt || scheduledAt <= this.now()) throw new InstagramPublicationValidationError(['Elegí una fecha futura con zona horaria explícita.'])
    return this.changeSchedule(businessId, id, input.expectedRevision, scheduledAt)
  }

  cancel(businessId: string, id: string, expectedRevision: unknown) {
    return this.changeSchedule(businessId, id, expectedRevision, null)
  }

  private async changeSchedule(businessId: string, id: string, expectedRevision: unknown, scheduledAt: Date | null) {
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new InstagramPublicationValidationError(['La revisión esperada es obligatoria.'])
    }
    await this.get(businessId, id)
    const updated = await this.repository.changeSchedule({ businessId, id, expectedRevision, scheduledAt })
    if (!updated) throw new InstagramPublicationConflictError('El estado o la revisión cambió, o el envío ya comenzó.')
    return updated
  }

  async reserveVideoDeletion(businessId: string, id: string) {
    await this.get(businessId, id)
    const reserved = await this.repository.reserveVideoDeletion({ businessId, id })
    if (!reserved) throw new InstagramPublicationConflictError('El video ya fue eliminado o todavía está en uso.')
    return reserved
  }
}

type PrismaLike = Record<string, any>
const publicationInclude = { automation: { include: { keywords: { orderBy: { createdAt: 'asc' } } } } } as const

export class PrismaInstagramPublicationRepository implements InstagramPublicationRepository {
  constructor(private readonly client: PrismaLike = prisma as unknown as PrismaLike, private readonly clock: () => Date = () => new Date()) {}

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
            enabled: input.automation.enabled,
            privateReplyText: input.automation.privateReplyText,
            keywords: { create: input.automation.keywords }
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
        data: { ...input.patch, revision: { increment: 1 } }
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
    return this.client.$transaction(async (tx: PrismaLike) => {
      const context = await this.lockContext(tx, input.businessId, input.id)
      if (!context.row) return null
      if (context.row.status !== 'DRAFT') return mapPublication(context.row)
      const destination = this.destination(context.config)
      const changed = await tx.instagramPublication.updateMany({
        where: { businessId: input.businessId, id: input.id, status: 'DRAFT', videoDeletedAt: null, videoDeleteRequestedAt: null, claimToken: null },
        data: { status: 'READY', availableAt: this.clock(), ...destination, revision: { increment: 1 }, lastError: null }
      })
      if (changed.count !== 1) throw new InstagramPublicationConflictError()
      return mapPublication(await tx.instagramPublication.findFirstOrThrow({ where: { businessId: input.businessId, id: input.id }, include: publicationInclude }))
    })
  }

  private async lockContext(tx: PrismaLike, businessId: string, id: string) {
    await tx.$queryRawUnsafe('SELECT "id" FROM "BusinessInstagramConfig" WHERE "businessId"=$1 FOR UPDATE', businessId)
    await tx.$queryRawUnsafe('SELECT "id" FROM "InstagramPublication" WHERE "businessId"=$1 AND "id"=$2 FOR UPDATE', businessId, id)
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true, instagramConfig: true } })
    const row = await tx.instagramPublication.findFirst({ where: { businessId, id }, include: publicationInclude })
    return { business, config: business?.instagramConfig, row }
  }

  private destination(config: any) {
    if (!config?.enabled || !config.accessToken || !config.instagramAccountId) throw new InstagramPublicationConflictError('Instagram no está conectado y habilitado para publicar.')
    return { destinationInstagramAccountId: config.instagramAccountId, destinationApiAccountId: config.apiAccountId || config.instagramAccountId }
  }

  async changeSchedule(input: Parameters<InstagramPublicationRepository['changeSchedule']>[0]) {
    return this.client.$transaction(async (tx: PrismaLike) => {
      const { business, config, row } = await this.lockContext(tx, input.businessId, input.id)
      if (!row) return null
      const now = this.clock()
      const statuses = input.scheduledAt ? ['DRAFT', 'CANCELLED', 'SCHEDULED'] : ['SCHEDULED']
      if (!statuses.includes(row.status) || row.revision !== input.expectedRevision || row.claimToken || row.claimedUntil || row.metaContainerId || row.metaMediaId) return null
      let data: Record<string, unknown> = { status: 'CANCELLED', revision: { increment: 1 }, lastError: null }
      if (input.scheduledAt) {
        if (input.scheduledAt <= now) throw new InstagramPublicationValidationError(['La fecha dejó de ser futura.'])
        let timezone: string
        try { timezone = assertIanaTimezone(business?.timezone) } catch { throw new InstagramPublicationConflictError('Configurá una zona horaria válida para el comercio.') }
        data = { ...data, status: 'SCHEDULED', scheduledAt: input.scheduledAt, scheduleTimezone: timezone,
          availableAt: input.scheduledAt, ...this.destination(config) }
      }
      const changed = await tx.instagramPublication.updateMany({
        where: { businessId: input.businessId, id: input.id, status: row.status, revision: input.expectedRevision,
          claimToken: null, claimedUntil: null, videoDeletedAt: null, videoDeleteRequestedAt: null,
          ...(row.status === 'SCHEDULED' ? { scheduledAt: row.scheduledAt } : {}) },
        data
      })
      if (changed.count !== 1) return null
      return mapPublication(await tx.instagramPublication.findFirstOrThrow({ where: { businessId: input.businessId, id: input.id }, include: publicationInclude }))
    })
  }

  async reserveVideoDeletion(input: Parameters<InstagramPublicationRepository['reserveVideoDeletion']>[0]) {
    const changed = await this.client.instagramPublication.updateMany({
      where: { ...input, id: input.id, videoDeletedAt: null, status: { in: ['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED'] },
        OR: [{ claimToken: null }, { claimedUntil: { lte: this.clock() } }] },
      data: { videoDeleteRequestedAt: this.clock(), revision: { increment: 1 } }
    })
    if (changed.count !== 1) return null
    return this.findByBusinessAndId(input.businessId, input.id)
  }

  async markVideoDeleted(input: Parameters<InstagramPublicationRepository['markVideoDeleted']>[0]) {
    const guarded = await this.client.instagramPublication.updateMany({
      where: {
        businessId: input.businessId,
        id: input.id,
        videoDeletedAt: null,
        status: { in: ['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED'] }
      },
      data: { videoDeletedAt: input.deletedAt }
    })
    if (guarded.count !== 1) return null
    return mapPublication(await this.client.instagramPublication.findFirstOrThrow({
      where: { businessId: input.businessId, id: input.id }, include: publicationInclude
    }))
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
    videoDeletedAt: row.videoDeletedAt ?? null,
    videoDeleteRequestedAt: row.videoDeleteRequestedAt ?? null,
    videoAvailable: !row.videoDeletedAt,
    scheduledAt: row.scheduledAt ?? null,
    scheduleTimezone: row.scheduleTimezone ?? null,
    revision: row.revision ?? 0,
    destinationInstagramAccountId: row.destinationInstagramAccountId ?? null,
    destinationApiAccountId: row.destinationApiAccountId ?? null,
    publishedAt: row.publishedAt ?? null,
    automation: {
      enabled: row.automation.enabled,
      privateReplyText: row.automation.privateReplyText,
      keywords: row.automation.keywords.map((keyword: any) => ({ value: keyword.value, normalizedValue: keyword.normalizedValue }))
    }
  }
}

function parseScheduleInstant(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, zone] = match
  if (+month! < 1 || +month! > 12 || +day! < 1 || +day! > new Date(Date.UTC(+year!, +month!, 0)).getUTCDate() || +hour! > 23 || +minute! > 59 || +second! > 59) return null
  if (zone !== 'Z' && (+zone!.slice(1, 3) > 23 || +zone!.slice(4, 6) > 59)) return null
  const instant = new Date(value)
  return Number.isFinite(+instant) ? instant : null
}
