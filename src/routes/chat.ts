import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { ConversationService } from '../services/conversation-service.js'
import { reopenClosedConversationOpportunity } from '../services/conversation-opportunity-service.js'
import { capturePostSaleResponse } from '../services/post-sale-service.js'

const service = new ConversationService()

export async function chatRoutes(app: FastifyInstance) {

  app.post('/chat', async (request) => {

    const body = request.body as {
      phone: string
      message: string
      businessId?: string
    }

    const targetBusiness = body.businessId
      ? await prisma.business.findUnique({
          where: { id: body.businessId },
          select: { id: true }
        })
      : await prisma.business.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true }
        })

    if (!targetBusiness) {
      return {
        reply: null,
        skipped: true,
        reason: 'No hay un comercio asociado al chat'
      }
    }

    const conversation = await prisma.conversation.upsert({
      where: {
        businessId_phone: {
          businessId: targetBusiness.id,
          phone: body.phone
        }
      },
      update: {},
      create: {
        phone: body.phone,
        businessId: targetBusiness.id
      }
    })

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        phone: body.phone,
        direction: 'INBOUND',
        body: body.message,
        status: 'received',
        metadata: {
          provider: 'internal_chat'
        }
      }
    })

    await reopenClosedConversationOpportunity(conversation.id)

    const freshConversation = await prisma.conversation.findUnique({
      where: {
        id: conversation.id
      },
      include: {
        business: true
      }
    })
    const businessBotEnabled = freshConversation?.business?.botEnabled ?? true
    const businessAiEnabled = freshConversation?.business?.aiEnabled ?? true

    const postSaleResponse = await capturePostSaleResponse({
      conversationId: conversation.id,
      phone: body.phone,
      message: body.message,
      businessId: freshConversation?.businessId ?? null
    })
    if (postSaleResponse.captured) {
      if (postSaleResponse.reply) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            phone: body.phone,
            direction: 'OUTBOUND',
            body: postSaleResponse.reply,
            status: 'sent',
            metadata: { provider: 'internal_chat', automation: 'post_sale' }
          }
        })
      }
      return {
        reply: postSaleResponse.reply,
        postSale: true,
        rating: postSaleResponse.rating,
        commentCaptured: postSaleResponse.commentCaptured
      }
    }

    if (freshConversation?.currentStep === 'HUMAN_HANDOFF') {
      await prisma.conversation.update({
        where: {
          id: conversation.id
        },
        data: {
          humanHandoffResolvedAt: null
        }
      })
    }

    if (!businessBotEnabled) {
      return {
        reply: null,
        skipped: true,
        reason: 'Bot desactivado'
      }
    }

    if (freshConversation?.aiEnabled === false) {
      return {
        reply: null,
        skipped: true,
        reason: 'Atencion manual'
      }
    }

    const result = await service.handleMessage({
      phone: body.phone,
      message: body.message,
      businessId: targetBusiness.id,
      useAi: businessAiEnabled
    })

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        phone: body.phone,
        direction: 'OUTBOUND',
        body: result.reply,
        status: 'sent',
        metadata: {
          provider: 'internal_chat'
        }
      }
    })

    return result
  })

}
