import { prisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { BookingConversationFlow, isBookingStartMessage, isMenuStep } from './booking-conversation-flow.js'
import { BotCopyService } from './bot-copy-service.js'
import { normalizeText } from './message-understanding-service.js'

const bookingConversationFlow = new BookingConversationFlow()
const bookingProvider = new InternalBookingProvider()
const botCopyService = new BotCopyService()

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
    const message = input.message.trim()
    const businessId = await this.resolveBusinessId(input.businessId)

    const conversation = await prisma.conversation.upsert({
      where: {
        phone: input.phone
      },
      update: {
        lastMessage: message,
        businessId
      },
      create: {
        phone: input.phone,
        lastMessage: message,
        businessId
      }
    })

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

    if (conversation.currentStep === 'CANCEL_SELECT_APPOINTMENT') {
      return this.cancelAppointmentByMessage(input.phone, message)
    }

    if (conversation.currentStep === 'EDIT_SELECT_APPOINTMENT') {
      return this.editAppointmentByMessage(input.phone, message)
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

  private async buildMyAppointmentsReply(phone: string, prefix?: string): Promise<HandleMessageResult> {
    const appointments = await prisma.appointment.findMany({
      where: {
        customer: {
          phone
        },
        status: {
          not: 'CANCELLED'
        }
      },
      include: {
        service: true,
        professional: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })

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
    const selectedOption = Number(message)

    if (!Number.isInteger(selectedOption) || selectedOption < 1) {
      return this.buildMyAppointmentsReply(phone, 'Decime el numero del turno que queres cancelar y lo hago por vos.')
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        customer: {
          phone
        },
        status: {
          not: 'CANCELLED'
        }
      },
      include: {
        service: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, 'No encontre ese turno en la lista. Elegi una de las opciones que te muestro.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, {
      currentStep: 'COMPLETED'
    })

    return {
      reply: botCopyService.cancelConfirmed({
        serviceName: appointment.service.name,
        date: formatDate(appointment.startAt),
        time: formatTime(appointment.startAt)
      })
    }
  }

  private async editAppointmentByMessage(phone: string, message: string): Promise<HandleMessageResult> {
    const selectedOption = Number(message)

    if (!Number.isInteger(selectedOption) || selectedOption < 1) {
      return this.buildMyAppointmentsReply(phone, 'Decime el numero del turno que queres editar y lo cambiamos.')
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        customer: {
          phone
        },
        status: {
          not: 'CANCELLED'
        }
      },
      include: {
        service: true
      },
      orderBy: {
        startAt: 'asc'
      }
    })

    const appointment = appointments[selectedOption - 1]

    if (!appointment) {
      return this.buildMyAppointmentsReply(phone, 'No encontre ese turno en la lista. Elegi una de las opciones que te muestro.')
    }

    await bookingProvider.cancelAppointment(appointment.id)

    await this.updateConversation(phone, {
      currentStep: 'START',
      selectedServiceId: null,
      selectedProfessionalId: null,
      selectedDate: null,
      selectedTime: null,
      lastAvailability: null
    })

    return {
      reply: [
        botCopyService.editNotImplementedYet(),
        'Escribi quiero un turno y buscamos un nuevo horario.'
      ].join('\n')
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
    return prisma.conversation.update({
      where: {
        phone
      },
      data
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

function isMyAppointmentsMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '2') || normalizedMessage === 'mis turnos'
}

function isCancelAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '3') || normalizedMessage === 'cancelar turno'
}

function isEditAppointmentMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (isMenuStep(currentStep) && normalizedMessage === '4') || normalizedMessage === 'editar turno'
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}
