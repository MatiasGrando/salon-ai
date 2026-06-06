import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { AiMessageUnderstandingService, type AiConversationIntent } from './ai-message-understanding-service.js'
import { BookingConversationFlow, isBookingStartMessage, isMenuStep } from './booking-conversation-flow.js'
import { BotCopyService } from './bot-copy-service.js'
import { normalizeText } from './message-understanding-service.js'

const bookingConversationFlow = new BookingConversationFlow()
const bookingProvider = new InternalBookingProvider()
const botCopyService = new BotCopyService()
const aiMessageUnderstandingService = new AiMessageUnderstandingService()

type HandleMessageInput = {
  phone: string
  message: string
  businessId?: string
}

type HandleMessageResult = {
  reply: string
}

export class ConversationService {
  async handleMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const result = await this.handleMessageCore(input)

    return this.humanizeResult({
      result,
      message: input.message.trim()
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
                currentStep: 'START',
                selectedServiceId: null,
                selectedProfessionalId: null,
                selectedDate: null,
                selectedTime: null,
                selectedCustomerName: null,
                lastAvailability: Prisma.JsonNull
              }
            : {
                lastMessage: message,
                businessId
              }
        })
      : await prisma.conversation.create({
          data: {
            phone: input.phone,
            lastMessage: message,
            businessId
          }
        })

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
        lastAvailability: null
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
        lastAvailability: null
      })

      return {
        reply: botCopyService.resetDone()
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
        lastAvailability: null
      })

      return {
        reply: botCopyService.reopenAfterBooking(conversation.selectedCustomerName)
      }
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

  private async tryHandleOrchestratedIntent(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: {
      currentStep: string
      selectedCustomerName: string | null
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
          lastMessage: input.message
        }
      })
    }

    return null
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
          not: 'CANCELLED'
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
        | 'ASK_CUSTOMER_NAME'
        | 'CANCEL_SELECT_APPOINTMENT'
        | 'EDIT_SELECT_APPOINTMENT'
        | 'COMPLETED'
      selectedServiceId?: string | null
      selectedProfessionalId?: string | null
      selectedDate?: string | null
      selectedTime?: string | null
      selectedCustomerName?: string | null
      lastAvailability?: unknown
    }
  ) {
    const { lastAvailability, ...rest } = data
    const dataToUpdate = lastAvailability === undefined
      ? rest
      : {
          ...rest,
          lastAvailability: lastAvailability === null
            ? Prisma.JsonNull
            : lastAvailability as Prisma.InputJsonValue
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

function isExpiredInProgressConversation(currentStep: string, updatedAt: Date) {
  if (currentStep === 'START' || currentStep === 'COMPLETED') {
    return false
  }

  const expirationMs = 24 * 60 * 60 * 1000

  return Date.now() - updatedAt.getTime() >= expirationMs
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

function isCancelAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '3') ||
    normalizedMessage === 'cancelar turno' ||
    normalizedMessage.includes('cancelar un turno') ||
    normalizedMessage.includes('cancelar mi turno') ||
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
    normalizedMessage.includes('cambiar un turno') ||
    normalizedMessage.includes('cambiar mi turno') ||
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
    /cancel[eé] ese turno/i,
    /empezamos de nuevo/i
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
  return !originalReply.includes('Cami') || styledReply.includes('Cami')
}
