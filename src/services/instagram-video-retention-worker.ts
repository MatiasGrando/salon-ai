import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { publishInstagramPublicationChanged } from './crm-realtime-events.js'

export const INSTAGRAM_REEL_VIDEO_RETENTION_MS = 24 * 60 * 60 * 1000
const DEFAULT_LEASE_MS = 60_000

export type InstagramVideoRetentionJob = {
  id: string
  businessId: string
  objectPath: string
  publishedAt: Date
  videoDeletedAt: Date | null
  claimToken: string | null
  claimedUntil: Date | null
}

export interface InstagramVideoRetentionRepository {
  claimNext(input: { cutoff: Date; now: Date; leaseUntil: Date; claimToken: string }): Promise<InstagramVideoRetentionJob | null>
  complete(input: { id: string; businessId: string; claimToken: string; deletedAt: Date }): Promise<boolean>
  release(input: { id: string; businessId: string; claimToken: string }): Promise<boolean>
}

export interface InstagramVideoRetentionStorage {
  delete(job: Pick<InstagramVideoRetentionJob, 'businessId' | 'objectPath'>): Promise<void>
}

export type InstagramVideoRetentionResult =
  | { outcome: 'idle' }
  | { outcome: 'deleted'; publicationId: string }
  | { outcome: 'lost-lease'; publicationId: string }

export class InstagramVideoRetentionWorker {
  private readonly clock: { now(): Date }
  private readonly randomToken: () => string
  private readonly leaseMs: number
  private readonly onVideoDeleted: (input: { businessId: string; publicationId: string; status: 'PUBLISHED'; updatedAt: string }) => void

  constructor(private readonly input: {
    repository: InstagramVideoRetentionRepository
    storage: InstagramVideoRetentionStorage
    clock?: { now(): Date }
    randomToken?: () => string
    leaseMs?: number
    onVideoDeleted?: (input: { businessId: string; publicationId: string; status: 'PUBLISHED'; updatedAt: string }) => void
  }) {
    this.clock = input.clock ?? { now: () => new Date() }
    this.randomToken = input.randomToken ?? randomUUID
    this.leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
    this.onVideoDeleted = input.onVideoDeleted ?? publishInstagramPublicationChanged
  }

  async runOnce(): Promise<InstagramVideoRetentionResult> {
    const now = this.clock.now()
    const claimToken = this.randomToken()
    const job = await this.input.repository.claimNext({
      cutoff: new Date(now.getTime() - INSTAGRAM_REEL_VIDEO_RETENTION_MS),
      now,
      leaseUntil: new Date(now.getTime() + this.leaseMs),
      claimToken
    })
    if (!job) return { outcome: 'idle' }

    try {
      await this.input.storage.delete(job)
    } catch {
      await this.input.repository.release({ id: job.id, businessId: job.businessId, claimToken }).catch(() => false)
      throw new Error('No se pudo eliminar el video almacenado de Instagram. Se reintentará automáticamente.')
    }

    const deletedAt = this.clock.now()
    const completed = await this.input.repository.complete({
      id: job.id,
      businessId: job.businessId,
      claimToken,
      deletedAt
    })
    if (!completed) return { outcome: 'lost-lease', publicationId: job.id }

    this.onVideoDeleted({
      businessId: job.businessId,
      publicationId: job.id,
      status: 'PUBLISHED',
      updatedAt: deletedAt.toISOString()
    })
    return { outcome: 'deleted', publicationId: job.id }
  }
}

type PrismaLike = Record<string, any>

export class PrismaInstagramVideoRetentionRepository implements InstagramVideoRetentionRepository {
  constructor(
    private readonly client: PrismaLike = prisma as unknown as PrismaLike,
    private readonly businessIds: readonly string[] = []
  ) {}

  async claimNext(input: Parameters<InstagramVideoRetentionRepository['claimNext']>[0]) {
    return this.client.$transaction(async (tx: PrismaLike) => {
      const row = await tx.instagramPublication.findFirst({
        where: {
          businessId: { in: [...this.businessIds] },
          status: 'PUBLISHED',
          publishedAt: { lte: input.cutoff },
          videoDeletedAt: null,
          OR: [
            { claimToken: null },
            { claimedUntil: { lte: input.now } }
          ]
        },
        orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          businessId: true,
          videoObjectPath: true,
          publishedAt: true,
          videoDeletedAt: true,
          claimToken: true,
          claimedUntil: true
        }
      })
      if (!row?.publishedAt) return null

      const claimed = await tx.instagramPublication.updateMany({
        where: {
          id: row.id,
          businessId: row.businessId,
          status: 'PUBLISHED',
          publishedAt: { lte: input.cutoff },
          videoDeletedAt: null,
          OR: [
            { claimToken: null },
            { claimedUntil: { lte: input.now } }
          ]
        },
        data: { claimToken: input.claimToken, claimedUntil: input.leaseUntil }
      })
      if (claimed.count !== 1) return null
      return {
        id: row.id,
        businessId: row.businessId,
        objectPath: row.videoObjectPath,
        publishedAt: row.publishedAt,
        videoDeletedAt: row.videoDeletedAt ?? null,
        claimToken: input.claimToken,
        claimedUntil: input.leaseUntil
      }
    })
  }

  async complete(input: Parameters<InstagramVideoRetentionRepository['complete']>[0]) {
    const result = await this.client.instagramPublication.updateMany({
      where: {
        id: input.id,
        businessId: input.businessId,
        status: 'PUBLISHED',
        videoDeletedAt: null,
        claimToken: input.claimToken
      },
      data: { videoDeletedAt: input.deletedAt, claimToken: null, claimedUntil: null }
    })
    return result.count === 1
  }

  async release(input: Parameters<InstagramVideoRetentionRepository['release']>[0]) {
    const result = await this.client.instagramPublication.updateMany({
      where: { id: input.id, businessId: input.businessId, claimToken: input.claimToken },
      data: { claimToken: null, claimedUntil: null }
    })
    return result.count === 1
  }
}
