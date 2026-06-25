import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getAuthFromRequest, type AuthContext } from '../services/auth-service.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export async function authGuard(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    request.auth = auth
    injectUserBusinessId(request, auth)
    if (!canAccessRequestedBusiness(request, auth)) {
      return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    }
  })
}

export function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.auth?.user.role !== 'SUPER_ADMIN') {
    reply.status(403).send({ message: 'Solo el super admin puede hacer esta accion' })
    return false
  }
  return true
}

function injectUserBusinessId(request: FastifyRequest, auth: AuthContext) {
  if (auth.user.role === 'SUPER_ADMIN' || !auth.user.businessId) return
  if (request.query && typeof request.query === 'object' && !('businessId' in request.query)) {
    ;(request.query as { businessId?: string }).businessId = auth.user.businessId
  }
  if (request.body && typeof request.body === 'object' && !('businessId' in request.body)) {
    ;(request.body as { businessId?: string }).businessId = auth.user.businessId
  }
}

function canAccessRequestedBusiness(request: FastifyRequest, auth: AuthContext) {
  if (auth.user.role === 'SUPER_ADMIN') return true
  const allowedBusinessId = auth.user.businessId
  if (!allowedBusinessId) return false

  const requestedBusinessIds = new Set<string>()
  collectBusinessId(request.params, requestedBusinessIds)
  collectBusinessId(request.query, requestedBusinessIds)
  collectBusinessId(request.body, requestedBusinessIds)

  if (requestedBusinessIds.size === 0) return true
  return [...requestedBusinessIds].every((businessId) => businessId === allowedBusinessId)
}

function collectBusinessId(source: unknown, result: Set<string>) {
  if (!source || typeof source !== 'object') return
  const value = (source as { businessId?: unknown }).businessId
  if (typeof value === 'string' && value.trim()) result.add(value.trim())
}
