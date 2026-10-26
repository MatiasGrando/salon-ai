import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { InstagramAutomationError, InstagramCommentAutomationService } from '../services/instagram-comment-automation-service.js'

export async function instagramCommentAutomationRoutes(app: FastifyInstance, options: {
  service?: Pick<InstagramCommentAutomationService, 'get' | 'save'>; runtimeReady?: boolean; allowedBusinessIds?: readonly string[]
} = {}) {
  const service = options.service ?? new InstagramCommentAutomationService(prisma)
  app.addHook('preHandler', async (request, reply) => {
    const { businessId } = request.params as { businessId: string }
    if (!options.runtimeReady) return reply.status(503).send({ message: 'Automatizaciones de comentarios no disponibles.' })
    if (options.allowedBusinessIds && !options.allowedBusinessIds.includes(businessId)) return reply.status(404).send({ message: 'Automatizaciones no disponibles para este comercio.' })
  })
  for (const type of ['media', 'publications'] as const) {
    for (const method of ['GET', 'PATCH'] as const) {
      app.route({ method, url: '/businesses/:businessId/instagram-' + type + '/:targetId/automation',
        async handler(request, reply) {
          const { businessId, targetId } = request.params as { businessId: string; targetId: string }
          const target = type === 'media' ? { mediaId: targetId } : { publicationId: targetId }
          try { return method === 'GET' ? await service.get(businessId, target) : await service.save(businessId, target, request.body) }
          catch (error) {
            if (error instanceof InstagramAutomationError) return reply.status(error.statusCode).send({ message: error.message })
            return reply.status(503).send({ message: 'No se pudo guardar o leer la automatizacion de Instagram.' })
          }
        }
      })
    }
  }
}
