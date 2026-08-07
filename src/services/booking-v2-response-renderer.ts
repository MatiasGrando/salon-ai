import type { BookingV2DomainCatalog } from './booking-v2-domain.js'
import { catalogCategoryOptions } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption } from './booking-v2-domain.js'
import type { BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { formatCustomerDuration } from './service-duration.js'
import {
  ANY_PROFESSIONAL_ID,
  type BookingDraft,
  type BookingField,
  type BookingV2AgendaItem,
  type BookingV2CatalogNavigation,
  type BookingV2CombinedService
} from './booking-v2-state.js'

export type BookingV2RenderInput = {
  plan: BookingV2MessagePlan
  draft: BookingDraft
  catalog?: BookingV2DomainCatalog | null
  availabilityOptions?: BookingV2AvailabilityOption[]
  unavailableDate?: string | null
  serviceSuggestions?: BookingV2DomainCatalog['services']
  agenda?: BookingV2AgendaItem[]
  catalogNavigation?: BookingV2CatalogNavigation | null
  combinedServices?: BookingV2CombinedService[]
  quoteOnly?: {
    remainingServiceIds: string[]
    estimates: Array<{ serviceId: string; priceMin: number; priceMax: number | null }>
  } | null
}

export function renderBookingV2Response(input: BookingV2RenderInput): string {
  if (input.plan.type === 'ask_service_addons') {
    const services = input.plan.serviceIds
      .map((serviceId) => input.catalog?.services.find((service) => service.id === serviceId))
      .filter((service): service is NonNullable<typeof service> => Boolean(service))
    return [
      '¿Querés sumar alguno de estos servicios a la misma reserva?',
      ...services.map((service) => `• ${service.name} — agrega ${service.duration} min`),
      '• No, continuar'
    ].join('\n')
  }

  if (input.plan.type === 'offer_combined_availability') {
    return [
      `Para el ${formatDate(input.plan.requestedDate)} no encontré un bloque continuo disponible para realizar todos los servicios juntos.`,
      [
        'La próxima disponibilidad conjunta es:',
        ...formatDatedAvailabilityOptions(input.plan.options)
      ].join('\n'),
      [
        'Si necesitás atenderte antes, también puedo buscar los servicios por separado.',
        '¿Qué preferís?',
        '• Elegir una disponibilidad conjunta',
        '• Buscar cada servicio por separado'
      ].join('\n')
    ].join('\n\n')
  }

  if (input.plan.type === 'offer_separate_services') {
    return input.plan.reason === 'blocked_combination'
      ? 'Estos servicios no están habilitados para realizarse juntos. ¿Querés que busque un turno para cada servicio por separado?'
      : 'No encontré un profesional habilitado para realizar todos estos servicios. ¿Querés que busque cada servicio por separado?'
  }

  if (input.plan.type === 'ask_service_edit_target') {
    const labels = input.plan.serviceIds.map((serviceId) =>
      labelForService(serviceId, input.catalog)
    )
    const action = input.plan.action === 'change' ? 'cambiar' : 'quitar'
    return [
      `¿Cuál servicio querés ${action}?`,
      ...labels.map((label) => `• ${label}`),
      ...(labels.length > 1 ? [`• ${input.plan.action === 'change' ? 'Cambiar' : 'Quitar'} ambos servicios`] : []),
      'Todavía no modifiqué tu selección.'
    ].join('\n')
  }

  if (input.plan.type === 'confirm_service_edit') {
    const labels = input.plan.serviceIds.map((serviceId) =>
      labelForService(serviceId, input.catalog)
    ).join(' y ')
    return input.plan.action === 'change'
      ? `¿Confirmás que querés cambiar ${labels}? Todavía no modifiqué tu selección.`
      : `¿Confirmás que querés quitar ${labels} de la reserva? Todavía no modifiqué tu selección.`
  }

  if (input.plan.type === 'ask_service_replacement') {
    const selectedServiceIds = input.plan.selectedServiceIds
    const availableServices = (input.catalog?.services ?? []).filter((service) =>
      !selectedServiceIds.includes(service.id)
    )
    return [
      'Listo, conservé los demás servicios.',
      '¿Qué servicio querés elegir en reemplazo?',
      ...formatServiceOptions(availableServices)
    ].join('\n')
  }

  if (input.plan.type === 'show_service_preview_and_ask_name') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    if (!service) return '¿Me decís tu nombre?'
    return renderAssistedServicePreview({
      service,
      agenda: input.agenda ?? []
    })
  }

  if (input.plan.type === 'handoff') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    const waitNotice = 'La respuesta puede demorar unos minutos, pero van a continuar con vos por acá.'
    if (input.plan.reason === 'category_advice_requested') {
      return `Perfecto. Te derivo con una persona del equipo para ayudarte a elegir el servicio de ${input.plan.categoryName ?? 'esta categoría'}. ${waitNotice}`
    }
    if (input.plan.reason === 'combination_review_required') {
      return `Esta combinación de servicios necesita que el equipo la revise antes de reservar. Conservo todos los servicios de tu solicitud y te derivo para evaluarlos. ${waitNotice}`
    }
    if (input.plan.reason === 'photo_required') {
      return service
        ? renderAssistedServiceHandoff({
            service,
            customerName: input.draft.name,
            agenda: input.agenda ?? [],
            requiresPhotos: true
          })
        : `Enviame una foto clara del estado actual y, si tenés, otra del resultado que buscás. Cuando la recibamos, te voy a derivar con una persona del equipo para que la revise. ${waitNotice}`
    }
    if (input.plan.reason === 'quote_required') {
      return service
        ? renderAssistedServiceHandoff({
            service,
            customerName: input.draft.name,
            agenda: input.agenda ?? [],
            requiresPhotos: false
          })
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
    if (input.plan.reason === 'service_selection_uncertain') {
      return `Te derivo con una persona del equipo para que pueda ayudarte a elegir el servicio más adecuado. ${waitNotice}`
    }
    if (input.plan.reason === 'no_compatible_professional') {
      return service
        ? `Por el momento no tengo profesionales habilitados para ${service.name}. Te derivo con una persona del local para revisarlo. ${waitNotice}`
        : `Por el momento no tengo profesionales disponibles. Te derivo con una persona del local. ${waitNotice}`
    }
    return `Te derivo con una persona para que pueda ayudarte mejor. ${waitNotice}`
  }

  if (input.plan.type === 'ask_category_advice_confirmation') {
    return [
      ...(input.plan.reason === 'not_understood'
        ? ['No pude confirmar qué preferís.']
        : []),
      `Para ayudarte a elegir un servicio de ${input.plan.categoryName}, voy a derivar la conversación con un profesional.`,
      'La respuesta puede no ser inmediata.',
      '¿Querés continuar?',
      '• Sí, hablar con un profesional',
      '• Volver a los tratamientos'
    ].join('\n\n')
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
      ...(input.quoteOnly
        ? [quoteOnlyTotal(input.quoteOnly.estimates, input.plan.priceMin, input.plan.priceMax)]
        : []),
      input.quoteOnly
        ? quoteOnlyFollowUp(input.quoteOnly.remainingServiceIds, input.catalog)
        : input.plan.allowsBooking
        ? '¿Querés continuar con la reserva o preferís que el equipo prepare un presupuesto exacto?'
        : '¿Querés que el equipo prepare un presupuesto exacto?'
    ].join('\n\n')
  }

  if (input.plan.type === 'show_base_estimate') {
    const service = input.catalog?.services.find((option) => option.id === input.draft.service)
    return [
      `El valor estimado de ${service?.name ?? 'este servicio'} es desde ${formatMoney(input.plan.priceMin)}.`,
      ...(service?.estimateExplanation?.trim() ? [service.estimateExplanation.trim()] : []),
      ...(service?.estimateDisclaimer?.trim() ? [service.estimateDisclaimer.trim()] : []),
      ...(input.quoteOnly
        ? [quoteOnlyTotal(input.quoteOnly.estimates, input.plan.priceMin, null)]
        : []),
      input.quoteOnly
        ? quoteOnlyFollowUp(input.quoteOnly.remainingServiceIds, input.catalog)
        : input.plan.allowsBooking
        ? '¿Querés continuar con la reserva o preferís que el equipo prepare un presupuesto exacto?'
        : '¿Querés que el equipo prepare un presupuesto exacto?'
    ].join('\n\n')
  }

  if (input.plan.type === 'ask_estimate_decision') {
    if (input.quoteOnly) return quoteOnlyFollowUp(input.quoteOnly.remainingServiceIds, input.catalog)
    return input.plan.allowsBooking
      ? '¿Preferís continuar con la reserva o pedir un presupuesto exacto?'
      : '¿Querés que el equipo prepare un presupuesto exacto?'
  }

  if (input.plan.type === 'quote_complete') {
    const details = input.plan.estimates.map((estimate) => {
      const service = input.catalog?.services.find((candidate) => candidate.id === estimate.serviceId)
      const amount = estimate.priceMax !== null && estimate.priceMax !== estimate.priceMin
        ? `entre ${formatMoney(estimate.priceMin)} y ${formatMoney(estimate.priceMax)}`
        : formatMoney(estimate.priceMin)
      return `• ${service?.name ?? 'Servicio'}: ${amount}`
    })
    const total = quoteOnlyTotal(input.plan.estimates.slice(0, -1),
      input.plan.estimates.at(-1)?.priceMin ?? 0,
      input.plan.estimates.at(-1)?.priceMax ?? null)
    return [
      'Listo, ya revisamos los estimativos solicitados.',
      ...details,
      total,
      'Si querés reservar, decímelo y avanzamos con el turno.'
    ].filter(Boolean).join('\n')
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
      input.combinedServices ?? [],
      input.catalog,
      input.serviceSuggestions,
      input.catalogNavigation,
      input.plan.misunderstandingCount,
      input.availabilityOptions,
      Boolean(input.quoteOnly)
    )
    if (input.plan.reason === 'not_understood') {
      if (
        input.plan.field === 'service' &&
        input.catalog?.displayMode === 'CATEGORIES_FIRST'
      ) {
        return question
      }
      return `Disculpame, no te entendí bien. ${question}`
    }
    return question
  }

  if (input.plan.type === 'clarify_professional') {
    const professionalNames = input.plan.professionalIds
      .map((professionalId) => labelForProfessional(professionalId, input.catalog))
    return [
      'Encontré más de un profesional que coincide con ese nombre.',
      ...professionalNames.map((professionalName) => `• ${professionalName}`),
      '¿Con cuál preferís atenderte? Decime el nombre completo.'
    ].join('\n')
  }

  if (input.plan.type === 'confirm_field') {
    if (input.plan.field === 'professional') {
      return professionalSuggestionConfirmation(
        input.plan.value,
        input.draft.service,
        input.catalog
      )
    }
    return confirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  if (input.plan.type === 'confirm_correction') {
    return correctionConfirmationForField(input.plan.field, input.plan.value, input.catalog)
  }

  return bookingConfirmation(input.draft, input.catalog, input.combinedServices)
}

