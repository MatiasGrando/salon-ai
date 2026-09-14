import { prisma } from '../config/prisma.js'
import { instagramReelStorageConfig } from '../config/instagram.js'
import { InstagramApi } from '../integrations/instagram-api.js'
import { deleteInstagramReelVideo, verifyAndSignInstagramReelVideo } from './instagram-video-storage-service.js'
import {
  InstagramCommentWorker,
  PrismaInstagramCommentWorkerStore
} from './instagram-comment-worker.js'
import {
  InstagramPublicationWorker,
  PrismaInstagramPublicationWorkerRepository
} from './instagram-publication-worker.js'
import {
  InstagramVideoRetentionWorker,
  PrismaInstagramVideoRetentionRepository
} from './instagram-video-retention-worker.js'

const DEFAULT_INTERVAL_MS = 5000

type PublicationWorker = { runOnce(): Promise<unknown> }
type CommentWorker = { processOne(): Promise<unknown> }
type RetentionWorker = { runOnce(): Promise<unknown> }

export function resolveInstagramReelsRuntimeConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return {
    enabled: env.INSTAGRAM_REELS_ENABLED?.trim().toLowerCase() === 'true',
    intervalMs: positiveInteger(env.INSTAGRAM_REELS_WORKER_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    businessIds: uniqueCsv(env.INSTAGRAM_REELS_BUSINESS_IDS)
  }
}

export function startInstagramReelsWorkerRuntime(input: {
  intervalMs: number
  publicationWorker: PublicationWorker
  commentWorker: CommentWorker
  retentionWorker: RetentionWorker
  onError(error: Error): void
}) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null

  const tick = async () => {
    const outcomes = await Promise.allSettled([
      input.publicationWorker.runOnce(),
      input.commentWorker.processOne(),
      input.retentionWorker.runOnce()
    ])
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        const worker = index === 0 ? 'publicaciones' : index === 1 ? 'comentarios' : 'retención de videos'
        input.onError(new Error(`Falló el worker de Instagram (${worker}).`))
      }
    }
  }

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(run, input.intervalMs)
  }
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => {
      inFlight = null
      schedule()
    })
  }

  run()
  return {
    isRunning: () => !stopped,
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await inFlight
    }
  }
}

export async function createInstagramReelsRuntime(input: {
  config?: { enabled: boolean; intervalMs: number; businessIds?: string[] }
  client?: Record<string, any>
  api?: InstagramApi
  storageReady?: boolean
  onError(error: Error): void
}) {
  const config = input.config ?? resolveInstagramReelsRuntimeConfig(process.env)
  if (!config.enabled) {
    return { ready: false as const, businessIds: [] as string[], start: () => undefined, stop: async () => undefined }
  }

  const businessIds = config.businessIds ?? []
  if (!businessIds.length) {
    input.onError(new Error('Instagram Reels está habilitado, pero no tiene comercios autorizados.'))
    return { ready: false as const, businessIds, start: () => undefined, stop: async () => undefined }
  }

  if (!(input.storageReady ?? Boolean(instagramReelStorageConfig()))) {
    input.onError(new Error('Instagram Reels está habilitado, pero su almacenamiento no está listo.'))
    return { ready: false as const, businessIds, start: () => undefined, stop: async () => undefined }
  }

  const client = input.client ?? prisma as unknown as Record<string, any>
  try {
    if (!client.instagramPublication?.count || !client.instagramCommentExecution?.count) {
      throw new Error('Prisma no contiene los modelos de Instagram Reels.')
    }
    await Promise.all([
      client.instagramPublication.count(),
      client.instagramCommentExecution.count()
    ])
  } catch {
    input.onError(new Error('Instagram Reels está habilitado, pero su base de datos no está lista.'))
    return { ready: false as const, businessIds, start: () => undefined, stop: async () => undefined }
  }

  const api = input.api ?? new InstagramApi()
  const publicationWorker = new InstagramPublicationWorker({
    repository: new PrismaInstagramPublicationWorkerRepository(client, businessIds),
    api,
    videoUrls: {
      async createTemporaryHttpsUrl(video) {
        const signed = await verifyAndSignInstagramReelVideo({
          businessId: video.businessId,
          objectPath: video.objectPath,
          expectedMimeType: video.mimeType,
          expectedSizeBytes: video.sizeBytes
        })
        return signed.signedUrl
      }
    }
  })
  const commentWorker = new InstagramCommentWorker(
    new PrismaInstagramCommentWorkerStore(client as any, businessIds),
    api
  )
  const retentionWorker = new InstagramVideoRetentionWorker({
    repository: new PrismaInstagramVideoRetentionRepository(client, businessIds),
    storage: {
      delete(video) {
        return deleteInstagramReelVideo({ businessId: video.businessId, objectPath: video.objectPath })
      }
    }
  })
  let loop: ReturnType<typeof startInstagramReelsWorkerRuntime> | null = null
  return {
    ready: true as const,
    businessIds,
    start() {
      loop ??= startInstagramReelsWorkerRuntime({
        intervalMs: config.intervalMs,
        publicationWorker,
        commentWorker,
        retentionWorker,
        onError: input.onError
      })
    },
    async stop() { await loop?.stop() }
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function uniqueCsv(value: string | undefined) {
  return [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))]
}
