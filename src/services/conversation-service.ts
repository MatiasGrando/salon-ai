import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { AppointmentService } from './appointment-service.js'
import { AiMessageUnderstandingService, type AiConversationIntent } from './ai-message-understanding-service.js'
import { BookingConversationFlow, isBookingStartMessage, isMenuStep } from './booking-conversation-flow.js'
import { BotCopyService } from './bot-copy-service.js'
import { normalizeText } from './message-understanding-service.js'
import { runWithAiEnabled, setAiUsageAttribution } from './ai-execution-context.js'
import { linkAiUsageToAppointment } from './ai-usage-service.js'
import { BookingV2Engine, type BookingV2ProcessResult } from './booking-v2-engine.js'
import { BookingV2DomainService } from './booking-v2-domain.js'
import type { BookingV2MessagePlan } from './booking-v2-dialogue.js'
import type {
  BookingField,
  BookingFlowOrder,
  BookingV2AgendaItem,
  BookingV2PendingInformationSelection,
  BookingV2PendingRequest,
  BookingV2State
} from './booking-v2-state.js'
import {
  clearFieldAndDependents,
  addCombinedServices,
  combinedServiceIds,
  createEmptyBookingV2State,
  advanceToNextQueuedService,
  pendingDepositAppointmentIds
} from './booking-v2-state.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from './booking-v2-conversation-state.js'
import {
  createServiceConsultationQueue,
  isPriceServiceConsultation
} from './service-consultation-queue.js'
import {
  calculateBookingV2Deposit,
  renderBookingV2DepositRequest
} from './booking-v2-deposit.js'
import { bookingDepositService } from './booking-deposit-service.js'
import {
  markConversationOpportunityConverted,
  reopenClosedConversationOpportunity
} from './conversation-opportunity-service.js'
import { findOrCreateCustomerByPhone } from './customer-identity-service.js'
import {
  businessInformationTopicsFromRouting,
  ConversationRouter,
  hasGroundedDepositInformationIntent,
  isDepositInformationRequest,
  isQuoteOnlyRouting,
  type BusinessInformationTopic,
  type CatalogQuery,
  type ConversationRouting
} from './conversation-router.js'
import { ConversationRouterContextService } from './conversation-router-context-service.js'
import { BusinessKnowledgeService } from './business-knowledge-service.js'
import {
  applyAssistantPersonalityToReply,
  getBusinessAssistantPersonality,
  type AssistantPersonality
} from './assistant-personality-service.js'
import { BookingV2ChoiceExtractor } from './booking-v2-choice-extractor.js'
import {
  DEFAULT_CONVERSATION_EXPIRE_MINUTES,
  DEFAULT_CONVERSATION_PAUSE_MINUTES,
  normalizeConversationContextSettings,
  type ConversationContextSettings
} from './conversation-context-settings.js'
import {
  bookingAvailabilityFailureRecovery
} from './booking-availability-resolution.js'
import { detectDeterministicConfirmation } from './conversation-confirmation-intent.js'
import {
  bookingCoordinationActionableReply,
  detectBookingCoordinationChoice
} from './booking-coordination-choice.js'
import {
  isQueuedConversationHandoff,
  queuedConversationHandoffPatch
} from './conversation-handoff.js'
import { PHOTO_QUOTE_ACKNOWLEDGEMENT } from './photo-quote-acknowledgement-service.js'
import {
  extractExplicitCustomerIntroduction,
  extractMisaddressedAssistantGreeting,
  extractPlainCustomerName,
  isPureSocialGreeting
} from './conversation-customer-intent.js'
import { reservationDurationLimits } from './service-duration.js'

const bookingConversationFlow = new BookingConversationFlow()
const bookingProvider = new InternalBookingProvider()
const appointmentService = new AppointmentService()
const botCopyService = new BotCopyService()
const aiMessageUnderstandingService = new AiMessageUnderstandingService()
const bookingV2Engine = new BookingV2Engine()
const bookingV2DomainService = new BookingV2DomainService()
const conversationRouter = new ConversationRouter()
const conversationRouterContextService = new ConversationRouterContextService()
const businessKnowledgeService = new BusinessKnowledgeService()
const bookingV2ChoiceExtractor = new BookingV2ChoiceExtractor()

type HandleMessageInput = {
  phone: string
  message: string
  businessId?: string
  useAi?: boolean
  interactiveReplyId?: string
  previousActivityAt?: Date
  hasImageAttachment?: boolean
}

type HandleMessageResult = {
  reply: string
  messages?: string[]
  replyButtons?: Array<{ id: string; title: string }>
  depositRequestId?: string
  skipMisunderstandingTracking?: boolean
  skipHumanize?: boolean
  suppressOutbound?: boolean
}

type ConversationStepValue =
  | 'START'
  | 'ASK_SERVICE'
  | 'ASK_PROFESSIONAL'
  | 'ASK_DATE'
  | 'ASK_TIME'
  | 'CONFIRM'
  | 'AWAITING_DEPOSIT'
  | 'ASK_CUSTOMER_NAME'
  | 'CANCEL_SELECT_APPOINTMENT'
  | 'EDIT_SELECT_APPOINTMENT'
  | 'HUMAN_HANDOFF'
  | 'COMPLETED'

