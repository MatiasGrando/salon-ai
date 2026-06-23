import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { whatsappConfig } from '../config/whatsapp.js'
import { getBusinessWhatsAppState } from '../services/business-whatsapp-settings.js'
import { BusinessService } from '../services/business-service.js'

const service = new BusinessService()

export async function businessRoutes(app: FastifyInstance) {

  app.post('/businesses', async (request) => {

    const body = request.body as {
      name: string
    }

    return service.create(body.name)
  })

  app.get('/businesses', async () => {
    return service.findAll()
  })

  app.patch('/businesses/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      logoUrl?: string | null
    }
    const name = body.name?.trim()
    const logoUrl = normalizeLogoUrl(body.logoUrl)

    if (body.name !== undefined && !name) {
      return reply.status(400).send({
        message: 'El nombre del local es requerido'
      })
    }

    if (body.logoUrl !== undefined && logoUrl === undefined) {
      return reply.status(400).send({
        message: 'El logo debe ser una imagen valida de hasta 2 MB'
      })
    }

    if (name === undefined && logoUrl === undefined) {
      return reply.status(400).send({
        message: 'No hay cambios para guardar'
      })
    }

    const business = await service.update(params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(logoUrl !== undefined ? { logoUrl } : {})
    })

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre ese local'
      })
    }

    return business
  })

  app.get('/businesses/:id/whatsapp-settings', async (request, reply) => {
    const params = request.params as { id: string }
    const business = await prisma.business.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    await ensureBusinessSettings(params.id)
    return getBusinessWhatsAppState(params.id)
  })

  app.get('/businesses/:id/whatsapp-embedded-signup-config', async (request, reply) => {
    const params = request.params as { id: string }
    const business = await prisma.business.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    if (!whatsappConfig.appId || !whatsappConfig.embeddedSignupConfigId) {
      return reply.status(409).send({
        message: 'Falta configurar META_APP_ID y META_EMBEDDED_SIGNUP_CONFIG_ID para abrir Embedded Signup.'
      })
    }
    return {
      appId: whatsappConfig.appId,
      configId: whatsappConfig.embeddedSignupConfigId,
      apiVersion: whatsappConfig.apiVersion,
      redirectUri: whatsappConfig.oauthRedirectUri,
      extras: {
        setup: {
          external_business_id: params.id
        },
        sessionInfoVersion: 3
      }
    }
  })

  app.patch('/businesses/:id/whatsapp-settings', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as {
      connectionStatus?: string
      campaignsEnabled?: boolean
      remindersEnabled?: boolean
      realWhatsappEnabled?: boolean
      campaignSendingLocked?: boolean
      reminderSendingLocked?: boolean
      billingOwner?: string
      botEnabled?: boolean
      aiEnabled?: boolean
      wabaId?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      accessToken?: string
      tokenExpiresAt?: string
      redirectUri?: string
    }
    const business = await prisma.business.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    await ensureBusinessSettings(params.id)

    if (body.connectionStatus !== undefined) {
      if (!['NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'NEEDS_PAYMENT', 'NEEDS_REVIEW', 'ERROR'].includes(body.connectionStatus)) {
        return reply.status(400).send({ message: 'Estado de WhatsApp invalido' })
      }
      await prisma.businessWhatsAppConfig.update({
        where: { businessId: params.id },
        data: {
          connectionStatus: body.connectionStatus as never,
          ...(body.connectionStatus === 'CONNECTED' ? { connectedAt: new Date(), disconnectedAt: null } : {}),
          ...(body.connectionStatus === 'NOT_CONNECTED' ? { connectedAt: null, disconnectedAt: new Date() } : {})
        }
      })
    }

    const technicalWhatsAppData = {
      wabaId: normalizeOptionalText(body.wabaId),
      phoneNumberId: normalizeOptionalText(body.phoneNumberId),
      displayPhoneNumber: normalizeOptionalText(body.displayPhoneNumber),
      accessToken: normalizeOptionalText(body.accessToken),
      tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : undefined
    }
    const hasTechnicalWhatsAppData = Object.values(technicalWhatsAppData).some((value) => value !== undefined)
    if (hasTechnicalWhatsAppData) {
      const current = await prisma.businessWhatsAppConfig.findUnique({ where: { businessId: params.id } })
      const nextWabaId = technicalWhatsAppData.wabaId ?? current?.wabaId ?? null
      const nextPhoneNumberId = technicalWhatsAppData.phoneNumberId ?? current?.phoneNumberId ?? null
      const nextAccessToken = technicalWhatsAppData.accessToken ?? current?.accessToken ?? null
      const connected = Boolean(nextWabaId && nextPhoneNumberId && nextAccessToken)
      await prisma.businessWhatsAppConfig.update({
        where: { businessId: params.id },
        data: {
          ...(technicalWhatsAppData.wabaId !== undefined ? { wabaId: technicalWhatsAppData.wabaId } : {}),
          ...(technicalWhatsAppData.phoneNumberId !== undefined ? { phoneNumberId: technicalWhatsAppData.phoneNumberId } : {}),
          ...(technicalWhatsAppData.displayPhoneNumber !== undefined ? { displayPhoneNumber: technicalWhatsAppData.displayPhoneNumber } : {}),
          ...(technicalWhatsAppData.accessToken !== undefined ? { accessToken: technicalWhatsAppData.accessToken } : {}),
          ...(technicalWhatsAppData.tokenExpiresAt !== undefined ? { tokenExpiresAt: technicalWhatsAppData.tokenExpiresAt } : {}),
          metaAppId: whatsappConfig.appId ?? null,
          mode: 'CLIENT_OWNED',
          connectionStatus: connected ? 'CONNECTED' : 'CONNECTING',
          connectedAt: connected ? new Date() : null,
          lastError: connected ? null : 'Faltan WABA ID, Phone Number ID o token para completar la conexion.'
        }
      })
      if (connected) {
        await prisma.businessFeatureSettings.update({
          where: { businessId: params.id },
          data: {
            realWhatsappEnabled: true,
            remindersEnabled: true,
            reminderSendingLocked: false,
            billingOwner: 'CLIENT'
          }
        })
      }
    }

    if (body.billingOwner !== undefined && !['CLIENT', 'SALON_AI'].includes(body.billingOwner)) {
      return reply.status(400).send({ message: 'Responsable de facturacion invalido' })
    }

    await prisma.businessFeatureSettings.update({
      where: { businessId: params.id },
      data: {
        ...(body.botEnabled !== undefined ? { botEnabled: Boolean(body.botEnabled) } : {}),
        ...(body.aiEnabled !== undefined ? { aiEnabled: Boolean(body.aiEnabled) } : {}),
        ...(body.campaignsEnabled !== undefined ? { campaignsEnabled: Boolean(body.campaignsEnabled) } : {}),
        ...(body.remindersEnabled !== undefined ? { remindersEnabled: Boolean(body.remindersEnabled) } : {}),
        ...(body.realWhatsappEnabled !== undefined ? { realWhatsappEnabled: Boolean(body.realWhatsappEnabled) } : {}),
        ...(body.campaignSendingLocked !== undefined ? { campaignSendingLocked: Boolean(body.campaignSendingLocked) } : {}),
        ...(body.reminderSendingLocked !== undefined ? { reminderSendingLocked: Boolean(body.reminderSendingLocked) } : {}),
        ...(body.billingOwner !== undefined ? { billingOwner: body.billingOwner as never } : {})
      }
    })

    await prisma.business.update({
      where: { id: params.id },
      data: {
        ...(body.botEnabled !== undefined ? { botEnabled: Boolean(body.botEnabled) } : {}),
        ...(body.aiEnabled !== undefined ? { aiEnabled: Boolean(body.aiEnabled) } : {})
      }
    })

    return getBusinessWhatsAppState(params.id)
  })

  app.post('/businesses/:id/whatsapp/embedded-signup-callback', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as {
      code?: string
      wabaId?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      accessToken?: string
      tokenExpiresAt?: string
      redirectUri?: string
      embeddedSignupReceived?: boolean
      embeddedSignupPayloadKeys?: string[]
      metaMessagesSeen?: string[]
    }
    const business = await prisma.business.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    await ensureBusinessSettings(params.id)

    const tokenResult = body.accessToken
      ? await exchangeSdkAccessToken(body.accessToken, body.tokenExpiresAt)
      : await exchangeEmbeddedSignupCode(body.code, body.redirectUri)
    let resolvedWabaId = body.wabaId?.trim() || undefined
    let resolvedPhoneNumberId = body.phoneNumberId?.trim() || undefined
    let resolvedDisplayPhoneNumber = body.displayPhoneNumber?.trim() || undefined
    let assetLookupError: string | null = null
    if (tokenResult.accessToken && (!resolvedWabaId || !resolvedPhoneNumberId)) {
      const resolvedAssets = await resolveWhatsAppAssetsFromToken(tokenResult.accessToken)
      resolvedWabaId = resolvedWabaId || resolvedAssets.wabaId
      resolvedPhoneNumberId = resolvedPhoneNumberId || resolvedAssets.phoneNumberId
      resolvedDisplayPhoneNumber = resolvedDisplayPhoneNumber || resolvedAssets.displayPhoneNumber
      assetLookupError = resolvedAssets.error
    }
    const connected = Boolean(tokenResult.accessToken && resolvedWabaId && resolvedPhoneNumberId)
    const missingConnectionParts = [
      tokenResult.accessToken ? null : 'token',
      resolvedWabaId ? null : 'WABA ID',
      resolvedPhoneNumberId ? null : 'Phone Number ID'
    ].filter(Boolean).join(', ')
    const incompleteSignupError = !connected
      ? [
          `Embedded Signup devolvio datos incompletos. Falta: ${missingConnectionParts}.`,
          body.embeddedSignupReceived === false ? 'No llego el mensaje final del popup de Meta al CRM. Revisa que la configuracion de Embedded Signup este desplegada y que el SDK reciba sessionInfoVersion.' : null,
          body.embeddedSignupPayloadKeys?.length ? `Campos recibidos: ${body.embeddedSignupPayloadKeys.join(', ')}.` : null,
          body.metaMessagesSeen?.length ? `Mensajes Meta vistos: ${body.metaMessagesSeen.join(' | ')}.` : null,
          assetLookupError ? `Meta no permitio resolverlos automaticamente: ${assetLookupError}` : null
        ].filter(Boolean).join(' ')
      : null

    await prisma.businessWhatsAppConfig.update({
      where: { businessId: params.id },
      data: {
        connectionStatus: connected ? 'CONNECTED' : 'CONNECTING',
        mode: 'CLIENT_OWNED',
        wabaId: resolvedWabaId ?? null,
        phoneNumberId: resolvedPhoneNumberId ?? null,
        displayPhoneNumber: resolvedDisplayPhoneNumber ?? null,
        metaAppId: whatsappConfig.appId ?? null,
        accessToken: tokenResult.accessToken?.trim() || null,
        tokenExpiresAt: tokenResult.tokenExpiresAt ?? null,
        connectedAt: connected ? new Date() : null,
        disconnectedAt: connected ? null : new Date(),
        lastError: tokenResult.error || incompleteSignupError
      }
    })
    if (connected) {
      await prisma.businessFeatureSettings.update({
        where: { businessId: params.id },
        data: {
          realWhatsappEnabled: true,
          remindersEnabled: true,
          reminderSendingLocked: false,
          campaignsEnabled: false,
          campaignSendingLocked: true,
          billingOwner: 'CLIENT'
        }
      })
    }

    return getBusinessWhatsAppState(params.id)
  })

}

