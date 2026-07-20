import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'
import { RecordCommunicationAttempt } from '../application/communications/record-communication-attempt.js'
import { PrismaCommunicationAttemptRepository } from '../infrastructure/communications/prisma-communication-attempt-repository.js'
import { CommunicationService } from '../application/communications/communication-service.js'
import { PrismaCommunicationRepository } from '../infrastructure/communications/prisma-communication-repository.js'

const whatsappCloudApi = new WhatsAppCloudApi()
const recordCommunicationAttempt = new RecordCommunicationAttempt(new PrismaCommunicationAttemptRepository())
const communicationService = new CommunicationService(new PrismaCommunicationRepository())
const POST_SALE_LOOKBACK_DAYS = 8

type ConversationIdRow = { id: string }

export async function processDuePostSales(input: { businessId?: string; limit?: number } = {}) {
  const now = new Date()
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  await prisma.postSaleDelivery.updateMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      status: 'SENT',
      responseExpiresAt: { lt: now }
    },
    data: { status: 'EXPIRED' }
  })
  const automations = await prisma.postSaleAutomation.findMany({
    where: {
      enabled: true,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      template: { status: 'APPROVED', category: 'UTILITY' }
    },
    include: { template: true }
  })

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const automation of automations) {
    if (sent + failed >= limit || !automation.template) break
    const gate = await assertBusinessCanSendWhatsApp(automation.businessId, 'REMINDER')
    if (!gate.allowed) {
      skipped += 1
      continue
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        professional: { businessId: automation.businessId },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: {
          gte: new Date(now.getTime() - POST_SALE_LOOKBACK_DAYS * 86_400_000),
          lt: endOfLocalDay(now)
        }
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true, duration: true } },
        professional: { select: { id: true, name: true } }
      },
      orderBy: { startAt: 'desc' },
      take: Math.max(100, limit * 12)
    })

    const lastAppointmentByVisit = new Map<string, (typeof appointments)[number]>()
    for (const appointment of appointments) {
      const visitDate = localDateKey(appointment.startAt)
      const key = appointment.customerId + ':' + visitDate
      if (!lastAppointmentByVisit.has(key)) lastAppointmentByVisit.set(key, appointment)
    }

    for (const appointment of lastAppointmentByVisit.values()) {
      if (sent + failed >= limit) break
      const visitDate = localDateKey(appointment.startAt)
      const scheduledFor = new Date(
        appointment.startAt.getTime() +
        (appointment.service.duration + automation.delayMinutes) * 60_000
      )
      if (scheduledFor > now) continue

      const existing = await prisma.postSaleDelivery.findUnique({
        where: {
          businessId_customerId_visitDate: {
            businessId: automation.businessId,
            customerId: appointment.customerId,
            visitDate
          }
        }
      })
      if (existing && existing.status !== 'FAILED') continue

      const resolved = resolvePostSaleTemplate(automation.template.body, appointment)
      if (resolved.missing.length) {
        await saveFailedDelivery({
          automationId: automation.id,
          businessId: automation.businessId,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          visitDate,
          scheduledFor,
          error: 'Faltan variables: ' + resolved.missing.join(', ')
        })
        failed += 1
        continue
      }

      const conversationId = await findOrCreateConversation({
        businessId: automation.businessId,
        phone: appointment.customer.phone,
        preview: resolved.previewText
      })
      const result = await whatsappCloudApi.sendTemplateMessage({
        businessId: automation.businessId,
        to: appointment.customer.phone,
        templateName: automation.template.metaName,
        languageCode: automation.template.language,
        bodyParameters: resolved.bodyParameters,
        headerImageDataUrl: automation.template.imageUrl
      })
      const sentAt = new Date()
      const status = result.sent ? 'SENT' : 'FAILED'
      const lastError = result.sent
        ? null
        : ('errorMessage' in result ? result.errorMessage : undefined) ||
          ('reason' in result ? result.reason : undefined) ||
          'No se pudo enviar la postventa'
      const delivery = await prisma.postSaleDelivery.upsert({
        where: {
          businessId_customerId_visitDate: {
            businessId: automation.businessId,
            customerId: appointment.customerId,
            visitDate
          }
        },
        create: {
          businessId: automation.businessId,
          automationId: automation.id,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          conversationId,
          visitDate,
          status,
          providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
          lastError,
          scheduledFor,
          sentAt,
          responseExpiresAt: result.sent ? addDays(sentAt, automation.responseWindowDays) : null
        },
        update: {
          automationId: automation.id,
          appointmentId: appointment.id,
          conversationId,
          status,
          providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
          lastError,
          scheduledFor,
          sentAt,
          responseExpiresAt: result.sent ? addDays(sentAt, automation.responseWindowDays) : null
        }
      })

      await recordCommunicationAttempt.execute({
        businessId: automation.businessId,
        customerId: appointment.customer.id,
        customerName: appointment.customer.name,
        phone: appointment.customer.phone,
        message: resolved.previewText,
        sourceType: 'POST_SALE',
        sourceId: automation.id,
        sourceDeliveryId: delivery.id,
        purpose: 'FOLLOW_UP',
        mode: 'WHATSAPP_API',
        status,
        providerMessageId: delivery.providerMessageId,
        failureReason: lastError,
        occurredAt: sentAt,
        metadata: { appointmentId: appointment.id, visitDate }
      })

      if (result.sent) {
        await recordPostSaleOutboundMessage({
          conversationId,
          phone: appointment.customer.phone,
          text: resolved.previewText,
          providerMessageId: delivery.providerMessageId
        })
        sent += 1
      } else {
        failed += 1
      }
    }
  }

  return { sent, failed, skipped, total: sent + failed }
}

