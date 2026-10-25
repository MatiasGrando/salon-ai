import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { businessAccessWhere, resolveBusinessScope } from '../services/business-authorization.js'
import { InstagramMediaError, InstagramMediaService, type MediaListOptions } from '../services/instagram-media-service.js'

export async function instagramMediaRoutes(app: FastifyInstance, options: { service?: Pick<InstagramMediaService, 'list' | 'sync' | 'history'> } = {}) {
  const service = options.service ?? new InstagramMediaService()
  app.addHook('preHandler', async (request, reply) => {
    const user = request.auth?.user
    const { businessId } = request.params as { businessId: string }
    if (!user || !['SUPER_ADMIN', 'ACCOUNT_ADMIN', 'BUSINESS_ADMIN'].includes(user.role)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio.' })
    const business = await prisma.business.findFirst({ where: businessAccessWhere(resolveBusinessScope(user), businessId), select: { id: true } })
    if (!business) return reply.status(403).send({ message: 'No tenes acceso a ese comercio.' })
  })
  app.get('/businesses/:businessId/instagram-media', async (request, reply) => {
    try {
      const query = (request.query ?? {}) as Record<string, unknown>
      const listOptions: MediaListOptions = { limit: integer(query.limit, 25, 100), offset: integer(query.offset, 0, 100000, true), sort: 'publishedAt' }
      if (query.sort !== undefined) {
        if (!['publishedAt', 'reach', 'views'].includes(String(query.sort))) throw invalid()
        listOptions.sort = query.sort as MediaListOptions['sort']
      }
      if (query.kind !== undefined) { if (query.kind !== 'REELS') throw invalid(); listOptions.kind = 'REELS' }
      for (const name of ['from', 'to'] as const) {
        if (query[name] !== undefined) {
          const value = query[name]
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw invalid()
          const parsed = new Date(value)
          if (!Number.isFinite(parsed.getTime())) throw invalid()
          const calendarDay = new Date(value.slice(0, 10) + 'T00:00:00.000Z')
          if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)) throw invalid()
          listOptions[name] = parsed
        }
      }
      if (listOptions.from && listOptions.to && listOptions.from > listOptions.to) throw invalid()
      return await service.list((request.params as { businessId: string }).businessId, listOptions)
    } catch (error) { return failure(reply, error) }
  })
  app.post('/businesses/:businessId/instagram-media/sync', async (request, reply) => {
    try {
      if (request.body !== undefined && (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))) throw invalid()
      const continuation = (request.body as { continuation?: unknown } | undefined)?.continuation
      if (continuation !== undefined && (typeof continuation !== 'string' || !/^[a-f0-9-]{36}$/i.test(continuation))) throw invalid()
      return await service.sync((request.params as { businessId: string }).businessId, continuation as string | undefined)
    } catch (error) { return failure(reply, error) }
  })
  app.get('/businesses/:businessId/instagram-media/:mediaId/history', async (request, reply) => {
    try {
      const { businessId, mediaId } = request.params as { businessId: string; mediaId: string }
      const query = (request.query ?? {}) as Record<string, unknown>
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(mediaId)) throw invalid()
      return await service.history(businessId, mediaId, integer(query.limit, 25, 100), integer(query.offset, 0, 100000, true))
    } catch (error) { return failure(reply, error) }
  })
}
function integer(value: unknown, fallback: number, max: number, zero = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw invalid()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < (zero ? 0 : 1) || parsed > max) throw invalid()
  return parsed
}
function invalid() { return new InstagramMediaError(400, 'Los filtros o la continuacion no son validos.') }
function failure(reply: any, error: unknown) {
  return error instanceof InstagramMediaError ? reply.status(error.statusCode).send({ message: error.message })
    : reply.status(503).send({ message: 'No pude consultar o guardar el catalogo de Instagram. Volve a intentar.' })
}
