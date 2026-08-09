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
  combinedServiceIds,
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
  includeAddons?: boolean
}) {
  return createBookingV2DomainCatalog({
    ...(input?.bookingFlowOrder ? { bookingFlowOrder: input.bookingFlowOrder } : {}),
    services: services.map((service) => ({
      ...service,
      ...(service.id === 'color' && input?.guidedColor
        ? { attentionMode: 'GUIDED_ESTIMATE' as const }
        : {}),
      ...(input?.includeAddons === false ? { suggestedAddonIds: [] } : {})
    })),
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
  choice = unclearChoice,
  serviceValidationClassifier = unusedClassifier
) {
  return new BookingV2Engine(
    domain(domainCatalog, options),
    nullExtractor,
    serviceValidationClassifier,
    unusedDecision,
    unusedOption,
    choice
  )
}

function namedState() {
  return acceptField(createEmptyBookingV2State(), 'name', 'Rodrigo')
}

function ambiguousFamiliesCatalog() {
  return createBookingV2DomainCatalog({
    services: [
      { id: 'molecular', name: 'Alisado molecular', aliases: [], duration: 30, price: 30000, category: 'Nutrición' },
      { id: 'sin-formol', name: 'Alisado sin formol', aliases: [], duration: 30, price: 29000, category: 'Nutrición' },
      { id: 'corte-hombre', name: 'Corte Hombre', aliases: [], duration: 30, price: 15000, category: 'Cortes' },
      { id: 'corte-barba', name: 'Corte y barba', aliases: [], duration: 60, price: 40000, category: 'Cortes' }
    ],
    professionals: [{
      id: 'tamara',
      name: 'Tamara',
      serviceIds: ['molecular', 'sin-formol', 'corte-hombre', 'corte-barba']
    }]
  })
}

async function test(name: string, run: () => Promise<void> | void) {
  await run()
  console.log(`OK: ${name}`)
}

await test('dos servicios explícitos se conservan como una sola reserva con duración sumada', async () => {
  const bookingEngine = engine()
  const result = await bookingEngine.process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un alisado y un corte'
  })
  assert.equal(result.state.draft.service, 'alisado')
  assert.deepEqual(result.state.combinedServices.map((item) => item.serviceId), ['corte'])
  assert.match(result.reply, /reservar estos servicios juntos/i)
  assert.match(result.reply, /Duración total: 120 min/i)
  assert.equal(result.plan.type, 'ask_service_addons')
  assert.match(result.reply, /Lavado/)
  assert.doesNotMatch(result.reply, /Corte — agrega/)

  const declined = await bookingEngine.process({
    businessId: 'business-1',
    conversation: result.conversationPatch,
    message: 'No, continuar'
  })
  assert.match(declined.reply, /Ana/)
  assert.doesNotMatch(declined.reply, /Bea/)
})

await test('dos familias ambiguas se preguntan en orden y se combinan al resolver ambas', async () => {
  const domainCatalog = ambiguousFamiliesCatalog()
  const first = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un alisado y un corte'
  })
  assert.equal(first.state.draft.service, null)
  assert.deepEqual(first.state.combinedServices, [])
  assert.deepEqual(first.state.pendingServiceDisambiguation?.serviceIds, ['molecular', 'sin-formol'])
  assert.deepEqual(
    first.state.pendingServiceDisambiguation?.remainingGroups?.map((group) => group.serviceIds),
    [['corte-hombre', 'corte-barba']]
  )
  assert.match(first.reply, /Alisado molecular/)
  assert.match(first.reply, /Alisado sin formol/)
  assert.doesNotMatch(first.reply, /Corte Hombre/)

  const alisado = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: first.conversationPatch,
    message: 'Alisado sin formol'
  })
  assert.equal(alisado.state.draft.service, 'sin-formol')
  assert.deepEqual(alisado.state.pendingServiceDisambiguation?.serviceIds, ['corte-hombre', 'corte-barba'])
  assert.match(alisado.reply, /Corte Hombre/)
  assert.match(alisado.reply, /Corte y barba/)
  assert.doesNotMatch(alisado.reply, /Alisado molecular/)

  const corte = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: alisado.conversationPatch,
    message: 'Corte Hombre'
  })
  assert.equal(corte.state.draft.service, 'sin-formol')
  assert.deepEqual(corte.state.combinedServices.map((item) => item.serviceId), ['corte-hombre'])
  assert.equal(corte.state.pendingServiceDisambiguation, null)
  assert.match(corte.reply, /Alisado sin formol/)
  assert.match(corte.reply, /Corte Hombre/)
})

