import type { FastifyInstance, FastifyRequest } from 'fastify'
import { instagramConfig } from '../config/instagram.js'
import { prisma } from '../config/prisma.js'
import { InstagramApi } from '../integrations/instagram-api.js'

const instagramApi = new InstagramApi()

export async function instagramSettingsRoutes(app: FastifyInstance) {
  app.get('/businesses/:id/instagram-settings', async (request, reply) => {
    const params = request.params as { id: string }
    if (!canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const business = await prisma.business.findUnique({
      where: { id: params.id },
      select: { id: true, publicWhatsapp: true, instagramConfig: true }
    })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    return presentSettings(business.instagramConfig, business.publicWhatsapp)
  })

  app.patch('/businesses/:id/instagram-settings', async (request, reply) => {
    const params = request.params as { id: string }
    if (!canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const body = request.body as {
      instagramAccountId?: string
      username?: string | null
      accessToken?: string
      tokenExpiresAt?: string | null
      enabled?: boolean
    }
    const business = await prisma.business.findUnique({
      where: { id: params.id },
      select: { id: true, publicWhatsapp: true, instagramConfig: true }
    })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })

    const instagramAccountId = normalizeText(body.instagramAccountId) ?? business.instagramConfig?.instagramAccountId
    const accessToken = normalizeText(body.accessToken) ?? business.instagramConfig?.accessToken
    if (!instagramAccountId) return reply.status(400).send({ message: 'Completa el Instagram Account ID.' })
    if (!accessToken) return reply.status(400).send({ message: 'Completa el token de acceso de Instagram.' })

    let account: Awaited<ReturnType<InstagramApi['getAccount']>>
    try {
      account = await instagramApi.getAccountById({ accountId: instagramAccountId, accessToken })
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'No pude validar el token de Instagram.' })
    }

    const tokenExpiresAt = parseOptionalDate(body.tokenExpiresAt)
    if (body.tokenExpiresAt !== undefined && body.tokenExpiresAt !== null && body.tokenExpiresAt !== '' && tokenExpiresAt === undefined) {
      return reply.status(400).send({ message: 'La fecha de vencimiento del token no es valida.' })
    }
    const username = account.username ?? normalizeText(body.username) ?? business.instagramConfig?.username ?? null
    const settings = await prisma.businessInstagramConfig.upsert({
      where: { businessId: params.id },
      update: {
        instagramAccountId,
        apiAccountId: account.id,
        username,
        ...(body.accessToken ? { accessToken } : {}),
        ...(body.tokenExpiresAt !== undefined ? { tokenExpiresAt: tokenExpiresAt ?? null } : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        connectedAt: new Date(),
        lastError: business.publicWhatsapp ? null : 'Falta cargar el WhatsApp publico del comercio para derivar reservas.'
      },
      create: {
        businessId: params.id,
        instagramAccountId,
        apiAccountId: account.id,
        username,
        accessToken,
        tokenExpiresAt: tokenExpiresAt ?? null,
        enabled: body.enabled ?? true,
        connectedAt: new Date(),
        lastError: business.publicWhatsapp ? null : 'Falta cargar el WhatsApp publico del comercio para derivar reservas.'
      }
    })
    return presentSettings(settings, business.publicWhatsapp)
  })

  app.post('/businesses/:id/instagram-settings/test', async (request, reply) => {
    const params = request.params as { id: string }
    if (!canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const settings = await prisma.businessInstagramConfig.findUnique({ where: { businessId: params.id } })
    if (!settings?.accessToken) return reply.status(409).send({ message: 'Instagram todavia no esta conectado.' })
    try {
      const account = await instagramApi.getAccount({ accessToken: settings.accessToken })
      await prisma.businessInstagramConfig.update({
        where: { businessId: params.id },
        data: { apiAccountId: account.id, username: account.username, lastError: null }
      })
      return { ok: true, account }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pude validar Instagram.'
      await prisma.businessInstagramConfig.update({ where: { businessId: params.id }, data: { lastError: message } })
      return reply.status(400).send({ message })
    }
  })
}

function presentSettings(
  settings: {
    instagramAccountId: string
    apiAccountId: string | null
    username: string | null
    accessToken: string | null
    tokenExpiresAt: Date | null
    enabled: boolean
    connectedAt: Date | null
    lastError: string | null
  } | null,
  publicWhatsapp: string | null
) {
  return {
    connection: settings
      ? {
          connected: Boolean(settings.instagramAccountId && settings.accessToken),
          instagramAccountId: settings.instagramAccountId,
          username: settings.username,
          hasAccessToken: Boolean(settings.accessToken),
          tokenExpiresAt: settings.tokenExpiresAt,
          connectedAt: settings.connectedAt,
          lastError: settings.lastError
        }
      : {
          connected: false,
          instagramAccountId: null,
          username: null,
          hasAccessToken: false,
          tokenExpiresAt: null,
          connectedAt: null,
          lastError: null
        },
    enabled: settings?.enabled ?? false,
    redirectReady: Boolean(String(publicWhatsapp ?? '').replace(/\D/g, '')),
    webhook: {
      callbackPath: '/webhooks/instagram',
      verifyToken: instagramConfig.verifyToken
    }
  }
}

function canAccessBusiness(request: FastifyRequest, businessId: string) {
  const user = request.auth?.user
  return Boolean(user && (user.role === 'SUPER_ADMIN' || user.businessId === businessId))
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function parseOptionalDate(value: unknown) {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
