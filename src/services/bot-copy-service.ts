type AppointmentSummary = {
  customerName: string
  serviceName: string
  professionalName: string
  date: string
  time: string
}

type AppointmentListItem = {
  serviceName: string
  professionalName: string
  date: string
  time: string
}

export class BotCopyService {
  mainMenu(customerName?: string | null) {
    const greeting = customerName ? `Hola ${getFirstName(customerName)}, soy Cami.` : 'Hola, soy Cami.'

    return [
      greeting,
      'Decime qué necesitás y te doy una mano.',
      '- Reservar turno',
      '- Ver tus turnos',
      '- Cancelar un turno',
      '- Cambiar un turno'
    ].join('\n')
  }

  askInitialName() {
    return '¡Hola! 💖 Soy Cami, un verdadero placer conocerte 😊\n\nAntes de continuar, ¿te gustaría compartir tu nombre? Así puedo ofrecerte una atención más personalizada y cálida. ✨'
  }

  resetDone() {
    return 'Listo, empezamos de nuevo. Cuando quieras, escribime qué necesitás hacer.'
  }

  servicesList(input: {
    prefix?: string
    services: Array<{ name: string; duration: number }>
  }) {
    const options = input.services.map((service) => {
      return `* ${service.name} (${service.duration} min)`
    })

    return [
      input.prefix,
      '😊 ¿Qué servicio te gustaría reservar?',
      '',
      ...options,
      'Contame cuál preferís y seguimos 💫'
    ].filter((line): line is string => line !== undefined && line !== null).join('\n')
  }

  noServices() {
    return 'Por ahora no tengo servicios cargados para reservar. Cuando estén listos, te ayudo por acá.'
  }

  serviceNotFound(misunderstandingCount = 0) {
    return withRecoveryOptions(
      'No lo ubiqué bien. Decime el nombre del servicio y lo seguimos.',
      {
        includeChangeService: false,
        misunderstandingCount
      }
    )
  }

  outsideSalonService(misunderstandingCount = 0) {
    return withRecoveryOptions(
      'No me quedo claro si queres reservar un turno del salon. Por aca puedo ayudarte con servicios como corte o color.',
      {
        includeChangeService: false,
        misunderstandingCount
      }
    )
  }

  bookingStopped() {
    return 'Dale, no hay problema. Si despues queres reservar o consultar otro turno, escribime por aca.'
  }

  bookingOnly() {
    return 'Te entiendo 😊 Por acá puedo ayudarte con turnos: reservar, ver tus turnos, cancelar o cambiar uno.'
  }

  answerBotName() {
    return 'Soy Cami 😊 Estoy acá para ayudarte con tu turno.'
  }

  professionalsList(input: {
    prefix?: string
    professionals: Array<{ name: string }>
  }) {
    const options = input.professionals.map((professional) => {
      return `• ${professional.name}`
    })

    return [
      input.prefix,
      'Perfecto 😊 ¿Preferís atenderte con alguien en particular?',
      ...options,
      '• Cualquier profesional'
    ].filter(Boolean).join('\n')
  }

  noProfessionals() {
    return 'Todavía no tengo profesionales disponibles para ese servicio.'
  }

  professionalNotFound(misunderstandingCount = 0) {
    return withRecoveryOptions('No lo encontré entre los profesionales disponibles. Decime el nombre y lo reviso.', {
      misunderstandingCount
    })
  }

  askDate(professionalName: string) {
    const prefix = [
      'el profesional que prefieras',
      'cualquier profesional',
      'el profesional seleccionado'
    ].includes(professionalName)
      ? null
      : `Dale, dejamos ${professionalName}.`

    return [
      prefix,
      'Perfecto 😊 ¿Para cuándo te gustaría el turno?',
      'Puede ser hoy, mañana o directamente una fecha, por ejemplo 25/6.'
    ].filter(Boolean).join('\n')
  }

  dateNotUnderstood(misunderstandingCount = 0) {
    return withRecoveryOptions('Perdón, no me quedó claro el día 😅 ¿Me lo podés decir de otra forma? Puede ser hoy, mañana o una fecha como 25/6.', {
      misunderstandingCount
    })
  }

