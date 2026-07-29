import type { BookingV2DomainCatalog } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption } from './booking-v2-domain.js'
import type { BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { ANY_PROFESSIONAL_ID, type BookingDraft, type BookingField } from './booking-v2-state.js'

export type BookingV2RenderInput = {
  plan: BookingV2MessagePlan
  draft: BookingDraft
  catalog?: BookingV2DomainCatalog | null
  availabilityOptions?: BookingV2AvailabilityOption[]
  unavailableDate?: string | null
  serviceSuggestions?: BookingV2DomainCatalog['services']
}

export function renderBookingV2Response(input: BookingV2RenderInput): string {
  if (input.plan.type === 'handoff') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    const waitNotice = 'La respuesta puede demorar unos minutos, pero van a continuar con vos por acá.'
    if (input.plan.reason === 'photo_required') {
      return service
        ? `Para evaluar ${service.name}, enviame una foto clara del estado actual y, si tenés, otra del resultado que buscás. Cuando la recibamos, te voy a derivar con una persona del equipo para que la revise. ${waitNotice}`
        : `Enviame una foto clara del estado actual y, si tenés, otra del resultado que buscás. Cuando la recibamos, te voy a derivar con una persona del equipo para que la revise. ${waitNotice}`
    }
    if (input.plan.reason === 'quote_required') {
      return service
        ? `${service.name} requiere un presupuesto personalizado. Te derivo con una persona del local para que pueda prepararlo. ${waitNotice}`
        : `Este servicio requiere un presupuesto personalizado. Te derivo con una persona del local para que pueda prepararlo. ${waitNotice}`
    }
    if (input.plan.reason === 'advisor_required') {
      return service
        ? `${service.name} requiere asesoramiento antes de coordinar. Te derivo con una persona del local para que pueda orientarte. ${waitNotice}`
        : `Este servicio requiere asesoramiento antes de coordinar. Te derivo con una persona del local para que pueda orientarte. ${waitNotice}`
    }
    if (input.plan.reason === 'estimate_quote_requested') {
      return service
        ? `Perfecto. Te derivo con una persona del local para preparar un presupuesto exacto de ${service.name}. ${waitNotice}`
        : `Perfecto. Te derivo con una persona del local para preparar un presupuesto exacto. ${waitNotice}`
    }
    if (input.plan.reason === 'service_validation_uncertain') {
      return service
        ? `Para asegurarnos de que ${service.name} sea la opción correcta, te derivo con una persona del equipo para que pueda orientarte. ${waitNotice}`
        : `Para recomendarte el servicio correcto, te derivo con una persona del equipo. ${waitNotice}`
    }
    if (input.plan.reason === 'no_compatible_professional') {
      return service
        ? `Por el momento no tengo profesionales habilitados para ${service.name}. Te derivo con una persona del local para revisarlo. ${waitNotice}`
        : `Por el momento no tengo profesionales disponibles. Te derivo con una persona del local. ${waitNotice}`
    }
    return `Te derivo con una persona para que pueda ayudarte mejor. ${waitNotice}`
  }

  if (input.plan.type === 'ask_service_validation') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    const message = service?.validationMessage?.trim() ||
      `Elegiste ${service?.name ?? 'este servicio'}.`
    const question = service?.validationQuestion?.trim() ||
      `¿Seguimos con ${service?.name ?? 'este servicio'}?`
    return [
      ...(input.plan.reason === 'not_understood'
        ? ['No pude confirmar si este servicio es el que necesitás.']
        : []),
      message,
      question,
      'Si no estás seguro/a, decime y te ayudo a elegir.'
    ].join('\n\n')
  }

  if (input.plan.type === 'ask_estimate_option') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    const explanation = service?.estimateExplanation?.trim()
    const question = service?.estimateQuestion?.trim() || '¿Cuál de estas opciones se parece más a tu caso?'
    const options = service?.estimateOptions ?? []
    return [
      ...(input.plan.reason === 'not_understood'
        ? ['Disculpame, no pude identificar la opción.']
        : explanation ? [explanation] : []),
      question,
      ...options.map((option, index) => `• ${index + 1}. ${option.label}`)
    ].join('\n')
  }

  if (input.plan.type === 'show_estimate') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    const estimate = input.plan.priceMax !== null && input.plan.priceMax !== input.plan.priceMin
      ? `entre ${formatMoney(input.plan.priceMin)} y ${formatMoney(input.plan.priceMax)}`
      : `desde ${formatMoney(input.plan.priceMin)}`
    return [
      `Para ${input.plan.optionLabel}, el valor estimado de ${service?.name ?? 'este servicio'} es ${estimate}.`,
      ...(input.plan.note ? [input.plan.note] : []),
      ...(service?.estimateDisclaimer?.trim() ? [service.estimateDisclaimer.trim()] : []),
      input.plan.allowsBooking
        ? '¿Querés continuar con la reserva o preferís que el equipo prepare un presupuesto exacto?'
        : '¿Querés que el equipo prepare un presupuesto exacto?'
    ].join('\n\n')
  }

  if (input.plan.type === 'ask_estimate_decision') {
    return input.plan.allowsBooking
      ? '¿Preferís continuar con la reserva o pedir un presupuesto exacto?'
      : '¿Querés que el equipo prepare un presupuesto exacto?'
  }

  if (input.plan.type === 'ask_field') {
    if (input.plan.field === 'date' && input.unavailableDate) {
      return `El ${formatDate(input.unavailableDate)} no tiene horarios disponibles para esa reserva. ¿Querés probar mañana u otra fecha?`
    }
    if (input.plan.field === 'time' && input.availabilityOptions?.length) {
      return [
        'Estos son todos los horarios disponibles 😊',
        formatAvailabilityOptions(input.availabilityOptions),
        '¿Cuál te queda mejor?'
      ].join('\n')
    }
    const question = questionForField(
      input.plan.field,
      input.draft,
      input.catalog,
      input.serviceSuggestions
    )
    if (input.plan.reason === 'not_understood') {
      return `Disculpame, no te entendí bien. ${question}`
    }
    return question
  }

  if (input.plan.type === 'confirm_field') {
    return confirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  if (input.plan.type === 'confirm_correction') {
    return correctionConfirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  return bookingConfirmation(input.draft, input.catalog)
}

function questionForField(
  field: BookingField,
  draft: BookingDraft,
  catalog?: BookingV2DomainCatalog | null,
  serviceSuggestions?: BookingV2DomainCatalog['services']
) {
  if (field === 'name') return '¿Me decís tu nombre?'
  if (field === 'service') return serviceQuestion(catalog, serviceSuggestions)
  if (field === 'professional') return professionalQuestion(draft.service, catalog)
  if (field === 'date') return 'Perfecto 😊 ¿Qué día te gustaría venir? Puede ser hoy, mañana o una fecha específica.'
  return '¿Qué horario preferís?'
}

function serviceQuestion(
  catalog?: BookingV2DomainCatalog | null,
  serviceSuggestions?: BookingV2DomainCatalog['services']
) {
  if (!catalog?.services.length) return '¿Qué servicio querés reservar?'
  const services = serviceSuggestions?.length ? serviceSuggestions : catalog.services
  const suggestionCategory = serviceSuggestions?.length
    ? sharedCategory(services)
    : null
  const serviceLines = suggestionCategory
    ? services.map(formatServiceOption)
    : formatServiceOptions(services)
  const containsAssistedServices = services.some((service) =>
    service.requiresPhoto ||
    (service.attentionMode !== undefined && service.attentionMode !== 'DIRECT_BOOKING')
  )

  return [
    serviceSuggestions?.length
      ? suggestionCategory
        ? `Para ${suggestionCategory} tengo estas opciones 😊`
        : 'Encontré más de una opción parecida 😊 ¿Cuál de estas querés?'
      : 'Estos son los servicios disponibles 😊',
    ...serviceLines,
    containsAssistedServices ? '¿Cuál te interesa?' : '¿Cuál querés reservar?'
  ].join('\n')
}

function sharedCategory(services: BookingV2DomainCatalog['services']) {
  const categories = Array.from(new Set(
    services
      .map((service) => service.category?.trim())
      .filter((category): category is string => Boolean(category))
  ))
  return categories.length === 1 ? categories[0] ?? null : null
}

export function formatServiceOptions(
  services: BookingV2DomainCatalog['services']
) {
  const hasCategories = services.some((service) => service.category)
  if (!hasCategories) return services.map(formatServiceOption)

  const groups = new Map<string, BookingV2DomainCatalog['services']>()
  for (const service of services) {
    const category = service.category?.trim() || 'Otros'
    const group = groups.get(category) ?? []
    group.push(service)
    groups.set(category, group)
  }

  return Array.from(groups.entries()).flatMap(([category, options]) => [
    `${category}:`,
    ...options.map(formatServiceOption)
  ])
}

function formatServiceOption(service: BookingV2DomainCatalog['services'][number]) {
  const price = service.price === null
    ? 'precio a consultar'
    : `${service.priceMode === 'STARTING_AT' ? 'desde ' : ''}${formatMoney(service.price)}`
  const attention = service.attentionMode === 'GUIDED_ESTIMATE'
    ? 'estimativo disponible'
    : service.requiresPhoto
    ? 'requiere fotos'
    : service.attentionMode === 'QUOTE'
      ? 'presupuesto personalizado'
      : service.attentionMode === 'ADVISOR'
        ? 'asesoramiento previo'
        : null
  return `• ${service.name} — ${service.duration} min — ${price}${attention ? ` — ${attention}` : ''}`
}

function professionalQuestion(
  serviceId: string | null,
  catalog?: BookingV2DomainCatalog | null
) {
  const professionals = catalog?.professionals.filter((professional) =>
    !serviceId || professional.serviceIds.includes(serviceId)
  ) ?? []

  if (!professionals.length) {
    const service = catalog?.services.find((option) => option.id === serviceId)
    return service
      ? `Por el momento no tengo profesionales habilitados para ${service.name}. Si querés, puedo derivarte con una persona del local para revisarlo.`
      : 'Por el momento no tengo profesionales disponibles. Si querés, puedo derivarte con una persona del local.'
  }

  return [
    'Podés atenderte con:',
    ...professionals.map((professional) => `• ${professional.name}`),
    '• Cualquier profesional',
    '¿Con quién preferís?'
  ].join('\n')
}

function confirmationForField(
  field: BookingField,
  value: string,
  catalog?: BookingV2DomainCatalog | null
) {
  if (field === 'service') return `¿Querés reservar ${labelForService(value, catalog)}?`
  if (field === 'professional') return `¿Querés atenderte con ${labelForProfessional(value, catalog)}?`
  if (field === 'date') return `¿Querés venir el ${formatDate(value)}?`
  if (field === 'time') return `¿Querés reservar a las ${value}?`
  return `¿Tu nombre es ${value}?`
}

function correctionConfirmationForField(
  field: BookingField,
  value: string | null,
  catalog?: BookingV2DomainCatalog | null
) {
  if (value) return confirmationForField(field, value, catalog)
  if (field === 'service') return '¿Querés modificar el servicio?'
  if (field === 'professional') return '¿Querés cambiar de profesional?'
  if (field === 'date') return '¿Querés modificar el día?'
  if (field === 'time') return '¿Querés modificar el horario?'
  return '¿Querés modificar tu nombre?'
}

function bookingConfirmation(draft: BookingDraft, catalog?: BookingV2DomainCatalog | null) {
  return [
    'Perfecto.',
    `¿Confirmás la reserva para ${labelForService(draft.service, catalog)}`,
    `con ${labelForProfessional(draft.professional, catalog)}`,
    `el ${formatDate(draft.date)}`,
    `a las ${draft.time}?`
  ].join(' ')
}

function labelForService(serviceId: string | null, catalog?: BookingV2DomainCatalog | null) {
  return catalog?.services.find((service) => service.id === serviceId)?.name ?? 'el servicio elegido'
}

function labelForProfessional(professionalId: string | null, catalog?: BookingV2DomainCatalog | null) {
  if (professionalId === ANY_PROFESSIONAL_ID) return 'cualquier profesional disponible'
  return catalog?.professionals.find((professional) => professional.id === professionalId)?.name ?? 'el profesional elegido'
}

function formatDate(value: string | null) {
  if (!value) return 'el día elegido'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

function formatAvailabilityOptions(options: BookingV2AvailabilityOption[]) {
  const optionsByProfessional = new Map<string, {
    professionalName: string
    times: Set<string>
  }>()

  for (const option of options) {
    const group = optionsByProfessional.get(option.professionalId) ?? {
      professionalName: option.professionalName,
      times: new Set<string>()
    }
    group.times.add(option.time)
    optionsByProfessional.set(option.professionalId, group)
  }

  return Array.from(optionsByProfessional.values())
    .map((group) =>
      `• ${group.professionalName}: ${Array.from(group.times).sort().join(', ')}`
    )
    .join('\n')
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}