function quoteOnlyFollowUp(remainingServiceIds: string[], catalog?: BookingV2DomainCatalog | null) {
  const nextServiceId = remainingServiceIds[0]
  const nextService = nextServiceId
    ? catalog?.services.find((service) => service.id === nextServiceId)
    : null
  return nextService
    ? `¿Querés seguir con el estimativo de ${nextService.name}?`
    : 'Si querés un presupuesto exacto, puedo derivarte con el equipo.'
}

function quoteOnlyTotal(
  estimates: Array<{ priceMin: number; priceMax: number | null }>,
  priceMin: number,
  priceMax: number | null
) {
  if (!estimates.length) return ''
  const totalMin = estimates.reduce((total, estimate) => total + estimate.priceMin, priceMin)
  const totalMax = estimates.some((estimate) => estimate.priceMax === null) || priceMax === null
    ? null
    : estimates.reduce((total, estimate) => total + (estimate.priceMax ?? estimate.priceMin), priceMax)
  return totalMax !== null && totalMax !== totalMin
    ? `El total estimado hasta ahora es entre ${formatMoney(totalMin)} y ${formatMoney(totalMax)}.`
    : `El total estimado hasta ahora es ${formatMoney(totalMin)}.`
}

function renderAssistedServiceHandoff(input: {
  service: BookingV2DomainCatalog['services'][number]
  customerName: string | null
  agenda: BookingV2AgendaItem[]
  requiresPhotos: boolean
}) {
  const greeting = input.customerName
    ? `¡Perfecto, ${input.customerName}! 😊`
    : '¡Perfecto! 😊'
  const price = input.service.price === null
    ? `${input.service.name} requiere un presupuesto personalizado.`
    : input.service.priceMode === 'STARTING_AT'
      ? `Para ${input.service.name}, el precio comienza desde ${formatMoney(input.service.price)}.`
      : `Para ${input.service.name}, el precio es ${formatMoney(input.service.price)}.`
  const explanation = input.service.estimateExplanation?.trim() ||
    (input.service.priceMode === 'STARTING_AT'
      ? 'El valor final puede variar después de evaluar el trabajo necesario.'
      : null)
  const requestedAvailability = input.agenda.some((item) =>
    item.intent === 'check_availability' && item.status !== 'completed'
  )
  const serviceInformationAlreadyProvided = input.agenda.some((item) =>
    item.intent === 'request_quote' &&
    item.serviceId === input.service.id &&
    item.serviceInformationProvided
  )

  return [
    greeting,
    ...(!serviceInformationAlreadyProvided
      ? [[price, explanation].filter(Boolean).join(' ')]
      : []),
    input.requiresPhotos
      ? `Para darte un presupuesto más preciso, enviame una foto clara del estado actual y, si tenés, otra del resultado que buscás.`
      : `Te derivo con una persona del local para que pueda preparar un presupuesto personalizado y preciso.`,
    'El equipo lo revisará y puede demorar unos minutos en responderte por acá.',
    ...(requestedAvailability
      ? ['Después de confirmar el presupuesto, seguimos con los profesionales y horarios disponibles.']
      : [])
  ].join('\n\n')
}

