import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { copyInstagramReelVideo, deleteInstagramReelVideo } from './instagram-video-storage-service.js'
import { InstagramPublicationConflictError, InstagramPublicationNotFoundError, InstagramPublicationValidationError,
  PrismaInstagramPublicationRepository, type InstagramPublicationRecord } from './instagram-publication-service.js'

type Client = Record<string, any>
type Storage = { copy: typeof copyInstagramReelVideo; delete: typeof deleteInstagramReelVideo }
const COPY_LEASE_MS = 300000
const COPY_SOURCE_STATUSES = ['DRAFT', 'CANCELLED', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'MANUALLY_COMPLETED']
export class InstagramDuplicationService {
  constructor(private readonly client: Client = prisma, private readonly storage: Storage = { copy: copyInstagramReelVideo, delete: deleteInstagramReelVideo },
    private readonly clock: () => Date = () => new Date(), private readonly uuid: () => string = randomUUID) {}

  async duplicate(businessId: string, target: { publicationId?: string; mediaId?: string; publicationType?: 'REEL' | 'STORY' }, expectedRevision: unknown) {
    const repository = new PrismaInstagramPublicationRepository(this.client, this.clock, target.publicationType ?? 'REEL')
    let source: InstagramPublicationRecord | null = null
    if (target.mediaId) {
      const config = await this.client.businessInstagramConfig.findUnique({ where: { businessId } })
      const media = config?.instagramAccountId ? await this.client.instagramMedia.findFirst({ where: { businessId, id: target.mediaId, accountId: config.instagramAccountId }, include: { automation: { include: { keywords: true } } } }) : null
      if (!media) throw new InstagramPublicationNotFoundError()
      source = media.providerMediaId ? await this.client.instagramPublication.findFirst({ where: { businessId, metaMediaId: media.providerMediaId } }) : null
      if (source) source = await repository.findByBusinessAndId(businessId, source.id)
      if (!source) return { requiresFile: true, publication: null, content: { caption: media.caption ?? '', shareToFeed: true, automation: contentAutomation(media.automation) } }
    } else if (target.publicationId) source = await repository.findByBusinessAndId(businessId, target.publicationId)
    if (!source) throw new InstagramPublicationNotFoundError()
    const content = { caption: source.caption, shareToFeed: source.shareToFeed, automation: source.automation, publicationType: source.publicationType ?? 'REEL', mediaKind: source.mediaKind ?? 'VIDEO', deliveryMode: source.deliveryMode ?? 'AUTO' }
    if (source.videoDeletedAt || source.videoDeleteRequestedAt) return { requiresFile: true, publication: null, content }
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new InstagramPublicationValidationError(['La revisión esperada es obligatoria.'])
    const token = this.uuid(), destinationObjectPath = businessId + '/instagram/' + (source.publicationType === 'STORY' ? 'stories/' : 'reels/') + this.uuid() + (source.videoMimeType === 'image/jpeg' ? '.jpg' : source.videoMimeType === 'video/quicktime' ? '.mov' : '.mp4')
    const reserved = await this.client.instagramPublication.updateMany({
      where: { businessId, id: source.id, revision: expectedRevision, status: { in: COPY_SOURCE_STATUSES }, videoObjectPath: source.videoObjectPath,
        videoDeletedAt: null, videoDeleteRequestedAt: null, OR: [{ claimedUntil: null }, { claimedUntil: { lte: this.clock() } }] },
      data: { claimToken: token, claimedUntil: new Date(+this.clock() + COPY_LEASE_MS) }
    })
    if (reserved.count !== 1) throw new InstagramPublicationConflictError('El archivo está en uso o cambió su revisión.')
    let committing = false
    try {
      await this.storage.copy({ businessId, sourceObjectPath: source.videoObjectPath, destinationObjectPath,
        expectedMimeType: source.videoMimeType, expectedSizeBytes: source.videoSizeBytes })
      committing = true
      const publication = await this.client.$transaction(async (tx: Client) => {
        await tx.$queryRawUnsafe('SELECT "id" FROM "InstagramPublication" WHERE "businessId"=$1 AND "id"=$2 FOR UPDATE', businessId, source!.id)
        const owner = await tx.instagramPublication.findFirst({ where: { businessId, id: source!.id, revision: expectedRevision, status: { in: COPY_SOURCE_STATUSES }, videoObjectPath: source!.videoObjectPath,
          claimToken: token, claimedUntil: { gt: this.clock() }, videoDeletedAt: null, videoDeleteRequestedAt: null } })
        if (!owner) throw new InstagramPublicationConflictError('La reserva del archivo venció o cambió.')
        const created = await new PrismaInstagramPublicationRepository(tx, this.clock).createDraft({ businessId, videoObjectPath: destinationObjectPath,
          videoMimeType: source!.videoMimeType, videoSizeBytes: source!.videoSizeBytes, ...content })
        const released = await tx.instagramPublication.updateMany({ where: { businessId, id: source!.id, revision: expectedRevision, status: { in: COPY_SOURCE_STATUSES },
          videoObjectPath: source!.videoObjectPath, claimToken: token, claimedUntil: { gt: this.clock() }, videoDeletedAt: null, videoDeleteRequestedAt: null },
          data: { claimToken: null, claimedUntil: null } })
        if (released.count !== 1) throw new InstagramPublicationConflictError('La reserva del archivo venció.')
        return created
      })
      return { requiresFile: false, publication, content }
    } catch (error) {
      // A lost commit response is not proof of rollback. Never delete a referenced object.
      let safeToDelete = false
      if (committing) {
        const referenced = await this.client.instagramPublication.findFirst({ where: { businessId, videoObjectPath: destinationObjectPath } }).catch(() => undefined)
        if (referenced) return { requiresFile: false, publication: await repository.findByBusinessAndId(businessId, referenced.id), content }
        safeToDelete = referenced === null
      }
      if (safeToDelete) await this.storage.delete({ businessId, objectPath: destinationObjectPath }).catch(() => undefined)
      throw error
    } finally {
      await this.client.instagramPublication.updateMany({ where: { businessId, id: source.id, claimToken: token }, data: { claimToken: null, claimedUntil: null } }).catch(() => undefined)
    }
  }
}

function contentAutomation(row: any) {
  return { enabled: row?.enabled ?? false, privateReplyEnabled: row?.privateReplyEnabled ?? true, privateReplyText: row?.privateReplyText ?? '',
    publicReplyEnabled: row?.publicReplyEnabled ?? false, publicReplyText: row?.publicReplyText ?? '',
    keywords: row?.keywords?.map((keyword: any) => ({ value: keyword.value, normalizedValue: keyword.normalizedValue })) ?? [] }
}