await test('conversación dorada: color y alisado ofrece el extra después de aclarar la familia', async () => {
  const domainCatalog = createBookingV2DomainCatalog({
    services: [
      {
        id: 'color-completo',
        name: 'Color Completo',
        aliases: ['color'],
        duration: 90,
        price: 75000,
        category: 'Color'
      },
      {
        id: 'alisado-molecular',
        name: 'Alisado molecular',
        aliases: [],
        duration: 30,
        price: 30000,
        category: 'Nutrición',
        parentServiceId: 'familia-alisado',
        parentServiceName: 'Alisado',
        parentSelectionMode: 'ONE_OF'
      },
      {
        id: 'alisado-sin-formol',
        name: 'Alisado sin formol',
        aliases: [],
        duration: 30,
        price: 29000,
        category: 'Nutrición',
        parentServiceId: 'familia-alisado',
        parentServiceName: 'Alisado',
        parentSelectionMode: 'ONE_OF',
        suggestedAddonIds: ['corte-hombre']
      },
      {
        id: 'corte-hombre',
        name: 'Corte hombre',
        aliases: [],
        duration: 30,
        price: 27000,
        category: 'Cortes'
      }
    ],
    professionals: [{
      id: 'tamara',
      name: 'Tamara',
      serviceIds: ['color-completo', 'alisado-molecular', 'alisado-sin-formol', 'corte-hombre']
    }]
  })
  const bookingEngine = engine(domainCatalog)
  const initial = await bookingEngine.process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un alisado y color'
  })
  assert.deepEqual(
    initial.state.pendingServiceDisambiguation?.serviceIds,
    ['alisado-molecular', 'alisado-sin-formol']
  )

  const clarified = await bookingEngine.process({
    businessId: 'business-1',
    conversation: initial.conversationPatch,
    message: 'Alisado sin formol'
  })
  assert.equal(clarified.state.pendingServiceDisambiguation, null)
  assert.deepEqual(
    new Set(combinedServiceIds(clarified.state)),
    new Set(['color-completo', 'alisado-sin-formol'])
  )
  assert.equal(clarified.plan.type, 'ask_service_addons')
  assert.match(clarified.reply, /Corte hombre/)
  assert.doesNotMatch(clarified.reply, /¿Con quién preferís\?/i)
})

