import type { FastifyInstance } from 'fastify'
import {
  InstagramPublicationConflictError,
  InstagramPublicationNotFoundError,
  InstagramPublicationService,
  InstagramPublicationValidationError,
  type CreateInstagramPublicationDraft,
  type UpdateInstagramPublicationDraft
} from '../services/instagram-publication-service.js'
import {
  createInstagramReelUpload,
  deleteInstagramReelVideo,
  verifyAndSignInstagramReelVideo
} from '../services/instagram-video-storage-service.js'
import { publishInstagramPublicationChanged } from '../services/crm-realtime-events.js'

type PublicationServiceContract = Pick<
  InstagramPublicationService,
  'createDraft' | 'list' | 'get' | 'updateDraft' | 'publish' | 'markVideoDeleted'
>

type ReelStorageContract = {
  createUpload(input: { businessId: string; mimeType: string; sizeBytes: number }): Promise<unknown>
  verifyUpload(input: {
    businessId: string
    objectPath: string
    expectedMimeType: string
    expectedSizeBytes: number
  }): Promise<unknown>
  deleteVideo(input: { businessId: string; objectPath: string }): Promise<void>
}

export async function instagramPublicationRoutes(
  app: FastifyInstance,
  options: {
    service?: PublicationServiceContract
    storage?: ReelStorageContract
    runtimeReady?: boolean
    allowedBusinessIds?: readonly string[]
  } = {}
) {
  const service = options.service ?? new InstagramPublicationService()
  const storage = options.storage ?? {
    createUpload: createInstagramReelUpload,
    verifyUpload: verifyAndSignInstagramReelVideo,
    deleteVideo: deleteInstagramReelVideo
  }
  const runtimeReady = options.runtimeReady ?? Boolean(options.service)
  const verifyDraftVideos = options.storage !== undefined || options.runtimeReady === true

  const allowedBusinessIds = options.allowedBusinessIds ? new Set(options.allowedBusinessIds) : null
  app.addHook('preHandler', async (request, reply) => {
    if (!runtimeReady) {
      return reply.status(503).send({
        message: 'Las publicaciones de Instagram no están habilitadas o su almacenamiento todavía no está disponible.'
      })
    }
    const businessId = (request.params as { businessId?: string }).businessId
    if (businessId && allowedBusinessIds && !allowedBusinessIds.has(businessId)) {
      return reply.status(404).send({ message: 'Publicaciones de Instagram no disponibles para este comercio.' })
    }
  })

  app.post('/businesses/:businessId/instagram-publications/uploads', async (request, reply) => {
    const { businessId } = request.params as { businessId: string }
    const body = object(request.body)
    const mimeType = string(body.mimeType)
    const sizeBytes = number(body.sizeBytes)
    if (!mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return reply.status(400).send({ message: 'El tipo y tamaño del video son obligatorios.' })
    }
    try {
      const upload = await storage.createUpload({ businessId, mimeType, sizeBytes })
      return reply.status(201).send(upload)
    } catch (error) {
      return sendUploadError(reply, error)
    }
  })

  app.post('/businesses/:businessId/instagram-publications/uploads/verify', async (request, reply) => {
    const { businessId } = request.params as { businessId: string }
    const body = object(request.body)
    const objectPath = string(body.objectPath)
    const mimeType = string(body.mimeType)
    const sizeBytes = number(body.sizeBytes)
    if (!objectPath || !mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return reply.status(400).send({ message: 'La ruta, el tipo y el tamaño del video son obligatorios.' })
    }
    try {
      const verified = await storage.verifyUpload({
        businessId,
        objectPath,
        expectedMimeType: mimeType,
        expectedSizeBytes: sizeBytes
      }) as { mimeType?: unknown; sizeBytes?: unknown }
      return {
        verified: true,
        objectPath,
        mimeType: verified.mimeType,
        sizeBytes: verified.sizeBytes
      }
    } catch (error) {
      return sendUploadError(reply, error)
    }
  })

  app.post('/businesses/:businessId/instagram-publications', async (request, reply) => {
    const { businessId } = request.params as { businessId: string }
    const input = createInput(businessId, request.body)
    try {
      if (verifyDraftVideos) await verifyDraftVideo(storage, input)
      const publication = await service.createDraft(input)
      return reply.status(201).send(publication)
    } catch (error) {
      if (isUploadValidationError(error)) return sendUploadError(reply, error)
      return sendPublicationError(reply, error)
    }
  })

  app.get('/businesses/:businessId/instagram-publications', async (request) => {
    const { businessId } = request.params as { businessId: string }
    return service.list(businessId)
  })

  app.get('/businesses/:businessId/instagram-publications/:publicationId', async (request, reply) => {
    const { businessId, publicationId } = request.params as { businessId: string; publicationId: string }
    try {
      return await service.get(businessId, publicationId)
    } catch (error) {
      return sendPublicationError(reply, error)
    }
  })

  app.patch('/businesses/:businessId/instagram-publications/:publicationId', async (request, reply) => {
    const { businessId, publicationId } = request.params as { businessId: string; publicationId: string }
    const patch = updateInput(request.body)
    try {
      if (verifyDraftVideos && hasVideoPatch(patch)) {
        const current = await service.get(businessId, publicationId) as CreateInstagramPublicationDraft
        await verifyDraftVideo(storage, {
          ...current,
          ...patch,
          automation: current.automation
        })
      }
      return await service.updateDraft(businessId, publicationId, patch)
    } catch (error) {
      if (isUploadValidationError(error)) return sendUploadError(reply, error)
      return sendPublicationError(reply, error)
    }
  })

  app.post('/businesses/:businessId/instagram-publications/:publicationId/publish', async (request, reply) => {
    const { businessId, publicationId } = request.params as { businessId: string; publicationId: string }
    try {
      const publication = await service.publish(businessId, publicationId)
      publishInstagramPublicationChanged({
        businessId,
        publicationId,
        status: publication.status,
        updatedAt: new Date().toISOString()
      })
      return reply.status(202).send(publication)
    } catch (error) {
      return sendPublicationError(reply, error)
    }
  })

  app.delete('/businesses/:businessId/instagram-publications/:publicationId/video', async (request, reply) => {
    const { businessId, publicationId } = request.params as { businessId: string; publicationId: string }
    try {
      const current = await service.get(businessId, publicationId)
      if (current.videoAvailable === false) {
        throw new InstagramPublicationConflictError('El video ya fue eliminado del almacenamiento.')
      }
      if (!['PUBLISHED', 'FAILED', 'UNKNOWN'].includes(current.status)) {
        throw new InstagramPublicationConflictError('Esperá a que finalice la publicación antes de borrar el video almacenado.')
      }
      try {
        await storage.deleteVideo({ businessId, objectPath: current.videoObjectPath })
      } catch (error) {
        return sendUploadError(reply, error)
      }
      const publication = await service.markVideoDeleted(businessId, publicationId)
      publishInstagramPublicationChanged({
        businessId,
        publicationId,
        status: publication.status,
        updatedAt: new Date().toISOString()
      })
      return publication
    } catch (error) {
      if (isUploadValidationError(error)) return sendUploadError(reply, error)
      return sendPublicationError(reply, error)
    }
  })
}

