import type { FastifyInstance } from 'fastify'
import { InstagramCalendarService } from '../services/instagram-calendar-service.js'
import { InstagramDuplicationService } from '../services/instagram-duplication-service.js'
import { InstagramPublicationConflictError, InstagramPublicationNotFoundError, InstagramPublicationValidationError } from '../services/instagram-publication-service.js'

export async function instagramCalendarRoutes(app: FastifyInstance, options: {
  calendar?: Pick<InstagramCalendarService, 'list' | 'resolveTime'>; duplication?: Pick<InstagramDuplicationService, 'duplicate'>
  runtimeReady?: boolean; allowedBusinessIds?: readonly string[]
} = {}) {
  const calendar = options.calendar ?? new InstagramCalendarService()
  const duplication = options.duplication ?? new InstagramDuplicationService()
  const runtimeReady = options.runtimeReady ?? Boolean(options.duplication)
  app.get('/businesses/:businessId/instagram-calendar', async (request, reply) => {
    try { return await calendar.list((request.params as { businessId: string }).businessId, request.query as Record<string, unknown>) }
    catch (error) { return failure(reply, error) }
  })
  app.get('/businesses/:businessId/instagram-calendar/time-options', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    try { return await calendar.resolveTime((request.params as { businessId: string }).businessId, query.date, Number(query.minute)) }
    catch (error) { return failure(reply, error) }
  })
  for (const kind of ['media', 'publications']) app.post('/businesses/:businessId/instagram-' + kind + '/:targetId/duplicate', async (request, reply) => {
    const { businessId, targetId } = request.params as { businessId: string; targetId: string }
    if (!runtimeReady) return reply.status(503).send({ message: 'La copia de videos de Instagram no está habilitada o su almacenamiento no está disponible.' })
    if (options.allowedBusinessIds && !options.allowedBusinessIds.includes(businessId)) return reply.status(404).send({ message: 'Publicaciones de Instagram no disponibles para este comercio.' })
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}
    try { return await duplication.duplicate(businessId, kind === 'media' ? { mediaId: targetId } : { publicationId: targetId }, body.expectedRevision) }
    catch (error) { return failure(reply, error) }
  })
}

function failure(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown) {
  const code = error instanceof InstagramPublicationValidationError ? 400 : error instanceof InstagramPublicationConflictError ? 409 : error instanceof InstagramPublicationNotFoundError ? 404 : 503
  return reply.status(code).send({ message: code === 503 ? 'No se pudo completar esta operación de Instagram.' : (error as Error).message })
}
