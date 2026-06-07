import { whatsappConfig } from '../config/whatsapp.js'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { ConversationService } from './conversation-service.js'

type VerifyWebhookInput = {
  mode: string | undefined
  token: string | undefined
  challenge: string | undefined
}

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string
          from?: string
          type?: string
          text?: {
            body?: string
          }
        }>
      }
    }>
  }>
}

const conversationService = new ConversationService()
const whatsappCloudApi = new WhatsAppCloudApi()

export class WhatsAppWebhookService {
  verifyWebhook(input: VerifyWebhookInput) {
    if (
      input.mode === 'subscribe' &&
      input.token === whatsappConfig.verifyToken &&
      input.challenge
    ) {
      return {
        verified: true,
        challenge: input.challenge
      }
    }

    return {
      verified: false
    }
  }

  async handleWebhook(payload: WhatsAppWebhookPayload = {}) {
    const messages = this.extractTextMessages(payload)
    const results = []

    console.info('[whatsapp-webhook] received payload', {
      entries: payload.entry?.length ?? 0,
      textMessages: messages.length
    })

    for (const message of messages) {
      console.info('[whatsapp-webhook] processing text message', {
        messageId: message.id,
        from: message.from
      })

      if (message.id) {
        const existingMessage = await prisma.message.findUnique({
          where: {
            providerMessageId: message.id
          }
        })

        if (existingMessage) {
          console.info('[whatsapp-webhook] skipped duplicate message', {
            messageId: message.id,
            from: message.from
          })

          results.push({
            messageId: message.id,
            from: message.from,
            skipped: true,
            reason: 'Mensaje duplicado'
          })

          continue
        }
      }

      const conversation = await prisma.conversation.upsert({
        where: {
          phone: message.from
        },
        update: {},
        create: {
          phone: message.from
        }
      })

      const inboundMessageData: {
        conversationId: string
        phone: string
        direction: 'INBOUND'
        body: string
        providerMessageId?: string
        status: string
        metadata: {
          provider: string
        }
      } = {
        conversationId: conversation.id,
        phone: message.from,
        direction: 'INBOUND',
        body: message.text,
        status: 'received',
        metadata: {
          provider: 'whatsapp'
        }
      }

      if (message.id) {
        inboundMessageData.providerMessageId = message.id
      }

      await prisma.message.create({
        data: inboundMessageData
      })

      console.info('[whatsapp-webhook] saved inbound message', {
        messageId: message.id,
        from: message.from,
        conversationId: conversation.id
      })

      const conversationResult = await conversationService.handleMessage({
        phone: message.from,
        message: message.text
      })

      const deliveryResult = await whatsappCloudApi.sendTextMessage({
        to: message.from,
        text: conversationResult.reply
      })

      const outgoingProviderMessageId = getOutgoingProviderMessageId(deliveryResult)
      const outboundMessageData: {
        conversationId: string
        phone: string
        direction: 'OUTBOUND'
        body: string
        providerMessageId?: string
        status: string
        providerStatusCode?: number
        providerErrorCode?: string
        providerErrorMessage?: string
        metadata: Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>>
      } = {
        conversationId: conversation.id,
        phone: message.from,
        direction: 'OUTBOUND',
        body: conversationResult.reply,
        status: deliveryResult.sent ? 'sent' : 'failed',
        metadata: deliveryResult
      }

      if (outgoingProviderMessageId) {
        outboundMessageData.providerMessageId = outgoingProviderMessageId
      }

      if (!deliveryResult.sent) {
        if ('status' in deliveryResult && deliveryResult.status) {
          outboundMessageData.providerStatusCode = deliveryResult.status
        }

        if ('errorCode' in deliveryResult && deliveryResult.errorCode) {
          outboundMessageData.providerErrorCode = deliveryResult.errorCode
        }

        if ('errorMessage' in deliveryResult && deliveryResult.errorMessage) {
          outboundMessageData.providerErrorMessage = deliveryResult.errorMessage
        }
      }

      await prisma.message.create({
        data: outboundMessageData
      })

      console.info('[whatsapp-webhook] saved outbound reply', {
        messageId: outgoingProviderMessageId,
        to: message.from,
        sent: deliveryResult.sent,
        conversationId: conversation.id
      })

      results.push({
        messageId: message.id,
        from: message.from,
        reply: conversationResult.reply,
        delivery: deliveryResult
      })
    }

    return {
      status: 'ok',
      processed: results.length,
      results
    }
  }

  private extractTextMessages(payload: WhatsAppWebhookPayload) {
    const messages: Array<{
      id?: string
      from: string
      text: string
    }> = []

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== 'text' || !message.from || !message.text?.body) {
            continue
          }

          const textMessage: {
            id?: string
            from: string
            text: string
          } = {
            from: message.from,
            text: message.text.body
          }

          if (message.id) {
            textMessage.id = message.id
          }

          messages.push(textMessage)
        }
      }
    }

    return messages
  }
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