function renderAssistedServicePreview(input: {
  service: BookingV2DomainCatalog['services'][number]
  agenda: BookingV2AgendaItem[]
}) {
  const price = input.service.price === null
    ? `${input.service.name} requiere un presupuesto personalizado.`
    : input.service.priceMode === 'STARTING_AT'
      ? `Para ${input.service.name}, el precio comienza desde ${formatMoney(input.service.price)}.`
      : `Para ${input.service.name}, el precio es ${formatMoney(input.service.price)}.`
  const explanation = input.service.estimateExplanation?.trim() ||
    (input.service.priceMode === 'STARTING_AT'
      ? 'El valor final puede variar después de evaluar el trabajo necesario.'
      : null)
  const requestedAvailability = input.agenda.some((item) =>
    item.intent === 'check_availability' && item.status !== 'completed'
  )

  return [
    [price, explanation].filter(Boolean).join(' '),
    ...(input.service.requiresPhoto
      ? ['Para darte un presupuesto más preciso, después te voy a pedir una foto clara de tu cabello actual y, si tenés, otra del resultado que buscás.']
      : ['El equipo puede preparar un presupuesto preciso para tu caso.']),
    ...(requestedAvailability
      ? ['Después de confirmar el presupuesto, seguimos con los profesionales y horarios disponibles.']
      : []),
    '¿Me decís tu nombre?'
  ].join('\n\n')
}