await test('conversación dorada: color y corte cierra toda la lista antes de pedir profesional', async () => {
  const domainCatalog = createBookingV2DomainCatalog({
    services: [
      { id: 'iluminacion', name: 'Iluminación', aliases: [], duration: 120, price: 160000, category: 'Color' },
      { id: 'tintura-completa', name: 'Tintura completo', aliases: [], duration: 90, price: 75000, category: 'Color' },
      {
        id: 'tintura-raices',
        name: 'Tintura raíces',
        aliases: ['tintura de raíces'],
        duration: 60,
        price: 65000,
        category: 'Color',
        validationEnabled: true,
        validationMessage: 'Este servicio es únicamente para tintura de raíces.',
        validationQuestion: '¿Continuamos con este servicio?',
        suggestedAddonIds: ['corte-mujer']
      },
      {
        id: 'corte-hombre',
        name: 'Corte hombre',
        aliases: [],
        duration: 30,
        price: 27000,
        category: 'Corte',
        parentServiceId: 'familia-corte',
        parentServiceName: 'Corte',
        parentSelectionMode: 'ONE_OF'
      },
      {
        id: 'corte-mujer',
        name: 'Corte mujer',
        aliases: [],
        duration: 30,
        price: 37000,
        category: 'Corte',
        parentServiceId: 'familia-corte',
        parentServiceName: 'Corte',
        parentSelectionMode: 'ONE_OF'
      },
      {
        id: 'corte-barba',
        name: 'Corte y barba',
        aliases: [],
        duration: 45,
        price: 32000,
        category: 'Corte',
        parentServiceId: 'familia-corte',
        parentServiceName: 'Corte',
        parentSelectionMode: 'ONE_OF'
      }
    ],
    professionals: [{
      id: 'juan',
      name: 'Juan',
      serviceIds: ['iluminacion', 'tintura-completa', 'tintura-raices', 'corte-hombre', 'corte-mujer', 'corte-barba']
    }]
  })
  const validationClassifier = {
    async classify() {
      return { decision: 'confirm' as const, confidence: 0.99 }
    }
  }
  const bookingEngine = engine(domainCatalog, undefined, unclearChoice, validationClassifier)
  const initial = await bookingEngine.process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero color y corte'
  })
  const selected = await bookingEngine.process({
    businessId: 'business-1',
    conversation: initial.conversationPatch,
    message: 'Tintura raíces'
  })
  assert.equal(selected.plan.type, 'ask_service_validation')

  const validated = await bookingEngine.process({
    businessId: 'business-1',
    conversation: selected.conversationPatch,
    message: 'Sí'
  })
  assert.equal(validated.plan.type, 'ask_field')
  assert.equal(validated.plan.type === 'ask_field' ? validated.plan.field : null, 'service')
  assert.deepEqual(validated.state.pendingServiceDisambiguation?.serviceIds, ['corte-hombre', 'corte-mujer', 'corte-barba'])
  assert.match(validated.reply, /Corte hombre/)
  assert.match(validated.reply, /Corte mujer/)
  assert.match(validated.reply, /Corte y barba/)
  assert.doesNotMatch(validated.reply, /¿Con quién preferís\?/i)
  assert.notEqual(validated.plan.type, 'ask_service_addons')

  const completedServices = await bookingEngine.process({
    businessId: 'business-1',
    conversation: validated.conversationPatch,
    message: 'Corte hombre'
  })
  assert.equal(completedServices.state.pendingServiceDisambiguation, null)
  assert.equal(completedServices.plan.type, 'ask_field')
  assert.equal(completedServices.plan.type === 'ask_field' ? completedServices.plan.field : null, 'professional')
  assert.deepEqual(completedServices.state.combinedServices.map((service) => service.serviceId), ['corte-hombre'])
  assert.match(completedServices.reply, /Juan/)

  const professional = await bookingEngine.process({
    businessId: 'business-1',
    conversation: completedServices.conversationPatch,
    message: 'Juan'
  })
  assert.equal(professional.state.draft.professional, 'juan')
  assert.equal(professional.plan.type, 'ask_field')
  assert.equal(professional.plan.type === 'ask_field' ? professional.plan.field : null, 'date')
  assert.doesNotMatch(professional.reply, /¿Con quién preferís\?/i)
})

await test('dos familias ambiguas aceptan ambas elecciones en una sola respuesta', async () => {
  const domainCatalog = ambiguousFamiliesCatalog()
  const first = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un alisado y un corte'
  })
  const selected = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: first.conversationPatch,
    message: 'Alisado molecular y Corte y barba'
  })
  assert.equal(selected.state.draft.service, 'molecular')
  assert.deepEqual(selected.state.combinedServices.map((item) => item.serviceId), ['corte-barba'])
  assert.equal(selected.state.pendingServiceDisambiguation, null)
  assert.match(selected.reply, /Alisado molecular/)
  assert.match(selected.reply, /Corte y barba/)
})

await test('un servicio específico no genera otra variante al combinarlo con una familia ambigua', async () => {
  const domainCatalog = ambiguousFamiliesCatalog()
  const result = await engine(domainCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero un corte y un alisado sin formol'
  })
  assert.equal(result.state.draft.service, 'sin-formol')
  assert.deepEqual(result.state.combinedServices, [])
  assert.deepEqual(result.state.pendingServiceDisambiguation?.serviceIds, ['corte-hombre', 'corte-barba'])
  assert.match(result.reply, /Corte Hombre/)
  assert.match(result.reply, /Corte y barba/)
  assert.doesNotMatch(result.reply, /Alisado molecular/)
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
  assert.equal(accepted.state.addonOfferCompletedServiceId, 'alisado|corte')

  const resumed = await engine().resume({
    businessId: 'business-1',
    conversation: accepted.conversationPatch
  })
  assert.notEqual(resumed.plan.type, 'ask_service_addons')
})

