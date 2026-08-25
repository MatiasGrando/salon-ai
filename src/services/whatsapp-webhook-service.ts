import { whatsappConfig } from '../config/whatsapp.js'
import { prisma } from '../config/prisma.js'
import type { Conversation, Prisma } from '../generated/prisma/client.js'
import {
  canSendWhatsAppInteractiveMessage,
  WhatsAppCloudApi
} from '../integrations/whatsapp-cloud-api.js'
import {
  assertBusinessCanSendWhatsApp,
  resolveBusinessWhatsAppCredentialsFromState
} from './business-whatsapp-settings.js'
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
import { withConversationProcessingLease } from './conversation-processing-lease.js'
import {
  admitConversationInteractivePromptReply,
  createInteractivePromptToken,
  interactivePromptConflictReply,
  resolveConversationInteractivePrompt,
  versionInteractiveReplyId
} from './conversation-interactive-prompt.js'
import { stateFromConversation } from './booking-v2-conversation-state.js'
import {
  isGreetingLatencyDiagnosticMessage,
  LatencyDiagnostic
} from './latency-diagnostic.js'
import { isBusinessAccountUnavailable } from './business-account-access.js'
import {
  publishConversationUpdated,
  publishIncomingConversationMessage
} from './crm-realtime-events.js'
import {
  TAMARA_OPTIONS_BOT_KEY,
  TAMARA_STALE_INTERACTIVE_REPLY_ID
} from './tamara-options-bot.js'

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
            list_reply?: { id?: string; title?: string; description?: string }
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
  inboundMessageId: string
  receivedAt: Date
  conversationId: string
  phone: string
  text: string
  businessId: string | null
  previousActivityAt: Date
  supportBotState: Prisma.JsonValue | null
  interactiveReplyId?: string
  interactivePromptToken?: string
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
      const greetingLatencyDiagnostic = isGreetingLatencyDiagnosticMessage(message.text)
      const latencyDiagnostic = greetingLatencyDiagnostic
        ? new LatencyDiagnostic('whatsapp_greeting')
        : new LatencyDiagnostic('whatsapp_inbound')
      const targetBusiness = await this.resolveTargetBusiness(message)
      latencyDiagnostic?.checkpoint('resolve_business')
      const targetBusinessId = targetBusiness?.businessId ?? null

      console.info('[whatsapp-webhook] processing message', {
        messageId: message.id,
        from: message.from,
        phoneNumberId: message.phoneNumberId,
        businessId: targetBusinessId
      })

      if (targetBusiness && isBusinessAccountUnavailable(targetBusiness.business.accountStatus)) {
        results.push({
          messageId: message.id,
          from: message.from,
          skipped: true,
          reason: 'Cuenta pausada o cancelada'
        })
        continue
      }

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

      const existingConversationPromise = prisma.conversation.findUnique({
        where: conversationUpsert.where,
        include: conversationUpsert.include
      })
      const existingMessagePromise = message.id
        ? prisma.message.findUnique({
          where: {
            providerMessageId: message.id
          }
        })
        : Promise.resolve(null)
      const [existingConversation, existingMessage] = await Promise.all([
        existingConversationPromise,
        existingMessagePromise
      ])

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
      latencyDiagnostic?.checkpoint('duplicate_check')

      const conversation = existingConversation ?? await prisma.conversation.upsert(conversationUpsert)
      const isTamaraOptionsBot = conversation.supportBotKey === TAMARA_OPTIONS_BOT_KEY
      let resolvedInteractiveReplyId = message.interactiveReplyId
      let resolvedInteractivePromptToken: string | undefined
      let recoverStaleTamaraReply = false

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

      const conversationActivityData = {
        lastMessage: message.text,
        archivedAt: null,
        updatedAt: new Date()
      }
      let inboundMessage
      if (message.interactiveReplyId) {
        const recordedReply = await admitConversationInteractivePromptReply({
          conversationId: conversation.id,
          incomingReplyId: message.interactiveReplyId,
          persist: async (transaction, admission) => {
            const value = await transaction.message.create({
              data: {
                ...inboundMessageData,
                status: admission.accepted
                  ? isTamaraOptionsBot && conversation.aiEnabled
                    ? 'queued_bot'
                    : 'received'
                  : 'ignored_stale_button'
              }
            })
            if (admission.accepted) {
              await transaction.conversation.update({
                where: { id: conversation.id },
                data: {
                  ...conversationActivityData,
                  ...(isTamaraOptionsBot ? { activeInteractivePromptToken: null } : {})
                }
              })
            }
            return value
          }
        })
        inboundMessage = recordedReply.value
        if (!recordedReply.admission.accepted) {
          recoverStaleTamaraReply = conversation.supportBotKey === TAMARA_OPTIONS_BOT_KEY
          if (!recoverStaleTamaraReply) {
            results.push({
              messageId: message.id,
              from: message.from,
              skipped: true,
              reason: 'Botón vencido o ya utilizado'
            })
            continue
          }
          resolvedInteractiveReplyId = TAMARA_STALE_INTERACTIVE_REPLY_ID
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: conversationActivityData
          })
        } else {
          resolvedInteractiveReplyId = recordedReply.admission.replyId
          resolvedInteractivePromptToken = recordedReply.admission.token ?? undefined
        }
      } else {
        ;[inboundMessage] = await Promise.all([
          prisma.message.create({ data: inboundMessageData }),
          prisma.conversation.update({
            where: { id: conversation.id },
            data: conversationActivityData
          })
        ])
      }
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

      if (conversation.businessId) {
        publishIncomingConversationMessage({
          businessId: conversation.businessId,
          conversationId: conversation.id,
          messageId: inboundMessage.id,
          receivedAt: inboundMessage.createdAt.toISOString()
        })
      }
      latencyDiagnostic?.checkpoint('persist_inbound')
      const runHousekeeping = async () => {
        await Promise.all([
          reopenClosedConversationOpportunity(conversation.id),
          linkInstagramReferral(message.text, conversation.id, conversation.businessId)
        ])
      }
      const housekeepingPromise = latencyDiagnostic
        ? latencyDiagnostic.measureDuration('conversation_housekeeping', runHousekeeping)
        : runHousekeeping()
      void housekeepingPromise.catch(() => undefined)
      const applyMarketingOptOut = () => this.applyMarketingOptOut({
        businessId: conversation.businessId,
        phone: message.from,
        text: message.text
      })
      const marketingOptOutApplied = latencyDiagnostic
        ? await latencyDiagnostic.measureDuration('marketing_check', applyMarketingOptOut)
        : await applyMarketingOptOut()
      if (marketingOptOutApplied && !shouldDeferMarketingOptOutReply(conversation.currentStep)) {
        await housekeepingPromise
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
        await housekeepingPromise
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
        await housekeepingPromise
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

      const capturePostSale = () => capturePostSaleResponse({
        conversationId: conversation.id,
        phone: message.from,
        message: message.text,
        businessId: conversation.businessId ?? null
      })
      const postSalePromise = latencyDiagnostic
        ? latencyDiagnostic.measureDuration('post_sale_check', capturePostSale)
        : capturePostSale()
      const [postSaleResponse] = await Promise.all([postSalePromise, housekeepingPromise])
      latencyDiagnostic?.resetCheckpoint()
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
        inboundMessageId: inboundMessage.id,
        receivedAt: inboundMessage.createdAt,
        conversationId: conversation.id,
        phone: message.from,
        text: message.text,
        businessId: conversation.businessId,
        previousActivityAt: conversation.updatedAt,
        supportBotState: conversation.supportBotState,
        ...(resolvedInteractiveReplyId
          ? { interactiveReplyId: resolvedInteractiveReplyId }
          : {}),
        ...(!isTamaraOptionsBot &&
          !recoverStaleTamaraReply &&
          resolvedInteractivePromptToken
          ? { interactivePromptToken: resolvedInteractivePromptToken }
          : {}),
        ...(message.media?.type === 'image' ? { hasImageAttachment: true } : {}),
        ...(latencyDiagnostic ? { latencyDiagnostic } : {})
      }
      if (!automaticMessage.interactivePromptToken && inboundMessage.status === 'received') {
        await prisma.message.updateMany({
          where: { id: inboundMessage.id, status: 'received' },
          data: { status: 'queued_bot' }
        })
      }
      latencyDiagnostic?.checkpoint('pre_enqueue')
      const automaticTask = inboundMessageBatcher.enqueue({
        key: conversation.id,
        item: automaticMessage,
        immediate: Boolean(message.interactiveReplyId || message.media || isTamaraOptionsBot),
        process: (batch) => this.processAutomaticInboundBatch(batch, businessAiEnabled),
        ...(latencyDiagnostic ? {
          timing: {
            onDebounceComplete: (durationMs: number) =>
              latencyDiagnostic.recordDuration('batch_debounce', durationMs),
            onProcessingTailReady: (durationMs: number) =>
              latencyDiagnostic.recordDuration('local_processing_tail_wait', durationMs)
          }
        } : {})
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
    return withConversationProcessingLease(
      firstMessage.conversationId,
      (leasedConversation) => this.processAutomaticInboundBatchLocked(batch, useAi, leasedConversation),
      {
        onAcquired: (durationMs) =>
          firstMessage.latencyDiagnostic?.recordDuration('conversation_lease_wait', durationMs)
      }
    )
  }

  private async processAutomaticInboundBatchLocked(
    batch: AutomaticInboundMessage[],
    useAi: boolean,
    leasedConversation: Conversation
  ) {
    const firstMessage = batch[0]
    if (!firstMessage) throw new Error('No hay mensajes para procesar')
    const latencyDiagnostic = firstMessage.latencyDiagnostic
    const combinedMessage = batch.map((message) => message.text.trim()).filter(Boolean).join('\n')
    const promptResolution = firstMessage.interactivePromptToken
      ? await resolveConversationInteractivePrompt(
          firstMessage.conversationId,
          firstMessage.interactivePromptToken
        )
      : null
    if (promptResolution?.status === 'stale') {
      await prisma.message.updateMany({
        where: {
          id: { in: batch.map((message) => message.inboundMessageId) },
          status: { in: ['received', 'queued_bot'] }
        },
        data: { status: 'ignored_stale_button' }
      })
      return {
        reply: '',
        messages: [],
        deliveries: [],
        inboundBatchSize: batch.length,
        suppressed: true
      }
    }
    const reconciledInboundMessageIds = promptResolution?.inboundMessageIds ?? []
    const effectiveInteractiveReplyId = promptResolution?.status === 'selected'
      ? promptResolution.replyId
      : firstMessage.interactiveReplyId
    const processConversation = async () => {
      if (promptResolution?.status === 'conflict') {
        return {
          ...interactivePromptConflictReply(promptResolution.choices),
          messages: undefined,
          depositRequestId: undefined,
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      const exclusiveSupportBotResult = firstMessage.businessId
          ? await handleExclusiveBusinessSupportBotMessage({
            businessId: firstMessage.businessId,
            conversationId: firstMessage.conversationId,
            message: combinedMessage,
            ...(effectiveInteractiveReplyId ? { interactiveReplyId: effectiveInteractiveReplyId } : {}),
            previousActivityAt: firstMessage.previousActivityAt,
            conversationSnapshot: {
              supportBotState: leasedConversation.supportBotState,
              updatedAt: leasedConversation.updatedAt,
              phone: leasedConversation.phone
            }
          })
        : null
      if (exclusiveSupportBotResult) return exclusiveSupportBotResult

      return conversationService.handleMessage({
          phone: firstMessage.phone,
          message: combinedMessage,
          ...(firstMessage.businessId ? { businessId: firstMessage.businessId } : {}),
          ...(effectiveInteractiveReplyId
            ? { interactiveReplyId: effectiveInteractiveReplyId }
            : {}),
          ...(batch.some((message) => message.hasImageAttachment)
            ? { hasImageAttachment: true }
            : {}),
          previousActivityAt: firstMessage.previousActivityAt,
          useAi,
          conversationSnapshot: leasedConversation
        })
    }
    const conversationResult = latencyDiagnostic
      ? await latencyDiagnostic.measure('conversation_processing', processConversation)
      : await processConversation()

    const inboundMessageIds = [...new Set([
      ...batch.map((message) => message.inboundMessageId),
      ...reconciledInboundMessageIds
    ])]
    const latestReceivedAt = new Date(Math.max(...batch.map((message) => message.receivedAt.getTime())))
    const newerInbound = await prisma.message.findFirst({
      where: {
        conversationId: firstMessage.conversationId,
        direction: 'INBOUND',
        status: { in: ['received', 'queued_bot'] },
        id: { notIn: inboundMessageIds },
        createdAt: { gte: latestReceivedAt }
      },
      select: { id: true }
    })

    await prisma.message.updateMany({
      where: { id: { in: inboundMessageIds }, status: 'queued_bot' },
      data: { status: 'processed_bot' }
    })

    if (newerInbound) {
      await prisma.conversation.update({
        where: { id: firstMessage.conversationId },
        data: { activeInteractivePromptToken: null }
      })
      return {
        reply: '',
        messages: [],
        deliveries: [],
        inboundBatchSize: batch.length,
        suppressed: true,
        supersededByInboundMessageId: newerInbound.id
      }
    }

    if ('suppressOutbound' in conversationResult && conversationResult.suppressOutbound) {
      await prisma.conversation.update({
        where: { id: firstMessage.conversationId },
        data: { activeInteractivePromptToken: null }
      })
      if (firstMessage.businessId) {
        publishConversationUpdated({
          businessId: firstMessage.businessId,
          conversationId: firstMessage.conversationId,
          updatedAt: new Date().toISOString()
        })
      }
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
    const deliveryCredentials = gate?.allowed
      ? resolveBusinessWhatsAppCredentialsFromState(gate.state)
      : null
    const hasReplyButtons = Boolean(
      conversationResult.replyButtons?.length &&
      canSendWhatsAppInteractiveMessage(conversationResult.reply, conversationResult.replyButtons)
    )
    const interactivePromptToken = hasReplyButtons ? createInteractivePromptToken() : null
    const outboundReplyButtons = interactivePromptToken
      ? conversationResult.replyButtons!.map((button) => ({
          ...button,
          id: versionInteractiveReplyId(button.id, interactivePromptToken)
        }))
      : conversationResult.replyButtons
    await prisma.conversation.update({
      where: { id: firstMessage.conversationId },
      data: { activeInteractivePromptToken: interactivePromptToken }
    })
    const hasInteractiveList = (conversationResult.replyButtons?.length ?? 0) > 3
    const isDateSelectionList = hasInteractiveList && Boolean(conversationResult.replyButtons?.every((button) =>
      /:date:\d{4}-\d{2}-\d{2}$/.test(button.id) ||
      /:more_dates:\d{4}-\d{2}-\d{2}$/.test(button.id) ||
      button.id.endsWith(':other_date')
    ))
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
            ? hasInteractiveList
              ? whatsappCloudApi.sendInteractiveListMessage({
                  businessId: firstMessage.businessId!,
                  to: firstMessage.phone,
                  text: replyText,
                  ...(deliveryCredentials ? { credentials: deliveryCredentials } : {}),
                  rows: outboundReplyButtons!,
                  buttonText: isDateSelectionList ? 'Ver días disponibles' : 'Ver opciones',
                  sectionTitle: isDateSelectionList ? 'Elegí una fecha' : 'Elegí una opción'
                })
              : whatsappCloudApi.sendReplyButtonsMessage({
                businessId: firstMessage.businessId!,
                to: firstMessage.phone,
                text: replyText,
                ...(deliveryCredentials ? { credentials: deliveryCredentials } : {}),
                buttons: outboundReplyButtons!
              })
            : whatsappCloudApi.sendTextMessage({
                businessId: firstMessage.businessId!,
                to: firstMessage.phone,
                text: replyText,
                ...(deliveryCredentials ? { credentials: deliveryCredentials } : {})
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
          interactivePromptToken?: string
        }
      } = {
        conversationId: firstMessage.conversationId,
        phone: firstMessage.phone,
        direction: 'OUTBOUND',
        body: replyText,
        status: deliveryResult.sent ? 'sent' : 'failed',
        metadata: {
          ...deliveryResult,
          ...(batch.length > 1 ? { inboundBatchSize: batch.length } : {}),
          ...(interactivePromptToken ? { interactivePromptToken } : {})
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

    if (
      latencyDiagnostic &&
      (whatsappConfig.latencyDiagnosticsEnabled ||
        isGreetingLatencyDiagnosticMessage(firstMessage.text) ||
        (conversationResult as { supportBot?: string }).supportBot === TAMARA_OPTIONS_BOT_KEY)
    ) {
      console.info('[whatsapp-latency-diagnostic]', JSON.stringify({
        traceId: firstMessage.inboundMessageId,
        conversationId: firstMessage.conversationId,
        ...latencyDiagnostic.report()
      }))
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

    if (interactivePromptToken && deliveryResults.some((delivery) => !delivery.sent)) {
      await prisma.conversation.updateMany({
        where: {
          id: firstMessage.conversationId,
          activeInteractivePromptToken: interactivePromptToken
        },
        data: { activeInteractivePromptToken: null }
      })
    }

    if (firstMessage.businessId) {
      publishConversationUpdated({
        businessId: firstMessage.businessId,
        conversationId: firstMessage.conversationId,
        updatedAt: new Date().toISOString()
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
            (
              (message.interactive?.type === 'button_reply' &&
                Boolean(message.interactive.button_reply?.id && message.interactive.button_reply?.title)) ||
              (message.interactive?.type === 'list_reply' &&
                Boolean(message.interactive.list_reply?.id && message.interactive.list_reply?.title))
            )
          const incomingInteractiveReplyId = isInteractiveReply
            ? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null
            : null
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
                ? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? ''
                : isImage
                ? message.image?.caption?.trim() || 'Foto recibida'
                : message.document?.caption?.trim() ||
                  `Archivo recibido${message.document?.filename ? `: ${message.document.filename}` : ''}`,
            ...(metadata?.phone_number_id ? { phoneNumberId: metadata.phone_number_id } : {}),
            ...(metadata?.display_phone_number ? { displayPhoneNumber: metadata.display_phone_number } : {}),
            ...(incomingInteractiveReplyId
              ? { interactiveReplyId: incomingInteractiveReplyId }
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
            businessId: true,
            business: { select: { accountStatus: true } }
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
          displayPhoneNumber: true,
          business: { select: { accountStatus: true } }
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
    const directOptOut = shouldApplyMarketingOptOut(input.text)
    if (!directOptOut && !hasMarketingOptOutCandidate(input.text)) return false

    const normalizedPhone = normalizeMarketingPhone(input.phone)
    const exactPhoneVariants = [...new Set([
      input.phone.trim(),
      normalizedPhone,
      normalizedPhone ? `+${normalizedPhone}` : ''
    ].filter(Boolean))]
    let customer = await prisma.customer.findFirst({
      where: {
        businessId: input.businessId,
        OR: [
          { normalizedPhone },
          { phone: { in: exactPhoneVariants } }
        ]
      },
      select: {
        id: true,
        businessId: true,
        phone: true
      }
    })
    if (!customer) {
      const legacyCustomers = await prisma.customer.findMany({
        where: { businessId: input.businessId, normalizedPhone: null },
        select: {
          id: true,
          businessId: true,
          phone: true
        }
      })
      customer = legacyCustomers.find((item) => normalizeMarketingPhone(item.phone) === normalizedPhone) ?? null
    }
    if (!customer) return false
    const understanding = directOptOut
      ? null
      : await marketingUnderstandingService.understandMarketingPreference(input.text)
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
