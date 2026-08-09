import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BookingV2Engine } from '../src/services/booking-v2-engine.js'
import { createBookingV2DomainCatalog } from '../src/services/booking-v2-domain.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import {
  acceptField,
  addCombinedServices,
  advanceToNextQueuedService,
  createEmptyBookingV2State,
  queueAdditionalServices
} from '../src/services/booking-v2-state.js'

const catalog = createBookingV2DomainCatalog({
  services: [
    {
      id: 'corte',
      name: 'Corte',
      aliases: ['corte de pelo'],
      description: 'Acomodar el largo y recortar las puntas.',
      duration: 30,
      price: 15000,
      category: 'Cortes'
    },
    {
      id: 'color',
      name: 'Color completo',
      aliases: ['tintura'],
      description: 'Cubrir las canas y renovar el tono.',
      duration: 90,
      price: 65000,
      category: 'Coloración'
    },
    {
      id: 'nutricion',
      name: 'Nutrición',
      aliases: ['tratamiento nutritivo'],
      description: 'Nutrir e hidratar profundamente el cabello.',
      duration: 30,
      price: 30000,
      category: 'Nutrición'
    }
  ],
  professionals: [
    {
      id: 'profesional-1',
      name: 'Tamara',
      serviceIds: ['corte', 'color', 'nutricion']
    }
  ]
})

function fakeDomain(domainCatalog = catalog) {
  return {
    async loadCatalog() {
      return domainCatalog
    },
    toExtractionCatalog() {
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
    },
    toInterpreterCatalog() {
      return {
        serviceIds: domainCatalog.serviceIds,
        professionalIds: domainCatalog.professionalIds,
        professionalServiceIds: domainCatalog.professionalServiceIds
      }
    },
    async findAvailabilityOptions() {
      return { ok: true as const, options: [] }
    }
  }
}

const nullExtractor = { async extract() { return null } }
const unusedClassifier = { async classify() { return { decision: null, confidence: 0 } } }
const unusedDecision = { async extract() { return { decision: 'unclear' as const, confidence: 0 } } }
const unusedOption = { async extract() { return { optionId: null, confidence: 0 } } }
const unusedChoice = { async extract() { return { choiceId: null, confidence: 0 } } }

function engine(domainCatalog = catalog) {
  return new BookingV2Engine(
    fakeDomain(domainCatalog),
    nullExtractor,
    unusedClassifier,
    unusedDecision,
    unusedOption,
    unusedChoice
  )
}

const namedState = acceptField(createEmptyBookingV2State(), 'name', 'Mati')
const explicit = await engine().process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte, color completo y nutrición'
})
assert.equal(explicit.state.draft.service, 'corte')
assert.deepEqual(
  explicit.state.combinedServices.map((service) => service.serviceId),
  ['color', 'nutricion']
)
assert.match(explicit.reply, /reservar estos servicios juntos/i)
assert.match(explicit.reply, /Duración total: 150 min/i)

const singleServiceWithSeveralQuestions = await engine().process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte y también saber precios y horarios',
  understandingExtraction: null
})
assert.equal(singleServiceWithSeveralQuestions.state.draft.service, 'corte')
assert.deepEqual(singleServiceWithSeveralQuestions.state.combinedServices, [])

const restored = stateFromConversation(explicit.conversationPatch)
assert.deepEqual(restored.combinedServices, explicit.state.combinedServices)

const semantic = await engine().process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero acomodar el largo y también cubrir las canas',
  understandingExtraction: {
    name: { value: null, confidence: 0, evidence: '' },
    service: { value: 'corte', confidence: 0.94, evidence: 'acomodar el largo' },
    professional: { value: null, confidence: 0, evidence: '' },
    date: { value: null, confidence: 0, evidence: '' },
    time: { value: null, confidence: 0, evidence: '' },
    additionalServices: [
      { value: 'color', confidence: 0.92, evidence: 'cubrir las canas' }
    ],
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
})
assert.equal(semantic.state.draft.service, 'corte')
assert.deepEqual(semantic.state.combinedServices, [
  { serviceId: 'color', evidence: 'cubrir las canas' }
])
assert.match(semantic.reply, /Color completo/)

