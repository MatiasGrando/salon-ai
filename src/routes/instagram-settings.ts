import type { FastifyInstance, FastifyRequest } from 'fastify'
import { instagramConfig } from '../config/instagram.js'
import { prisma } from '../config/prisma.js'
import { InstagramApi } from '../integrations/instagram-api.js'

const instagramApi = new InstagramApi()

export async function instagramSettingsRoutes(app: FastifyInstance) {
  app.get('/businesses/:id/instagram-settings', async (request, reply) => {
    const params = request.params as { id: string }
    if (!await canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const business = await prisma.business.findUnique({
      where: { id: params.id },
      select: { id: true, publicWhatsapp: true, instagramConfig: true }
    })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    return presentSettings(business.instagramConfig, business.publicWhatsapp)
  })

  app.patch('/businesses/:id/instagram-settings', async (request, reply) => {
    const params = request.params as { id: string }
    if (!await canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const body = request.body as {
      instagramAccountId?: string
      username?: string | null
      accessToken?: string
      appSecret?: string
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
    const appSecret = body.appSecret?.trim()
    if (appSecret !== undefined && !/^[a-fA-F0-9]{32}$/.test(appSecret)) {
      return reply.status(400).send({ message: 'La clave privada de Instagram debe tener 32 caracteres hexadecimales.' })
    }

    let account: Awaited<ReturnType<InstagramApi['getAccount']>>
    try {
      account = await instagramApi.getAccountById({ accountId: instagramAccountId, accessToken })
    } catch {
      // Provider messages can contain credentials; do not reflect them to the browser.
      return reply.status(400).send({ message: 'No pude comprobar la cuenta configurada de Instagram. Revisa el ID y el token.' })
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
        ...(appSecret !== undefined ? { appSecret } : {}),
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
        appSecret: appSecret ?? null,
        tokenExpiresAt: tokenExpiresAt ?? null,
        enabled: body.enabled ?? true,
        connectedAt: new Date(),
        lastError: business.publicWhatsapp ? null : 'Falta cargar el WhatsApp publico del comercio para derivar reservas.'
      }
    }).catch(() => null)
    if (!settings) {
      return reply.status(500).send({ message: 'No pude guardar la conexion de Instagram. Volve a intentar.' })
    }
    return presentSettings(settings, business.publicWhatsapp, { status: 'verified', checkedAt: new Date() })
  })

  app.post('/businesses/:id/instagram-settings/test', async (request, reply) => {
    const params = request.params as { id: string }
    if (!await canAccessBusiness(request, params.id)) return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    const business = await prisma.business.findUnique({
      where: { id: params.id },
      select: { publicWhatsapp: true, instagramConfig: true }
    })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    const settings = business.instagramConfig
    if (!settings?.accessToken || !settings.instagramAccountId) return reply.status(409).send({ message: 'Instagram todavia no esta conectado.' })
    try {
      const account = await instagramApi.getAccountById({ accountId: settings.instagramAccountId, accessToken: settings.accessToken })
      const updated = await prisma.businessInstagramConfig.update({
        where: { businessId: params.id },
        data: { apiAccountId: account.id, username: account.username }
      })
      return { ok: true, account, ...presentSettings(updated, business.publicWhatsapp, { status: 'verified', checkedAt: new Date() }) }
    } catch {
      return reply.status(400).send({
        message: 'No pude comprobar la cuenta configurada de Instagram. Revisa el ID y el token.',
        ...presentSettings(settings, business.publicWhatsapp, { status: 'failed', checkedAt: new Date() })
      })
    }
  })
}

function presentSettings(
  settings: {
    instagramAccountId: string
    apiAccountId: string | null
    username: string | null
    accessToken: string | null
    appSecret: string | null
    tokenExpiresAt: Date | null
    enabled: boolean
    connectedAt: Date | null
    lastError: string | null
  } | null,
  publicWhatsapp: string | null,
  verification: { status: 'not_checked' | 'verified' | 'failed'; checkedAt: Date | null } = { status: 'not_checked', checkedAt: null }
) {
  return {
    connection: settings
      ? {
          connected: Boolean(settings.instagramAccountId && settings.accessToken),
          instagramAccountId: settings.instagramAccountId,
          username: settings.username,
          hasAccessToken: Boolean(settings.accessToken),
          hasAppSecret: Boolean(settings.appSecret),
          tokenExpiresAt: settings.tokenExpiresAt,
          connectedAt: settings.connectedAt,
          lastError: redactStoredError(settings),
          verification,
          expiry: {
            status: !settings.tokenExpiresAt ? 'unknown' : settings.tokenExpiresAt.getTime() <= Date.now() ? 'declared_expired' : 'declared_future',
            source: 'manual'
          }
        }
      : {
          connected: false,
          instagramAccountId: null,
          username: null,
          hasAccessToken: false,
          hasAppSecret: false,
          tokenExpiresAt: null,
          connectedAt: null,
          lastError: null,
          verification,
          expiry: { status: 'unknown', source: 'manual' }
        },
    // Reading a profile proves none of these permissions or runtime prerequisites.
    capabilities: ['insights', 'publishing', 'comments', 'messages'].map((id) => ({ id, status: 'unknown' })),
    enabled: settings?.enabled ?? false,
    redirectReady: Boolean(String(publicWhatsapp ?? '').replace(/\D/g, '')),
    webhook: {
      callbackPath: '/webhooks/instagram',
      verifyToken: instagramConfig.verifyToken
    }
  }
}

function redactStoredError(settings: { lastError: string | null; accessToken: string | null; appSecret: string | null }) {
  let message = settings.lastError
  for (const secret of [settings.accessToken, settings.appSecret]) {
    if (message && secret) message = message.replaceAll(secret, '[oculto]').replaceAll(encodeURIComponent(secret), '[oculto]')
  }
  return message
}

async function canAccessBusiness(request: FastifyRequest, businessId: string) {
  const user = request.auth?.user
  if (!user) return false
  if (user.role === 'SUPER_ADMIN' || user.businessId === businessId) return true
  if (user.role !== 'ACCOUNT_ADMIN') return false
  return Boolean(await prisma.business.findFirst({
    where: { id: businessId, accountAdminId: user.id },
    select: { id: true }
  }))
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
