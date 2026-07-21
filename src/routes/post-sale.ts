import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { prepareDuePostSales, processDuePostSales, transitionManualPostSale } from '../services/post-sale-service.js'
import { buildManualWhatsAppUrl } from '../domain/communications/communication.js'
import { isPostSaleTemplateEligible, normalizePostSaleMode, partitionLatestPostSales, postSaleManualStatuses, postSaleModes } from '../domain/communications/post-sale.js'

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'PAUSED',
  delayMinutes: 120,
  responseWindowDays: 7,
  lowRatingThreshold: 2,
  templateId: null,
  positiveResponse: 'Gracias por tu calificación. Nos alegra que hayas tenido una buena experiencia.',
  neutralResponse: 'Gracias por responder. Nos gustaría saber qué podríamos mejorar.',
  negativeResponse: 'Lamentamos que tu experiencia no haya sido buena. El equipo va a contactarte por este chat.',
  reviewUrl: null
}

export async function postSaleRoutes(app: FastifyInstance) {
  app.get('/post-sale/settings', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })

    const settings = await prisma.postSaleAutomation.findUnique({
      where: { businessId },
      include: { template: true }
    })
    const mode = normalizePostSaleMode(settings?.mode, settings?.enabled)
    if (mode !== 'PAUSED') await prepareDuePostSales({ businessId, limit: 100 })
    const deliveries = await prisma.postSaleDelivery.findMany({
        where: { businessId },
        include: {
          customer: { select: { name: true, phone: true } },
          appointment: {
            select: {
              startAt: true,
              service: { select: { name: true } },
              professional: { select: { name: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    const sent = deliveries.filter((delivery) => ['SENT', 'RESPONDED', 'RESOLVED', 'EXPIRED'].includes(delivery.status)).length
    const responded = deliveries.filter((delivery) => delivery.status === 'RESPONDED').length
    const ratings = deliveries.flatMap((delivery) => delivery.rating === null ? [] : [delivery.rating])
    const activePendingIds = new Set(partitionLatestPostSales(
      deliveries
        .filter((delivery) => ['PENDING', 'OPENED', 'FAILED', 'PROCESSING'].includes(delivery.status))
        .map((delivery) => ({
          id: delivery.id,
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          scheduledFor: delivery.scheduledFor,
          status: delivery.status
        }))
    ).activeIds)
    return {
      settings: settings ? { ...settings, mode } : { businessId, ...DEFAULT_SETTINGS, template: null },
      metrics: {
        pending: activePendingIds.size,
        sent,
        manualSent: deliveries.filter((delivery) => delivery.mode === 'WHATSAPP_MANUAL' && ['SENT', 'RESPONDED', 'RESOLVED'].includes(delivery.status)).length,
        responded,
        responseRate: sent ? Math.round((responded / sent) * 100) : 0,
        averageRating: ratings.length
          ? Math.round((ratings.reduce((total, rating) => total + rating, 0) / ratings.length) * 10) / 10
          : null,
        negative: deliveries.filter((delivery) => delivery.rating !== null && delivery.rating <= (settings?.lowRatingThreshold ?? 2)).length
      },
      deliveries: deliveries.map((delivery) => ({
        ...delivery,
        isActivePending: activePendingIds.has(delivery.id),
        whatsappUrl: ['PENDING', 'OPENED', 'FAILED'].includes(delivery.status) && delivery.messageSnapshot
          ? safeManualWhatsAppUrl(delivery.customer.phone, delivery.messageSnapshot)
          : null
      }))
    }
  })

  app.patch('/post-sale/settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      enabled?: boolean
      mode?: string
      delayMinutes?: number | string
      templateId?: string | null
      positiveResponse?: string
      neutralResponse?: string
      negativeResponse?: string
      reviewUrl?: string | null
    }
    const businessId = body.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const delayMinutes = Number(body.delayMinutes ?? 120)
    if (![60, 120, 180, 240].includes(delayMinutes)) {
      return reply.status(400).send({ message: 'Selecciona un tiempo de espera valido' })
    }
    const templateId = body.templateId?.trim() || null
    const mode = normalizePostSaleMode(body.mode, body.enabled === true)
    if (body.mode !== undefined && !postSaleModes.includes(body.mode as typeof postSaleModes[number])) {
      return reply.status(400).send({ message: 'Selecciona un modo de postventa valido' })
    }
    if (templateId) {
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: templateId, businessId } })
      if (!template) return reply.status(400).send({ message: 'La plantilla seleccionada no existe' })
      if (!isPostSaleTemplateEligible(mode, template)) {
        return reply.status(400).send({ message: 'El modo automatico requiere una plantilla de Recordatorio aprobada por Meta' })
      }
    }
    if (mode !== 'PAUSED' && !templateId) {
      return reply.status(400).send({ message: 'Selecciona una plantilla antes de activar la postventa' })
    }

    const positiveResponse = normalizeResponse(body.positiveResponse, DEFAULT_SETTINGS.positiveResponse)
    const neutralResponse = normalizeResponse(body.neutralResponse, DEFAULT_SETTINGS.neutralResponse)
    const negativeResponse = normalizeResponse(body.negativeResponse, DEFAULT_SETTINGS.negativeResponse)
    const reviewUrl = normalizeReviewUrl(body.reviewUrl)
    if (reviewUrl === undefined) return reply.status(400).send({ message: 'El enlace de resenas no es valido' })

    return prisma.postSaleAutomation.upsert({
      where: { businessId },
      create: {
        businessId,
        enabled: mode === 'AUTOMATIC_API',
        mode,
        delayMinutes,
        templateId,
        positiveResponse,
        neutralResponse,
        negativeResponse,
        reviewUrl
      },
      update: {
        enabled: mode === 'AUTOMATIC_API',
        mode,
        delayMinutes,
        templateId,
        positiveResponse,
        neutralResponse,
        negativeResponse,
        reviewUrl
      },
      include: { template: true }
    })
  })

  app.post('/post-sale/process-due', async (request, reply) => {
    const body = request.body as { businessId?: string; limit?: number | string }
    const businessId = body.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    return processDuePostSales({ businessId, limit: Math.max(1, Math.min(100, Number(body.limit ?? 25) || 25)) })
  })

  app.patch('/post-sale/deliveries/:id/manual-status', async (request, reply) => {
    const params = request.params as { id?: string }
    const body = request.body as { businessId?: string; status?: string; note?: string | null }
    const businessId = body.businessId?.trim()
    const deliveryId = params.id?.trim()
    if (!businessId || !deliveryId) return reply.status(400).send({ message: 'Faltan datos del seguimiento' })
    if (!postSaleManualStatuses.includes(body.status as typeof postSaleManualStatuses[number])) {
      return reply.status(400).send({ message: 'Estado de postventa invalido' })
    }
    try {
      return await transitionManualPostSale({
        businessId,
        deliveryId,
        status: body.status as typeof postSaleManualStatuses[number],
        ...(body.note !== undefined ? { note: body.note } : {})
      })
    } catch (error) {
      return reply.status(409).send({ message: error instanceof Error ? error.message : 'No se pudo actualizar la postventa' })
    }
  })
}

function safeManualWhatsAppUrl(phone: string, message: string) {
  try {
    return buildManualWhatsAppUrl(phone, message)
  } catch {
    return null
  }
}

function normalizeResponse(value: string | undefined, fallback: string) {
  const normalized = value?.trim() || fallback
  return normalized.slice(0, 1000)
}

function normalizeReviewUrl(value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null
  try {
    const url = new URL(normalized)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}