export class ConversationService {
  async handleMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    return runWithAiEnabled(input.useAi !== false, async () => {
      const result = await this.handleMessageCore(input)
      if (!result.skipMisunderstandingTracking) {
        await this.trackMisunderstanding(input.phone, input.businessId, result.reply)
      }

      if (result.skipHumanize) {
        return withOutboundMessages(result)
      }

      return withOutboundMessages(await this.humanizeResult({
        result,
        message: input.message.trim(),
        ...(input.businessId ? { businessId: input.businessId } : {})
      }))
    })
  }

  private async handleMessageCore(input: HandleMessageInput): Promise<HandleMessageResult> {
    let message = input.message.trim()
    const businessId = await this.resolveBusinessId(input.businessId)
    const existingConversation = businessId
      ? await prisma.conversation.findUnique({
          where: {
            businessId_phone: {
              businessId,
              phone: input.phone
            }
          }
        })
      : await prisma.conversation.findFirst({
          where: {
            businessId: null,
            phone: input.phone
          }
        })
    setAiUsageAttribution({
      businessId: businessId ?? null,
      conversationId: existingConversation?.id ?? null,
      appointmentId: null
    })
    const coordinationButtonMessage = existingConversation
      ? bookingCoordinationMessageFromInteractiveReply(
        input.interactiveReplyId,
        existingConversation.id
      )
      : null
    message = coordinationButtonMessage ?? message
    if (existingConversation?.opportunityStatus === 'CLOSED') {
      await reopenClosedConversationOpportunity(existingConversation.id)
    }
    const runtimeSettings = businessId
      ? await this.getConversationRuntimeSettings(businessId)
      : {
          bookingV2Enabled: false,
          context: normalizeConversationContextSettings()
        }
    const bookingV2Enabled = runtimeSettings.bookingV2Enabled
    const previousActivityAt = input.previousActivityAt ?? existingConversation?.updatedAt ?? new Date()
    const contextWindow = existingConversation
      ? conversationContextWindow(existingConversation.currentStep, previousActivityAt, runtimeSettings.context)
      : 'active'
    const storedBookingState = existingConversation ? stateFromConversation(existingConversation) : null
    const hasPendingContextDecision = Boolean(storedBookingState?.contextPause)
    const hasDirectInteractiveAction = Boolean(
      existingConversation && (
        recoveryActionFromInteractiveReply(input.interactiveReplyId, existingConversation.id) ||
        catalogRecoveryActionFromInteractiveReply(input.interactiveReplyId, existingConversation.id) ||
        unsupportedServiceActionFromInteractiveReply(input.interactiveReplyId, existingConversation.id) ||
        otherQueryMenuActionFromInteractiveReply(input.interactiveReplyId, existingConversation.id)
        || preliminaryAvailabilityActionFromInteractiveReply(
          input.interactiveReplyId,
          existingConversation.id
        )
        || bookingCoordinationMessageFromInteractiveReply(
          input.interactiveReplyId,
          existingConversation.id
        )
      )
    )
    const hardResetRequested = isHardResetMessage(message)
    let contextAction: 'continue' | 'new' | 'handoff' | 'unclear' | null = null

    if (
      !hardResetRequested &&
      !hasDirectInteractiveAction &&
      existingConversation &&
      businessId &&
      contextWindow !== 'expired' &&
      (contextWindow === 'paused' || hasPendingContextDecision)
    ) {
      contextAction = contextActionFromInteractiveReply(input.interactiveReplyId, existingConversation.id)
      if (!contextAction) {
        const choice = await bookingV2ChoiceExtractor.extract({
          message,
          question: 'La reserva anterior quedó pausada. ¿Quiere continuarla, iniciar una consulta nueva o hablar con el equipo?',
          choices: [
            { id: 'continue', meaning: 'Quiere retomar o continuar la reserva incompleta anterior.' },
            { id: 'new', meaning: 'Quiere abandonar el contexto anterior e iniciar una reserva o consulta nueva.' },
            { id: 'handoff', meaning: 'Quiere hablar con una persona del equipo.' }
          ]
        })
        contextAction = contextActionFromChoice(choice)
      }

      if (contextAction === 'unclear') {
        const pausedState = {
          ...storedBookingState!,
          contextPause: storedBookingState?.contextPause ?? {
            pausedAt: new Date().toISOString(),
            expiresAt: new Date(
              previousActivityAt.getTime() + runtimeSettings.context.expireAfterMinutes * 60 * 1000
            ).toISOString()
          }
        }
        await prisma.conversation.update({
          where: { id: existingConversation.id },
          data: {
            lastMessage: message,
            archivedAt: null,
            ...this.prismaConversationData(conversationPatchFromState(pausedState))
          }
        })
        const serviceName = existingConversation.selectedServiceId
          ? (await prisma.service.findFirst({
              where: { id: existingConversation.selectedServiceId, businessId },
              select: { name: true }
            }))?.name
          : null
        return {
          reply: serviceName
            ? `La conversación anterior quedó pausada mientras reservábamos ${serviceName}. ¿Cómo querés seguir?`
            : 'La conversación anterior quedó pausada. ¿Cómo querés seguir?',
          replyButtons: contextDecisionButtons(existingConversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      if (contextAction === 'handoff') {
        await prisma.conversation.update({
          where: { id: existingConversation.id },
          data: {
            lastMessage: message,
            ...queuedConversationHandoffPatch()
          }
        })
        return {
          reply: botCopyService.humanHandoffQueued(),
          replyButtons: handoffCancellationButtons(existingConversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }

    const shouldResetExpiredFlow = contextWindow === 'expired' || contextAction === 'new'
    const continuedState = contextAction === 'continue' && storedBookingState
      ? { ...storedBookingState, contextPause: null }
      : null

    let conversation = existingConversation
      ? await prisma.conversation.update({
          where: {
            id: existingConversation.id
          },
          data: shouldResetExpiredFlow
            ? {
                lastMessage: message,
                archivedAt: null,
                currentStep: 'START',
                selectedServiceId: null,
                selectedProfessionalId: null,
                selectedDate: null,
                selectedTime: null,
                misunderstandingCount: 0,
                lastAvailability: Prisma.JsonNull,
                bookingV2State: Prisma.JsonNull
              }
            : continuedState
              ? {
                  lastMessage: message,
                  archivedAt: null,
                  ...this.prismaConversationData(conversationPatchFromState(continuedState))
                }
            : {
                lastMessage: message,
                archivedAt: null
              }
        })
      : await prisma.conversation.create({
          data: {
            phone: input.phone,
            lastMessage: message,
            businessId
          }
        })

    setAiUsageAttribution({
      businessId: businessId ?? null,
      conversationId: conversation.id
    })

    if (
      bookingV2Enabled &&
      businessId &&
      isQueuedConversationHandoff(conversation) &&
      isHandoffCancellationRequest(input.interactiveReplyId, message, conversation.id)
    ) {
      const currentState = stateFromConversation(conversation)
      const resetState = bookingV2Enabled
        ? this.prismaConversationData(conversationPatchFromState(
            freshBookingV2State(currentState.draft.name)
          ))
        : {
            selectedServiceId: null,
            selectedProfessionalId: null,
            selectedDate: null,
            selectedTime: null,
            selectedCustomerName: null,
            bookingV2State: Prisma.JsonNull
          }
      const cancelled = await prisma.conversation.updateMany({
        where: {
          id: conversation.id,
          currentStep: 'HUMAN_HANDOFF',
          aiEnabled: true,
          humanHandoffResolvedAt: null
        },
        data: {
          ...resetState,
          currentStep: bookingV2Enabled ? 'START' : 'ASK_CUSTOMER_NAME',
          aiEnabled: true,
          humanHandoffAt: conversation.humanHandoffAt,
          humanHandoffResolvedAt: new Date(),
          photoQuoteAcknowledgedAt: null,
          lastAvailability: Prisma.JsonNull
        }
      })
      if (cancelled.count === 0) {
        return {
          reply: botCopyService.humanHandoffBookingLocked(),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      return {
        reply: botCopyService.humanHandoffCancelled(),
        replyButtons: otherQueryMenuButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (contextAction === 'continue' && bookingV2Enabled && businessId) {
      const resumed = await bookingV2Engine.resume({ businessId, conversation })
      await this.updateConversation(input.phone, businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch,
        lastAvailability: resumed.availabilityOptions.length
          ? {
              serviceId: resumed.state.draft.service,
              professionalId: resumed.state.draft.professional,
              date: resumed.state.draft.date,
              options: resumed.availabilityOptions
            }
          : null
      })
      const presentation = await presentBookingV2Result({
        businessId,
        conversationId: conversation.id,
        result: resumed
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const recoveryState = stateFromConversation(conversation)
    if (recoveryState.preliminaryAvailability?.phase === 'AWAITING_BOOKING_DECISION') {
      return this.handlePreliminaryAvailabilityDecision({
        phone: input.phone,
        message,
        ...(input.interactiveReplyId ? { interactiveReplyId: input.interactiveReplyId } : {}),
        businessId: businessId!,
        conversation,
        state: recoveryState
      })
    }
    const otherQueryMenuAction = otherQueryMenuActionFromInteractiveReply(
      input.interactiveReplyId,
      conversation.id
    )
    if (otherQueryMenuAction === 'manage_appointment') {
      return {
        reply: botCopyService.manageAppointmentPrompt(),
        replyButtons: manageAppointmentDecisionButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (otherQueryMenuAction === 'edit_appointment') {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'EDIT_SELECT_APPOINTMENT',
        misunderstandingCount: 0
      })
      return this.buildMyAppointmentsReply(
        input.phone,
        businessId,
        botCopyService.editAppointmentIntro()
      )
    }
    if (otherQueryMenuAction === 'cancel_appointment') {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT',
        misunderstandingCount: 0
      })
      return this.buildMyAppointmentsReply(
        input.phone,
        businessId,
        botCopyService.cancelAppointmentIntro()
      )
    }
    const unsupportedCatalogAction = unsupportedServiceActionFromInteractiveReply(
      input.interactiveReplyId,
      conversation.id
    ) ?? (
      recoveryState.unsupportedServiceRequest &&
      recoveryActionFromInteractiveReply(input.interactiveReplyId, conversation.id) === 'resume'
        ? 'show_services' as const
        : null
    )
    if (
      (unsupportedCatalogAction === 'show_services' || otherQueryMenuAction === 'show_services') &&
      bookingV2Enabled &&
      businessId
    ) {
      const nextState: BookingV2State = {
        ...recoveryState,
        catalogNavigation: null,
        unsupportedServiceRequest: null,
        misunderstandingCount: 0
      }
      const resumed = await bookingV2Engine.resume({
        businessId,
        conversation: conversationPatchFromState(nextState)
      })
      await this.updateConversation(input.phone, businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch
      })
      const presentation = await presentBookingV2Result({
        businessId,
        conversationId: conversation.id,
        result: resumed
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (otherQueryMenuAction === 'book_appointment' && bookingV2Enabled && businessId) {
      const menuState: BookingV2State = {
        ...recoveryState,
        catalogNavigation: null,
        unsupportedServiceRequest: null,
        misunderstandingCount: 0
      }
      const nextState = bookingStateFromCompletedServiceConsultation(menuState)
      const booking = await bookingV2Engine.process({
        businessId,
        conversation: conversationPatchFromState(nextState),
        message: 'quiero reservar un turno',
        understandingExtraction: null
      })
      await this.updateConversation(input.phone, businessId, {
        currentStep: conversationStepFromBookingV2Plan(booking.plan),
        ...booking.conversationPatch
      })
      const presentation = await presentBookingV2Result({
        businessId,
        conversationId: conversation.id,
        result: booking
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const recoveryAction = recoveryActionFromInteractiveReply(input.interactiveReplyId, conversation.id)
    if (recoveryAction === 'handoff') {
      await this.updateConversation(input.phone, businessId, {
        ...queuedConversationHandoffPatch()
      })
      return {
        reply: botCopyService.humanHandoffQueued(),
        replyButtons: handoffCancellationButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (recoveryAction === 'other_query') {
      await this.updateConversation(input.phone, businessId, {
        currentStep: conversation.currentStep,
        misunderstandingCount: 0
      })
      return {
        reply: botCopyService.otherQueryPrompt(isActiveBookingV2Step(conversation.currentStep)),
        replyButtons: otherQueryMenuButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (recoveryAction === 'resume') {
      const clearedConversation = await this.updateConversation(input.phone, businessId, {
        currentStep: conversation.currentStep,
        misunderstandingCount: 0
      })
      if (bookingV2Enabled && businessId && isActiveBookingV2Step(clearedConversation.currentStep)) {
        const resumed = await bookingV2Engine.resume({ businessId, conversation: clearedConversation })
        await this.updateConversation(input.phone, businessId, {
          currentStep: conversationStepFromBookingV2Plan(resumed.plan),
          ...resumed.conversationPatch
        })
        const presentation = await presentBookingV2Result({
          businessId,
          conversationId: conversation.id,
          result: resumed
        })
        return {
          reply: presentation.reply,
          ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      return {
        reply: botCopyService.intentNotUnderstood(),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const catalogRecoveryAction = catalogRecoveryActionFromInteractiveReply(
      input.interactiveReplyId,
      conversation.id
    )
    if (catalogRecoveryAction === 'handoff') {
      await this.updateConversation(input.phone, businessId, {
        ...queuedConversationHandoffPatch()
      })
      return {
        reply: botCopyService.humanHandoffQueued(),
        replyButtons: handoffCancellationButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (catalogRecoveryAction && bookingV2Enabled && businessId) {
      const currentState = stateFromConversation(conversation)
      const nextState = catalogRecoveryAction === 'restart'
        ? freshBookingV2State(currentState.draft.name)
        : {
            ...currentState,
            catalogNavigation: {
              view: 'ALL_SERVICES' as const,
              categoryKey: null,
              categoryName: null,
              pendingCategoryKey: null,
              pendingCategoryName: null
            },
            misunderstandingCount: 0
          }
      const resumed = await bookingV2Engine.resume({
        businessId,
        conversation: conversationPatchFromState(nextState)
      })
      await this.updateConversation(input.phone, businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch
      })
      const presentation = await presentBookingV2Result({
        businessId,
        conversationId: conversation.id,
        result: resumed
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    // El reinicio total es una orden de sistema y debe resolverse antes del
    // router semantico. De otro modo puede interpretarse como restart_booking,
    // conservar el nombre y abrir inmediatamente otra reserva.
    if (hardResetRequested) {
      await bookingDepositService.cancelPendingProofsForConversation({
        conversationId: conversation.id,
        reason: 'La reserva se reinició antes de recibir el comprobante.'
      })
      await this.updateConversation(input.phone, businessId, {
        currentStep: bookingV2Enabled ? 'START' : 'ASK_CUSTOMER_NAME',
        aiEnabled: true,
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        selectedCustomerName: null,
        misunderstandingCount: 0,
        lastAvailability: null,
        bookingV2State: null,
        humanHandoffAt: null,
        humanHandoffResolvedAt: null,
        photoQuoteAcknowledgedAt: null
      })

      const resetReply = bookingV2Enabled
        ? botCopyService.welcome()
        : botCopyService.askInitialName()
      if (!bookingV2Enabled || !businessId) return { reply: resetReply }
      const personality = await getBusinessAssistantPersonality(businessId)
      return {
        reply: applyAssistantPersonalityToReply(resetReply, personality),
        skipHumanize: true
      }
    }

    if (bookingV2Enabled && businessId) {
      const currentState = stateFromConversation(conversation)
      if (
        currentState.pendingPhotoQuote &&
        !isPendingPhotoQuoteActive(currentState.pendingPhotoQuote)
      ) {
        const resetState = freshBookingV2State(currentState.draft.name)
        conversation = await this.updateConversation(input.phone, businessId, {
          currentStep: 'START',
          ...conversationPatchFromState(resetState),
          humanHandoffAt: null,
          humanHandoffResolvedAt: null,
          photoQuoteAcknowledgedAt: null
        })
        if (input.hasImageAttachment) {
          return {
            reply: 'Recibí la imagen, pero la solicitud anterior de presupuesto ya venció y no la envié al equipo. Decime qué servicio querés consultar y empezamos una solicitud nueva.',
            skipMisunderstandingTracking: true,
            skipHumanize: true
          }
        }
      }
    }

    if (input.hasImageAttachment && bookingV2Enabled && businessId) {
      const imageState = stateFromConversation(conversation)
      const pendingPhotoQuote = imageState.pendingPhotoQuote

      if (
        pendingPhotoQuote &&
        isPendingPhotoQuoteActive(pendingPhotoQuote) &&
        isQueuedConversationHandoff(conversation)
      ) {
        if (conversation.photoQuoteAcknowledgedAt) {
          return {
            reply: '',
            messages: [],
            suppressOutbound: true,
            skipMisunderstandingTracking: true,
            skipHumanize: true
          }
        }
        await this.updateConversation(input.phone, businessId, {
          currentStep: 'HUMAN_HANDOFF',
          photoQuoteAcknowledgedAt: new Date()
        })
        return {
          reply: PHOTO_QUOTE_ACKNOWLEDGEMENT,
          replyButtons: handoffCancellationButtons(conversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      const imageQuote = await bookingV2Engine.receiveImageForExactQuote({
        businessId,
        conversation
      })
      if (imageQuote) {
        await this.updateConversation(input.phone, businessId, {
          ...imageQuote.conversationPatch,
          ...queuedConversationHandoffPatch(),
          photoQuoteAcknowledgedAt: new Date()
        })
        return {
          reply: PHOTO_QUOTE_ACKNOWLEDGEMENT,
          replyButtons: handoffCancellationButtons(conversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }

    if (coordinationButtonMessage && bookingV2Enabled && businessId) {
      if (coordinationButtonMessage === 'solicitar atención') {
        await this.updateConversation(input.phone, businessId, {
          ...queuedConversationHandoffPatch()
        })
        return {
          reply: botCopyService.humanHandoffQueued(),
          replyButtons: handoffCancellationButtons(conversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      return this.handleBookingV2({
        phone: input.phone,
        message: coordinationButtonMessage,
        businessId,
        conversation,
        routing: deterministicBookingRouting(coordinationButtonMessage)
      })
    }

    if (bookingV2Enabled && businessId && conversation.currentStep === 'START') {
      let currentState = stateFromConversation(conversation)
      const pendingOptionalName = currentState.optionalNamePrompt

      if (pendingOptionalName) {
        const explicitIntroduction = extractExplicitCustomerIntroduction(message)
        const customerName = explicitIntroduction?.name ?? extractPlainCustomerName(message)

        if (customerName) {
          const nextState: BookingV2State = {
            ...currentState,
            draft: {
              ...currentState.draft,
              name: customerName
            },
            optionalNamePrompt: null,
            misunderstandingCount: 0
          }
          conversation = await this.updateConversation(input.phone, businessId, {
            currentStep: 'START',
            ...conversationPatchFromState(nextState)
          })

          const resumeMessage = explicitIntroduction?.remainingMessage ?? pendingOptionalName.resumeMessage
          if (resumeMessage) {
            const continued = isGenericBookingV2Request(resumeMessage)
              ? await this.handleBookingV2({
                  phone: input.phone,
                  message: resumeMessage,
                  businessId,
                  conversation,
                  routing: deterministicBookingRouting(resumeMessage)
                })
              : await this.handleMessageCore({
                  ...input,
                  message: resumeMessage,
                  businessId
                })
            return {
              ...continued,
              reply: `${botCopyService.customerNameReceived(customerName)}\n\n${continued.reply}`
            }
          }

          return {
            reply: botCopyService.customerNameReceived(customerName),
            skipMisunderstandingTracking: true,
            skipHumanize: true
          }
        }

        currentState = {
          ...currentState,
          optionalNamePrompt: null
        }
        conversation = await this.updateConversation(input.phone, businessId, {
          currentStep: 'START',
          ...conversationPatchFromState(currentState)
        })
      }

      const explicitIntroduction = extractExplicitCustomerIntroduction(message)
      if (explicitIntroduction) {
        const nextState: BookingV2State = {
          ...stateFromConversation(conversation),
          draft: {
            ...stateFromConversation(conversation).draft,
            name: explicitIntroduction.name
          },
          optionalNamePrompt: null,
          misunderstandingCount: 0
        }
        conversation = await this.updateConversation(input.phone, businessId, {
          currentStep: 'START',
          ...conversationPatchFromState(nextState)
        })

        if (!explicitIntroduction.remainingMessage) {
          return {
            reply: botCopyService.customerNameReceived(explicitIntroduction.name),
            skipMisunderstandingTracking: true,
            skipHumanize: true
          }
        }
        message = explicitIntroduction.remainingMessage
      }

      const misaddressedGreeting = extractMisaddressedAssistantGreeting(message)
      if (misaddressedGreeting) {
        const knownCustomerName = stateFromConversation(conversation).draft.name
        if (knownCustomerName) {
          if (!misaddressedGreeting.remainingMessage) {
            return {
              reply: `Soy Cami 😊 Hola ${knownCustomerName.split(/\s+/u)[0]}. ¿En qué te puedo ayudar?`,
              skipMisunderstandingTracking: true,
              skipHumanize: true
            }
          }
          const continued = await this.handleMessageCore({
            ...input,
            message: misaddressedGreeting.remainingMessage,
            businessId
          })
          return {
            ...continued,
            reply: `Soy Cami 😊\n\n${continued.reply}`
          }
        }

        const nextState: BookingV2State = {
          ...stateFromConversation(conversation),
          optionalNamePrompt: {
            promptedAt: new Date().toISOString(),
            resumeMessage: misaddressedGreeting.remainingMessage
          },
          misunderstandingCount: 0
        }
        await this.updateConversation(input.phone, businessId, {
          currentStep: 'START',
          ...conversationPatchFromState(nextState)
        })
        return {
          reply: botCopyService.askOptionalNameAfterCorrection(),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }

    // Un saludo puro al inicio no necesita interpretacion semantica. Resolverlo
    // antes del router evita que una clasificacion probabilistica lo convierta
    // por error en una consulta de horarios u otra informacion del negocio.
    if (
      bookingV2Enabled &&
      businessId &&
      isBookingV2InitialGreeting(conversation.currentStep, message)
    ) {
      const personality = await getBusinessAssistantPersonality(businessId)
      return {
        reply: applyAssistantPersonalityToReply(
          existingConversation ? botCopyService.socialGreeting() : botCopyService.welcome(),
          personality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (
      bookingV2Enabled &&
      businessId &&
      conversation.currentStep === 'START' &&
      isGenericBookingV2Request(message)
    ) {
      const currentState = stateFromConversation(conversation)
      if (!hasActiveBookingData(currentState)) {
        conversation = await this.updateConversation(input.phone, businessId, {
          currentStep: 'START',
          ...conversationPatchFromState(freshBookingV2State(currentState.draft.name))
        })
      }
    }

    // En los estados de menu no hay una reserva en armado que cancelar. Una
    // orden inequivoca sobre un turno confirmado debe resolverse antes del
    // router para que una clasificacion probabilistica no abra otra reserva.
    if (
      bookingV2Enabled &&
      businessId &&
      isMenuStep(conversation.currentStep) &&
      isCancelAppointmentMessage(message, conversation.currentStep)
    ) {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT',
        misunderstandingCount: 0
      })

      return this.buildMyAppointmentsReply(
        input.phone,
        businessId,
        botCopyService.cancelAppointmentIntro()
      )
    }

    const canUseDeterministicBookingContinuation =
      bookingV2Enabled &&
      Boolean(businessId) &&
      !isQueuedConversationHandoff(conversation) &&
      (conversation.currentStep === 'START' || isActiveBookingV2Step(conversation.currentStep)) &&
      (
        (
          conversation.currentStep === 'START' &&
          isGenericBookingV2Request(message)
        ) ||
        (
          conversation.currentStep === 'CONFIRM' &&
          isUnambiguousBookingConfirmation(message)
        ) ||
        await bookingV2Engine.canProcessWithoutGeneralRouter({
          businessId: businessId!,
          conversation,
          message
        })
      )

    if (canUseDeterministicBookingContinuation) {
      return this.handleBookingV2({
        phone: input.phone,
        message,
        businessId: businessId!,
        conversation,
        routing: deterministicBookingRouting(message)
      })
    }

    const bookingV2Routing = bookingV2Enabled && businessId
      ? await conversationRouter.route(await conversationRouterContextService.load({
          businessId,
          conversationId: conversation.id,
          message,
          currentStep: conversation.currentStep,
          conversation
        }))
      : null

    if (
      bookingV2Enabled &&
      businessId &&
      bookingV2Routing &&
      !hardResetRequested &&
      isQueuedConversationHandoff(conversation)
    ) {
      const queuedPhotoQuote = stateFromConversation(conversation).pendingPhotoQuote
      return this.handleQueuedHumanHandoffMessage({
        message,
        businessId,
        conversationId: conversation.id,
        routing: bookingV2Routing,
        pendingPhotoQuoteActive: Boolean(
          queuedPhotoQuote && isPendingPhotoQuoteActive(queuedPhotoQuote)
        )
      })
    }

    if (bookingV2Enabled && businessId && bookingV2Routing) {
      const navigationResult = await this.handleBookingV2Navigation({
        phone: input.phone,
        message,
        businessId,
        conversation,
        routing: bookingV2Routing
      })
      if (navigationResult) return navigationResult
    }

    if (conversation.currentStep === 'CANCEL_SELECT_APPOINTMENT') {
      return this.cancelAppointmentByMessage(input.phone, message, businessId)
    }

    if (conversation.currentStep === 'EDIT_SELECT_APPOINTMENT') {
      return this.editAppointmentByMessage(input.phone, message, businessId)
    }

    const bookingV2AwaitingEstimateOption = Boolean(
      bookingV2Enabled &&
      businessId &&
      stateFromConversation(conversation).guidedEstimate?.stage === 'awaiting_option'
    )
    if (isMyAppointmentsMessage(message, conversation.currentStep, {
      allowMenuShortcut: !bookingV2AwaitingEstimateOption
    })) {
      return this.buildMyAppointmentsReply(input.phone, businessId)
    }

    if (isManageAppointmentMessage(message)) {
      return {
        reply: botCopyService.manageAppointmentPrompt(),
        replyButtons: manageAppointmentDecisionButtons(conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (
      (bookingV2Routing?.intents.some((intent) =>
        intent.type === 'cancel_appointment' && intent.confidence >= 0.65
      ) ?? false) ||
      (!bookingV2Enabled && isCancelAppointmentMessage(message, conversation.currentStep))
    ) {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, businessId, botCopyService.cancelAppointmentIntro())
    }

    if (isEditAppointmentMessage(message, conversation.currentStep)) {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'EDIT_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, businessId, botCopyService.editAppointmentIntro())
    }

    if (isResetMessage(message)) {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'START',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        lastAvailability: null,
        bookingV2State: null
      })

      return {
        reply: botCopyService.resetDone()
      }
    }

    if (
      (bookingV2Enabled && (
        shouldRouteBookingV2HumanHandoff(bookingV2Routing) || isHumanHandoffMessage(message)
      )) ||
      (!bookingV2Enabled && isHumanHandoffMessage(message))
    ) {
      await this.updateConversation(input.phone, businessId, {
        ...queuedConversationHandoffPatch(),
        photoQuoteAcknowledgedAt: null
      })

      return {
        reply: botCopyService.humanHandoffQueued(),
        replyButtons: handoffCancellationButtons(conversation.id)
      }
    }

    if (bookingV2Enabled && businessId && bookingV2Routing) {
      const pendingDepositAddition = await this.handlePendingDepositServiceAddition({
        phone: input.phone,
        businessId,
        conversation,
        routing: bookingV2Routing
      })
      if (pendingDepositAddition) return pendingDepositAddition
    }

    const advisorQuoteState = stateFromConversation(conversation)
    if (
      bookingV2Enabled &&
      businessId &&
      advisorQuoteState.advisorQuote?.status === 'awaiting_acceptance' &&
      advisorQuoteState.advisorQuote.serviceId === advisorQuoteState.draft.service
    ) {
      return this.handleAdvisorQuoteDecision({
        phone: input.phone,
        message,
        businessId,
        conversation,
        state: advisorQuoteState,
        routing: bookingV2Routing
      })
    }

    if (isArrivalNoticeMessage(message) && isMenuStep(conversation.currentStep)) {
      return this.handleArrivalNotice(input.phone, message, businessId)
    }

    if (conversation.currentStep === 'HUMAN_HANDOFF') {
      return {
        reply: botCopyService.humanHandoffAlreadyQueued()
      }
    }

    if (conversation.currentStep === 'COMPLETED') {
      const sanitizedState = bookingV2Enabled && businessId
        ? (await bookingV2Engine.resume({
            businessId,
            conversation
          })).state
        : stateFromConversation(conversation)

      if (isPostBookingClosingMessage(message)) {
        return {
          reply: botCopyService.postBookingClosing(sanitizedState.draft.name),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      const reopenedConversation = await this.updateConversation(input.phone, businessId, {
        currentStep: 'START',
        selectedCustomerName: sanitizedState.draft.name,
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        lastAvailability: null,
        bookingV2State: null
      })

      if (isPostBookingGreetingMessage(message)) {
        const personality = businessId
          ? await getBusinessAssistantPersonality(businessId)
          : null
        const reply = botCopyService.reopenAfterBooking({
          customerName: sanitizedState.draft.name,
          askedHowAreYou: isPostBookingWellbeingQuestion(message)
        })
        return {
          reply: personality
            ? applyAssistantPersonalityToReply(reply, personality)
            : reply,
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      if (bookingV2Enabled && businessId && bookingV2Routing) {
        return this.handleBookingV2({
          phone: input.phone,
          message,
          businessId,
          conversation: reopenedConversation,
          routing: bookingV2Routing
        })
      }

      return {
        reply: sanitizedState.draft.name
          ? botCopyService.mainMenu(sanitizedState.draft.name)
          : botCopyService.welcome()
      }
    }

    if (bookingV2Enabled && businessId && bookingV2Routing) {
      return this.handleBookingV2({
        phone: input.phone,
        message,
        businessId,
        conversation,
        routing: bookingV2Routing
      })
    }

    const orchestratedReply = await this.tryHandleOrchestratedIntent({
      phone: input.phone,
      message,
      businessId,
      conversation
    })

    if (orchestratedReply) {
      return orchestratedReply
    }

    if (
      isMenuStep(conversation.currentStep) &&
      !conversation.selectedCustomerName &&
      !isBookingStartMessage(message, conversation.currentStep)
    ) {
      await this.updateConversation(input.phone, businessId, {
        currentStep: 'ASK_CUSTOMER_NAME',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        lastAvailability: null
      })

      return {
        reply: botCopyService.askInitialName()
      }
    }

    if (conversation.currentStep === 'START' && !isBookingStartMessage(message, conversation.currentStep)) {
      return {
        reply: botCopyService.mainMenu(conversation.selectedCustomerName)
      }
    }

    return bookingConversationFlow.handle({
      phone: input.phone,
      message,
      businessId,
      conversation
    })
  }

  private async handleAdvisorQuoteDecision(input: {
    phone: string
    message: string
    businessId: string
    conversation: {
      id: string
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    state: ReturnType<typeof stateFromConversation>
    routing: ConversationRouting | null
  }): Promise<HandleMessageResult> {
    const quote = input.state.advisorQuote
    if (!quote) {
      return {
        reply: 'No encontré el presupuesto pendiente. El equipo lo revisará con vos.',
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const service = await prisma.service.findFirst({
      where: {
        id: quote.serviceId,
        businessId: input.businessId
      },
      select: { name: true }
    })
    const serviceName = service?.name ?? 'el servicio'
    const personality = await getBusinessAssistantPersonality(input.businessId)
    const quoteChoice = await bookingV2ChoiceExtractor.extract({
      message: input.message,
      question: `El presupuesto de ${serviceName} es ${formatMoneyForConversation(quote.amount)}. ¿Querés continuar con la reserva?`,
      choices: [
        { id: 'accept_quote', meaning: 'Acepta el presupuesto y quiere continuar reservando.' },
        { id: 'reject_quote', meaning: 'Rechaza el presupuesto o decide no continuar.' }
      ]
    })

    if (quoteChoice.confidence >= 0.65 && quoteChoice.choiceId === 'reject_quote') {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'START',
        aiEnabled: true,
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        lastAvailability: null,
        bookingV2State: null,
        humanHandoffResolvedAt: new Date()
      })
      return {
        reply: applyAssistantPersonalityToReply(
          `Entendido, no avanzamos con el presupuesto de ${serviceName}. ¿Te puedo ayudar en algo más?`,
          personality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (!(quoteChoice.confidence >= 0.65 && quoteChoice.choiceId === 'accept_quote')) {
      const informationTopics = input.routing
        ? businessInformationTopicsFromRouting(input.routing)
        : []
      const informationReply = informationTopics.length
        ? await businessKnowledgeService.answer({
            businessId: input.businessId,
            topics: informationTopics,
            ...(input.routing?.catalogQuery
              ? { catalogQuery: input.routing.catalogQuery }
              : {})
          })
        : null
      return {
        reply: applyAssistantPersonalityToReply(
          [
            ...(informationReply ? [informationReply] : []),
            `Para confirmar: el presupuesto de ${serviceName} es ${formatMoneyForConversation(quote.amount)}. ¿Querés continuar con la reserva? Podés responderme sí o no.`
          ].join('\n\n'),
          personality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const acceptedState = {
      ...input.state,
      advisorQuote: {
        ...quote,
        status: 'accepted' as const
      },
      guidedEstimate: input.state.guidedEstimate?.serviceId === quote.serviceId
        ? {
            ...input.state.guidedEstimate,
            stage: 'completed' as const,
            priceMin: quote.amount,
            priceMax: quote.amount
          }
        : input.state.guidedEstimate,
      misunderstandingCount: 0
    }
    const acceptedPatch = conversationPatchFromState(acceptedState)
    const resumed = await bookingV2Engine.resume({
      businessId: input.businessId,
      conversation: {
        selectedCustomerName: acceptedPatch.selectedCustomerName,
        selectedServiceId: acceptedPatch.selectedServiceId,
        selectedProfessionalId: acceptedPatch.selectedProfessionalId,
        selectedDate: acceptedPatch.selectedDate,
        selectedTime: acceptedPatch.selectedTime,
        misunderstandingCount: acceptedPatch.misunderstandingCount,
        bookingV2State: acceptedPatch.bookingV2State
      }
    })
    const nextStep = conversationStepFromBookingV2Plan(resumed.plan)
    const isHandoff = resumed.plan.type === 'handoff'
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: nextStep,
      ...resumed.conversationPatch,
      ...(isHandoff
        ? queuedConversationHandoffPatch()
        : {
            aiEnabled: true,
            humanHandoffResolvedAt: new Date()
          }),
      lastAvailability: resumed.availabilityOptions.length
        ? {
            serviceId: resumed.state.draft.service,
            professionalId: resumed.state.draft.professional,
            date: resumed.state.draft.date,
            options: resumed.availabilityOptions
          }
        : null
    })
    return {
      reply: applyAssistantPersonalityToReply(
        `Perfecto, avanzamos con ${serviceName} por ${formatMoneyForConversation(quote.amount)}.\n\n${resumed.reply}`,
        personality
      ),
      ...(isHandoff
        ? { replyButtons: handoffCancellationButtons(input.conversation.id) }
        : {}),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async handleBookingV2Navigation(input: {
    phone: string
    message: string
    businessId: string
    conversation: {
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    routing: ConversationRouting
  }): Promise<HandleMessageResult | null> {
    const routedNavigationIntent = input.routing.intents
      .filter((intent) =>
        ['cancel_booking', 'go_back', 'restart_booking'].includes(intent.type) &&
        intent.confidence >= 0.65
      )
      .sort((left, right) => right.confidence - left.confidence)[0]?.type
    if (!routedNavigationIntent) return null

    // Cancelar o retroceder muta el borrador. Una segunda comprension acotada
    // evita que una consulta informativa mal clasificada borre la reserva.
    const navigationChoice = await bookingV2ChoiceExtractor.extract({
      message: input.message,
      question: 'Dentro de la reserva en curso, ¿el cliente quiere cancelarla, volver un paso, reiniciarla o solamente está diciendo otra cosa?',
      choices: [
        { id: 'cancel_booking', meaning: 'Quiere abandonar la reserva en curso sin cancelar un turno confirmado.' },
        { id: 'go_back', meaning: 'Quiere volver al paso o elección anterior de la reserva.' },
        { id: 'restart_booking', meaning: 'Quiere borrar el avance y comenzar una nueva reserva desde cero.' },
        { id: 'not_navigation', meaning: 'Es una consulta, respuesta o pedido distinto; no quiere navegar ni borrar la reserva.' }
      ]
    })
    if (navigationChoice.confidence < 0.65 || navigationChoice.choiceId === 'not_navigation') {
      return null
    }
    const navigationIntent = navigationChoice.choiceId

    // La navegacion de una reserva en armado no debe interceptar la gestion de
    // turnos que ya fueron confirmados. Esos pasos tienen su propio flujo.
    if (
      input.conversation.currentStep === 'CANCEL_SELECT_APPOINTMENT' ||
      input.conversation.currentStep === 'EDIT_SELECT_APPOINTMENT' ||
      input.conversation.currentStep === 'COMPLETED'
    ) {
      return null
    }

    const currentState = stateFromConversation(input.conversation)
    const hasBookingInProgress = Boolean(
      currentState.draft.service ||
      currentState.draft.professional ||
      currentState.draft.date ||
      currentState.draft.time ||
      currentState.pendingProposal ||
      currentState.categoryAdvice ||
      currentState.serviceValidation ||
      currentState.guidedEstimate ||
      currentState.queuedServices.length
    )

    if (currentState.pendingDeposit && navigationIntent === 'go_back') {
      return {
        reply: 'El horario ya está retenido mientras esperamos la seña. Puedo sumar un servicio si entra en ese bloque; para cambiar día, horario o profesional primero tenés que cancelar esta reserva.',
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (navigationIntent === 'cancel_booking') {
      if (!hasBookingInProgress) return null
      if (currentState.pendingDeposit) {
        await Promise.all(pendingDepositAppointmentIds(currentState.pendingDeposit).map((appointmentId) =>
          appointmentService.cancel(appointmentId)
        ))
      }
      const cancelledState = freshBookingV2State(currentState.draft.name)
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'START',
        ...conversationPatchFromState(cancelledState),
        lastAvailability: null
      })
      return {
        reply: [
          currentState.queuedServices.length
            ? 'Listo, cancelé la reserva que estábamos armando y los demás servicios pendientes.'
            : 'Listo, cancelé la reserva que estábamos armando.',
          '¿Qué querés hacer ahora?',
          '• Empezar otra reserva',
          '• Consultar servicios, precios u horarios',
          '• No necesito nada más'
        ].join('\n'),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (navigationIntent === 'restart_booking') {
      if (currentState.pendingDeposit) {
        await Promise.all(pendingDepositAppointmentIds(currentState.pendingDeposit).map((appointmentId) =>
          appointmentService.cancel(appointmentId)
        ))
      }
      const restartedState = freshBookingV2State(currentState.draft.name)
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(restartedState)
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch,
        lastAvailability: null
      })
      return {
        reply: `Perfecto, empezamos una nueva reserva.\n\n${resumed.reply}`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (!hasBookingInProgress) return null
    const featureSettings = await prisma.businessFeatureSettings.findUnique({
      where: { businessId: input.businessId },
      select: { bookingFlowOrder: true }
    })
    const previousState = bookingV2StateAfterGoingBack(
      currentState,
      input.conversation.currentStep,
      featureSettings?.bookingFlowOrder ?? 'PROFESSIONAL_FIRST'
    )
    const resumed = await bookingV2Engine.resume({
      businessId: input.businessId,
      conversation: conversationPatchFromState(previousState)
    })
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: conversationStepFromBookingV2Plan(resumed.plan),
      ...resumed.conversationPatch,
      lastAvailability: null
    })
    return {
      reply: `Dale, volvemos al paso anterior.\n\n${resumed.reply}`,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async handleBookingV2(input: {
    phone: string
    message: string
    businessId: string
    conversation: {
      id: string
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    routing: ConversationRouting
  }): Promise<HandleMessageResult> {
    const assistantPersonality = await getBusinessAssistantPersonality(input.businessId)
    let storedInformationState = stateFromConversation(input.conversation)
    const restartedConsultationState = stateAfterExplicitConsultationReplacement(
      storedInformationState,
      input.routing
    )
    if (restartedConsultationState !== storedInformationState) {
      storedInformationState = restartedConsultationState
      input.conversation = {
        ...input.conversation,
        ...conversationPatchFromState(restartedConsultationState)
      }
    }
    if (storedInformationState.pendingCoordinatedAvailability?.phase === 'OPTION_SELECTED') {
      return this.handleCoordinatedBookingConfirmation({
        phone: input.phone,
        message: input.message,
        businessId: input.businessId,
        conversation: input.conversation,
        state: storedInformationState,
        assistantPersonality
      })
    }
    if (shouldPrioritizeGuidedEstimateOptionReply(storedInformationState, input.message)) {
      const estimated = await bookingV2Engine.process({
        businessId: input.businessId,
        conversation: conversationPatchFromState(storedInformationState),
        message: input.message,
        understandingExtraction: null
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepFromBookingV2Plan(estimated.plan),
        ...estimated.conversationPatch,
        lastAvailability: null
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: estimated
      })
      return {
        reply: applyAssistantPersonalityToReply(presentation.reply, assistantPersonality),
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const quoteOnlyRequest = isQuoteOnlyRouting(input.routing, input.message)
    const priceInformationRequest = isPriceInformationRequest(input.routing)
    const multiServicePriceRequest = !quoteOnlyRequest && !input.routing.bookingMessage &&
      priceInformationRequest &&
      await bookingV2Engine.hasMultipleServiceConsultation({
        businessId: input.businessId,
        message: input.message
      })

    if (multiServicePriceRequest) {
      const priceState: BookingV2State = {
        ...storedInformationState,
        draft: {
          ...storedInformationState.draft,
          service: null,
          professional: null,
          date: null,
          time: null
        },
        combinedServices: [],
        guidedEstimate: null,
        quoteOnly: createServiceConsultationQueue('price'),
        pendingInformationSelection: null,
        pendingServiceDisambiguation: null,
        pendingProposal: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
      const priced = await bookingV2Engine.process({
        businessId: input.businessId,
        conversation: conversationPatchFromState(priceState),
        message: input.message,
        understandingExtraction: input.routing.bookingExtraction ?? null
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        ...priced.conversationPatch,
        lastAvailability: null
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: priced
      })
      return {
        reply: applyAssistantPersonalityToReply(presentation.reply, assistantPersonality),
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const quoteServiceIds = Array.from(new Set([
      input.routing.bookingExtraction?.service.value,
      ...(input.routing.bookingExtraction?.additionalServices ?? []).map((service) => service.value),
      input.routing.catalogQuery?.serviceId
    ].filter((serviceId): serviceId is string => Boolean(serviceId))))
    const quotePrimaryServiceId = quoteServiceIds[0] ?? null
    if (shouldStartQuoteOnlyRequest(
      storedInformationState,
      quoteOnlyRequest,
      quotePrimaryServiceId
    )) {
      const serviceIds = quoteServiceIds
      const primaryServiceId = quotePrimaryServiceId
      const quoteState: BookingV2State = {
        ...storedInformationState,
        draft: {
          ...storedInformationState.draft,
          service: null,
          professional: null,
          date: null,
          time: null
        },
        combinedServices: [],
        guidedEstimate: null,
        quoteOnly: createServiceConsultationQueue('quote', serviceIds.slice(1)),
        pendingProposal: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
      const estimated = await bookingV2Engine.process({
        businessId: input.businessId,
        conversation: conversationPatchFromState(quoteState),
        message: input.message,
        understandingExtraction: input.routing.bookingExtraction ?? null
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        ...estimated.conversationPatch,
        lastAvailability: null
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: estimated
      })
      return {
        reply: applyAssistantPersonalityToReply(presentation.reply, assistantPersonality),
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const storedQuoteOnly = storedInformationState.quoteOnly
    if (storedQuoteOnly && shouldResumeQuoteOnlyBooking(storedInformationState, input.message, input.routing)) {
      const bookingState = bookingStateFromCompletedServiceConsultation(storedInformationState)
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        ...conversationPatchFromState(bookingState)
      })
      input.conversation = {
        ...input.conversation,
        ...conversationPatchFromState(bookingState)
      }
      storedInformationState = bookingState
    }
    if (isPendingServiceVerificationSelection(storedInformationState, input.routing)) {
      const verified = await bookingV2Engine.process({
        businessId: input.businessId,
        conversation: conversationPatchFromState(storedInformationState),
        message: input.message,
        understandingExtraction: input.routing.bookingExtraction ?? null
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        ...verified.conversationPatch,
        lastAvailability: null
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: verified
      })
      return {
        reply: applyAssistantPersonalityToReply(presentation.reply, assistantPersonality),
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const pendingInformationSelection = storedInformationState.pendingInformationSelection
    if (pendingInformationSelection && !hasExplicitBookingRequest(input.message)) {
      const selectedServiceId = input.routing.catalogQuery?.serviceId ??
        input.routing.bookingExtraction?.service.value ??
        await this.resolvePendingInformationServiceSelection({
          businessId: input.businessId,
          message: input.message,
          serviceIds: pendingInformationSelection.serviceIds
        })
      if (selectedServiceId && pendingInformationSelection.serviceIds.includes(selectedServiceId)) {
        if (pendingInformationSelection.quoteOnly) {
          const quoteState: BookingV2State = {
            ...storedInformationState,
            draft: { ...storedInformationState.draft, service: selectedServiceId, professional: null, date: null, time: null },
            combinedServices: [],
            guidedEstimate: null,
            quoteOnly: { remainingServiceIds: [], estimates: [] },
            pendingInformationSelection: null,
            misunderstandingCount: 0
          }
          const estimated = await bookingV2Engine.resume({
            businessId: input.businessId,
            conversation: conversationPatchFromState(quoteState)
          })
          await this.updateConversation(input.phone, input.businessId, {
            currentStep: conversationStepValue(input.conversation.currentStep),
            ...estimated.conversationPatch
          })
          const presentation = await presentBookingV2Result({
            businessId: input.businessId,
            conversationId: input.conversation.id,
            result: estimated
          })
          return {
            reply: applyAssistantPersonalityToReply(presentation.reply, assistantPersonality),
            ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
            skipMisunderstandingTracking: true,
            skipHumanize: true
          }
        }
        const detailReply = await businessKnowledgeService.answer({
          businessId: input.businessId,
          topics: businessInformationTopicsForPendingSelection(
            pendingInformationSelection.requestedInformation
          ),
          catalogQuery: {
            serviceId: selectedServiceId,
            candidateServiceIds: [selectedServiceId],
            requestedInformation: pendingInformationSelection.requestedInformation,
            confidence: 1,
            evidence: input.message.trim()
          }
        })
        const nextState: BookingV2State = {
          ...storedInformationState,
          pendingInformationSelection: null,
          lastInformationServiceId: selectedServiceId
        }
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepValue(input.conversation.currentStep),
          ...conversationPatchFromState(nextState)
        })
        return {
          reply: applyAssistantPersonalityToReply(
            withBusinessInformationFollowUp(detailReply ?? 'No encontré información para esa opción.'),
            assistantPersonality
          ),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }
    if (pendingInformationSelection && hasExplicitBookingRequest(input.message)) {
      storedInformationState = {
        ...storedInformationState,
        pendingInformationSelection: null
      }
      input.conversation = {
        ...input.conversation,
        ...conversationPatchFromState(storedInformationState)
      }
    }
    const depositInformationRequest = isDepositInformationRequest(input.message) ||
      hasGroundedDepositInformationIntent(input.routing, input.message)
    const informationTopics = businessInformationTopicsFromRouting(input.routing)
    const pendingCoordinatedPhase = storedInformationState.pendingCoordinatedAvailability?.phase ?? null
    const deterministicCoordinatedAction = shouldPrioritizeCoordinatedAvailabilityAction(
      input.message,
      pendingCoordinatedPhase
    )
    if (deterministicCoordinatedAction) {
      informationTopics.splice(0)
    } else if (pendingCoordinatedPhase === 'AWAITING_SEARCH_MENU' && informationTopics.length) {
      const decision = await bookingV2ChoiceExtractor.extract({
        message: bookingCoordinationActionableReply(input.message),
        question: '¿El cliente está eligiendo una acción del menú actual de búsqueda de turnos o está consultando información general del negocio?',
        choices: [
          {
            id: 'availability_action',
            meaning: 'Responde al menú actual: ver todos los turnos del día, buscar próximos días o buscar por una hora.'
          },
          {
            id: 'business_information',
            meaning: 'Pregunta por horarios de apertura, catálogo de servicios u otra información general del negocio.'
          }
        ]
      })
      if (decision.choiceId === 'availability_action' && decision.confidence >= 0.85) {
        informationTopics.splice(0)
      }
    }
    if (depositInformationRequest && !informationTopics.includes('prices')) {
      informationTopics.push('prices')
    }
    const contextualCatalogQuery: CatalogQuery | null = input.routing.catalogQuery ?? (
      depositInformationRequest && storedInformationState.lastInformationServiceId
        ? {
            serviceId: storedInformationState.lastInformationServiceId,
            candidateServiceIds: [storedInformationState.lastInformationServiceId],
            requestedInformation: ['deposit'],
            confidence: 1,
            evidence: input.message.trim()
          }
        : null
    )
    if (depositInformationRequest && !contextualCatalogQuery?.serviceId) {
      return {
        reply: applyAssistantPersonalityToReply(
          '¿Sobre qué servicio querés saber el valor de la seña?',
          assistantPersonality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    let informationReply = informationTopics.length
      ? await businessKnowledgeService.answer({
          businessId: input.businessId,
          topics: informationTopics,
          ...(contextualCatalogQuery
            ? { catalogQuery: contextualCatalogQuery }
            : {})
        })
      : null
    const professionalScheduleIntent = input.routing.intents.find((intent) =>
      intent.type === 'professional_schedule' && intent.confidence >= 0.65
    )
    const isPendingDeterministicDecision = Boolean(
      storedInformationState.pendingServiceSeparation &&
      detectDeterministicConfirmation(input.message)
    )
    const professionalId = input.routing.bookingExtraction?.professional.value ?? null
    const availabilityDate = input.routing.bookingExtraction?.date.value ?? null
    const availabilityTimeFrom = preliminaryAvailabilityTimeFrom(
      input.message,
      input.routing.bookingExtraction?.time.value ?? null
    )
    if (shouldHandleProfessionalAvailabilityInquiry({
      message: input.message,
      professionalId,
      date: availabilityDate,
      hasAvailabilityIntent: input.routing.intents.some((intent) =>
        ['availability_preference', 'professional_schedule'].includes(intent.type) &&
        intent.confidence >= 0.65
      )
    })) {
      const preliminaryAvailability = await this.preliminaryProfessionalAvailability({
        phone: input.phone,
        businessId: input.businessId,
        conversationId: input.conversation.id,
        state: storedInformationState,
        professionalId: professionalId!,
        date: availabilityDate!,
        timeFrom: availabilityTimeFrom,
        assistantPersonality
      })
      if (preliminaryAvailability) return preliminaryAvailability
    }
    if (shouldHandleProfessionalScheduleInformation({
      hasProfessionalScheduleIntent: Boolean(professionalScheduleIntent),
      hasPendingCoordinatedAvailability: Boolean(storedInformationState.pendingCoordinatedAvailability),
      isPendingDeterministicDecision,
      hasProfessionalId: Boolean(professionalId),
      informationTopicCount: informationTopics.length,
      hasExplicitScheduleQuestion: isExplicitProfessionalScheduleQuestion(input.message),
      hasPriorityPendingChoice: shouldPrioritizeGuidedEstimateOptionReply(
        storedInformationState,
        input.message
      )
    })) {
      const scheduleReply = professionalId
        ? await this.professionalScheduleReply(input.businessId, professionalId)
        : 'Entendí que querés consultar los horarios de un profesional. ¿De quién querés saberlos?'
      if (input.routing.bookingMessage) {
        informationReply = appendBusinessInformationReply(informationReply, scheduleReply)
      } else {
        const resumed = shouldResumeBookingV2AfterInformation(
          input.conversation.currentStep,
          storedInformationState
        )
          ? await bookingV2Engine.resume({
              businessId: input.businessId,
              conversation: input.conversation
            })
          : null
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepValue(input.conversation.currentStep),
          misunderstandingCount: 0
        })
        const resumedPresentation = resumed
          ? await presentBookingV2Result({
              businessId: input.businessId,
              conversationId: input.conversation.id,
              result: resumed
            })
          : null
        return {
          reply: applyAssistantPersonalityToReply(
            resumedPresentation
              ? composeBusinessInformationResumeReply(scheduleReply, resumedPresentation.reply)
              : scheduleReply,
            assistantPersonality
          ),
          ...(resumedPresentation?.buttons ? { replyButtons: resumedPresentation.buttons } : {}),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }
    const serviceDetailIntent = input.routing.intents.find((intent) =>
      intent.type === 'service_detail' &&
      intent.confidence >= 0.65 &&
      !isGroundedUnsupportedServiceRequest(input.message, input.routing)
    )
    if (serviceDetailIntent) {
      const explicitServiceId = input.routing.catalogQuery?.serviceId ??
        input.routing.bookingExtraction?.service.value ??
        storedInformationState.lastInformationServiceId ??
        input.conversation.selectedServiceId ??
        storedInformationState.guidedEstimate?.serviceId
      const detailCatalogQuery = input.routing.catalogQuery ?? (explicitServiceId
        ? {
            serviceId: explicitServiceId,
            candidateServiceIds: [explicitServiceId],
            requestedInformation: ['general'] as const,
            confidence: serviceDetailIntent.confidence,
            evidence: serviceDetailIntent.evidence
          }
        : null)
      const detailReply = detailCatalogQuery
        ? await businessKnowledgeService.answer({
            businessId: input.businessId,
            topics: ['services'],
            catalogQuery: {
              ...detailCatalogQuery,
              requestedInformation: ['general'],
            }
          })
        : unresolvedServiceInformationReply(null)
      if (input.routing.bookingMessage) {
        informationReply = appendBusinessInformationReply(informationReply, detailReply)
      } else {
        if (!detailCatalogQuery) {
          const serviceIds = await this.informationSelectionServiceIds(input.businessId)
          if (serviceIds.length) {
            const nextState: BookingV2State = {
              ...storedInformationState,
              pendingInformationSelection: {
                serviceIds,
                requestedInformation: ['general']
              }
            }
            await this.updateConversation(input.phone, input.businessId, {
              currentStep: conversationStepValue(input.conversation.currentStep),
              ...conversationPatchFromState(nextState)
            })
            return {
              reply: applyAssistantPersonalityToReply(
                detailReply ?? unresolvedServiceInformationReply(null),
                assistantPersonality
              ),
              skipMisunderstandingTracking: true,
              skipHumanize: true
            }
          }
        }
        const detailState: BookingV2State = detailCatalogQuery?.serviceId
          ? { ...storedInformationState, lastInformationServiceId: detailCatalogQuery.serviceId }
          : storedInformationState
        const resumed = shouldResumeBookingV2AfterInformation(
          input.conversation.currentStep,
          detailState
        )
          ? await bookingV2Engine.resume({
              businessId: input.businessId,
              conversation: conversationPatchFromState(detailState)
            })
          : null
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepValue(input.conversation.currentStep),
          ...conversationPatchFromState(detailState)
        })
        const resumedPresentation = resumed
          ? await presentBookingV2Result({
              businessId: input.businessId,
              conversationId: input.conversation.id,
              result: resumed
            })
          : null
        const requiredReply = applyAssistantPersonalityToReply(
          resumedPresentation && detailReply
            ? composeBusinessInformationResumeReply(detailReply, resumedPresentation.reply)
            : detailReply ?? 'No tengo ese detalle cargado de forma confiable.',
          assistantPersonality
        )
        const needsHumanRecovery = businessInformationNeedsHuman(requiredReply)
        return {
          reply: requiredReply,
          ...(needsHumanRecovery
            ? { replyButtons: recoveryDecisionButtons(input.conversation.id) }
            : resumedPresentation?.buttons
              ? { replyButtons: resumedPresentation.buttons }
            : {}),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }
    if (isGroundedUnsupportedServiceRequest(input.message, input.routing)) {
      const state = stateFromConversation(input.conversation)
      const normalizedRequest = normalizeText(input.message)
      const unsupportedServiceCount = state.unsupportedServiceRequest?.normalizedRequest === normalizedRequest
        ? state.unsupportedServiceRequest.count + 1
        : 1
      const unsupportedState: BookingV2State = {
        ...state,
        unsupportedServiceRequest: {
          normalizedRequest,
          count: unsupportedServiceCount
        }
      }
      const unsupportedPatch = conversationPatchFromState(unsupportedState)
      if (unsupportedServiceCount >= 2) {
        await this.updateConversation(input.phone, input.businessId, {
          ...unsupportedPatch,
          ...queuedConversationHandoffPatch()
        })
        return {
          reply: applyAssistantPersonalityToReply(
            botCopyService.unsupportedServiceHandoff(),
            assistantPersonality
          ),
          replyButtons: handoffCancellationButtons(input.conversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      await this.updateConversation(input.phone, input.businessId, {
        ...unsupportedPatch,
        currentStep: conversationStepValue(input.conversation.currentStep),
        misunderstandingCount: input.conversation.misunderstandingCount
      })
      return {
        reply: applyAssistantPersonalityToReply(
          botCopyService.unsupportedService(isActiveBookingV2Step(input.conversation.currentStep)),
          assistantPersonality
        ),
        replyButtons: unsupportedServiceDecisionButtons(input.conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const routedOtherQueryConfidence = Math.max(
      0,
      ...input.routing.intents
        .filter((intent) => intent.type === 'other_query')
        .map((intent) => intent.confidence)
    )
    const deterministicBookingConfirmation =
      input.conversation.currentStep === 'CONFIRM' &&
      isUnambiguousBookingConfirmation(input.message)
    let confirmedOtherQuery = false
    if (
      routedOtherQueryConfidence >= 0.4 &&
      !deterministicBookingConfirmation &&
      !input.routing.bookingMessage &&
      informationTopics.length === 0 &&
      !looksLikeExpectedCustomerName(
        input.message,
        input.conversation.currentStep
      )
    ) {
      const decision = await bookingV2ChoiceExtractor.extract({
        message: input.message,
        question: '¿El cliente está anunciando que quiere hacer otra consulta, pero todavía no escribió cuál es?',
        choices: [
          { id: 'other_query', meaning: 'Anuncia una pregunta o duda nueva sin expresar todavía la consulta concreta.' },
          { id: 'concrete_query', meaning: 'Ya escribió una pregunta concreta, una selección o una acción para ejecutar.' }
        ]
      })
      confirmedOtherQuery = decision.choiceId === 'other_query' && decision.confidence >= 0.85
    }
    if (
      confirmedOtherQuery &&
      !input.routing.bookingMessage &&
      informationTopics.length === 0
    ) {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        misunderstandingCount: 0
      })
      return {
        reply: applyAssistantPersonalityToReply(
          botCopyService.otherQueryPrompt(isActiveBookingV2Step(input.conversation.currentStep)),
          assistantPersonality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const professionalChangeMode = professionalChangeRoutingMode({
      message: input.message,
      currentStep: input.conversation.currentStep,
      hasSelectedProfessional: Boolean(input.conversation.selectedProfessionalId),
      routing: input.routing
    })
    let shouldChangeProfessional = professionalChangeMode === 'confirmed'
    if (professionalChangeMode === 'verify') {
      const decision = await bookingV2ChoiceExtractor.extract({
        message: input.message,
        question: '¿El cliente quiere descartar el profesional elegido y volver a seleccionar quién lo atenderá?',
        choices: [
          { id: 'change_professional', meaning: 'Quiere cambiar o volver a elegir el profesional de esta reserva.' },
          { id: 'keep_professional', meaning: 'No quiere cambiar el profesional; está haciendo otra consulta o respondiendo otra cosa.' }
        ]
      })
      shouldChangeProfessional = decision.choiceId === 'change_professional' && decision.confidence >= 0.85
    }
    if (shouldChangeProfessional) {
      const changedState = clearBookingV2StateFromField(
        stateFromConversation(input.conversation),
        'professional'
      )
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(changedState)
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch,
        misunderstandingCount: 0,
        lastAvailability: null
      })
      return {
        reply: applyAssistantPersonalityToReply(
          `Dale, cambiamos el profesional.\n\n${resumed.reply}`,
          assistantPersonality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const bookingConfirmationChoice = input.conversation.currentStep === 'CONFIRM'
      ? deterministicBookingConfirmation
        ? { choiceId: 'confirm_booking', confidence: 1 }
        : await bookingV2ChoiceExtractor.extract({
            message: input.message,
            question: '¿Confirmás definitivamente esta reserva con el servicio, profesional, fecha y horario indicados?',
            choices: [
              { id: 'confirm_booking', meaning: 'Confirma la reserva completa y autoriza crear el turno.' },
              { id: 'change_service', meaning: 'Quiere cambiar o volver a elegir el servicio.' },
              { id: 'change_professional', meaning: 'Quiere cambiar o volver a elegir el profesional.' },
              { id: 'change_date', meaning: 'Quiere cambiar o volver a elegir el día o fecha.' },
              { id: 'change_time', meaning: 'Quiere cambiar o volver a elegir el horario.' },
              { id: 'cancel_booking', meaning: 'Quiere abandonar esta reserva sin crear el turno.' },
              { id: 'review_options', meaning: 'No confirma pero tampoco indica qué dato quiere cambiar.' }
            ]
          })
      : null

    if (
      input.conversation.currentStep === 'CONFIRM' &&
      bookingConfirmationChoice &&
      bookingConfirmationChoice.confidence >= 0.65 &&
      bookingConfirmationChoice.choiceId === 'confirm_booking' &&
      input.conversation.selectedCustomerName &&
      input.conversation.selectedServiceId &&
      input.conversation.selectedProfessionalId &&
      input.conversation.selectedDate &&
      input.conversation.selectedTime
    ) {
      const professionalAcceptsBotBookings = await prisma.professional.findFirst({
        where: {
          id: input.conversation.selectedProfessionalId,
          businessId: input.businessId,
          isActive: true,
          acceptsBotBookings: true,
          serviceLinks: { some: { serviceId: input.conversation.selectedServiceId } }
        },
        select: { id: true }
      })
      if (!professionalAcceptsBotBookings) {
        const changedState = clearBookingV2StateFromField(
          stateFromConversation(input.conversation),
          'professional'
        )
        const resumed = await bookingV2Engine.resume({
          businessId: input.businessId,
          conversation: conversationPatchFromState(changedState)
        })
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepFromBookingV2Plan(resumed.plan),
          ...resumed.conversationPatch,
          lastAvailability: null
        })
        return {
          reply: `Ese profesional ya no recibe reservas automáticas. Elegí otra opción para continuar.\n\n${resumed.reply}`,
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      const depositRequest = await this.requestBookingV2DepositIfNeeded({
        phone: input.phone,
        businessId: input.businessId,
        conversation: {
          id: input.conversation.id,
          selectedCustomerName: input.conversation.selectedCustomerName,
          selectedServiceId: input.conversation.selectedServiceId,
          selectedProfessionalId: input.conversation.selectedProfessionalId,
          selectedDate: input.conversation.selectedDate,
          selectedTime: input.conversation.selectedTime,
          misunderstandingCount: input.conversation.misunderstandingCount,
          bookingV2State: input.conversation.bookingV2State
        }
      })
      if (depositRequest) {
        return informationReply
          ? {
              ...depositRequest,
              reply: `${informationReply}\n\n${depositRequest.reply}`
            }
          : depositRequest
      }

      const confirmation = await this.confirmBookingV2Appointment({
        phone: input.phone,
        businessId: input.businessId,
        conversation: {
          id: input.conversation.id,
          selectedCustomerName: input.conversation.selectedCustomerName,
          selectedServiceId: input.conversation.selectedServiceId,
          selectedProfessionalId: input.conversation.selectedProfessionalId,
          selectedDate: input.conversation.selectedDate,
          selectedTime: input.conversation.selectedTime,
          bookingV2State: input.conversation.bookingV2State
        }
      })

      return informationReply
        ? {
            ...confirmation,
            reply: `${informationReply}\n\n${confirmation.reply}`
          }
        : confirmation
    }

    const confirmationChangeField = bookingConfirmationChoice?.choiceId === 'change_service'
      ? 'service'
      : bookingConfirmationChoice?.choiceId === 'change_professional'
        ? 'professional'
        : bookingConfirmationChoice?.choiceId === 'change_date'
          ? 'date'
          : bookingConfirmationChoice?.choiceId === 'change_time'
            ? 'time'
            : null
    if (
      input.conversation.currentStep === 'CONFIRM' &&
      bookingConfirmationChoice &&
      bookingConfirmationChoice.confidence >= 0.65 &&
      confirmationChangeField
    ) {
      const changedState = clearBookingV2StateFromField(
        stateFromConversation(input.conversation),
        confirmationChangeField
      )
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(changedState)
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch,
        lastAvailability: null
      })
      return {
        reply: `Dale, lo cambiamos.\n\n${resumed.reply}`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (
      input.conversation.currentStep === 'CONFIRM' &&
      bookingConfirmationChoice &&
      bookingConfirmationChoice.confidence >= 0.65 &&
      bookingConfirmationChoice.choiceId === 'cancel_booking'
    ) {
      const stateBeforeCancellation = stateFromConversation(input.conversation)
      const cancelledState = freshBookingV2State(input.conversation.selectedCustomerName)
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'START',
        ...conversationPatchFromState(cancelledState),
        lastAvailability: null
      })
      return {
        reply: stateBeforeCancellation.queuedServices.length
          ? 'Listo, cancelé esta reserva y los demás servicios pendientes. Si querés, podemos empezar otra o hacer una consulta.'
          : 'Listo, cancelé la reserva antes de confirmarla. Si querés, podemos empezar otra o hacer una consulta.',
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (
      input.conversation.currentStep === 'CONFIRM' &&
      bookingConfirmationChoice &&
      bookingConfirmationChoice.confidence >= 0.65 &&
      bookingConfirmationChoice.choiceId === 'review_options'
    ) {
      return {
        reply: [
          'No confirmé la reserva.',
          '¿Qué querés hacer?',
          '• Cambiar el servicio',
          '• Cambiar el profesional',
          '• Cambiar el día',
          '• Cambiar el horario',
          '• Cancelar esta reserva'
        ].join('\n'),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (
      input.conversation.currentStep === 'START' &&
      !input.routing.bookingMessage &&
      isBookingV2ConversationClosing(input.message, input.routing)
    ) {
      return {
        reply: applyAssistantPersonalityToReply(
          botCopyService.conversationClosed(),
          assistantPersonality
        ),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (informationReply && !input.routing.bookingMessage) {
      const candidateServiceIds = input.routing.catalogQuery?.candidateServiceIds ?? []
      const requestedPendingInformation = pendingInformationSelectionRequest(input.routing)
      const pendingServiceIds = candidateServiceIds.length > 1
        ? candidateServiceIds
        : requestedPendingInformation
          ? await this.informationSelectionServiceIds(input.businessId)
          : []
      if (
        !input.routing.catalogQuery?.serviceId &&
        requestedPendingInformation &&
        pendingServiceIds.length
      ) {
        const nextState: BookingV2State = {
          ...storedInformationState,
          pendingInformationSelection: {
            serviceIds: pendingServiceIds,
            requestedInformation: requestedPendingInformation
          }
        }
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepValue(input.conversation.currentStep),
          ...conversationPatchFromState(nextState)
        })
        return {
          reply: applyAssistantPersonalityToReply(informationReply, assistantPersonality),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      if (!shouldResumeBookingV2AfterInformation(input.conversation.currentStep, storedInformationState)) {
        const nextInformationState: BookingV2State = contextualCatalogQuery?.serviceId
          ? { ...storedInformationState, lastInformationServiceId: contextualCatalogQuery.serviceId }
          : storedInformationState
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepValue(input.conversation.currentStep),
          ...conversationPatchFromState(nextInformationState)
        })
        const requiredReply = applyAssistantPersonalityToReply(
          withBusinessInformationFollowUp(informationReply),
          assistantPersonality
        )
        return {
          reply: requiredReply,
          ...(businessInformationNeedsHuman(informationReply)
            ? { replyButtons: recoveryDecisionButtons(input.conversation.id) }
            : {}),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: input.conversation
      })
      const nextInformationState: BookingV2State = contextualCatalogQuery?.serviceId
        ? { ...storedInformationState, lastInformationServiceId: contextualCatalogQuery.serviceId }
        : storedInformationState
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        ...conversationPatchFromState(nextInformationState)
      })

      const resumedPresentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: resumed
      })
      const requiredReply = applyAssistantPersonalityToReply(
        composeBusinessInformationResumeReply(informationReply, resumedPresentation.reply),
        assistantPersonality
      )
      const needsHumanRecovery = businessInformationNeedsHuman(informationReply)
      return {
        reply: requiredReply,
        ...(needsHumanRecovery
          ? { replyButtons: recoveryDecisionButtons(input.conversation.id) }
          : resumedPresentation.buttons
            ? { replyButtons: resumedPresentation.buttons }
          : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (shouldShowBookingV2IntentFallback(
      input.conversation.currentStep,
      input.routing
    )) {
      const misunderstandingCount = input.conversation.misunderstandingCount + 1
      if (misunderstandingCount >= 3) {
        await this.updateConversation(input.phone, input.businessId, {
          ...queuedConversationHandoffPatch()
        })
        return {
          reply: applyAssistantPersonalityToReply(
            botCopyService.repeatedMisunderstandingHandoff(),
            assistantPersonality
          ),
          replyButtons: handoffCancellationButtons(input.conversation.id),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepValue(input.conversation.currentStep),
        misunderstandingCount
      })
      return {
        reply: applyAssistantPersonalityToReply(
          botCopyService.intentNotUnderstood(),
          assistantPersonality
        ),
        ...(misunderstandingCount >= 2
          ? { replyButtons: recoveryDecisionButtons(input.conversation.id) }
          : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const storedState = {
      ...stateFromConversation(input.conversation),
      unsupportedServiceRequest: null,
      pendingInformationSelection: null
    }
    const stateWithAgenda = mergeBookingV2AgendaFromRouting({
      state: storedState,
      routing: input.routing
    })
    const pendingRequest = storedState.pendingRequest ?? pendingRequestFromRouting({
      currentStep: input.conversation.currentStep,
      state: storedState,
      routing: input.routing
    })

    let result = await bookingV2Engine.process({
      businessId: input.businessId,
      conversation: conversationPatchFromState(stateWithAgenda),
      message: input.conversation.bookingV2State
        ? input.message
        : input.routing.bookingMessage ?? input.message,
      // ConversationRouter es la unica capa de comprension general en el
      // camino productivo. Pasar null explicitamente evita que BookingV2Engine
      // realice una segunda extraccion con IA para el mismo mensaje.
      understandingExtraction: input.routing.bookingExtraction ?? null
    })

    if (!result.state.draft.name && pendingRequest) {
      result = withPendingBookingRequest(result, pendingRequest)
    } else if (
      result.state.draft.name &&
      storedState.pendingRequest &&
      !result.state.draft.service
    ) {
      const replayState: BookingV2State = {
        ...result.state,
        pendingRequest: null
      }
      result = await bookingV2Engine.process({
        businessId: input.businessId,
        conversation: conversationPatchFromState(replayState),
        message: storedState.pendingRequest.message,
        understandingExtraction: storedState.pendingRequest.extraction ?? null
      })
    }

    if (result.state.draft.name && result.state.pendingRequest) {
      result = withPendingBookingRequest(result, null)
    }

    const nextStep = conversationStepFromBookingV2Plan(result.plan)
    const isHandoff = result.plan.type === 'handoff'
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: nextStep,
      ...result.conversationPatch,
      ...(isHandoff
        ? {
            ...queuedConversationHandoffPatch(),
            photoQuoteAcknowledgedAt: null
          }
        : {}),
      lastAvailability: result.availabilityOptions.length
        ? {
            serviceId: result.state.draft.service,
            professionalId: result.state.draft.professional,
            date: result.state.draft.date,
            options: result.availabilityOptions
          }
        : null
    })

    const presentation = await presentBookingV2Result({
      businessId: input.businessId,
      conversationId: input.conversation.id,
      result
    })
    const requiredReply = applyAssistantPersonalityToReply(
      informationReply ? `${informationReply}\n\n${presentation.reply}` : presentation.reply,
      assistantPersonality
    )
    // La respuesta ya contiene los datos deterministas y la personalidad del
    // comercio. Evitamos una segunda llamada de IA solo para anteponer una
    // frase social a cada paso de la reserva.
    const composedReply = requiredReply
    const needsRecoveryButtons = result.plan.type === 'ask_field' &&
      result.plan.reason === 'not_understood' &&
      result.state.misunderstandingCount >= 2
    const coordinationButtons = presentation.buttons
    const standardProfessionalButtons = !coordinationButtons &&
      result.plan.type === 'ask_field' &&
      result.plan.field === 'professional'
      ? await this.bookingV2MisunderstandingButtons({
          businessId: input.businessId,
          conversationId: input.conversation.id,
          field: 'professional',
          serviceIds: Array.from(new Set([
            result.state.draft.service,
            ...result.state.combinedServices.map((service) => service.serviceId)
          ].filter((serviceId): serviceId is string => Boolean(serviceId))))
        })
      : null
    const replyButtons = coordinationButtons ?? standardProfessionalButtons ?? (needsRecoveryButtons
      ? await this.bookingV2MisunderstandingButtons({
          businessId: input.businessId,
          conversationId: input.conversation.id,
          field: result.plan.type === 'ask_field' ? result.plan.field : null,
          serviceIds: Array.from(new Set([
            result.state.draft.service,
            ...result.state.combinedServices.map((service) => service.serviceId)
          ].filter((serviceId): serviceId is string => Boolean(serviceId))))
        })
      : null)
    const finalReplyButtons = isHandoff
      ? handoffCancellationButtons(input.conversation.id)
      : replyButtons
    return {
      reply: composedReply,
      messages: result.messages
        ? result.messages.map((message, index) => applyAssistantPersonalityToReply(
            index === 0 && informationReply ? `${informationReply}\n\n${message}` : message,
            assistantPersonality
          ))
        : splitWhatsAppReply(composedReply),
      ...(finalReplyButtons ? { replyButtons: finalReplyButtons } : {}),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async handleQueuedHumanHandoffMessage(input: {
    message: string
    businessId: string
    conversationId: string
    routing: ConversationRouting
    pendingPhotoQuoteActive: boolean
  }): Promise<HandleMessageResult> {
    const assistantPersonality = await getBusinessAssistantPersonality(input.businessId)
    const topics = businessInformationTopicsFromRouting(input.routing)
    const informationReply = topics.length || input.routing.catalogQuery
      ? await businessKnowledgeService.answer({
          businessId: input.businessId,
          topics,
          ...(input.routing.catalogQuery
            ? { catalogQuery: input.routing.catalogQuery }
            : {})
        })
      : null
    if (informationReply) {
      const photoQuoteNotice = input.pendingPhotoQuoteActive
        ? 'El equipo sigue teniendo tus imágenes y te responderá por el presupuesto apenas pueda.'
        : null
      return {
        reply: applyAssistantPersonalityToReply(
          input.routing.bookingMessage
            ? `${informationReply}\n\n${botCopyService.humanHandoffBookingLocked()}`
            : photoQuoteNotice
              ? `${informationReply}\n\n${photoQuoteNotice}`
              : informationReply,
          assistantPersonality
        ),
        replyButtons: handoffCancellationButtons(input.conversationId),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    return {
      reply: applyAssistantPersonalityToReply(
        input.routing.bookingMessage
          ? botCopyService.humanHandoffBookingLocked()
          : botCopyService.humanHandoffAlreadyQueued(),
        assistantPersonality
      ),
      replyButtons: handoffCancellationButtons(input.conversationId),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async resolvePendingInformationServiceSelection(input: {
    businessId: string
    message: string
    serviceIds: string[]
  }) {
    const services = await prisma.service.findMany({
      where: {
        businessId: input.businessId,
        id: { in: input.serviceIds },
        isBookable: true
      },
      select: {
        id: true,
        name: true,
        aliases: { select: { name: true } }
      }
    })
    return resolvePendingInformationSelectionFromLabels(
      input.message,
      services.map((service) => ({
        id: service.id,
        labels: [service.name, ...service.aliases.map((alias) => alias.name)]
      }))
    )
  }

  private async informationSelectionServiceIds(businessId: string) {
    const services = await prisma.service.findMany({
      where: {
        businessId,
        isBookable: true
      },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })
    return services.map((service) => service.id)
  }

  private async bookingV2MisunderstandingButtons(input: {
    businessId: string
    conversationId: string
    field: string | null
    serviceIds: string[]
  }) {
    if (input.field === 'service') {
      const featureSettings = await prisma.businessFeatureSettings.findUnique({
        where: { businessId: input.businessId },
        select: { serviceCatalogDisplayMode: true }
      }).catch(() => null)
      if (featureSettings?.serviceCatalogDisplayMode === 'CATEGORIES_FIRST') {
        return catalogRecoveryDecisionButtons(input.conversationId)
      }
    }
    if (input.field !== 'professional') {
      return recoveryDecisionButtons(input.conversationId)
    }

    const professionals = await prisma.professional.findMany({
      where: {
        businessId: input.businessId,
        isActive: true,
        acceptsBotBookings: true,
        ...(input.serviceIds.length
          ? {
              AND: input.serviceIds.map((serviceId) => ({
                serviceLinks: { some: { serviceId } }
              }))
            }
          : {})
      },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      take: 3
    })
    return professionalSelectionButtons(input.conversationId, professionals)
  }

  private async professionalScheduleReply(businessId: string, professionalId: string) {
    const professional = await prisma.professional.findFirst({
      where: { id: professionalId, businessId, isActive: true },
      select: {
        name: true,
        workingHours: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
          select: { dayOfWeek: true, startTime: true, endTime: true }
        }
      }
    })
    if (!professional) return 'No encontré ese profesional en el equipo actual.'
    if (!professional.workingHours.length) {
      return `No tengo los horarios de ${professional.name} cargados de forma confiable. Si querés, te derivo con el equipo.`
    }
    return [
      `${professional.name} atiende:`,
      ...formatProfessionalWorkingHours(professional.workingHours)
    ].join('\n')
  }

  private async preliminaryProfessionalAvailability(input: {
    phone: string
    businessId: string
    conversationId: string
    state: BookingV2State
    professionalId: string
    date: string
    timeFrom: string | null
    assistantPersonality: AssistantPersonality
  }): Promise<HandleMessageResult | null> {
    const catalog = await bookingV2DomainService.loadCatalog(input.businessId)
    const professional = catalog.professionals.find((candidate) =>
      candidate.id === input.professionalId
    )
    if (!professional) return null

    const referenceService = catalog.services
      .filter((service) =>
        professional.serviceIds.includes(service.id) &&
        (service.attentionMode ?? 'DIRECT_BOOKING') === 'DIRECT_BOOKING'
      )
      .sort((left, right) =>
        reservationDurationLimits(left).business - reservationDurationLimits(right).business
      )[0]
    if (!referenceService) return null

    const availability = await bookingV2DomainService.findAvailabilityOptions({
      catalog,
      serviceId: referenceService.id,
      professionalId: professional.id,
      date: input.date
    })
    if (!availability.ok) return null

    const duration = reservationDurationLimits(referenceService).business
    const options = availability.options.filter((option) =>
      !input.timeFrom || option.time >= input.timeFrom
    )
    if (!options.length) {
      return {
        reply: applyAssistantPersonalityToReply(
          [
            `No encontré espacios disponibles con ${professional.name} para el ${formatIsoDateForConversation(input.date)}${input.timeFrom ? ` a partir de las ${input.timeFrom}` : ''}.`,
            '¿Te puedo ayudar en algo más?'
          ].join('\n\n'),
          input.assistantPersonality
        ),
        replyButtons: otherQueryMenuButtons(input.conversationId),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const nextState: BookingV2State = {
      ...input.state,
      preliminaryAvailability: {
        phase: 'AWAITING_BOOKING_DECISION',
        professionalId: professional.id,
        professionalName: professional.name,
        date: input.date,
        timeFrom: input.timeFrom,
        referenceServiceId: referenceService.id
      },
      misunderstandingCount: 0
    }
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'START',
      ...conversationPatchFromState(nextState),
      lastAvailability: null
    })
    const timeCondition = input.timeFrom ? ` a partir de las ${input.timeFrom}` : ''
    return {
      reply: applyAssistantPersonalityToReply(
        [
          `${professional.name} tiene estos espacios de referencia para el ${formatIsoDateForConversation(input.date)}${timeCondition} 😊`,
          options.map((option) =>
            `• ${option.time} a ${addMinutesToTime(option.time, duration)}`
          ).join('\n'),
          'Los horarios definitivos dependen de la duración del servicio que elijas.',
          '¿Querés reservar?'
        ].join('\n\n'),
        input.assistantPersonality
      ),
      replyButtons: preliminaryAvailabilityDecisionButtons(input.conversationId),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async handlePreliminaryAvailabilityDecision(input: {
    phone: string
    message: string
    interactiveReplyId?: string
    businessId: string
    conversation: {
      id: string
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    state: BookingV2State
  }): Promise<HandleMessageResult> {
    const pending = input.state.preliminaryAvailability!
    const action = preliminaryAvailabilityActionFromInteractiveReply(
      input.interactiveReplyId,
      input.conversation.id
    ) ?? preliminaryAvailabilityDecisionFromMessage(input.message)
    const personality = await getBusinessAssistantPersonality(input.businessId)

    if (action === 'decline') {
      const resetState = freshBookingV2State(input.state.draft.name)
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'START',
        ...conversationPatchFromState(resetState),
        lastAvailability: null
      })
      return {
        reply: applyAssistantPersonalityToReply(
          'Está bien 😊 ¿Te puedo ayudar en algo más?',
          personality
        ),
        replyButtons: otherQueryMenuButtons(input.conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (action !== 'book') {
      return {
        reply: applyAssistantPersonalityToReply(
          '¿Querés reservar? Podés responder sí o no.',
          personality
        ),
        replyButtons: preliminaryAvailabilityDecisionButtons(input.conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const bookingState: BookingV2State = {
      ...input.state,
      draft: {
        ...input.state.draft,
        service: null,
        professional: pending.professionalId,
        date: pending.date,
        time: null
      },
      preliminaryAvailability: {
        ...pending,
        phase: 'BOOKING'
      },
      misunderstandingCount: 0
    }
    const resumed = await bookingV2Engine.resume({
      businessId: input.businessId,
      conversation: conversationPatchFromState(bookingState)
    })
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: conversationStepFromBookingV2Plan(resumed.plan),
      ...resumed.conversationPatch,
      lastAvailability: null
    })
    const presentation = await presentBookingV2Result({
      businessId: input.businessId,
      conversationId: input.conversation.id,
      result: resumed
    })
    return {
      reply: applyAssistantPersonalityToReply(presentation.reply, personality),
      ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async recoverBookingAvailabilityFailure(input: {
    phone: string
    businessId: string
    state: BookingV2State
    statusCode: number
    message: string
    operation: 'confirm' | 'hold'
  }): Promise<HandleMessageResult> {
    const recovery = bookingAvailabilityFailureRecovery({
      state: input.state,
      statusCode: input.statusCode,
      message: input.message
    })
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'ASK_DATE',
      ...conversationPatchFromState(recovery.state),
      lastAvailability: null
    })
    const action = input.operation === 'confirm'
      ? 'confirmar el turno'
      : 'retener ese horario'
    return {
      reply: `No pude ${action}: ${input.message}. Probemos con otro día u horario.`,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async handleCoordinatedBookingConfirmation(input: {
    phone: string
    message: string
    businessId: string
    conversation: {
      id: string
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    state: BookingV2State
    assistantPersonality: AssistantPersonality
  }): Promise<HandleMessageResult> {
    const pending = input.state.pendingCoordinatedAvailability!
    const selected = pending.options.find((option) => option.id === pending.selectedOptionId)
    if (!selected || !input.state.draft.name) {
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(input.state)
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: resumed
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const actionableMessage = bookingCoordinationActionableReply(input.message)
    const normalized = normalizeText(actionableMessage)
    const deterministicAction = isUnambiguousBookingConfirmation(actionableMessage) ||
      /\bconfirm(?:ar|o|ame)?\b.*\breservas?\b/.test(normalized)
      ? 'confirm'
      : /\b(?:cambiar|otro|elegir)\b.*\bhorario\b/.test(normalized)
        ? 'change_time'
        : /\b(?:atencion|persona|equipo|asesor)\b/.test(normalized)
          ? 'human'
          : null
    const action = deterministicAction
      ? { choiceId: deterministicAction, confidence: 1 }
      : await bookingV2ChoiceExtractor.extract({
          message: actionableMessage,
          question: selected.segments.length > 1
            ? '¿Confirma las dos reservas coordinadas, quiere cambiar el horario o solicita atención del equipo?'
            : '¿Confirma la reserva, quiere cambiar el horario o solicita atención del equipo?',
          choices: [
            { id: 'confirm', meaning: 'Confirma y autoriza crear las dos reservas coordinadas.' },
            { id: 'change_time', meaning: 'Quiere volver a elegir la franja o el horario.' },
            { id: 'human', meaning: 'Quiere que el equipo revise o coordine la reserva.' }
          ]
        })

    if (action.confidence >= 0.7 && action.choiceId === 'change_time') {
      const state: BookingV2State = {
        ...input.state,
        draft: { ...input.state.draft, time: null },
        pendingCoordinatedAvailability: {
          ...pending,
          phase: 'AWAITING_TIME_PREFERENCE',
          filteredOptionIds: pending.options.map((option) => option.id),
          page: 0,
          timeBand: null,
          requestedTime: null,
          requestedWindow: null,
          selectedOptionId: null
        }
      }
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(state)
      })
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: conversationStepFromBookingV2Plan(resumed.plan),
        ...resumed.conversationPatch,
        lastAvailability: null
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: resumed
      })
      return {
        reply: applyAssistantPersonalityToReply(presentation.reply, input.assistantPersonality),
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (action.confidence >= 0.7 && action.choiceId === 'human') {
      await this.updateConversation(input.phone, input.businessId, {
        ...queuedConversationHandoffPatch()
      })
      return {
        reply: selected.segments.length > 1
          ? 'Conservo la combinación elegida y le pido al equipo que continúe con vos por acá. La respuesta puede demorar unos minutos.'
          : 'Conservo el horario elegido y le pido al equipo que continúe con vos por acá. La respuesta puede demorar unos minutos.',
        replyButtons: handoffCancellationButtons(input.conversation.id),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    if (action.confidence < 0.7 || action.choiceId !== 'confirm') {
      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: conversationPatchFromState(input.state)
      })
      const presentation = await presentBookingV2Result({
        businessId: input.businessId,
        conversationId: input.conversation.id,
        result: resumed
      })
      return {
        reply: presentation.reply,
        ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    return this.confirmCoordinatedBookingAppointments({
      phone: input.phone,
      businessId: input.businessId,
      conversationId: input.conversation.id,
      state: input.state,
      selected
    })
  }

  private async confirmCoordinatedBookingAppointments(input: {
    phone: string
    businessId: string
    conversationId: string
    state: BookingV2State
    selected: NonNullable<BookingV2State['pendingCoordinatedAvailability']>['options'][number]
  }): Promise<HandleMessageResult> {
    const professionalLinks = await prisma.professional.findMany({
      where: {
        businessId: input.businessId,
        isActive: true,
        acceptsBotBookings: true,
        OR: input.selected.segments.map((segment) => ({
          id: segment.professionalId,
          serviceLinks: { some: { serviceId: segment.serviceId } }
        }))
      },
      select: { id: true, serviceLinks: { select: { serviceId: true } } }
    })
    const validLinks = new Set(professionalLinks.flatMap((professional) =>
      professional.serviceLinks.map((link) => `${professional.id}:${link.serviceId}`)
    ))
    if (input.selected.segments.some((segment) =>
      !validLinks.has(`${segment.professionalId}:${segment.serviceId}`)
    )) {
      return this.recoverCoordinatedBookingFailure(input, 'Uno de los profesionales ya no recibe reservas automáticas para ese servicio.')
    }

    const customer = await this.findOrCreateCustomer(
      input.phone,
      input.state.draft.name!,
      input.businessId
    )
    const appointmentIds: string[] = []
    try {
      for (const segment of input.selected.segments) {
        const created = await appointmentService.create({
          customerId: customer.id,
          professionalId: segment.professionalId,
          serviceId: segment.serviceId,
          serviceIds: [segment.serviceId],
          startAt: `${input.selected.date}T${segment.startTime}:00`,
          origin: 'BOT',
          status: 'PENDING',
          quotedPrice: acceptedAdvisorQuoteAmount(input.state, segment.serviceId)
        })
        if (!created.ok) {
          await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
          return this.recoverCoordinatedBookingFailure(input, created.message)
        }
        appointmentIds.push(created.appointment.id)
      }
    } catch (error) {
      await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      console.error('No pude retener todas las reservas coordinadas', error)
      return this.recoverCoordinatedBookingFailure(input, 'Ocurrió un error al retener los horarios elegidos.')
    }

    await linkAiUsageToAppointment({
      conversationId: input.conversationId,
      appointmentId: appointmentIds[0]!
    }).catch((error) => {
      console.error('No pude vincular el uso de IA con la reserva coordinada', error)
    })

    let deposit: HandleMessageResult | null
    try {
      deposit = await this.requestCoordinatedDepositIfNeeded({
        ...input,
        appointmentIds
      })
    } catch (error) {
      console.error('No pude preparar la seña de las reservas coordinadas', error)
      return this.recoverCoordinatedBookingFailure(input, 'Ocurrió un error al preparar la seña.')
    }
    if (deposit) return deposit

    let confirmed = false
    try {
      confirmed = await appointmentService.confirmPendingAppointments(appointmentIds)
    } catch (error) {
      console.error('No pude confirmar en conjunto las reservas coordinadas', error)
    }
    if (!confirmed) {
      await Promise.allSettled(appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      return this.recoverCoordinatedBookingFailure(input, 'Los horarios cambiaron mientras confirmábamos la reserva.')
    }
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'COMPLETED',
      bookingV2State: null,
      lastAvailability: null
    })
    try {
      await markConversationOpportunityConverted({
        businessId: input.businessId,
        customerPhone: input.phone,
        appointmentId: appointmentIds[0]!
      })
    } catch (error) {
      console.error('No pude vincular los turnos coordinados con la oportunidad', error)
    }
    return {
      reply: [
        input.selected.segments.length > 1
          ? `¡Listo, ${input.state.draft.name}! Confirmamos tus reservas para el ${formatDateForBookingV2(input.selected.date)} 😊`
          : `¡Listo, ${input.state.draft.name}! Confirmamos tu reserva para el ${formatDateForBookingV2(input.selected.date)} 😊`,
        ...input.selected.segments.map((segment) =>
          `${segment.serviceName} con ${segment.professionalName}: ${segment.startTime} a ${segment.endTime}`
        )
      ].join('\n'),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async recoverCoordinatedBookingFailure(input: {
    phone: string
    businessId: string
    conversationId: string
    state: BookingV2State
  }, message: string): Promise<HandleMessageResult> {
    const pending = input.state.pendingCoordinatedAvailability!
    const state: BookingV2State = {
      ...input.state,
      draft: { ...input.state.draft, time: null },
      pendingCoordinatedAvailability: {
        ...pending,
        phase: 'AWAITING_DATE',
        options: [],
        filteredOptionIds: [],
        page: 0,
        selectedOptionId: null
      }
    }
    const resumed = await bookingV2Engine.resume({
      businessId: input.businessId,
      conversation: conversationPatchFromState(state)
    })
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: conversationStepFromBookingV2Plan(resumed.plan),
      ...resumed.conversationPatch,
      lastAvailability: null
    })
    const presentation = await presentBookingV2Result({
      businessId: input.businessId,
      conversationId: input.conversationId,
      result: resumed
    })
    return {
      reply: `${pending.assignmentMode === 'MULTIPLE_PROFESSIONALS'
        ? 'No pude confirmar las dos reservas'
        : 'No pude confirmar la reserva'}: ${message}\n\n${presentation.reply}`,
      ...(presentation.buttons ? { replyButtons: presentation.buttons } : {}),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async confirmBookingV2Appointment(input: {
    phone: string
    businessId: string
    conversation: {
      id: string
      selectedCustomerName: string
      selectedServiceId: string
      selectedProfessionalId: string
      selectedDate: string
      selectedTime: string
      bookingV2State?: unknown
    }
  }): Promise<HandleMessageResult> {
    const customer = await this.findOrCreateCustomer(input.phone, input.conversation.selectedCustomerName, input.businessId)
    const state = stateFromConversation({
      selectedCustomerName: input.conversation.selectedCustomerName,
      selectedServiceId: input.conversation.selectedServiceId,
      selectedProfessionalId: input.conversation.selectedProfessionalId,
      selectedDate: input.conversation.selectedDate,
      selectedTime: input.conversation.selectedTime,
      misunderstandingCount: 0,
      bookingV2State: input.conversation.bookingV2State
    })
    const quotedPrice = acceptedAdvisorQuoteAmount(state, input.conversation.selectedServiceId)
    const appointment = await bookingProvider.createAppointment({
      customerId: customer.id,
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      serviceIds: combinedServiceIds(state),
      startAt: `${input.conversation.selectedDate}T${input.conversation.selectedTime}:00`,
      quotedPrice
    })

    if (!appointment.ok) {
      return this.recoverBookingAvailabilityFailure({
        phone: input.phone,
        businessId: input.businessId,
        state,
        statusCode: appointment.statusCode,
        message: appointment.message,
        operation: 'confirm'
      })
    }

    await linkAiUsageToAppointment({
      conversationId: input.conversation.id,
      appointmentId: appointment.appointment.id
    }).catch((error) => {
      console.error('No pude vincular el uso de IA con la reserva', error)
    })

    const nextBooking = advanceToNextQueuedService(state)
    if (nextBooking) {
      const nextService = await prisma.service.findFirst({
        where: { id: nextBooking.nextService.serviceId, businessId: input.businessId },
        select: { name: true }
      })
      if (nextService) {
        const resumed = await bookingV2Engine.resume({
          businessId: input.businessId,
          conversation: conversationPatchFromState(nextBooking.state)
        })
        const isHandoff = resumed.plan.type === 'handoff'
        await this.updateConversation(input.phone, input.businessId, {
          currentStep: conversationStepFromBookingV2Plan(resumed.plan),
          ...resumed.conversationPatch,
          ...(isHandoff
            ? queuedConversationHandoffPatch()
            : {
                aiEnabled: true,
                humanHandoffResolvedAt: new Date()
              }),
          lastAvailability: resumed.availabilityOptions.length
            ? {
                serviceId: resumed.state.draft.service,
                professionalId: resumed.state.draft.professional,
                date: resumed.state.draft.date,
                options: resumed.availabilityOptions
              }
            : null
        })
        const confirmedReply = botCopyService.appointmentConfirmed({
          customerName: input.conversation.selectedCustomerName,
          date: formatDateForBookingV2(input.conversation.selectedDate),
          time: input.conversation.selectedTime
        })
        return {
          reply: [
            confirmedReply,
            `Ahora seguimos con la reserva de ${nextService.name}.`,
            resumed.reply
          ].join('\n\n'),
          ...(isHandoff
            ? { replyButtons: handoffCancellationButtons(input.conversation.id) }
            : {}),
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }
    }

    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'COMPLETED',
      bookingV2State: null,
      lastAvailability: null
    })

    return {
      reply: botCopyService.appointmentConfirmed({
        customerName: input.conversation.selectedCustomerName,
        date: formatDateForBookingV2(input.conversation.selectedDate),
        time: input.conversation.selectedTime
      }),
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async requestCoordinatedDepositIfNeeded(input: {
    phone: string
    businessId: string
    conversationId: string
    state: BookingV2State
    selected: NonNullable<BookingV2State['pendingCoordinatedAvailability']>['options'][number]
    appointmentIds: string[]
  }): Promise<HandleMessageResult | null> {
    const primarySegment = input.selected.segments[0]
    const primaryAppointmentId = input.appointmentIds[0]
    if (!primarySegment || !primaryAppointmentId) return null
    const service = await prisma.service.findFirst({
      where: { id: primarySegment.serviceId, businessId: input.businessId },
      select: {
        id: true,
        name: true,
        price: true,
        depositMode: true,
        depositValue: true,
        depositHoldMinutes: true,
        business: { select: { paymentSettings: true } }
      }
    })
    if (!service || service.depositMode === 'NONE') return null
    const estimateMinimum = acceptedAdvisorQuoteAmount(input.state, service.id) ??
      (input.state.guidedEstimate?.serviceId === service.id
        ? input.state.guidedEstimate.priceMin
        : null)
    const calculation = calculateBookingV2Deposit({
      mode: service.depositMode,
      value: service.depositValue,
      servicePrice: service.price,
      estimateMinimum
    })
    if (!calculation) return null

    const expiresAt = new Date(Date.now() + service.depositHoldMinutes * 60_000)
    let deposit: Awaited<ReturnType<typeof prisma.bookingDeposit.create>> | null = null
    try {
      deposit = await prisma.bookingDeposit.create({
        data: {
          businessId: input.businessId,
          appointmentId: primaryAppointmentId,
          conversationId: input.conversationId,
          mode: calculation.mode,
          configuredValue: calculation.configuredValue,
          baseAmount: calculation.baseAmount,
          amount: calculation.amount,
          expiresAt
        }
      })
      const nextState: BookingV2State = {
        ...input.state,
        pendingDeposit: {
          depositId: deposit.id,
          appointmentId: primaryAppointmentId,
          relatedAppointmentIds: input.appointmentIds,
          serviceId: service.id,
          mode: calculation.mode,
          configuredValue: calculation.configuredValue,
          baseAmount: calculation.baseAmount,
          amount: calculation.amount,
          status: 'awaiting_proof',
          expiresAt: expiresAt.toISOString()
        }
      }
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'AWAITING_DEPOSIT',
        ...conversationPatchFromState(nextState),
        aiEnabled: true,
        photoQuoteAcknowledgedAt: null,
        lastAvailability: null
      })
    } catch (error) {
      if (deposit) {
        await bookingDepositService.cancelPendingProof({
          depositId: deposit.id,
          reason: 'No se pudo guardar la seña de las reservas coordinadas.'
        })
      }
      await Promise.allSettled(input.appointmentIds.map((appointmentId) => appointmentService.cancel(appointmentId)))
      throw error
    }

    return {
      reply: renderBookingV2DepositRequest({
        serviceName: input.selected.segments.map((segment) => segment.serviceName).join(' + '),
        calculation,
        paymentSettings: service.business.paymentSettings,
        expiresAt
      }),
      depositRequestId: deposit!.id,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async requestBookingV2DepositIfNeeded(input: {
    phone: string
    businessId: string
    conversation: {
      id: string
      selectedCustomerName: string
      selectedServiceId: string
      selectedProfessionalId: string
      selectedDate: string
      selectedTime: string
      misunderstandingCount: number
      bookingV2State?: unknown
    }
  }): Promise<HandleMessageResult | null> {
    const service = await prisma.service.findFirst({
      where: {
        id: input.conversation.selectedServiceId,
        businessId: input.businessId
      },
      select: {
        id: true,
        name: true,
        price: true,
        depositMode: true,
        depositValue: true,
        depositHoldMinutes: true,
        business: {
          select: {
            paymentSettings: true
          }
        }
      }
    })
    if (!service || service.depositMode === 'NONE') return null

    const state = stateFromConversation(input.conversation)
    const selectedServiceIds = combinedServiceIds(state)
    const selectedServices = await prisma.service.findMany({
      where: { id: { in: selectedServiceIds }, businessId: input.businessId },
      select: { id: true, name: true }
    })
    const selectedServiceNames = selectedServiceIds.map((serviceId) =>
      selectedServices.find((selected) => selected.id === serviceId)?.name ?? serviceId
    )
    const estimateMinimum = acceptedAdvisorQuoteAmount(state, service.id) ??
      (state.guidedEstimate?.serviceId === service.id
        ? state.guidedEstimate.priceMin
        : null)
    const calculation = calculateBookingV2Deposit({
      mode: service.depositMode,
      value: service.depositValue,
      servicePrice: service.price,
      estimateMinimum
    })
    if (!calculation) return null

    const customer = await this.findOrCreateCustomer(
      input.phone,
      input.conversation.selectedCustomerName,
      input.businessId
    )
    const appointment = await appointmentService.create({
      customerId: customer.id,
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      serviceIds: selectedServiceIds,
      startAt: `${input.conversation.selectedDate}T${input.conversation.selectedTime}:00`,
      origin: 'BOT',
      status: 'PENDING',
      quotedPrice: acceptedAdvisorQuoteAmount(state, service.id)
    })
    if (!appointment.ok) {
      return this.recoverBookingAvailabilityFailure({
        phone: input.phone,
        businessId: input.businessId,
        state,
        statusCode: appointment.statusCode,
        message: appointment.message,
        operation: 'hold'
      })
    }

    await linkAiUsageToAppointment({
      conversationId: input.conversation.id,
      appointmentId: appointment.appointment.id
    }).catch((error) => {
      console.error('No pude vincular el uso de IA con la reserva pendiente de seña', error)
    })

    const expiresAt = new Date(Date.now() + service.depositHoldMinutes * 60_000)
    let deposit
    try {
      deposit = await prisma.bookingDeposit.create({
        data: {
          businessId: input.businessId,
          appointmentId: appointment.appointment.id,
          conversationId: input.conversation.id,
          mode: calculation.mode,
          configuredValue: calculation.configuredValue,
          baseAmount: calculation.baseAmount,
          amount: calculation.amount,
          expiresAt
        }
      })
    } catch (error) {
      await prisma.appointment.update({
        where: { id: appointment.appointment.id },
        data: { status: 'CANCELLED' }
      })
      throw error
    }

    const nextState = {
      ...state,
      pendingDeposit: {
        depositId: deposit.id,
        appointmentId: appointment.appointment.id,
        serviceId: service.id,
        mode: calculation.mode,
        configuredValue: calculation.configuredValue,
        baseAmount: calculation.baseAmount,
        amount: calculation.amount,
        status: 'awaiting_proof' as const,
        expiresAt: expiresAt.toISOString()
      }
    }
    try {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'AWAITING_DEPOSIT',
        ...conversationPatchFromState(nextState),
        aiEnabled: true,
        photoQuoteAcknowledgedAt: null,
        lastAvailability: null
      })
    } catch (error) {
      await bookingDepositService.cancelPendingProof({
        depositId: deposit.id,
        reason: 'No se pudo guardar el estado de espera del comprobante.'
      })
      throw error
    }

    return {
      reply: renderBookingV2DepositRequest({
        serviceName: selectedServiceNames.join(' + ') || service.name,
        calculation,
        paymentSettings: service.business.paymentSettings,
        expiresAt
      }),
      depositRequestId: deposit.id,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  async handleDepositRequestDeliveryFailure(input: {
    phone: string
    businessId: string
    depositId: string
  }) {
    const conversation = await prisma.conversation.findUnique({
      where: {
        businessId_phone: {
          businessId: input.businessId,
          phone: input.phone
        }
      }
    })
    if (!conversation) return false

    const state = stateFromConversation(conversation)
    if (state.pendingDeposit?.depositId !== input.depositId) return false
    const cancelled = await bookingDepositService.cancelPendingProof({
      depositId: input.depositId,
      reason: 'No se pudo enviar la solicitud de seña por WhatsApp.'
    })
    if (!cancelled) return false

    const retryState: BookingV2State = {
      ...state,
      draft: {
        ...state.draft,
        date: null,
        time: null
      },
      pendingProposal: null,
      pendingDeposit: null
    }
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'ASK_DATE',
      ...conversationPatchFromState(retryState),
      lastAvailability: null
    })
    return true
  }

  private async handlePendingDepositServiceAddition(input: {
    phone: string
    businessId: string
    conversation: {
      id: string
      currentStep: string
      selectedCustomerName: string | null
      selectedServiceId: string | null
      selectedProfessionalId: string | null
      selectedDate: string | null
      selectedTime: string | null
      misunderstandingCount: number
      bookingV2State?: unknown
    }
    routing: ConversationRouting
  }): Promise<HandleMessageResult | null> {
    const state = stateFromConversation(input.conversation)
    if (!state.pendingDeposit || !state.draft.service) return null
    await bookingDepositService.expireOverdue()
    const deposit = await prisma.bookingDeposit.findUnique({
      where: { id: state.pendingDeposit.depositId },
      select: { status: true }
    })
    if (!deposit || !['PENDING_PROOF', 'PROOF_RECEIVED'].includes(deposit.status)) {
      const expiredState: BookingV2State = {
        ...state,
        draft: {
          ...state.draft,
          date: null,
          time: null
        },
        pendingDeposit: null,
        pendingCombinedAvailability: null
      }
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'ASK_DATE',
        ...conversationPatchFromState(expiredState),
        lastAvailability: null
      })
      return {
        reply: 'La retención anterior ya no está activa. Conservé los servicios elegidos para que busquemos un nuevo día y horario.',
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    if (pendingDepositAppointmentIds(state.pendingDeposit).length > 1) {
      return {
        reply: 'Las dos reservas coordinadas ya están retenidas por la seña. Para sumar otro servicio sin perder esos horarios, el equipo tiene que revisarlo.',
        replyButtons: [{
          id: `coord:${input.conversation.id}:human`,
          title: 'Solicitar atención'
        }],
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const existingServiceIds = new Set(combinedServiceIds(state))
    const extractedServices = [
      ...(input.routing.bookingExtraction?.additionalServices ?? []),
      ...(input.routing.bookingExtraction?.service.value &&
      input.routing.bookingExtraction.service.value !== state.draft.service
        ? [input.routing.bookingExtraction.service]
        : [])
    ]
    const additions = extractedServices
      .filter((field) =>
        field.value &&
        field.confidence >= 0.75 &&
        !existingServiceIds.has(field.value)
      )
      .map((field) => ({ serviceId: field.value!, evidence: field.evidence }))
      .filter((field, index, all) =>
        all.findIndex((candidate) => candidate.serviceId === field.serviceId) === index
      )
    if (!additions.length) {
      if (businessInformationTopicsFromRouting(input.routing).length) return null
      return {
        reply: 'La reserva sigue retenida mientras esperamos o revisamos el comprobante. También podés seguir consultándome por acá.',
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const allServiceIds = [...existingServiceIds, ...additions.map((addition) => addition.serviceId)]
    const [services, rules] = await Promise.all([
      prisma.service.findMany({
        where: { id: { in: allServiceIds }, businessId: input.businessId, isBookable: true },
        select: {
          id: true,
          name: true,
          attentionMode: true,
          requiresPhoto: true,
          validationEnabled: true
        }
      }),
      prisma.serviceCombinationRule.findMany({
        where: {
          businessId: input.businessId,
          serviceAId: { in: allServiceIds },
          serviceBId: { in: allServiceIds },
        },
        select: { serviceAId: true, serviceBId: true, policy: true }
      })
    ])
    if (services.length !== allServiceIds.length) return null
    const additionNames = additions.map((addition) =>
      services.find((service) => service.id === addition.serviceId)?.name ?? addition.serviceId
    )
    if (rules.some((rule) => rule.policy === 'BLOCKED')) {
      return {
        reply: `No puedo agregar ${additionNames.join(' + ')} al mismo turno porque esa combinación está bloqueada. Si querés, puedo ayudarte a reservarlo por separado cuando termine esta confirmación.`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }
    const explicitlyAllowedAdvancedServices = new Set(additions
      .filter((addition) => [...existingServiceIds].every((existingServiceId) =>
        rules.some((rule) =>
          rule.policy === 'ALLOWED' &&
          [rule.serviceAId, rule.serviceBId].includes(addition.serviceId) &&
          [rule.serviceAId, rule.serviceBId].includes(existingServiceId)
        )
      ))
      .map((addition) => addition.serviceId))
    if (
      rules.some((rule) => rule.policy === 'REVIEW_REQUIRED') ||
      services.some((service) =>
        additions.some((addition) => addition.serviceId === service.id) &&
        !explicitlyAllowedAdvancedServices.has(service.id) &&
        (
          service.attentionMode !== 'DIRECT_BOOKING' ||
          service.requiresPhoto ||
          service.validationEnabled
        )
      )
    ) {
      return {
        reply: `Entendí que querés sumar ${additionNames.join(' + ')}. Esa combinación necesita que la revise el equipo antes de modificar el turno; la reserva y la seña actuales siguen retenidas.`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const updated = await appointmentService.replacePendingDepositServices({
      appointmentId: state.pendingDeposit.appointmentId,
      serviceIds: allServiceIds
    })
    if (!updated.ok) {
      return {
        reply: `${updated.message}. La reserva original sigue retenida sin cambios. Si querés, después podemos buscar ${additionNames.join(' + ')} como un turno separado.`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const nextState = addCombinedServices(state, additions)
    await this.updateConversation(input.phone, input.businessId, {
      currentStep: 'AWAITING_DEPOSIT',
      ...conversationPatchFromState(nextState),
      aiEnabled: true,
      lastAvailability: null
    })
    return {
      reply: `Listo, agregué ${additionNames.join(' + ')} al mismo turno. La reserva ahora bloquea ${updated.appointment.totalDurationMinutes} minutos y la seña pendiente sigue vigente.`,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async humanizeResult(input: {
    result: HandleMessageResult
    message: string
    businessId?: string
  }): Promise<HandleMessageResult> {
    const businessId = await this.resolveBusinessId(input.businessId)
    if (!businessId) return input.result
    const personality = await getBusinessAssistantPersonality(businessId)
    const personalizedReply = applyAssistantPersonalityToReply(
      input.result.reply,
      personality
    )
    if (!canHumanizeSafely(personalizedReply)) {
      return { ...input.result, reply: personalizedReply }
    }

    const styledReply = await aiMessageUnderstandingService.humanizeReply({
      customerMessage: input.message,
      draftReply: input.result.reply,
      currentStep: 'UNKNOWN',
      personality
    })

    if (styledReply && !preservesRequiredLines(personalizedReply, styledReply)) {
      return { ...input.result, reply: personalizedReply }
    }

    if (styledReply && !preservesRequiredBotName(personalizedReply, styledReply, personality.name)) {
      return { ...input.result, reply: personalizedReply }
    }

    return {
      ...input.result,
      reply: styledReply ?? personalizedReply
    }
  }

  private async trackMisunderstanding(
    phone: string,
    requestedBusinessId: string | undefined,
    reply: string
  ) {
    const businessId = await this.resolveBusinessId(requestedBusinessId)
    if (!businessId) return

    if (isMisunderstandingReply(reply)) {
      await prisma.conversation.update({
        where: {
          businessId_phone: {
            businessId,
            phone
          }
        },
        data: {
          misunderstandingCount: {
            increment: 1
          }
        }
      })

      return
    }

    await prisma.conversation.update({
      where: {
        businessId_phone: {
          businessId,
          phone
        }
      },
      data: {
        misunderstandingCount: 0
      }
    })
  }

  private async tryHandleOrchestratedIntent(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: {
      currentStep: string
      selectedCustomerName: string | null
      misunderstandingCount: number
    }
  }): Promise<HandleMessageResult | null> {
    if (!isMenuStep(input.conversation.currentStep)) {
      return null
    }

    const result = await aiMessageUnderstandingService.classifyConversationIntent({
      message: input.message,
      currentStep: input.conversation.currentStep
    })

    if (!result) {
      return null
    }

    if (result.intent === 'reset_conversation' && !isExplicitResetRequest(input.message)) {
      return null
    }

    return this.handleOrchestratedIntent({
      intent: result.intent,
      phone: input.phone,
      message: input.message,
      businessId: input.businessId,
      conversation: input.conversation
    })
  }

  private async handleOrchestratedIntent(input: {
    intent: AiConversationIntent
    phone: string
    message: string
    businessId: string | null
    conversation: {
      currentStep: string
      selectedCustomerName: string | null
      misunderstandingCount: number
    }
  }): Promise<HandleMessageResult | null> {
    if (input.intent === 'my_appointments') {
      return this.buildMyAppointmentsReply(input.phone, input.businessId)
    }

    if (input.intent === 'cancel_appointment') {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, input.businessId, botCopyService.cancelAppointmentIntro())
    }

    if (input.intent === 'edit_appointment') {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'EDIT_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, input.businessId, botCopyService.editAppointmentIntro())
    }

    if (input.intent === 'reset_conversation') {
      await this.updateConversation(input.phone, input.businessId, {
        currentStep: 'START',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      return {
        reply: botCopyService.resetDone()
      }
    }

    if (input.intent === 'book_appointment') {
      return bookingConversationFlow.handle({
        phone: input.phone,
        message: input.message,
        businessId: input.businessId,
        conversation: {
          ...input.conversation,
          phone: input.phone,
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          lastAvailability: null,
          misunderstandingCount: input.conversation.misunderstandingCount,
          lastMessage: input.message
        }
      })
    }

    return null
  }

  private async handleArrivalNotice(
    phone: string,
    message: string,
    businessId: string | null
  ): Promise<HandleMessageResult> {
    const appointments = await this.findUpcomingAppointments(phone, businessId)
    const nextAppointment = appointments[0]

    if (!nextAppointment) {
      return {
        reply: botCopyService.arrivalNoticeNoAppointment()
      }
    }

    const delay = calculateArrivalDelayMinutes(message, nextAppointment.startAt)

    if (delay === null || delay > 5) {
      const queuedConversation = await this.updateConversation(phone, businessId, {
        ...queuedConversationHandoffPatch(),
        bookingV2State: null
      })

      return {
        reply: botCopyService.lateArrivalHandoffQueued(),
        replyButtons: handoffCancellationButtons(queuedConversation.id),
        skipHumanize: true
      }
    }

    return {
      reply: botCopyService.arrivalNoticeOk(),
      skipHumanize: true
    }
  }

  private async buildMyAppointmentsReply(
    phone: string,
    businessId: string | null,
    prefix?: string
  ): Promise<HandleMessageResult> {
    const appointments = await this.findUpcomingAppointments(phone, businessId)

    return {
      reply: [
        prefix,
        botCopyService.myAppointments(appointments.map((appointment) => ({
          serviceName: appointment.service.name,
          professionalName: appointment.professional.name,
          date: formatDate(appointment.startAt),
          time: formatTime(appointment.startAt)
        })))
      ].filter(Boolean).join('\n\n')
    }
  }

  private async cancelAppointmentByMessage(
    phone: string,
    message: string,
    businessId: string | null
  ): Promise<HandleMessageResult> {
    if (isResetMessage(message)) {
      const appointments = await this.findUpcomingAppointments(phone, businessId)

      await this.updateConversation(phone, businessId, {
        currentStep: 'START',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        selectedCustomerName: appointments[0]?.customer.name ?? null,
        lastAvailability: null
      })

      return {
        reply: botCopyService.resetDone()
      }
    }

    const selectedOption = parseAppointmentListOption(message)

    if (!selectedOption) {
      return this.buildMyAppointmentsReply(phone, businessId, 'No llegué a entender qué turno querés cancelar. Respondeme con el número de la lista, por ejemplo: 1, el 1 o cancelar el número 1.')
    }

    const appointments = await this.findUpcomingAppointments(phone, businessId)

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, businessId, 'No encontré ese número en la lista. Elegí uno de los turnos que te muestro, por ejemplo: 1 o el 1.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, businessId, {
      currentStep: 'COMPLETED'
    })

    return {
      reply: botCopyService.cancelConfirmedWithFollowUp({
        serviceName: appointment.service.name,
        date: formatDate(appointment.startAt),
        time: formatTime(appointment.startAt)
      })
    }
  }

  private async editAppointmentByMessage(
    phone: string,
    message: string,
    businessId: string | null
  ): Promise<HandleMessageResult> {
    if (isResetMessage(message)) {
      const appointments = await this.findUpcomingAppointments(phone, businessId)

      await this.updateConversation(phone, businessId, {
        currentStep: 'START',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        selectedCustomerName: appointments[0]?.customer.name ?? null,
        lastAvailability: null
      })

      return {
        reply: botCopyService.resetDone()
      }
    }

    const selectedOption = parseAppointmentListOption(message)

    if (!selectedOption) {
      return this.buildMyAppointmentsReply(phone, businessId, 'No llegué a entender qué turno querés cambiar. Respondeme con el número de la lista, por ejemplo: 1, el 1 o cambiar el número 1.')
    }

    const appointments = await this.findUpcomingAppointments(phone, businessId)

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, businessId, 'No encontré ese número en la lista. Elegí uno de los turnos que te muestro, por ejemplo: 1 o el 1.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, businessId, {
      currentStep: 'START',
      selectedServiceId: null,
      selectedProfessionalId: null,
      selectedDate: null,
      selectedTime: null,
      selectedCustomerName: appointment.customer.name,
      lastAvailability: null
    })

    return {
      reply: [
        botCopyService.editNotImplementedYet(),
        'Si queres reservarlo de nuevo, escribi reservar turno y arrancamos desde el servicio.'
      ].join('\n')
    }
  }

  private async findUpcomingAppointments(phone: string, businessId: string | null) {
    return prisma.appointment.findMany({
      where: {
        customer: {
          phone
        },
        ...(businessId
          ? {
              professional: {
                businessId
              }
            }
          : {}),
        status: {
          notIn: ['CANCELLED', 'NO_SHOW']
        },
        startAt: {
          gte: new Date()
        }
      },
      include: {
        customer: true,
        service: true,
        professional: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })
  }

  private async findOrCreateCustomer(phone: string, name: string, businessId?: string | null) {
    if (!businessId) throw new Error('No pude determinar el comercio para crear el cliente')
    const result = await findOrCreateCustomerByPhone({ name, phone, businessId })
    return result.customer
  }

  private async getConversationRuntimeSettings(businessId: string) {
    const settings = await prisma.businessFeatureSettings.findUnique({
      where: { businessId },
      select: {
        bookingV2Enabled: true,
        conversationPauseAfterMinutes: true,
        conversationExpireAfterMinutes: true
      }
    })

    return {
      bookingV2Enabled: Boolean(settings?.bookingV2Enabled),
      context: normalizeConversationContextSettings(settings)
    }
  }

  private async resolveBusinessId(businessId?: string) {
    if (businessId) {
      return businessId
    }

    const business = await prisma.business.findFirst({
      orderBy: {
        createdAt: 'asc'
      }
    })

    return business?.id ?? null
  }

  private async updateConversation(
    phone: string,
    businessId: string | null,
    data: {
      currentStep: ConversationStepValue
      selectedServiceId?: string | null
      selectedProfessionalId?: string | null
      selectedDate?: string | null
      selectedTime?: string | null
      selectedCustomerName?: string | null
      lastAvailability?: unknown
      bookingV2State?: unknown
      aiEnabled?: boolean
      misunderstandingCount?: number
      humanHandoffAt?: Date | null
      humanHandoffResolvedAt?: Date | null
      photoQuoteAcknowledgedAt?: Date | null
    }
  ) {
    const { lastAvailability, bookingV2State, ...rest } = data
    const dataToUpdate = {
      ...rest,
      ...(lastAvailability === undefined
        ? {}
        : {
            lastAvailability: lastAvailability === null
              ? Prisma.JsonNull
              : lastAvailability as Prisma.InputJsonValue
          }),
      ...(bookingV2State === undefined
        ? {}
        : {
            bookingV2State: bookingV2State === null
              ? Prisma.JsonNull
              : bookingV2State as Prisma.InputJsonValue
          })
    }

    if (!businessId) {
      throw new Error('No se puede actualizar una conversacion sin comercio')
    }

    return prisma.conversation.update({
      where: {
        businessId_phone: {
          businessId,
          phone
        }
      },
      data: dataToUpdate
    })
  }

  private prismaConversationData(
    data: ReturnType<typeof conversationPatchFromState>
  ) {
    const { bookingV2State, ...rest } = data
    return {
      ...rest,
      bookingV2State: bookingV2State === null
        ? Prisma.JsonNull
        : bookingV2State as Prisma.InputJsonValue
    }
  }
}

function isHardResetMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return [
    'reset total',
    'reiniciar todo',
    'borrar datos',
    'empezar desde cero'
  ].includes(normalizedMessage)
}

function isResetMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return [
    'cancelar',
    'cancela',
    'reiniciar',
    'reinicia',
    'empezar de nuevo',
    'empeza de nuevo',
    'volver a empezar',
    'reset'
  ].includes(normalizedMessage)
}

export function isExplicitResetRequest(message: string) {
  const normalizedMessage = normalizeText(message)

  if (isHardResetMessage(message) || isResetMessage(message)) {
    return true
  }

  return [
    'reiniciar conversacion',
    'reinicia la conversacion',
    'reiniciar la conversacion',
    'reiniciar chat',
    'reinicia el chat',
    'reiniciar el chat',
    'resetear conversacion',
    'resetear la conversacion',
    'resetear chat',
    'resetear el chat',
    'arrancar de nuevo',
    'arranquemos de nuevo',
    'empecemos de nuevo',
    'empezar otra vez',
    'empecemos otra vez'
  ].some((phrase) => normalizedMessage === phrase || normalizedMessage.includes(phrase))
}

function conversationStepFromBookingV2Plan(plan: BookingV2MessagePlan) {
  if (plan.type === 'handoff') return 'HUMAN_HANDOFF'
  if (
    plan.type === 'ask_service_addons' ||
    plan.type === 'offer_separate_services' ||
    plan.type === 'show_service_modification_menu' ||
    plan.type === 'ask_service_edit_target' ||
    plan.type === 'confirm_service_edit' ||
    plan.type === 'ask_service_replacement' ||
    plan.type === 'clarify_unsupported_service'
  ) {
    return 'ASK_SERVICE'
  }
  if (plan.type === 'offer_combined_availability') return 'ASK_DATE'
  if (
    plan.type === 'ask_specific_date' ||
    plan.type === 'ask_coordinated_date' ||
    plan.type === 'coordinated_date_unavailable' ||
    plan.type === 'show_coordinated_more_options'
  ) return 'ASK_DATE'
  if (
    plan.type === 'ask_coordinated_time_preference' ||
    plan.type === 'ask_coordinated_search_time' ||
    plan.type === 'offer_coordinated_options' ||
    plan.type === 'show_coordinated_search_menu'
  ) return 'ASK_TIME'
  if (plan.type === 'show_coordinated_selection') return 'CONFIRM'
  if (plan.type === 'show_service_preview_and_ask_name') return 'ASK_CUSTOMER_NAME'
  if (
    plan.type === 'ask_service_validation' ||
    plan.type === 'ask_category_advice_confirmation' ||
    plan.type === 'ask_estimate_option' ||
    plan.type === 'show_estimate' ||
    plan.type === 'show_base_estimate' ||
    plan.type === 'ask_estimate_decision'
  ) {
    return 'ASK_SERVICE'
  }
  if (plan.type === 'quote_complete') return 'ASK_SERVICE'
  if (plan.type === 'confirm_booking') return 'CONFIRM'
  if (plan.type === 'clarify_professional') return 'ASK_PROFESSIONAL'
  if (plan.type === 'confirm_field' || plan.type === 'confirm_correction') {
    return stepForBookingV2Field(plan.field)
  }
  return stepForBookingV2Field(plan.field)
}

function conversationStepValue(value: string): ConversationStepValue {
  const allowed: ConversationStepValue[] = [
    'START',
    'ASK_SERVICE',
    'ASK_PROFESSIONAL',
    'ASK_DATE',
    'ASK_TIME',
    'CONFIRM',
    'AWAITING_DEPOSIT',
    'ASK_CUSTOMER_NAME',
    'CANCEL_SELECT_APPOINTMENT',
    'EDIT_SELECT_APPOINTMENT',
    'HUMAN_HANDOFF',
    'COMPLETED'
  ]
  return allowed.includes(value as ConversationStepValue)
    ? value as ConversationStepValue
    : 'START'
}

function stepForBookingV2Field(field: BookingField) {
  if (field === 'name') return 'ASK_CUSTOMER_NAME'
  if (field === 'service') return 'ASK_SERVICE'
  if (field === 'professional') return 'ASK_PROFESSIONAL'
  if (field === 'date') return 'ASK_DATE'
  return 'ASK_TIME'
}

export function acceptedAdvisorQuoteAmount(state: ReturnType<typeof stateFromConversation>, serviceId: string) {
  return state.advisorQuote?.serviceId === serviceId && state.advisorQuote.status === 'accepted'
    ? state.advisorQuote.amount
    : null
}

export function freshBookingV2State(customerName: string | null): BookingV2State {
  const state = createEmptyBookingV2State()
  return {
    ...state,
    draft: {
      ...state.draft,
      name: customerName
    }
  }
}

function hasActiveBookingData(state: BookingV2State) {
  return Boolean(
    state.draft.service ||
    state.draft.professional ||
    state.draft.date ||
    state.draft.time ||
    state.pendingProposal ||
    state.serviceValidation ||
    state.guidedEstimate ||
    state.advisorQuote ||
    state.quoteOnly ||
    state.pendingDeposit ||
    state.combinedServices.length ||
    state.queuedServices.length ||
    state.addonSuggestion ||
    state.pendingCombinedAvailability ||
    state.pendingAvailabilityResolution ||
    state.pendingServiceSeparation ||
    state.pendingServiceReplacement ||
    state.pendingCoordinatedAvailability
  )
}

export function bookingV2StateAfterGoingBack(
  state: BookingV2State,
  currentStep: string,
  bookingFlowOrder: BookingFlowOrder = 'PROFESSIONAL_FIRST'
): BookingV2State {
  if (
    state.guidedEstimate ||
    state.serviceValidation ||
    state.categoryAdvice ||
    currentStep === 'ASK_SERVICE'
  ) {
    return clearBookingV2StateFromField(state, 'service')
  }
  if (currentStep === 'ASK_PROFESSIONAL') {
    return clearBookingV2StateFromField(
      state,
      bookingFlowOrder === 'DATE_TIME_FIRST' ? 'time' : 'service'
    )
  }
  if (currentStep === 'ASK_DATE') {
    return clearBookingV2StateFromField(
      state,
      bookingFlowOrder === 'DATE_TIME_FIRST' ? 'service' : 'professional'
    )
  }
  if (currentStep === 'ASK_TIME') {
    return clearBookingV2StateFromField(state, 'date')
  }
  if (currentStep === 'CONFIRM') {
    return bookingFlowOrder === 'DATE_TIME_FIRST'
      ? clearBookingV2StateFromField(state, 'professional', { preserveTime: true })
      : clearBookingV2StateFromField(state, 'time')
  }
  if (currentStep === 'ASK_CUSTOMER_NAME') {
    return freshBookingV2State(null)
  }

  const latestField = state.draft.time
    ? 'time'
    : state.draft.date
      ? 'date'
      : state.draft.professional
        ? 'professional'
        : 'service'
  return clearBookingV2StateFromField(state, latestField)
}

export function clearBookingV2StateFromField(
  state: BookingV2State,
  field: BookingField,
  options?: { preserveTime?: boolean }
): BookingV2State {
  const clearedDraft = clearFieldAndDependents(state.draft, field)
  return {
    ...state,
    draft: options?.preserveTime
      ? { ...clearedDraft, time: state.draft.time }
      : clearedDraft,
    pendingProposal: null,
    pendingServiceDisambiguation: field === 'service'
      ? null
      : state.pendingServiceDisambiguation,
    categoryAdvice: field === 'service' ? null : state.categoryAdvice,
    serviceValidation: field === 'service' ? null : state.serviceValidation,
    guidedEstimate: field === 'service' ? null : state.guidedEstimate,
    pendingPhotoQuote: field === 'service' ? null : state.pendingPhotoQuote,
    advisorQuote: field === 'service' ? null : state.advisorQuote,
    combinedServices: field === 'service' ? [] : state.combinedServices,
    addonSuggestion: field === 'service' ? null : state.addonSuggestion,
    addonOfferCompletedServiceId: field === 'service'
      ? null
      : state.addonOfferCompletedServiceId,
    pendingCombinedAvailability: null,
    pendingServiceSeparation: null,
    pendingServiceReplacement: null,
    pendingCoordinatedAvailability: null,
    pendingDeposit: null,
    misunderstandingCount: 0
  }
}

export function shouldRouteBookingV2HumanHandoff(
  routing: ConversationRouting | null
) {
  const humanConfidence = Math.max(
    0,
    ...(routing?.intents
      .filter((intent) => intent.type === 'request_human')
      .map((intent) => intent.confidence) ?? [])
  )
  const informationConfidence = Math.max(
    0,
    ...(routing?.intents
      .filter((intent) => intent.type === 'business_information')
      .map((intent) => intent.confidence) ?? [])
  )
  return humanConfidence >= 0.65 &&
    (informationConfidence < 0.65 || humanConfidence >= 0.85)
}

function formatMoneyForConversation(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}

export function isBookingV2GreetingOnlyMessage(message: string) {
  return isPureSocialGreeting(message)
}

export function isBookingV2InitialGreeting(currentStep: string, message: string) {
  return currentStep === 'START' && isBookingV2GreetingOnlyMessage(message)
}

function hasExplicitBookingRequest(message: string) {
  const normalizedMessage = normalizeText(message)
  return /\b(?:reserv(?:a|ar(?:lo|la|los|las)?|arlo|arla|arlos|arlas|ame|alo|ala|alos|alas)?|agend(?:a|ar(?:lo|la|los|las)?|arlo|arla|arlos|arlas|ame|alo|ala|alos|alas)?|saca(?:r|me)?(?: un)? turno|quiero un turno|necesito un turno|turno|(?:quiero|queria|quisiera|necesito|dame|pedir|sacar|agendar|reservar)(?: una)? cita|cita|(?:da|des|dar|consegui|conseguir)(?:me)?(?: el| un)? turno|quiero hacerlo|quiero hacermelo|que me des el turno)\b/.test(normalizedMessage)
}

function isGenericBookingV2Request(message: string) {
  const normalizedMessage = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const bookingMessage = normalizedMessage
    .replace(/^(?:hola+|holi+|buenas|buen dia|buenas tardes|buenas noches)\s+/, '')
    .trim()
  return [
    'turno',
    'un turno',
    'cita',
    'una cita',
    'reservar',
    'reserva',
    'agendar',
    'quiero un turno',
    'quiero una cita',
    'quiero reservar un turno',
    'necesito un turno',
    'necesito reservar un turno',
    'quiero agendar un turno',
    'quiero sacar un turno',
    'reservar un turno',
    'agendar un turno',
    'sacar un turno',
    'reservar una cita',
    'agendar una cita'
  ].includes(bookingMessage)
}

export function hasQuoteOnlyBookingRequest(
  message: string,
  routing?: Pick<ConversationRouting, 'intents'>
) {
  return hasExplicitBookingRequest(message) ||
    isUnambiguousBookingConfirmation(message) ||
    Boolean(routing?.intents.some((intent) =>
      ['book_appointment', 'confirm_booking'].includes(intent.type) && intent.confidence >= 0.65
  ))
}

export function shouldResumeQuoteOnlyBooking(
  state: BookingV2State,
  message: string,
  routing?: Pick<ConversationRouting, 'intents' | 'bookingExtraction'>
) {
  const requestedServiceId = routing?.bookingExtraction?.service.value ?? null
  const quotedServiceIds = new Set([
    ...state.quoteOnly?.estimates.map((estimate) => estimate.serviceId) ?? [],
    ...state.quoteOnly?.remainingServiceIds ?? [],
    state.guidedEstimate?.serviceId
  ].filter((serviceId): serviceId is string => Boolean(serviceId)))
  return Boolean(state.quoteOnly) &&
    !state.pendingServiceDisambiguation &&
    !state.pendingInformationSelection &&
    !state.guidedEstimate &&
    (!requestedServiceId || quotedServiceIds.has(requestedServiceId)) &&
    hasQuoteOnlyBookingRequest(message, routing)
}

export function bookingStateFromCompletedServiceConsultation(
  state: BookingV2State
): BookingV2State {
  const quotedServiceIds = Array.from(new Set(
    state.quoteOnly?.estimates.map((estimate) => estimate.serviceId) ?? []
  ))
  if (!quotedServiceIds.length) return state

  const [primaryServiceId, ...additionalServiceIds] = quotedServiceIds
  const primaryEstimate = state.quoteOnly?.estimates.find((estimate) =>
    estimate.serviceId === primaryServiceId
  )
  const completedGuidedEstimate = primaryEstimate &&
    Object.prototype.hasOwnProperty.call(primaryEstimate, 'optionId')
    ? {
        serviceId: primaryEstimate.serviceId,
        stage: 'completed' as const,
        optionId: primaryEstimate.optionId ?? null,
        optionLabel: primaryEstimate.optionLabel ?? null,
        priceMin: primaryEstimate.priceMin,
        priceMax: primaryEstimate.priceMax
      }
    : null
  return {
    ...state,
    draft: {
      ...state.draft,
      service: primaryServiceId ?? state.draft.service,
      professional: null,
      date: null,
      time: null
    },
    quoteOnly: null,
    guidedEstimate: completedGuidedEstimate,
    pendingInformationSelection: null,
    combinedServices: additionalServiceIds.map((serviceId) => ({
      serviceId,
      evidence: 'presupuesto consultado'
    })),
    misunderstandingCount: 0
  }
}

export function stateAfterExplicitConsultationReplacement(
  state: BookingV2State,
  routing: ConversationRouting
): BookingV2State {
  if (!state.quoteOnly) return state
  const hasBookingTask = Boolean(routing.bookingMessage) && routing.intents.some((intent) =>
    intent.type === 'book_appointment' && intent.confidence >= 0.65
  )
  if (!hasBookingTask) return state

  const requestedServiceIds = [
    routing.bookingExtraction?.service.value,
    ...(routing.bookingExtraction?.additionalServices ?? []).map((service) => service.value)
  ].filter((serviceId): serviceId is string => Boolean(serviceId))
  if (!requestedServiceIds.length) return state

  const consultedServiceIds = new Set([
    ...state.quoteOnly.estimates.map((estimate) => estimate.serviceId),
    ...state.quoteOnly.remainingServiceIds,
    state.guidedEstimate?.serviceId,
    state.draft.service
  ].filter((serviceId): serviceId is string => Boolean(serviceId)))
  if (requestedServiceIds.every((serviceId) => consultedServiceIds.has(serviceId))) {
    return state
  }

  const fresh = freshBookingV2State(state.draft.name)
  return {
    ...fresh,
    ...(state.lastInformationServiceId !== undefined
      ? { lastInformationServiceId: state.lastInformationServiceId }
      : {})
  }
}

function isPriceInformationRequest(routing: ConversationRouting) {
  return routing.catalogQuery?.requestedInformation.includes('price') === true ||
    routing.intents.some((intent) =>
      intent.type === 'business_information' &&
      intent.topic === 'prices' &&
      intent.confidence >= 0.65
    )
}

export function businessInformationTopicsForPendingSelection(
  requestedInformation: BookingV2PendingInformationSelection['requestedInformation']
): BusinessInformationTopic[] {
  const topics = new Set<BusinessInformationTopic>()
  if (requestedInformation.includes('price')) topics.add('prices')
  if (requestedInformation.includes('deposit')) topics.add('prices')
  if (requestedInformation.includes('general')) topics.add('services')
  if (requestedInformation.includes('professionals')) topics.add('professionals')
  return [...topics]
}

export function isPendingServiceVerificationSelection(
  state: BookingV2State,
  routing: ConversationRouting
) {
  const selectedServiceId = routing.catalogQuery?.serviceId ?? routing.bookingExtraction?.service.value
  if (!selectedServiceId || !state.pendingServiceDisambiguation) return false

  const pendingServiceIds = new Set([
    ...state.pendingServiceDisambiguation.serviceIds,
    ...(state.pendingServiceDisambiguation.remainingGroups ?? [])
      .flatMap((group) => group.serviceIds)
  ])
  return pendingServiceIds.has(selectedServiceId)
}

export function shouldStartQuoteOnlyRequest(
  state: BookingV2State,
  quoteOnlyRequest: boolean,
  requestedServiceId: string | null = null
) {
  if (!quoteOnlyRequest) return false
  if (!state.quoteOnly) return true
  if (
    state.guidedEstimate?.serviceId &&
    requestedServiceId &&
    requestedServiceId !== state.guidedEstimate.serviceId
  ) {
    return true
  }
  return state.quoteOnly.remainingServiceIds.length === 0 && state.guidedEstimate === null
}

export function isUnambiguousBookingConfirmation(message: string) {
  const normalizedMessage = normalizeText(message)
    .replace(/(.)\1{2,}/gu, '$1')
    .replace(/\b(?:si){2,}\b/gu, 'si')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalizedMessage) return false

  const tokens = normalizedMessage.split(' ')
  const blockers = new Set([
    'cambiar', 'cambiame', 'cambiemos', 'cambio', 'cancelar', 'consulta',
    'duda', 'espera', 'fecha', 'horario', 'no', 'otro', 'otra', 'pero',
    'pregunta', 'profesional', 'servicio'
  ])
  if (tokens.some((token) => blockers.has(token))) return false

  const confirmationTokens = new Set([
    'si', 'dale', 'de', 'una', 'mandale', 'mandalo', 'confirmalo',
    'confirmame', 'confirmar', 'confirmo', 'joya', 'listo', 'hacelo',
    'hagamoslo', 'avancemos', 'ok', 'okay', 'esta', 'bien', 'quedamos',
    'asi', 'por', 'favor'
  ])
  return tokens.every((token) => confirmationTokens.has(token))
}

function deterministicBookingRouting(message: string): ConversationRouting {
  return {
    intents: [{
      type: 'book_appointment',
      topic: null,
      confidence: 1,
      evidence: message
    }],
    bookingMessage: message,
    bookingExtraction: null,
    catalogQuery: null,
    source: 'deterministic'
  }
}

export function shouldPrioritizeCoordinatedAvailabilityAction(
  message: string,
  phase: NonNullable<BookingV2State['pendingCoordinatedAvailability']>['phase'] | null
) {
  if (!phase || phase === 'OPTION_SELECTED') return false
  const actionableMessage = bookingCoordinationActionableReply(message)
  const normalizedMessage = normalizeText(actionableMessage)
  if (/\b(?:local|negocio|abren|cierran|apertura|cierre)\b/.test(normalizedMessage)) {
    return false
  }
  const choice = detectBookingCoordinationChoice({
    message: actionableMessage,
    phase: phase === 'AWAITING_DATE'
      ? 'DATE'
      : phase === 'AWAITING_TIME_PREFERENCE' || phase === 'AWAITING_SEARCH_TIME'
        ? 'TIME_PREFERENCE'
        : 'OPTION'
  })
  return choice?.type === 'SHOW_MORE' ||
    choice?.type === 'SHOW_SEARCH_MENU' ||
    choice?.type === 'SHOW_NEXT_DAYS' ||
    choice?.type === 'SEARCH_TIME'
}

export function shouldHandleProfessionalScheduleInformation(input: {
  hasProfessionalScheduleIntent: boolean
  hasPendingCoordinatedAvailability: boolean
  isPendingDeterministicDecision: boolean
  hasProfessionalId: boolean
  informationTopicCount: number
  hasExplicitScheduleQuestion?: boolean
  hasPriorityPendingChoice?: boolean
}) {
  return input.hasProfessionalScheduleIntent &&
    !input.hasPendingCoordinatedAvailability &&
    !input.isPendingDeterministicDecision &&
    !input.hasPriorityPendingChoice &&
    input.hasExplicitScheduleQuestion === true &&
    (
      input.hasProfessionalId ||
      input.informationTopicCount === 0
    )
}

export function isExplicitProfessionalScheduleQuestion(message: string) {
  const normalizedMessage = normalizeText(message)
  const asksWorkingSchedule = /\b(?:horario|horarios|dia|dias|cuando|disponibilidad)\b/.test(normalizedMessage) &&
    /\b(?:profesional|atiende|atender|trabaja|trabajar|hace|tiene|puede|esta)\b/.test(normalizedMessage)
  const asksWhetherWorkingAtTime = /\b(?:atiende|trabaja|esta)\b.{0,30}\b(?:a\s+las?|desde\s+las?|hasta\s+las?)\s+\d{1,2}(?::\d{2})?\b/.test(normalizedMessage)
  return asksWorkingSchedule || asksWhetherWorkingAtTime
}

export function shouldHandleProfessionalAvailabilityInquiry(input: {
  message: string
  professionalId: string | null
  date: string | null
  hasAvailabilityIntent: boolean
}) {
  if (!input.professionalId || !input.date || !input.hasAvailabilityIntent) return false
  const normalizedMessage = normalizeText(input.message)
  const asksForFreeSpace = /\b(?:disponibilidad|disponible|espacio|espacios|lugar|lugares|turno|turnos|hueco|huecos)\b/.test(
    normalizedMessage
  )
  const namesConcreteDate = /\b(?:hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(
    normalizedMessage
  ) || /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(normalizedMessage)
  return asksForFreeSpace && namesConcreteDate
}

export function preliminaryAvailabilityTimeFrom(
  message: string,
  extractedTime: string | null
) {
  const normalizedMessage = normalizeText(message)
  const match = /\b(?:a\s+partir\s+de|desde|despues\s+de)\s+(?:las?\s+)?(\d{1,2})(?:[:.]?(\d{2}))?\b/.exec(
    normalizedMessage
  )
  if (match?.[1]) {
    const hours = Number(match[1])
    const minutes = Number(match[2] ?? '0')
    if (hours <= 23 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }
  }
  return extractedTime
}

export function shouldPrioritizeGuidedEstimateOptionReply(
  state: BookingV2State,
  message: string
) {
  if (state.guidedEstimate?.stage !== 'awaiting_option') return false
  const normalizedMessage = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(?:(?:opcion|numero|la)\s+)?[1-9](?:\s|$)/.test(normalizedMessage)
}

export function pendingInformationSelectionRequest(
  routing: Pick<ConversationRouting, 'bookingMessage' | 'catalogQuery' | 'intents'>
): BookingV2PendingInformationSelection['requestedInformation'] | null {
  if (routing.bookingMessage || routing.catalogQuery?.serviceId) return null
  if ((routing.catalogQuery?.candidateServiceIds?.length ?? 0) > 1) {
    return routing.catalogQuery?.requestedInformation ?? null
  }
  const topics = routing.intents
    .filter((intent) =>
      intent.type === 'business_information' &&
      intent.confidence >= 0.65
    )
    .map((intent) => intent.topic)
  if (topics.includes('prices')) return ['price']
  if (topics.includes('services')) return ['general']
  return null
}

export function unresolvedServiceInformationReply(serviceCatalogReply: string | null) {
  return [
    'Entendí que querés conocer el proceso de un servicio, pero no pude identificar cuál.',
    serviceCatalogReply,
    serviceCatalogReply ? '¿Sobre cuál querés consultar?' : '¿Sobre qué servicio querés consultar?'
  ].filter((part): part is string => Boolean(part)).join('\n\n')
}

export function isBookingV2ConversationClosing(
  message: string,
  routing?: ConversationRouting
) {
  if (routing) {
    return routing.intents.some((intent) =>
      intent.type === 'stop_flow' && intent.confidence >= 0.65
    )
  }

  const normalizedMessage = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (/^(?:no+|nop|nono|nah|na)(?: gracias| tranqui| todo bien)?$/.test(normalizedMessage)) {
    return true
  }

  return [
    'gracias',
    'muchas gracias',
    'listo',
    'listo gracias',
    'joya',
    'joya gracias',
    'era eso',
    'solo eso',
    'nada mas',
    'nada por ahora',
    'por ahora nada',
    'estamos',
    'estamos bien',
    'todo bien gracias',
    'de una gracias',
    'con eso estoy',
    'eso es todo'
  ].includes(normalizedMessage) ||
    [
      'no necesito nada',
      'no preciso nada',
      'con eso alcanza',
      'con eso estamos'
    ].some((phrase) => normalizedMessage.includes(phrase))
}

export function shouldShowBookingV2IntentFallback(
  currentStep: string,
  routing: ConversationRouting
) {
  if (currentStep !== 'START' || routing.bookingMessage) return false

  return routing.intents.length === 0 || routing.intents.every((intent) =>
    ['unknown', 'social_message'].includes(intent.type)
  )
}

export function professionalChangeRoutingMode(input: {
  message: string
  currentStep: string
  hasSelectedProfessional: boolean
  routing: ConversationRouting
}): 'confirmed' | 'verify' | null {
  if (
    !input.hasSelectedProfessional ||
    !['ASK_DATE', 'ASK_TIME'].includes(input.currentStep)
  ) {
    return null
  }

  const correction = input.routing.bookingExtraction?.correction
  const groundedCorrectionEvidence = correction?.evidence.trim()
    ? normalizeText(input.message).includes(normalizeText(correction.evidence))
    : false
  if (
    correction?.field === 'professional' &&
    correction.confidence >= 0.65 &&
    groundedCorrectionEvidence
  ) {
    return 'confirmed'
  }

  const selectsConcreteProfessional = Boolean(
    input.routing.bookingExtraction?.professional.value &&
    input.routing.bookingExtraction.professional.confidence >= 0.55
  )
  const professionalIntent = input.routing.intents.some((intent) =>
    intent.type === 'professional_preference' && intent.confidence >= 0.65
  )
  return professionalIntent && !selectsConcreteProfessional ? 'verify' : null
}

export function withBusinessInformationFollowUp(informationReply: string) {
  return `${informationReply.trim()}\n\n¿Te puedo ayudar en algo más?`
}

export function shouldResumeBookingV2AfterInformation(
  currentStep: string,
  state: BookingV2State
) {
  return isActiveBookingV2Step(currentStep) && !state.quoteOnly
}

export function composeBusinessInformationResumeReply(
  informationReply: string,
  resumedReply: string
) {
  return `${informationReply.trim()}\n\n${resumedReply.trim()}`
}

export function appendBusinessInformationReply(
  currentReply: string | null,
  nextReply: string | null
) {
  const current = currentReply?.trim()
  const next = nextReply?.trim()
  if (!current) return next || null
  if (!next) return current
  const normalizedCurrent = normalizeText(current)
  const normalizedNext = normalizeText(next)
  if (normalizedCurrent.includes(normalizedNext)) return current
  if (normalizedNext.includes(normalizedCurrent)) return next
  return `${current}\n\n${next}`
}

export function mergeBookingV2AgendaFromRouting(input: {
  state: BookingV2State
  routing: ConversationRouting
  now?: Date
}): BookingV2State {
  const candidates: Array<Pick<BookingV2AgendaItem, 'intent' | 'evidence'>> = []
  for (const intent of input.routing.intents) {
    if (intent.confidence < 0.65) continue
    if (intent.type === 'request_quote') {
      candidates.push({ intent: 'request_quote', evidence: intent.evidence })
    }
    if (intent.type === 'availability_preference') {
      candidates.push({ intent: 'check_availability', evidence: intent.evidence })
    }
  }
  if (!candidates.length) return input.state

  const agenda = input.state.agenda.slice()
  for (const candidate of candidates) {
    const existingIndex = agenda.findIndex((item) => item.intent === candidate.intent)
    const item: BookingV2AgendaItem = {
      intent: candidate.intent,
      status: 'pending',
      evidence: candidate.evidence.trim().slice(0, 500),
      serviceId: input.routing.bookingExtraction?.service.value ?? input.state.draft.service,
      serviceInformationProvided: false,
      blockedBy: null,
      createdAt: (input.now ?? new Date()).toISOString()
    }
    if (existingIndex >= 0) {
      const existing = agenda[existingIndex]
      if (existing?.status === 'completed') agenda[existingIndex] = item
    } else {
      agenda.push(item)
    }
  }

  return {
    ...input.state,
    agenda
  }
}

export function splitWhatsAppReply(reply: string, maxLength = 650) {
  const normalizedReply = reply.trim()
  if (!normalizedReply) return []
  if (normalizedReply.length <= maxLength) return [normalizedReply]

  const paragraphs = normalizedReply.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const messages: string[] = []
  let current = ''

  const pushCurrent = () => {
    if (!current) return
    messages.push(current)
    current = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph
      if (candidate.length <= maxLength) {
        current = candidate
      } else {
        pushCurrent()
        current = paragraph
      }
      continue
    }

    pushCurrent()
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const line of lines) {
      if (line.length <= maxLength) {
        const candidate = current ? `${current}\n${line}` : line
        if (candidate.length <= maxLength) current = candidate
        else {
          pushCurrent()
          current = line
        }
        continue
      }

      pushCurrent()
      let remaining = line
      while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf(' ', maxLength)
        if (splitAt < Math.floor(maxLength * 0.6)) splitAt = maxLength
        messages.push(remaining.slice(0, splitAt).trim())
        remaining = remaining.slice(splitAt).trim()
      }
      current = remaining
    }
  }

  pushCurrent()
  return messages
}

function withOutboundMessages(result: HandleMessageResult): HandleMessageResult {
  if (result.suppressOutbound) return { ...result, messages: [] }
  const messages = result.messages?.map((message) => message.trim()).filter(Boolean) ??
    splitWhatsAppReply(result.reply)
  return {
    ...result,
    messages
  }
}

export function isPendingPhotoQuoteActive(
  pending: { serviceId: string; requestedAt: string; expiresAt: string },
  now = new Date()
) {
  const requestedAt = Date.parse(pending.requestedAt)
  const expiresAt = Date.parse(pending.expiresAt)
  return Boolean(pending.serviceId) &&
    Number.isFinite(requestedAt) &&
    Number.isFinite(expiresAt) &&
    requestedAt <= now.getTime() &&
    expiresAt > now.getTime()
}

export function pendingRequestFromRouting(input: {
  currentStep: string
  state: BookingV2State
  routing: ConversationRouting
  now?: Date
}): BookingV2PendingRequest | null {
  if (input.state.draft.name || !input.routing.bookingMessage) return null
  if (!['START', 'ASK_CUSTOMER_NAME'].includes(input.currentStep)) return null

  const intents = input.routing.intents
    .filter((intent) => intent.confidence >= 0.65)
    .map((intent) => intent.type)
    .filter((intent) => [
      'book_appointment',
      'edit_booking',
      'availability_preference',
      'professional_preference',
      'request_quote'
    ].includes(intent))

  return {
    message: input.routing.bookingMessage.trim().slice(0, 1200),
    intents: Array.from(new Set(intents)),
    extraction: input.routing.bookingExtraction ?? null,
    createdAt: (input.now ?? new Date()).toISOString()
  }
}

function withPendingBookingRequest(
  result: BookingV2ProcessResult,
  pendingRequest: BookingV2PendingRequest | null
): BookingV2ProcessResult {
  const state: BookingV2State = {
    ...result.state,
    pendingRequest
  }
  return {
    ...result,
    state,
    conversationPatch: conversationPatchFromState(state)
  }
}

function isActiveBookingV2Step(currentStep: string) {
  return currentStep === 'ASK_CUSTOMER_NAME' ||
    currentStep === 'ASK_SERVICE' ||
    currentStep === 'ASK_PROFESSIONAL' ||
    currentStep === 'ASK_DATE' ||
    currentStep === 'ASK_TIME' ||
    currentStep === 'CONFIRM'
}

function formatDateForBookingV2(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

function isMisunderstandingReply(reply: string) {
  const normalizedReply = normalizeText(reply)

  return [
    'no lo ubique bien',
    'no lo encontre',
    'no me quedo claro',
    'no llegue a tomar tu nombre',
    'no te segui',
    'nos estamos cruzando',
    'entendi que habias elegido'
  ].some((phrase) => normalizedReply.includes(phrase))
}

export function conversationContextWindow(
  currentStep: string,
  updatedAt: Date,
  settings: ConversationContextSettings = {
    pauseAfterMinutes: DEFAULT_CONVERSATION_PAUSE_MINUTES,
    expireAfterMinutes: DEFAULT_CONVERSATION_EXPIRE_MINUTES
  },
  now = new Date()
): 'active' | 'paused' | 'expired' {
  if (currentStep === 'START' || currentStep === 'COMPLETED' || currentStep === 'HUMAN_HANDOFF') {
    return 'active'
  }

  const inactivityMs = Math.max(0, now.getTime() - updatedAt.getTime())
  if (inactivityMs >= settings.expireAfterMinutes * 60 * 1000) return 'expired'
  if (inactivityMs >= settings.pauseAfterMinutes * 60 * 1000) return 'paused'
  return 'active'
}

export function contextDecisionButtons(conversationId: string) {
  return [
    { id: `context_continue:${conversationId}`, title: 'Continuar reserva' },
    { id: `context_new:${conversationId}`, title: 'Nueva consulta' },
    { id: `context_handoff:${conversationId}`, title: 'Hablar con equipo' }
  ]
}

export function bookingCoordinationReplyButtons(input: {
  conversationId: string
  plan: BookingV2MessagePlan
  state: BookingV2State
  availabilityOptions?: Array<{ time: string }>
  dateOptions?: string[]
}): Array<{ id: string; title: string }> | null {
  const prefix = `coord:${input.conversationId}:`
  if (input.plan.type === 'clarify_unsupported_service') {
    return unsupportedServiceDecisionButtons(input.conversationId)
  }
  if (
    input.plan.type === 'ask_field' &&
    input.plan.field === 'service' &&
    input.state.pendingServiceDisambiguation?.serviceIds.length === 1 &&
    !input.state.pendingServiceDisambiguation.catalogFallback
  ) {
    return [
      { id: `${prefix}disambiguation_confirm`, title: 'Sí, es ese' },
      { id: `${prefix}disambiguation_reject`, title: 'No, ver servicios' },
      { id: `${prefix}human`, title: 'Necesito atención' }
    ]
  }
  if (input.plan.type === 'ask_service_validation') {
    return [
      { id: `${prefix}validate_continue`, title: 'Seguir' },
      { id: `${prefix}validate_help`, title: 'Necesito ayuda' }
    ]
  }
  if (input.plan.type === 'ask_estimate_option') {
    if (input.plan.options.length > 0 && input.plan.options.length <= 3) {
      return input.plan.options.map((option, index) => ({
        id: `${prefix}estimate_option:${encodeURIComponent(option.id)}`,
        title: estimateOptionButtonTitle(option.label, index)
      }))
    }
    return [
      { id: `${prefix}estimate_exact_quote`, title: 'Presupuesto exacto' }
    ]
  }
  if (
    !input.state.quoteOnly &&
    (
      input.plan.type === 'show_estimate' ||
      input.plan.type === 'show_base_estimate' ||
      input.plan.type === 'ask_estimate_decision'
    )
  ) {
    return [
      ...(input.plan.allowsBooking
        ? [{ id: `${prefix}estimate_continue`, title: 'Continuar reserva' }]
        : []),
      { id: `${prefix}estimate_exact_quote`, title: 'Presupuesto exacto' }
    ]
  }
  if (
    input.plan.type === 'quote_complete' &&
    isPriceServiceConsultation(input.state.quoteOnly)
  ) {
    return otherQueryMenuButtons(input.conversationId)
  }
  const addonServiceIds = input.plan.type === 'ask_service_addons'
    ? input.plan.serviceIds
    : input.state.addonSuggestion?.candidateServiceIds ?? []
  if (addonServiceIds.length) {
    return [
      { id: `${prefix}addon_first`, title: 'Agregar opción 1' },
      ...(addonServiceIds.length > 1
        ? [{ id: `${prefix}addon_all`, title: 'Agregar todas' }]
        : []),
      { id: `${prefix}addon_continue`, title: 'No, continuar' }
    ]
  }
  if (input.plan.type === 'ask_field' && input.plan.field === 'date') {
    if (input.dateOptions) {
      return [
        ...input.dateOptions.slice(0, 2).map((date) => {
          const title = coordinatedDateButtonTitle(date)
          const action = title === 'Hoy'
            ? 'booking_date_today'
            : title === 'Mañana'
              ? 'booking_date_tomorrow'
              : `date:${date}`
          return { id: `${prefix}${action}`, title }
        }),
        { id: `${prefix}booking_date_other`, title: 'Otra fecha' }
      ]
    }
    return [
      { id: `${prefix}booking_date_today`, title: 'Hoy' },
      { id: `${prefix}booking_date_tomorrow`, title: 'Mañana' },
      { id: `${prefix}booking_date_other`, title: 'Otra fecha' }
    ]
  }
  if (
    input.plan.type === 'ask_field' &&
    input.plan.field === 'time' &&
    input.availabilityOptions?.length
  ) {
    return input.availabilityOptions.slice(0, 3).map((option) => ({
      id: `${prefix}booking_time:${option.time}`,
      title: option.time
    }))
  }
  if (input.plan.type === 'confirm_booking') {
    return [
      { id: `${prefix}booking_confirm`, title: 'Confirmar turno' },
      { id: `${prefix}booking_change_time`, title: 'Cambiar horario' },
      { id: `${prefix}booking_cancel`, title: 'Cancelar reserva' }
    ]
  }
  if (input.plan.type === 'offer_separate_services' && input.plan.reason === 'no_common_professional') {
    return [
      { id: `${prefix}start`, title: 'Coordinar horarios' },
      { id: `${prefix}modify`, title: 'Modificar servicios' },
      { id: `${prefix}human`, title: 'Solicitar atención' }
    ]
  }
  if (input.plan.type === 'ask_coordinated_date') {
    const dateButtons = input.plan.quickDates.slice(0, 2).map((date) => ({
      id: `${prefix}date:${date}`,
      title: coordinatedDateButtonTitle(date)
    }))
    if (dateButtons.length === 2) {
      return [...dateButtons, { id: `${prefix}other_date`, title: 'Otra fecha' }]
    }
    if (dateButtons.length === 1) {
      return [
        ...dateButtons,
        { id: `${prefix}next_days`, title: 'Próximos días' },
        { id: `${prefix}other_date`, title: 'Otra fecha' }
      ]
    }
    return input.state.pendingCoordinatedAvailability?.requireRequestedProfessional
      ? [
          { id: `${prefix}next_days`, title: 'Próximos días' },
          {
            id: `${prefix}without_professional`,
            title: withoutProfessionalButtonTitle(input.plan.professionalName)
          },
          { id: `${prefix}other_date`, title: 'Otra fecha' }
        ]
      : [
          { id: `${prefix}next_days`, title: 'Próximos días' },
          { id: `${prefix}other_date`, title: 'Elegir una fecha' },
          { id: `${prefix}human`, title: 'Solicitar atención' }
        ]
  }
  if (input.plan.type === 'ask_coordinated_time_preference') {
    const labels = {
      MORNING: 'Por la mañana',
      MIDDAY: 'Al mediodía',
      AFTERNOON: 'Por la tarde'
    } as const
    const buttons: Array<{ id: string; title: string }> = input.plan.bands.slice(0, 3).map((band) => ({
      id: `${prefix}band:${band.toLowerCase()}`,
      title: labels[band]
    }))
    if (buttons.length < 3) {
      buttons.push({ id: `${prefix}exact_time`, title: 'Horario exacto' })
    }
    return buttons
  }
  if (input.plan.type === 'offer_coordinated_options') {
    const visibleOptions = input.plan.options.slice(0, 2)
    const hasRepeatedStartTime = new Set(visibleOptions.map((option) => option.startTime)).size < visibleOptions.length
    const buttons = visibleOptions.map((option, index) => ({
      id: `${prefix}option:${index + 1}`,
      title: hasRepeatedStartTime ? `${index + 1}. ${option.startTime}` : option.startTime
    }))
    buttons.push({ id: `${prefix}search_menu`, title: 'Otras búsquedas' })
    return buttons
  }
  if (input.plan.type === 'show_coordinated_search_menu') {
    return [
      { id: `${prefix}more`, title: 'Más horarios' },
      { id: `${prefix}next_days`, title: 'Próximos días' },
      { id: `${prefix}search_time`, title: 'Buscar por hora' }
    ]
  }
  if (input.plan.type === 'coordinated_date_unavailable') {
    if (input.plan.canSearchWithoutProfessional) {
      return [
        input.plan.requestedTime
          ? { id: `${prefix}search_time`, title: 'Probar otra hora' }
          : { id: `${prefix}other_date`, title: 'Buscar otro día' },
        {
          id: `${prefix}without_professional`,
          title: withoutProfessionalButtonTitle(input.plan.professionalName)
        },
        { id: `${prefix}human`, title: 'Solicitar atención' }
      ]
    }
    return [
      { id: `${prefix}next_days`, title: 'Próximos días' },
      { id: `${prefix}search_time`, title: 'Buscar un horario' },
      { id: `${prefix}more`, title: 'Más opciones' }
    ]
  }
  if (input.plan.type === 'show_coordinated_more_options') {
    return [
      { id: `${prefix}other_date`, title: 'Elegir otra fecha' },
      { id: `${prefix}modify`, title: 'Modificar servicios' },
      { id: `${prefix}human`, title: 'Solicitar atención' }
    ]
  }
  if (input.plan.type === 'show_service_modification_menu') {
    return [
      { id: `${prefix}mod_change`, title: 'Cambiar un servicio' },
      { id: `${prefix}mod_remove`, title: 'Quitar un servicio' },
      { id: `${prefix}restart`, title: 'Empezar de nuevo' }
    ]
  }
  if (input.plan.type === 'show_coordinated_selection') {
    return [
      {
        id: `${prefix}confirm_reservations`,
        title: input.plan.assignmentMode === 'MULTIPLE_PROFESSIONALS'
          ? 'Confirmar reservas'
          : 'Confirmar turno'
      },
      { id: `${prefix}change_time`, title: 'Cambiar horario' },
      { id: `${prefix}human`, title: 'Solicitar atención' }
    ]
  }
  return null
}

export async function presentBookingV2Result(input: {
  businessId: string
  conversationId: string
  result: BookingV2ProcessResult
}) {
  const asksDate = input.result.plan.type === 'ask_field' &&
    input.result.plan.field === 'date'
  const dateOptions = asksDate
    ? await bookingV2Engine.simpleDateOptions({
        businessId: input.businessId,
        state: input.result.state
      })
    : null
  const reply = dateOptions?.checkedTodayAndTomorrow
    ? replaceBookingDatePrompt(input.result.reply, dateOptions.dates)
    : input.result.reply
  const buttons = bookingCoordinationReplyButtons({
    conversationId: input.conversationId,
    plan: input.result.plan,
    state: input.result.state,
    availabilityOptions: input.result.availabilityOptions,
    ...(dateOptions?.checkedTodayAndTomorrow
      ? { dateOptions: dateOptions.dates }
      : {})
  })
  return { reply, buttons }
}

export function replaceBookingDatePrompt(reply: string, availableDates: string[]) {
  const currentPrompt = 'Perfecto 😊 ¿Qué día te gustaría venir? Puede ser hoy, mañana o una fecha específica.'
  return reply.replace(currentPrompt, bookingDatePromptForOptions(availableDates))
}

export function bookingDatePromptForOptions(availableDates: string[]) {
  const labels = availableDates.map((date) => coordinatedDateButtonTitle(date))
  const hasToday = labels.includes('Hoy')
  const hasTomorrow = labels.includes('Mañana')
  if (hasToday && hasTomorrow) {
    return 'Perfecto 😊 ¿Qué día te gustaría venir? Puede ser hoy, mañana o una fecha específica.'
  }
  if (hasToday) {
    return 'Perfecto 😊 Tengo horarios disponibles hoy. También podés elegir otra fecha.'
  }
  if (hasTomorrow) {
    return 'Perfecto 😊 Tengo horarios disponibles mañana. También podés elegir otra fecha.'
  }
  if (availableDates.length) {
    return 'No encontré horarios disponibles hoy ni mañana. Te muestro las próximas fechas con disponibilidad, o podés elegir otra.'
  }
  return 'No encontré horarios disponibles hoy ni mañana. Escribime otra fecha y busco disponibilidad.'
}

export function bookingCoordinationMessageFromInteractiveReply(
  replyId: string | undefined,
  conversationId: string
) {
  if (!replyId) return null
  const prefix = `coord:${conversationId}:`
  if (!replyId.startsWith(prefix)) return null
  const action = replyId.slice(prefix.length)
  if (action === 'start') return 'coordinar horarios'
  if (action === 'modify') return 'modificar servicios'
  if (action === 'human') return 'solicitar atención'
  if (action === 'next_days') return 'próximos días'
  if (action === 'other_date') return 'elegir otra fecha'
  if (action === 'search_time') return 'buscar un horario'
  if (action === 'exact_time') return 'buscar un horario'
  if (action === 'without_professional') return 'buscar sin el profesional solicitado'
  if (action === 'more') return 'ver más horarios'
  if (action === 'search_menu') return 'otras búsquedas'
  if (action === 'mod_change') return 'cambiar un servicio'
  if (action === 'mod_remove') return 'quitar un servicio'
  if (action === 'restart') return 'empezar de nuevo desde cero'
  if (action === 'validate_continue') return 'sí, seguimos'
  if (action === 'validate_help') return 'no estoy seguro, necesito asesoramiento'
  if (action === 'disambiguation_confirm') return 'sí'
  if (action === 'disambiguation_reject') return 'no'
  if (action === 'estimate_continue') return 'sí, quiero continuar con la reserva'
  if (action === 'estimate_exact_quote') return 'prefiero un presupuesto exacto'
  if (action.startsWith('estimate_option:')) {
    const encodedOptionId = action.slice('estimate_option:'.length)
    if (!encodedOptionId) return null
    try {
      return `estimate-option:${decodeURIComponent(encodedOptionId)}`
    } catch {
      return null
    }
  }
  if (action === 'addon_first') return '1'
  if (action === 'addon_all') return 'agregar todos los servicios sugeridos'
  if (action === 'addon_continue') return 'No, continuar'
  if (action === 'booking_date_today') return 'hoy'
  if (action === 'booking_date_tomorrow') return 'mañana'
  if (action === 'booking_date_other') return 'elegir otra fecha'
  if (action === 'booking_confirm') return 'confirmar turno'
  if (action === 'booking_change_time') return 'cambiar horario'
  if (action === 'booking_cancel') return 'cancelar reserva'
  if (action === 'confirm_reservations') return 'confirmar las reservas'
  if (action === 'change_time') return 'cambiar horario'
  if (action === 'band:morning') return 'por la mañana'
  if (action === 'band:midday') return 'al mediodía'
  if (action === 'band:afternoon') return 'por la tarde'
  const date = /^date:(\d{4}-\d{2}-\d{2})$/.exec(action)?.[1]
  if (date) return date
  const option = /^option:([12])$/.exec(action)?.[1]
  if (option) return option
  const bookingTime = /^booking_time:(\d{2}:\d{2})$/.exec(action)?.[1]
  if (bookingTime) return bookingTime
  return null
}

function withoutProfessionalButtonTitle(professionalName?: string | null) {
  const firstName = professionalName?.trim().split(/\s+/)[0]
  const title = firstName ? `Buscar sin ${firstName}` : 'Cambiar profesional'
  return title.length <= 20 ? title : 'Cambiar profesional'
}

function estimateOptionButtonTitle(label: string, index: number) {
  const title = label.trim().replace(/\s+/g, ' ')
  if (title.length <= 20) return title

  const withoutParenthetical = title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (withoutParenthetical.length <= 20) return withoutParenthetical

  const compact = withoutParenthetical
    .replace(/\bde los\b/giu, 'de')
    .replace(/\bde las\b/giu, 'de')
    .replace(/\bde la\b/giu, 'de')
    .replace(/\s+/g, ' ')
    .trim()
  if (compact.length <= 20) return compact

  const shortened = compact.slice(0, 20).replace(/\s+\S*$/, '').trim()
  return shortened || `Opción ${index + 1}`
}

function coordinatedDateButtonTitle(date: string) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
  if (date === today) return 'Hoy'
  const tomorrow = new Date(`${today}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (date === tomorrow.toISOString().slice(0, 10)) return 'Mañana'
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!Number.isNaN(parsed.getTime())) {
    const formatted = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric'
    }).format(parsed).replace('.', '')
    return formatted.charAt(0).toUpperCase() + formatted.slice(1)
  }
  return date.slice(0, 20)
}

export function contextActionFromInteractiveReply(replyId: string | undefined, conversationId: string) {
  if (replyId === `context_continue:${conversationId}`) return 'continue' as const
  if (replyId === `context_new:${conversationId}`) return 'new' as const
  if (replyId === `context_handoff:${conversationId}`) return 'handoff' as const
  return null
}

export function contextActionFromChoice(choice: { choiceId: string | null; confidence: number }) {
  if (
    choice.confidence >= 0.85 &&
    (choice.choiceId === 'continue' || choice.choiceId === 'new' || choice.choiceId === 'handoff')
  ) {
    return choice.choiceId
  }
  return 'unclear' as const
}

export function recoveryDecisionButtons(conversationId: string) {
  return [
    { id: `recovery_resume:${conversationId}`, title: 'Continuar reserva' },
    { id: `recovery_other:${conversationId}`, title: 'Otra consulta' },
    { id: `recovery_handoff:${conversationId}`, title: 'Hablar con equipo' }
  ]
}

export function professionalSelectionButtons(
  conversationId: string,
  professionals: Array<{ id: string; name: string }>
) {
  return professionals.slice(0, 3).map((professional) => ({
    id: `professional:${conversationId}:${professional.id}`,
    title: professional.name.trim().slice(0, 20)
  }))
}

export function catalogRecoveryDecisionButtons(conversationId: string) {
  return [
    { id: `catalog_show_all:${conversationId}`, title: 'Ver todos' },
    { id: `catalog_handoff:${conversationId}`, title: 'Hablar con equipo' },
    { id: `catalog_restart:${conversationId}`, title: 'Volver a empezar' }
  ]
}

export function catalogRecoveryActionFromInteractiveReply(
  replyId: string | undefined,
  conversationId: string
) {
  if (replyId === `catalog_show_all:${conversationId}`) return 'show_all' as const
  if (replyId === `catalog_handoff:${conversationId}`) return 'handoff' as const
  if (replyId === `catalog_restart:${conversationId}`) return 'restart' as const
  return null
}

export function unsupportedServiceDecisionButtons(conversationId: string) {
  return [
    { id: `unsupported_services:${conversationId}`, title: 'Ver servicios' },
    { id: `recovery_other:${conversationId}`, title: 'Otra consulta' },
    { id: `recovery_handoff:${conversationId}`, title: 'Hablar con equipo' }
  ]
}

export function unsupportedServiceActionFromInteractiveReply(
  replyId: string | undefined,
  conversationId: string
) {
  if (replyId === `unsupported_services:${conversationId}`) return 'show_services' as const
  return null
}

export function otherQueryMenuButtons(conversationId: string) {
  return [
    { id: `other_services:${conversationId}`, title: 'Ver servicios' },
    { id: `other_book:${conversationId}`, title: 'Reservar turno' },
    { id: `other_manage:${conversationId}`, title: 'Gestionar mi turno' }
  ]
}

export function preliminaryAvailabilityDecisionButtons(conversationId: string) {
  return [
    { id: `preliminary_availability_book:${conversationId}`, title: 'Sí, reservar' },
    { id: `preliminary_availability_decline:${conversationId}`, title: 'No' }
  ]
}

export function preliminaryAvailabilityActionFromInteractiveReply(
  replyId: string | undefined,
  conversationId: string
) {
  if (replyId === `preliminary_availability_book:${conversationId}`) return 'book' as const
  if (replyId === `preliminary_availability_decline:${conversationId}`) return 'decline' as const
  return null
}

export function preliminaryAvailabilityDecisionFromMessage(message: string) {
  const normalizedMessage = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^(?:si|dale|bueno|ok|okay|quiero|reservar|si reservar|quiero reservar)$/.test(normalizedMessage)) {
    return 'book' as const
  }
  if (/^(?:no|no gracias|por ahora no|ahora no)$/.test(normalizedMessage)) {
    return 'decline' as const
  }
  return null
}

export function handoffCancellationButtons(conversationId: string) {
  return [{
    id: `handoff_cancel:${conversationId}`,
    title: 'Cancelar atención'
  }]
}

export function isHandoffCancellationRequest(
  replyId: string | undefined,
  message: string,
  conversationId: string
) {
  if (replyId === `handoff_cancel:${conversationId}`) return true
  const normalizedMessage = normalizeText(message)
  return normalizedMessage === 'cancelar atencion' ||
    normalizedMessage === 'cancelar solicitud de atencion'
}

export function manageAppointmentDecisionButtons(conversationId: string) {
  return [
    { id: `other_edit:${conversationId}`, title: 'Modificarlo' },
    { id: `other_cancel:${conversationId}`, title: 'Cancelarlo' }
  ]
}

export function otherQueryMenuActionFromInteractiveReply(
  replyId: string | undefined,
  conversationId: string
) {
  if (replyId === `other_services:${conversationId}`) return 'show_services' as const
  if (replyId === `other_book:${conversationId}`) return 'book_appointment' as const
  if (replyId === `other_manage:${conversationId}`) return 'manage_appointment' as const
  if (replyId === `other_edit:${conversationId}`) return 'edit_appointment' as const
  if (replyId === `other_cancel:${conversationId}`) return 'cancel_appointment' as const
  return null
}

export function isGroundedUnsupportedServiceRequest(
  message: string,
  routing: ConversationRouting
) {
  if (routing.bookingExtraction?.service.value) return false
  if (routing.catalogQuery?.serviceId || routing.catalogQuery?.candidateServiceIds?.length) return false
  const normalizedMessage = normalizeText(message)
  return routing.intents.some((intent) => {
    if (intent.type !== 'unsupported_service') return false
    const normalizedEvidence = normalizeText(intent.evidence)
    return Boolean(normalizedEvidence) && normalizedMessage.includes(normalizedEvidence)
  })
}

export function recoveryActionFromInteractiveReply(replyId: string | undefined, conversationId: string) {
  if (replyId === `recovery_resume:${conversationId}`) return 'resume' as const
  if (replyId === `recovery_other:${conversationId}`) return 'other_query' as const
  if (replyId === `recovery_handoff:${conversationId}`) return 'handoff' as const
  return null
}

export function businessInformationNeedsHuman(reply: string) {
  const normalized = normalizeText(reply)
  return normalized.includes('no tengo') &&
    (normalized.includes('derivo') || normalized.includes('persona') || normalized.includes('equipo'))
}

export function formatProfessionalWorkingHours(hours: Array<{
  dayOfWeek: number
  startTime: string
  endTime: string
}>) {
  const labels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  return hours.map((item) =>
    `• ${labels[item.dayOfWeek] ?? `Día ${item.dayOfWeek}`}: ${item.startTime} a ${item.endTime}`
  )
}

export function isHumanHandoffMessage(message: string) {
  const normalizedMessage = normalizeText(message)
  const exactMessages = [
    'persona',
    'humano',
    'operador',
    'asesor',
    'recepcion',
    'recepcionista',
    'atencion',
    'atencion humana'
  ]

  if (exactMessages.includes(normalizedMessage)) {
    return true
  }

  return [
    'hablar con una persona',
    'hablar con persona',
    'hablar con humano',
    'quiero hablar con una persona',
    'quiero hablar con persona',
    'quiero hablar con humano',
    'atendido por una persona',
    'atendida por una persona',
    'que me atienda una persona',
    'que me atienda alguien',
    'necesito una persona',
    'pasarte con una persona',
    'pasame con una persona',
    'pasame con alguien',
    'quiero atencion',
    'necesito atencion',
    'quiero atencion humana',
    'necesito atencion humana'
  ].some((phrase) => normalizedMessage.includes(phrase))
}

export function isMyAppointmentsMessage(
  message: string,
  currentStep: string,
  options: { allowMenuShortcut?: boolean } = {}
) {
  const normalizedMessage = normalizeText(message)
  const allowMenuShortcut = options.allowMenuShortcut ?? true

  return (allowMenuShortcut && isMenuStep(currentStep) && normalizedMessage === '2') ||
    normalizedMessage === 'mis turnos' ||
    normalizedMessage.includes('ver mis turnos') ||
    normalizedMessage.includes('quiero ver mis turnos') ||
    normalizedMessage.includes('tengo turnos') ||
    normalizedMessage.includes('que turnos tengo')
}

function isArrivalNoticeMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return normalizedMessage === 'avisar llegada' ||
    normalizedMessage === 'llegada' ||
    normalizedMessage.includes('estoy en camino') ||
    normalizedMessage.includes('voy en camino') ||
    normalizedMessage.includes('ya sali') ||
    normalizedMessage.includes('estoy llegando') ||
    normalizedMessage.includes('voy llegando') ||
    normalizedMessage.includes('llego en') ||
    normalizedMessage.includes('llego tarde') ||
    normalizedMessage.includes('llegando tarde') ||
    normalizedMessage.includes('me demoro') ||
    normalizedMessage.includes('estoy demorado') ||
    normalizedMessage.includes('estoy demorada') ||
    normalizedMessage.includes('voy atrasado') ||
    normalizedMessage.includes('voy atrasada')
}

function calculateArrivalDelayMinutes(message: string, appointmentStartAt: Date) {
  const normalizedMessage = normalizeText(message)

  if (
    normalizedMessage.includes('tarde') ||
    normalizedMessage.includes('demoro') ||
    normalizedMessage.includes('demorado') ||
    normalizedMessage.includes('demorada') ||
    normalizedMessage.includes('atrasado') ||
    normalizedMessage.includes('atrasada')
  ) {
    return null
  }

  const etaMinutes = parseArrivalEtaMinutes(normalizedMessage)

  if (etaMinutes === null) {
    return 0
  }

  const minutesUntilAppointment = Math.ceil((appointmentStartAt.getTime() - Date.now()) / 60000)

  return etaMinutes - minutesUntilAppointment
}

function parseArrivalEtaMinutes(normalizedMessage: string) {
  const match = normalizedMessage.match(/\b(?:llego|llegaria|estoy|voy)\s+(?:en\s+)?(\d{1,3})\s*(?:min|mins|minutos|m)?\b/)

  if (!match?.[1]) {
    return null
  }

  return Number(match[1])
}

export function isCancelAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '3') ||
    normalizedMessage === 'cancelar turno' ||
    normalizedMessage === 'cancelarlo' ||
    normalizedMessage === 'anular turno' ||
    normalizedMessage.includes('cancelar un turno') ||
    normalizedMessage.includes('cancelar mi turno') ||
    normalizedMessage.includes('anular mi turno') ||
    normalizedMessage.includes('anular un turno') ||
    normalizedMessage.includes('no voy a ir') ||
    normalizedMessage.includes('quiero cancelar') ||
    normalizedMessage.includes('kiero cancelar') ||
    normalizedMessage.includes('quiero canselar') ||
    normalizedMessage.includes('kiero canselar') ||
    normalizedMessage.includes('puedo cancelar')
}

export function isEditAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '4') ||
    normalizedMessage === 'editar turno' ||
    normalizedMessage === 'modificar turno' ||
    normalizedMessage === 'modificarlo' ||
    normalizedMessage === 'mover turno' ||
    normalizedMessage.includes('cambiar un turno') ||
    normalizedMessage.includes('cambiar mi turno') ||
    normalizedMessage.includes('modificar mi turno') ||
    normalizedMessage.includes('mover mi turno') ||
    normalizedMessage.includes('moverlo') ||
    normalizedMessage.includes('pasarlo') ||
    normalizedMessage.includes('camviar turno') ||
    normalizedMessage.includes('camviar un turno') ||
    normalizedMessage.includes('kiero cambiar') ||
    normalizedMessage.includes('kiero camviar') ||
    normalizedMessage.includes('editar mi turno') ||
    normalizedMessage.includes('reprogramar')
}

export function isManageAppointmentMessage(message: string) {
  const normalizedMessage = normalizeText(message)
  return normalizedMessage === 'gestionar mi turno' ||
    normalizedMessage === 'gestionar turno' ||
    normalizedMessage === 'modificar o cancelar un turno' ||
    normalizedMessage === 'modificar o cancelar mi turno'
}

function parseAppointmentListOption(message: string) {
  const normalizedMessage = normalizeText(message)
  const directOption = normalizedMessage.match(/^(\d{1,2})(?:\.|\)|-)?(?:\s|$)/)

  if (directOption?.[1]) {
    return Number(directOption[1])
  }

  const optionFromText = normalizedMessage.match(/\b(?:el|la|numero|nro|opcion|turno)\s+(\d{1,2})\b/)

  if (optionFromText?.[1]) {
    return Number(optionFromText[1])
  }

  const anyNumber = normalizedMessage.match(/\b(\d{1,2})\b/)

  return anyNumber?.[1] ? Number(anyNumber[1]) : null
}

function isPostBookingClosingMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  if (isBookingStartMessage(message, 'START')) {
    return false
  }

  return [
    'gracias',
    'muchas gracias',
    'dale gracias',
    'dale',
    'genial',
    'excelente',
    'buenisimo',
    'buenisimo gracias',
    'perfecto',
    'ok',
    'okay',
    'okey',
    'listo',
    'joya',
    'barbaro',
    'barbaro gracias',
    'dale excelente',
    'dale perfecto',
    'nos vemos'
  ].includes(normalizedMessage) ||
    [
      'muchas gracias',
      'dale excelente',
      'dale perfecto',
      'todo listo',
      'quedamos asi',
      'nos vemos',
      'hasta luego'
    ].some((phrase) => normalizedMessage.includes(phrase))
}

function isPostBookingGreetingMessage(message: string) {
  return isBookingV2GreetingOnlyMessage(message)
}

export function isPostBookingWellbeingQuestion(message: string) {
  const normalizedMessage = normalizeText(message)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  return [
    'hola como estas',
    'como estas',
    'como va',
    'todo bien'
  ].includes(normalizedMessage)
}

export function resolvePendingInformationSelectionFromLabels(
  message: string,
  services: Array<{ id: string; labels: string[] }>
) {
  const normalizedMessage = normalizeText(message)
    .replace(/^(?:elijo|me interesa|prefiero|quiero)\s+/, '')
    .replace(/\s+por favor$/, '')
    .trim()
  if (!normalizedMessage) return null

  const matches = services.filter((service) =>
    service.labels.some((label) => normalizeText(label) === normalizedMessage)
  )
  return matches.length === 1 ? matches[0]?.id ?? null : null
}

export function looksLikeExpectedCustomerName(message: string, currentStep: string) {
  if (currentStep !== 'ASK_CUSTOMER_NAME') return false
  const candidate = message.trim().replace(/\s+/g, ' ')
  if (
    candidate.length < 2 ||
    candidate.length > 60 ||
    !/^\p{Letter}+(?:[ '-]\p{Letter}+){0,2}$/u.test(candidate)
  ) {
    return false
  }

  const normalized = normalizeText(candidate)
  const rejected = new Set([
    'cancelar', 'consulta', 'direccion', 'equipo', 'gracias', 'hola',
    'horario', 'horarios', 'precio', 'profesional', 'profesionales',
    'reservar', 'reserva', 'servicio', 'servicios', 'turno', 'volver'
  ])
  return !normalized.split(' ').some((token) => rejected.has(token)) &&
    !['no', 'si', 'no se', 'otra consulta', 'por favor'].includes(normalized)
}

function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  return `${day}/${month}/${year}`
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

function formatIsoDateForConversation(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function addMinutesToTime(value: string, minutesToAdd: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match?.[1] || !match[2]) return value
  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + minutesToAdd
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function canHumanizeSafely(reply: string) {
  const protectedPatterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    /\b\d{2}:\d{2}\b/,
    /^\*\s/m,
    /^[-•]\s/m,
    /^\d+\.\s/m,
    /Horarios disponibles/i,
    /opciones disponibles/i,
    /Preferís/i,
    /Para qué dia/i,
    /Fecha:/i,
    /Horario:/i,
    /Profesional:/i,
    /Servicio:/i,
    /confirmar/i,
    /reservar turno/i,
    /compartir tu nombre/i,
    /tomar tu nombre/i,
    /c[oó]mo te llam/i,
    /a nombre de qui[eé]n/i,
    /avis/i,
    /avis[eé]/i,
    /avisado/i,
    /no hay problema/i,
    /cancel[eé] ese turno/i,
    /empezamos de nuevo/i,
    /hablar con una persona/i,
    /te derivo con una persona/i
  ]

  return !protectedPatterns.some((pattern) => pattern.test(reply))
}

function preservesRequiredLines(originalReply: string, styledReply: string) {
  const requiredLines = originalReply
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      return line.startsWith('* ') ||
        line.startsWith('- ') ||
        line.startsWith('• ')
    })

  return requiredLines.every((line) => styledReply.includes(line))
}

function preservesRequiredBotName(
  originalReply: string,
  styledReply: string,
  assistantName: string
) {
  const originalHasBotName = originalReply.includes(assistantName)
  const styledHasBotName = styledReply.includes(assistantName)

  return originalHasBotName === styledHasBotName
}
