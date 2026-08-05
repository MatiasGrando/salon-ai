import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { Prisma, type Message } from '../generated/prisma/client.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from '../services/business-whatsapp-settings.js'
import {
  closeConversationOpportunity,
  CONVERSATION_CLOSE_REASONS,
  markConversationOpportunityConverted,
  type ConversationCloseReason
} from '../services/conversation-opportunity-service.js'
import { bookingDepositService } from '../services/booking-deposit-service.js'
import {
  assistantPersonalityPreview,
  normalizeAssistantPersonality
} from '../services/assistant-personality-service.js'
import {
  normalizeBookingFlowOrder,
  normalizeCatalogDisplayMode
} from '../services/booking-v2-domain.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../services/booking-v2-conversation-state.js'
import { BookingV2Engine } from '../services/booking-v2-engine.js'
import {
  acceptField,
  advanceToNextQueuedService,
  clearFieldAndDependents,
  nextMissingField,
  type BookingFlowOrder,
  type BookingV2State
} from '../services/booking-v2-state.js'
import { normalizeConversationContextSettings } from '../services/conversation-context-settings.js'

const whatsappCloudApi = new WhatsAppCloudApi()
const bookingV2Engine = new BookingV2Engine()
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

function conversationStepForPersistedBookingState(
  state: BookingV2State,
  bookingFlowOrder: BookingFlowOrder = 'PROFESSIONAL_FIRST'
) {
  if (state.serviceValidation?.stage === 'awaiting_confirmation') {
    return 'ASK_SERVICE'
  }
  if (
    state.guidedEstimate?.stage === 'awaiting_option' ||
    state.guidedEstimate?.stage === 'awaiting_decision'
  ) {
    return 'ASK_SERVICE'
  }

  const nextField = nextMissingField(state.draft, bookingFlowOrder)
  if (nextField === 'name') return 'ASK_CUSTOMER_NAME'
  if (nextField === 'service') return 'ASK_SERVICE'
  if (nextField === 'professional') return 'ASK_PROFESSIONAL'
  if (nextField === 'date') return 'ASK_DATE'
  if (nextField === 'time') return 'ASK_TIME'
  return 'CONFIRM'
}

function isInlineCrmMedia(contentType: string) {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase()
  return normalized === 'application/pdf' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp' ||
    normalized === 'image/gif'
}

