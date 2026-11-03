import { prisma } from '../config/prisma.js'
import { hasStoryDeclaration } from './instagram-stories-domain.js'
import { assertIanaTimezone } from './cash-domain.js'
import { validateAutomation } from './instagram-comment-automation-service.js'
import {
  validateInstagramReelDraft,
  type InstagramPublicationStatus,
  type ValidatedInstagramKeyword
} from './instagram-automation-domain.js'

export type InstagramPublicationAutomation = {
  enabled: boolean
  privateReplyText: string
  keywords: ValidatedInstagramKeyword[]
  privateReplyEnabled?: boolean
  publicReplyEnabled?: boolean
  publicReplyText?: string
}

export type InstagramPublicationRecord = {
  publicationType?: 'REEL' | 'STORY'
  mediaKind?: 'IMAGE' | 'VIDEO'
  deliveryMode?: 'AUTO' | 'MANUAL'
  manuallyCompletedAt?: Date | null
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
  publicationType?: 'REEL' | 'STORY'
  mediaKind?: 'IMAGE' | 'VIDEO'
  deliveryMode?: 'AUTO' | 'MANUAL'
  businessId: string
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
  caption: string
  shareToFeed: boolean
  automation?: { enabled: boolean; privateReplyText: string; keywords: readonly string[]; privateReplyEnabled?: boolean; publicReplyEnabled?: boolean; publicReplyText?: string }
}

export type UpdateInstagramPublicationDraft = Partial<Pick<
  CreateInstagramPublicationDraft,
  'videoObjectPath' | 'videoMimeType' | 'videoSizeBytes' | 'caption' | 'shareToFeed' | 'deliveryMode'
>> & { automation?: Partial<NonNullable<CreateInstagramPublicationDraft['automation']>>; expectedRevision?: number }

