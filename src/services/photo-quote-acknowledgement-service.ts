import { prisma as defaultPrisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'

export const PHOTO_QUOTE_ACKNOWLEDGEMENT = 'Recibí las imágenes 😊 Podés enviar una o varias; el equipo las revisará juntas y en breve te pasará el presupuesto por acá.'

type WhatsAppSender = Pick<WhatsAppCloudApi, 'sendTextMessage'>
type SendGate = typeof assertBusinessCanSendWhatsApp

export class PhotoQuoteAcknowledgementService {
  constructor(
    private readonly db: typeof defaultPrisma = defaultPrisma,
    private readonly sender: WhatsAppSender = new WhatsAppCloudApi(),
    private readonly sendGate: SendGate = assertBusinessCanSendWhatsApp
  ) {}

  async acknowledge(input: {
    conversationId: string
    businessId: string | null
    phone: string
    selectedServiceId: string | null
  }) {
    if (!input.businessId || !input.selectedServiceId) return null
    const service = await this.db.service.findFirst({
      where: {
        id: input.selectedServiceId,
        businessId: input.businessId,
        requiresPhoto: true
      },
      select: { id: true }
    })
    if (!service) return null

    const claimed = await this.db.conversation.updateMany({
      where: {
        id: input.conversationId,
        currentStep: 'HUMAN_HANDOFF',
        aiEnabled: true,
        photoQuoteAcknowledgedAt: null
      },
      data: {
        photoQuoteAcknowledgedAt: new Date()
      }
    })
    if (!claimed.count) return null

    const gate = await this.sendGate(input.businessId, 'BOT')
    const delivery = gate.allowed
      ? await this.sender.sendTextMessage({
          businessId: input.businessId,
          to: input.phone,
          text: PHOTO_QUOTE_ACKNOWLEDGEMENT
        })
      : {
          sent: false as const,
          to: input.phone,
          reason: gate.message
        }
    const providerMessageId = outgoingProviderMessageId(delivery)
    await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        phone: input.phone,
        direction: 'OUTBOUND',
        body: PHOTO_QUOTE_ACKNOWLEDGEMENT,
        status: delivery.sent ? 'sent' : 'failed',
        ...(providerMessageId ? { providerMessageId } : {}),
        metadata: {
          ...delivery,
          automation: 'photo_quote_acknowledgement'
        }
      }
    })
    if (delivery.sent) {
      await this.db.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessage: PHOTO_QUOTE_ACKNOWLEDGEMENT }
      })
    } else {
      await this.db.conversation.updateMany({
        where: { id: input.conversationId },
        data: { photoQuoteAcknowledgedAt: null }
      })
    }
    return delivery
  }
}

function outgoingProviderMessageId(delivery: Awaited<ReturnType<WhatsAppSender['sendTextMessage']>> | {
  sent: false
  to: string
  reason: string
}) {
  if (!delivery.sent || !('response' in delivery)) return undefined
  const response = delivery.response as {
    messages?: Array<{ id?: string }>
  }
  return response.messages?.[0]?.id
}

export const photoQuoteAcknowledgementService = new PhotoQuoteAcknowledgementService()