const categoriesFirstCatalog = createBookingV2DomainCatalog({
  displayMode: 'CATEGORIES_FIRST',
  services: catalog.services,
  professionals: catalog.professionals
})
const semanticWithCategories = await engine(categoriesFirstCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero acomodar el largo y también cubrir las canas',
  understandingExtraction: {
    name: { value: null, confidence: 0, evidence: '' },
    service: { value: 'corte', confidence: 0.94, evidence: 'acomodar el largo' },
    professional: { value: null, confidence: 0, evidence: '' },
    date: { value: null, confidence: 0, evidence: '' },
    time: { value: null, confidence: 0, evidence: '' },
    additionalServices: [
      { value: 'color', confidence: 0.92, evidence: 'cubrir las canas' }
    ],
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
})
assert.equal(semanticWithCategories.state.draft.service, 'corte')
assert.deepEqual(
  semanticWithCategories.state.combinedServices.map((service) => service.serviceId),
  ['color']
)

const lowConfidenceAdditional = await engine().process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero acomodar el largo y quizá renovar el tono',
  understandingExtraction: {
    name: { value: null, confidence: 0, evidence: '' },
    service: { value: 'corte', confidence: 0.94, evidence: 'acomodar el largo' },
    professional: { value: null, confidence: 0, evidence: '' },
    date: { value: null, confidence: 0, evidence: '' },
    time: { value: null, confidence: 0, evidence: '' },
    additionalServices: [
      { value: 'color', confidence: 0.54, evidence: 'renovar el tono' }
    ],
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
})
assert.deepEqual(lowConfidenceAdditional.state.combinedServices, [])

const blockedCatalog = createBookingV2DomainCatalog({
  services: catalog.services,
  professionals: catalog.professionals,
  combinationRules: [{ serviceAId: 'color', serviceBId: 'corte', policy: 'BLOCKED' }]
})
const blockedCombination = await engine(blockedCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte y color completo'
})
assert.equal(blockedCombination.plan.type, 'offer_separate_services')
assert.match(blockedCombination.reply, /no están habilitados para realizarse juntos/i)
const blockedSeparateEngine = new BookingV2Engine(
  fakeDomain(blockedCatalog),
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  {
    async extract() {
      return { choiceId: 'separate', confidence: 0.97 }
    }
  }
)
const blockedSeparate = await blockedSeparateEngine.process({
  businessId: 'business-1',
  conversation: blockedCombination.conversationPatch,
  message: 'Sí, buscámelos por separado'
})
assert.deepEqual(blockedSeparate.state.combinedServices, [])
assert.deepEqual(blockedSeparate.state.queuedServices.map((item) => item.serviceId), ['color'])

const reviewCatalog = createBookingV2DomainCatalog({
  services: catalog.services,
  professionals: catalog.professionals,
  combinationRules: [{ serviceAId: 'color', serviceBId: 'corte', policy: 'REVIEW_REQUIRED' }]
})
const reviewCombination = await engine(reviewCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte y color completo'
})
assert.equal(reviewCombination.plan.type, 'handoff')
assert.match(reviewCombination.reply, /equipo la revise/i)

const explicitlyAllowedCatalog = createBookingV2DomainCatalog({
  services: catalog.services.map((service) => service.id === 'color'
    ? { ...service, attentionMode: 'GUIDED_ESTIMATE' as const }
    : service),
  professionals: catalog.professionals,
  combinationRules: [{ serviceAId: 'color', serviceBId: 'corte', policy: 'ALLOWED' }]
})
const explicitlyAllowed = await engine(explicitlyAllowedCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte y color completo'
})
assert.notEqual(explicitlyAllowed.plan.type, 'handoff')
assert.equal(explicitlyAllowed.state.draft.service, 'color')
assert.deepEqual(explicitlyAllowed.state.combinedServices.map((item) => item.serviceId), ['corte'])
assert.deepEqual(
  new Set([
    explicitlyAllowed.state.draft.service,
    ...explicitlyAllowed.state.combinedServices.map((item) => item.serviceId)
  ]),
  new Set(['corte', 'color'])
)

