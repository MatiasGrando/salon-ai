import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getAuthFromRequest, type AuthContext } from '../services/auth-service.js'
import { prisma } from '../config/prisma.js'
import { canStaffAccessRoute, staffAuditAction } from '../services/staff-permission-service.js'
import { businessAccountAccessMessage, isBusinessAccountUnavailable } from '../services/business-account-access.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export async function authGuard(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (isPublicRoute(request)) return

    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    request.auth = auth
    if (['BUSINESS_ADMIN', 'STAFF'].includes(auth.user.role) && isBusinessAccountUnavailable(auth.user.businessAccountStatus)) {
      return reply.status(423).send({
        message: businessAccountAccessMessage(auth.user.businessAccountStatus),
        accountStatus: auth.user.businessAccountStatus
      })
    }
    if (auth.user.role === 'ACCOUNT_ADMIN' && !isAccountAdminRoute(request, auth)) {
      return reply.status(403).send({ message: 'Tu cuenta solo tiene acceso al tablero de alta de locales' })
    }
    injectUserBusinessId(request, auth)
    injectStaffAgendaScope(request, auth)
    if (!await canAccessRequestedBusiness(request, auth)) {
      return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    }
    if (!canStaffAccessRoute(auth.user, request.method, request.url)) {
      return reply.status(403).send({ message: 'Tu perfil no tiene permiso para realizar esta accion' })
    }
  })

  app.addHook('onResponse', async (request, reply) => {
    const user = request.auth?.user
    if (!user || user.role !== 'STAFF' || !user.businessId || request.method.toUpperCase() === 'GET' || reply.statusCode >= 400) return
    const params = request.params as { id?: string; customerId?: string } | undefined
    const path = request.url.split('?')[0] || '/'
    const entityType = path.split('/').filter(Boolean)[0] || 'unknown'
    await prisma.staffAuditLog.create({
      data: {
        businessId: user.businessId,
        userId: user.id,
        action: staffAuditAction(request.method, path),
        entityType,
        entityId: params?.id || params?.customerId || null,
        method: request.method.toUpperCase(),
        path
      }
    }).catch((error) => request.log.error(error, 'No se pudo registrar la auditoria del staff'))
  })
}

function isAccountAdminRoute(request: FastifyRequest, auth: AuthContext) {
  if (auth.user.businessId) return true
  const path = request.url.split('?')[0] || ''
  const method = request.method.toUpperCase()
  if (method === 'GET' && path === '/businesses') return true
  if (method === 'GET' && path === '/admin/demo-profiles') return true
  if (method === 'GET' && /^\/admin\/demo-profiles\/[^/]+\/preview$/.test(path)) return true
  if (method === 'GET' && /^\/admin\/demo-profiles\/[^/]+\/access$/.test(path)) return true
  if (method === 'POST' && /^\/admin\/demo-profiles\/[^/]+\/chat$/.test(path)) return true
  return isAccountAdminDemoWorkspaceRoute(method, path)
}

function isAccountAdminDemoWorkspaceRoute(method: string, path: string) {
  if (path === '/businesses') return method === 'GET'
  return path === '/business-hours'
    || path === '/business-hours/setup'
    || path === '/crm/ai-settings'
    || path === '/professionals'
    || /^\/professionals\/[^/]+(?:\/status|\/appointments-impact)?$/.test(path)
    || path === '/service-categories'
    || /^\/service-categories\/[^/]+$/.test(path)
    || path === '/services'
    || /^\/services\/[^/]+$/.test(path)
    || /^\/businesses\/[^/]+$/.test(path)
    || /^\/businesses\/[^/]+\/(?:payment-settings|whatsapp-settings|instagram-settings)$/.test(path)
}

export function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.auth?.user.role !== 'SUPER_ADMIN') {
    reply.status(403).send({ message: 'Solo el super admin puede hacer esta accion' })
    return false
  }
  return true
}

