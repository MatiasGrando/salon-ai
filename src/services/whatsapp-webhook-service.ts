import { whatsappConfig } from '../config/whatsapp.js'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'
import { ConversationService } from './conversation-service.js'
import { handleExclusiveBusinessSupportBotMessage } from './business-support-bot-runtime.js'
import { reopenClosedConversationOpportunity } from './conversation-opportunity-service.js'
import { queuedConversationHandoffPatch } from './conversation-handoff.js'
import {
  bookingDepositService,
  DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT,
  LATE_DEPOSIT_PROOF_ACKNOWLEDGEMENT
} from './booking-deposit-service.js'
import { capturePostSaleResponse } from './post-sale-service.js'
import { AiMessageUnderstandingService } from './ai-message-understanding-service.js'
import {
  hasMarketingOptOutCandidate,
  shouldApplyMarketingOptOut,
  shouldDeferMarketingOptOutReply
} from './marketing-preference-service.js'
import {
  PHOTO_QUOTE_ACKNOWLEDGEMENT,
  photoQuoteAcknowledgementService
} from './photo-quote-acknowledgement-service.js'
import { InboundMessageBatcher } from './inbound-message-batcher.js'
import { stateFromConversation } from './booking-v2-conversation-state.js'
import {
  isGreetingLatencyDiagnosticMessage,
  LatencyDiagnostic
} from './latency-diagnostic.js'

type VerifyWebhookInput = {
  mode: string | undefined
  token: string | undefined
  challenge: string | undefined
}

const marketingUnderstandingService = new AiMessageUnderstandingService()

export type IncomingWhatsAppMedia = {
  type: 'image' | 'document'
  id: string
  mimeType?: string
  sha256?: string
  caption?: string
  filename?: string
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
          interactive?: {
            type?: string
            button_reply?: { id?: string; title?: string }
          }
          image?: {
            id?: string
            mime_type?: string
            sha256?: string
            caption?: string
          }
          document?: {
            id?: string
            mime_type?: string
            sha256?: string
            caption?: string
            filename?: string
          }
        }>
      }
    }>
  }>
}

type AutomaticInboundMessage = {
  conversationId: string
  phone: string
  text: string
  businessId: string | null
  previousActivityAt: Date
  interactiveReplyId?: string
  hasImageAttachment?: boolean
  latencyDiagnostic?: LatencyDiagnostic
}

const conversationService = new ConversationService()
const whatsappCloudApi = new WhatsAppCloudApi()
const inboundMessageBatcher = new InboundMessageBatcher(
  whatsappConfig.messageBatchDelayMs,
  whatsappConfig.messageBatchMaxWaitMs
)