function questionForField(
  field: BookingField,
  draft: BookingDraft,
  combinedServices: BookingV2CombinedService[],
  catalog?: BookingV2DomainCatalog | null,
  serviceSuggestions?: BookingV2DomainCatalog['services'],
  catalogNavigation?: BookingV2CatalogNavigation | null,
  misunderstandingCount = 0,
  availabilityOptions?: BookingV2AvailabilityOption[],
  quoteOnly = false
) {
  if (field === 'name') return '¿Me decís tu nombre?'
  if (field === 'service') {
    return serviceQuestion(catalog, serviceSuggestions, catalogNavigation, misunderstandingCount, quoteOnly)
  }
  if (field === 'professional') {
    return professionalQuestion(
      [draft.service, ...combinedServices.map((service) => service.serviceId)]
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
      draft.time,
      catalog,
      availabilityOptions
    )
  }
  if (field === 'date') return 'Perfecto 😊 ¿Qué día te gustaría venir? Puede ser hoy, mañana o una fecha específica.'
  return '¿Qué horario preferís?'
}

function serviceQuestion(
  catalog?: BookingV2DomainCatalog | null,
  serviceSuggestions?: BookingV2DomainCatalog['services'],
  catalogNavigation?: BookingV2CatalogNavigation | null,
  misunderstandingCount = 0,
  quoteOnly = false
) {
  if (!catalog?.services.length) return quoteOnly
    ? '¿Sobre qué servicio querés pedir el presupuesto?'
    : '¿Qué servicio querés reservar?'
  const categories = catalogCategoryOptions(catalog)
  const categoriesFirst = catalog.displayMode === 'CATEGORIES_FIRST' && categories.some((category) =>
    category.name !== 'Otros'
  )

  if (categoriesFirst && catalogNavigation?.pendingCategoryName) {
    return `¿Te referís a la categoría ${catalogNavigation.pendingCategoryName}?`
  }
  if (categoriesFirst && misunderstandingCount >= 2) {
    return [
      'No estoy pudiendo identificar qué opción necesitás.',
      '• Ver todos los servicios',
      '• Hablar con el equipo',
      '• Volver a empezar'
    ].join('\n')
  }

  if (
    categoriesFirst &&
    !serviceSuggestions?.length &&
    catalogNavigation?.view !== 'ALL_SERVICES'
  ) {
    return [
      misunderstandingCount === 1
        ? 'No estoy segura de qué categoría buscás. ¿Cuál de estas opciones se acerca más?'
        : '¿Qué tipo de servicio buscás? 😊',
      ...categories.map((category) => `• ${category.name}`),
      '• Ver todos los servicios',
      '¿Cuál te interesa?'
    ].join('\n')
  }
  const services = serviceSuggestions?.length ? serviceSuggestions : catalog.services
  const suggestionCategory = serviceSuggestions?.length
    ? sharedCategory(services)
    : null
  const serviceLines = suggestionCategory
    ? [
        ...services.map(formatServiceOption),
        ...(categoryOffersAdvice(services)
          ? formatCategoryAdviceOption(suggestionCategory)
          : [])
      ]
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
    ...(services.length > 1 && !services.some((service) => service.categoryAdviceEnabled)
      ? ['• No sé cuál necesito']
      : []),
    quoteOnly ? '¿Cuál querés cotizar?' : containsAssistedServices ? '¿Cuál te interesa?' : '¿Cuál querés reservar?'
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
    ...options.map(formatServiceOption),
    ...(categoryOffersAdvice(options) ? formatCategoryAdviceOption(category) : [])
  ])
}

