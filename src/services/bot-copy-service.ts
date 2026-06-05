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
      'Contame que necesitas y te doy una mano.',
      '1. Reservar turno',
      '2. Mis turnos',
      '3. Cancelar turno',
      '4. Editar turno'
    ].join('\n')
  }

  askInitialName() {
    return 'Hola, soy Cami. Mucho gusto. Te ayudo a reservar tu turno.\nAntes de empezar, como te llamas?'
  }

  resetDone() {
    return 'Listo, empezamos de nuevo. Cuando quieras, escribime que necesitas hacer.'
  }

  servicesList(input: {
    prefix?: string
    services: Array<{ name: string; duration: number }>
  }) {
    const options = input.services.map((service, index) => {
      return `${index + 1}. ${service.name} - ${service.duration} min`
    })

    return [
      input.prefix,
      'Que servicio queres reservar?',
      ...options
    ].filter(Boolean).join('\n')
  }

  noServices() {
    return 'Por ahora no tengo servicios cargados para reservar. Cuando esten listos, te ayudo por aca.'
  }

  serviceNotFound() {
    return 'No encontre ese servicio entre las opciones. Proba respondiendo con el numero, el nombre o una forma parecida.'
  }

  professionalsList(input: {
    prefix?: string
    professionals: Array<{ name: string }>
  }) {
    const options = input.professionals.map((professional, index) => {
      return `${index + 1}. ${professional.name}`
    })

    return [
      input.prefix,
      'Con que profesional queres atenderte?',
      ...options,
      '0. Cualquier profesional'
    ].filter(Boolean).join('\n')
  }

  noProfessionals() {
    return 'Todavia no tengo profesionales disponibles para ese servicio.'
  }

  professionalNotFound() {
    return 'No encontre ese profesional entre las opciones. Responde con el numero o con el nombre.'
  }

  askDate(professionalName: string) {
    return [
      `Dale, dejamos ${professionalName}.`,
      'Para que fecha queres el turno?',
      '1. Hoy',
      '2. Manana',
      '3. Pasado',
      'O decime una fecha, por ejemplo 2026-06-06.'
    ].join('\n')
  }

  dateNotUnderstood() {
    return 'No llegue a entender la fecha. Podes responder 1 para hoy, 2 para manana, 3 para pasado, o escribirme una fecha como 2026-06-06.'
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

    return `No veo horarios disponibles${professionalText}${dateText}${timeText}. Podemos probar con otro dia, otro profesional o sin preferencia.`
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
      'Decime que horario preferis.'
    ].filter(Boolean).join('\n')
  }

  askCustomerName() {
    return 'Perfecto. A nombre de quien dejamos el turno?'
  }

  askCustomerNameAgain() {
    return 'Perdon, no llegue a tomar tu nombre. Como te llamas?'
  }

  askFullCustomerName() {
    return 'Pasame el nombre completo y dejo el turno a ese nombre.'
  }

  confirmation(summary: AppointmentSummary) {
    return [
      'Genial, te confirmo los datos antes de reservar:',
      '',
      `Nombre: ${summary.customerName}`,
      `Servicio: ${summary.serviceName}`,
      `Profesional: ${summary.professionalName}`,
      `Fecha: ${summary.date}`,
      `Horario: ${summary.time}`,
      '',
      'Si esta todo bien, respondeme confirmar.',
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
    return `Listo, ${getFirstName(input.customerName)}. Tu turno quedo confirmado para el ${input.date} a las ${input.time}. Te espero.`
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