await test('pedir el servicio antes del nombre no marca sus extras como ya ofrecidos', async () => {
  const serviceSelected = await engine().process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(createEmptyBookingV2State()),
    message: 'Hola, quería un alisado sin formol',
    understandingExtraction: {
      name: { value: null, confidence: 0, evidence: '' },
      service: { value: 'alisado', confidence: 0.98, evidence: 'alisado sin formol' },
      professional: { value: null, confidence: 0, evidence: '' },
      date: { value: null, confidence: 0, evidence: '' },
      time: { value: null, confidence: 0, evidence: '' },
      additionalServices: [],
      correction: { field: null, newValue: null, confidence: 0, evidence: '' }
    }
  })
  assert.equal(serviceSelected.plan.type, 'ask_field')
  assert.equal(serviceSelected.plan.field, 'name')
  assert.equal(serviceSelected.state.addonOfferCompletedServiceId, null)

  const named = await engine().process({
    businessId: 'business-1',
    conversation: serviceSelected.conversationPatch,
    message: 'Matias',
    understandingExtraction: {
      name: { value: 'Matias', confidence: 0.98, evidence: 'Matias' },
      service: { value: null, confidence: 0, evidence: '' },
      professional: { value: null, confidence: 0, evidence: '' },
      date: { value: null, confidence: 0, evidence: '' },
      time: { value: null, confidence: 0, evidence: '' },
      additionalServices: [],
      correction: { field: null, newValue: null, confidence: 0, evidence: '' }
    }
  })
  assert.equal(named.plan.type, 'ask_service_addons')
  assert.match(named.reply, /Corte — agrega 30 min/)
  assert.match(named.reply, /Lavado — agrega 20 min/)
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

await test('No, continuar rechaza extras sin usar el extractor de respaldo', async () => {
  const failChoice = {
    async extract() {
      throw new Error('el extractor no debe ejecutarse para una negativa determinista')
    }
  }
  const offered = await engine(catalog(), undefined, failChoice).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(acceptField(namedState(), 'service', 'alisado'))
  })
  const declined = await engine(catalog(), undefined, failChoice).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'No. continuar'
  })
  assert.equal(declined.state.addonSuggestion, null)
  assert.equal(declined.state.addonOfferCompletedServiceId, 'alisado')
  assert.equal(declined.plan.type, 'ask_field')
  assert.equal(declined.plan.type === 'ask_field' ? declined.plan.field : null, 'professional')
})

await test('un sí sin elegir no selecciona automáticamente entre varios extras', async () => {
  const failChoice = {
    async extract() {
      throw new Error('un sí ambiguo debe repreguntarse sin usar IA')
    }
  }
  const offered = await engine(catalog(), undefined, failChoice).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(acceptField(namedState(), 'service', 'alisado'))
  })
  const ambiguous = await engine(catalog(), undefined, failChoice).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Sí'
  })
  assert.equal(ambiguous.plan.type, 'ask_service_addons')
  assert.deepEqual(ambiguous.state.combinedServices, [])
})

await test('un sí acepta el agregado cuando existe una sola opción', async () => {
  const singleAddonCatalog = createBookingV2DomainCatalog({
    services: catalog().services.map((service) =>
      service.id === 'alisado'
        ? { ...service, suggestedAddonIds: ['corte'] }
        : service
    ),
    professionals: catalog().professionals
  })
  const failChoice = {
    async extract() {
      throw new Error('un sí con una opción debe resolverse sin IA')
    }
  }
  const offered = await engine(singleAddonCatalog, undefined, failChoice).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(acceptField(namedState(), 'service', 'alisado'))
  })
  const accepted = await engine(singleAddonCatalog, undefined, failChoice).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Sí'
  })
  assert.deepEqual(accepted.state.combinedServices.map((service) => service.serviceId), ['corte'])
})

