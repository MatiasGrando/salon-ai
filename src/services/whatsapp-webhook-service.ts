import { whatsappConfig } from '../config/whatsapp.js'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'
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
        metadata?: {
          display_phone_number?: string
          phone_number_id?: string
        }
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
      const targetBusiness = await this.resolveTargetBusiness(message)
      const targetBusinessId = targetBusiness?.businessId ?? null

      console.info('[whatsapp-webhook] processing text message', {
        messageId: message.id,
        from: message.from,
        phoneNumberId: message.phoneNumberId,
        businessId: targetBusinessId
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
        update: targetBusinessId
          ? {
              businessId: targetBusinessId
            }
          : {},
        create: {
          phone: message.from,
          ...(targetBusinessId ? { businessId: targetBusinessId } : {})
        },
        include: {
          business: true
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
          phoneNumberId?: string
          displayPhoneNumber?: string
        }
      } = {
        conversationId: conversation.id,
        phone: message.from,
        direction: 'INBOUND',
        body: message.text,
        status: 'received',
        metadata: {
          provider: 'whatsapp',
          ...(message.phoneNumberId ? { phoneNumberId: message.phoneNumberId } : {}),
          ...(message.displayPhoneNumber ? { displayPhoneNumber: message.displayPhoneNumber } : {})
        }
      }

      if (message.id) {
        inboundMessageData.providerMessageId = message.id
      }

      await prisma.message.create({
        data: inboundMessageData
      })

      await prisma.conversation.update({
        where: {
          id: conversation.id
        },
        data: {
          lastMessage: message.text,
          archivedAt: null,
          updatedAt: new Date()
        }
      })

      const marketingOptOutApplied = await this.applyMarketingOptOut({
        businessId: conversation.businessId,
        phone: message.from,
        text: message.text
      })
      if (marketingOptOutApplied) {
        const replyText = 'Listo. No vas a recibir más promociones. Los mensajes relacionados con tus turnos seguirán funcionando.'
        const gate = conversation.businessId ? await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT') : null
        const deliveryResult = gate?.allowed
          ? await whatsappCloudApi.sendTextMessage({ businessId: conversation.businessId, to: message.from, text: replyText })
          : { sent: false as const, to: message.from, reason: gate?.message || 'La conversacion no tiene comercio asociado para resolver WhatsApp.' }
        const providerMessageId = getOutgoingProviderMessageId(deliveryResult)
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            phone: message.from,
            direction: 'OUTBOUND',
            body: replyText,
            status: deliveryResult.sent ? 'sent' : 'failed',
            ...(providerMessageId ? { providerMessageId } : {}),
            metadata: deliveryResult
          }
        })
        results.push({
          messageId: message.id,
          from: message.from,
          reply: replyText,
          marketingOptOut: true,
          delivery: deliveryResult
        })
        continue
      }

      console.info('[whatsapp-webhook] saved inbound message', {
        messageId: message.id,
        from: message.from,
        conversationId: conversation.id
      })

      if (conversation.currentStep === 'HUMAN_HANDOFF') {
        await prisma.conversation.update({
          where: {
            id: conversation.id
          },
          data: {
            humanHandoffResolvedAt: null
          }
        })
      }

      const businessBotEnabled = conversation.business
        ? conversation.business.botEnabled
        : await this.isDefaultBusinessBotEnabled()

      if (!businessBotEnabled) {
        console.info('[whatsapp-webhook] skipped automatic reply because bot is disabled', {
          from: message.from,
          conversationId: conversation.id,
          businessBotEnabled
        })

        results.push({
          messageId: message.id,
          from: message.from,
          skipped: true,
          reason: 'Bot desactivado'
        })

        continue
      }

      const businessAiEnabled = conversation.business
        ? conversation.business.aiEnabled
        : await this.isDefaultBusinessAiEnabled()

      if (!conversation.aiEnabled) {
        console.info('[whatsapp-webhook] skipped automatic reply because conversation is in manual mode', {
          from: message.from,
          conversationId: conversation.id,
          conversationAiEnabled: conversation.aiEnabled
        })

        results.push({
          messageId: message.id,
          from: message.from,
          skipped: true,
          reason: 'Atencion manual'
        })

        continue
      }

      const conversationResult = await conversationService.handleMessage({
        phone: message.from,
        message: message.text,
        ...(conversation.businessId ? { businessId: conversation.businessId } : {}),
        useAi: businessAiEnabled
      })

      const gate = conversation.businessId ? await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT') : null
      const deliveryResult = gate?.allowed
        ? await whatsappCloudApi.sendTextMessage({
            businessId: conversation.businessId,
            to: message.from,
            text: conversationResult.reply
          })
        : { sent: false as const, to: message.from, reason: gate?.message || 'La conversacion no tiene comercio asociado para resolver WhatsApp.' }

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
      phoneNumberId?: string
      displayPhoneNumber?: string
    }> = []

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const metadata = change.value?.metadata
        for (const message of change.value?.messages ?? []) {
          if (message.type !== 'text' || !message.from || !message.text?.body) {
            continue
          }

          const textMessage: {
            id?: string
            from: string
            text: string
            phoneNumberId?: string
            displayPhoneNumber?: string
          } = {
            from: message.from,
            text: message.text.body,
            ...(metadata?.phone_number_id ? { phoneNumberId: metadata.phone_number_id } : {}),
            ...(metadata?.display_phone_number ? { displayPhoneNumber: metadata.display_phone_number } : {})
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

  private async resolveTargetBusiness(message: { phoneNumberId?: string; displayPhoneNumber?: string }) {
    const normalizedDisplayPhoneNumber = normalizeWhatsAppPhone(message.displayPhoneNumber)
    let targetBusiness = message.phoneNumberId
      ? await prisma.businessWhatsAppConfig.findFirst({
          where: {
            phoneNumberId: message.phoneNumberId
          },
          select: {
            businessId: true
          }
        })
      : null

    if (!targetBusiness && normalizedDisplayPhoneNumber) {
      const candidates = await prisma.businessWhatsAppConfig.findMany({
        where: {
          displayPhoneNumber: {
            not: null
          }
        },
        select: {
          businessId: true,
          displayPhoneNumber: true
        }
      })
      targetBusiness = candidates.find((candidate) => {
        return normalizeWhatsAppPhone(candidate.displayPhoneNumber) === normalizedDisplayPhoneNumber
      }) ?? null
    }

    if (!targetBusiness) {
      console.warn('[whatsapp-webhook] no business matched incoming whatsapp number', {
        phoneNumberId: message.phoneNumberId,
        displayPhoneNumber: message.displayPhoneNumber,
        normalizedDisplayPhoneNumber
      })
    }

    return targetBusiness
  }

  private async applyMarketingOptOut(input: { businessId: string | null; phone: string; text: string }) {
    if (!isMarketingOptOutMessage(input.text)) return false
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        phone: true,
        appointments: {
          select: { professional: { select: { businessId: true } } },
          orderBy: { startAt: 'desc' },
          take: 5
        }
      }
    })
    const customer = customers.find((item) => normalizeMarketingPhone(item.phone) === normalizeMarketingPhone(input.phone))
    if (!customer) return false
    const customerBusinessIds = customer.appointments.map((appointment) => appointment.professional.businessId)
    const businessId = input.businessId && customerBusinessIds.includes(input.businessId)
      ? input.businessId
      : customerBusinessIds[0] ?? input.businessId ?? await this.defaultBusinessId()
    if (!businessId) return false

    await prisma.customerMarketingPreference.upsert({
      where: { businessId_customerId: { businessId, customerId: customer.id } },
      create: {
        businessId,
        customerId: customer.id,
        status: 'OPTED_OUT',
        source: 'WHATSAPP',
        optedOutAt: new Date()
      },
      update: {
        status: 'OPTED_OUT',
        source: 'WHATSAPP',
        optedOutAt: new Date()
      }
    })
    return true
  }

  private async defaultBusinessId() {
    const business = await prisma.business.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    })
    return business?.id ?? null
  }

  private async isDefaultBusinessAiEnabled() {
    const business = await prisma.business.findFirst({
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        aiEnabled: true
      }
    })

    return business?.aiEnabled ?? true
  }

  private async isDefaultBusinessBotEnabled() {
    const business = await prisma.business.findFirst({
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        botEnabled: true
      }
    })

    return business?.botEnabled ?? true
  }
}

function isMarketingOptOutMessage(text: string) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return [
    'baja',
    'stop',
    'no quiero recibir promociones',
    'no recibir promociones',
    'dejar de recibir promociones',
    'cancelar promociones'
  ].includes(normalized)
}

function normalizeMarketingPhone(phone: string) {
  return phone.replace(/\D/g, '')
}

function normalizeWhatsAppPhone(phone?: string | null) {
  return phone?.replace(/\D/g, '') || null
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
