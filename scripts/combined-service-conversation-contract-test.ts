import assert from 'node:assert/strict'
import { BookingV2Engine } from '../src/services/booking-v2-engine.js'
import {
  BookingV2DomainService,
  createBookingV2DomainCatalog,
  type BookingV2DomainCatalog
} from '../src/services/booking-v2-domain.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import {
  acceptField,
  addCombinedServices,
  createEmptyBookingV2State,
  type BookingV2State
} from '../src/services/booking-v2-state.js'

const services = [
  {
    id: 'alisado',
    name: 'Alisado',
    aliases: ['alisado sin formol'],
    description: 'Alisado sin formol.',
    duration: 90,
    price: 85000,
    category: 'Nutrición',
    suggestedAddonIds: ['corte', 'lavado']
  },
  {
    id: 'corte',
    name: 'Corte',
    aliases: ['corte de pelo'],
    description: 'Corte de cabello.',
    duration: 30,
    price: 27000,
    category: 'Cortes'
  },
  {
    id: 'lavado',
    name: 'Lavado',
    aliases: ['lavado de pelo'],
    description: 'Lavado profundo.',
    duration: 20,
    price: 15000,
    category: 'Otros'
  },
  {
    id: 'color',
    name: 'Color completo',
    aliases: ['color', 'tintura'],
    description: 'Coloración completa.',
    duration: 90,
    price: 90000,
    category: 'Color'
  },
  {
    id: 'nutricion',
    name: 'Nutrición',
    aliases: ['tratamiento nutritivo'],
    description: 'Tratamiento nutritivo.',
    duration: 30,
    price: 30000,
    category: 'Nutrición'
  },
  {
    id: 'brushing',
    name: 'Brushing',
    aliases: ['secado'],
    description: 'Brushing y secado.',
    duration: 30,
    price: 25000,
    category: 'Otros'
  }
] as const

const professionals = [
  {
    id: 'ana',
    name: 'Ana',
    serviceIds: services.map((service) => service.id)
  },
  {
    id: 'bea',
    name: 'Bea',
    serviceIds: ['corte']
  }
]

function catalog(input?: {
  bookingFlowOrder?: 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST'
  professionals?: Array<{ id: string; name: string; serviceIds: string[] }>
  combinationRules?: Array<{
    serviceAId: string
    serviceBId: string
    policy: 'ALLOWED' | 'REVIEW_REQUIRED' | 'BLOCKED'
  }>
  guidedColor?: boolean
}) {
  return createBookingV2DomainCatalog({
    ...(input?.bookingFlowOrder ? { bookingFlowOrder: input.bookingFlowOrder } : {}),
    services: services.map((service) => service.id === 'color' && input?.guidedColor
      ? { ...service, attentionMode: 'GUIDED_ESTIMATE' as const }
      : { ...service }),
    professionals: input?.professionals ?? professionals,
    combinationRules: (input?.combinationRules ?? []).map((rule) => ({ ...rule, note: null }))
  })
}

function extractionCatalog(domainCatalog: BookingV2DomainCatalog) {
  return {
    services: domainCatalog.services.map((service) => ({
      id: service.id,
      name: service.name,
      aliases: service.aliases,
      ...(service.description === undefined ? {} : { description: service.description })
    })),
    professionals: domainCatalog.professionals.map((professional) => ({
      id: professional.id,
      name: professional.name
    }))
  }
}

function domain(
  domainCatalog: BookingV2DomainCatalog,
  options?: {
    availability?: (input: {
      serviceId: string
      serviceIds?: string[]
      professionalId?: string | null
      date: string
    }) => Promise<{ ok: true; options: Array<{ time: string; professionalId: string; professionalName: string }> }>
    nextAvailability?: () => Promise<Array<{
      date: string
      time: string
      professionalId: string
      professionalName: string
    }>>
  }
) {
  return {
    async loadCatalog() {
      return domainCatalog
    },
    toExtractionCatalog() {
      return extractionCatalog(domainCatalog)
    },
    toInterpreterCatalog() {
      return {
        serviceIds: domainCatalog.serviceIds,
        professionalIds: domainCatalog.professionalIds,
        professionalServiceIds: domainCatalog.professionalServiceIds
      }
    },
    async findAvailabilityOptions(input: {
      serviceId: string
      serviceIds?: string[]
      professionalId?: string | null
      date: string
    }) {
      return options?.availability?.(input) ?? { ok: true as const, options: [] }
    },
    async findNextAvailabilityOptions() {
      return options?.nextAvailability?.() ?? []
    }
  }
}