export async function capturePostSaleResponse(input: {
  businessId?: string | null
  conversationId: string
  phone: string
  message: string
}) {
  const now = new Date()
  const delivery = await prisma.postSaleDelivery.findFirst({
    where: {
      conversationId: input.conversationId,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      status: { in: ['SENT', 'RESPONDED'] },
      responseExpiresAt: { gte: now }
    },
    include: { automation: true },
    orderBy: { sentAt: 'desc' }
  })
  if (!delivery?.automation) return { captured: false as const }

  const message = input.message.trim()
  if (delivery.rating !== null && delivery.commentRequestedAt && !delivery.comment) {
    await prisma.postSaleDelivery.update({
      where: { id: delivery.id },
      data: { comment: message.slice(0, 1000) }
    })
    return { captured: true as const, reply: null, rating: delivery.rating, commentCaptured: true }
  }

  const rating = parseRating(message)
  if (!rating || delivery.rating !== null) return { captured: false as const }
  const lowRating = rating <= delivery.automation.lowRatingThreshold
  const neutralRating = rating === delivery.automation.lowRatingThreshold + 1
  const reply = lowRating
    ? delivery.automation.negativeResponse
    : neutralRating
      ? delivery.automation.neutralResponse
      : appendReviewUrl(delivery.automation.positiveResponse, delivery.automation.reviewUrl)

  await prisma.$transaction([
    prisma.postSaleDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'RESPONDED',
        rating,
        respondedAt: now,
        commentRequestedAt: rating <= delivery.automation.lowRatingThreshold + 1 ? now : null
      }
    }),
    ...(lowRating
      ? [prisma.conversation.update({
          where: { id: input.conversationId },
          data: {
            currentStep: 'HUMAN_HANDOFF',
            aiEnabled: false,
            humanHandoffAt: now,
            humanHandoffResolvedAt: null,
            archivedAt: null
          }
        })]
      : [])
  ])

  const commonRecipient = await prisma.communicationRecipient.findUnique({
    where: { sourceDeliveryId: delivery.id },
    select: { id: true }
  })
  if (commonRecipient) {
    await communicationService.transitionRecipient({
      recipientId: commonRecipient.id,
      businessId: delivery.businessId,
      status: 'RESPONDED'
    })
  }

  return { captured: true as const, reply, rating, lowRating, commentCaptured: false }
}

async function findOrCreateConversation(input: { businessId: string; phone: string; preview: string }) {
  const rows = await prisma.$queryRawUnsafe<ConversationIdRow[]>(
    `SELECT id FROM "Conversation"
     WHERE "businessId" = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')
     ORDER BY "updatedAt" DESC LIMIT 1`,
    input.businessId,
    input.phone
  )
  if (rows[0]?.id) return rows[0].id
  const conversation = await prisma.conversation.create({
    data: { businessId: input.businessId, phone: input.phone, lastMessage: input.preview }
  })
  return conversation.id
}

async function recordPostSaleOutboundMessage(input: {
  conversationId: string
  phone: string
  text: string
  providerMessageId: string | null
}) {
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: input.conversationId,
        phone: input.phone,
        direction: 'OUTBOUND',
        body: input.text,
        status: 'sent',
        providerMessageId: input.providerMessageId,
        metadata: { provider: 'whatsapp', automation: 'post_sale' }
      }
    }),
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessage: input.text, archivedAt: null }
    })
  ])
}

async function saveFailedDelivery(input: {
  automationId: string
  businessId: string
  appointmentId: string
  customerId: string
  visitDate: string
  scheduledFor: Date
  error: string
}) {
  const { error, ...delivery } = input
  await prisma.postSaleDelivery.upsert({
    where: {
      businessId_customerId_visitDate: {
        businessId: input.businessId,
        customerId: input.customerId,
        visitDate: input.visitDate
      }
    },
    create: { ...delivery, status: 'FAILED', lastError: error },
    update: { status: 'FAILED', lastError: error, scheduledFor: input.scheduledFor }
  })
}

function resolvePostSaleTemplate(
  body: string,
  appointment: {
    startAt: Date
    customer: { name: string }
    service: { name: string }
    professional: { name: string }
  }
) {
  const variables = Array.from(body.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
  const values: Record<string, string> = {
    nombre_cliente: appointment.customer.name,
    usuario: appointment.customer.name,
    fecha_turno: formatDate(appointment.startAt),
    hora_turno: formatTime(appointment.startAt),
    servicio: appointment.service.name,
    profesional: appointment.professional.name
  }
  const missing = variables.filter((variable) => !values[variable])
  return {
    missing,
    bodyParameters: variables.map((variable) => values[variable] || ''),
    previewText: body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable: string) => values[variable] || '{{' + variable + '}}')
  }
}

function parseRating(message: string) {
  const match = /^\s*([1-5])(?:\s*\/\s*5)?\s*$/.exec(message)
  return match?.[1] ? Number(match[1]) : null
}

function appendReviewUrl(message: string, reviewUrl: string | null) {
  return reviewUrl ? message.trim() + '\n\nSi querés, podés dejarnos una reseña acá: ' + reviewUrl : message
}

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Argentina/Buenos_Aires'
  }).format(date)
}

function endOfLocalDay(date: Date) {
  const result = new Date(date)
  result.setHours(24, 0, 0, 0)
  return result
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires'
  }).format(date)
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires'
  }).format(date)
}

function extractProviderMessageId(response: unknown) {
  if (!response || typeof response !== 'object') return null
  const messages = (response as { messages?: Array<{ id?: unknown }> }).messages
  const id = Array.isArray(messages) ? messages[0]?.id : null
  return typeof id === 'string' ? id : null
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000)
}
