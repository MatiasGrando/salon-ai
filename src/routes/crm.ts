import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'

const whatsappCloudApi = new WhatsAppCloudApi()

export async function crmRoutes(app: FastifyInstance) {
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
    }
    const take = Math.min(Number(query.take ?? 50) || 50, 100)

    const conversations = await prisma.conversation.findMany({
      where: {
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.phone ? { phone: { contains: query.phone } } : {})
      },
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
      take
    })

    return conversations.sort((left, right) => {
      return latestConversationActivityAt(right) - latestConversationActivityAt(left)
    })
  })

  app.get('/crm/ai-settings', async (request) => {
    const query = request.query as {
      businessId?: string
    }

    const business = await findCrmBusiness(query.businessId)

    return {
      businessId: business?.id ?? null,
      aiEnabled: business?.aiEnabled ?? true
    }
  })

  app.patch('/crm/ai-settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      aiEnabled?: boolean
    }

    if (typeof body.aiEnabled !== 'boolean') {
      return reply.status(400).send({
        message: 'aiEnabled debe ser boolean'
      })
    }

    const business = await findCrmBusiness(body.businessId)

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre un negocio cargado'
      })
    }

    return prisma.business.update({
      where: {
        id: business.id
      },
      data: {
        aiEnabled: body.aiEnabled
      },
      select: {
        id: true,
        aiEnabled: true
      }
    })
  })

  app.get('/crm/conversations/:id/messages', async (request, reply) => {
    const params = request.params as {
      id: string
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

    return prisma.message.findMany({
      where: {
        conversationId: params.id
      },
      orderBy: {
        createdAt: 'asc'
      }
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

    return prisma.conversation.update({
      where: {
        id: params.id
      },
      data: body.aiEnabled
        ? {
            aiEnabled: true,
            currentStep: conversation.currentStep === 'HUMAN_HANDOFF' ? 'START' : conversation.currentStep,
            humanHandoffResolvedAt: conversation.currentStep === 'HUMAN_HANDOFF' ? new Date() : conversation.humanHandoffResolvedAt
          }
        : {
            aiEnabled: false,
            currentStep: 'HUMAN_HANDOFF',
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
    const deliveryResult = shouldSendWhatsApp
      ? await whatsappCloudApi.sendTextMessage({
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