export function buildIncomingConversationUpsert(businessId: string | null, phone: string) {
  if (!businessId) return null

  return {
    where: {
      businessId_phone: {
        businessId,
        phone
      }
    },
    update: {},
    create: {
      businessId,
      phone
    },
    include: {
      business: true
    }
  } as const
}

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
    const messages = this.extractIncomingMessages(payload)
    const results = []
    const automaticTasks: Array<Promise<void>> = []

    console.info('[whatsapp-webhook] received payload', {
      entries: payload.entry?.length ?? 0,
      incomingMessages: messages.length
    })

    for (const message of messages) {
      const latencyDiagnostic = isGreetingLatencyDiagnosticMessage(message.text)
        ? new LatencyDiagnostic('whatsapp_greeting')
        : null
      const targetBusiness = await this.resolveTargetBusiness(message)
      latencyDiagnostic?.checkpoint('resolve_business')
      const targetBusinessId = targetBusiness?.businessId ?? null

      console.info('[whatsapp-webhook] processing message', {
        messageId: message.id,
        from: message.from,
        phoneNumberId: message.phoneNumberId,
        businessId: targetBusinessId
      })

      const conversationUpsert = buildIncomingConversationUpsert(
        targetBusinessId,
        message.from
      )
      if (!conversationUpsert) {
        console.warn('[whatsapp-webhook] skipped message for unmatched whatsapp number', {
          messageId: message.id,
          phoneNumberId: message.phoneNumberId
        })
        results.push({
          messageId: message.id,
          from: message.from,
          skipped: true,
          reason: 'Numero de WhatsApp no asociado'
        })
        continue
      }

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
      latencyDiagnostic?.checkpoint('duplicate_check')

      const conversation = await prisma.conversation.upsert(conversationUpsert)

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
          media?: IncomingWhatsAppMedia
          interactiveReplyId?: string
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
          ...(message.displayPhoneNumber ? { displayPhoneNumber: message.displayPhoneNumber } : {}),
          ...(message.media ? { media: message.media } : {}),
          ...(message.interactiveReplyId ? { interactiveReplyId: message.interactiveReplyId } : {})
        }
      }

      if (message.id) {
        inboundMessageData.providerMessageId = message.id
      }

      const inboundMessage = await prisma.message.create({
        data: inboundMessageData
      })
      const supportedDepositProof = isSupportedDepositProof(message.media)
      const expectedDepositId = pendingDepositIdFromState(conversation.bookingV2State)
      const depositProof = supportedDepositProof
        ? await bookingDepositService.markProofReceived({
          conversationId: conversation.id,
          messageId: inboundMessage.id,
          receivedAt: inboundMessage.createdAt
        })
        : null
      const lateDepositProof = supportedDepositProof && !depositProof
        ? await bookingDepositService.registerLateProofIfExpired({
          depositId: expectedDepositId,
          conversationId: conversation.id,
          messageId: inboundMessage.id,
          receivedAt: inboundMessage.createdAt
        })
        : null

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
      latencyDiagnostic?.checkpoint('persist_inbound')
      await reopenClosedConversationOpportunity(conversation.id)
      await linkInstagramReferral(message.text, conversation.id, conversation.businessId)
      latencyDiagnostic?.checkpoint('conversation_housekeeping')

      const marketingOptOutApplied = await this.applyMarketingOptOut({
        businessId: conversation.businessId,
        phone: message.from,
        text: message.text
      })
      latencyDiagnostic?.checkpoint('marketing_check')
      if (marketingOptOutApplied && !shouldDeferMarketingOptOutReply(conversation.currentStep)) {
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

      if (depositProof) {
        const replyText = DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT
        const gate = conversation.businessId
          ? await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT')
          : null
        const deliveryResult = gate?.allowed
          ? await whatsappCloudApi.sendTextMessage({
              businessId: conversation.businessId!,
              to: message.from,
              text: replyText
            })
          : {
              sent: false as const,
              to: message.from,
              reason: gate?.message || 'La conversación no tiene comercio asociado para responder por WhatsApp.'
            }
        const providerMessageId = getOutgoingProviderMessageId(deliveryResult)
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            phone: message.from,
            direction: 'OUTBOUND',
            body: replyText,
            status: deliveryResult.sent ? 'sent' : 'failed',
            ...(providerMessageId ? { providerMessageId } : {}),
            metadata: { ...deliveryResult, automation: 'deposit_proof_received' }
          }
        })
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessage: replyText,
            ...(conversation.currentStep === 'HUMAN_HANDOFF'
              ? {
                  humanHandoffAt: conversation.humanHandoffAt ?? inboundMessage.createdAt,
                  humanHandoffResolvedAt: null
                }
              : queuedConversationHandoffPatch(inboundMessage.createdAt))
          }
        })
        results.push({
          messageId: message.id,
          from: message.from,
          reply: replyText,
          depositProofReceived: true,
          delivery: deliveryResult
        })
        continue
      }

      if (lateDepositProof) {
        const replyText = LATE_DEPOSIT_PROOF_ACKNOWLEDGEMENT
        const gate = conversation.businessId
          ? await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT')
          : null
        const deliveryResult = gate?.allowed
          ? await whatsappCloudApi.sendTextMessage({
              businessId: conversation.businessId!,
              to: message.from,
              text: replyText
            })
          : {
              sent: false as const,
              to: message.from,
              reason: gate?.message || 'La conversación no tiene comercio asociado para responder por WhatsApp.'
            }
        const providerMessageId = getOutgoingProviderMessageId(deliveryResult)
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            phone: message.from,
            direction: 'OUTBOUND',
            body: replyText,
            status: deliveryResult.sent ? 'sent' : 'failed',
            ...(providerMessageId ? { providerMessageId } : {}),
            metadata: { ...deliveryResult, automation: 'late_deposit_proof_received' }
          }
        })
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessage: replyText,
            ...(conversation.currentStep === 'HUMAN_HANDOFF'
              ? {
                  humanHandoffAt: conversation.humanHandoffAt ?? inboundMessage.createdAt,
                  humanHandoffResolvedAt: null
                }
              : queuedConversationHandoffPatch(inboundMessage.createdAt))
          }
        })
        results.push({
          messageId: message.id,
          from: message.from,
          reply: replyText,
          lateDepositProofReceived: true,
          delivery: deliveryResult
        })
        continue
      }

      const postSaleResponse = await capturePostSaleResponse({
        conversationId: conversation.id,
        phone: message.from,
        message: message.text,
        businessId: conversation.businessId ?? null
      })
      latencyDiagnostic?.checkpoint('post_sale_check')
      if (postSaleResponse.captured) {
        let deliveryResult: Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>> | null = null
        if (postSaleResponse.reply && conversation.businessId) {
          const gate = await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT')
          deliveryResult = gate.allowed
            ? await whatsappCloudApi.sendTextMessage({
                businessId: conversation.businessId,
                to: message.from,
                text: postSaleResponse.reply
              })
            : { sent: false as const, to: message.from, reason: gate.message }
          const providerMessageId = getOutgoingProviderMessageId(deliveryResult)
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              phone: message.from,
              direction: 'OUTBOUND',
              body: postSaleResponse.reply,
              status: deliveryResult.sent ? 'sent' : 'failed',
              ...(providerMessageId ? { providerMessageId } : {}),
              metadata: { ...deliveryResult, automation: 'post_sale' }
            }
          })
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: postSaleResponse.reply }
          })
        }
        results.push({
          messageId: message.id,
          from: message.from,
          reply: postSaleResponse.reply,
          postSale: true,
          rating: postSaleResponse.rating,
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

      const photoQuoteAcknowledgement = message.media?.type === 'image' &&
        !depositProof &&
        !hasPendingDepositState(conversation.bookingV2State)
        ? await photoQuoteAcknowledgementService.acknowledge({
            conversationId: conversation.id,
            businessId: conversation.businessId,
            phone: message.from,
            selectedServiceId: conversation.selectedServiceId,
            pendingPhotoQuote: stateFromConversation(conversation).pendingPhotoQuote ?? null
          })
        : null

      const businessAiEnabled = conversation.business
        ? conversation.business.aiEnabled
        : await this.isDefaultBusinessAiEnabled()
      latencyDiagnostic?.checkpoint('bot_settings')

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
          reason: 'Atencion manual',
          ...(photoQuoteAcknowledgement
            ? {
                reply: PHOTO_QUOTE_ACKNOWLEDGEMENT,
                delivery: photoQuoteAcknowledgement
              }
            : {})
        })

        continue
      }

      const automaticMessage: AutomaticInboundMessage = {
        conversationId: conversation.id,
        phone: message.from,
        text: message.text,
        businessId: conversation.businessId,
        previousActivityAt: conversation.updatedAt,
        ...(message.interactiveReplyId
          ? { interactiveReplyId: message.interactiveReplyId }
          : {}),
        ...(message.media?.type === 'image' ? { hasImageAttachment: true } : {}),
        ...(latencyDiagnostic ? { latencyDiagnostic } : {})
      }
      const automaticTask = inboundMessageBatcher.enqueue({
        key: conversation.id,
        item: automaticMessage,
        immediate: Boolean(message.interactiveReplyId || message.media),
        process: (batch) => this.processAutomaticInboundBatch(batch, businessAiEnabled)
      }).then((automaticResult) => {
        results.push({
          messageId: message.id,
          from: message.from,
          ...automaticResult
        })
      })
      automaticTasks.push(automaticTask)
    }

    await Promise.all(automaticTasks)

    return {
      status: 'ok',
      processed: results.length,
      results
    }
  }

  private async processAutomaticInboundBatch(
    batch: AutomaticInboundMessage[],
    useAi: boolean
  ) {
    const firstMessage = batch[0]
    if (!firstMessage) throw new Error('No hay mensajes para procesar')
    const latencyDiagnostic = firstMessage.latencyDiagnostic
    latencyDiagnostic?.checkpoint('batch_wait')
    const combinedMessage = batch.map((message) => message.text.trim()).filter(Boolean).join('\n')
    const processConversation = async () => {
      const exclusiveSupportBotResult = firstMessage.businessId
        ? await handleExclusiveBusinessSupportBotMessage({
            businessId: firstMessage.businessId,
            conversationId: firstMessage.conversationId,
            message: combinedMessage
          })
        : null
      if (exclusiveSupportBotResult) return exclusiveSupportBotResult

      return conversationService.handleMessage({
          phone: firstMessage.phone,
          message: combinedMessage,
          ...(firstMessage.businessId ? { businessId: firstMessage.businessId } : {}),
          ...(firstMessage.interactiveReplyId
            ? { interactiveReplyId: firstMessage.interactiveReplyId }
            : {}),
          ...(batch.some((message) => message.hasImageAttachment)
            ? { hasImageAttachment: true }
            : {}),
          previousActivityAt: firstMessage.previousActivityAt,
          useAi
        })
    }
    const conversationResult = latencyDiagnostic
      ? await latencyDiagnostic.measure('conversation_processing', processConversation)
      : await processConversation()

    if ('suppressOutbound' in conversationResult && conversationResult.suppressOutbound) {
      return {
        reply: '',
        messages: [],
        deliveries: [],
        inboundBatchSize: batch.length,
        suppressed: true
      }
    }

    const gate = latencyDiagnostic
      ? await latencyDiagnostic.measure('outbound_gate', async () => firstMessage.businessId
          ? assertBusinessCanSendWhatsApp(firstMessage.businessId, 'BOT')
          : null)
      : firstMessage.businessId
        ? await assertBusinessCanSendWhatsApp(firstMessage.businessId, 'BOT')
        : null
    const hasReplyButtons = Boolean(conversationResult.replyButtons?.length)
    const outboundReplies = hasReplyButtons
      ? [conversationResult.reply]
      : conversationResult.messages?.length
        ? conversationResult.messages
        : [conversationResult.reply]
    const deliveryResults: Array<Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>>> = []

    for (const replyText of outboundReplies) {
      let deliveryResult: Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>>
      try {
        const sendReply = async () => gate?.allowed
          ? hasReplyButtons
            ? whatsappCloudApi.sendReplyButtonsMessage({
                businessId: firstMessage.businessId!,
                to: firstMessage.phone,
                text: replyText,
                buttons: conversationResult.replyButtons!
              })
            : whatsappCloudApi.sendTextMessage({
                businessId: firstMessage.businessId!,
                to: firstMessage.phone,
                text: replyText
              })
          : Promise.resolve({
              sent: false as const,
              to: firstMessage.phone,
              reason: gate?.message || 'La conversacion no tiene comercio asociado para resolver WhatsApp.'
            })
        deliveryResult = latencyDiagnostic
          ? await latencyDiagnostic.measure('meta_send', sendReply)
          : await sendReply()
      } catch (error) {
        deliveryResult = {
          sent: false,
          to: firstMessage.phone,
          reason: error instanceof Error
            ? `No se pudo enviar el mensaje: ${error.message}`
            : 'No se pudo enviar el mensaje por un error desconocido.'
        }
      }

      deliveryResults.push(deliveryResult)
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
        metadata: Awaited<ReturnType<WhatsAppCloudApi['sendTextMessage']>> & {
          inboundBatchSize?: number
        }
      } = {
        conversationId: firstMessage.conversationId,
        phone: firstMessage.phone,
        direction: 'OUTBOUND',
        body: replyText,
        status: deliveryResult.sent ? 'sent' : 'failed',
        metadata: {
          ...deliveryResult,
          ...(batch.length > 1 ? { inboundBatchSize: batch.length } : {})
        }
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

      if (latencyDiagnostic) {
        await latencyDiagnostic.measure('persist_outbound', () =>
          prisma.message.create({ data: outboundMessageData })
        )
      } else {
        await prisma.message.create({ data: outboundMessageData })
      }
      console.info('[whatsapp-webhook] saved outbound reply', {
        messageId: outgoingProviderMessageId,
        to: firstMessage.phone,
        sent: deliveryResult.sent,
        conversationId: firstMessage.conversationId,
        inboundBatchSize: batch.length
      })
      if (!deliveryResult.sent) break
    }

    if (latencyDiagnostic) {
      console.info('[whatsapp-latency-diagnostic]', latencyDiagnostic.report())
    }

    if (
      conversationResult.depositRequestId &&
      deliveryResults.some((delivery) => !delivery.sent) &&
      firstMessage.businessId
    ) {
      await conversationService.handleDepositRequestDeliveryFailure({
        phone: firstMessage.phone,
        businessId: firstMessage.businessId,
        depositId: conversationResult.depositRequestId
      })
    }

    return {
      reply: conversationResult.reply,
      messages: outboundReplies,
      delivery: deliveryResults[deliveryResults.length - 1],
      deliveries: deliveryResults,
      inboundBatchSize: batch.length
    }
  }

  extractIncomingMessages(payload: WhatsAppWebhookPayload) {
    const messages: Array<{
      id?: string
      from: string
      text: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      media?: IncomingWhatsAppMedia
      interactiveReplyId?: string
    }> = []

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const metadata = change.value?.metadata
        for (const message of change.value?.messages ?? []) {
          if (!message.from) {
            continue
          }
          const isText = message.type === 'text' && Boolean(message.text?.body)
          const isImage = message.type === 'image' && Boolean(message.image?.id)
          const isDocument = message.type === 'document' && Boolean(message.document?.id)
          const isInteractiveReply = message.type === 'interactive' &&
            message.interactive?.type === 'button_reply' &&
            Boolean(message.interactive.button_reply?.id && message.interactive.button_reply?.title)
          if (!isText && !isImage && !isDocument && !isInteractiveReply) continue

          const textMessage: {
            id?: string
            from: string
            text: string
            phoneNumberId?: string
            displayPhoneNumber?: string
            media?: IncomingWhatsAppMedia
            interactiveReplyId?: string
          } = {
            from: message.from,
            text: isText
              ? message.text?.body ?? ''
              : isInteractiveReply
                ? message.interactive?.button_reply?.title ?? ''
                : isImage
                ? message.image?.caption?.trim() || 'Foto recibida'
                : message.document?.caption?.trim() ||
                  `Archivo recibido${message.document?.filename ? `: ${message.document.filename}` : ''}`,
            ...(metadata?.phone_number_id ? { phoneNumberId: metadata.phone_number_id } : {}),
            ...(metadata?.display_phone_number ? { displayPhoneNumber: metadata.display_phone_number } : {}),
            ...(isInteractiveReply && message.interactive?.button_reply?.id
              ? { interactiveReplyId: message.interactive.button_reply.id }
              : {}),
            ...(isImage && message.image?.id
              ? {
                  media: {
                    type: 'image' as const,
                    id: message.image.id,
                    ...(message.image.mime_type ? { mimeType: message.image.mime_type } : {}),
                    ...(message.image.sha256 ? { sha256: message.image.sha256 } : {}),
                    ...(message.image.caption ? { caption: message.image.caption } : {})
                  }
                }
              : isDocument && message.document?.id
                ? {
                    media: {
                      type: 'document' as const,
                      id: message.document.id,
                      ...(message.document.mime_type ? { mimeType: message.document.mime_type } : {}),
                      ...(message.document.sha256 ? { sha256: message.document.sha256 } : {}),
                      ...(message.document.caption ? { caption: message.document.caption } : {}),
                      ...(message.document.filename ? { filename: message.document.filename } : {})
                    }
                  }
              : {})
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
            phoneNumberId: message.phoneNumberId,
            connectionStatus: 'CONNECTED'
          },
          select: {
            businessId: true
          }
        })
      : null

    if (!targetBusiness && normalizedDisplayPhoneNumber) {
      const candidates = await prisma.businessWhatsAppConfig.findMany({
        where: {
          connectionStatus: 'CONNECTED',
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
    if (!input.businessId) return false
    const customers = await prisma.customer.findMany({
      where: { businessId: input.businessId },
      select: {
        id: true,
        businessId: true,
        phone: true
      }
    })
    const customer = customers.find((item) => normalizeMarketingPhone(item.phone) === normalizeMarketingPhone(input.phone))
    if (!customer) return false
    const directOptOut = shouldApplyMarketingOptOut(input.text)
    const understanding = directOptOut
      ? null
      : hasMarketingOptOutCandidate(input.text)
        ? await marketingUnderstandingService.understandMarketingPreference(input.text)
        : null
    if (!shouldApplyMarketingOptOut(input.text, understanding)) return false
    const businessId = customer.businessId
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

async function linkInstagramReferral(text: string, conversationId: string, businessId?: string | null) {
  const referralCode = text.match(/\bIG-[A-F0-9]{8}\b/i)?.[0]?.toUpperCase()
  if (!referralCode) return
  const lead = await prisma.instagramLead.findUnique({ where: { referralCode } })
  if (!lead || (businessId && lead.businessId !== businessId)) return
  await prisma.instagramLead.update({
    where: { id: lead.id },
    data: {
      whatsappConversationId: conversationId,
      whatsappLinkedAt: new Date()
    }
  })
}

function hasPendingDepositState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  return Boolean((value as { pendingDeposit?: unknown }).pendingDeposit)
}

function pendingDepositIdFromState(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const pendingDeposit = (value as { pendingDeposit?: unknown }).pendingDeposit
  if (!pendingDeposit || typeof pendingDeposit !== 'object') return null
  const depositId = (pendingDeposit as { depositId?: unknown }).depositId
  return typeof depositId === 'string' && depositId.trim() ? depositId : null
}

const SUPPORTED_DEPOSIT_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])

const SUPPORTED_DEPOSIT_PROOF_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'pdf',
  'txt',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx'
])

export function isSupportedDepositProof(media?: IncomingWhatsAppMedia) {
  if (!media) return false
  const mimeType = media.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (mimeType && SUPPORTED_DEPOSIT_PROOF_MIME_TYPES.has(mimeType)) return true

  const extension = media.filename?.split('.').pop()?.trim().toLowerCase()
  return Boolean(extension && SUPPORTED_DEPOSIT_PROOF_EXTENSIONS.has(extension))
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
