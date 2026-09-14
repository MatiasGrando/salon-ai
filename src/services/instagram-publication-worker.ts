import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { InstagramApi, InstagramApiRequestError } from '../integrations/instagram-api.js'
import type { InstagramPublicationStatus } from './instagram-automation-domain.js'

export type InstagramPublicationJob = {
  id: string
  businessId: string
  status: InstagramPublicationStatus
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
  caption: string
  shareToFeed: boolean
  metaContainerId: string | null
  metaMediaId?: string | null
  attempts: number
  maxAttempts: number
  availableAt: Date
  claimToken: string | null
  claimedUntil: Date | null
  lastError: string | null
  instagramAccountId: string | null
  accessToken: string | null
}

export interface InstagramPublicationWorkerRepository {
  recoverExpiredAmbiguousPhases(now: Date): Promise<number>
  claimNext(input: { now: Date; leaseUntil: Date; claimToken: string }): Promise<InstagramPublicationJob | null>
  transition(input: {
    id: string
    claimToken: string
    from: InstagramPublicationStatus
    to: InstagramPublicationStatus
    patch: Partial<InstagramPublicationJob> & { publishedAt?: Date | null }
    keepLease?: boolean
  }): Promise<boolean>
}

export interface InstagramPublicationVideoUrlProvider {
  createTemporaryHttpsUrl(input: {
    businessId: string
    objectPath: string
    mimeType: string
    sizeBytes: number
  }): Promise<string>
}

export interface InstagramPublicationApi {
  createReelContainer(input: { accountId: string; accessToken: string; videoUrl: string; caption: string; shareToFeed: boolean }): Promise<{ containerId: string }>
  getContainerStatus(input: { containerId: string; accessToken: string }): Promise<{ statusCode: string }>
  publishContainer(input: { accountId: string; accessToken: string; containerId: string }): Promise<{ mediaId: string }>
}

export type InstagramPublicationWorkerResult =
  | { outcome: 'idle' }
  | { outcome: 'processed'; publicationId: string; status: InstagramPublicationStatus }
  | { outcome: 'lost-lease'; publicationId: string }

const DEFAULT_LEASE_MS = 60_000
const STATUS_POLL_DELAY_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000

export class InstagramPublicationWorker {
  private readonly repository: InstagramPublicationWorkerRepository
  private readonly api: InstagramPublicationApi
  private readonly videoUrls: InstagramPublicationVideoUrlProvider
  private readonly clock: { now(): Date }
  private readonly randomToken: () => string
  private readonly leaseMs: number

  constructor(input: {
    repository?: InstagramPublicationWorkerRepository
    api?: InstagramPublicationApi
    videoUrls: InstagramPublicationVideoUrlProvider
    clock?: { now(): Date }
    randomToken?: () => string
    leaseMs?: number
  }) {
    this.repository = input.repository ?? new PrismaInstagramPublicationWorkerRepository()
    this.api = input.api ?? new InstagramApi()
    this.videoUrls = input.videoUrls
    this.clock = input.clock ?? { now: () => new Date() }
    this.randomToken = input.randomToken ?? randomUUID
    this.leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
  }

  async runOnce(): Promise<InstagramPublicationWorkerResult> {
    const now = this.clock.now()
    await this.repository.recoverExpiredAmbiguousPhases(now)
    const claimToken = this.randomToken()
    const job = await this.repository.claimNext({
      now,
      leaseUntil: new Date(now.getTime() + this.leaseMs),
      claimToken
    })
    if (!job) return { outcome: 'idle' }
    if (!job.instagramAccountId || !job.accessToken) {
      return this.settle(job, claimToken, job.status, 'FAILED', {
        lastError: 'Instagram no está conectado o habilitado para este comercio.'
      })
    }
    if (job.status === 'READY' || job.status === 'CREATING_CONTAINER') return this.createContainer(job, claimToken)
    if (job.status === 'PUBLISHING') return this.publishPrepared(job, claimToken)
    return this.pollAndPublish(job, claimToken)
  }

