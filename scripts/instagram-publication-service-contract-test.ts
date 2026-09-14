import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  InstagramPublicationConflictError,
  InstagramPublicationNotFoundError,
  PrismaInstagramPublicationRepository,
  InstagramPublicationValidationError,
  InstagramPublicationService,
  type InstagramPublicationRecord,
  type InstagramPublicationRepository
} from '../src/services/instagram-publication-service.js'

class MemoryRepository implements InstagramPublicationRepository {
  records: InstagramPublicationRecord[] = []

  async createDraft(input: Parameters<InstagramPublicationRepository['createDraft']>[0]) {
    const record: InstagramPublicationRecord = {
      id: `publication-${this.records.length + 1}`,
      businessId: input.businessId,
      videoObjectPath: input.videoObjectPath,
      videoMimeType: input.videoMimeType,
      videoSizeBytes: input.videoSizeBytes,
      caption: input.caption,
      shareToFeed: input.shareToFeed,
      status: 'DRAFT',
      metaContainerId: null,
      metaMediaId: null,
      lastError: null,
      videoDeletedAt: null,
      videoAvailable: true,
      automation: {
        enabled: input.automation.enabled,
        privateReplyText: input.automation.privateReplyText,
        keywords: input.automation.keywords
      }
    }
    this.records.push(record)
    return record
  }

  async listByBusiness(businessId: string) {
    return this.records.filter((record) => record.businessId === businessId)
  }

  async findByBusinessAndId(businessId: string, id: string) {
    return this.records.find((record) => record.businessId === businessId && record.id === id) ?? null
  }

  async updateDraft(input: Parameters<InstagramPublicationRepository['updateDraft']>[0]) {
    const record = await this.findByBusinessAndId(input.businessId, input.id)
    if (!record || record.status !== 'DRAFT') return null
    Object.assign(record, input.patch)
    if (input.automation) record.automation = input.automation
    return record
  }

  async enqueue(input: Parameters<InstagramPublicationRepository['enqueue']>[0]) {
    const record = await this.findByBusinessAndId(input.businessId, input.id)
    if (!record) return null
    if (record.status === 'DRAFT') record.status = 'READY'
    return record
  }

  async markVideoDeleted(input: Parameters<InstagramPublicationRepository['markVideoDeleted']>[0]) {
    const record = await this.findByBusinessAndId(input.businessId, input.id)
    if (!record || record.videoDeletedAt || !['PUBLISHED', 'FAILED', 'UNKNOWN'].includes(record.status)) return null
    record.videoDeletedAt = input.deletedAt
    record.videoAvailable = false
    return record
  }
}

const repository = new MemoryRepository()
const service = new InstagramPublicationService(repository, () => new Date('2026-09-13T12:00:00.000Z'))

await assert.rejects(
  () => service.createDraft({
    businessId: 'business-a', videoObjectPath: '', videoMimeType: 'image/png', videoSizeBytes: 0,
    caption: 'Promo', shareToFeed: true, automation: { enabled: true, privateReplyText: '', keywords: [] }
  }),
  InstagramPublicationValidationError
)

const draft = await service.createDraft({
  businessId: 'business-a',
  videoObjectPath: 'business-a/reels/promo.mp4',
  videoMimeType: 'video/mp4',
  videoSizeBytes: 12_345,
  caption: 'Promo de septiembre',
  shareToFeed: false,
  automation: { enabled: true, privateReplyText: 'Te cuento por privado.', keywords: [' Precio ', 'PRÉCIO', 'Turno'] }
})
assert.equal(draft.status, 'DRAFT')
assert.deepEqual(draft.automation.keywords, [
  { value: 'Precio', normalizedValue: 'precio' },
  { value: 'Turno', normalizedValue: 'turno' }
])

await service.createDraft({
  businessId: 'business-b', videoObjectPath: 'business-b/reels/otro.mp4', videoMimeType: 'video/mp4',
  videoSizeBytes: 99, caption: '', shareToFeed: true,
  automation: { enabled: false, privateReplyText: 'Info', keywords: ['info'] }
})
assert.deepEqual((await service.list('business-a')).map((item) => item.id), [draft.id])
await assert.rejects(() => service.get('business-b', draft.id), InstagramPublicationNotFoundError)

const edited = await service.updateDraft('business-a', draft.id, {
  caption: 'Promo editada',
  automation: { enabled: true, privateReplyText: 'Nuevo mensaje', keywords: ['Reserva', 'RESÉRVA'] }
})
assert.equal(edited.caption, 'Promo editada')
assert.deepEqual(edited.automation.keywords, [{ value: 'Reserva', normalizedValue: 'reserva' }])
const partiallyEdited = await service.updateDraft('business-a', draft.id, {
  automation: { enabled: false }
})
assert.equal(partiallyEdited.automation.enabled, false)
assert.equal(partiallyEdited.automation.privateReplyText, 'Nuevo mensaje')
assert.deepEqual(partiallyEdited.automation.keywords, [{ value: 'Reserva', normalizedValue: 'reserva' }])

const firstPublish = await service.publish('business-a', draft.id)
const secondPublish = await service.publish('business-a', draft.id)
assert.equal(firstPublish.status, 'READY')
assert.equal(secondPublish.status, 'READY')
await assert.rejects(() => service.updateDraft('business-a', draft.id, { caption: 'tarde' }), InstagramPublicationConflictError)

repository.records[0]!.status = 'UNKNOWN'
await assert.rejects(() => service.publish('business-a', draft.id), InstagramPublicationConflictError)
const released = await service.markVideoDeleted('business-a', draft.id)
assert.equal(released.videoAvailable, false)
await assert.rejects(() => service.markVideoDeleted('business-a', draft.id), InstagramPublicationConflictError)

let prismaCreateInput: any
const prismaRepository = new PrismaInstagramPublicationRepository({
  instagramPublication: {
    create: async (args: any) => {
      prismaCreateInput = args
      return {
        id: 'publication-prisma',
        businessId: args.data.businessId,
        videoObjectPath: args.data.videoObjectPath,
        videoMimeType: args.data.videoMimeType,
        videoSizeBytes: args.data.videoSizeBytes,
        caption: args.data.caption,
        shareToFeed: args.data.shareToFeed,
        status: 'DRAFT',
        metaContainerId: null,
        metaMediaId: null,
        lastError: null,
        automation: {
          enabled: args.data.automation.create.enabled,
          privateReplyText: args.data.automation.create.privateReplyText,
          keywords: args.data.automation.create.keywords.create
        }
      }
    }
  }
})
await prismaRepository.createDraft({
  businessId: 'business-prisma',
  videoObjectPath: 'business-prisma/instagram/reels/reel.mp4',
  videoMimeType: 'video/mp4',
  videoSizeBytes: 123,
  caption: 'Promo',
  shareToFeed: true,
  automation: {
    enabled: true,
    privateReplyText: 'Te cuento por privado.',
    keywords: [{ value: 'Info', normalizedValue: 'info' }]
  }
})
assert.equal('businessId' in prismaCreateInput.data.automation.create, false,
  'la relación anidada hereda businessId desde la publicación')
assert.equal('businessId' in prismaCreateInput.data.automation.create.keywords.create[0], false,
  'las keywords anidadas heredan businessId desde la automatización')

const retentionMigration = readFileSync(
  new URL('../prisma/migrations/20260914230000_add_instagram_video_deleted_at/migration.sql', import.meta.url),
  'utf8'
)
assert.match(retentionMigration, /ADD COLUMN "videoDeletedAt" TIMESTAMP\(3\)/)

console.log('Instagram publication service contract: OK')