function createInput(businessId: string, raw: unknown): CreateInstagramPublicationDraft {
  const body = object(raw)
  const automation = object(body.automation)
  return {
    businessId,
    videoObjectPath: string(body.videoObjectPath),
    videoMimeType: string(body.videoMimeType),
    videoSizeBytes: number(body.videoSizeBytes),
    caption: string(body.caption),
    shareToFeed: boolean(body.shareToFeed, true),
    automation: {
      enabled: boolean(automation.enabled, true),
      privateReplyText: string(automation.privateReplyText),
      keywords: Array.isArray(automation.keywords) ? automation.keywords.filter((value): value is string => typeof value === 'string') : []
    }
  }
}

function updateInput(raw: unknown): UpdateInstagramPublicationDraft {
  const body = object(raw)
  const patch: UpdateInstagramPublicationDraft = {}
  if ('videoObjectPath' in body) patch.videoObjectPath = string(body.videoObjectPath)
  if ('videoMimeType' in body) patch.videoMimeType = string(body.videoMimeType)
  if ('videoSizeBytes' in body) patch.videoSizeBytes = number(body.videoSizeBytes)
  if ('caption' in body) patch.caption = string(body.caption)
  if ('shareToFeed' in body) patch.shareToFeed = boolean(body.shareToFeed, true)
  if ('automation' in body) {
    const automation = object(body.automation)
    patch.automation = {}
    if ('enabled' in automation) patch.automation.enabled = boolean(automation.enabled, true)
    if ('privateReplyText' in automation) patch.automation.privateReplyText = string(automation.privateReplyText)
    if ('keywords' in automation) {
      patch.automation.keywords = Array.isArray(automation.keywords)
        ? automation.keywords.filter((value): value is string => typeof value === 'string')
        : []
    }
  }
  return patch
}

function sendPublicationError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown) {
  if (error instanceof InstagramPublicationValidationError) {
    return reply.status(400).send({ message: error.message, errors: error.errors })
  }
  if (error instanceof InstagramPublicationNotFoundError) return reply.status(404).send({ message: error.message })
  if (error instanceof InstagramPublicationConflictError) return reply.status(409).send({ message: error.message })
  throw error
}

function sendUploadError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown) {
  if (isUploadValidationError(error)) {
    return reply.status(400).send({ message: error.message })
  }
  return reply.status(503).send({
    message: 'No se pudo acceder al almacenamiento de videos de Instagram. Intentá nuevamente.'
  })
}

function isUploadValidationError(error: unknown): error is Error {
  return error instanceof Error
    && /tipo de video|tamaño declarado|identificador del comercio|ruta del video|no pertenece|no coincide/i.test(error.message)
}

function hasVideoPatch(patch: UpdateInstagramPublicationDraft) {
  return patch.videoObjectPath !== undefined
    || patch.videoMimeType !== undefined
    || patch.videoSizeBytes !== undefined
}

async function verifyDraftVideo(storage: ReelStorageContract, input: {
  businessId: string
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
}) {
  await storage.verifyUpload({
    businessId: input.businessId,
    objectPath: input.videoObjectPath,
    expectedMimeType: input.videoMimeType,
    expectedSizeBytes: input.videoSizeBytes
  })
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  return typeof value === 'number' ? value : Number.NaN
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}