  private async createContainer(job: InstagramPublicationJob, claimToken: string): Promise<InstagramPublicationWorkerResult> {
    let videoUrl: string
    try {
      videoUrl = await this.videoUrls.createTemporaryHttpsUrl({
        businessId: job.businessId,
        objectPath: job.videoObjectPath,
        mimeType: job.videoMimeType,
        sizeBytes: job.videoSizeBytes
      })
      if (new URL(videoUrl).protocol !== 'https:') throw new Error('La URL temporal del video debe usar HTTPS.')
    } catch (error) {
      return this.retryOrFail(job, claimToken, 'READY', error)
    }

    if (!await this.repository.transition({
      id: job.id, claimToken, from: job.status, to: 'CREATING_CONTAINER', keepLease: true,
      patch: { attempts: job.attempts + 1, lastError: null }
    })) return { outcome: 'lost-lease', publicationId: job.id }

    try {
      const created = await this.api.createReelContainer({
        accountId: job.instagramAccountId!, accessToken: job.accessToken!, videoUrl,
        caption: job.caption, shareToFeed: job.shareToFeed
      })
      return this.settle(job, claimToken, 'CREATING_CONTAINER', 'PROCESSING', {
        metaContainerId: created.containerId,
        attempts: 0,
        availableAt: this.clock.now(),
        lastError: null
      })
    } catch (error) {
      if (isAmbiguousExternalPost(error)) {
        return this.settle(job, claimToken, 'CREATING_CONTAINER', 'UNKNOWN', { lastError: errorMessage(error) })
      }
      return this.retryOrFail({ ...job, attempts: job.attempts + 1 }, claimToken, 'CREATING_CONTAINER', error, true)
    }
  }

  private async pollAndPublish(job: InstagramPublicationJob, claimToken: string): Promise<InstagramPublicationWorkerResult> {
    if (!job.metaContainerId) {
      return this.settle(job, claimToken, 'PROCESSING', 'FAILED', { lastError: 'Falta el identificador del contenedor de Instagram.' })
    }
    let statusCode: string
    try {
      statusCode = (await this.api.getContainerStatus({ containerId: job.metaContainerId, accessToken: job.accessToken! })).statusCode
    } catch (error) {
      return this.retryOrFail(job, claimToken, 'PROCESSING', error)
    }

    if (statusCode === 'IN_PROGRESS') {
      return this.settle(job, claimToken, 'PROCESSING', 'PROCESSING', {
        availableAt: new Date(this.clock.now().getTime() + STATUS_POLL_DELAY_MS), lastError: null
      })
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      return this.settle(job, claimToken, 'PROCESSING', 'FAILED', { lastError: `Instagram informó estado ${statusCode}.` })
    }
    if (statusCode === 'PUBLISHED') {
      return this.settle(job, claimToken, 'PROCESSING', 'UNKNOWN', {
        lastError: 'Instagram informó PUBLISHED sin devolver un mediaId verificable.'
      })
    }
    if (statusCode !== 'FINISHED') {
      return this.settle(job, claimToken, 'PROCESSING', 'FAILED', { lastError: `Estado de contenedor desconocido: ${statusCode}.` })
    }

    if (!await this.repository.transition({
      id: job.id, claimToken, from: 'PROCESSING', to: 'PUBLISHING', keepLease: true,
      patch: { attempts: job.attempts + 1, lastError: null }
    })) return { outcome: 'lost-lease', publicationId: job.id }

    return this.publishPrepared({ ...job, status: 'PUBLISHING', attempts: job.attempts + 1 }, claimToken, true)
  }

  private async publishPrepared(
    job: InstagramPublicationJob,
    claimToken: string,
    attemptAlreadyRecorded = false
  ): Promise<InstagramPublicationWorkerResult> {
    if (!job.metaContainerId) {
      return this.settle(job, claimToken, 'PUBLISHING', 'FAILED', { lastError: 'Falta el identificador del contenedor de Instagram.' })
    }
    const attempts = attemptAlreadyRecorded ? job.attempts : job.attempts + 1
    if (!attemptAlreadyRecorded && !await this.repository.transition({
      id: job.id, claimToken, from: 'PUBLISHING', to: 'PUBLISHING', keepLease: true,
      patch: { attempts, lastError: null }
    })) return { outcome: 'lost-lease', publicationId: job.id }
    try {
      const published = await this.api.publishContainer({
        accountId: job.instagramAccountId!, accessToken: job.accessToken!, containerId: job.metaContainerId
      })
      return this.settle(job, claimToken, 'PUBLISHING', 'PUBLISHED', {
        metaMediaId: published.mediaId,
        publishedAt: this.clock.now(),
        attempts,
        lastError: null
      })
    } catch (error) {
      if (isAmbiguousExternalPost(error)) {
        return this.settle(job, claimToken, 'PUBLISHING', 'UNKNOWN', { attempts, lastError: errorMessage(error) })
      }
      return this.retryOrFail({ ...job, attempts }, claimToken, 'PUBLISHING', error, true)
    }
  }

