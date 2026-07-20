import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { processDuePostSales } from '../services/post-sale-service.js'

const DEFAULT_SETTINGS = {
  enabled: false,
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

    const [settings, deliveries] = await Promise.all([
      prisma.postSaleAutomation.findUnique({
        where: { businessId },
        include: { template: true }
      }),
      prisma.postSaleDelivery.findMany({
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
        take: 30
      })
    ])
    const sent = deliveries.filter((delivery) => ['SENT', 'RESPONDED', 'EXPIRED'].includes(delivery.status)).length
    const responded = deliveries.filter((delivery) => delivery.status === 'RESPONDED').length
    const ratings = deliveries.flatMap((delivery) => delivery.rating === null ? [] : [delivery.rating])
    return {
      settings: settings ?? { businessId, ...DEFAULT_SETTINGS, template: null },
      metrics: {
        sent,
        responded,
        responseRate: sent ? Math.round((responded / sent) * 100) : 0,
        averageRating: ratings.length
          ? Math.round((ratings.reduce((total, rating) => total + rating, 0) / ratings.length) * 10) / 10
          : null,
        negative: deliveries.filter((delivery) => delivery.rating !== null && delivery.rating <= (settings?.lowRatingThreshold ?? 2)).length
      },
      deliveries
    }
  })

  app.patch('/post-sale/settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      enabled?: boolean
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
    if (templateId) {
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: templateId, businessId, status: 'APPROVED', category: 'UTILITY' } })
      if (!template) return reply.status(400).send({ message: 'Selecciona una plantilla de Recordatorio aprobada' })
    }
    if (body.enabled && !templateId) {
      return reply.status(400).send({ message: 'Selecciona una plantilla aprobada antes de activar la postventa' })
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
        enabled: body.enabled === true,
        delayMinutes,
        templateId,
        positiveResponse,
        neutralResponse,
        negativeResponse,
        reviewUrl
      },
      update: {
        enabled: body.enabled === true,
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
