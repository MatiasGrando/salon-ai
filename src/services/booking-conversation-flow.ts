import { prisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { BotCopyService, getFirstName } from './bot-copy-service.js'
import { MessageUnderstandingService, normalizeText } from './message-understanding-service.js'

const bookingProvider = new InternalBookingProvider()
const botCopyService = new BotCopyService()
const messageUnderstandingService = new MessageUnderstandingService()

type ConversationState = {
  phone: string
  currentStep: string
  selectedServiceId: string | null
  selectedProfessionalId: string | null
  selectedDate: string | null
  selectedTime: string | null
  selectedCustomerName: string | null
  lastAvailability: unknown
}

type HandleBookingInput = {
  phone: string
  message: string
  businessId: string | null
  conversation: ConversationState
}

type HandleBookingResult = {
  reply: string
}

type AvailabilityOption = {
  time: string
  professionalId: string
  professionalName: string
}

export class BookingConversationFlow {
  async handle(input: HandleBookingInput): Promise<HandleBookingResult> {
    const { phone, message, businessId, conversation } = input

    if (isChangeServiceMessage(message)) {
      await this.updateConversation(phone, {
        currentStep: 'ASK_SERVICE',
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      return this.buildServicesReply('Dale, cambiamos el servicio.', businessId)
    }

    if (isChangeProfessionalMessage(message)) {
      if (!conversation.selectedServiceId) {
        await this.restartBooking(phone)

        return this.buildServicesReply('Primero necesito que elijamos el servicio.', businessId)
      }

      const selectedService = await prisma.service.findUnique({
        where: {
          id: conversation.selectedServiceId
        }
      })

      if (!selectedService) {
        await this.restartBooking(phone)

        return this.buildServicesReply('Ese servicio ya no aparece disponible. Elegimos otro?', businessId)
      }

      await this.updateConversation(phone, {
        currentStep: 'ASK_PROFESSIONAL',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      return this.buildProfessionalsReply(selectedService.businessId, 'Dale, cambiamos el profesional.')
    }

    if (isChangeDateMessage(message)) {
      await this.updateConversation(phone, {
        currentStep: 'ASK_DATE',
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      return {
        reply: botCopyService.askDate('el profesional seleccionado')
      }
    }

    if (isChangeTimeMessage(message)) {
      if (!conversation.selectedServiceId || !conversation.selectedDate) {
        await this.updateConversation(phone, {
          currentStep: 'ASK_DATE',
          selectedDate: null,
          selectedTime: null,
          lastAvailability: null
        })

        return {
          reply: botCopyService.askDate('el profesional seleccionado')
        }
      }

      const availability = await this.findAvailabilityOptions({
        professionalId: conversation.selectedProfessionalId,
        serviceId: conversation.selectedServiceId,
        date: conversation.selectedDate
      })

      if (!availability.ok) {
        return {
          reply: availability.message
        }
      }

      if (availability.options.length === 0) {
        return {
          reply: botCopyService.noAvailabilityForDate()
        }
      }

      await this.updateConversation(phone, {
        currentStep: 'ASK_TIME',
        selectedTime: null,
        lastAvailability: {
          serviceId: conversation.selectedServiceId,
          professionalId: conversation.selectedProfessionalId,
          date: conversation.selectedDate,
          options: availability.options
        }
      })

      return {
        reply: botCopyService.availability({
          slots: availability.options.map(formatAvailabilityOption),
          prefix: 'Dale, cambiamos el horario.'
        })
      }
    }

    if (conversation.currentStep === 'START' || isBookingStartMessage(message, conversation.currentStep)) {
      return this.startBooking({ phone, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_SERVICE') {
      return this.handleServiceStep({ phone, message, businessId })
    }

    if (conversation.currentStep === 'ASK_PROFESSIONAL') {
      return this.handleProfessionalStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_DATE') {
      return this.handleDateStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_TIME') {
      return this.handleTimeStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_CUSTOMER_NAME') {
      return this.handleCustomerNameStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'CONFIRM') {
      return this.handleConfirmStep({ phone, message, businessId, conversation })
    }

    await this.updateConversation(phone, {
      currentStep: 'START'
    })

    return {
      reply: botCopyService.mainMenu(null)
    }
  }

  private async startBooking(input: {
    phone: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (!input.conversation.selectedCustomerName) {
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

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_SERVICE',
      selectedServiceId: null,
      selectedProfessionalId: null,
      selectedDate: null,
      selectedTime: null,
      lastAvailability: null
    })

    return this.buildServicesReply(`Hola ${getFirstName(input.conversation.selectedCustomerName)}.`, input.businessId)
  }

  private async handleServiceStep(input: {
    phone: string
    message: string
    businessId: string | null
  }) {
    const selectedService = await this.findServiceByMessage(input.message, input.businessId)

    if (!selectedService) {
      return this.buildServicesReply(botCopyService.serviceNotFound(), input.businessId)
    }

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_PROFESSIONAL',
      selectedServiceId: selectedService.id
    })

    return this.buildProfessionalsReply(selectedService.businessId, `Perfecto, elegiste ${selectedService.name}.`)
  }

  private async handleProfessionalStep(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (!input.conversation.selectedServiceId) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Primero necesito que elijamos el servicio.', input.businessId)
    }

    const selectedService = await prisma.service.findUnique({
      where: {
        id: input.conversation.selectedServiceId
      }
    })

    if (!selectedService) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Ese servicio ya no aparece disponible. Elegimos otro?', input.businessId)
    }

    if (messageUnderstandingService.isAnyProfessionalMessage(input.message)) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_DATE',
        selectedProfessionalId: null
      })

      return {
        reply: botCopyService.askDate('cualquier profesional')
      }
    }

    const selectedProfessional = await this.findProfessionalByMessage(input.message, selectedService.businessId)

    if (!selectedProfessional) {
      return this.buildProfessionalsReply(selectedService.businessId, botCopyService.professionalNotFound())
    }

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_DATE',
      selectedProfessionalId: selectedProfessional.id
    })

    return {
      reply: botCopyService.askDate(selectedProfessional.name)
    }
  }

  private async handleDateStep(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (!input.conversation.selectedServiceId) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Me falta confirmar el servicio, asi que volvemos un paso y lo elegimos bien.', input.businessId)
    }

    const selectedDate = messageUnderstandingService.parseDate(input.message)

    if (!selectedDate) {
      return {
        reply: botCopyService.dateNotUnderstood()
      }
    }

    const availability = await this.findAvailabilityOptions({
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      date: selectedDate
    })

    if (!availability.ok) {
      return {
        reply: availability.message
      }
    }

    if (availability.options.length === 0) {
      return {
        reply: botCopyService.noAvailabilityForDate()
      }
    }

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_TIME',
      selectedDate,
      lastAvailability: {
        serviceId: input.conversation.selectedServiceId,
        professionalId: input.conversation.selectedProfessionalId,
        date: selectedDate,
        options: availability.options
      }
    })

    return {
      reply: botCopyService.availability({
        slots: availability.options.map(formatAvailabilityOption)
      })
    }
  }

  private async handleTimeStep(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (!input.conversation.selectedServiceId || !input.conversation.selectedDate) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Me falta confirmar servicio y fecha, asi que volvemos un paso y lo ordenamos.', input.businessId)
    }

    const selectedAvailability = await this.findAvailableTimeByMessage({
      message: input.message,
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      date: input.conversation.selectedDate
    })

    if (!selectedAvailability) {
      const availability = await this.findAvailabilityOptions({
        professionalId: input.conversation.selectedProfessionalId,
        serviceId: input.conversation.selectedServiceId,
        date: input.conversation.selectedDate
      })

      if (!availability.ok) {
        return {
          reply: availability.message
        }
      }

      return {
        reply: botCopyService.availability({
          slots: availability.options.map(formatAvailabilityOption),
          prefix: 'No encontre ese horario entre las opciones. Elegi uno de estos horarios disponibles.'
        })
      }
    }

    if (input.conversation.selectedCustomerName) {
      await this.updateConversation(input.phone, {
        currentStep: 'CONFIRM',
        selectedTime: selectedAvailability.time,
        selectedProfessionalId: selectedAvailability.professionalId
      })

      return this.buildConfirmationReply({
        selectedServiceId: input.conversation.selectedServiceId,
        selectedProfessionalId: selectedAvailability.professionalId,
        selectedDate: input.conversation.selectedDate,
        selectedTime: selectedAvailability.time,
        selectedCustomerName: input.conversation.selectedCustomerName
      })
    }

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_CUSTOMER_NAME',
      selectedTime: selectedAvailability.time,
      selectedProfessionalId: selectedAvailability.professionalId
    })

    return {
      reply: botCopyService.askCustomerName()
    }
  }

  private async handleCustomerNameStep(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (
      !input.conversation.selectedServiceId &&
      !input.conversation.selectedProfessionalId &&
      !input.conversation.selectedDate &&
      !input.conversation.selectedTime
    ) {
      if (input.message.length < 2) {
        return {
          reply: botCopyService.askCustomerNameAgain()
        }
      }

      await this.updateConversation(input.phone, {
        currentStep: 'ASK_SERVICE',
        selectedCustomerName: input.message
      })

      return this.buildServicesReply(`Gracias, ${getFirstName(input.message)}.`, input.businessId)
    }

    if (
      !input.conversation.selectedServiceId ||
      !input.conversation.selectedProfessionalId ||
      !input.conversation.selectedDate ||
      !input.conversation.selectedTime
    ) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Me faltan algunos datos del turno, asi que volvemos un paso y lo armamos bien.', input.businessId)
    }

    if (input.message.length < 2) {
      return {
        reply: botCopyService.askFullCustomerName()
      }
    }

    await this.updateConversation(input.phone, {
      currentStep: 'CONFIRM',
      selectedCustomerName: input.message
    })

    return this.buildConfirmationReply({
      selectedServiceId: input.conversation.selectedServiceId,
      selectedProfessionalId: input.conversation.selectedProfessionalId,
      selectedDate: input.conversation.selectedDate,
      selectedTime: input.conversation.selectedTime,
      selectedCustomerName: input.message
    })
  }

  private async handleConfirmStep(input: {
    phone: string
    message: string
    businessId: string | null
    conversation: ConversationState
  }) {
    if (normalizeText(input.message) !== 'confirmar') {
      return {
        reply: botCopyService.askConfirm()
      }
    }

    if (
      !input.conversation.selectedServiceId ||
      !input.conversation.selectedProfessionalId ||
      !input.conversation.selectedDate ||
      !input.conversation.selectedTime ||
      !input.conversation.selectedCustomerName
    ) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Me faltan datos para confirmar el turno. Volvemos un paso y lo dejamos bien.', input.businessId)
    }

    const customer = await this.findOrCreateCustomer(input.phone, input.conversation.selectedCustomerName)
    const appointment = await bookingProvider.createAppointment({
      customerId: customer.id,
      professionalId: input.conversation.selectedProfessionalId,
      serviceId: input.conversation.selectedServiceId,
      startAt: buildStartAt(input.conversation.selectedDate, input.conversation.selectedTime)
    })

    if (!appointment.ok) {
        await this.updateConversation(input.phone, {
          currentStep: 'ASK_DATE',
          selectedDate: null,
          selectedTime: null,
          lastAvailability: null
        })

      return {
        reply: botCopyService.appointmentFailed(appointment.message)
      }
    }

    await this.updateConversation(input.phone, {
      currentStep: 'COMPLETED'
    })

    return {
      reply: botCopyService.appointmentConfirmed({
        customerName: input.conversation.selectedCustomerName,
        date: input.conversation.selectedDate,
        time: input.conversation.selectedTime
      })
    }
  }

  private async buildServicesReply(prefix?: string, businessId?: string | null): Promise<HandleBookingResult> {
    const services = await prisma.service.findMany({
      where: {
        businessId: businessId ?? undefined
      },
      include: {
        aliases: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    if (services.length === 0) {
      return {
        reply: botCopyService.noServices()
      }
    }

    return {
      reply: botCopyService.servicesList({
        prefix,
        services
      })
    }
  }

  private async buildProfessionalsReply(businessId: string, prefix?: string): Promise<HandleBookingResult> {
    const professionals = await prisma.professional.findMany({
      where: {
        businessId
      },
      orderBy: {
        name: 'asc'
      }
    })

    if (professionals.length === 0) {
      return {
        reply: botCopyService.noProfessionals()
      }
    }

    return {
      reply: botCopyService.professionalsList({
        prefix,
        professionals
      })
    }
  }

  private async buildConfirmationReply(input: {
    selectedServiceId: string
    selectedProfessionalId: string
    selectedDate: string
    selectedTime: string
    selectedCustomerName: string
  }): Promise<HandleBookingResult> {
    const [service, professional] = await Promise.all([
      prisma.service.findUnique({
        where: {
          id: input.selectedServiceId
        }
      }),
      prisma.professional.findUnique({
        where: {
          id: input.selectedProfessionalId
        }
      })
    ])

    return {
      reply: botCopyService.confirmation({
        customerName: input.selectedCustomerName,
        serviceName: service?.name ?? 'Servicio seleccionado',
        professionalName: professional?.name ?? 'Profesional seleccionado',
        date: input.selectedDate,
        time: input.selectedTime
      })
    }
  }

  private async findServiceByMessage(message: string, businessId?: string | null) {
    const services = await prisma.service.findMany({
      where: {
        businessId: businessId ?? undefined
      },
      include: {
        aliases: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    return messageUnderstandingService.findOptionByMessage(message, services)
  }

  private async findProfessionalByMessage(message: string, businessId: string) {
    const professionals = await prisma.professional.findMany({
      where: {
        businessId
      },
      orderBy: {
        name: 'asc'
      }
    })

    return messageUnderstandingService.findOptionByMessage(message, professionals)
  }

  private async findAvailabilityOptions(input: {
    professionalId: string | null
    serviceId: string
    date: string
  }): Promise<
    | { ok: true; options: AvailabilityOption[] }
    | { ok: false; message: string }
  > {
    if (input.professionalId) {
      const professional = await prisma.professional.findUnique({
        where: {
          id: input.professionalId
        }
      })

      if (!professional) {
        return {
          ok: false,
          message: 'Profesional no encontrado'
        }
      }

      const availability = await bookingProvider.getAvailability({
        professionalId: input.professionalId,
        serviceId: input.serviceId,
        date: input.date
      })

      if (!availability.ok) {
        return {
          ok: false,
          message: availability.message
        }
      }

      return {
        ok: true,
        options: availability.slots.map((time) => ({
          time,
          professionalId: professional.id,
          professionalName: professional.name
        }))
      }
    }

    const service = await prisma.service.findUnique({
      where: {
        id: input.serviceId
      }
    })

    if (!service) {
      return {
        ok: false,
        message: 'Servicio no encontrado'
      }
    }

    const professionals = await prisma.professional.findMany({
      where: {
        businessId: service.businessId
      },
      orderBy: {
        name: 'asc'
      }
    })

    const options: AvailabilityOption[] = []

    for (const professional of professionals) {
      const availability = await bookingProvider.getAvailability({
        professionalId: professional.id,
        serviceId: input.serviceId,
        date: input.date
      })

      if (!availability.ok) {
        continue
      }

      options.push(...availability.slots.map((time) => ({
        time,
        professionalId: professional.id,
        professionalName: professional.name
      })))
    }

    return {
      ok: true,
      options: options.sort((a, b) => {
        return a.time.localeCompare(b.time) || a.professionalName.localeCompare(b.professionalName)
      })
    }
  }

  private async findAvailableTimeByMessage(input: {
    message: string
    professionalId: string | null
    serviceId: string
    date: string
  }) {
    const availability = await this.findAvailabilityOptions(input)

    if (!availability.ok) {
      return null
    }

    const selectedOption = Number(input.message)

    if (Number.isInteger(selectedOption) && selectedOption >= 1) {
      return availability.options[selectedOption - 1] ?? null
    }

    const normalizedMessage = normalizeText(input.message)

    if (normalizedMessage === 'primero' || normalizedMessage === 'el primero') {
      return availability.options[0] ?? null
    }

    if (normalizedMessage === 'ultimo' || normalizedMessage === 'el ultimo') {
      return availability.options[availability.options.length - 1] ?? null
    }

    const parsedTime = messageUnderstandingService.parseTime(input.message)

    if (!parsedTime) {
      return null
    }

    return availability.options.find((option) => option.time === parsedTime) ?? null
  }

  private async findOrCreateCustomer(phone: string, name: string) {
    const customer = await prisma.customer.findFirst({
      where: {
        phone
      }
    })

    if (customer) {
      return customer
    }

    return prisma.customer.create({
      data: {
        name,
        phone
      }
    })
  }

  private async restartBooking(phone: string) {
    return this.updateConversation(phone, {
      currentStep: 'ASK_SERVICE',
      selectedServiceId: null,
      selectedProfessionalId: null,
      selectedDate: null,
      selectedTime: null,
      lastAvailability: null
    })
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
        | 'ASK_CUSTOMER_NAME'
        | 'CONFIRM'
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

export function isBookingStartMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)

  return (
    (isMenuStep(currentStep) && normalizedMessage === '1') ||
    normalizedMessage === 'reservar' ||
    normalizedMessage === 'reservar turno' ||
    normalizedMessage === 'quiero un turno' ||
    normalizedMessage === 'sacar turno' ||
    normalizedMessage.includes('turno')
  )
}

export function isMenuStep(currentStep: string) {
  return currentStep === 'START' || currentStep === 'COMPLETED'
}

function isChangeServiceMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return normalizedMessage === 'cambiar servicio' || normalizedMessage === 'otro servicio'
}

function isChangeProfessionalMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return normalizedMessage === 'cambiar profesional' || normalizedMessage === 'otro profesional'
}

function isChangeDateMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return normalizedMessage === 'cambiar fecha' || normalizedMessage === 'otra fecha'
}

function isChangeTimeMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return normalizedMessage === 'cambiar horario' || normalizedMessage === 'otro horario'
}

function formatAvailabilityOption(option: AvailabilityOption) {
  return `${option.time} con ${option.professionalName}`
}

function buildStartAt(date: string, time: string) {
  return `${date}T${time}:00`
}