  private retryOrFail(
    job: InstagramPublicationJob,
    claimToken: string,
    from: InstagramPublicationStatus,
    error: unknown,
    attemptAlreadyRecorded = false
  ) {
    const attempts = job.attempts + (attemptAlreadyRecorded ? 0 : 1)
    const retryable = !(error instanceof InstagramApiRequestError) || error.transient
    const exhausted = attempts >= job.maxAttempts
    return this.settle(job, claimToken, from, retryable && !exhausted ? from : 'FAILED', {
      attempts,
      availableAt: new Date(this.clock.now().getTime() + backoffMs(attempts)),
      lastError: errorMessage(error)
    })
  }

  private async settle(
    job: InstagramPublicationJob,
    claimToken: string,
    from: InstagramPublicationStatus,
    to: InstagramPublicationStatus,
    patch: Partial<InstagramPublicationJob> & { publishedAt?: Date | null }
  ): Promise<InstagramPublicationWorkerResult> {
    const updated = await this.repository.transition({ id: job.id, claimToken, from, to, patch })
    return updated
      ? { outcome: 'processed', publicationId: job.id, status: to }
      : { outcome: 'lost-lease', publicationId: job.id }
  }
}

type PrismaLike = Record<string, any>

export class PrismaInstagramPublicationWorkerRepository implements InstagramPublicationWorkerRepository {
  constructor(private readonly client: PrismaLike = prisma as unknown as PrismaLike) {}

  async recoverExpiredAmbiguousPhases(now: Date) {
    const result = await this.client.instagramPublication.updateMany({
      where: { status: { in: ['CREATING_CONTAINER', 'PUBLISHING'] }, claimedUntil: { lte: now } },
      data: {
        status: 'UNKNOWN', claimToken: null, claimedUntil: null,
        lastError: 'Lease vencido durante una operación externa ambigua.'
      }
    })
    return result.count
  }

  async claimNext(input: { now: Date; leaseUntil: Date; claimToken: string }) {
    return this.client.$transaction(async (tx: PrismaLike) => {
      const candidate = await tx.instagramPublication.findFirst({
        where: {
          status: { in: ['READY', 'CREATING_CONTAINER', 'PROCESSING', 'PUBLISHING'] },
          availableAt: { lte: input.now },
          OR: [{ claimedUntil: null }, { claimedUntil: { lte: input.now } }]
        },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, status: true }
      })
      if (!candidate) return null
      const claimed = await tx.instagramPublication.updateMany({
        where: {
          id: candidate.id, status: candidate.status,
          OR: [{ claimedUntil: null }, { claimedUntil: { lte: input.now } }]
        },
        data: { claimToken: input.claimToken, claimedUntil: input.leaseUntil }
      })
      if (claimed.count !== 1) return null
      const row = await tx.instagramPublication.findUnique({
        where: { id: candidate.id },
        include: { business: { select: { instagramConfig: true } } }
      })
      return row ? mapJob(row) : null
    })
  }

  async transition(input: Parameters<InstagramPublicationWorkerRepository['transition']>[0]) {
    const data: Record<string, unknown> = { ...input.patch, status: input.to }
    if (!input.keepLease) Object.assign(data, { claimToken: null, claimedUntil: null })
    const result = await this.client.instagramPublication.updateMany({
      where: { id: input.id, claimToken: input.claimToken, status: input.from },
      data
    })
    return result.count === 1
  }
}

function mapJob(row: any): InstagramPublicationJob {
  const config = row.business?.instagramConfig
  return {
    id: row.id,
    businessId: row.businessId,
    status: row.status,
    videoObjectPath: row.videoObjectPath,
    videoMimeType: row.videoMimeType,
    videoSizeBytes: row.videoSizeBytes,
    caption: row.caption,
    shareToFeed: row.shareToFeed,
    metaContainerId: row.metaContainerId,
    metaMediaId: row.metaMediaId,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    claimToken: row.claimToken,
    claimedUntil: row.claimedUntil,
    lastError: row.lastError,
    instagramAccountId: config?.enabled ? (config.apiAccountId ?? config.instagramAccountId) : null,
    accessToken: config?.enabled ? config.accessToken : null
  }
}

function isAmbiguousExternalPost(error: unknown) {
  return error instanceof InstagramApiRequestError && error.ambiguous
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Error desconocido al publicar en Instagram.'
}

function backoffMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** Math.max(0, attempts - 1))
}