export interface InstagramPublicationRepository {
  createDraft(input: Omit<CreateInstagramPublicationDraft, 'automation'> & { automation: InstagramPublicationAutomation }): Promise<InstagramPublicationRecord>
  listByBusiness(businessId: string): Promise<InstagramPublicationRecord[]>
  findByBusinessAndId(businessId: string, id: string): Promise<InstagramPublicationRecord | null>
  updateDraft(input: {
    businessId: string
    id: string
    expectedRevision: number
    patch: UpdateInstagramPublicationDraft
    automation?: InstagramPublicationAutomation
  }): Promise<InstagramPublicationRecord | null>
  enqueue(input: { businessId: string; id: string; availableAt: Date; expectedRevision: number }): Promise<InstagramPublicationRecord | null>
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
    const automation = normalizedAutomation(input.automation)
    const validated = validateInstagramReelDraft({
      publicationType: input.publicationType ?? 'REEL', mediaKind: input.mediaKind ?? 'VIDEO', deliveryMode: input.deliveryMode ?? 'AUTO',
      businessId: input.businessId,
      videoObjectPath: input.videoObjectPath,
      videoMimeType: input.videoMimeType,
      videoSizeBytes: input.videoSizeBytes,
      caption: input.caption,
      privateReplyText: automation.privateReplyText,
      keywords: automation.keywords,
      automationEnabled: automation.enabled,
      privateReplyEnabled: automation.privateReplyEnabled
    })
    if (!validated.ok) throw new InstagramPublicationValidationError(validated.errors)
    return this.repository.createDraft({
      ...input,
      businessId: input.businessId.trim(),
      videoObjectPath: input.videoObjectPath.trim(),
      videoMimeType: input.videoMimeType.trim().toLowerCase(),
      caption: input.caption.trim(),
      automation: {
        ...automation,
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
    if (!['DRAFT', 'CANCELLED'].includes(current.status)) throw new InstagramPublicationConflictError()
    requireRevision(patch.expectedRevision)
    const automation = normalizedAutomation({ ...current.automation, ...patch.automation,
      keywords: patch.automation?.keywords ?? current.automation.keywords.map((keyword) => keyword.value) })
    const merged: CreateInstagramPublicationDraft = {
      publicationType: current.publicationType ?? 'REEL', mediaKind: current.mediaKind ?? 'VIDEO', deliveryMode: patch.deliveryMode ?? current.deliveryMode ?? 'AUTO',
      businessId,
      videoObjectPath: patch.videoObjectPath ?? current.videoObjectPath,
      videoMimeType: patch.videoMimeType ?? current.videoMimeType,
      videoSizeBytes: patch.videoSizeBytes ?? current.videoSizeBytes,
      caption: patch.caption ?? current.caption,
      shareToFeed: patch.shareToFeed ?? current.shareToFeed,
      automation
    }
    const validated = validateInstagramReelDraft({
      ...merged,
      privateReplyText: automation.privateReplyText,
      keywords: automation.keywords,
      automationEnabled: automation.enabled,
      privateReplyEnabled: automation.privateReplyEnabled
    })
    if (!validated.ok) throw new InstagramPublicationValidationError(validated.errors)
    const updated = await this.repository.updateDraft({
      businessId,
      id,
      expectedRevision: patch.expectedRevision!,
      patch: {
        videoObjectPath: merged.videoObjectPath.trim(),
        videoMimeType: merged.videoMimeType.trim().toLowerCase(),
        videoSizeBytes: merged.videoSizeBytes,
        caption: merged.caption.trim(),
        shareToFeed: merged.shareToFeed, ...(current.publicationType === 'STORY' ? { deliveryMode: merged.deliveryMode } : {})
      },
      automation: {
        ...automation,
        keywords: validated.normalizedKeywords
      }
    })
    if (!updated) throw new InstagramPublicationConflictError()
    return updated
  }

  async publish(businessId: string, id: string, expectedRevision: unknown) {
    const current = await this.get(businessId, id)
    requireRevision(expectedRevision)
    if (!['DRAFT', 'CANCELLED'].includes(current.status)) {
      throw new InstagramPublicationConflictError('La publicación requiere revisión manual antes de volver a intentarse.')
    }
    const queued = await this.repository.enqueue({ businessId, id, availableAt: this.now(), expectedRevision })
    if (!queued) throw new InstagramPublicationConflictError()
    return queued
  }

  async markVideoDeleted(businessId: string, id: string) {
    const current = await this.get(businessId, id)
    if (current.videoDeletedAt) {
      throw new InstagramPublicationConflictError('El video ya fue eliminado del almacenamiento.')
    }
    if (!['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'MANUALLY_COMPLETED'].includes(current.status)) {
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
  constructor(private readonly client: PrismaLike = prisma as unknown as PrismaLike, private readonly clock: () => Date = () => new Date(), private readonly publicationType: 'REEL' | 'STORY' = 'REEL') {}

  async createDraft(input: Parameters<InstagramPublicationRepository['createDraft']>[0]) {
    const row = await this.client.instagramPublication.create({
      data: {
        publicationType: input.publicationType ?? this.publicationType, mediaKind: input.mediaKind ?? 'VIDEO', deliveryMode: input.deliveryMode ?? 'AUTO',
        businessId: input.businessId,
        videoObjectPath: input.videoObjectPath,
        videoMimeType: input.videoMimeType,
        videoSizeBytes: input.videoSizeBytes,
        caption: input.caption,
        shareToFeed: input.shareToFeed,
        automation: {
          create: {
            ...automationFields(input.automation),
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
      where: { businessId, publicationType: this.publicationType }, include: publicationInclude, orderBy: { createdAt: 'desc' }
    })
    return rows.map(mapPublication)
  }

  async findByBusinessAndId(businessId: string, id: string) {
    const row = await this.client.instagramPublication.findFirst({ where: { businessId, id, publicationType: this.publicationType }, include: publicationInclude })
    return row ? mapPublication(row) : null
  }

  async updateDraft(input: Parameters<InstagramPublicationRepository['updateDraft']>[0]) {
    return this.client.$transaction(async (tx: PrismaLike) => {
      const guarded = await tx.instagramPublication.updateMany({
        where: { ...editablePublicationWhere(input.businessId, input.id, input.expectedRevision), publicationType: this.publicationType },
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
          data: automationFields(input.automation)
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
      if (!['DRAFT', 'CANCELLED'].includes(context.row.status) || context.row.revision !== input.expectedRevision) return null
      const destination = this.destination(context.config, context.row)
      const changed = await tx.instagramPublication.updateMany({
        where: editablePublicationWhere(input.businessId, input.id, input.expectedRevision!),
        data: { status: 'READY', availableAt: this.clock(), scheduledAt: null, scheduleTimezone: null, ...destination, revision: { increment: 1 }, lastError: null }
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
    return { business, config: business?.instagramConfig, row: row && (row.publicationType ?? 'REEL') === this.publicationType ? row : null }
  }

  private destination(config: any, row: any) {
    if (row.publicationType === 'STORY' && row.deliveryMode === 'MANUAL') return { destinationInstagramAccountId: config?.instagramAccountId ?? null, destinationApiAccountId: config?.apiAccountId || config?.instagramAccountId || null }
    if (row.publicationType === 'STORY' && !hasStoryDeclaration(config)) throw new InstagramPublicationConflictError('El administrador debe habilitar las historias automáticas para esta cuenta y credencial.')
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
          availableAt: input.scheduledAt, ...this.destination(config, row) }
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
      where: { ...input, id: input.id, videoDeletedAt: null, status: { in: ['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'MANUALLY_COMPLETED'] },
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
        status: { in: ['PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'MANUALLY_COMPLETED'] }
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
    publicationType: row.publicationType ?? 'REEL', mediaKind: row.mediaKind ?? 'VIDEO', deliveryMode: row.deliveryMode ?? 'AUTO', manuallyCompletedAt: row.manuallyCompletedAt ?? null,
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
      privateReplyEnabled: row.automation.privateReplyEnabled ?? true,
      publicReplyEnabled: row.automation.publicReplyEnabled ?? false,
      publicReplyText: row.automation.publicReplyText ?? '',
      privateReplyText: row.automation.privateReplyText,
      keywords: row.automation.keywords.map((keyword: any) => ({ value: keyword.value, normalizedValue: keyword.normalizedValue }))
    }
  }
}

export function editablePublicationWhere(businessId: string, id: string, revision: number) {
  return { businessId, id, revision, status: { in: ['DRAFT', 'CANCELLED'] }, claimToken: null, claimedUntil: null,
    metaContainerId: null, metaMediaId: null, videoDeletedAt: null, videoDeleteRequestedAt: null }
}

function requireRevision(revision: unknown): asserts revision is number {
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new InstagramPublicationValidationError(['La revisión esperada es obligatoria.'])
}

function normalizedAutomation(raw: CreateInstagramPublicationDraft['automation']) {
  try {
    const validated = validateAutomation({ enabled: false, privateReplyEnabled: true, privateReplyText: '', publicReplyEnabled: false, publicReplyText: '', keywords: [], ...raw })
    return { ...validated, keywords: [...(raw?.keywords ?? [])] }
  }
  catch { throw new InstagramPublicationValidationError(['Revisá las palabras clave y los textos de las acciones activas.']) }
}

function automationFields(automation: InstagramPublicationAutomation) {
  return { enabled: automation.enabled, privateReplyText: automation.privateReplyText, privateReplyEnabled: automation.privateReplyEnabled ?? true,
    publicReplyEnabled: automation.publicReplyEnabled ?? false, publicReplyText: automation.publicReplyText ?? '' }
}

export function parseScheduleInstant(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, zone] = match
  if (+month! < 1 || +month! > 12 || +day! < 1 || +day! > new Date(Date.UTC(+year!, +month!, 0)).getUTCDate() || +hour! > 23 || +minute! > 59 || +second! > 59) return null
  if (zone !== 'Z' && (+zone!.slice(1, 3) > 23 || +zone!.slice(4, 6) > 59)) return null
  const instant = new Date(value)
  return Number.isFinite(+instant) ? instant : null
}