function injectStaffAgendaScope(request: FastifyRequest, auth: AuthContext) {
  if (auth.user.role !== 'STAFF' || auth.user.agendaScope !== 'OWN' || !auth.user.professionalId) return
  const path = request.url.split('?')[0] || ''
  if (request.method.toUpperCase() !== 'GET' || !['/appointments', '/schedule-blocks', '/schedule-blocks/impact'].includes(path)) return
  if (request.query && typeof request.query === 'object') {
    ;(request.query as { professionalId?: string }).professionalId = auth.user.professionalId
  }
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

async function canAccessRequestedBusiness(request: FastifyRequest, auth: AuthContext) {
  if (auth.user.role === 'SUPER_ADMIN') return true
  const requestedBusinessIds = new Set<string>()
  collectBusinessId(request.params, requestedBusinessIds)
  collectBusinessId(request.query, requestedBusinessIds)
  collectBusinessId(request.body, requestedBusinessIds)
  await collectEntityBusinessId(request, requestedBusinessIds)

  if (auth.user.role === 'ACCOUNT_ADMIN' || auth.user.canCreateBusinesses) {
    if (requestedBusinessIds.size === 0) return true
    const ownedCount = await prisma.business.count({
      where: {
        id: { in: [...requestedBusinessIds] },
        OR: [
          { id: auth.user.businessId || '__NO_BUSINESS__' },
          { isDemo: true, demoType: { in: ['NAILS', 'HAIR_SALON'] } }
        ]
      }
    })
    return ownedCount === requestedBusinessIds.size
  }
  const allowedBusinessId = auth.user.businessId
  if (!allowedBusinessId) return false

  if (requestedBusinessIds.size === 0) return true
  return [...requestedBusinessIds].every((businessId) => businessId === allowedBusinessId)
}

async function collectEntityBusinessId(request: FastifyRequest, result: Set<string>) {
  const path = request.url.split('?')[0] || ''
  const params = request.params as { id?: string } | undefined
  const id = params?.id
  if (!id) return

  if (/^\/businesses\/[^/]+/.test(path)) {
    result.add(id)
    return
  }
  const businessId = /^\/professionals\/[^/]+/.test(path)
    ? (await prisma.professional.findUnique({ where: { id }, select: { businessId: true } }))?.businessId
    : /^\/services\/[^/]+/.test(path)
      ? (await prisma.service.findUnique({ where: { id }, select: { businessId: true } }))?.businessId
      : /^\/service-categories\/[^/]+/.test(path)
        ? (await prisma.serviceCategory.findUnique({ where: { id }, select: { businessId: true } }))?.businessId
        : null
  if (businessId) result.add(businessId)
}

function collectBusinessId(source: unknown, result: Set<string>) {
  if (!source || typeof source !== 'object') return
  const value = (source as { businessId?: unknown }).businessId
  if (typeof value === 'string' && value.trim()) result.add(value.trim())
}

function isPublicRoute(request: FastifyRequest) {
  const path = request.url.split('?')[0] ?? ''
  return path === '/'
    || path === '/privacidad'
    || path === '/politicas'
    || path === '/terminos'
    || path === '/health'
    || path === '/crm'
    || path.startsWith('/landing-assets/')
    || isTamaraSitePublicRoute(request, path)
    || path.startsWith('/public/booking/')
    || path.startsWith('/public/weex/')
    || isWeexLeadCampaignPublicRoute(request.method, path)
    || isPublicLandingRoute(request.method, path)
    || path.startsWith('/auth/')
    || path.startsWith('/webhooks/whatsapp')
    || path.startsWith('/webhooks/instagram')
}

function isWeexLeadCampaignPublicRoute(method: string, path: string) {
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) return false
  return path === '/promocion-weex-agosto-2026'
    || path === '/promocion-weex-agosto-2026/'
    || path === '/promocion-weex-agosto-2026/gracias'
}

function isTamaraSitePublicRoute(request: FastifyRequest, path: string) {
  const rawHost = request.headers['x-forwarded-host'] || request.headers.host
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost
  const hostname = host?.split(',')[0]?.trim().split(':')[0]?.toLowerCase()
  if (hostname !== 'tamaragrando.weex.com.ar') return false

  return request.method.toUpperCase() === 'POST' && path === '/contacto'
    || path === '/tamara-grando-profile-dark.png'
    || path === '/tamara-hero-v1.png'
    || path === '/tamara-hero-portrait.jpeg'
    || /^\/experience-0[1-5]\.jpeg$/.test(path)
    || path === '/branding/modo9-emblem-web.jpg'
    || /^\/partners\/(?:all-boys|centro-espanol|chacarita-juniors|deportivo-espanol|deportivo-riestra|san-martin-burzaco|san-telmo|talleres-remedios-escalada)\.png$/.test(path)
    || /^\/partners\/(?:chacarita-juniors|deportivo-espanol|deportivo-riestra)\.svg$/.test(path)
    || /^\/testimonials\/(?:juan-m|florencia-l|ramiro-s|agustin-p|camila-r|nicolas-t)-avatar\.jpg$/.test(path)
}

const internalRouteRoots = new Set([
  'admin',
  'api',
  'appointments',
  'auth',
  'availability',
  'businesses',
  'business-hours',
  'campaign-customer-options',
  'campaign-deliveries',
  'campaign-jobs',
  'campaigns',
  'chat',
  'crm',
  'customers',
  'health',
  'professional-hours',
  'professionals',
  'post-sale',
  'public',
  'reminder-automations',
  'reports',
  'schedule-blocks',
  'services',
  'staff-users',
  'webhooks',
  'whatsapp',
  'whatsapp-pricing',
  'whatsapp-templates'
])

function isPublicLandingRoute(method: string, path: string) {
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) return false
  if (path === '/reservar' || path === '/cuenta') return true

  const match = /^\/([a-z0-9-]+)(?:\/(?:reservar|cuenta))?$/.exec(path)
  if (!match) return false

  return !internalRouteRoots.has(match[1] ?? '')
}
