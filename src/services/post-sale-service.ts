import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'
import { RecordCommunicationAttempt } from '../application/communications/record-communication-attempt.js'
import { PrismaCommunicationAttemptRepository } from '../infrastructure/communications/prisma-communication-attempt-repository.js'
import { CommunicationService } from '../application/communications/communication-service.js'
import { PrismaCommunicationRepository } from '../infrastructure/communications/prisma-communication-repository.js'
import { assertPostSaleManualTransition, canAutomaticPostSaleSend, partitionLatestPostSales, type PostSaleManualStatus } from '../domain/communications/post-sale.js'

const whatsappCloudApi = new WhatsAppCloudApi()
const recordCommunicationAttempt = new RecordCommunicationAttempt(new PrismaCommunicationAttemptRepository())
const communicationService = new CommunicationService(new PrismaCommunicationRepository())
const POST_SALE_LOOKBACK_DAYS = 8

type ConversationIdRow = { id: string }

export async function prepareDuePostSales(input: { businessId?: string; limit?: number } = {}) {
  const now = new Date()
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  const automations = await prisma.postSaleAutomation.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      mode: { in: ['MANUAL_ASSISTED', 'AUTOMATIC_API'] }
    },
    include: { template: true }
  })

  let prepared = 0
  let failed = 0
  let skipped = 0

  for (const automation of automations) {
    if (prepared + failed >= limit) break
    if (!automation.template) {
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
      if (prepared + failed >= limit) break
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
          mode: automation.mode === 'MANUAL_ASSISTED' ? 'WHATSAPP_MANUAL' : 'WHATSAPP_API',
          error: 'Faltan variables: ' + resolved.missing.join(', ')
        })
        failed += 1
        continue
      }
      const deliveryData = {
        automationId: automation.id,
        appointmentId: appointment.id,
        mode: automation.mode === 'MANUAL_ASSISTED' ? 'WHATSAPP_MANUAL' : 'WHATSAPP_API',
        status: 'PENDING',
        messageSnapshot: resolved.previewText,
        scheduledFor,
        lastError: null
      }
      if (existing) {
        const refreshed = await prisma.postSaleDelivery.updateMany({
          where: { id: existing.id, status: 'FAILED' },
          data: deliveryData
        })
        prepared += refreshed.count
      } else {
        const created = await prisma.postSaleDelivery.createMany({
          data: [{
            businessId: automation.businessId,
            customerId: appointment.customerId,
            visitDate,
            ...deliveryData
          }],
          skipDuplicates: true
        })
        prepared += created.count
      }
    }
  }

  const superseded = await supersedeOlderPendingPostSales(input.businessId, now)
  return { prepared, failed, skipped, superseded, total: prepared + failed + superseded }
}

async function supersedeOlderPendingPostSales(businessId: string | undefined, now: Date) {
  const pending = await prisma.postSaleDelivery.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      status: { in: ['PENDING', 'OPENED', 'FAILED', 'PROCESSING'] }
    },
    select: { id: true, businessId: true, customerId: true, scheduledFor: true, status: true }
  })
  const { supersededIds } = partitionLatestPostSales(pending)
  if (!supersededIds.length) return 0
  const result = await prisma.postSaleDelivery.updateMany({
    where: { id: { in: supersededIds }, status: { in: ['PENDING', 'FAILED'] } },
    data: {
      status: 'SKIPPED',
      skippedAt: now,
      manualNote: 'Reemplazado por una visita posterior del mismo cliente'
    }
  })
  return result.count
}