  timeNotUnderstood(misunderstandingCount = 0) {
    return withRecoveryOptions('Perdon, no me quedo claro el horario. Decime una hora de la lista, por ejemplo 17:00 o el de las 5.', {
      includeChangeService: false,
      misunderstandingCount
    })
  }

  noAvailabilityForDate(input?: {
    date?: string
    professionalName?: string | null
    afterTime?: string | null
    timePreference?: string | null
  }) {
    const dateText = input?.date ? ` para ${input.date}` : ' para esa fecha'
    const professionalText = input?.professionalName ? ` con ${input.professionalName}` : ''
    const timeText = input?.afterTime
      ? ` después de las ${input.afterTime}`
      : input?.timePreference
        ? ` ${input.timePreference}`
        : ''

    return `No veo horarios disponibles${professionalText}${dateText}${timeText}. Si querés, probamos con otro día, otro profesional o sin preferencia 😊`
  }

  noAvailabilityTodayForProfessional(input: {
    professionalName: string
  }) {
    return [
      `Para hoy no veo horarios disponibles con ${input.professionalName}.`,
      'Podemos hacer una de estas dos cosas 😊',
      '1. Buscar otro día con el mismo profesional',
      '2. Buscar horarios para hoy con todos los profesionales'
    ].join('\n')
  }

  availability(input: {
    slots: string[]
    prefix?: string
    professionalName?: string | null
  }) {
    const title = input.professionalName
      ? `Horarios disponibles de ${input.professionalName}:`
      : 'Horarios disponibles:'
    const options = input.slots.map((slot) => {
      return `- ${slot}`
    })

    return [
      input.prefix,
      title,
      ...options,
      'Decime cuál te queda mejor y te lo dejo reservado 😊'
    ].filter(Boolean).join('\n')
  }

  askCustomerName() {
    return 'Perfecto 😊 ¿A nombre de quién lo dejamos?'
  }

  askCustomerNameAgain(misunderstandingCount = 0) {
    return withRecoveryOptions(
      'Perdón, no llegué a tomar tu nombre 😊 ¿Cómo te llamás? Así te lo dejo bien cargado.',
      {
        includeChangeService: false,
        misunderstandingCount
      }
    )
  }

  askFullCustomerName() {
    return 'Pasame el nombre completo y dejo el turno a ese nombre.'
  }

  confirmation(summary: AppointmentSummary) {
    return [
      'Genial 😊 Te confirmo así lo dejamos bien:',
      '',
      `Nombre: ${summary.customerName}`,
      `Servicio: ${summary.serviceName}`,
      `Profesional: ${summary.professionalName}`,
      `Fecha: ${summary.date}`,
      `Horario: ${summary.time}`,
      '',
      'Si está todo bien, respondeme confirmar y te lo reservo.',
      'Si querés cambiar algo, decime qué querés modificar.'
    ].join('\n')
  }

  askConfirm(misunderstandingCount = 0) {
    if (misunderstandingCount <= 0) {
      return 'Mmm, creo que no te seguí 😅 ¿Querés confirmar el turno o cambiar algo?'
    }

    return [
      'Creo que nos estamos cruzando un poco 😅',
      'Decime cuál se parece más a lo que necesitás:',
      '* confirmar',
      '* cambiar horario',
      '* cambiar profesional',
      '* cambiar fecha',
      '* cambiar servicio',
      '* cancelar',
      '* pasarte con una persona'
    ].join('\n')
  }

  humanHandoffQueued() {
    return [
      'Dale 😊',
      'Ya le avisé a una de las chicas del equipo para que siga la conversación por acá.',
      'En un ratito te responde 💖'
    ].join('\n')
  }

  humanHandoffAlreadyQueued() {
    return 'Tranqui 😊 Ya quedó avisado el equipo. Te van a responder por este mismo chat.'
  }

  selectedServiceRejected(input: {
    serviceName: string
  }) {
    return [
      'Uy, perdón 😅',
      `Entendí que habías elegido "${input.serviceName}", por eso seguí con ese servicio.`,
      '',
      '¿Querés cambiar el servicio?',
      'Si querés, decime cuál preferís y lo acomodamos.'
    ].join('\n')
  }

