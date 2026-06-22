import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
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
          connectedAt: body.connectionStatus === 'CONNECTED' ? new Date() : undefined,
          disconnectedAt: body.connectionStatus === 'NOT_CONNECTED' ? new Date() : undefined
        }
      })
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
    }
    const business = await prisma.business.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese local' })
    await ensureBusinessSettings(params.id)

    await prisma.businessWhatsAppConfig.update({
      where: { businessId: params.id },
      data: {
        connectionStatus: body.accessToken && body.wabaId && body.phoneNumberId ? 'CONNECTED' : 'CONNECTING',
        mode: 'CLIENT_OWNED',
        wabaId: body.wabaId?.trim() || undefined,
        phoneNumberId: body.phoneNumberId?.trim() || undefined,
        displayPhoneNumber: body.displayPhoneNumber?.trim() || undefined,
        accessToken: body.accessToken?.trim() || undefined,
        tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : undefined,
        connectedAt: body.accessToken && body.wabaId && body.phoneNumberId ? new Date() : undefined,
        lastError: body.code && !body.accessToken ? 'Embedded Signup devolvio codigo; falta intercambiarlo por token.' : null
      }
    })

    return getBusinessWhatsAppState(params.id)
  })

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
