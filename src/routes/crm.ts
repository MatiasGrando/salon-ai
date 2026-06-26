import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from '../services/business-whatsapp-settings.js'

const whatsappCloudApi = new WhatsAppCloudApi()
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

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
      paginated?: string
    }
    const take = Math.min(Math.max(Number(query.take ?? 30) || 30, 1), 100)
    const archiveView = query.archive ?? 'all'
    await archiveOldCompletedConversations(query.businessId)

    const since = parseOptionalDate(query.since)
    const where: Prisma.ConversationWhereInput = {
      ...conversationListWhere({
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.phone ? { phone: query.phone } : {}),
        archiveView
      }),
      ...(since ? { updatedAt: { gt: since } } : {})
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        messages: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })

    const hasMore = conversations.length > take
    const items = conversations.slice(0, take).sort((left, right) => {
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

    return {
      businessId: business?.id ?? null,
      botEnabled: business?.botEnabled ?? true,
      aiEnabled: business?.aiEnabled ?? true,
      bookingV2Enabled: business
        ? Boolean(await prisma.businessFeatureSettings.findUnique({
            where: { businessId: business.id },
            select: { bookingV2Enabled: true }
          }).then((settings) => settings?.bookingV2Enabled))
        : false
    }
  })

  app.patch('/crm/ai-settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      botEnabled?: boolean
      aiEnabled?: boolean
      bookingV2Enabled?: boolean
    }

    if (
      typeof body.botEnabled !== 'boolean' &&
      typeof body.aiEnabled !== 'boolean' &&
      typeof body.bookingV2Enabled !== 'boolean'
    ) {
      return reply.status(400).send({
        message: 'botEnabled, aiEnabled o bookingV2Enabled debe ser boolean'
      })
    }

    const business = await findCrmBusiness(body.businessId)

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre un negocio cargado'
      })
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

    if (typeof body.bookingV2Enabled === 'boolean') {
      await prisma.businessFeatureSettings.upsert({
        where: { businessId: business.id },
        create: {
          businessId: business.id,
          bookingV2Enabled: body.bookingV2Enabled
        },
        update: {
          bookingV2Enabled: body.bookingV2Enabled
        }
      })
    }

    const featureSettings = await prisma.businessFeatureSettings.findUnique({
      where: { businessId: business.id },
      select: { bookingV2Enabled: true }
    })

    return {
      ...updatedBusiness,
      bookingV2Enabled: Boolean(featureSettings?.bookingV2Enabled)
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

    return prisma.conversation.update({
      where: {
        id: params.id
      },
      data: body.aiEnabled
        ? {
            aiEnabled: true,
            currentStep: 'START',
            selectedServiceId: null,
            selectedProfessionalId: null,
            selectedDate: null,
            selectedTime: null,
            lastAvailability: Prisma.JsonNull,
            misunderstandingCount: 0,
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
}) {
  return {
    ...(input.businessId ? { businessId: input.businessId } : {}),
    ...(input.phone ? { phone: { contains: input.phone } } : {}),
    ...(input.archiveView === 'active' ? { archivedAt: null } : {}),
    ...(input.archiveView === 'archived' ? { archivedAt: { not: null } } : {})
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