async function exchangeEmbeddedSignupCode(code?: string, redirectUri?: string) {
  const normalizedCode = code?.trim()
  if (!normalizedCode) return { accessToken: null, tokenExpiresAt: undefined, error: 'Meta no devolvio codigo de autorizacion.' }
  if (!whatsappConfig.appId || !whatsappConfig.appSecret) {
    return { accessToken: null, tokenExpiresAt: undefined, error: 'Falta META_APP_SECRET para intercambiar el codigo de Meta por token.' }
  }

  const candidateRedirectUri = redirectUri?.trim()
  const url = new URL(`https://graph.facebook.com/${whatsappConfig.apiVersion}/oauth/access_token`)
  url.searchParams.set('client_id', whatsappConfig.appId)
  url.searchParams.set('client_secret', whatsappConfig.appSecret)
  if (candidateRedirectUri) url.searchParams.set('redirect_uri', candidateRedirectUri)
  url.searchParams.set('code', normalizedCode)

  const response = await fetch(url)
  const body = await response.json().catch(() => ({})) as {
    access_token?: string
    expires_in?: number
    error?: {
      code?: number
      error_subcode?: number
      fbtrace_id?: string
      message?: string
      type?: string
    }
  }
  if (!response.ok || !body.access_token) {
    const metaError = body.error?.message || 'No pude intercambiar el codigo de Meta por token.'
    const metaDetails = [
      body.error?.type ? `tipo ${body.error.type}` : null,
      body.error?.code ? `codigo ${body.error.code}` : null,
      body.error?.error_subcode ? `subcodigo ${body.error.error_subcode}` : null,
      body.error?.fbtrace_id ? `trace ${body.error.fbtrace_id}` : null
    ].filter(Boolean).join(' · ')
    return {
      accessToken: null,
      tokenExpiresAt: undefined,
      error: `${metaError} Redirect usado: ${candidateRedirectUri || 'sin redirect_uri'}${metaDetails ? ` · Meta: ${metaDetails}` : ''}`
    }
  }

  return {
    accessToken: body.access_token,
    tokenExpiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    error: null
  }
}