const separatePrimaryState = acceptField(namedState, 'service', 'corte')
const deduplicated = queueAdditionalServices(separatePrimaryState, [
  { serviceId: 'color', evidence: 'repetido' },
  { serviceId: 'corte', evidence: 'servicio actual' },
  { serviceId: 'nutricion', evidence: 'repetido' }
])
assert.deepEqual(
  deduplicated.queuedServices.map((service) => service.serviceId),
  ['color', 'nutricion']
)

const firstContinuation = advanceToNextQueuedService(deduplicated)
assert.ok(firstContinuation)
assert.equal(firstContinuation.state.draft.name, 'Mati')
assert.equal(firstContinuation.state.draft.service, 'color')
assert.equal(firstContinuation.state.draft.professional, null)
assert.equal(firstContinuation.state.draft.date, null)
assert.equal(firstContinuation.state.draft.time, null)
assert.deepEqual(
  firstContinuation.state.queuedServices.map((service) => service.serviceId),
  ['nutricion']
)

const secondContinuation = advanceToNextQueuedService(firstContinuation.state)
assert.ok(secondContinuation)
assert.equal(secondContinuation.state.draft.service, 'nutricion')
assert.deepEqual(secondContinuation.state.queuedServices, [])
assert.equal(advanceToNextQueuedService(secondContinuation.state), null)

const restarted = createEmptyBookingV2State()
assert.deepEqual(restarted.queuedServices, [])

const staleQueue = queueAdditionalServices(namedState, [
  { serviceId: 'servicio-eliminado', evidence: 'viejo' },
  { serviceId: 'color', evidence: 'color' }
])
const sanitized = await engine().resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(staleQueue)
})
assert.deepEqual(sanitized.state.queuedServices, [
  { serviceId: 'color', evidence: 'color' }
])

const addonCatalog = createBookingV2DomainCatalog({
  services: catalog.services.map((service) => service.id === 'corte'
    ? { ...service, suggestedAddonIds: ['nutricion'] }
    : service),
  professionals: catalog.professionals
})
const addonOffer = await engine(addonCatalog).resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(acceptField(namedState, 'service', 'corte'))
})
assert.equal(addonOffer.plan.type, 'ask_service_addons')
assert.match(addonOffer.reply, /Nutrición — agrega 30 min/)