  clarifyProfessionalChange(input: {
    professionalName: string
  }) {
    return [
      `No me quedó del todo claro 😊 ¿Querés cambiar el turno para atenderte con ${input.professionalName}?`,
      'Podés responder:',
      '* si, con ese profesional',
      '* no, dejar como estaba',
      '* cambiar horario',
      '* confirmar'
    ].join('\n')
  }

  clarifyServiceChange(input: {
    serviceName: string
  }) {
    return [
      `No me quedo del todo claro 😊 ¿Querés dejar el turno como ${input.serviceName}?`,
      'Podés responder:',
      '* si, ese servicio',
      '* cambiar servicio',
      '* cambiar horario',
      '* confirmar'
    ].join('\n')
  }

  appointmentConfirmed(input: {
    customerName: string
    date: string
    time: string
  }) {
    return `Listo, ${getFirstName(input.customerName)} 😊 Tu turno quedó confirmado para el ${input.date} a las ${input.time}. Te esperamos.`
  }

  appointmentFailed(message: string) {
    return `${message}. Probemos con otra fecha u horario y lo acomodamos.`
  }

  postBookingClosing(customerName?: string | null) {
    const nameText = customerName ? `, ${getFirstName(customerName)}` : ''

    return `Gracias a vos${nameText} 😊 Quedó todo listo. Cualquier cosa que necesites cambiar o consultar, escribime por acá.`
  }

  reopenAfterBooking(customerName?: string | null) {
    const nameText = customerName ? ` ${getFirstName(customerName)}` : ''

    return [
      `¡Hola${nameText}! 😊 Yo muy bien, gracias por preguntar.`,
      'Decime qué necesitás y te doy una mano:',
      '- Reservar otro turno',
      '- Ver tus turnos',
      '- Cancelar un turno',
      '- Cambiar un turno'
    ].join('\n')
  }

  myAppointments(items: AppointmentListItem[]) {
    if (items.length === 0) {
      return 'No encontré turnos activos para este número.'
    }

    const options = items.map((item, index) => {
      return [
        `${index + 1}. ${item.serviceName}`,
        `Profesional: ${item.professionalName}`,
        `Fecha: ${item.date}`,
        `Horario: ${item.time}`
      ].join('\n')
    })

    return [
      'Estos son los turnos activos que encontré:',
      ...options
    ].join('\n\n')
  }

  cancelAppointmentIntro() {
    return 'Dale, te ayudo a cancelarlo. Elegí de la lista qué turno querés cancelar.'
  }

  editAppointmentIntro() {
    return 'Dale, te ayudo a cambiarlo. Elegí de la lista qué turno querés editar.'
  }

  cancelConfirmed(input: {
    serviceName: string
    date: string
    time: string
  }) {
    return `Listo, cancelé tu turno de ${input.serviceName} para el ${input.date} a las ${input.time}.`
  }

  cancelConfirmedWithFollowUp(input: {
    serviceName: string
    date: string
    time: string
  }) {
    return [
      this.cancelConfirmed(input),
      '¿Te puedo ayudar con algo más o querés que busquemos otro turno? 😊'
    ].join('\n\n')
  }

  editNotImplementedYet() {
    return 'Listo, cancelé ese turno para que puedas elegir uno nuevo.'
  }

  restartRequired(reason: string) {
    return `${reason} Necesito que empecemos de nuevo para hacerlo bien.`
  }
}

export function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

function withRecoveryOptions(message: string, options?: {
  includeChangeService?: boolean
  misunderstandingCount?: number
}) {
  const includeChangeService = options?.includeChangeService ?? true
  const misunderstandingCount = options?.misunderstandingCount ?? 0

  if (misunderstandingCount <= 0) {
    return message
  }

  if (misunderstandingCount >= 2) {
    return [
      'Creo que nos estamos cruzando un poco 😅',
      message,
      '',
      'Decime cuál se parece más a lo que necesitás:',
      '* reservar turno',
      '* cambiar turno',
      '* cancelar turno',
      includeChangeService ? '* cambiar servicio' : null,
      '* pasarte con una persona'
    ].filter(Boolean).join('\n')
  }

  const recoveryOptions = [
    includeChangeService ? '* cambiar servicio' : null,
    '* volver al paso anterior',
    '* pasarte con una persona'
  ].filter(Boolean)

  return [
    message,
    '',
    'Si querés, también puedo:',
    ...recoveryOptions
  ].join('\n')
}
