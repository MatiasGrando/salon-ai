export const TAMARA_OPTIONS_BOT_KEY = 'tamara-options-v1'
export const TAMARA_OPTIONS_BOT_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const TAMARA_STALE_INTERACTIVE_REPLY_ID = 'system:tamara_stale_prompt'

export const TAMARA_OPTIONS_BOT_DEFINITION = {
  botKey: TAMARA_OPTIONS_BOT_KEY,
  name: 'Bot de opciones de Tamara Grando',
  version: 'v1',
  mode: 'OPTIONS_ONLY',
  status: 'DRAFT',
  channel: 'UNASSIGNED',
  routingMode: 'EXCLUSIVE',
  timeoutMinutes: 120,
  capabilities: {
    strictOptionMatching: true,
    humanHandoff: true,
    booking: true,
    appointmentManagement: true,
    appointmentCancellationRequiresHandoff: true
  }
} as const

export type TamaraOptionsBotNode =
  | 'MAIN_MENU'
  | 'WORKING_HOURS'
  | 'CONTACT'
  | 'PROPOSAL_CHANNEL'
  | 'PROPOSAL_NAME'
  | 'PROPOSAL_TEXT'
  | 'FIRST_CONSULTATION_NAME'
  | 'FIRST_CONSULTATION_REASON'
  | 'HUMAN_NAME'
  | 'HUMAN_REASON'
  | 'BOOK_CATEGORY'
  | 'BOOK_SERVICE'
  | 'BOOK_DATE_METHOD'
  | 'BOOK_DATE'
  | 'BOOK_SPECIFIC_DATE'
  | 'BOOK_TIME'
  | 'BOOK_SPECIFIC_TIME'
  | 'BOOK_CUSTOMER_NAME'
  | 'BOOK_CONFIRM'
  | 'APPOINTMENT_LIST'
  | 'APPOINTMENT_ACTION'

export type TamaraBotOption = { id: string; title: string; description?: string }

export type TamaraOptionsBotContext = {
  customerName?: string | undefined
  proposal?: string | undefined
  consultationReason?: string | undefined
  categoryId?: string | undefined
  categoryName?: string | undefined
  serviceId?: string | undefined
  serviceName?: string | undefined
  selectedDate?: string | undefined
  selectedDateLabel?: string | undefined
  selectedTime?: string | undefined
  requestedTime?: string | undefined
  weekOffset?: number | undefined
  appointmentId?: string | undefined
  appointmentLabel?: string | undefined
  appointmentServiceId?: string | undefined
  appointmentServiceIds?: string[] | undefined
  mode?: 'book' | 'reschedule' | undefined
  humanReasonPrefix?: string | undefined
  listPage?: number | undefined
  onlyAvailableDates?: boolean | undefined
}

export type TamaraOptionsBotState = {
  node: TamaraOptionsBotNode
  invalidAttempts: number
  context: TamaraOptionsBotContext
  history: Array<{ node: TamaraOptionsBotNode; context: TamaraOptionsBotContext }>
}

export type TamaraOptionsBotResult = {
  status: 'active' | 'completed'
  message: string
  options: TamaraBotOption[]
  state: TamaraOptionsBotState
  handoff?: {
    kind: 'human_attention' | 'first_consultation' | 'proposal' | 'cancellation_retention' | 'deposit_review'
    name?: string | undefined
    reason: string
    appointmentId?: string | undefined
  }
  mutation?: { kind: 'reserved' | 'rescheduled'; appointmentId?: string | undefined }
  depositRequestId?: string | undefined
  reset?: boolean | undefined
}

export type TamaraBotCategory = { id: string; name: string }
export type TamaraBotService = { id: string; name: string; durationMinutes: number }
export type TamaraBotAvailableDate = { date: string; label: string }
export type TamaraBotAppointment = {
  id: string
  date: string
  dateLabel: string
  time: string
  serviceName: string
  serviceId?: string
  serviceIds?: string[]
  depositStatus?: string | null
}

export type TamaraOptionsBotGateway = {
  getContact(input: { businessId: string }): Promise<{
    email: string | null
    website: string | null
    instagram: string | null
    facebook: string | null
    tiktok: string | null
  }>
  getWorkingHours(input: { businessId: string }): Promise<Array<{ dayLabel: string; ranges: string[] }>>
  getCategories(input: { businessId: string }): Promise<TamaraBotCategory[]>
  getServices(input: { businessId: string; categoryId: string }): Promise<TamaraBotService[]>
  getAvailableDates(input: {
    businessId: string
    serviceId: string
    serviceIds?: string[] | undefined
    weekOffset: number
    exactTime?: string | undefined
    onlyWithAvailability?: boolean | undefined
    appointmentId?: string | undefined
  }): Promise<TamaraBotAvailableDate[]>
  getAvailableTimes(input: {
    businessId: string
    serviceId: string
    serviceIds?: string[] | undefined
    date: string
    appointmentId?: string | undefined
  }): Promise<string[]>
  getUpcomingAppointments(input: { businessId: string; phone: string }): Promise<TamaraBotAppointment[]>
  getCustomerName?(input: { businessId: string; phone: string }): Promise<string | null>
  reserve(input: {
    businessId: string
    phone: string
    customerName: string
    serviceId: string
    serviceIds?: string[] | undefined
    date: string
    time: string
  }): Promise<{ ok: true; appointmentId: string; requiresDeposit: boolean; depositRequestId?: string; depositMessage?: string } | { ok: false; reason: string }>
  reschedule(input: {
    businessId: string
    phone: string
    appointmentId: string
    serviceId: string
    serviceIds?: string[] | undefined
    date: string
    time: string
  }): Promise<{ ok: true } | { ok: false; reason: string; requiresHandoff?: boolean }>
}