function safeMediaFilename(
  filename: string | null,
  contentType: string,
  mediaType: 'image' | 'document'
) {
  const sanitized = filename
    ?.replace(/[\r\n"]/g, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim()
  if (sanitized) return sanitized.slice(0, 160)

  const normalized = contentType.split(';')[0]?.trim().toLowerCase()
  const extension = normalized === 'application/pdf'
    ? 'pdf'
    : normalized === 'image/png'
      ? 'png'
      : normalized === 'image/webp'
        ? 'webp'
        : normalized === 'image/gif'
          ? 'gif'
          : normalized === 'image/jpeg'
            ? 'jpg'
            : 'bin'
  return `${mediaType === 'image' ? 'imagen' : 'archivo'}.${extension}`
}

export async function crmRoutes(app: FastifyInstance) {
  app.post('/crm/maintenance/delete-qa-data', async (request, reply) => {
    const body = request.body as { confirm?: string }
    if (body.confirm !== 'delete-all-qa-cami-data') {
      return reply.status(400).send({
        message: 'confirm=delete-all-qa-cami-data es requerido'
      })
    }

    const [customers, conversations] = await Promise.all([
      prisma.customer.findMany({
        where: { phone: { startsWith: 'qa-cami-' } },
        select: { id: true, phone: true }
      }),
      prisma.conversation.findMany({
        where: { phone: { startsWith: 'qa-cami-' } },
        select: { id: true, phone: true }
      })
    ])
    const customerIds = customers.map((customer) => customer.id)
    const conversationIds = conversations.map((conversation) => conversation.id)

    const result = await prisma.$transaction(async (transaction) => {
      const deletedMessages = conversationIds.length
        ? await transaction.message.deleteMany({ where: { conversationId: { in: conversationIds } } })
        : { count: 0 }
      const deletedConversations = conversationIds.length
        ? await transaction.conversation.deleteMany({ where: { id: { in: conversationIds } } })
        : { count: 0 }
      const deletedAppointments = customerIds.length
        ? await transaction.appointment.deleteMany({ where: { customerId: { in: customerIds } } })
        : { count: 0 }
      const deletedNotes = customerIds.length
        ? await transaction.customerNote.deleteMany({ where: { customerId: { in: customerIds } } })
        : { count: 0 }
      const deletedCustomers = customerIds.length
        ? await transaction.customer.deleteMany({ where: { id: { in: customerIds } } })
        : { count: 0 }

      return {
        messages: deletedMessages.count,
        conversations: deletedConversations.count,
        appointments: deletedAppointments.count,
        notes: deletedNotes.count,
        customers: deletedCustomers.count
      }
    })

    return {
      deleted: result,
      customerPhones: customers.map((customer) => customer.phone),
      conversationPhones: conversations.map((conversation) => conversation.phone)
    }
  })

  app.get('/crm/maintenance/delete-qa-conversations', async (request, reply) => {
    const query = request.query as {
      date?: string
      confirm?: string
    }

    if (query.confirm !== 'delete-qa-cami') {
      return reply.status(400).send({
        message: 'confirm=delete-qa-cami es requerido'
      })
    }

    if (!query.date || !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      return reply.status(400).send({
        message: 'date debe tener formato YYYY-MM-DD'
      })
    }

    const start = new Date(`${query.date}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    const conversations = await prisma.conversation.findMany({
      where: {
        phone: {
          startsWith: 'qa-cami-'
        },
        OR: [
          {
            updatedAt: {
              gte: start,
              lt: end
            }
          },
          {
            messages: {
              some: {
                createdAt: {
                  gte: start,
                  lt: end
                }
              }
            }
          }
        ]
      },
      select: {
        id: true,
        phone: true
      }
    })

    const conversationIds = conversations.map((conversation) => conversation.id)

    if (conversationIds.length === 0) {
      return {
        deletedConversations: 0,
        deletedMessages: 0,
        phones: []
      }
    }

    const [deletedMessages, deletedConversations] = await prisma.$transaction([
      prisma.message.deleteMany({
        where: {
          conversationId: {
            in: conversationIds
          }
        }
      }),
      prisma.conversation.deleteMany({
        where: {
          id: {
            in: conversationIds
          }
        }
      })
    ])

    return {
      deletedConversations: deletedConversations.count,
      deletedMessages: deletedMessages.count,
      phones: conversations.map((conversation) => conversation.phone)
    }
  })

  app.get('/crm/conversations', async (request) => {
    const query = request.query as {
      businessId?: string
      phone?: string
      take?: string
      cursor?: string
      since?: string
      archive?: 'active' | 'archived' | 'all'
      filter?: 'handoff'
      paginated?: string
    }
    const take = Math.min(Math.max(Number(query.take ?? 30) || 30, 1), 100)
    const archiveView = query.archive ?? 'all'
    await bookingDepositService.expireOverdue()
    await archiveOldCompletedConversations(query.businessId)

    const since = parseOptionalDate(query.since)
    const where: Prisma.ConversationWhereInput = {
      ...conversationListWhere({
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.phone ? { phone: query.phone } : {}),
        archiveView,
        ...(query.filter ? { filter: query.filter } : {})
      }),
      ...(since ? { updatedAt: { gt: since } } : {})
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        bookingDeposits: {
          include: {
            appointment: {
              include: {
                customer: true,
                professional: true,
                service: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })

    const latestMessages = await latestMessagesByConversationId(
      conversations.map((conversation) => conversation.id)
    )
    const conversationsWithLatestMessage = conversations.map((conversation) => ({
      ...conversation,
      messages: latestMessages.has(conversation.id)
        ? [latestMessages.get(conversation.id)!]
        : []
    }))

    const hasMore = conversationsWithLatestMessage.length > take
    const items = conversationsWithLatestMessage.slice(0, take).sort((left, right) => {
      return latestConversationActivityAt(right) - latestConversationActivityAt(left)
    })
    const itemsWithReplyWindow = await attachConversationReplyWindow(items)

    if (query.paginated !== 'true') {
      return itemsWithReplyWindow
    }

    const [counts, latestActivityAt] = await Promise.all([
      conversationCounts(query.businessId),
      latestConversationActivityAtForBusiness(query.businessId)
    ])

    return {
      items: itemsWithReplyWindow,
      nextCursor: since ? null : hasMore ? itemsWithReplyWindow[itemsWithReplyWindow.length - 1]?.id ?? null : null,
      counts,
      latestActivityAt
    }
  })

  app.get('/crm/conversations/summary', async (request) => {
    const query = request.query as {
      businessId?: string
    }
    const [counts, latestActivityAt] = await Promise.all([
      conversationCounts(query.businessId),
      latestConversationActivityAtForBusiness(query.businessId)
    ])

    return {
      counts,
      latestActivityAt
    }
  })

  app.get('/crm/ai-settings', async (request) => {
    const query = request.query as {
      businessId?: string
    }

    const business = await findCrmBusiness(query.businessId)
    const featureSettings = business
      ? await prisma.businessFeatureSettings.findUnique({
          where: { businessId: business.id },
          select: {
            bookingV2Enabled: true,
            serviceCatalogDisplayMode: true,
            bookingFlowOrder: true,
            conversationPauseAfterMinutes: true,
            conversationExpireAfterMinutes: true,
            assistantPersonality: true
          }
        })
      : null
    const assistantPersonality = normalizeAssistantPersonality(
      featureSettings?.assistantPersonality
    )
    const contextSettings = normalizeConversationContextSettings(featureSettings)

    return {
      businessId: business?.id ?? null,
      botEnabled: business?.botEnabled ?? true,
      aiEnabled: business?.aiEnabled ?? true,
      bookingV2Enabled: Boolean(featureSettings?.bookingV2Enabled),
      serviceCatalogDisplayMode: normalizeCatalogDisplayMode(
        featureSettings?.serviceCatalogDisplayMode
      ),
      bookingFlowOrder: normalizeBookingFlowOrder(featureSettings?.bookingFlowOrder),
      conversationPauseAfterMinutes: contextSettings.pauseAfterMinutes,
      conversationExpireAfterMinutes: contextSettings.expireAfterMinutes,
      assistantPersonality,
      assistantPersonalityPreview: assistantPersonalityPreview(assistantPersonality)
    }
  })

  app.patch('/crm/ai-settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      botEnabled?: boolean
      aiEnabled?: boolean
      bookingV2Enabled?: boolean
      serviceCatalogDisplayMode?: string
      bookingFlowOrder?: string
      conversationPauseAfterMinutes?: number
      conversationExpireAfterMinutes?: number
      assistantPersonality?: unknown
    }

    if (
      typeof body.botEnabled !== 'boolean' &&
      typeof body.aiEnabled !== 'boolean' &&
      typeof body.bookingV2Enabled !== 'boolean' &&
      body.serviceCatalogDisplayMode === undefined &&
      body.bookingFlowOrder === undefined &&
      body.conversationPauseAfterMinutes === undefined &&
      body.conversationExpireAfterMinutes === undefined &&
      body.assistantPersonality === undefined
    ) {
      return reply.status(400).send({
        message: 'Envia una configuracion valida para actualizar'
      })
    }

    const business = await findCrmBusiness(body.businessId)

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre un negocio cargado'
      })
    }

    if (
      body.serviceCatalogDisplayMode !== undefined &&
      !['ALL_SERVICES', 'CATEGORIES_FIRST'].includes(body.serviceCatalogDisplayMode)
    ) {
      return reply.status(400).send({
        message: 'Seleccioná una forma válida de mostrar el catálogo.'
      })
    }

    if (
      body.bookingFlowOrder !== undefined &&
      !['PROFESSIONAL_FIRST', 'DATE_TIME_FIRST'].includes(body.bookingFlowOrder)
    ) {
      return reply.status(400).send({
        message: 'Seleccioná un orden válido para solicitar los datos de la reserva.'
      })
    }

    const hasContextSettings = body.conversationPauseAfterMinutes !== undefined ||
      body.conversationExpireAfterMinutes !== undefined
    if (hasContextSettings) {
      if (
        !Number.isInteger(body.conversationPauseAfterMinutes) ||
        !Number.isInteger(body.conversationExpireAfterMinutes) ||
        body.conversationPauseAfterMinutes! < 15 ||
        body.conversationPauseAfterMinutes! > 720 ||
        body.conversationExpireAfterMinutes! < 60 ||
        body.conversationExpireAfterMinutes! > 10080 ||
        body.conversationExpireAfterMinutes! <= body.conversationPauseAfterMinutes!
      ) {
        return reply.status(400).send({
          message: 'La pausa debe ser de 15 minutos a 12 horas y el reinicio debe ocurrir después, hasta 7 días.'
        })
      }
    }

    const updatedBusiness = await prisma.business.update({
      where: {
        id: business.id
      },
      data: {
        ...(typeof body.botEnabled === 'boolean' ? { botEnabled: body.botEnabled } : {}),
        ...(typeof body.aiEnabled === 'boolean' ? { aiEnabled: body.aiEnabled } : {})
      },
      select: {
        id: true,
        botEnabled: true,
        aiEnabled: true
      }
    })

    if (
      typeof body.bookingV2Enabled === 'boolean' ||
      body.serviceCatalogDisplayMode !== undefined ||
      body.bookingFlowOrder !== undefined ||
      hasContextSettings ||
      body.assistantPersonality !== undefined
    ) {
      const assistantPersonality = body.assistantPersonality === undefined
        ? undefined
        : normalizeAssistantPersonality(body.assistantPersonality)
      await prisma.businessFeatureSettings.upsert({
        where: { businessId: business.id },
        create: {
          businessId: business.id,
          ...(typeof body.bookingV2Enabled === 'boolean'
            ? { bookingV2Enabled: body.bookingV2Enabled }
            : {}),
          ...(body.serviceCatalogDisplayMode !== undefined
            ? { serviceCatalogDisplayMode: body.serviceCatalogDisplayMode as 'ALL_SERVICES' | 'CATEGORIES_FIRST' }
            : {}),
          ...(body.bookingFlowOrder !== undefined
            ? { bookingFlowOrder: body.bookingFlowOrder as 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST' }
            : {}),
          ...(hasContextSettings ? {
            conversationPauseAfterMinutes: body.conversationPauseAfterMinutes!,
            conversationExpireAfterMinutes: body.conversationExpireAfterMinutes!
          } : {}),
          ...(assistantPersonality
            ? { assistantPersonality: assistantPersonality as Prisma.InputJsonValue }
            : {})
        },
        update: {
          ...(typeof body.bookingV2Enabled === 'boolean'
            ? { bookingV2Enabled: body.bookingV2Enabled }
            : {}),
          ...(body.serviceCatalogDisplayMode !== undefined
            ? { serviceCatalogDisplayMode: body.serviceCatalogDisplayMode as 'ALL_SERVICES' | 'CATEGORIES_FIRST' }
            : {}),
          ...(body.bookingFlowOrder !== undefined
            ? { bookingFlowOrder: body.bookingFlowOrder as 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST' }
            : {}),
          ...(hasContextSettings ? {
            conversationPauseAfterMinutes: body.conversationPauseAfterMinutes!,
            conversationExpireAfterMinutes: body.conversationExpireAfterMinutes!
          } : {}),
          ...(assistantPersonality
            ? { assistantPersonality: assistantPersonality as Prisma.InputJsonValue }
            : {})
        }
      })
    }

    const featureSettings = await prisma.businessFeatureSettings.findUnique({
      where: { businessId: business.id },
      select: {
        bookingV2Enabled: true,
        serviceCatalogDisplayMode: true,
        bookingFlowOrder: true,
        conversationPauseAfterMinutes: true,
        conversationExpireAfterMinutes: true,
        assistantPersonality: true
      }
    })
    const assistantPersonality = normalizeAssistantPersonality(
      featureSettings?.assistantPersonality
    )
    const contextSettings = normalizeConversationContextSettings(featureSettings)

    return {
      ...updatedBusiness,
      bookingV2Enabled: Boolean(featureSettings?.bookingV2Enabled),
      serviceCatalogDisplayMode: normalizeCatalogDisplayMode(
        featureSettings?.serviceCatalogDisplayMode
      ),
      bookingFlowOrder: normalizeBookingFlowOrder(featureSettings?.bookingFlowOrder),
      conversationPauseAfterMinutes: contextSettings.pauseAfterMinutes,
      conversationExpireAfterMinutes: contextSettings.expireAfterMinutes,
      assistantPersonality,
      assistantPersonalityPreview: assistantPersonalityPreview(assistantPersonality)
    }
  })

  app.get('/crm/conversations/:id/messages', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const query = request.query as {
      take?: string
      cursor?: string
      paginated?: string
    }

    const conversation = await prisma.conversation.findUnique({
      where: {
        id: params.id
      }
    })

    if (!conversation) {
      return reply.status(404).send({
        message: 'No encontre esa conversacion'
      })
    }

    const take = Math.min(Math.max(Number(query.take ?? 100) || 100, 1), 200)
    const messages = await prisma.message.findMany({
      where: {
        conversationId: params.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })

    const hasMore = messages.length > take
    const page = messages.slice(0, take)
    const oldestCursor = page[page.length - 1]?.id ?? null
    const items = page.reverse()

    if (query.paginated !== 'true') {
      return items
    }

    return {
      items,
      nextCursor: hasMore ? oldestCursor : null
    }
  })

  app.get('/crm/messages/:id/media', async (request, reply) => {
    const params = request.params as { id: string }
    const message = await prisma.message.findUnique({
      where: { id: params.id },
      include: {
        conversation: {
          select: { businessId: true }
        }
      }
    })
    const metadata = message?.metadata && typeof message.metadata === 'object'
      ? message.metadata as Record<string, unknown>
      : null
    const media = metadata?.media && typeof metadata.media === 'object'
      ? metadata.media as Record<string, unknown>
      : null
    const mediaId = typeof media?.id === 'string' ? media.id : null
    const rawMediaType = media?.type
    const mediaType = rawMediaType === 'image' || rawMediaType === 'document'
      ? rawMediaType
      : null

    if (!message || !mediaId || !mediaType) {
      return reply.status(404).send({ message: 'No encontre ese archivo' })
    }

    const downloaded = await whatsappCloudApi.downloadMedia({
      businessId: message.conversation.businessId,
      mediaId
    })
    if (!downloaded.downloaded) {
      return reply.status(502).send({
        message: downloaded.errorMessage || downloaded.reason || 'No pude descargar el archivo'
      })
    }

    const rawFilename = media && typeof media.filename === 'string'
      ? media.filename
      : null
    const filename = safeMediaFilename(
      rawFilename,
      downloaded.contentType,
      mediaType
    )
    const disposition = isInlineCrmMedia(downloaded.contentType)
      ? 'inline'
      : 'attachment'

    return reply
      .header('Content-Type', downloaded.contentType)
      .header('Content-Disposition', `${disposition}; filename="${filename}"`)
      .header('Cache-Control', 'private, max-age=300')
      .send(downloaded.data)
  })

  app.patch('/crm/conversations/:id/archive', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { archived?: boolean }
    if (typeof body.archived !== 'boolean') {
      return reply.status(400).send({ message: 'archived debe ser boolean' })
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: params.id } })
    if (!conversation) {
      return reply.status(404).send({ message: 'No encontre esa conversacion' })
    }
    if (body.archived && conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt) {
      return reply.status(409).send({ message: 'Resolve la derivacion antes de archivar la conversacion' })
    }

    return prisma.conversation.update({
      where: { id: params.id },
      data: { archivedAt: body.archived ? new Date() : null }
    })
  })

  app.patch('/crm/conversations/:id/opportunity/close', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { reason?: string; note?: string }
    if (!body.reason || !CONVERSATION_CLOSE_REASONS.includes(body.reason as ConversationCloseReason)) {
      return reply.status(400).send({ message: 'Selecciona un motivo de cierre valido' })
    }

    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    const result = await closeConversationOpportunity({
      conversationId: params.id,
      reason: body.reason as ConversationCloseReason,
      ...(authUser?.role === 'SUPER_ADMIN'
        ? { businessId: null }
        : authUser?.businessId ? { businessId: authUser.businessId } : {}),
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(authUser?.id ? { actorUserId: authUser.id } : {})
    })
    if (!result.ok) return reply.status(result.statusCode).send({ message: result.message })
    return result.conversation
  })

  app.patch('/crm/conversations/:id/ai', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      aiEnabled?: boolean
    }

    if (typeof body.aiEnabled !== 'boolean') {
      return reply.status(400).send({
        message: 'aiEnabled debe ser boolean'
      })
    }

    const conversation = await prisma.conversation.findUnique({
      where: {
        id: params.id
      }
    })

    if (!conversation) {
      return reply.status(404).send({
        message: 'No encontre esa conversacion'
      })
    }

    const isEnablingAi = body.aiEnabled
    const bookingFlowOrder = isEnablingAi
      ? normalizeBookingFlowOrder((await prisma.businessFeatureSettings.findUnique({
          where: { businessId: conversation.businessId },
          select: { bookingFlowOrder: true }
        }))?.bookingFlowOrder)
      : 'PROFESSIONAL_FIRST'
    const preservedState = isEnablingAi
      ? stateFromConversation(conversation)
      : null
    const preservedPatch = preservedState
      ? conversationPatchFromState(preservedState)
      : null
    if (isEnablingAi) {
      const activeDeposit = await prisma.bookingDeposit.findFirst({
        where: {
          conversationId: conversation.id,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        select: { id: true }
      })
      if (activeDeposit) {
        return reply.status(409).send({
          message: 'Aproba o rechaza la seña pendiente antes de resolver la derivacion'
        })
      }
    }

    return prisma.conversation.update({
      where: {
        id: params.id
      },
      data: body.aiEnabled
        ? {
            aiEnabled: true,
            currentStep: conversationStepForPersistedBookingState(preservedState!, bookingFlowOrder),
            ...preservedPatch!,
            bookingV2State: preservedPatch?.bookingV2State
              ? preservedPatch.bookingV2State as Prisma.InputJsonValue
              : Prisma.JsonNull,
            humanHandoffResolvedAt: isEnablingAi ? new Date() : conversation.humanHandoffResolvedAt
          }
        : {
            aiEnabled: false,
            currentStep: 'HUMAN_HANDOFF',
            misunderstandingCount: 0,
            humanHandoffAt: conversation.humanHandoffAt ?? new Date(),
            humanHandoffResolvedAt: null
          }
    })
  })

  app.post('/crm/conversations/:id/service-resolution', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { serviceId?: string | null }
    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })

    const conversation = await prisma.conversation.findUnique({
      where: { id: params.id }
    })
    if (!conversation || !conversation.businessId) {
      return reply.status(404).send({ message: 'No encontre esa conversacion' })
    }
    if (authUser.role !== 'SUPER_ADMIN' && authUser.businessId !== conversation.businessId) {
      return reply.status(403).send({ message: 'No tenes acceso a esa conversacion' })
    }
    if (conversation.currentStep !== 'HUMAN_HANDOFF' || conversation.aiEnabled) {
      return reply.status(409).send({
        message: 'La conversacion no esta esperando la intervencion de un asesor'
      })
    }

    const activeDeposit = await prisma.bookingDeposit.findFirst({
      where: {
        conversationId: conversation.id,
        status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
      },
      select: { id: true }
    })
    if (activeDeposit) {
      return reply.status(409).send({
        message: 'Aproba o rechaza la seña pendiente antes de devolver la conversacion al bot'
      })
    }

    let state = stateFromConversation(conversation)
    if (body.serviceId) {
      const service = await prisma.service.findFirst({
        where: {
          id: body.serviceId,
          businessId: conversation.businessId,
          isBookable: true
        },
        select: {
          id: true,
          validationEnabled: true
        }
      })
      if (!service) {
        return reply.status(404).send({ message: 'No encontre ese servicio reservable' })
      }
      state = acceptField(state, 'service', service.id)
      state = {
        ...state,
        serviceValidation: service.validationEnabled
          ? { serviceId: service.id, stage: 'completed' }
          : null,
        guidedEstimate: null,
        advisorQuote: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
    } else {
      state = {
        ...state,
        draft: clearFieldAndDependents(state.draft, 'service'),
        pendingProposal: null,
        serviceValidation: null,
        guidedEstimate: null,
        advisorQuote: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
    }

    const initialPatch = conversationPatchFromState(state)
    const resumed = await bookingV2Engine.resume({
      businessId: conversation.businessId,
      conversation: {
        ...conversation,
        ...initialPatch,
        bookingV2State: initialPatch.bookingV2State
      }
    })
    if (resumed.plan.type === 'handoff') {
      return reply.status(409).send({
        message: 'Ese servicio requiere que el equipo siga atendiendolo manualmente o cargue un presupuesto'
      })
    }

    const delivery = await sendCrmAutomatedMessage({
      conversationId: conversation.id,
      businessId: conversation.businessId,
      phone: conversation.phone,
      text: resumed.reply,
      provider: body.serviceId
        ? 'crm_advisor_service_resolution'
        : 'crm_advisor_catalog_return'
    })
    if (!delivery.sent) {
      return reply.status(502).send({
        message: 'No pude enviar el siguiente paso por WhatsApp. La conversacion sigue en atencion manual.'
      })
    }

    const patch = resumed.conversationPatch
    const bookingFlowOrder = normalizeBookingFlowOrder((await prisma.businessFeatureSettings.findUnique({
      where: { businessId: conversation.businessId },
      select: { bookingFlowOrder: true }
    }))?.bookingFlowOrder)
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        currentStep: conversationStepForPersistedBookingState(resumed.state, bookingFlowOrder),
        aiEnabled: true,
        lastMessage: resumed.reply,
        humanHandoffResolvedAt: new Date(),
        ...patch,
        bookingV2State: patch.bookingV2State
          ? patch.bookingV2State as Prisma.InputJsonValue
          : Prisma.JsonNull,
        lastAvailability: Prisma.JsonNull
      }
    })
    return conversationWithLatestDeposit(conversation.id)
  })

  app.post('/crm/conversations/:id/advisor-quote', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { amount?: number | string; note?: string | null }
    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    const amount = Number(body.amount)
    const note = body.note?.trim().slice(0, 500) || null
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
      return reply.status(400).send({ message: 'Carga un importe de presupuesto valido' })
    }
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.id }
    })
    if (!conversation || !conversation.businessId) {
      return reply.status(404).send({ message: 'No encontre esa conversacion' })
    }
    if (authUser.role !== 'SUPER_ADMIN' && authUser.businessId !== conversation.businessId) {
      return reply.status(403).send({ message: 'No tenes acceso a esa conversacion' })
    }
    if (conversation.currentStep !== 'HUMAN_HANDOFF' || conversation.aiEnabled) {
      return reply.status(409).send({ message: 'La conversacion no esta esperando la intervencion de un asesor' })
    }
    if (!conversation.selectedServiceId) {
      return reply.status(409).send({ message: 'La conversacion no tiene un servicio seleccionado' })
    }
    const service = await prisma.service.findFirst({
      where: {
        id: conversation.selectedServiceId,
        businessId: conversation.businessId
      },
      select: {
        id: true,
        name: true,
        attentionMode: true,
        requiresPhoto: true
      }
    })
    if (!service) return reply.status(404).send({ message: 'No encontre el servicio seleccionado' })
    if (
      !service.requiresPhoto &&
      service.attentionMode !== 'QUOTE' &&
      service.attentionMode !== 'GUIDED_ESTIMATE'
    ) {
      return reply.status(409).send({ message: 'Ese servicio no requiere un presupuesto del asesor' })
    }

    const quoteText = [
      `El presupuesto para ${service.name} es ${formatCrmMoney(amount)}.`,
      ...(note ? [note] : []),
      '¿Querés continuar con la reserva? Si aceptás, Cami te ayudará a elegir profesional, día y horario.'
    ].join('\n\n')
    const delivery = await sendCrmAutomatedMessage({
      conversationId: conversation.id,
      businessId: conversation.businessId,
      phone: conversation.phone,
      text: quoteText,
      provider: 'crm_advisor_quote'
    })
    if (!delivery.sent) {
      return reply.status(502).send({
        message: 'No pude enviar el presupuesto por WhatsApp. La conversacion sigue en atencion manual.'
      })
    }

    const state = stateFromConversation(conversation)
    const quotedState = {
      ...state,
      agenda: state.agenda.map((item) => {
        if (item.intent === 'request_quote') {
          return { ...item, status: 'completed' as const, blockedBy: null }
        }
        if (item.intent === 'check_availability') {
          return { ...item, status: 'blocked' as const, blockedBy: 'quote_pending' as const }
        }
        return item
      }),
      advisorQuote: {
        serviceId: service.id,
        amount,
        note,
        status: 'awaiting_acceptance' as const,
        quotedAt: new Date().toISOString()
      },
      pendingDeposit: null,
      misunderstandingCount: 0
    }
    const patch = conversationPatchFromState(quotedState)
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        currentStep: 'ASK_SERVICE',
        aiEnabled: true,
        lastMessage: quoteText,
        humanHandoffResolvedAt: new Date(),
        ...patch,
        bookingV2State: patch.bookingV2State as Prisma.InputJsonValue
      }
    })
    return conversationWithLatestDeposit(conversation.id)
  })

  app.post('/crm/conversations/:id/deposit/approve', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    await bookingDepositService.expireOverdue()
    const deposit = await findActiveConversationDeposit(params.id)
    if (!deposit) {
      return reply.status(404).send({ message: 'No hay una seña pendiente para esta conversación' })
    }
    if (authUser.role !== 'SUPER_ADMIN' && authUser.businessId !== deposit.businessId) {
      return reply.status(403).send({ message: 'No tenes acceso a esa seña' })
    }
    if (deposit.status !== 'PROOF_RECEIVED') {
      return reply.status(409).send({ message: 'Todavía no se recibió un comprobante para aprobar' })
    }

    const reviewedAt = new Date()
    const queuedContinuation = advanceToNextQueuedService(
      stateFromConversation(deposit.conversation)
    )
    const resumedContinuation = queuedContinuation
      ? await bookingV2Engine.resume({
          businessId: deposit.businessId,
          conversation: conversationPatchFromState(queuedContinuation.state)
        })
      : null
    const continuationRequiresHandoff = resumedContinuation?.plan.type === 'handoff'
    const bookingFlowOrder = normalizeBookingFlowOrder((await prisma.businessFeatureSettings.findUnique({
      where: { businessId: deposit.businessId },
      select: { bookingFlowOrder: true }
    }))?.bookingFlowOrder)
    const approved = await prisma.$transaction(async (tx) => {
      const heldAppointment = await tx.appointment.findUnique({
        where: { id: deposit.appointmentId },
        select: { status: true }
      })
      if (heldAppointment?.status !== 'PENDING') return false
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          id: deposit.id,
          status: 'PROOF_RECEIVED'
        },
        data: {
          status: 'APPROVED',
          reviewedAt,
          reviewedByUserId: authUser.id,
          rejectionReason: null
        }
      })
      if (!claimed.count) return false
      await tx.appointment.update({
        where: { id: deposit.appointmentId },
        data: { status: 'CONFIRMED' }
      })
      await tx.conversation.update({
        where: { id: deposit.conversationId },
        data: resumedContinuation
          ? {
              currentStep: continuationRequiresHandoff
                ? 'HUMAN_HANDOFF'
                : conversationStepForPersistedBookingState(resumedContinuation.state, bookingFlowOrder),
              aiEnabled: !continuationRequiresHandoff,
              humanHandoffAt: continuationRequiresHandoff ? reviewedAt : deposit.conversation.humanHandoffAt,
              humanHandoffResolvedAt: continuationRequiresHandoff ? null : reviewedAt,
              ...resumedContinuation.conversationPatch,
              bookingV2State: resumedContinuation.conversationPatch.bookingV2State
                ? resumedContinuation.conversationPatch.bookingV2State as Prisma.InputJsonValue
                : Prisma.JsonNull,
              lastAvailability: resumedContinuation.availabilityOptions.length
                ? {
                    serviceId: resumedContinuation.state.draft.service,
                    professionalId: resumedContinuation.state.draft.professional,
                    date: resumedContinuation.state.draft.date,
                    options: resumedContinuation.availabilityOptions
                  } as Prisma.InputJsonValue
                : Prisma.JsonNull
            }
          : {
              currentStep: 'COMPLETED',
              aiEnabled: true,
              humanHandoffResolvedAt: reviewedAt,
              bookingV2State: Prisma.JsonNull,
              lastAvailability: Prisma.JsonNull
            }
      })
      return true
    })
    if (!approved) {
      return reply.status(409).send({ message: 'La seña ya fue revisada o la retención venció' })
    }
    try {
      await markConversationOpportunityConverted({
        businessId: deposit.businessId,
        customerPhone: deposit.appointment.customer.phone,
        appointmentId: deposit.appointmentId
      })
    } catch (error) {
      console.error('No pude vincular el turno confirmado por seña con la oportunidad', error)
    }
    const confirmedServiceNames = deposit.appointment.serviceItems.length
      ? deposit.appointment.serviceItems.map((item) => item.service.name).join(' + ')
      : deposit.appointment.service.name
    const confirmationText = `¡Listo! Confirmamos tu seña y el turno de ${confirmedServiceNames} para ${formatDepositAppointmentDate(deposit.appointment.startAt)} con ${deposit.appointment.professional.name}.`
    const nextService = queuedContinuation
      ? await prisma.service.findFirst({
          where: {
            id: queuedContinuation.nextService.serviceId,
            businessId: deposit.businessId
          },
          select: { name: true }
        })
      : null
    await sendCrmAutomatedMessage({
      conversationId: deposit.conversationId,
      businessId: deposit.businessId,
      phone: deposit.conversation.phone,
      text: resumedContinuation && nextService
        ? [
            confirmationText,
            `Ahora seguimos con la reserva de ${nextService.name}.`,
            resumedContinuation.reply
          ].join('\n\n')
        : confirmationText,
      provider: 'crm_deposit_review'
    })
    return conversationWithLatestDeposit(deposit.conversationId)
  })

  app.post('/crm/conversations/:id/deposit/reject', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { reason?: string }
    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    await bookingDepositService.expireOverdue()
    const deposit = await findActiveConversationDeposit(params.id)
    if (!deposit) {
      return reply.status(404).send({ message: 'No hay una seña pendiente para esta conversación' })
    }
    if (authUser.role !== 'SUPER_ADMIN' && authUser.businessId !== deposit.businessId) {
      return reply.status(403).send({ message: 'No tenes acceso a esa seña' })
    }
    const reason = body.reason?.trim().slice(0, 300) || 'No pudimos validar el comprobante'
    const reviewedAt = new Date()
    const rejected = await prisma.$transaction(async (tx) => {
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          id: deposit.id,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        data: {
          status: 'REJECTED',
          reviewedAt,
          reviewedByUserId: authUser.id,
          rejectionReason: reason
        }
      })
      if (!claimed.count) return false
      await tx.appointment.update({
        where: { id: deposit.appointmentId },
        data: { status: 'CANCELLED' }
      })
      await tx.conversation.update({
        where: { id: deposit.conversationId },
        data: {
          bookingV2State: Prisma.JsonNull,
          lastAvailability: Prisma.JsonNull
        }
      })
      return true
    })
    if (!rejected) {
      return reply.status(409).send({ message: 'La seña ya fue revisada o la retención venció' })
    }
    await sendCrmAutomatedMessage({
      conversationId: deposit.conversationId,
      businessId: deposit.businessId,
      phone: deposit.conversation.phone,
      text: `No pudimos validar el comprobante de la seña: ${reason}. Liberamos el horario para evitar una confirmación incorrecta. El equipo te ayudará a resolverlo por acá.`,
      provider: 'crm_deposit_review'
    })
    return conversationWithLatestDeposit(deposit.conversationId)
  })

  app.post('/crm/conversations/:id/manual-replies', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      text?: string
      sendWhatsApp?: boolean
    }

    const text = body.text?.trim()

    if (!text) {
      return reply.status(400).send({
        message: 'text es requerido'
      })
    }

    const conversation = await prisma.conversation.findUnique({
      where: {
        id: params.id
      }
    })

    if (!conversation) {
      return reply.status(404).send({
        message: 'No encontre esa conversacion'
      })
    }

    const shouldSendWhatsApp = body.sendWhatsApp !== false
    if (shouldSendWhatsApp) {
      const latestInbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: 'INBOUND'
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          createdAt: true
        }
      })
      const replyWindowExpiresAt = latestInbound
        ? new Date(latestInbound.createdAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)
        : null

      if (!replyWindowExpiresAt || replyWindowExpiresAt.getTime() <= Date.now()) {
        return reply.status(409).send({
          message: 'La ventana de WhatsApp de 24 hs ya vencio. Para volver a escribir, espera que el cliente envie un mensaje o usa una plantilla aprobada.',
          reason: 'whatsapp_reply_window_expired',
          lastInboundMessageAt: latestInbound?.createdAt ?? null,
          replyWindowExpiresAt
        })
      }
    }
    if (shouldSendWhatsApp) {
      if (!conversation.businessId) return reply.status(409).send({ message: 'La conversacion no tiene comercio asociado para resolver WhatsApp.' })
      const gate = await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT')
      if (!gate.allowed) return reply.status(409).send({ message: gate.message })
    }
    const deliveryResult = shouldSendWhatsApp
      ? await whatsappCloudApi.sendTextMessage({
          businessId: conversation.businessId,
          to: conversation.phone,
          text
        })
      : {
          sent: false,
          to: conversation.phone,
          reason: 'Envio por WhatsApp omitido desde CRM'
        }

    const providerMessageId = shouldSendWhatsApp
      ? getOutgoingProviderMessageId(deliveryResult)
      : null
    const messageData = {
      conversationId: conversation.id,
      phone: conversation.phone,
      direction: 'OUTBOUND' as const,
      body: text,
      status: shouldSendWhatsApp
        ? deliveryResult.sent ? 'sent' : 'failed'
        : 'manual',
      metadata: {
        provider: 'crm_manual',
        delivery: deliveryResult
      },
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(!deliveryResult.sent && 'status' in deliveryResult && deliveryResult.status
        ? { providerStatusCode: deliveryResult.status }
        : {}),
      ...(!deliveryResult.sent && 'errorCode' in deliveryResult && deliveryResult.errorCode
        ? { providerErrorCode: deliveryResult.errorCode }
        : {}),
      ...(!deliveryResult.sent && 'errorMessage' in deliveryResult && deliveryResult.errorMessage
        ? { providerErrorMessage: deliveryResult.errorMessage }
        : {})
    }

    const message = await prisma.message.create({
      data: messageData
    })

    await prisma.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        lastMessage: text,
        archivedAt: null,
        humanHandoffResolvedAt: conversation.currentStep === 'HUMAN_HANDOFF'
          ? new Date()
          : conversation.humanHandoffResolvedAt
      }
    })

    return {
      message,
      delivery: deliveryResult
    }
  })
}

async function archiveOldCompletedConversations(businessId?: string) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  await prisma.conversation.updateMany({
    where: {
      ...(businessId ? { businessId } : {}),
      archivedAt: null,
      currentStep: 'COMPLETED',
      updatedAt: { lt: cutoff }
    },
    data: {
      archivedAt: new Date()
    }
  })
}

async function findCrmBusiness(businessId?: string) {
  if (businessId) {
    return prisma.business.findUnique({
      where: {
        id: businessId
      }
    })
  }

  return prisma.business.findFirst({
    orderBy: {
      createdAt: 'asc'
    }
  })
}

function conversationListWhere(input: {
  businessId?: string
  phone?: string
  archiveView: 'active' | 'archived' | 'all'
  filter?: 'handoff'
}) {
  return {
    ...(input.businessId ? { businessId: input.businessId } : {}),
    ...(input.phone ? { phone: { contains: input.phone } } : {}),
    ...(input.archiveView === 'active' ? { archivedAt: null } : {}),
    ...(input.archiveView === 'archived' ? { archivedAt: { not: null } } : {}),
    ...(input.filter === 'handoff'
      ? {
          currentStep: 'HUMAN_HANDOFF',
          humanHandoffResolvedAt: null
        }
      : {})
  } satisfies Prisma.ConversationWhereInput
}

async function conversationCounts(businessId?: string) {
  const countWhere: Prisma.ConversationWhereInput = businessId
    ? { businessId }
    : {}
  const [active, archived, handoff] = await Promise.all([
    prisma.conversation.count({ where: { ...countWhere, archivedAt: null } }),
    prisma.conversation.count({ where: { ...countWhere, archivedAt: { not: null } } }),
    prisma.conversation.count({
      where: {
        ...countWhere,
        archivedAt: null,
        currentStep: 'HUMAN_HANDOFF',
        humanHandoffResolvedAt: null
      }
    })
  ])

  return { active, archived, handoff }
}

async function latestConversationActivityAtForBusiness(businessId?: string) {
  const latestConversation = await prisma.conversation.findFirst({
    where: businessId ? { businessId } : {},
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true }
  })

  return latestConversation?.updatedAt ?? null
}

async function attachConversationReplyWindow<T extends {
  id: string
}>(items: T[]) {
  const latestInboundByConversationId = new Map<string, Date | null>()
  if (items.length > 0) {
    const latestInboundMessages = await prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: {
          in: items.map((conversation) => conversation.id)
        },
        direction: 'INBOUND'
      },
      _max: {
        createdAt: true
      }
    })
    for (const item of latestInboundMessages) {
      latestInboundByConversationId.set(item.conversationId, item._max.createdAt)
    }
  }

  return items.map((conversation) => {
    const lastInboundMessageAt = latestInboundByConversationId.get(conversation.id) ?? null
    const whatsappReplyWindowExpiresAt = lastInboundMessageAt
      ? new Date(lastInboundMessageAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)
      : null

    return {
      ...conversation,
      lastInboundMessageAt,
      whatsappReplyWindowExpiresAt,
      canReplyOnWhatsApp: Boolean(whatsappReplyWindowExpiresAt && whatsappReplyWindowExpiresAt.getTime() > Date.now())
    }
  })
}

function parseOptionalDate(value?: string) {
  if (!value) return null
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function latestConversationActivityAt(conversation: {
  updatedAt: Date
  messages: Array<{
    createdAt: Date
  }>
}) {
  return conversation.messages[0]?.createdAt.getTime() ?? conversation.updatedAt.getTime()
}

function getOutgoingProviderMessageId(deliveryResult: Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>>) {
  if (!deliveryResult.sent) {
    return undefined
  }

  const response = deliveryResult.response as {
    messages?: Array<{
      id?: string
    }>
  }

  return response.messages?.[0]?.id
}

async function findActiveConversationDeposit(conversationId: string) {
  return prisma.bookingDeposit.findFirst({
    where: {
      conversationId,
      status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
    },
    include: {
      conversation: true,
      appointment: {
        include: {
          customer: true,
          professional: true,
          service: true,
          serviceItems: {
            include: { service: true },
            orderBy: { sortOrder: 'asc' }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

async function conversationWithLatestDeposit(conversationId: string) {
  const [conversation, latestMessage] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        bookingDeposits: {
          include: {
            appointment: {
              include: {
                customer: true,
                professional: true,
                service: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    }),
    prisma.message.findFirst({
      where: { conversationId },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ]
    })
  ])

  if (!conversation) return null

  return {
    ...conversation,
    messages: latestMessage ? [latestMessage] : []
  }
}

async function latestMessagesByConversationId(conversationIds: string[]) {
  if (conversationIds.length === 0) return new Map<string, Message>()

  const messages = await prisma.$queryRaw<Message[]>(Prisma.sql`
    SELECT DISTINCT ON ("conversationId") "Message".*
    FROM "Message"
    WHERE "conversationId" IN (${Prisma.join(conversationIds)})
    ORDER BY "conversationId", "createdAt" DESC, "id" DESC
  `)

  return new Map(messages.map((message) => [message.conversationId, message]))
}

async function sendCrmAutomatedMessage(input: {
  conversationId: string
  businessId: string
  phone: string
  text: string
  provider: string
}) {
  const gate = await assertBusinessCanSendWhatsApp(input.businessId, 'BOT')
  const delivery = gate.allowed
    ? await whatsappCloudApi.sendTextMessage({
        businessId: input.businessId,
        to: input.phone,
        text: input.text
      })
    : {
        sent: false as const,
        to: input.phone,
        reason: gate.message
      }
  await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      phone: input.phone,
      direction: 'OUTBOUND',
      body: input.text,
      status: delivery.sent ? 'sent' : 'failed',
      metadata: {
        provider: input.provider,
        delivery
      }
    }
  })
  return delivery
}

function formatDepositAppointmentDate(startAt: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires'
  }).format(startAt)
}

function formatCrmMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}