const nullExtractor = { async extract() { return null } }
const unusedClassifier = { async classify() { return { decision: null, confidence: 0 } } }
const unusedDecision = { async extract() { return { decision: 'unclear' as const, confidence: 0 } } }
const unusedOption = { async extract() { return { optionId: null, confidence: 0 } } }
const unclearChoice = { async extract() { return { choiceId: null, confidence: 0 } } }

function semanticChoice() {
  return {
    async extract(input: {
      message: string
      choices: Array<{ id: string; meaning: string }>
    }) {
      const normalized = input.message.toLocaleLowerCase('es-AR')
      if (normalized.includes('sin extras')) {
        assert.ok(input.choices.some((choice) => choice.id === 'continue'))
        return { choiceId: 'continue', confidence: 0.98 }
      }
      if (normalized.includes('por separado')) {
        assert.ok(input.choices.some((choice) => choice.id === 'separate'))
        return { choiceId: 'separate', confidence: 0.98 }
      }
      if (normalized.includes('viernes 9') && normalized.includes('10')) {
        assert.ok(input.choices.some((choice) => choice.id === 'joint:0'))
        return { choiceId: 'joint:0', confidence: 0.98 }
      }
      if (normalized.includes('que lo revise el equipo')) {
        assert.ok(input.choices.some((choice) => choice.id === 'review_together'))
        return { choiceId: 'review_together', confidence: 0.98 }
      }
      return { choiceId: null, confidence: 0 }
    }
  }
}

function engine(
  domainCatalog = catalog(),
  options?: Parameters<typeof domain>[1],
  choice = unclearChoice
) {
  return new BookingV2Engine(
    domain(domainCatalog, options),
    nullExtractor,
    unusedClassifier,
    unusedDecision,
    unusedOption,
    choice
  )
}

function namedState() {
  return acceptField(createEmptyBookingV2State(), 'name', 'Rodrigo')
}

async function test(name: string, run: () => Promise<void> | void) {
  await run()
  console.log(`OK: ${name}`)
}

await test('dos servicios explícitos se conservan como una sola reserva con duración sumada', async () => {
  const result = await engine().process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un alisado y un corte'
  })
  assert.equal(result.state.draft.service, 'alisado')
  assert.deepEqual(result.state.combinedServices.map((item) => item.serviceId), ['corte'])
  assert.match(result.reply, /reservar estos servicios juntos/i)
  assert.match(result.reply, /Duración total: 120 min/i)
  assert.match(result.reply, /Ana/)
  assert.doesNotMatch(result.reply, /Bea/)
})

await test('el estado combinado sobrevive a persistir y recuperar la conversación', async () => {
  const state = addCombinedServices(
    acceptField(namedState(), 'service', 'alisado'),
    [{ serviceId: 'corte', evidence: 'un corte' }]
  )
  const restored = stateFromConversation(conversationPatchFromState(state))
  assert.deepEqual(restored.combinedServices, [{ serviceId: 'corte', evidence: 'un corte' }])
})