function categoryOffersAdvice(services: BookingV2DomainCatalog['services']) {
  return services.some((service) => service.categoryAdviceEnabled === true)
}

function formatCategoryAdviceOption(category: string) {
  return [
    `• Hablar con un profesional para elegir mi servicio de ${category}`,
    '  La consulta se deriva al equipo y la respuesta puede demorar.'
  ]
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
  return `• ${service.name} — ${formatCustomerDuration(service)} — ${price}${attention ? ` — ${attention}` : ''}`
}

function professionalQuestion(
  serviceIds: string[],
  selectedTime: string | null,
  catalog?: BookingV2DomainCatalog | null,
  availabilityOptions?: BookingV2AvailabilityOption[]
) {
  const availableProfessionalIds = selectedTime && availabilityOptions
    ? new Set(
        availabilityOptions
          .filter((option) => option.time === selectedTime)
          .map((option) => option.professionalId)
      )
    : null
  const professionals = catalog?.professionals.filter((professional) =>
    (serviceIds.length === 0 || serviceIds.every((serviceId) =>
      professional.serviceIds.includes(serviceId)
    )) &&
    (!availableProfessionalIds || availableProfessionalIds.has(professional.id))
  ) ?? []

  if (!professionals.length) {
    const service = catalog?.services.find((option) => option.id === serviceIds[0])
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

function professionalSuggestionConfirmation(
  professionalId: string,
  serviceId: string | null,
  catalog?: BookingV2DomainCatalog | null
) {
  const suggestedName = labelForProfessional(professionalId, catalog)
  const professionals = catalog?.professionals.filter((professional) =>
    !serviceId || professional.serviceIds.includes(serviceId)
  ) ?? []

  return [
    'Podés atenderte con:',
    ...professionals.map((professional) => `• ${professional.name}`),
    '• Cualquier profesional',
    `¿Te agendo con ${suggestedName}?`
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

function bookingConfirmation(
  draft: BookingDraft,
  catalog?: BookingV2DomainCatalog | null,
  combinedServices: BookingV2CombinedService[] = []
) {
  const services = [draft.service, ...combinedServices.map((service) => service.serviceId)]
    .map((serviceId) => catalog?.services.find((service) => service.id === serviceId))
    .filter((service): service is NonNullable<typeof service> => Boolean(service))
  const serviceLabel = services.length
    ? services.map((service) => service.name).join(' + ')
    : 'el servicio elegido'
  const duration = services.reduce((total, service) => total + service.duration, 0)
  return [
    'Perfecto.',
    `¿Confirmás la reserva para ${serviceLabel}`,
    ...(services.length > 1 && duration ? [`(${duration} min en total)`] : []),
    `con ${labelForProfessional(draft.professional, catalog)}`,
    `el ${formatDate(draft.date)}`,
    `a las ${draft.time}?`
  ].join(' ')
}

function formatDatedAvailabilityOptions(
  options: Array<{ date: string; time: string; professionalName: string }>
) {
  return options.map((option) =>
    `• ${formatDate(option.date)} a las ${option.time} con ${option.professionalName}`
  )
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