await test('los agregados respetan ONE_OF y MULTIPLE sin depender del profesional común', async () => {
  const familyCatalog = createBookingV2DomainCatalog({
    services: [
      {
        id: 'raices',
        name: 'Tintura raíces',
        aliases: [],
        duration: 60,
        price: 65000,
        category: 'Color',
        suggestedAddonIds: ['corte-mujer', 'nutricion']
      },
      {
        id: 'corte-hombre',
        name: 'Corte hombre',
        aliases: [],
        duration: 30,
        price: 27000,
        category: 'Cortes',
        parentServiceId: 'familia-corte',
        parentServiceName: 'Corte',
        parentSelectionMode: 'ONE_OF'
      },
      {
        id: 'corte-mujer',
        name: 'Corte mujer',
        aliases: [],
        duration: 30,
        price: 37000,
        category: 'Cortes',
        parentServiceId: 'familia-corte',
        parentServiceName: 'Corte',
        parentSelectionMode: 'ONE_OF'
      },
      { id: 'nutricion', name: 'Nutrición', aliases: [], duration: 30, price: 25000, category: 'Tratamientos' }
    ],
    professionals: [{ id: 'juan', name: 'Juan', serviceIds: ['raices', 'corte-hombre'] }]
  })
  const selected = addCombinedServices(
    acceptField(namedState(), 'service', 'raices'),
    [{ serviceId: 'corte-hombre', evidence: 'corte hombre' }]
  )
  const offered = await engine(familyCatalog).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(selected)
  })
  assert.equal(offered.plan.type, 'ask_service_addons')
  assert.match(offered.reply, /Nutrición/)
  assert.doesNotMatch(offered.reply, /Corte mujer/)

  const multipleCatalog = createBookingV2DomainCatalog({
    services: familyCatalog.services.map((service) =>
      service.parentServiceId === 'familia-corte'
        ? { ...service, parentSelectionMode: 'MULTIPLE' as const }
        : service
    ),
    professionals: familyCatalog.professionals
  })
  const multipleOffer = await engine(multipleCatalog).resume({
    businessId: 'business-1',
    conversation: conversationPatchFromState(selected)
  })
  assert.equal(multipleOffer.plan.type, 'ask_service_addons')
  assert.match(multipleOffer.reply, /Corte mujer/)
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
    includeAddons: false,
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

await test('pedir cambiar un servicio durante la separación sale del bucle sin borrar la selección', async () => {
  const noCommonCatalog = catalog({
    includeAddons: false,
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const offered = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })

  const edit = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Quiero cambiar el servicio'
  })

  assert.equal(edit.plan.type, 'ask_service_edit_target')
  assert.equal(edit.state.pendingServiceSeparation?.edit?.action, 'change')
  assert.equal(edit.state.pendingServiceSeparation?.edit?.serviceIds, null)
  assert.equal(edit.state.draft.service, 'alisado')
  assert.deepEqual(edit.state.combinedServices.map((item) => item.serviceId), ['corte'])
  assert.match(edit.reply, /Alisado/)
  assert.match(edit.reply, /Corte/)
})

await test('cambiar uno de dos servicios pide confirmación y conserva el otro', async () => {
  const noCommonCatalog = catalog({
    includeAddons: false,
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const offered = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })
  const target = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Quiero cambiar el corte'
  })

  assert.equal(target.plan.type, 'confirm_service_edit')
  assert.deepEqual(target.state.pendingServiceSeparation?.edit?.serviceIds, ['corte'])
  assert.equal(target.state.draft.service, 'alisado')
  assert.deepEqual(target.state.combinedServices.map((item) => item.serviceId), ['corte'])

  const confirmed = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: target.conversationPatch,
    message: 'Sí'
  })
  assert.equal(confirmed.plan.type, 'ask_service_replacement')
  assert.equal(confirmed.state.draft.service, 'alisado')
  assert.deepEqual(confirmed.state.combinedServices, [])
  assert.equal(confirmed.state.draft.professional, null)

  const replaced = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: confirmed.conversationPatch,
    message: 'Color completo'
  })
  assert.equal(replaced.state.draft.service, 'alisado')
  assert.deepEqual(replaced.state.combinedServices.map((item) => item.serviceId), ['color'])
  assert.equal(replaced.state.pendingServiceReplacement, null)
})

