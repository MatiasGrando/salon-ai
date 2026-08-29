import type { FastifyInstance } from 'fastify'
import type { DispatchPauseHandle } from '../bot-options/infrastructure/prisma-activation.js'
import { prisma } from '../config/prisma.js'
import { businessBotRoutingService, type BusinessBotRoutingService } from '../services/business-bot-routing-service.js'
import { loadAuthorizedBusiness } from '../services/tenant-resource-authorization.js'

type RoutingRouteOptions = { service?: BusinessBotRoutingService }
const CONFIRMATION = 'CONFIRM_ROUTING_CHANGE'

export async function businessBotRoutingRoutes(app: FastifyInstance, options: RoutingRouteOptions = {}) {
  const service = options.service ?? businessBotRoutingService

  app.get('/crm/bot-routing', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const actor = await authorizedActor(request, query.businessId)
    if (!actor.ok) return reply.status(actor.status).send({ message: actor.message })
    return service.state({ businessId: actor.businessId })
  })

  app.post('/crm/bot-routing/preflight', async (request, reply) => {
    const body = request.body as { businessId?: string; expectedGeneration?: number; target?: string }
    const actor = await authorizedActor(request, body.businessId)
    if (!actor.ok) return reply.status(actor.status).send({ message: actor.message })
    if (!Number.isInteger(body.expectedGeneration) || !body.target?.trim()) return reply.status(400).send({ message: 'Preflight de routing inválido' })
    try {
      const result = await service.preflight({ businessId: actor.businessId, expectedGeneration: body.expectedGeneration!, target: body.target.trim(), actorId: actor.actorId })
      return serializeRoutingResult(result)
    } catch (error) {
      return reply.status(409).send({ message: error instanceof Error ? error.message : 'No se pudo ejecutar el preflight' })
    }
  })

  app.post('/crm/bot-routing/configurations/default', async (request, reply) => {
    const body = request.body as { businessId?: string; timezone?: string }
    const actor = await authorizedActor(request, body.businessId)
    if (!actor.ok) return reply.status(actor.status).send({ message: actor.message })
    if (!body.timezone?.trim()) return reply.status(400).send({ message: 'Seleccioná la zona horaria del comercio' })
    try {
      return await service.prepare({ businessId: actor.businessId, timezone: body.timezone.trim(), actorId: actor.actorId })
    } catch (error) {
      return reply.status(409).send({ message: error instanceof Error ? error.message : 'No se pudo preparar F11' })
    }
  })

  app.post('/crm/bot-routing/commit', async (request, reply) => {
    const body = request.body as { businessId?: string; target?: string; confirmation?: string; handle?: SerializedPauseHandle }
    const actor = await authorizedActor(request, body.businessId)
    if (!actor.ok) return reply.status(actor.status).send({ message: actor.message })
    if (body.confirmation !== CONFIRMATION || !body.target?.trim() || !validHandle(body.handle, actor.businessId)) {
      return reply.status(400).send({ message: 'Confirmación de routing inválida' })
    }
    try {
      return await service.commit({ businessId: actor.businessId, target: body.target.trim(), handle: deserializeHandle(body.handle), actorId: actor.actorId })
    } catch (error) {
      return reply.status(409).send({ message: error instanceof Error ? error.message : 'No se pudo cambiar el routing' })
    }
  })

  app.post('/crm/bot-routing/abort', async (request, reply) => {
    const body = request.body as { businessId?: string; handle?: SerializedPauseHandle }
    const actor = await authorizedActor(request, body.businessId)
    if (!actor.ok) return reply.status(actor.status).send({ message: actor.message })
    if (!validHandle(body.handle, actor.businessId)) return reply.status(400).send({ message: 'Pausa de routing inválida' })
    try {
      await service.abort({ businessId: actor.businessId, handle: deserializeHandle(body.handle), actorId: actor.actorId })
      return { kind: 'ABORTED' }
    } catch (error) {
      return reply.status(409).send({ message: error instanceof Error ? error.message : 'No se pudo reanudar el routing' })
    }
  })
}

type SerializedPauseHandle = Omit<DispatchPauseHandle, 'pausedAt'> & { pausedAt: string }

async function authorizedActor(request: { auth?: { user: { id: string; role: string; businessId?: string | null } } }, requestedBusinessId?: string) {
  const user = request.auth?.user
  if (!user) return { ok: false as const, status: 401, message: 'Necesitás iniciar sesión' }
  if (user.role === 'STAFF') return { ok: false as const, status: 403, message: 'No tenés permiso para cambiar el routing del bot' }
  const businessId = requestedBusinessId?.trim() || user.businessId?.trim()
  if (!businessId) return { ok: false as const, status: 400, message: 'Seleccioná un comercio' }
  if (user.role !== 'SUPER_ADMIN' && user.businessId !== businessId) {
    if (user.role !== 'ACCOUNT_ADMIN' || !await loadAuthorizedBusiness(prisma, user as never, businessId)) {
      return { ok: false as const, status: 403, message: 'No tenés acceso a ese comercio' }
    }
  }
  return { ok: true as const, businessId, actorId: user.id }
}

function validHandle(handle: SerializedPauseHandle | undefined, businessId: string): handle is SerializedPauseHandle {
  return Boolean(handle && handle.businessId === businessId && handle.deploymentId && Number.isInteger(handle.generation)
    && Number.isInteger(handle.fenceEpoch) && typeof handle.pausedAt === 'string' && !Number.isNaN(Date.parse(handle.pausedAt)))
}

function deserializeHandle(handle: SerializedPauseHandle): DispatchPauseHandle {
  return { ...handle, pausedAt: new Date(handle.pausedAt) }
}

function serializeRoutingResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as T
}
