import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { AiMessageUnderstandingService, type AiConversationIntent } from './ai-message-understanding-service.js'
import { BookingConversationFlow, isBookingStartMessage, isMenuStep } from './booking-conversation-flow.js'
import { BotCopyService } from './bot-copy-service.js'
import { normalizeText } from './message-understanding-service.js'
import { runWithAiEnabled } from './ai-execution-context.js'
import { BookingV2Engine } from './booking-v2-engine.js'
import type { BookingV2MessagePlan } from './booking-v2-dialogue.js'
import type { BookingField } from './booking-v2-state.js'
import { reopenClosedConversationOpportunity } from './conversation-opportunity-service.js'
import {
  businessInformationTopicsFromRouting,
  ConversationRouter,
  type ConversationRouting
} from './conversation-router.js'
import { ConversationRouterContextService } from './conversation-router-context-service.js'
import { BusinessKnowledgeService } from './business-knowledge-service.js'

const bookingConversationFlow = new BookingConversationFlow()
const bookingProvider = new InternalBookingProvider()
const botCopyService = new BotCopyService()
const aiMessageUnderstandingService = new AiMessageUnderstandingService()
const bookingV2Engine = new BookingV2Engine()
const conversationRouter = new ConversationRouter()
const conversationRouterContextService = new ConversationRouterContextService()
const businessKnowledgeService = new BusinessKnowledgeService()

type HandleMessageInput = {
  phone: string
  message: string
  businessId?: string
  useAi?: boolean
}

type HandleMessageResult = {
  reply: string
  skipMisunderstandingTracking?: boolean
  skipHumanize?: boolean
}

