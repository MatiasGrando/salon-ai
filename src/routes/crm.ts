import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'

const whatsappCloudApi = new WhatsAppCloudApi()

export async function crmRoutes(app: FastifyInstance) {
  app.get('/crm/conversations', async (request) => {
    const query = request.query as {
      businessId?: string
      phone?: string
      take?: string
    }
    const take = Math.min(Number(query.take ?? 50) || 50, 100)

    return prisma.conversation.findMany({
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
        lastMessage: text
      }
    })

    return {
      message,
      delivery: deliveryResult
    }
  })
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