const addonAccepted = await engine(addonCatalog).process({
  businessId: 'business-1',
  conversation: addonOffer.conversationPatch,
  message: 'Sí, sumá una nutrición',
  understandingExtraction: {
    name: { value: null, confidence: 0, evidence: '' },
    service: { value: null, confidence: 0, evidence: '' },
    professional: { value: null, confidence: 0, evidence: '' },
    date: { value: null, confidence: 0, evidence: '' },
    time: { value: null, confidence: 0, evidence: '' },
    additionalServices: [
      { value: 'nutricion', confidence: 0.95, evidence: 'nutrición' }
    ],
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
})
assert.deepEqual(addonAccepted.state.combinedServices.map((item) => item.serviceId), ['nutricion'])

const nextJointOption = {
  date: '2026-10-09',
  time: '10:00',
  professionalId: 'profesional-1',
  professionalName: 'Tamara'
}
const unavailableDomain = {
  ...fakeDomain(),
  async findAvailabilityOptions(input: { date: string }) {
    return {
      ok: true as const,
      options: input.date === nextJointOption.date
        ? [{
            time: nextJointOption.time,
            professionalId: nextJointOption.professionalId,
            professionalName: nextJointOption.professionalName
          }]
        : []
    }
  },
  async findNextAvailabilityOptions() {
    return [nextJointOption]
  }
}
const naturalChoice = {
  async extract(input: { message: string }) {
    if (/separado/i.test(input.message)) {
      return { choiceId: 'separate', confidence: 0.96 }
    }
    if (/viernes\s+9.*10/i.test(input.message)) {
      return { choiceId: 'joint:0', confidence: 0.96 }
    }
    return { choiceId: null, confidence: 0 }
  }
}
const combinedAvailabilityEngine = new BookingV2Engine(
  unavailableDomain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  naturalChoice
)
let unavailableState = addCombinedServices(
  acceptField(acceptField(namedState, 'service', 'corte'), 'professional', 'profesional-1'),
  [{ serviceId: 'color', evidence: 'color' }]
)
unavailableState = acceptField(unavailableState, 'date', '2026-10-05')
const alternatives = await combinedAvailabilityEngine.resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(unavailableState)
})
assert.equal(alternatives.plan.type, 'offer_combined_availability')
assert.equal(alternatives.messages?.length, 2)
assert.match(alternatives.messages?.[0] ?? '', /próxima disponibilidad conjunta/i)
assert.match(alternatives.messages?.[1] ?? '', /por separado/i)

const selectedNaturalSlot = await combinedAvailabilityEngine.process({
  businessId: 'business-1',
  conversation: alternatives.conversationPatch,
  message: 'El viernes 9 a las 10'
})
assert.equal(selectedNaturalSlot.plan.type, 'confirm_booking')
assert.equal(selectedNaturalSlot.state.draft.date, '2026-10-09')
assert.equal(selectedNaturalSlot.state.draft.time, '10:00')
assert.deepEqual(selectedNaturalSlot.state.combinedServices.map((item) => item.serviceId), ['color'])

const separateSearch = await combinedAvailabilityEngine.process({
  businessId: 'business-1',
  conversation: alternatives.conversationPatch,
  message: 'Prefiero que los busques por separado'
})
assert.deepEqual(separateSearch.state.combinedServices, [])
assert.deepEqual(separateSearch.state.queuedServices.map((item) => item.serviceId), ['color'])

const extractorSource = readFileSync('src/services/booking-v2-extractor.ts', 'utf8')
const conversationSource = readFileSync('src/services/conversation-service.ts', 'utf8')
const crmSource = readFileSync('src/routes/crm.ts', 'utf8')
const serviceRouteSource = readFileSync('src/routes/service.ts', 'utf8')
const crmUiSource = readFileSync('src/routes/crm-ui.ts', 'utf8')
const appointmentSource = readFileSync('src/services/appointment-service.ts', 'utf8')
assert.match(extractorSource, /additionalServices/)
assert.match(extractorSource, /los restantes, en el orden mencionado/)
assert.match(conversationSource, /Ahora seguimos con la reserva de/)
assert.match(conversationSource, /advanceToNextQueuedService\(state\)/)
assert.match(conversationSource, /los demás servicios pendientes/)
assert.match(conversationSource, /handlePendingDepositServiceAddition/)
assert.match(conversationSource, /currentStep: 'AWAITING_DEPOSIT'/)
assert.match(appointmentSource, /replacePendingDepositServices/)
assert.match(appointmentSource, /totalDurationMinutes: professionalDuration/)
assert.match(crmSource, /advanceToNextQueuedService/)
assert.match(crmSource, /resumedContinuation/)
assert.match(serviceRouteSource, /suggestedAddonIds/)
assert.match(serviceRouteSource, /allowedCombinationServiceIds/)
assert.match(serviceRouteSource, /ServiceCombinationConfiguration/)
assert.match(crmUiSource, /service-association-list/)
assert.match(crmUiSource, /data-service-addon/)
assert.match(crmUiSource, /data-service-policy/)

console.log('multi-service-booking-contract-test: OK')