export class ConversationService {
  async handleMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    return runWithAiEnabled(input.useAi !== false, async () => {
      const result = await this.handleMessageCore(input)
      if (!result.skipMisunderstandingTracking) {
        await this.trackMisunderstanding(input.phone, result.reply)
      }

      if (result.skipHumanize) {
        return { reply: result.reply }
      }

      return this.humanizeResult({
        result,
        message: input.message.trim()
      })
    })
  }

  private async handleMessageCore(input: HandleMessageInput): Promise<HandleMessageResult> {
    const message = input.message.trim()
    const businessId = await this.resolveBusinessId(input.businessId)
    const existingConversation = await prisma.conversation.findUnique({
      where: {
        phone: input.phone
      }
    })
    if (existingConversation?.opportunityStatus === 'CLOSED') {
      await reopenClosedConversationOpportunity(existingConversation.id)
    }
    const shouldResetExpiredFlow = existingConversation
      ? isExpiredInProgressConversation(existingConversation.currentStep, existingConversation.updatedAt)
      : false

    const conversation = existingConversation
      ? await prisma.conversation.update({
          where: {
            phone: input.phone
          },
          data: shouldResetExpiredFlow
            ? {
                lastMessage: message,
                businessId,
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
            : {
                lastMessage: message,
                businessId,
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

    if (shouldResetExpiredFlow) {
      if (!conversation.selectedCustomerName) {
        await this.updateConversation(input.phone, {
          currentStep: 'ASK_CUSTOMER_NAME'
        })

        return {
          reply: botCopyService.askInitialName()
        }
      }

      return {
        reply: botCopyService.mainMenu(conversation.selectedCustomerName)
      }
    }

    const bookingV2Enabled = Boolean(businessId && await this.isBookingV2Enabled(businessId))
    const bookingV2Routing = bookingV2Enabled && businessId
      ? await conversationRouter.route(await conversationRouterContextService.load({
          businessId,
          conversationId: conversation.id,
          message,
          currentStep: conversation.currentStep,
          conversation
        }))
      : null

    if (conversation.currentStep === 'CANCEL_SELECT_APPOINTMENT') {
      return this.cancelAppointmentByMessage(input.phone, message)
    }

    if (conversation.currentStep === 'EDIT_SELECT_APPOINTMENT') {
      return this.editAppointmentByMessage(input.phone, message)
    }

    if (isMyAppointmentsMessage(message, conversation.currentStep)) {
      return this.buildMyAppointmentsReply(input.phone)
    }

    if (isCancelAppointmentMessage(message, conversation.currentStep)) {
      await this.updateConversation(input.phone, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, botCopyService.cancelAppointmentIntro())
    }

    if (isEditAppointmentMessage(message, conversation.currentStep)) {
      await this.updateConversation(input.phone, {
        currentStep: 'EDIT_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, botCopyService.editAppointmentIntro())
    }

    if (isHardResetMessage(message)) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_CUSTOMER_NAME',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        selectedCustomerName: null,
        misunderstandingCount: 0,
        lastAvailability: null,
        bookingV2State: null
      })

      return {
        reply: botCopyService.askInitialName()
      }
    }

    if (isResetMessage(message)) {
      await this.updateConversation(input.phone, {
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

    if (isHumanHandoffMessage(message)) {
      await this.updateConversation(input.phone, {
        currentStep: 'HUMAN_HANDOFF',
        aiEnabled: false,
        misunderstandingCount: 0,
        humanHandoffAt: new Date(),
        humanHandoffResolvedAt: null,
        bookingV2State: null
      })

      return {
        reply: botCopyService.humanHandoffQueued()
      }
    }

    if (isArrivalNoticeMessage(message) && isMenuStep(conversation.currentStep)) {
      return this.handleArrivalNotice(input.phone, message)
    }

    if (conversation.currentStep === 'HUMAN_HANDOFF') {
      return {
        reply: botCopyService.humanHandoffAlreadyQueued()
      }
    }

    if (
      conversation.currentStep === 'COMPLETED' &&
      isPostBookingClosingMessage(message)
    ) {
      return {
        reply: botCopyService.postBookingClosing(conversation.selectedCustomerName)
      }
    }

    if (
      conversation.currentStep === 'COMPLETED' &&
      isPostBookingGreetingMessage(message)
    ) {
      await this.updateConversation(input.phone, {
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
        reply: botCopyService.reopenAfterBooking(conversation.selectedCustomerName)
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
      await this.updateConversation(input.phone, {
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

  private async handleBookingV2(input: {
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
  }): Promise<HandleMessageResult> {
    const informationTopics = businessInformationTopicsFromRouting(input.routing)
    const informationReply = informationTopics.length
      ? await businessKnowledgeService.answer({
          businessId: input.businessId,
          topics: informationTopics
        })
      : null

    if (
      input.conversation.currentStep === 'CONFIRM' &&
      isPositiveBookingV2Confirmation(input.message) &&
      input.conversation.selectedCustomerName &&
      input.conversation.selectedServiceId &&
      input.conversation.selectedProfessionalId &&
      input.conversation.selectedDate &&
      input.conversation.selectedTime
    ) {
      const confirmation = await this.confirmBookingV2Appointment({
        phone: input.phone,
        conversation: {
          selectedCustomerName: input.conversation.selectedCustomerName,
          selectedServiceId: input.conversation.selectedServiceId,
          selectedProfessionalId: input.conversation.selectedProfessionalId,
          selectedDate: input.conversation.selectedDate,
          selectedTime: input.conversation.selectedTime
        }
      })

      return informationReply
        ? {
            ...confirmation,
            reply: `${informationReply}\n\n${confirmation.reply}`
          }
        : confirmation
    }

    if (informationReply && !input.routing.bookingMessage) {
      if (!isActiveBookingV2Step(input.conversation.currentStep)) {
        return {
          reply: `${informationReply}\n\nSi querés, también puedo ayudarte a reservar un turno.`,
          skipMisunderstandingTracking: true,
          skipHumanize: true
        }
      }

      const resumed = await bookingV2Engine.resume({
        businessId: input.businessId,
        conversation: input.conversation
      })

      return {
        reply: `${informationReply}\n\n${resumed.reply}`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    const result = await bookingV2Engine.process({
      businessId: input.businessId,
      conversation: input.conversation,
      message: input.routing.bookingMessage ?? input.message
    })

    await this.updateConversation(input.phone, {
      currentStep: conversationStepFromBookingV2Plan(result.plan),
      ...result.conversationPatch,
      lastAvailability: result.availabilityOptions.length
        ? {
            serviceId: result.state.draft.service,
            professionalId: result.state.draft.professional,
            date: result.state.draft.date,
            options: result.availabilityOptions
          }
        : null
    })

    return {
      reply: informationReply ? `${informationReply}\n\n${result.reply}` : result.reply,
      skipMisunderstandingTracking: true,
      skipHumanize: true
    }
  }

  private async confirmBookingV2Appointment(input: {
    phone: string
    conversation: {
      selectedCustomerName: string
      selectedServiceId: string
      selectedProfessionalId: string
      selectedDate: string
      selectedTime: string
    }
  }): Promise<HandleMessageResult> {
    const customer = await this.findOrCreateCustomer(input.phone, input.conversation.selectedCustomerName)
    const appointment = await bookingProvider.createAppointment({
      customerId: customer.id,
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      startAt: `${input.conversation.selectedDate}T${input.conversation.selectedTime}:00`
    })

    if (!appointment.ok) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_DATE',
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null,
        bookingV2State: null
      })

      return {
        reply: `No pude confirmar el turno: ${appointment.message}. Probemos con otro día u horario.`,
        skipMisunderstandingTracking: true,
        skipHumanize: true
      }
    }

    await this.updateConversation(input.phone, {
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

  private async humanizeResult(input: {
    result: HandleMessageResult
    message: string
  }): Promise<HandleMessageResult> {
    if (!canHumanizeSafely(input.result.reply)) {
      return input.result
    }

    const styledReply = await aiMessageUnderstandingService.humanizeReply({
      customerMessage: input.message,
      draftReply: input.result.reply,
      currentStep: 'UNKNOWN'
    })

    if (styledReply && !preservesRequiredLines(input.result.reply, styledReply)) {
      return input.result
    }

    if (styledReply && !preservesRequiredBotName(input.result.reply, styledReply)) {
      return input.result
    }

    return {
      reply: styledReply ?? input.result.reply
    }
  }

  private async trackMisunderstanding(phone: string, reply: string) {
    if (isMisunderstandingReply(reply)) {
      await prisma.conversation.update({
        where: {
          phone
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
        phone
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
      return this.buildMyAppointmentsReply(input.phone)
    }

    if (input.intent === 'cancel_appointment') {
      await this.updateConversation(input.phone, {
        currentStep: 'CANCEL_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, botCopyService.cancelAppointmentIntro())
    }

    if (input.intent === 'edit_appointment') {
      await this.updateConversation(input.phone, {
        currentStep: 'EDIT_SELECT_APPOINTMENT'
      })

      return this.buildMyAppointmentsReply(input.phone, botCopyService.editAppointmentIntro())
    }

    if (input.intent === 'reset_conversation') {
      await this.updateConversation(input.phone, {
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

  private async handleArrivalNotice(phone: string, message: string): Promise<HandleMessageResult> {
    const appointments = await this.findUpcomingAppointments(phone)
    const nextAppointment = appointments[0]

    if (!nextAppointment) {
      return {
        reply: botCopyService.arrivalNoticeNoAppointment()
      }
    }

    const delay = calculateArrivalDelayMinutes(message, nextAppointment.startAt)

    if (delay === null || delay > 5) {
      await this.updateConversation(phone, {
        currentStep: 'HUMAN_HANDOFF',
        aiEnabled: false,
        misunderstandingCount: 0,
        humanHandoffAt: new Date(),
        humanHandoffResolvedAt: null,
        bookingV2State: null
      })

      return {
        reply: botCopyService.lateArrivalHandoffQueued(),
        skipHumanize: true
      }
    }

    return {
      reply: botCopyService.arrivalNoticeOk(),
      skipHumanize: true
    }
  }

  private async buildMyAppointmentsReply(phone: string, prefix?: string): Promise<HandleMessageResult> {
    const appointments = await this.findUpcomingAppointments(phone)

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

  private async cancelAppointmentByMessage(phone: string, message: string): Promise<HandleMessageResult> {
    if (isResetMessage(message)) {
      const appointments = await this.findUpcomingAppointments(phone)

      await this.updateConversation(phone, {
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
      return this.buildMyAppointmentsReply(phone, 'No llegué a entender qué turno querés cancelar. Respondeme con el número de la lista, por ejemplo: 1, el 1 o cancelar el número 1.')
    }

    const appointments = await this.findUpcomingAppointments(phone)

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, 'No encontré ese número en la lista. Elegí uno de los turnos que te muestro, por ejemplo: 1 o el 1.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, {
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

  private async editAppointmentByMessage(phone: string, message: string): Promise<HandleMessageResult> {
    if (isResetMessage(message)) {
      const appointments = await this.findUpcomingAppointments(phone)

      await this.updateConversation(phone, {
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
      return this.buildMyAppointmentsReply(phone, 'No llegué a entender qué turno querés cambiar. Respondeme con el número de la lista, por ejemplo: 1, el 1 o cambiar el número 1.')
    }

    const appointments = await this.findUpcomingAppointments(phone)

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, 'No encontré ese número en la lista. Elegí uno de los turnos que te muestro, por ejemplo: 1 o el 1.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, {
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

  private async findUpcomingAppointments(phone: string) {
    return prisma.appointment.findMany({
      where: {
        customer: {
          phone
        },
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

  private async findOrCreateCustomer(phone: string, name: string) {
    const customer = await prisma.customer.findFirst({
      where: {
        phone
      }
    })

    if (customer) {
      return prisma.customer.update({
        where: {
          id: customer.id
        },
        data: {
          name
        }
      })
    }

    return prisma.customer.create({
      data: {
        phone,
        name
      }
    })
  }

  private async isBookingV2Enabled(businessId: string) {
    const settings = await prisma.businessFeatureSettings.findUnique({
      where: {
        businessId
      },
      select: {
        bookingV2Enabled: true
      }
    })

    return Boolean(settings?.bookingV2Enabled)
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
    data: {
      currentStep:
        | 'START'
        | 'ASK_SERVICE'
        | 'ASK_PROFESSIONAL'
        | 'ASK_DATE'
        | 'ASK_TIME'
        | 'CONFIRM'
        | 'ASK_CUSTOMER_NAME'
        | 'CANCEL_SELECT_APPOINTMENT'
        | 'EDIT_SELECT_APPOINTMENT'
        | 'HUMAN_HANDOFF'
        | 'COMPLETED'
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

    return prisma.conversation.update({
      where: {
        phone
      },
      data: dataToUpdate
    })
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
  if (plan.type === 'confirm_booking') return 'CONFIRM'
  if (plan.type === 'confirm_field' || plan.type === 'confirm_correction') {
    return stepForBookingV2Field(plan.field)
  }
  return stepForBookingV2Field(plan.field)
}

function stepForBookingV2Field(field: BookingField) {
  if (field === 'name') return 'ASK_CUSTOMER_NAME'
  if (field === 'service') return 'ASK_SERVICE'
  if (field === 'professional') return 'ASK_PROFESSIONAL'
  if (field === 'date') return 'ASK_DATE'
  return 'ASK_TIME'
}

export function isPositiveBookingV2Confirmation(message: string) {
  const normalizedMessage = normalizeText(message)
  const exactConfirmations = [
    'si',
    'dale',
    'ok',
    'okey',
    'okay',
    'correcto',
    'confirmo',
    'confirmar',
    'confirmalo',
    'esta bien',
    'exacto',
    'listo',
    'perfecto',
    'quedamos asi',
    'asi esta bien',
    'okey perfecto quedamos asi'
  ]

  if (exactConfirmations.includes(normalizedMessage)) return true
  return /\b(confirmo|confirmar|confirmalo)\b/.test(normalizedMessage)
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

function isExpiredInProgressConversation(currentStep: string, updatedAt: Date) {
  if (currentStep === 'START' || currentStep === 'COMPLETED' || currentStep === 'HUMAN_HANDOFF') {
    return false
  }

  const expirationMs = 24 * 60 * 60 * 1000

  return Date.now() - updatedAt.getTime() >= expirationMs
}

function isHumanHandoffMessage(message: string) {
  const normalizedMessage = normalizeText(message)
  const exactMessages = [
    'persona',
    'humano',
    'operador',
    'asesor',
    'recepcion',
    'recepcionista'
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
    'pasame con alguien'
  ].some((phrase) => normalizedMessage.includes(phrase))
}

function isMyAppointmentsMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '2') ||
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

function isCancelAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '3') ||
    normalizedMessage === 'cancelar turno' ||
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

function isEditAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '4') ||
    normalizedMessage === 'editar turno' ||
    normalizedMessage === 'modificar turno' ||
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
  const normalizedMessage = normalizeText(message)

  if (isBookingStartMessage(message, 'START')) {
    return false
  }

  return [
    'hola',
    'holaa',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'hola como estas',
    'hola como estas?',
    'como estas',
    'como va',
    'que tal',
    'todo bien'
  ].includes(normalizedMessage) ||
    [
      'hola cami',
      'hola como estas',
      'como estas',
      'como va',
      'que tal'
    ].some((phrase) => normalizedMessage.includes(phrase))
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
    /avis[eÃ©]/i,
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
        line.startsWith('• ') ||
        line.startsWith('â€¢ ')
    })

  return requiredLines.every((line) => styledReply.includes(line))
}

function preservesRequiredBotName(originalReply: string, styledReply: string) {
  const originalHasBotName = originalReply.includes('Cami')
  const styledHasBotName = styledReply.includes('Cami')

  return originalHasBotName === styledHasBotName
}