type HandleInput = {
  businessId: string
  phone: string
  message: string
  interactiveReplyId?: string | undefined
  state?: Partial<TamaraOptionsBotState> | null
  previousActivityAt: Date
  now?: Date
}

const MAIN_OPTIONS: TamaraBotOption[] = [
  { id: 'menu:book', title: 'Reservar un horario' },
  { id: 'menu:appointments', title: 'Mis reservas' },
  { id: 'menu:first_consultation', title: 'Primera consulta' },
  { id: 'menu:hours', title: 'Horarios de atención' },
  { id: 'menu:proposals', title: 'Propuestas laborales' },
  { id: 'menu:contact', title: 'Redes y contacto' },
  { id: 'global:human', title: 'Atención humana' }
]

const BACK: TamaraBotOption = { id: 'global:back', title: 'Volver' }
const MENU: TamaraBotOption = { id: 'global:menu', title: 'Menú principal' }
const HUMAN: TamaraBotOption = { id: 'global:human', title: 'Atención humana' }

export class TamaraOptionsBot {
  constructor(private readonly gateway: TamaraOptionsBotGateway) {}

  async start(input: { businessId: string; phone: string }): Promise<TamaraOptionsBotResult> {
    return { ...this.result(this.initialState(), [
      '¡Hola! Soy el asistente virtual de Tamara Grando.',
      'Elegí una opción de la lista para continuar.'
    ].join('\n'), MAIN_OPTIONS), reset: true }
  }

  async handle(input: HandleInput): Promise<TamaraOptionsBotResult> {
    const now = input.now ?? new Date()
    if (now.getTime() - input.previousActivityAt.getTime() > TAMARA_OPTIONS_BOT_TIMEOUT_MS) {
      const restarted = await this.start(input)
      return { ...restarted, message: `Pasaron más de 2 horas desde el último mensaje. Vamos a empezar de nuevo.\n\n${restarted.message}` }
    }

    const state = this.sanitizeState(input.state)
    const options = await this.optionsFor(state, input)
    const action = this.resolveAction(input.message, input.interactiveReplyId, options)

    if (action === TAMARA_STALE_INTERACTIVE_REPLY_ID) {
      return this.result(state, 'La lista anterior ya venció. Elegí una opción de esta lista actualizada.', options)
    }
    if (action === 'global:menu') return this.start(input)
    if (action === 'global:back') return this.goBack(state, input)
    if (action === 'global:human') return this.askHumanName(state)
    if (action === 'list:next' || action === 'list:previous') {
      const listPage = Math.max(0, (state.context.listPage ?? 0) + (action === 'list:next' ? 1 : -1))
      const next = this.withContext(state, { listPage })
      return this.result(next, this.promptFor(next), await this.optionsFor(next, input))
    }

    if (this.isFreeTextNode(state.node)) {
      return this.handleFreeText(input.message, state, input)
    }
    if (!action) return this.invalid(state, options)

    switch (state.node) {
      case 'MAIN_MENU': return this.handleMain(action, state, input)
      case 'PROPOSAL_CHANNEL':
        if (action === 'proposal:chat') return this.show(state, 'PROPOSAL_NAME', 'Antes de recibir la propuesta, decime tu nombre.', this.freeTextNavigation())
        return this.invalid(state, options)
      case 'BOOK_CATEGORY': return this.selectCategory(action, state, input)
      case 'BOOK_SERVICE': return this.selectService(action, state, input)
      case 'BOOK_DATE_METHOD': return this.selectDateMethod(action, state, input)
      case 'BOOK_DATE': return this.selectDate(action, state, input, options)
      case 'BOOK_TIME': return this.selectTime(action, state, input)
      case 'BOOK_CONFIRM': return this.confirmBooking(action, state, input)
      case 'APPOINTMENT_LIST': return this.selectAppointment(action, state, input)
      case 'APPOINTMENT_ACTION': return this.handleAppointmentAction(action, state, input)
      case 'WORKING_HOURS':
      case 'CONTACT':
        return this.invalid(state, options)
      default:
        return this.invalid(state, options)
    }
  }