await test('el bot ofrece extras configurados una sola vez y acepta uno mencionado naturalmente', async () => {
  const first = await engine().resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(acceptField(namedState(), 'service', 'alisado'))
  })
  assert.equal(first.plan.type, 'ask_service_addons')
  assert.match(first.reply, /Corte — agrega 30 min/)
  assert.match(first.reply, /Lavado — agrega 20 min/)

  const accepted = await engine().process({
    businessId: 'business-1',
    conversation: first.conversationPatch,
    message: 'Sí, sumemos el corte'
  })
  assert.deepEqual(accepted.state.combinedServices.map((item) => item.serviceId), ['corte'])
  assert.equal(accepted.state.addonSuggestion, null)
  assert.equal(accepted.state.addonOfferCompletedServiceId, 'alisado')

  const resumed = await engine().resume({
    businessId: 'business-1',
    conversation: accepted.conversationPatch
  })
  assert.notEqual(resumed.plan.type, 'ask_service_addons')
})

await test('rechazar extras con lenguaje natural continúa sin modificar los servicios', async () => {
  const offered = await engine(catalog(), undefined, semanticChoice()).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(acceptField(namedState(), 'service', 'alisado'))
  })
  const declined = await engine(catalog(), undefined, semanticChoice()).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Prefiero seguir sin extras'
  })
  assert.deepEqual(declined.state.combinedServices, [])
  assert.equal(declined.state.addonSuggestion, null)
  assert.equal(declined.state.addonOfferCompletedServiceId, 'alisado')
})

await test('una combinación bloqueada espera una decisión y entiende buscar por separado', async () => {
  const blockedCatalog = catalog({
    combinationRules: [{ serviceAId: 'alisado', serviceBId: 'corte', policy: 'BLOCKED' }]
  })
  const blocked = await engine(blockedCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })
  assert.equal(blocked.plan.type, 'offer_separate_services')
  assert.equal(blocked.state.pendingServiceSeparation?.reason, 'blocked_combination')

  const ambiguous = await engine(blockedCatalog).process({
    businessId: 'business-1',
    conversation: blocked.conversationPatch,
    message: 'mmm no sé'
  })
  assert.equal(ambiguous.plan.type, 'offer_separate_services')
  assert.deepEqual(ambiguous.state.combinedServices.map((item) => item.serviceId), ['corte'])

  const separated = await engine(blockedCatalog, undefined, semanticChoice()).process({
    businessId: 'business-1',
    conversation: blocked.conversationPatch,
    message: 'Dale, buscalos por separado'
  })
  assert.deepEqual(separated.state.combinedServices, [])
  assert.deepEqual(separated.state.queuedServices.map((item) => item.serviceId), ['corte'])
  assert.equal(separated.state.pendingServiceSeparation, null)
})

await test('si no existe profesional común también ofrece separar sin inventar compatibilidad', async () => {
  const noCommonCatalog = catalog({
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const result = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })
  assert.equal(result.plan.type, 'offer_separate_services')
  assert.equal(result.state.pendingServiceSeparation?.reason, 'no_common_professional')
  assert.match(result.reply, /No encontré un profesional habilitado/i)
})

await test('una combinación que requiere revisión deriva conservando ambos servicios', async () => {
  const reviewCatalog = catalog({
    combinationRules: [{ serviceAId: 'alisado', serviceBId: 'color', policy: 'REVIEW_REQUIRED' }]
  })
  const result = await engine(reviewCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y color completo'
  })
  assert.equal(result.plan.type, 'handoff')
  assert.deepEqual(result.state.combinedServices.map((item) => item.serviceId), ['color'])
  assert.match(result.reply, /equipo la revise/i)
})

await test('una regla ALLOWED habilita explícitamente un adicional con validación especial', async () => {
  const allowedCatalog = catalog({
    guidedColor: true,
    combinationRules: [{ serviceAId: 'alisado', serviceBId: 'color', policy: 'ALLOWED' }]
  })
  const result = await engine(allowedCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y color completo'
  })
  assert.notEqual(result.plan.type, 'handoff')
  assert.deepEqual(result.state.combinedServices.map((item) => item.serviceId), ['color'])
})

const nextJoint = {
  date: '2026-10-09',
  time: '10:00',
  professionalId: 'ana',
  professionalName: 'Ana'
}