async function exchangeSdkAccessToken(accessToken: string, tokenExpiresAt?: string) {
  const normalizedToken = accessToken.trim()
  const fallback = {
    accessToken: normalizedToken,
    tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
    error: null
  }
  if (!normalizedToken || !whatsappConfig.appId || !whatsappConfig.appSecret) return fallback

  const url = new URL(`https://graph.facebook.com/${whatsappConfig.apiVersion}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', whatsappConfig.appId)
  url.searchParams.set('client_secret', whatsappConfig.appSecret)
  url.searchParams.set('fb_exchange_token', normalizedToken)

  const response = await fetch(url)
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number }
  if (!response.ok || !body.access_token) return fallback

  return {
    accessToken: body.access_token,
    tokenExpiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : fallback.tokenExpiresAt,
    error: null
  }
}

async function resolveWhatsAppAssetsFromToken(accessToken: string) {
  type GraphPhoneNumber = {
    display_phone_number?: string
    id?: string
  }
  type GraphWaba = {
    id?: string
    phone_numbers?: { data?: GraphPhoneNumber[] }
  }
  type GraphBusiness = {
    client_whatsapp_business_accounts?: { data?: GraphWaba[] }
    owned_whatsapp_business_accounts?: { data?: GraphWaba[] }
  }
  type GraphBusinessesResponse = {
    data?: GraphBusiness[]
    error?: { message?: string }
  }

  const url = new URL(`https://graph.facebook.com/${whatsappConfig.apiVersion}/me/businesses`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('fields', [
    'owned_whatsapp_business_accounts{id,phone_numbers{id,display_phone_number}}',
    'client_whatsapp_business_accounts{id,phone_numbers{id,display_phone_number}}'
  ].join(','))

  const response = await fetch(url)
  const body = await response.json().catch(() => ({})) as GraphBusinessesResponse
  if (!response.ok) {
    return { wabaId: undefined, phoneNumberId: undefined, displayPhoneNumber: undefined, error: body.error?.message || 'No pude consultar activos de WhatsApp.' }
  }

  for (const business of body.data || []) {
    const wabas = [
      ...(business.owned_whatsapp_business_accounts?.data || []),
      ...(business.client_whatsapp_business_accounts?.data || [])
    ]
    for (const waba of wabas) {
      const phoneNumber = waba.phone_numbers?.data?.find((item) => item.id)
      if (waba.id && phoneNumber?.id) {
        return {
          wabaId: waba.id,
          phoneNumberId: phoneNumber.id,
          displayPhoneNumber: phoneNumber.display_phone_number,
          error: null
        }
      }
    }
  }

  return { wabaId: undefined, phoneNumberId: undefined, displayPhoneNumber: undefined, error: 'Graph API no devolvio cuentas o numeros de WhatsApp para este token.' }
}

async function ensureBusinessSettings(businessId: string) {
  await prisma.$transaction([
    prisma.businessWhatsAppConfig.upsert({
      where: { businessId },
      create: { businessId },
      update: {}
    }),
    prisma.businessFeatureSettings.upsert({
      where: { businessId },
      create: { businessId },
      update: {}
    })
  ])
}

function normalizeLogoUrl(logoUrl?: string | null) {
  if (logoUrl === undefined) {
    return undefined
  }

  if (logoUrl === null || logoUrl.trim() === '') {
    return null
  }

  const normalized = logoUrl.trim()
  const isImageDataUrl = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(normalized)

  return isImageDataUrl && normalized.length <= 2_800_000 ? normalized : undefined
}

function normalizeOptionalText(value?: string | null) {
  if (value === undefined) return undefined
  const normalized = value?.trim()
  return normalized || null
}
