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
  explicit.state.queuedServices.map((service) => service.serviceId),
  ['color', 'nutricion']
)
assert.match(explicit.reply, /vamos a reservar los servicios uno por uno/i)
assert.match(explicit.reply, /Empezamos con Corte/)

const singleServiceWithSeveralQuestions = await engine().process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Quiero corte y también saber precios y horarios',
  understandingExtraction: null
})
assert.equal(singleServiceWithSeveralQuestions.state.draft.service, 'corte')
assert.deepEqual(singleServiceWithSeveralQuestions.state.queuedServices, [])

const restored = stateFromConversation(explicit.conversationPatch)
assert.deepEqual(restored.queuedServices, explicit.state.queuedServices)

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
assert.deepEqual(semantic.state.queuedServices, [
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
  semanticWithCategories.state.queuedServices.map((service) => service.serviceId),
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
assert.deepEqual(lowConfidenceAdditional.state.queuedServices, [])

const deduplicated = queueAdditionalServices(explicit.state, [
  { serviceId: 'color', evidence: 'repetido' },
  { serviceId: 'corte', evidence: 'servicio actual' },
  { serviceId: 'nutricion', evidence: 'repetido' }
])
assert.deepEqual(
  deduplicated.queuedServices.map((service) => service.serviceId),
  ['color', 'nutricion']
)

const firstContinuation = advanceToNextQueuedService(explicit.state)
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

const extractorSource = readFileSync('src/services/booking-v2-extractor.ts', 'utf8')
const conversationSource = readFileSync('src/services/conversation-service.ts', 'utf8')
const crmSource = readFileSync('src/routes/crm.ts', 'utf8')
assert.match(extractorSource, /additionalServices/)
assert.match(extractorSource, /los restantes, en el orden mencionado/)
assert.match(conversationSource, /Ahora seguimos con la reserva de/)
assert.match(conversationSource, /advanceToNextQueuedService\(state\)/)
assert.match(conversationSource, /los demás servicios pendientes/)
assert.match(crmSource, /advanceToNextQueuedService/)
assert.match(crmSource, /resumedContinuation/)

console.log('multi-service-booking-contract-test: OK')