function stateWaitingForAvailability(): BookingV2State {
  let state = addCombinedServices(
    acceptField(
      acceptField(namedState(), 'service', 'alisado'),
      'professional',
      'ana'
    ),
    [{ serviceId: 'corte', evidence: 'corte' }]
  )
  state = acceptField(state, 'date', '2026-10-05')
  return state
}

const availabilityOptions = {
  availability: async (input: { date: string }) => ({
    ok: true as const,
    options: input.date === nextJoint.date
      ? [{
          time: nextJoint.time,
          professionalId: nextJoint.professionalId,
          professionalName: nextJoint.professionalName
        }]
      : []
  }),
  nextAvailability: async () => [nextJoint]
}

await test('sin bloque conjunto envía exactamente dos mensajes y conserva la decisión pendiente', async () => {
  const result = await engine(catalog(), availabilityOptions).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(stateWaitingForAvailability())
  })
  assert.equal(result.plan.type, 'offer_combined_availability')
  assert.equal(result.messages?.length, 2)
  assert.match(result.messages?.[0] ?? '', /próxima disponibilidad conjunta/i)
  assert.match(result.messages?.[1] ?? '', /por separado/i)
  assert.equal(result.state.pendingCombinedAvailability?.requestedDate, '2026-10-05')
})

await test('viernes 9 a las 10 selecciona una opción ofrecida y vuelve a validar disponibilidad', async () => {
  const offered = await engine(catalog(), availabilityOptions).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(stateWaitingForAvailability())
  })
  const selected = await engine(catalog(), availabilityOptions, semanticChoice()).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Me sirve el viernes 9 a las 10'
  })
  assert.equal(selected.plan.type, 'confirm_booking')
  assert.equal(selected.state.draft.date, nextJoint.date)
  assert.equal(selected.state.draft.time, nextJoint.time)
  assert.equal(selected.state.draft.professional, nextJoint.professionalId)
  assert.equal(selected.state.pendingCombinedAvailability, null)
})

await test('una respuesta ambigua a las dos alternativas no pierde fecha ni servicios ofrecidos', async () => {
  const offered = await engine(catalog(), availabilityOptions).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(stateWaitingForAvailability())
  })
  const ambiguous = await engine(catalog(), availabilityOptions).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'puede ser'
  })
  assert.equal(ambiguous.plan.type, 'offer_combined_availability')
  assert.equal(ambiguous.messages?.length, 2)
  assert.deepEqual(ambiguous.state.combinedServices.map((item) => item.serviceId), ['corte'])
  assert.deepEqual(ambiguous.state.pendingCombinedAvailability, offered.state.pendingCombinedAvailability)
})

await test('buscar por separado transforma adicionales en cola y empieza por el servicio principal', async () => {
  const offered = await engine(catalog(), availabilityOptions).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(stateWaitingForAvailability())
  })
  const separated = await engine(catalog(), availabilityOptions, semanticChoice()).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Mejor buscá cada servicio por separado'
  })
  assert.equal(separated.state.draft.service, 'alisado')
  assert.deepEqual(separated.state.combinedServices, [])
  assert.deepEqual(separated.state.queuedServices.map((item) => item.serviceId), ['corte'])
  assert.equal(separated.state.pendingCombinedAvailability, null)
})

await test('en orden fecha-hora-profesional separar conserva la fecha y hora ya elegidas', async () => {
  const dateFirstCatalog = catalog({ bookingFlowOrder: 'DATE_TIME_FIRST' })
  let state = addCombinedServices(
    acceptField(namedState(), 'service', 'alisado'),
    [{ serviceId: 'corte', evidence: 'corte' }]
  )
  state = acceptField(state, 'date', '2026-10-09')
  state = acceptField(state, 'time', '10:00')
  state = {
    ...state,
    pendingServiceSeparation: { reason: 'no_common_professional' }
  }
  const separated = await engine(dateFirstCatalog, {
    availability: async (input) => ({
      ok: true as const,
      options: input.date === '2026-10-09'
        ? [{ time: '10:00', professionalId: 'ana', professionalName: 'Ana' }]
        : []
    })
  }, semanticChoice()).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(state),
    message: 'Busquemos por separado'
  })
  assert.equal(separated.state.draft.date, '2026-10-09')
  assert.equal(separated.state.draft.time, '10:00')
  assert.deepEqual(separated.state.queuedServices.map((item) => item.serviceId), ['corte'])
})

