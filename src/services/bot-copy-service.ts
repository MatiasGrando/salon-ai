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
      'Decime tranquilo que necesitas y te doy una mano.',
      '- Reservar turno',
      '- Ver tus turnos',
      '- Cancelar un turno',
      '- Cambiar un turno'
    ].join('\n')
  }

  askInitialName() {
    return '¡Hola! 💖 Soy Cami, un gusto conocerte 😊\n\nAntes de empezar, ¿me decís tu nombre? Así puedo ayudarte mejor y hacer que tu experiencia sea más personalizada ✨'
  }

  resetDone() {
    return 'Listo, empezamos de nuevo. Cuando quieras, escribime que necesitas hacer.'
  }

  servicesList(input: {
    prefix?: string
    services: Array<{ name: string; duration: number }>
  }) {
    const options = input.services.map((service) => {
      return `• ${service.name} (${service.duration} min)`
    })

    return [
      input.prefix,
      '😊 ¡Genial! ¿Qué te gustaría hacerte?',
      ...options
    ].filter(Boolean).join('\n')
  }

  noServices() {
    return 'Por ahora no tengo servicios cargados para reservar. Cuando esten listos, te ayudo por aca.'
  }

  serviceNotFound() {
    return 'No lo ubique bien. Decime el nombre del servicio y lo seguimos.'
  }

  bookingOnly() {
    return 'Jaja, te entiendo 😊 Por aca puedo ayudarte con turnos: reservar, ver tus turnos, cancelar o cambiar uno.'
  }

  answerBotName() {
    return 'Soy Cami 😊 Estoy aca para ayudarte con tu turno.'
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
      'Perfecto. ¿Preferís atenderte con alguien en particular?',
      ...options,
      '• Cualquier profesional'
    ].filter(Boolean).join('\n')
  }

  noProfessionals() {
    return 'Todavia no tengo profesionales disponibles para ese servicio.'
  }

  professionalNotFound() {
    return 'No lo encontre entre los profesionales disponibles. Decime el nombre y lo reviso.'
  }

  askDate(professionalName: string) {
    return [
      `Dale, dejamos ${professionalName}.`,
      'Para que dia te gustaria?',
      '- Hoy',
      '- Manana',
      '- Pasado',
      'O decime una fecha, por ejemplo 25/6/26 o 25-6-26.'
    ].join('\n')
  }

  dateNotUnderstood() {
    return 'No llegue a entender bien el dia. Puede ser hoy, manana, pasado o una fecha como 25/6/26.'
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
      ? ` despues de las ${input.afterTime}`
      : input?.timePreference
        ? ` ${input.timePreference}`
        : ''

    return `No veo horarios disponibles${professionalText}${dateText}${timeText}. Si queres, probamos con otro dia, otro profesional o sin preferencia.`
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
      'Decime cual te queda mejor y te lo dejo reservado.'
    ].filter(Boolean).join('\n')
  }

  askCustomerName() {
    return 'Perfecto. A nombre de quien lo dejamos?'
  }

  askCustomerNameAgain() {
    return 'Perdon, no llegue a tomar tu nombre. Como te llamas? Asi te lo dejo bien cargado.'
  }

  askFullCustomerName() {
    return 'Pasame el nombre completo y dejo el turno a ese nombre.'
  }

  confirmation(summary: AppointmentSummary) {
    return [
      'Genial, te confirmo asi lo dejamos bien:',
      '',
      `Nombre: ${summary.customerName}`,
      `Servicio: ${summary.serviceName}`,
      `Profesional: ${summary.professionalName}`,
      `Fecha: ${summary.date}`,
      `Horario: ${summary.time}`,
      '',
      'Si esta todo bien, respondeme confirmar y te lo reservo.',
      'Si queres cambiar algo, decime que queres modificar.'
    ].join('\n')
  }

  askConfirm() {
    return 'Para dejar el turno reservado, respondeme confirmar. Si queres cambiar algo, decime cambiar fecha, cambiar horario, cambiar profesional o cambiar servicio.'
  }

  appointmentConfirmed(input: {
    customerName: string
    date: string
    time: string
  }) {
    return `Listo, ${getFirstName(input.customerName)}. Tu turno quedo confirmado para el ${input.date} a las ${input.time}. Te esperamos.`
  }

  appointmentFailed(message: string) {
    return `${message}. Probemos con otra fecha u horario y lo acomodamos.`
  }

  myAppointments(items: AppointmentListItem[]) {
    if (items.length === 0) {
      return 'No encontre turnos activos para este numero.'
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
      'Estos son los turnos activos que encontre:',
      ...options
    ].join('\n\n')
  }

  cancelAppointmentIntro() {
    return 'Dale, te ayudo a cancelarlo. Elegi de la lista que turno queres cancelar.'
  }

  editAppointmentIntro() {
    return 'Dale, te ayudo a cambiarlo. Elegi de la lista que turno queres editar.'
  }

  cancelConfirmed(input: {
    serviceName: string
    date: string
    time: string
  }) {
    return `Listo, cancele tu turno de ${input.serviceName} para el ${input.date} a las ${input.time}.`
  }

  editNotImplementedYet() {
    return 'Listo, cancele ese turno para que puedas elegir uno nuevo.'
  }

  restartRequired(reason: string) {
    return `${reason} Necesito que empecemos de nuevo para hacerlo bien.`
  }
}

export function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}