export async function processDuePostSales(input: { businessId?: string; limit?: number } = {}) {
  const now = new Date()
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  await prisma.postSaleDelivery.updateMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      status: 'PROCESSING',
      updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) }
    },
    data: { status: 'FAILED', lastError: 'El procesamiento anterior se interrumpi\u00f3. Se reintentar\u00e1.' }
  })
  await prisma.postSaleDelivery.updateMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      mode: 'WHATSAPP_API',
      status: 'SENT',
      responseExpiresAt: { lt: now }
    },
    data: { status: 'EXPIRED' }
  })
  const preparation = await prepareDuePostSales(input)
  const automations = await prisma.postSaleAutomation.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      mode: 'AUTOMATIC_API',
      template: { status: 'APPROVED', category: 'UTILITY' }
    },
    include: { template: true }
  })
  let sent = 0
  let failed = 0
  let skipped = preparation.skipped

  for (const automation of automations) {
    if (sent + failed >= limit || !automation.template) break
    const gate = await assertBusinessCanSendWhatsApp(automation.businessId, 'REMINDER')
    if (!gate.allowed) {
      skipped += 1
      continue
    }
    const deliveries = await prisma.postSaleDelivery.findMany({
      where: {
        automationId: automation.id,
        status: { in: ['PENDING', 'OPENED', 'FAILED', 'PROCESSING'] },
        scheduledFor: { lte: now }
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        appointment: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            service: { select: { id: true, name: true, duration: true } },
            professional: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { scheduledFor: 'desc' },
      take: Math.max(100, (limit - sent - failed) * 10)
    })

    const partition = partitionLatestPostSales(deliveries)
    if (partition.supersededIds.length) {
      const superseded = await prisma.postSaleDelivery.updateMany({
        where: { id: { in: partition.supersededIds }, status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'SKIPPED',
          skippedAt: now,
          manualNote: 'Reemplazado por una visita posterior del mismo cliente'
        }
      })
      skipped += superseded.count
    }
    const activeIds = new Set(partition.activeIds)

    for (const delivery of deliveries) {
      if (sent + failed >= limit) break
      if (!activeIds.has(delivery.id)) continue
      if (!canAutomaticPostSaleSend(delivery.status)) continue
      const claim = await prisma.postSaleDelivery.updateMany({
        where: { id: delivery.id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING', mode: 'WHATSAPP_API', lastError: null }
      })
      if (!claim.count) continue
      const resolved = resolvePostSaleTemplate(automation.template.body, delivery.appointment)
      if (resolved.missing.length) {
        await prisma.postSaleDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', lastError: 'Faltan variables: ' + resolved.missing.join(', ') }
        })
        failed += 1
        continue
      }
      const conversationId = await findOrCreateConversation({
        businessId: automation.businessId,
        phone: delivery.customer.phone,
        preview: resolved.previewText
      })
      const result = await whatsappCloudApi.sendTemplateMessage({
        businessId: automation.businessId,
        to: delivery.customer.phone,
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
      const updated = await prisma.postSaleDelivery.update({
        where: { id: delivery.id },
        data: {
          mode: 'WHATSAPP_API',
          conversationId,
          status,
          messageSnapshot: resolved.previewText,
          providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
          lastError,
          sentAt,
          responseExpiresAt: result.sent ? addDays(sentAt, automation.responseWindowDays) : null
        }
      })
      await recordCommunicationAttempt.execute({
        businessId: automation.businessId,
        customerId: delivery.customer.id,
        customerName: delivery.customer.name,
        phone: delivery.customer.phone,
        message: resolved.previewText,
        sourceType: 'POST_SALE',
        sourceId: automation.id,
        sourceDeliveryId: delivery.id,
        purpose: 'FOLLOW_UP',
        mode: 'WHATSAPP_API',
        status,
        providerMessageId: updated.providerMessageId,
        failureReason: lastError,
        occurredAt: sentAt,
        metadata: { appointmentId: delivery.appointmentId, visitDate: delivery.visitDate }
      })
      if (result.sent) {
        await recordPostSaleOutboundMessage({
          conversationId,
          phone: delivery.customer.phone,
          text: resolved.previewText,
          providerMessageId: updated.providerMessageId
        })
        sent += 1
      } else {
        failed += 1
      }
    }
  }
  return {
    prepared: preparation.prepared,
    preparationFailed: preparation.failed,
    superseded: preparation.superseded,
    sent,
    failed,
    skipped,
    total: preparation.prepared + sent + failed + preparation.failed
  }
}

export async function transitionManualPostSale(input: {
  businessId: string
  deliveryId: string
  status: PostSaleManualStatus
  note?: string | null
}) {
  const delivery = await prisma.postSaleDelivery.findFirst({
    where: { id: input.deliveryId, businessId: input.businessId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      automation: { select: { mode: true } }
    }
  })
  if (!delivery) throw new Error('No encontr\u00e9 ese seguimiento de postventa')
  if (delivery.mode !== 'WHATSAPP_MANUAL' && delivery.automation?.mode !== 'MANUAL_ASSISTED') {
    throw new Error('Este seguimiento est\u00e1 configurado para env\u00edo autom\u00e1tico')
  }
  assertPostSaleManualTransition(delivery.status, input.status)
  const now = new Date()
  const transition = await prisma.postSaleDelivery.updateMany({
    where: { id: delivery.id, status: delivery.status },
    data: {
      status: input.status,
      mode: input.status === 'PENDING' ? delivery.mode : 'WHATSAPP_MANUAL',
      manualNote: input.note?.trim().slice(0, 500) || null,
      ...(input.status === 'OPENED' ? { openedAt: now } : {}),
      ...(input.status === 'SENT' ? { sentAt: now } : {}),
      ...(input.status === 'SKIPPED' ? { skippedAt: now } : {}),
      ...(input.status === 'RESPONDED' ? { respondedAt: now } : {}),
      ...(input.status === 'RESOLVED' ? { resolvedAt: now } : {}),
      ...(input.status === 'PENDING' ? { lastError: null } : {})
    }
  })
  if (!transition.count) throw new Error('El seguimiento cambi\u00f3 mientras lo estabas gestionando. Actualiz\u00e1 la lista.')
  const updated = await prisma.postSaleDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
  if (input.status === 'SENT') {
    await prisma.postSaleDelivery.updateMany({
      where: {
        businessId: delivery.businessId,
        customerId: delivery.customerId,
        id: { not: delivery.id },
        status: { in: ['PENDING', 'FAILED'] },
        scheduledFor: { lte: now }
      },
      data: {
        status: 'SKIPPED',
        skippedAt: now,
        manualNote: 'Omitido porque el cliente ya fue contactado manualmente'
      }
    })
    await recordCommunicationAttempt.execute({
      businessId: delivery.businessId,
      customerId: delivery.customer.id,
      customerName: delivery.customer.name,
      phone: delivery.customer.phone,
      message: delivery.messageSnapshot || 'Seguimiento postventa',
      sourceType: 'POST_SALE',
      sourceId: delivery.automationId || delivery.id,
      sourceDeliveryId: delivery.id,
      purpose: 'FOLLOW_UP',
      mode: 'WHATSAPP_MANUAL',
      status: 'SENT',
      occurredAt: now,
      metadata: { appointmentId: delivery.appointmentId, visitDate: delivery.visitDate }
    })
  }
  return updated
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
      mode: 'WHATSAPP_API',
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
  mode: string
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
    update: { status: 'FAILED', mode: input.mode, lastError: error, scheduledFor: input.scheduledFor }
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
    profesional: appointment.professional.name,
    fecha_ultima_visita: formatDate(appointment.startAt)
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