await test('al separar limpia fecha y hora si el turno individual tampoco está disponible', async () => {
  const dateFirstCatalog = catalog({ bookingFlowOrder: 'DATE_TIME_FIRST' })
  let state = addCombinedServices(
    acceptField(namedState(), 'service', 'alisado'),
    [{ serviceId: 'corte', evidence: 'corte' }]
  )
  state = acceptField(state, 'date', '2026-10-09')
  state = acceptField(state, 'time', '10:00')
  state = { ...state, pendingServiceSeparation: { reason: 'no_common_professional' } }
  const separated = await engine(dateFirstCatalog, undefined, semanticChoice()).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(state),
    message: 'Busquemos por separado'
  })
  assert.equal(separated.state.draft.date, null)
  assert.equal(separated.state.draft.time, null)
  assert.deepEqual(separated.state.queuedServices.map((item) => item.serviceId), ['corte'])
})

await test('el límite defensivo conserva como máximo cuatro adicionales sin duplicados', () => {
  const state = addCombinedServices(
    acceptField(namedState(), 'service', 'alisado'),
    [
      { serviceId: 'corte', evidence: '1' },
      { serviceId: 'corte', evidence: 'duplicado' },
      { serviceId: 'lavado', evidence: '2' },
      { serviceId: 'color', evidence: '3' },
      { serviceId: 'nutricion', evidence: '4' },
      { serviceId: 'brushing', evidence: '5' }
    ]
  )
  assert.deepEqual(state.combinedServices.map((item) => item.serviceId), [
    'corte',
    'lavado',
    'color',
    'nutricion'
  ])
})

await test('el dominio consulta disponibilidad sólo a profesionales comunes y reenvía todos los IDs', async () => {
  const calls: Array<{ professionalId: string; serviceIds?: string[] }> = []
  const bookingProvider = {
    async getAvailability(input: { professionalId: string; serviceIds?: string[] }) {
      calls.push(input)
      return { ok: true as const, slots: ['10:00'] }
    },
    async createAppointment() {
      throw new Error('No se crea un turno en esta prueba')
    },
    async cancelAppointment() {}
  }
  const service = new BookingV2DomainService({} as never, bookingProvider)
  const result = await service.findAvailabilityOptions({
    catalog: catalog(),
    serviceId: 'alisado',
    serviceIds: ['alisado', 'corte'],
    professionalId: null,
    date: '2026-10-09'
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.professionalId, 'ana')
  assert.deepEqual(calls[0]?.serviceIds, ['alisado', 'corte'])
})

await test('la búsqueda futura respeta el horizonte de 14 días y no ofrece el día 15', async () => {
  const visitedDates: string[] = []
  const bookingProvider = {
    async getAvailability(input: { date: string }) {
      visitedDates.push(input.date)
      return {
        ok: true as const,
        slots: input.date === '2026-10-16' ? ['10:00'] : []
      }
    },
    async createAppointment() {
      throw new Error('No se crea un turno en esta prueba')
    },
    async cancelAppointment() {}
  }
  const service = new BookingV2DomainService({} as never, bookingProvider)
  const options = await service.findNextAvailabilityOptions({
    catalog: catalog(),
    serviceId: 'alisado',
    serviceIds: ['alisado', 'corte'],
    professionalId: 'ana',
    afterDate: '2026-10-01',
    horizonDays: 14
  })
  assert.deepEqual(options, [])
  assert.equal(visitedDates.at(-1), '2026-10-15')
  assert.equal(visitedDates.includes('2026-10-16'), false)
})

console.log('\n17 pruebas específicas de conversaciones con servicios combinados pasaron.')