  private async handleMain(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action === 'menu:hours') {
      const hours = await this.gateway.getWorkingHours({ businessId: input.businessId })
      const detail = hours.length
        ? hours.map((item) => `• ${item.dayLabel}: ${item.ranges.join(' y ')}`).join('\n')
        : 'Los horarios todavía no están publicados.'
      return this.show(state, 'WORKING_HOURS', `Estos son los horarios habituales de atención de Tamara:\n\n${detail}`, this.navigation())
    }
    if (action === 'menu:contact') {
      const contact = await this.gateway.getContact({ businessId: input.businessId })
      const lines = [
        contact.email ? `• Email: ${contact.email}` : null,
        contact.website ? `• Página: ${contact.website}` : null,
        contact.instagram ? `• Instagram: ${contact.instagram}` : null,
        contact.facebook ? `• Facebook: ${contact.facebook}` : null,
        contact.tiktok ? `• TikTok: ${contact.tiktok}` : null
      ].filter((line): line is string => Boolean(line))
      return this.show(state, 'CONTACT', `Podés encontrar a Tamara en estos canales:\n\n${lines.join('\n') || 'La información de contacto todavía no está publicada.'}`, this.navigation())
    }
    if (action === 'menu:proposals') {
      const contact = await this.gateway.getContact({ businessId: input.businessId })
      const introduction = contact.email
        ? `Para propuestas laborales podés escribir a ${contact.email} o enviarla por este mismo medio.`
        : 'El correo para propuestas todavía no está publicado. Podés enviarla por este mismo medio.'
      return this.show(
        state,
        'PROPOSAL_CHANNEL',
        `${introduction} ¿Cómo preferís continuar?`,
        [{ id: 'proposal:chat', title: 'Enviar por este medio' }, ...this.navigation()]
      )
    }
    if (action === 'menu:first_consultation') {
      return this.show(state, 'FIRST_CONSULTATION_NAME', 'Para tu primera consulta, decime tu nombre.', this.freeTextNavigation())
    }
    if (action === 'menu:book') {
      const categories = await this.gateway.getCategories({ businessId: input.businessId })
      return this.show({ ...state, context: { mode: 'book', listPage: 0 } }, 'BOOK_CATEGORY', 'Elegí una categoría:', this.categoryOptions(categories, 0))
    }
    if (action === 'menu:appointments') return this.showAppointments(state, input)
    return this.invalid(state, MAIN_OPTIONS)
  }

  private async handleFreeText(raw: string, state: TamaraOptionsBotState, input: HandleInput): Promise<TamaraOptionsBotResult> {
    const value = raw.replace(/\s+/g, ' ').trim()
    if (!value) return this.invalid(state, this.freeTextNavigation(), 'Necesito que escribas una respuesta para continuar.')

    if (state.node === 'PROPOSAL_NAME') {
      if (!this.validName(value)) return this.invalid(state, this.freeTextNavigation(), 'Ingresá un nombre válido de hasta 80 caracteres.')
      return this.show(this.withContext(state, { customerName: value }), 'PROPOSAL_TEXT', `Gracias, ${value}. Detallame la propuesta y Tamara la revisará a la brevedad.`, this.freeTextNavigation())
    }
    if (state.node === 'PROPOSAL_TEXT') {
      if (value.length < 10 || value.length > 1500) return this.invalid(state, this.freeTextNavigation(), 'La propuesta debe tener entre 10 y 1500 caracteres.')
      const next = this.withContext(state, { proposal: value })
      return this.completed(next, `Gracias, ${next.context.customerName}. La propuesta quedó registrada y Tamara se contactará a la brevedad.`, {
        kind: 'proposal', name: next.context.customerName, reason: value
      })
    }
    if (state.node === 'FIRST_CONSULTATION_NAME') {
      if (!this.validName(value)) return this.invalid(state, this.freeTextNavigation(), 'Ingresá un nombre válido de hasta 80 caracteres.')
      return this.show(this.withContext(state, { customerName: value }), 'FIRST_CONSULTATION_REASON', `Gracias, ${value}. Contame brevemente el motivo de la consulta.`, this.freeTextNavigation())
    }
    if (state.node === 'FIRST_CONSULTATION_REASON') {
      if (value.length < 3 || value.length > 1000) return this.invalid(state, this.freeTextNavigation(), 'El motivo debe tener entre 3 y 1000 caracteres.')
      const next = this.withContext(state, { consultationReason: value })
      return this.completed(next, `Gracias, ${next.context.customerName}. Tu consulta quedó registrada y Tamara se contactará a la brevedad.`, {
        kind: 'first_consultation', name: next.context.customerName, reason: value
      })
    }
    if (state.node === 'HUMAN_NAME') {
      if (!this.validName(value)) return this.invalid(state, this.freeTextNavigation(), 'Ingresá un nombre válido de hasta 80 caracteres.')
      return this.show(this.withContext(state, { customerName: value }), 'HUMAN_REASON', `Gracias, ${value}. Contame brevemente en qué necesitás ayuda.`, this.freeTextNavigation())
    }
    if (state.node === 'HUMAN_REASON') {
      if (value.length < 3 || value.length > 1000) return this.invalid(state, this.freeTextNavigation(), 'El motivo debe tener entre 3 y 1000 caracteres.')
      const reason = [state.context.humanReasonPrefix, value].filter(Boolean).join('\n')
      return this.completed(state, 'Gracias. Una persona continuará la atención por este mismo medio.', {
        kind: 'human_attention', name: state.context.customerName, reason
      })
    }
    if (state.node === 'BOOK_SPECIFIC_TIME') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return this.invalid(state, this.freeTextNavigation(), 'Ingresá el horario con formato HH:mm, por ejemplo 14:00.')
      }
      const next = this.withContext(state, { requestedTime: value, selectedTime: undefined, weekOffset: 0, listPage: 0 })
      if (next.context.selectedDate) {
        const times = await this.gateway.getAvailableTimes({
          businessId: input.businessId,
          serviceId: next.context.serviceId!,
          ...(next.context.mode === 'reschedule' && next.context.appointmentServiceIds ? { serviceIds: next.context.appointmentServiceIds } : {}),
          date: next.context.selectedDate,
          appointmentId: next.context.mode === 'reschedule' ? next.context.appointmentId : undefined
        })
        if (times.includes(value)) return this.prepareConfirmation(this.withContext(next, { selectedTime: value }), input)
        const nearby = this.closestTimes(times, value)
        if (nearby.length) {
          return this.show(
            next,
            'BOOK_TIME',
            `No encontré las ${value} para ${next.context.selectedDateLabel || next.context.selectedDate}. Estos son los horarios disponibles más cercanos. Si querés mantener las ${value}, elegí «Buscar por horario»: busca ese horario en los próximos días sin tener que probar día por día.`,
            this.timeOptions(nearby, 0, true)
          )
        }
      }
      return this.searchDatesForTime(next, input, value)
    }
    if (state.node === 'BOOK_SPECIFIC_DATE') {
      const date = this.parseSpecificDate(value, input.now ?? new Date())
      if (!date) {
        return this.invalid(state, this.freeTextNavigation(), 'Ingresá una fecha válida con formato DD/MM/AAAA. Por ejemplo: 25/08/2026.')
      }
      const next = this.withContext(state, {
        selectedDate: date.key,
        selectedDateLabel: date.label,
        selectedTime: undefined,
        requestedTime: undefined,
        listPage: 0
      })
      const times = await this.gateway.getAvailableTimes({
        businessId: input.businessId,
        serviceId: next.context.serviceId!,
        ...(next.context.mode === 'reschedule' && next.context.appointmentServiceIds ? { serviceIds: next.context.appointmentServiceIds } : {}),
        date: date.key,
        appointmentId: next.context.mode === 'reschedule' ? next.context.appointmentId : undefined
      })
      if (!times.length) {
        return this.showDates(next, input, 0, `No hay horarios disponibles para ${date.label}. Estos son los próximos días con lugar:`, true)
      }
      return this.show(next, 'BOOK_TIME', `Elegí un horario para ${date.label}:`, this.timeOptions(times, 0))
    }
    if (state.node === 'BOOK_CUSTOMER_NAME') {
      if (!this.validName(value)) return this.invalid(state, this.freeTextNavigation(), 'Ingresá un nombre válido de hasta 80 caracteres.')
      return this.show(this.withContext(state, { customerName: value }), 'BOOK_CONFIRM', this.bookingSummary({ ...state, context: { ...state.context, customerName: value } }), this.confirmOptions())
    }
    return this.invalid(state, await this.optionsFor(state, input))
  }

  private async selectCategory(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    const categories = await this.gateway.getCategories({ businessId: input.businessId })
    const category = categories.find((item) => action === `category:${item.id}`)
    if (!category) return this.invalid(state, this.categoryOptions(categories))
    const next = this.withContext(state, { categoryId: category.id, categoryName: category.name })
    const services = await this.gateway.getServices({ businessId: input.businessId, categoryId: category.id })
    const paged = this.withContext(next, { listPage: 0 })
    return this.show(paged, 'BOOK_SERVICE', `Elegí un servicio de ${category.name}:`, this.serviceOptions(services, 0))
  }

  private async selectService(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    const services = await this.gateway.getServices({ businessId: input.businessId, categoryId: state.context.categoryId! })
    const service = services.find((item) => action === `service:${item.id}`)
    if (!service) return this.invalid(state, this.serviceOptions(services))
    const next = this.withContext(state, { serviceId: service.id, serviceName: service.name, weekOffset: 0 })
    return this.show(next, 'BOOK_DATE_METHOD', '¿Cómo querés elegir el día?', this.dateMethodOptions())
  }

  private async selectDateMethod(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action === 'date_method:available') return this.showDates(state, input, 0, 'Elegí uno de los próximos días:')
    if (action === 'date_method:exact') {
      return this.show(state, 'BOOK_SPECIFIC_DATE', 'Escribí la fecha exacta con formato DD/MM/AAAA. Por ejemplo: 25/08/2026.', this.freeTextNavigation())
    }
    if (action === 'date_method:time') {
      return this.show(state, 'BOOK_SPECIFIC_TIME', 'Escribí el horario que buscás con formato HH:mm. Por ejemplo: 14:00.', this.freeTextNavigation())
    }
    return this.invalid(state, this.dateMethodOptions())
  }

  private async selectDate(action: string, state: TamaraOptionsBotState, input: HandleInput, options: TamaraBotOption[]) {
    if (action === 'date:next_week') return this.showDates(state, input, (state.context.weekOffset ?? 0) + 1)
    if (action === 'date:specific_time') return this.show(state, 'BOOK_SPECIFIC_TIME', 'Escribí el horario exacto con formato HH:mm. Por ejemplo: 14:00.', this.freeTextNavigation())
    const match = /^date:(\d{4}-\d{2}-\d{2})$/.exec(action)
    if (!match) return this.invalid(state, await this.optionsFor(state, input))
    const date = match[1]!
    const selected = options.find((item) => item.id === action)
    const next = this.withContext(state, { selectedDate: date, selectedDateLabel: selected?.title || date })
    if (state.context.requestedTime) return this.prepareConfirmation(next, input)
    const times = await this.gateway.getAvailableTimes({
      businessId: input.businessId,
      serviceId: state.context.serviceId!,
      ...(state.context.mode === 'reschedule' && state.context.appointmentServiceIds ? { serviceIds: state.context.appointmentServiceIds } : {}),
      date,
      appointmentId: state.context.mode === 'reschedule' ? state.context.appointmentId : undefined
    })
    if (!times.length) return this.showDates(next, input, 0, 'Ese día no tiene horarios disponibles. Estos son los próximos días con lugar:', true)
    const paged = this.withContext(next, { listPage: 0 })
    return this.show(paged, 'BOOK_TIME', `Elegí un horario para ${next.context.selectedDateLabel}:`, this.timeOptions(times, 0))
  }

  private async selectTime(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action === 'time:specific') return this.show(state, 'BOOK_SPECIFIC_TIME', 'Escribí el horario exacto con formato HH:mm. Por ejemplo: 14:00.', this.freeTextNavigation())
    if (action === 'time:search_days' && state.context.requestedTime) {
      return this.searchDatesForTime(state, input, state.context.requestedTime)
    }
    const match = /^time:(\d{2}:\d{2})$/.exec(action)
    if (!match) return this.invalid(state, await this.optionsFor(state, input))
    return this.prepareConfirmation(this.withContext(state, { selectedTime: match[1]! }), input)
  }

  private async prepareConfirmation(state: TamaraOptionsBotState, input: HandleInput) {
    if (state.context.mode === 'reschedule') {
      return this.show(state, 'BOOK_CONFIRM', this.bookingSummary(state), this.confirmOptions())
    }
    const customerName = state.context.customerName || await this.gateway.getCustomerName?.({ businessId: input.businessId, phone: input.phone })
    if (!customerName) return this.show(state, 'BOOK_CUSTOMER_NAME', 'Para completar la reserva, decime tu nombre.', this.freeTextNavigation())
    const next = this.withContext(state, { customerName })
    return this.show(next, 'BOOK_CONFIRM', this.bookingSummary(next), this.confirmOptions())
  }

  private async confirmBooking(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action !== 'booking:confirm') return this.invalid(state, this.confirmOptions())
    if (state.context.mode === 'reschedule') {
      const moved = await this.gateway.reschedule({
        businessId: input.businessId,
        phone: input.phone,
        appointmentId: state.context.appointmentId!,
        serviceId: state.context.appointmentServiceId || state.context.serviceId!,
        ...(state.context.appointmentServiceIds ? { serviceIds: state.context.appointmentServiceIds } : {}),
        date: state.context.selectedDate!,
        time: state.context.selectedTime!
      })
      if (!moved.ok && moved.requiresHandoff) return this.completed(state, moved.reason, {
        kind: 'deposit_review', appointmentId: state.context.appointmentId, reason: moved.reason
      })
      if (!moved.ok) return this.showDates(state, input, 0, `${moved.reason}\n\nElegí otra fecha:`)
      return { ...this.resetSuccess('La reserva fue reprogramada correctamente.'), mutation: { kind: 'rescheduled' as const, appointmentId: state.context.appointmentId } }
    }
    const reserved = await this.gateway.reserve({
      businessId: input.businessId,
      phone: input.phone,
      customerName: state.context.customerName!,
      serviceId: state.context.serviceId!,
      date: state.context.selectedDate!,
      time: state.context.selectedTime!
    })
    if (!reserved.ok) return this.showDates(state, input, 0, `${reserved.reason}\n\nElegí otra fecha:`)
    return {
      ...this.resetSuccess(reserved.requiresDeposit
        ? reserved.depositMessage || 'El horario quedó reservado provisoriamente. Para confirmarlo, seguí las instrucciones de la seña.'
        : 'La reserva quedó confirmada.'),
      mutation: { kind: 'reserved' as const, appointmentId: reserved.appointmentId },
      ...(reserved.depositRequestId ? { depositRequestId: reserved.depositRequestId } : {})
    }
  }

  private async showAppointments(state: TamaraOptionsBotState, input: HandleInput) {
    const appointments = await this.gateway.getUpcomingAppointments({ businessId: input.businessId, phone: input.phone })
    if (!appointments.length) return this.show(state, 'APPOINTMENT_LIST', 'No encontré próximas reservas asociadas a este número.', [
      { id: 'menu:book', title: 'Reservar un horario' }, ...this.navigation()
    ])
    const paged = this.withContext(state, { listPage: 0 })
    return this.show(paged, 'APPOINTMENT_LIST', 'Elegí la reserva que querés consultar:', this.appointmentOptions(appointments, 0))
  }

  private async selectAppointment(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action === 'menu:book') return this.handleMain('menu:book', this.initialState(), input)
    const appointments = await this.gateway.getUpcomingAppointments({ businessId: input.businessId, phone: input.phone })
    const appointment = appointments.find((item) => action === `appointment:${item.id}`)
    if (!appointment) return this.invalid(state, this.appointmentOptions(appointments))
    const next = this.withContext(state, {
      appointmentId: appointment.id,
      appointmentLabel: `${appointment.dateLabel} · ${appointment.time}`,
      appointmentServiceId: appointment.serviceId,
      appointmentServiceIds: appointment.serviceIds,
      serviceId: appointment.serviceId,
      serviceName: appointment.serviceName
    })
    return this.show(next, 'APPOINTMENT_ACTION', [
      `Reserva: ${appointment.dateLabel} a las ${appointment.time}`,
      `Servicio: ${appointment.serviceName}`,
      appointment.depositStatus ? `Seña: ${this.depositLabel(appointment.depositStatus)}` : null,
      '',
      '¿Qué querés hacer?'
    ].filter((line): line is string => line !== null).join('\n'), this.appointmentActionOptions())
  }

  private async handleAppointmentAction(action: string, state: TamaraOptionsBotState, input: HandleInput) {
    if (action === 'appointment:cancel') {
      return this.completed(state, 'Registré tu solicitud. Una persona continuará por este medio antes de cancelar la reserva.', {
        kind: 'cancellation_retention',
        appointmentId: state.context.appointmentId,
        reason: `Solicitud de cancelación con intento de retención: ${state.context.appointmentLabel || state.context.appointmentId}`
      })
    }
    if (action === 'appointment:reschedule') {
      if (!state.context.appointmentServiceId) return this.completed(state, 'Necesitamos revisar esta reserva antes de reprogramarla. Una persona continuará la atención.', {
        kind: 'human_attention', appointmentId: state.context.appointmentId, reason: 'La reserva no tiene un servicio identificable para reprogramación automática.'
      })
      const next = this.withContext(state, { mode: 'reschedule', serviceId: state.context.appointmentServiceId, weekOffset: 0 })
      return this.show(next, 'BOOK_DATE_METHOD', '¿Cómo querés elegir la nueva fecha?', this.dateMethodOptions())
    }
    return this.invalid(state, this.appointmentActionOptions())
  }

  private async showDates(state: TamaraOptionsBotState, input: HandleInput, weekOffset: number, message = 'Elegí un día:', onlyWithAvailability = false) {
    const next = this.withContext(state, { weekOffset, selectedDate: undefined, selectedDateLabel: undefined, selectedTime: undefined, requestedTime: undefined, listPage: 0, onlyAvailableDates: onlyWithAvailability })
    const dates = await this.gateway.getAvailableDates({
      businessId: input.businessId,
      serviceId: next.context.serviceId!,
      ...(next.context.mode === 'reschedule' && next.context.appointmentServiceIds ? { serviceIds: next.context.appointmentServiceIds } : {}),
      weekOffset,
      ...(onlyWithAvailability ? { onlyWithAvailability: true } : {}),
      appointmentId: next.context.mode === 'reschedule' ? next.context.appointmentId : undefined
    })
    const prompt = dates.length ? message : 'No encontré horarios disponibles esa semana. Podés consultar la semana siguiente o pedir ayuda.'
    return this.show(next, 'BOOK_DATE', prompt, this.dateOptions(dates, false, 0))
  }

  private async searchDatesForTime(state: TamaraOptionsBotState, input: HandleInput, requestedTime: string) {
    const next = this.withContext(state, { requestedTime, selectedTime: requestedTime, weekOffset: 0, listPage: 0 })
    const dates = await this.gateway.getAvailableDates({
      businessId: input.businessId,
      serviceId: next.context.serviceId!,
      ...(next.context.mode === 'reschedule' && next.context.appointmentServiceIds ? { serviceIds: next.context.appointmentServiceIds } : {}),
      weekOffset: 0,
      exactTime: requestedTime,
      appointmentId: next.context.mode === 'reschedule' ? next.context.appointmentId : undefined
    })
    if (!dates.length) {
      if (next.context.selectedDate) {
        const times = await this.gateway.getAvailableTimes({
          businessId: input.businessId,
          serviceId: next.context.serviceId!,
          ...(next.context.mode === 'reschedule' && next.context.appointmentServiceIds ? { serviceIds: next.context.appointmentServiceIds } : {}),
          date: next.context.selectedDate,
          appointmentId: next.context.mode === 'reschedule' ? next.context.appointmentId : undefined
        })
        const nearby = this.closestTimes(times, requestedTime)
        if (nearby.length) {
          return this.show(
            this.withContext(next, { selectedTime: undefined }),
            'BOOK_TIME',
            `No encontré disponibilidad a las ${requestedTime} durante los próximos 30 días. Podés elegir uno de estos horarios disponibles más cercanos para ${next.context.selectedDateLabel || next.context.selectedDate}:`,
            this.timeOptions(nearby, 0, true)
          )
        }
      }
      return this.show(next, 'BOOK_DATE', `No encontré disponibilidad a las ${requestedTime} durante los próximos 30 días. Podés consultar otros días o pedir ayuda.`, this.dateNavigation())
    }
    return this.show(next, 'BOOK_DATE', `Encontré estos próximos días disponibles a las ${requestedTime}:`, this.dateOptions(dates, true, 0))
  }

  private async optionsFor(state: TamaraOptionsBotState, input: Pick<HandleInput, 'businessId' | 'phone'>): Promise<TamaraBotOption[]> {
    switch (state.node) {
      case 'MAIN_MENU': return MAIN_OPTIONS
      case 'PROPOSAL_CHANNEL': return [{ id: 'proposal:chat', title: 'Enviar por este medio' }, ...this.navigation()]
      case 'WORKING_HOURS':
      case 'CONTACT': return this.navigation()
      case 'BOOK_CATEGORY': return this.categoryOptions(await this.gateway.getCategories({ businessId: input.businessId }), state.context.listPage ?? 0)
      case 'BOOK_SERVICE': return this.serviceOptions(await this.gateway.getServices({ businessId: input.businessId, categoryId: state.context.categoryId! }), state.context.listPage ?? 0)
      case 'BOOK_DATE_METHOD': return this.dateMethodOptions()
      case 'BOOK_DATE': return this.dateOptions(await this.gateway.getAvailableDates({
        businessId: input.businessId,
        serviceId: state.context.serviceId!,
        ...(state.context.mode === 'reschedule' && state.context.appointmentServiceIds ? { serviceIds: state.context.appointmentServiceIds } : {}),
        weekOffset: state.context.weekOffset ?? 0,
        ...(state.context.requestedTime ? { exactTime: state.context.requestedTime } : {}),
        ...(state.context.onlyAvailableDates ? { onlyWithAvailability: true } : {}),
        appointmentId: state.context.mode === 'reschedule' ? state.context.appointmentId : undefined
      }), Boolean(state.context.requestedTime), state.context.listPage ?? 0)
      case 'BOOK_TIME': return this.timeOptions(await this.gateway.getAvailableTimes({
        businessId: input.businessId,
        serviceId: state.context.serviceId!,
        ...(state.context.mode === 'reschedule' && state.context.appointmentServiceIds ? { serviceIds: state.context.appointmentServiceIds } : {}),
        date: state.context.selectedDate!,
        appointmentId: state.context.mode === 'reschedule' ? state.context.appointmentId : undefined
      }), state.context.listPage ?? 0, Boolean(state.context.requestedTime))
      case 'BOOK_CONFIRM': return this.confirmOptions()
      case 'APPOINTMENT_LIST': return this.appointmentOptions(await this.gateway.getUpcomingAppointments({ businessId: input.businessId, phone: input.phone }), state.context.listPage ?? 0)
      case 'APPOINTMENT_ACTION': return this.appointmentActionOptions()
      default: return this.freeTextNavigation()
    }
  }

  private resolveAction(message: string, interactiveReplyId: string | undefined, options: TamaraBotOption[]) {
    if (interactiveReplyId === TAMARA_STALE_INTERACTIVE_REPLY_ID) return interactiveReplyId
    if (interactiveReplyId) return options.some((option) => option.id === interactiveReplyId) ? interactiveReplyId : null
    const raw = String(message ?? '').trim()
    return options.find((option) => option.title === raw)?.id ?? null
  }

  private categoryOptions(items: TamaraBotCategory[], page = 0) { const paged = this.paginate(items, page, 5); return [...paged.items.map((item) => ({ id: `category:${item.id}`, title: item.name.slice(0, 24) })), ...paged.controls, ...this.navigation()] }
  private serviceOptions(items: TamaraBotService[], page = 0) { const paged = this.paginate(items, page, 5); return [...paged.items.map((item) => ({ id: `service:${item.id}`, title: item.name.slice(0, 24), description: `${item.durationMinutes} minutos` })), ...paged.controls, ...this.navigation()] }
  private dateMethodOptions(): TamaraBotOption[] { return [{ id: 'date_method:available', title: 'Ver próximos días' }, { id: 'date_method:exact', title: 'Elegir fecha exacta' }, { id: 'date_method:time', title: 'Buscar por horario' }, ...this.navigation()] }
  private dateOptions(items: TamaraBotAvailableDate[], exactTime = false, page = 0) { const paged = this.paginate(items, page, 4); return [...paged.items.map((item) => ({ id: `date:${item.date}`, title: item.label.slice(0, 24) })), ...paged.controls, { id: 'date:next_week', title: 'Consultar otra semana' }, ...this.navigation()] }
  private dateNavigation() { return [{ id: 'date:next_week', title: 'Consultar otra semana' }, ...this.navigation()] }
  private timeOptions(items: string[], page = 0, offerSearchByTime = false) { const paged = this.paginate(items, page, 4); return [...paged.items.map((time) => ({ id: `time:${time}`, title: time })), ...paged.controls, offerSearchByTime ? { id: 'time:search_days', title: 'Buscar por horario' } : { id: 'time:specific', title: 'Buscar horario exacto' }, ...this.navigation()] }
  private appointmentOptions(items: TamaraBotAppointment[], page = 0) { const paged = this.paginate(items, page, 5); return [...paged.items.map((item) => ({ id: `appointment:${item.id}`, title: `${item.dateLabel} · ${item.time}`.slice(0, 24), description: item.serviceName.slice(0, 72) })), ...paged.controls, ...this.navigation()] }
  private appointmentActionOptions() { return [{ id: 'appointment:reschedule', title: 'Reprogramar turno' }, { id: 'appointment:cancel', title: 'Cancelar reserva' }, ...this.navigation()] }
  private confirmOptions() { return [{ id: 'booking:confirm', title: 'Confirmar' }, ...this.navigation()] }
  private navigation(includeBack = true): TamaraBotOption[] { return [...(includeBack ? [BACK] : []), MENU, HUMAN] }
  private freeTextNavigation() { return this.navigation() }

  private paginate<T>(items: T[], page: number, size: number) {
    const safePage = Math.min(Math.max(0, page), Math.max(0, Math.ceil(items.length / size) - 1))
    const controls: TamaraBotOption[] = [
      ...(safePage > 0 ? [{ id: 'list:previous', title: 'Opciones anteriores' }] : []),
      ...((safePage + 1) * size < items.length ? [{ id: 'list:next', title: 'Ver más opciones' }] : [])
    ]
    return { items: items.slice(safePage * size, (safePage + 1) * size), controls }
  }

  private closestTimes(items: string[], requestedTime: string) {
    const minutes = (time: string) => {
      const [hours = 0, minute = 0] = time.split(':').map(Number)
      return hours * 60 + minute
    }
    const requestedMinutes = minutes(requestedTime)
    return [...items].sort((left, right) => {
      const distance = Math.abs(minutes(left) - requestedMinutes) - Math.abs(minutes(right) - requestedMinutes)
      return distance || minutes(left) - minutes(right)
    })
  }

  private async goBack(state: TamaraOptionsBotState, input: Pick<HandleInput, 'businessId' | 'phone'>) {
    const previous = state.history.at(-1)
    if (!previous) return this.start(input)
    const restored: TamaraOptionsBotState = { node: previous.node, context: { ...previous.context }, invalidAttempts: 0, history: state.history.slice(0, -1) }
    return this.result(restored, this.promptFor(restored), await this.optionsFor(restored, input))
  }

  private askHumanName(state: TamaraOptionsBotState) {
    return this.show(this.withContext(state, { humanReasonPrefix: this.contextSummary(state) }), 'HUMAN_NAME', 'Para derivarte, decime tu nombre.', this.freeTextNavigation())
  }

  private show(state: TamaraOptionsBotState, node: TamaraOptionsBotNode, message: string, options: TamaraBotOption[]) {
    const next = this.push(state, node)
    return this.result(next, message, options)
  }

  private completed(state: TamaraOptionsBotState, message: string, handoff?: TamaraOptionsBotResult['handoff']): TamaraOptionsBotResult {
    return { status: 'completed', message, options: [], state, ...(handoff ? { handoff } : {}) }
  }

  private resetSuccess(message: string): TamaraOptionsBotResult {
    return this.result(this.initialState(), `${message}\n\nPodés elegir otra opción:`, MAIN_OPTIONS)
  }

  private result(state: TamaraOptionsBotState, message: string, options: TamaraBotOption[]): TamaraOptionsBotResult {
    return { status: 'active', message, options, state }
  }

  private invalid(state: TamaraOptionsBotState, options: TamaraBotOption[], message = 'La respuesta no coincide con ninguna opción disponible. Elegí una opción de la lista.') {
    return this.result({ ...state, invalidAttempts: state.invalidAttempts + 1 }, message, options)
  }

  private push(state: TamaraOptionsBotState, node: TamaraOptionsBotNode): TamaraOptionsBotState {
    if (state.node === node) return { ...state, invalidAttempts: 0 }
    return { node, context: { ...state.context }, invalidAttempts: 0, history: [...state.history, { node: state.node, context: { ...state.context } }].slice(-20) }
  }

  private withContext(state: TamaraOptionsBotState, patch: TamaraOptionsBotContext): TamaraOptionsBotState {
    const context = { ...state.context, ...patch }
    for (const [key, value] of Object.entries(context)) if (value === undefined) delete (context as Record<string, unknown>)[key]
    return { ...state, context }
  }

  private isFreeTextNode(node: TamaraOptionsBotNode) {
    return ['PROPOSAL_NAME', 'PROPOSAL_TEXT', 'FIRST_CONSULTATION_NAME', 'FIRST_CONSULTATION_REASON', 'HUMAN_NAME', 'HUMAN_REASON', 'BOOK_SPECIFIC_DATE', 'BOOK_SPECIFIC_TIME', 'BOOK_CUSTOMER_NAME'].includes(node)
  }

  private parseSpecificDate(value: string, now: Date) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
    if (!match) return null
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    const parsed = new Date(Date.UTC(year, month - 1, day, 12))
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now)
    if (key < today) return null
    const label = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC'
    }).format(parsed).replace(/^./, (letter) => letter.toUpperCase())
    return { key, label }
  }

  private validName(value: string) { return value.length >= 2 && value.length <= 80 && /[\p{L}]/u.test(value) }
  private bookingSummary(state: TamaraOptionsBotState) { return `${state.context.mode === 'reschedule' ? 'Revisá la reprogramación' : 'Revisá la reserva'}:\n\n• Servicio: ${state.context.serviceName || 'Consulta'}\n• Día: ${state.context.selectedDateLabel || state.context.selectedDate}\n• Hora: ${state.context.selectedTime}\n${state.context.customerName ? `• Nombre: ${state.context.customerName}\n` : ''}\n¿Confirmás?` }
  private contextSummary(state: TamaraOptionsBotState) { return state.context.appointmentId ? `Reserva consultada: ${state.context.appointmentLabel || state.context.appointmentId}` : `Sección del bot: ${state.node}` }
  private depositLabel(value: string) { return ({ APPROVED: 'aprobada', PENDING_PROOF: 'pendiente de comprobante', PROOF_RECEIVED: 'en revisión', REJECTED: 'rechazada', EXPIRED: 'vencida' } as Record<string, string>)[value] || value }
  private promptFor(state: TamaraOptionsBotState) {
    const prompts: Partial<Record<TamaraOptionsBotNode, string>> = {
      MAIN_MENU: 'Elegí una opción para continuar:',
      PROPOSAL_CHANNEL: '¿Cómo preferís enviar la propuesta?',
      PROPOSAL_NAME: 'Decime tu nombre.',
      PROPOSAL_TEXT: 'Detallame la propuesta.',
      FIRST_CONSULTATION_NAME: 'Decime tu nombre.',
      FIRST_CONSULTATION_REASON: 'Contame el motivo de la consulta.',
      HUMAN_NAME: 'Decime tu nombre.',
      HUMAN_REASON: 'Contame en qué necesitás ayuda.',
      BOOK_CATEGORY: 'Elegí una categoría:',
      BOOK_SERVICE: 'Elegí un servicio:',
      BOOK_DATE_METHOD: '¿Cómo querés elegir el día?',
      BOOK_DATE: 'Elegí un día:',
      BOOK_SPECIFIC_DATE: 'Escribí la fecha con formato DD/MM/AAAA.',
      BOOK_TIME: 'Elegí un horario:',
      BOOK_SPECIFIC_TIME: 'Escribí el horario con formato HH:mm.',
      BOOK_CUSTOMER_NAME: 'Decime tu nombre.',
      BOOK_CONFIRM: this.bookingSummary(state),
      APPOINTMENT_LIST: 'Elegí una reserva:',
      APPOINTMENT_ACTION: '¿Qué querés hacer con la reserva?',
      WORKING_HOURS: 'Horarios de atención.',
      CONTACT: 'Redes y contacto.'
    }
    return prompts[state.node] || 'Elegí una opción:'
  }

  private initialState(): TamaraOptionsBotState { return { node: 'MAIN_MENU', invalidAttempts: 0, context: {}, history: [] } }

  private sanitizeState(input?: Partial<TamaraOptionsBotState> | null): TamaraOptionsBotState {
    const validNodes = new Set<TamaraOptionsBotNode>([
      'MAIN_MENU', 'WORKING_HOURS', 'CONTACT', 'PROPOSAL_CHANNEL', 'PROPOSAL_NAME', 'PROPOSAL_TEXT',
      'FIRST_CONSULTATION_NAME', 'FIRST_CONSULTATION_REASON', 'HUMAN_NAME', 'HUMAN_REASON', 'BOOK_CATEGORY',
      'BOOK_SERVICE', 'BOOK_DATE_METHOD', 'BOOK_DATE', 'BOOK_SPECIFIC_DATE', 'BOOK_TIME', 'BOOK_SPECIFIC_TIME', 'BOOK_CUSTOMER_NAME', 'BOOK_CONFIRM',
      'APPOINTMENT_LIST', 'APPOINTMENT_ACTION'
    ])
    if (!input?.node || !validNodes.has(input.node)) return this.initialState()
    return {
      node: input.node,
      invalidAttempts: Number.isInteger(input.invalidAttempts) ? Math.max(0, Number(input.invalidAttempts)) : 0,
      context: input.context && typeof input.context === 'object' ? { ...input.context } : {},
      history: Array.isArray(input.history)
        ? input.history.filter((item) => item && validNodes.has(item.node) && item.context && typeof item.context === 'object').slice(-20)
        : []
    }
  }
}