await test('quitar un servicio pide confirmación y recién entonces lo elimina', async () => {
  const noCommonCatalog = catalog({
    includeAddons: false,
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const offered = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })
  const target = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Quiero sacar el alisado'
  })

  assert.equal(target.plan.type, 'confirm_service_edit')
  assert.equal(target.state.draft.service, 'alisado')

  const cancelled = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: target.conversationPatch,
    message: 'No, dejalo como estaba'
  })
  assert.equal(cancelled.plan.type, 'offer_separate_services')
  assert.equal(cancelled.state.draft.service, 'alisado')
  assert.deepEqual(cancelled.state.combinedServices.map((item) => item.serviceId), ['corte'])

  const confirmed = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: target.conversationPatch,
    message: 'Sí, sacalo'
  })
  assert.equal(confirmed.state.draft.service, 'corte')
  assert.deepEqual(confirmed.state.combinedServices, [])
  assert.equal(confirmed.state.pendingServiceSeparation, null)
})

await test('quitar ambos servicios requiere confirmación y vuelve a elegir servicio', async () => {
  const noCommonCatalog = catalog({
    includeAddons: false,
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const offered = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState()),
    message: 'Quiero alisado y corte'
  })
  const target = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: offered.conversationPatch,
    message: 'Quiero quitar ambos servicios'
  })

  assert.equal(target.plan.type, 'confirm_service_edit')
  assert.deepEqual(target.state.pendingServiceSeparation?.edit?.serviceIds, ['alisado', 'corte'])

  const confirmed = await engine(noCommonCatalog).process({
    businessId: 'business-1',
    conversation: target.conversationPatch,
    message: 'Confirmo'
  })
  assert.equal(confirmed.plan.type, 'ask_field')
  assert.equal(confirmed.plan.field, 'service')
  assert.equal(confirmed.state.draft.service, null)
  assert.deepEqual(confirmed.state.combinedServices, [])
})

await test('una consulta informativa retoma cada subestado de edición sin perder la decisión', async () => {
  const noCommonCatalog = catalog({
    includeAddons: false,
    professionals: [
      { id: 'alisadora', name: 'Alisadora', serviceIds: ['alisado'] },
      { id: 'cortadora', name: 'Cortadora', serviceIds: ['corte'] }
    ]
  })
  const engineInstance = engine(noCommonCatalog)
  const selected = addCombinedServices(
    acceptField(namedState(), 'service', 'alisado'),
    [{ serviceId: 'corte', evidence: 'corte' }]
  )
  const states: Array<{
    state: BookingV2State
    expectedPlan: 'offer_separate_services' | 'ask_service_edit_target' | 'confirm_service_edit' | 'ask_service_replacement'
  }> = [
    {
      state: {
        ...selected,
        pendingServiceSeparation: { reason: 'no_common_professional' }
      },
      expectedPlan: 'offer_separate_services'
    },
    {
      state: {
        ...selected,
        pendingServiceSeparation: {
          reason: 'no_common_professional',
          edit: { action: 'change', serviceIds: null }
        }
      },
      expectedPlan: 'ask_service_edit_target'
    },
    {
      state: {
        ...selected,
        pendingServiceSeparation: {
          reason: 'no_common_professional',
          edit: { action: 'remove', serviceIds: ['corte'] }
        }
      },
      expectedPlan: 'confirm_service_edit'
    },
    {
      state: {
        ...acceptField(namedState(), 'service', 'alisado'),
        pendingServiceReplacement: { removedServiceIds: ['corte'] }
      },
      expectedPlan: 'ask_service_replacement'
    }
  ]

  for (const { state, expectedPlan } of states) {
    const resumed = await engineInstance.resume({
      businessId: 'business-1',
      conversation: conversationPatchFromState(state)
    })
    assert.equal(resumed.plan.type, expectedPlan)
    assert.deepEqual(resumed.state.draft, state.draft)
    assert.deepEqual(resumed.state.pendingServiceSeparation, state.pendingServiceSeparation)
    assert.deepEqual(resumed.state.pendingServiceReplacement, state.pendingServiceReplacement)
  }
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
  assert.equal(result.state.draft.service, 'color')
  assert.deepEqual(result.state.combinedServices.map((item) => item.serviceId), ['alisado'])
  assert.deepEqual(
    new Set([
      result.state.draft.service,
      ...result.state.combinedServices.map((item) => item.serviceId)
    ]),
    new Set(['alisado', 'color'])
  )
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

console.log('\n31 pruebas específicas de conversaciones con servicios combinados pasaron.')
