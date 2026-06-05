import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import { AiMessageUnderstandingService, type AiBookingIntentResult } from './ai-message-understanding-service.js'
import { BotCopyService, getFirstName } from './bot-copy-service.js'
import { MessageUnderstandingService, normalizeText } from './message-understanding-service.js'

const bookingProvider = new InternalBookingProvider()
const botCopyService = new BotCopyService()
const messageUnderstandingService = new MessageUnderstandingService()
const aiMessageUnderstandingService = new AiMessageUnderstandingService()

type ConversationState = {
  phone: string
  currentStep: string
  selectedServiceId: string | null
  selectedProfessionalId: string | null
  selectedDate: string | null
  selectedTime: string | null
  selectedCustomerName: string | null
  lastAvailability: unknown
  lastMessage: string | null
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

type LastAvailabilityState = {
  serviceId: string
  professionalId: string | null
  date: string
  options: AvailabilityOption[]
}

type TimePreference = NonNullable<AiBookingIntentResult['timePreference']>

type BookingDraft = {
  serviceId: string | null
  serviceName: string | null
  serviceBusinessId: string | null
  professionalId: string | null
  professionalName: string | null
  date: string | null
  time: string | null
  timePreference: TimePreference | null
  afterTime: string | null
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
          slots: formatAvailabilitySlots(availability.options),
          professionalName: getSharedProfessionalName(availability.options),
          prefix: 'Dale, cambiamos el horario.'
        })
      }
    }

    if (
      conversation.currentStep === 'START' &&
      conversation.selectedCustomerName &&
      isBookingStartMessage(message, conversation.currentStep)
    ) {
      return this.handleServiceStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'START' || isBookingStartMessage(message, conversation.currentStep)) {
      return this.startBooking({ phone, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_SERVICE') {
      const humanQuestionReply = this.replyToHumanQuestion(message)

      if (humanQuestionReply) {
        return humanQuestionReply
      }

      if (isClearlyOffBookingFlowMessage(message)) {
        return this.buildServicesReply(botCopyService.bookingOnly(), businessId)
      }

      return this.handleServiceStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_PROFESSIONAL') {
      const humanQuestionReply = this.replyToHumanQuestion(message)

      if (humanQuestionReply) {
        return humanQuestionReply
      }

      if (isClearlyOffBookingFlowMessage(message)) {
        const service = conversation.selectedServiceId
          ? await prisma.service.findUnique({
              where: {
                id: conversation.selectedServiceId
              }
            })
          : null

        if (service) {
          return this.buildProfessionalsReply(service.businessId, botCopyService.bookingOnly())
        }
      }

      return this.handleProfessionalStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_DATE') {
      const humanQuestionReply = this.replyToHumanQuestion(message)

      if (humanQuestionReply) {
        return humanQuestionReply
      }

      if (isClearlyOffBookingFlowMessage(message)) {
        return {
          reply: [
            botCopyService.bookingOnly(),
            botCopyService.askDate(await this.findProfessionalName(conversation.selectedProfessionalId) ?? 'el profesional seleccionado')
          ].join('\n\n')
        }
      }

      return this.handleDateStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_TIME') {
      const humanQuestionReply = this.replyToHumanQuestion(message)

      if (humanQuestionReply) {
        return humanQuestionReply
      }

      if (isClearlyOffBookingFlowMessage(message)) {
        const options = readLastAvailabilityOptions(conversation.lastAvailability)

        if (options) {
          return {
            reply: botCopyService.availability({
              slots: formatAvailabilitySlots(options),
              professionalName: getSharedProfessionalName(options),
              prefix: botCopyService.bookingOnly()
            })
          }
        }
      }

      return this.handleTimeStep({ phone, message, businessId, conversation })
    }

    if (conversation.currentStep === 'ASK_CUSTOMER_NAME') {
      const humanQuestionReply = this.replyToHumanQuestion(message)

      if (humanQuestionReply) {
        return {
          reply: [
            humanQuestionReply.reply,
            '',
            'Y vos, como te llamas?'
          ].join('\n')
        }
      }

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
      const customerIntro = await this.extractCustomerIntroFromMessage(input.conversation.lastMessage?.toString() ?? '')

      if (customerIntro?.name) {
        await this.updateConversation(input.phone, {
          currentStep: 'ASK_SERVICE',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          selectedCustomerName: customerIntro.name,
          lastAvailability: null
        })

        if (customerIntro.wantsBooking && customerIntro.remainingMessage) {
          const bookingIntentReply = await this.tryHandleBookingIntent({
            phone: input.phone,
            message: customerIntro.remainingMessage,
            businessId: input.businessId
          })

          if (bookingIntentReply) {
            return {
              reply: [
                `Un gusto, ${getFirstName(customerIntro.name)}.`,
                bookingIntentReply.reply
              ].join('\n')
            }
          }
        }

        return this.buildServicesReply(`Gracias, ${getFirstName(customerIntro.name)}.`, input.businessId)
      }

      const bookingDraft = await this.extractBookingDraft({
        message: input.conversation.lastMessage?.toString() ?? '',
        businessId: input.businessId
      })

      if (bookingDraft) {
        await this.updateConversation(input.phone, {
          currentStep: 'ASK_CUSTOMER_NAME',
          selectedServiceId: bookingDraft.serviceId,
          selectedProfessionalId: bookingDraft.professionalId,
          selectedDate: bookingDraft.date,
          selectedTime: bookingDraft.time,
          lastAvailability: null
        })

        return {
          reply: [
            'Dale, te ayudo con ese turno.',
            'Antes de reservarlo, como te llamas?'
          ].join('\n')
        }
      }

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
    conversation?: ConversationState
  }) {
    const bookingIntentReply = await this.tryHandleBookingIntent({
      phone: input.phone,
      message: input.message,
      businessId: input.businessId
    })

    if (bookingIntentReply) {
      return bookingIntentReply
    }

    const selectedService = await this.findServiceByMessage(input.message, input.businessId)

    if (!selectedService) {
      return this.buildServicesReply(botCopyService.serviceNotFound(), input.businessId)
    }

    const selectedDateFromMessage = messageUnderstandingService.parseDate(input.message)
      ?? await aiMessageUnderstandingService.parseDate(input.message)
    const selectedTimeFromMessage = parseAfterTimeFromMessage(input.message)
      ? null
      : messageUnderstandingService.parseTime(input.message)
        ?? await aiMessageUnderstandingService.parseTime(input.message)
    const timePreferenceFromMessage = parseTimePreferenceFromMessage(input.message)
    const afterTimeFromMessage = parseAfterTimeFromMessage(input.message)

    if (input.conversation?.selectedProfessionalId && input.conversation.selectedDate) {
      const professionalName = await this.findProfessionalName(input.conversation.selectedProfessionalId)

      return this.buildAvailabilityReply({
        phone: input.phone,
        serviceId: selectedService.id,
        professionalId: input.conversation.selectedProfessionalId,
        date: input.conversation.selectedDate,
        time: input.conversation.selectedTime,
        afterTime: parseAfterTimeFromMessage(input.conversation.lastMessage ?? ''),
        timePreference: parseTimePreferenceFromMessage(input.conversation.lastMessage ?? ''),
        prefix: buildIntentAvailabilityPrefix({
          serviceName: selectedService.name,
          ...(professionalName ? { professionalName } : {}),
          date: input.conversation.selectedDate,
          timePreference: parseTimePreferenceFromMessage(input.conversation.lastMessage ?? '')
        })
      })
    }

    if (input.conversation?.selectedProfessionalId && selectedDateFromMessage) {
      const professionalName = await this.findProfessionalName(input.conversation.selectedProfessionalId)

      return this.buildAvailabilityReply({
        phone: input.phone,
        serviceId: selectedService.id,
        professionalId: input.conversation.selectedProfessionalId,
        date: selectedDateFromMessage,
        time: selectedTimeFromMessage,
        afterTime: afterTimeFromMessage,
        timePreference: timePreferenceFromMessage,
        prefix: buildIntentAvailabilityPrefix({
          serviceName: selectedService.name,
          ...(professionalName ? { professionalName } : {}),
          date: selectedDateFromMessage,
          timePreference: timePreferenceFromMessage
        })
      })
    }

    if (input.conversation?.selectedProfessionalId) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_DATE',
        selectedServiceId: selectedService.id,
        selectedProfessionalId: input.conversation.selectedProfessionalId,
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      return {
        reply: botCopyService.askDate(await this.findProfessionalName(input.conversation.selectedProfessionalId) ?? 'el profesional seleccionado')
      }
    }

    if (selectedDateFromMessage) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_PROFESSIONAL',
        selectedServiceId: selectedService.id,
        selectedProfessionalId: null,
        selectedDate: selectedDateFromMessage,
        selectedTime: selectedTimeFromMessage,
        lastAvailability: null
      })

      return this.buildProfessionalsReply(
        selectedService.businessId,
        `Dale, hacemos ${selectedService.name} para ${selectedDateFromMessage}.`
      )
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
      },
      include: {
        aliases: true
      }
    })

    if (!selectedService) {
      await this.restartBooking(input.phone)

      return this.buildServicesReply('Ese servicio ya no aparece disponible. Elegimos otro?', input.businessId)
    }

    if (messageUnderstandingService.isAnyProfessionalMessage(input.message)) {
      const messageIntent = await this.extractIntentForSelectedService({
        message: input.message,
        service: selectedService,
        businessId: selectedService.businessId
      })

      await this.updateConversation(input.phone, {
        currentStep: messageIntent?.date ? 'ASK_TIME' : 'ASK_DATE',
        selectedProfessionalId: null,
        selectedDate: messageIntent?.date ?? null
      })

      if (messageIntent?.date) {
        return this.buildAvailabilityReply({
          phone: input.phone,
          serviceId: selectedService.id,
          professionalId: null,
          date: messageIntent.date,
          time: parseAfterTimeFromMessage(input.message) ? null : messageIntent.time,
          timePreference: messageIntent.timePreference ?? parseTimePreferenceFromMessage(input.message),
          afterTime: parseAfterTimeFromMessage(input.message),
          prefix: buildIntentAvailabilityPrefix({
            serviceName: selectedService.name,
            date: messageIntent.date,
            timePreference: messageIntent.timePreference ?? parseTimePreferenceFromMessage(input.message)
          })
        })
      }

      return {
        reply: botCopyService.askDate('cualquier profesional')
      }
    }

    const selectedProfessional = await this.findProfessionalByMessage(input.message, selectedService.businessId)

    if (!selectedProfessional) {
      return this.buildProfessionalsReply(selectedService.businessId, botCopyService.professionalNotFound())
    }

    const messageIntent = await this.extractIntentForSelectedService({
      message: input.message,
      service: selectedService,
      businessId: selectedService.businessId
    })
    const selectedDate = messageIntent?.date ?? input.conversation.selectedDate

    await this.updateConversation(input.phone, {
      currentStep: selectedDate ? 'ASK_TIME' : 'ASK_DATE',
      selectedProfessionalId: selectedProfessional.id,
      selectedDate: selectedDate ?? null
    })

    if (selectedDate) {
      return this.buildAvailabilityReply({
        phone: input.phone,
        serviceId: selectedService.id,
        professionalId: selectedProfessional.id,
        date: selectedDate,
        time: parseAfterTimeFromMessage(input.message) ? null : messageIntent?.time ?? null,
        timePreference: messageIntent?.timePreference ?? parseTimePreferenceFromMessage(input.message),
        afterTime: parseAfterTimeFromMessage(input.message),
        prefix: buildIntentAvailabilityPrefix({
          serviceName: selectedService.name,
          professionalName: selectedProfessional.name,
          date: selectedDate,
          timePreference: messageIntent?.timePreference ?? parseTimePreferenceFromMessage(input.message)
        })
      })
    }

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
      ?? await aiMessageUnderstandingService.parseDate(input.message)

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

    return this.buildAvailabilityReply({
      phone: input.phone,
      serviceId: input.conversation.selectedServiceId,
      professionalId: input.conversation.selectedProfessionalId,
      date: selectedDate,
      time: parseAfterTimeFromMessage(input.message)
        ? null
        : messageUnderstandingService.parseTime(input.message)
          ?? await aiMessageUnderstandingService.parseTime(input.message),
      timePreference: parseTimePreferenceFromMessage(input.message),
      afterTime: parseAfterTimeFromMessage(input.message)
    })
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
      date: input.conversation.selectedDate,
      cachedOptions: readLastAvailabilityOptions(input.conversation.lastAvailability)
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
          slots: formatAvailabilitySlots(availability.options),
          professionalName: getSharedProfessionalName(availability.options),
          prefix: 'No encontre ese horario disponible. Te paso los horarios que veo libres.'
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
    const customerIntro = await this.extractCustomerIntroFromMessage(input.message)
    const rawCustomerName = customerIntro?.name ?? parseCustomerName(input.message, { allowPlainName: true })
    const customerName = rawCustomerName ? formatCustomerName(rawCustomerName) : null

    if (!customerName || customerName.length < 2) {
      return {
        reply: botCopyService.askCustomerNameAgain()
      }
    }

    if (
      !input.conversation.selectedServiceId &&
      !input.conversation.selectedProfessionalId &&
      !input.conversation.selectedDate &&
      !input.conversation.selectedTime
    ) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_SERVICE',
        selectedCustomerName: customerName
      })

      if (customerIntro?.wantsBooking && customerIntro.remainingMessage) {
        const bookingIntentReply = await this.tryHandleBookingIntent({
          phone: input.phone,
          message: customerIntro.remainingMessage,
          businessId: input.businessId
        })

        if (bookingIntentReply) {
          return {
            reply: [
              `Un gusto, ${getFirstName(customerName)}.`,
              bookingIntentReply.reply
            ].join('\n')
          }
        }
      }

      return this.buildServicesReply(`Gracias, ${getFirstName(customerName)}.`, input.businessId)
    }

    await this.updateConversation(input.phone, {
      currentStep: input.conversation.selectedServiceId && input.conversation.selectedDate
        ? 'ASK_TIME'
        : input.conversation.selectedServiceId
          ? input.conversation.selectedProfessionalId
            ? 'ASK_DATE'
            : 'ASK_PROFESSIONAL'
          : 'ASK_SERVICE',
      selectedCustomerName: customerName
    })

    if (input.conversation.selectedServiceId && input.conversation.selectedDate) {
      const selectedService = await prisma.service.findUnique({
        where: {
          id: input.conversation.selectedServiceId
        }
      })
      const professionalName = await this.findProfessionalName(input.conversation.selectedProfessionalId)

      return this.buildAvailabilityReply({
        phone: input.phone,
        serviceId: input.conversation.selectedServiceId,
        professionalId: input.conversation.selectedProfessionalId,
        date: input.conversation.selectedDate,
        time: input.conversation.selectedTime,
        afterTime: parseAfterTimeFromMessage(input.conversation.lastMessage ?? ''),
        timePreference: parseTimePreferenceFromMessage(input.conversation.lastMessage ?? ''),
        prefix: buildIntentAvailabilityPrefix({
          serviceName: selectedService?.name ?? 'el servicio',
          ...(professionalName ? { professionalName } : {}),
          date: input.conversation.selectedDate,
          timePreference: parseTimePreferenceFromMessage(input.conversation.lastMessage ?? '')
        })
      })
    }

    if (input.conversation.selectedServiceId) {
      const selectedService = await prisma.service.findUnique({
        where: {
          id: input.conversation.selectedServiceId
        }
      })

      if (!selectedService) {
        await this.restartBooking(input.phone)

        return this.buildServicesReply('Ese servicio ya no aparece disponible. Elegimos otro?', input.businessId)
      }

      if (input.conversation.selectedProfessionalId) {
        return {
          reply: botCopyService.askDate(await this.findProfessionalName(input.conversation.selectedProfessionalId) ?? 'el profesional seleccionado')
        }
      }

      return this.buildProfessionalsReply(selectedService.businessId, `Gracias, ${getFirstName(customerName)}. Dejamos ${selectedService.name}.`)
    }

    return this.buildServicesReply(`Gracias, ${getFirstName(customerName)}.`, input.businessId)
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
      where: businessId ? { businessId } : {},
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

    if (prefix && isCorrectionPrefix(prefix)) {
      return {
        reply: [
          prefix,
          'Estas son las opciones disponibles:',
          ...services.map((service) => `• ${service.name} (${service.duration} min)`)
        ].join('\n')
      }
    }

    return {
      reply: botCopyService.servicesList({
        ...(prefix ? { prefix } : {}),
        services
      })
    }
  }

  private replyToHumanQuestion(message: string): HandleBookingResult | null {
    const normalizedMessage = normalizeText(message)

    if (asksBotName(normalizedMessage)) {
      return {
        reply: [
          botCopyService.answerBotName(),
          'Decime que queres hacer y te guio.',
          '- Reservar turno',
          '- Ver tus turnos',
          '- Cancelar un turno',
          '- Cambiar un turno'
        ].join('\n')
      }
    }

    return null
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
        ...(prefix ? { prefix } : {}),
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

  private async tryHandleBookingIntent(input: {
    phone: string
    message: string
    businessId: string | null
  }): Promise<HandleBookingResult | null> {
    if (!aiMessageUnderstandingService.isEnabled()) {
      return null
    }

    const services = await prisma.service.findMany({
      where: input.businessId ? { businessId: input.businessId } : {},
      include: {
        aliases: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    if (services.length === 0) {
      return null
    }

    const professionals = await prisma.professional.findMany({
      where: input.businessId ? { businessId: input.businessId } : {},
      orderBy: {
        name: 'asc'
      }
    })

    const agentDecision = await aiMessageUnderstandingService.planBookingAction({
      message: input.message,
      services,
      professionals
    })

    if (agentDecision?.action === 'ask_clarification' && agentDecision.clarificationQuestion) {
      const selectedProfessional = agentDecision.anyProfessional
        ? null
        : agentDecision.selectedProfessionalIndex
          ? professionals[agentDecision.selectedProfessionalIndex - 1] ?? null
          : null

      await this.updateConversation(input.phone, {
        currentStep: 'ASK_SERVICE',
        selectedServiceId: null,
        selectedProfessionalId: selectedProfessional?.id ?? null,
        selectedDate: agentDecision.date,
        selectedTime: agentDecision.time,
        lastAvailability: null
      })

      return {
        reply: ensureQuestionHasOptions(agentDecision.clarificationQuestion, services)
      }
    }

    const intent = agentDecision?.action === 'continue_booking'
      ? agentDecision
      : await aiMessageUnderstandingService.extractBookingIntent({
          message: input.message,
          services,
          professionals
        })

    const selectedService = intent?.selectedServiceIndex
      ? services[intent.selectedServiceIndex - 1]
      : services.length === 1 && isBookingStartMessage(input.message, 'START')
        ? services[0]
        : null

    if (!intent || !selectedService) {
      return null
    }

    const selectedProfessional = intent.anyProfessional
      ? null
      : intent.selectedProfessionalIndex
        ? professionals[intent.selectedProfessionalIndex - 1] ?? null
        : null

    const selectedProfessionalId = selectedProfessional?.id ?? null

    if (!intent.date) {
      await this.updateConversation(input.phone, {
        currentStep: selectedProfessionalId || intent.anyProfessional ? 'ASK_DATE' : 'ASK_PROFESSIONAL',
        selectedServiceId: selectedService.id,
        selectedProfessionalId,
        selectedDate: null,
        selectedTime: null,
        lastAvailability: null
      })

      if (selectedProfessionalId || intent.anyProfessional) {
        return {
          reply: botCopyService.askDate(selectedProfessional?.name ?? 'cualquier profesional')
        }
      }

      return this.buildProfessionalsReply(selectedService.businessId, `Perfecto, elegiste ${selectedService.name}.`)
    }

    if (!selectedProfessionalId && !intent.anyProfessional) {
      await this.updateConversation(input.phone, {
        currentStep: 'ASK_PROFESSIONAL',
        selectedServiceId: selectedService.id,
        selectedProfessionalId: null,
        selectedDate: intent.date,
        selectedTime: null,
        lastAvailability: null
      })

      return this.buildProfessionalsReply(
        selectedService.businessId,
        `Perfecto, elegiste ${selectedService.name} para ${intent.date}.`
      )
    }

    const availabilityReply = await this.buildAvailabilityReply({
      phone: input.phone,
      serviceId: selectedService.id,
      professionalId: selectedProfessionalId,
      date: intent.date,
      time: parseAfterTimeFromMessage(input.message) ? null : intent.time,
      timePreference: intent.timePreference ?? parseTimePreferenceFromMessage(input.message),
      afterTime: parseAfterTimeFromMessage(input.message),
      prefix: buildIntentAvailabilityPrefix({
        serviceName: selectedService.name,
        ...(selectedProfessional?.name ? { professionalName: selectedProfessional.name } : {}),
        date: intent.date,
        timePreference: intent.timePreference ?? parseTimePreferenceFromMessage(input.message)
      })
    })

    return availabilityReply
  }

  private async extractBookingDraft(input: {
    message: string
    businessId: string | null
  }): Promise<BookingDraft | null> {
    if (!aiMessageUnderstandingService.isEnabled() || !isBookingStartMessage(input.message, 'START')) {
      return null
    }

    const services = await prisma.service.findMany({
      where: input.businessId ? { businessId: input.businessId } : {},
      include: {
        aliases: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    if (services.length === 0) {
      return null
    }

    const professionals = await prisma.professional.findMany({
      where: input.businessId ? { businessId: input.businessId } : {},
      orderBy: {
        name: 'asc'
      }
    })

    const agentDecision = await aiMessageUnderstandingService.planBookingAction({
      message: input.message,
      services,
      professionals
    })
    const intent = agentDecision
      ?? await aiMessageUnderstandingService.extractBookingIntent({
        message: input.message,
        services,
        professionals
      })

    const selectedService = intent?.selectedServiceIndex
      ? services[intent.selectedServiceIndex - 1]
      : findServiceBySalonWords(input.message, services)

    const selectedProfessional = intent?.anyProfessional
      ? null
      : intent?.selectedProfessionalIndex
        ? professionals[intent.selectedProfessionalIndex - 1] ?? null
        : messageUnderstandingService.findOptionByMessage(input.message, professionals)

    const draft: BookingDraft = {
      serviceId: selectedService?.id ?? null,
      serviceName: selectedService?.name ?? null,
      serviceBusinessId: selectedService?.businessId ?? null,
      professionalId: selectedProfessional?.id ?? null,
      professionalName: selectedProfessional?.name ?? null,
      date: intent?.date
        ?? messageUnderstandingService.parseDate(input.message)
        ?? await aiMessageUnderstandingService.parseDate(input.message),
      time: parseAfterTimeFromMessage(input.message)
        ? null
        : intent?.time
          ?? messageUnderstandingService.parseTime(input.message)
          ?? await aiMessageUnderstandingService.parseTime(input.message),
      timePreference: intent?.timePreference ?? parseTimePreferenceFromMessage(input.message),
      afterTime: parseAfterTimeFromMessage(input.message)
    }

    const hasUsefulDraft = Boolean(
      draft.serviceId ||
      draft.professionalId ||
      draft.date ||
      draft.time ||
      draft.timePreference ||
      draft.afterTime
    )

    return hasUsefulDraft ? draft : null
  }

  private async extractIntentForSelectedService(input: {
    message: string
    service: {
      id: string
      name: string
      category?: string | null
      aliases?: Array<{ name: string }>
    }
    businessId: string
  }) {
    if (!aiMessageUnderstandingService.isEnabled()) {
      return null
    }

    const professionals = await prisma.professional.findMany({
      where: {
        businessId: input.businessId
      },
      orderBy: {
        name: 'asc'
      }
    })

    return aiMessageUnderstandingService.extractBookingIntent({
      message: input.message,
      services: [input.service],
      professionals
    })
  }

  private async buildAvailabilityReply(input: {
    phone: string
    serviceId: string
    professionalId: string | null
    date: string
    time?: string | null
    timePreference?: TimePreference | null
    afterTime?: string | null
    prefix?: string
  }): Promise<HandleBookingResult> {
    const availability = await this.findAvailabilityOptions({
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      date: input.date
    })

    if (!availability.ok) {
      return {
        reply: availability.message
      }
    }

    const hasTimePreference = Boolean(input.timePreference && input.timePreference !== 'any')
    const preferredOptions = filterAvailabilityByPreference(availability.options, input.timePreference)
    const timePreferenceOptions = hasTimePreference ? preferredOptions : availability.options
    const options = filterAvailabilityAfterTime(timePreferenceOptions, input.afterTime)

    if (input.time) {
      const requestedTime = input.time
      const selectedAvailability = options.find((option) => option.time === requestedTime)
        ?? options.find((option) => option.time === toAfternoonTime(requestedTime))

      if (selectedAvailability) {
        await this.updateConversation(input.phone, {
          currentStep: 'CONFIRM',
          selectedServiceId: input.serviceId,
          selectedProfessionalId: selectedAvailability.professionalId,
          selectedDate: input.date,
          selectedTime: selectedAvailability.time,
          lastAvailability: {
            serviceId: input.serviceId,
            professionalId: input.professionalId,
            date: input.date,
            options
          }
        })

        return this.buildConfirmationReply({
          selectedServiceId: input.serviceId,
          selectedProfessionalId: selectedAvailability.professionalId,
          selectedDate: input.date,
          selectedTime: selectedAvailability.time,
          selectedCustomerName: await this.findCustomerName(input.phone)
        })
      }
    }

    if (options.length === 0) {
      return {
        reply: botCopyService.noAvailabilityForDate({
          date: input.date,
          professionalName: await this.findProfessionalName(input.professionalId),
          ...(input.afterTime ? { afterTime: input.afterTime } : {}),
          ...(formatTimePreferenceForCopy(input.timePreference)
            ? { timePreference: formatTimePreferenceForCopy(input.timePreference) }
            : {})
        })
      }
    }

    await this.updateConversation(input.phone, {
      currentStep: 'ASK_TIME',
      selectedServiceId: input.serviceId,
      selectedProfessionalId: input.professionalId,
      selectedDate: input.date,
      selectedTime: null,
      lastAvailability: {
        serviceId: input.serviceId,
        professionalId: input.professionalId,
        date: input.date,
        options
      }
    })

    return {
      reply: botCopyService.availability({
        slots: formatAvailabilitySlots(options),
        professionalName: getSharedProfessionalName(options),
        ...(
          input.time
            ? { prefix: `No tengo justo ${input.time}, pero te muestro horarios cercanos disponibles.` }
            : input.prefix
              ? { prefix: input.prefix }
              : {}
        )
      })
    }
  }

  private async findServiceByMessage(message: string, businessId?: string | null) {
    const services = await prisma.service.findMany({
      where: businessId ? { businessId } : {},
      include: {
        aliases: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    return messageUnderstandingService.findOptionByMessage(message, services)
      ?? findServiceBySalonWords(message, services)
      ?? await aiMessageUnderstandingService.findOptionByMessage({
        message,
        options: services,
        optionType: 'service'
      })
  }

  private async findProfessionalName(professionalId?: string | null) {
    if (!professionalId) {
      return null
    }

    const professional = await prisma.professional.findUnique({
      where: {
        id: professionalId
      }
    })

    return professional?.name ?? null
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
      ?? await aiMessageUnderstandingService.findOptionByMessage({
        message,
        options: professionals,
        optionType: 'professional'
      })
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
    cachedOptions?: AvailabilityOption[] | null
  }) {
    const options = input.cachedOptions ?? (await this.findAvailabilityOptions(input).then((availability) => {
      return availability.ok ? availability.options : null
    }))

    if (!options) {
      return null
    }

    if (options.length === 1 && isSingleRemainingSlotMessage(input.message)) {
      return options[0] ?? null
    }

    const normalizedMessage = normalizeText(input.message)

    if (normalizedMessage === 'primero' || normalizedMessage === 'el primero') {
      return options[0] ?? null
    }

    if (normalizedMessage === 'ultimo' || normalizedMessage === 'el ultimo') {
      return options[options.length - 1] ?? null
    }

    const parsedTime = messageUnderstandingService.parseTime(input.message)
      ?? await aiMessageUnderstandingService.parseTime(input.message)

    if (!parsedTime) {
      return null
    }

    const exactOption = options.find((option) => option.time === parsedTime)

    if (exactOption) {
      return exactOption
    }

    const afternoonTime = toAfternoonTime(parsedTime)

    if (!afternoonTime) {
      return null
    }

    return options.find((option) => option.time === afternoonTime) ?? null
  }

  private async findCustomerName(phone: string) {
    const conversation = await prisma.conversation.findUnique({
      where: {
        phone
      }
    })

    return conversation?.selectedCustomerName ?? 'Cliente'
  }

  private async extractCustomerIntroFromMessage(message: string) {
    if (!message.trim()) {
      return null
    }

    const aiIntro = await aiMessageUnderstandingService.extractCustomerIntro(message)

    if (aiIntro?.name) {
      return aiIntro
    }

    return parseCustomerIntro(message)
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
      lastAvailability?: LastAvailabilityState | null
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

export function isBookingStartMessage(message: string, currentStep: string) {
  const normalizedMessage = normalizeText(message)
  const bookingKeywords = [
    'turno',
    'reservar',
    'reserva',
    'sacar',
    'agendar',
    'agenda',
    'cortar',
    'cortarme',
    'corte',
    'pelo',
    'barba',
    'hacerme'
  ]

  return (
    (isMenuStep(currentStep) && normalizedMessage === '1') ||
    normalizedMessage === 'reservar' ||
    normalizedMessage === 'reservar turno' ||
    normalizedMessage === 'quiero un turno' ||
    normalizedMessage === 'sacar turno' ||
    bookingKeywords.some((keyword) => normalizedMessage.includes(keyword))
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

function asksBotName(normalizedMessage: string) {
  return [
    'cual es tu nombre',
    'como te llamas',
    'quien sos',
    'quien eres',
    'tu nombre'
  ].some((phrase) => normalizedMessage.includes(phrase))
}

function isClearlyOffBookingFlowMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  if (!normalizedMessage) {
    return false
  }

  const offFlowPhrases = [
    'salimos',
    'queres salir',
    'quieres salir',
    'sos linda',
    'sos muy linda',
    'sos hermosa',
    'te amo',
    'casate conmigo',
    'tenes novio',
    'tienes novio'
  ]

  if (offFlowPhrases.some((phrase) => normalizedMessage.includes(phrase))) {
    return true
  }

  return looksLikeRandomText(normalizedMessage)
}

function looksLikeRandomText(normalizedMessage: string) {
  if (!/^[a-z\s]+$/.test(normalizedMessage)) {
    return false
  }

  const compactText = normalizedMessage.replace(/\s+/g, '')

  if (compactText.length < 6) {
    return false
  }

  const allowedShortMessages = [
    'corte',
    'color',
    'lucas',
    'agustin',
    'agustín',
    'cualquiera',
    'manana',
    'pasado',
    'confirmar'
  ]

  if (allowedShortMessages.includes(normalizedMessage)) {
    return false
  }

  const bookingWords = [
    'turno',
    'reserv',
    'corte',
    'color',
    'pelo',
    'barba',
    'lucas',
    'agustin',
    'hoy',
    'manana',
    'pasado',
    'horario',
    'profesional',
    'confirmar',
    'cancelar',
    'editar'
  ]

  if (bookingWords.some((word) => normalizedMessage.includes(word))) {
    return false
  }

  const vowelCount = (compactText.match(/[aeiou]/g) ?? []).length

  return vowelCount <= 1
}

function isCorrectionPrefix(prefix: string) {
  return (
    prefix.includes('No lo ubique') ||
    prefix.includes('Por aca puedo ayudarte') ||
    prefix.includes('Estoy aca para ayudarte')
  )
}

function formatAvailabilitySlots(options: AvailabilityOption[]) {
  const sharedProfessionalName = getSharedProfessionalName(options)

  return options.map((option) => {
    if (sharedProfessionalName) {
      return option.time
    }

    return `${option.time} con ${option.professionalName}`
  })
}

function getSharedProfessionalName(options: AvailabilityOption[]) {
  if (options.length === 0) {
    return null
  }

  const [firstOption] = options

  if (!firstOption) {
    return null
  }

  const allSameProfessional = options.every((option) => option.professionalName === firstOption.professionalName)

  return allSameProfessional ? firstOption.professionalName : null
}

function filterAvailabilityByPreference(options: AvailabilityOption[], preference?: TimePreference | null) {
  if (!preference || preference === 'any') {
    return options
  }

  return options.filter((option) => {
    const hour = Number(option.time.split(':')[0])

    if (preference === 'morning') {
      return hour < 12
    }

    if (preference === 'afternoon') {
      return hour >= 12 && hour < 18
    }

    return hour >= 18
  })
}

function filterAvailabilityAfterTime(options: AvailabilityOption[], afterTime?: string | null) {
  if (!afterTime) {
    return options
  }

  return options.filter((option) => option.time >= afterTime)
}

function parseTimePreferenceFromMessage(message: string): TimePreference | null {
  const normalizedMessage = normalizeText(message)

  if (normalizedMessage.includes('manana') || normalizedMessage.includes('temprano')) {
    return 'morning'
  }

  if (normalizedMessage.includes('tarde')) {
    return 'afternoon'
  }

  if (normalizedMessage.includes('noche')) {
    return 'evening'
  }

  return null
}

function isSingleRemainingSlotMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  return [
    'dame ese',
    'dame ese turno',
    'dame el que quedo',
    'dame el turno que quedo',
    'el que queda',
    'el que quedo',
    'el unico',
    'el unico que queda',
    'ese',
    'ese mismo',
    'cualquiera',
    'mandame ese',
    'reservalo',
    'reservame ese'
  ].includes(normalizedMessage)
}

function parseAfterTimeFromMessage(message: string) {
  const normalizedMessage = normalizeText(message)

  if (!normalizedMessage.includes('despues de') && !normalizedMessage.includes('despues de las')) {
    return null
  }

  const parsedTime = messageUnderstandingService.parseTime(normalizedMessage)

  if (!parsedTime) {
    return null
  }

  return parsedTime < '08:00'
    ? toAfternoonTime(parsedTime) ?? parsedTime
    : parsedTime
}

function buildIntentAvailabilityPrefix(input: {
  serviceName: string
  professionalName?: string
  date: string
  timePreference?: TimePreference | null
}) {
  const professionalText = input.professionalName
    ? ` con ${input.professionalName}`
    : ''
  const preferenceText = input.timePreference && input.timePreference !== 'any'
    ? ` ${formatTimePreference(input.timePreference)}`
    : ''

  return `Dale, te busco ${input.serviceName}${professionalText} para ${input.date}${preferenceText}.`
}

function formatTimePreference(preference: TimePreference) {
  if (preference === 'morning') {
    return 'a la manana'
  }

  if (preference === 'afternoon') {
    return 'a la tarde'
  }

  if (preference === 'evening') {
    return 'a la noche'
  }

  return ''
}

function formatTimePreferenceForCopy(preference?: TimePreference | null) {
  if (!preference || preference === 'any') {
    return null
  }

  return formatTimePreference(preference)
}

function findServiceBySalonWords<T extends {
  name: string
  aliases?: Array<{ name: string }>
}>(message: string, services: T[]) {
  const normalizedMessage = normalizeText(message)
  const asksForSimpleCut = [
    'solo corte',
    'solamente corte',
    'nada mas corte',
    'corte solo',
    'corte simple',
    'solo pelo',
    'solo cortarme'
  ].some((phrase) => normalizedMessage.includes(phrase))

  if (asksForSimpleCut) {
    return findSimpleHaircutService(services)
  }

  const mentionsColor = [
    'color',
    'teñir',
    'tenir',
    'tintura',
    'mechas',
    'reflejos'
  ].some((word) => normalizedMessage.includes(normalizeText(word)))

  if (mentionsColor) {
    return services.find((service) => {
      return serviceSearchText(service).includes('color')
    }) ?? null
  }

  const mentionsHaircut = [
    'corte',
    'cortar',
    'cortarme',
    'pelo',
    'cabello'
  ].some((word) => normalizedMessage.includes(word))

  if (!mentionsHaircut) {
    return null
  }

  const haircutServices = services.filter((service) => {
    const searchableText = serviceSearchText(service)

    return searchableText.includes('corte') && !searchableText.includes('color')
  })

  return haircutServices.length === 1 ? haircutServices[0] ?? null : null
}

function findSimpleHaircutService<T extends {
  name: string
  aliases?: Array<{ name: string }>
}>(services: T[]) {
  const haircutServices = services.filter((service) => {
    const searchableText = serviceSearchText(service)

    return searchableText.includes('corte') && !searchableText.includes('color')
  })

  return haircutServices.length === 1 ? haircutServices[0] ?? null : null
}

function serviceSearchText(service: {
  name: string
  aliases?: Array<{ name: string }>
}) {
  return [
    service.name,
    ...(service.aliases?.map((alias) => alias.name) ?? [])
  ].map(normalizeText).join(' ')
}

function ensureQuestionHasOptions<T extends { name: string }>(question: string, services: T[]) {
  const normalizedQuestion = normalizeText(question)
  const alreadyMentionsOptions = services.some((service, index) => {
    return normalizedQuestion.includes(normalizeText(service.name)) || normalizedQuestion.includes(`${index + 1}.`)
  })

  if (alreadyMentionsOptions || services.length === 0) {
    return question
  }

  return [
    question,
    ...services.map((service) => `• ${service.name}`)
  ].join('\n')
}

function toAfternoonTime(time: string) {
  const [hoursText, minutesText] = time.split(':')
  const hours = Number(hoursText)

  if (Number.isNaN(hours) || hours < 1 || hours > 11) {
    return null
  }

  return `${String(hours + 12).padStart(2, '0')}:${minutesText ?? '00'}`
}

function readLastAvailabilityOptions(lastAvailability: unknown) {
  if (!lastAvailability || typeof lastAvailability !== 'object') {
    return null
  }

  const maybeLastAvailability = lastAvailability as {
    options?: unknown
  }

  if (!Array.isArray(maybeLastAvailability.options)) {
    return null
  }

  const options = maybeLastAvailability.options.filter((option): option is AvailabilityOption => {
    if (!option || typeof option !== 'object') {
      return false
    }

    const maybeOption = option as Partial<AvailabilityOption>

    return (
      typeof maybeOption.time === 'string' &&
      typeof maybeOption.professionalId === 'string' &&
      typeof maybeOption.professionalName === 'string'
    )
  })

  return options.length > 0 ? options : null
}

function parseCustomerIntro(message: string) {
  const normalizedMessage = message.trim().replace(/\s+/g, ' ')
  const match = normalizedMessage.match(/^(?:hola|buenas|buen dia|buenas tardes|buenas noches)?\s*(?:soy|me llamo|mi nombre es)\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+?)(?:\s+(?:quiero|necesito|busco|para|cortarme|corte|turno|reservar|sacar|agendar)\b|$)/i)

  if (match?.[1]) {
    return {
      name: match[1].trim(),
      remainingMessage: extractRemainingBookingMessage(normalizedMessage),
      wantsBooking: isBookingStartMessage(normalizedMessage, 'START'),
      confidence: 0.8
    }
  }

  return null
}

function parseCustomerName(message: string, options?: { allowPlainName?: boolean }) {
  const intro = parseCustomerIntro(message)

  if (intro?.name) {
    return intro.name
  }

  if (!options?.allowPlainName) {
    return null
  }

  const plainName = message.trim().replace(/\s+/g, ' ')

  if (!looksLikeCustomerName(plainName)) {
    return null
  }

  return plainName
}

function looksLikeCustomerName(name: string) {
  const normalizedName = normalizeText(name)

  if (normalizedName.length < 2) {
    return false
  }

  const rejectedMessages = [
    'hola',
    'hola que tal',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'que tal',
    'como estas',
    'todo bien',
    'quiero reservar',
    'quiero un turno',
    'reservar turno',
    'sacar turno'
  ]

  if (rejectedMessages.includes(normalizedName)) {
    return false
  }

  const rejectedWords = [
    'turno',
    'reservar',
    'reserva',
    'servicio',
    'horario',
    'manana',
    'pasado',
    'hoy',
    'corte',
    'color',
    'profesional'
  ]

  if (rejectedWords.some((word) => normalizedName.includes(word))) {
    return false
  }

  return /^[a-zA-Z\s]+$/.test(name) && name.split(/\s+/).length <= 3
}

function formatCustomerName(name: string) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function extractRemainingBookingMessage(message: string) {
  const normalizedMessage = message.trim().replace(/\s+/g, ' ')
  const match = normalizedMessage.match(/\b(quiero|necesito|busco|para|cortarme|corte|turno|reservar|sacar|agendar)\b(.+)?$/i)

  if (!match) {
    return null
  }

  return normalizedMessage.slice(match.index).trim()
}

function buildStartAt(date: string, time: string) {
  return `${date}T${time}:00`
}
